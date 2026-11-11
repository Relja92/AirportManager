import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AIRCRAFT, GOALS, ACHIEVEMENTS, totalLevels } from '../src/data/catalog.js';
import { AIRPORT_BY_ID } from '../src/data/airports.js';
import { SPECIALIZATIONS, migrateSpecializations } from '../src/specializations.js';
import { collectChangeResults } from '../src/changeResults.js';
const store = {};
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
const { game } = await import('../src/game.js');
let s, hub;
const near = (a, b) => assert.ok(Math.abs(a - b) < .001, `${a} != ${b}`);
function route(dest = 'CDG', hubId = 'LHR', type = 'kestrel') {
  const r = game.addRoute(hubId, dest), p = game.createPlane(type, false, hubId);
  assert.equal(game.assign(p.id, r.id, true), null); return r;
}
function role(id) { hub.specialization = id; game._rev++; }
function eligible() { hub.levels = { runway: 4, terminal: 3, gates: 3, amenities: 2, cargo: 2, marketing: 1, fuel: 1 }; game._rev++; }
function secondHub(id = 'FRA') { const h = { id, levels: { ...hub.levels }, specialization: 'general', specializationUntil: 0 }; s.hubs.push(h); game._rev++; return h; }
beforeEach(() => {
  game.silent = true; game.newGame('LHR'); s = game.state; hub = s.hubs[0];
  s.money = 50e6; s.rng = 2345; s.rivals = []; s.events = []; s.eventsUntil = 1e9;
  s.goalsDone = GOALS.map((g) => g.id); s.achDone = ACHIEVEMENTS.map((a) => a.id); game._rev++;
});

test('new and legacy hubs default to neutral economics and migration is idempotent', () => {
  assert.equal(hub.specialization, 'general'); const r = route('CDG', 'LHR', 'sparrow');
  const demand = game.routeDemand(r), cost = game.flightCost(AIRCRAFT.sparrow, r.km, hub);
  delete hub.specialization; delete hub.specializationUntil; delete s.today.specialization;
  migrateSpecializations(s); const snapshot = JSON.stringify(s); migrateSpecializations(s);
  assert.equal(JSON.stringify(s), snapshot); assert.equal(hub.specialization, 'general');
  near(game.routeDemand(r), demand); near(game.flightCost(AIRCRAFT.sparrow, r.km, hub), cost);
  const l = totalLevels(hub.levels); assert.equal(game.hubUpkeep(hub), Math.round(500 * l ** 1.6 * (1 + (l / 24) ** 3) * AIRPORT_BY_ID.LHR.market.operating));
  assert.equal(game.specializationDemand(hub, 1, 0, 'balanced'), 1);
});

test('unlock progress requires real infrastructure and staffed transfer routes', () => {
  assert.ok(game.specializationRequirements('LHR', 'budget').some((r) => !r.met));
  const snapshot = JSON.stringify(s); assert.ok(game.setSpecialization('LHR', 'premium')); assert.equal(JSON.stringify(s), snapshot);
  eligible(); for (const id of ['budget', 'premium', 'cargo']) assert.ok(game.specializationRequirements('LHR', id).every((r) => r.met));
  const routes = ['CDG', 'MAD', 'AMS'].map((id) => game.addRoute('LHR', id));
  assert.ok(game.specializationRequirements('LHR', 'transfer').some((r) => !r.met));
  for (const r of routes) game.assign(game.createPlane('kestrel', false, 'LHR').id, r.id, true);
  assert.ok(game.specializationRequirements('LHR', 'transfer').every((r) => r.met));
});

test('all specialization previews are pure and match the applied forecast', () => {
  eligible(); const r = route(); route('AMS'); route('MAD');
  const snapshot = JSON.stringify(s), original = game.routeDemand(r);
  const quotes = Object.keys(SPECIALIZATIONS).map((id) => game.specializationQuote('LHR', id));
  assert.equal(JSON.stringify(s), snapshot); near(game.routeDemand(r), original);
  const q = quotes.find((q) => q.profile.name === 'Budget');
  assert.equal(game.setSpecialization('LHR', 'budget', q.revision), null);
  near(game.routeDemand(r) * 2, q.routes.find((x) => x.id === r.id).after.demand);
  near(game.specializationQuote('LHR', 'general').before, q.after);
  assert.equal(s.managementChanges[0].estimatedAfter, q.after);
});

test('conversion charges once, keeps aircraft in flight and affects only the selected hub', () => {
  eligible(); const other = secondHub(); const r = route(), r2 = route('MAD', other.id), p = game.planesOn(r.id)[0];
  p.phase = 'out'; p.pax = 20; p.t = 20; p.dur = 60;
  const beforePlane = JSON.stringify(p), otherDemand = game.routeDemand(r2), cash = s.money, assets = game.assets();
  assert.equal(game.setSpecialization('LHR', 'cargo'), null);
  near(s.money, cash - SPECIALIZATIONS.cargo.fee); assert.equal(s.today.specialization, SPECIALIZATIONS.cargo.fee);
  assert.equal(s.today.cost, SPECIALIZATIONS.cargo.fee); assert.equal(game.assets(), assets);
  assert.equal(JSON.stringify(p), beforePlane); assert.equal(other.specialization, 'general'); near(game.routeDemand(r2), otherDemand);
});

test('cash, cooldown, invalid hubs and stale previews reject atomically', () => {
  eligible(); const q = game.specializationQuote('LHR', 'budget'); game.setPrice(route().id, -.1);
  let snapshot = JSON.stringify(s); assert.match(game.setSpecialization('LHR', 'budget', q.revision), /changed/); assert.equal(JSON.stringify(s), snapshot);
  s.money = 1; snapshot = JSON.stringify(s); assert.match(game.setSpecialization('LHR', 'budget'), /cash/); assert.equal(JSON.stringify(s), snapshot);
  s.money = 50e6; assert.ok(game.setSpecialization('XXX', 'budget')); assert.ok(game.setSpecialization('LHR', 'missing'));
  assert.equal(game.setSpecialization('LHR', 'budget'), null); snapshot = JSON.stringify(s);
  assert.ok(game.setSpecialization('LHR', 'budget')); assert.match(game.setSpecialization('LHR', 'general'), /committed/); assert.equal(JSON.stringify(s), snapshot);
  s.day = 13; assert.ok(game.setSpecialization('LHR', 'general')); s.day = 14;
  const cash = s.money; assert.equal(game.setSpecialization('LHR', 'general'), null); near(s.money, cash - SPECIALIZATIONS.general.fee);
  assert.equal(hub.specializationUntil, 28);
});

test('Budget rewards cheap economy routes and penalizes expensive fares or business cabins', () => {
  eligible(); const r = route(); r.price = .9; game._rev++;
  const plain = game.routeDemand(r), upkeep = game.hubUpkeep(hub), fee = game.handlingCost(AIRCRAFT.kestrel, hub);
  role('budget'); near(game.routeDemand(r), plain * 1.12); near(game.handlingCost(AIRCRAFT.kestrel, hub), fee * .8);
  assert.ok(Math.abs(game.hubUpkeep(hub) - upkeep * .85) <= 1);
  for (const settings of [{price:1,cabin:0},{price:.9,cabin:1}]) {
    Object.assign(r, settings); role('general'); const base = game.routeDemand(r); role('budget'); near(game.routeDemand(r), base * .85);
  }
  assert.equal(game.routeFactors(r).businessPreference, .4);
});

test('Premium rewards business cabins and regular service while preserving the cost trade-off', () => {
  eligible(); const r = route(); r.cabin = 1; game._rev++;
  const base = game.routeDemand(r), upkeep = game.hubUpkeep(hub); role('premium');
  near(game.routeDemand(r), base * 1.08); assert.equal(game.routeFactors(r).businessPreference, .9);
  assert.ok(Math.abs(game.hubUpkeep(hub) - upkeep * 1.3) <= 1);
  assert.equal(game.businessMultiplier(hub), 3.6); near(game.handlingCost(AIRCRAFT.kestrel, hub), AIRCRAFT.kestrel.fee * 1.15 * AIRPORT_BY_ID.LHR.market.operating);
  for (const settings of [{ cabin:0,service:'frequent' },{ cabin:1,service:'economy' }]) {
    Object.assign(r,settings); role('general'); const base = game.routeDemand(r); role('premium'); near(game.routeDemand(r), base * .88);
  }
});

test('actual Premium boarding, revenue and fuel bookkeeping use the same rules as forecasts', () => {
  eligible(); const r = route('CDG', 'LHR', 'heron'); r.cabin = 2; role('premium');
  const p = game.planesOn(r.id)[0], type = AIRCRAFT.heron, seats = game.seatsFor(type,r.cabin);
  r.poolOut = 120; p.phase = 'home'; p.t = type.turnaround;
  game.stepPlane(p, 1); assert.equal(p.phase,'out'); assert.equal(p.biz, Math.min(seats.biz, Math.floor(120 * game.bizShare(r.dest,hub,r))));
  const expectedRevenue = (p.pax + p.biz * 3.6) * game.ticket(r) + (p.pax + p.biz) * 11 + game.cargoIncome(type,r,hub);
  const fuel = game.flightCost(type,r.km,hub) - game.handlingCost(type,hub);
  game.land(p,r,type); near(r.today.rev,expectedRevenue); near(s.today.fuel,fuel);
});

test('transfer benefits depend on other available routes and their frequency', () => {
  eligible(); const routes = ['CDG','AMS','MAD','FCO'].map((d) => route(d)); routes.forEach((r) => { r.service = 'frequent'; }); role('transfer');
  const target = routes[0]; near(game.specializationConnections('LHR',target.dest,'frequent'),1.6);
  assert.ok(game.specializationConnections('LHR',target.dest,'economy') < 1.6);
  const p = game.planesOn(routes[1].id)[0]; p.phase = 'repair'; const repairing = game.specializationConnections('LHR',target.dest,'frequent');
  assert.ok(repairing < 1.6 && repairing > 1);
  s.events.push({type:'storm',airport:'MAD',start:0,days:2}); assert.ok(game.specializationConnections('LHR',target.dest,'frequent') < repairing);
  game.planesOn(routes[3].id)[0].lease = { returning:true }; near(game.specializationConnections('LHR',target.dest,'frequent'),1);
  s.events.push({type:'storm',airport:'LHR',start:0,days:2}); near(game.specializationConnections('LHR',target.dest,'frequent'),1);
});

test('empty routes cannot supply the specialist transfer boost', () => {
  eligible(); route('CDG'); ['AMS','MAD','FCO'].forEach((d) => game.addRoute('LHR',d)); role('transfer');
  near(game.specializationConnections('LHR','CDG','frequent'),1);
  assert.equal(game.specializationDemand(hub,1,0,'frequent'),.95);
});

test('Cargo increases freight volume and rates without overfilling holds or rewriting signed work', () => {
  eligible(); const r = route(), type = AIRCRAFT.kestrel, regular = game.routeDemand(r), income = game.cargoIncome(type,r,hub), units = game.cargoUnits(type,hub);
  const c = { id:s.nextId++, clientId:'medair', hub:'LHR', dest:r.dest, kind:'cargo', amount:200, done:0, reward:50000, due:7, days:7 };
  s.contracts.push(c); role('cargo'); near(game.cargoUnits(type,hub),units * 1.2); near(game.cargoIncome(type,r,hub),income * 2.4);
  near(game.routeDemand(r),regular * .9); game.contractProgress(r,type,hub,0); near(c.done,units * 1.2);
  assert.equal(c.reward,50000); assert.equal(c.amount,200);
  hub.levels.cargo = 4; assert.equal(game.cargoUnits(type,hub),type.cargo);
});

test('Cargo attracts a larger share of new freight work to its own hub', () => {
  eligible(); secondHub();
  const sample = () => { s.rng = 4567; const offers = []; for(let i=0;i<500;i++) { const c=game.makeContract(); if(c) offers.push(c); } return offers; };
  const baseline = sample(); role('cargo'); const focused = sample();
  const freight = focused.filter((c) => c.kind === 'cargo');
  assert.ok(freight.length / focused.length > baseline.filter((c) => c.kind === 'cargo').length / baseline.length + .1);
  assert.ok(freight.filter((c) => c.hub === 'LHR').length > freight.filter((c) => c.hub === 'FRA').length * 2);
});

test('a saved choice retains its commitment and does not charge again on load', () => {
  eligible(); game.setSpecialization('LHR','budget'); const cash = s.money;
  game.save(); assert.equal(game.load(),true); s=game.state; hub=s.hubs[0];
  assert.equal(hub.specialization,'budget'); assert.equal(hub.specializationUntil,14); near(s.money,cash);
  assert.match(game.setSpecialization('LHR','cargo'),/committed/);
});

test('existing result comparisons migrate without losing their observations', () => {
  eligible(); const r=route(); game.setPrice(r.id,-.1); const entry=s.managementChanges[0];
  const config=JSON.parse(entry.configuration); delete config.hubs; delete config.overhead; entry.configuration=JSON.stringify(config);
  migrateSpecializations(s); collectChangeResults(game); assert.equal(entry.status,'watching');
});

test('hub result comparisons include airport upkeep exactly once and stop after network changes', () => {
  eligible(); const r=route(); game.setSpecialization('LHR','budget'); const entry=s.managementChanges[0];
  while(s.day < 4) game.tick(5);
  assert.equal(entry.status,'complete'); assert.equal(entry.samples.length,3);
  near(entry.samples.at(-1).profit,r.yesterday.profit-s.yesterday.hubUpkeep.LHR);
  assert.equal(s.yesterday.upkeep,s.yesterday.hubUpkeep.LHR);
  s.day=14; s.minute=14*1440; game.setSpecialization('LHR','premium'); const second=s.managementChanges[0];
  game.addRoute('LHR','AMS'); collectChangeResults(game); assert.equal(second.status,'changed');
});

test('a parked-aircraft lease still collects results after hub signatures are added', () => {
  eligible(); game.leasePlane('sparrow','LHR',14); const entry=s.managementChanges[0];
  while(s.day < 2) game.tick(5);
  assert.equal(entry.status,'watching'); assert.equal(entry.samples.length,1);
});

test('loading another saved role invalidates cached demand', () => {
  eligible(); const r=route(); role('premium'); const premium=game.routeDemand(r); game.save();
  role('general'); assert.notEqual(game.routeDemand(r),premium);
  game.load(); near(game.routeDemand(game.route(r.id)),premium);
});
