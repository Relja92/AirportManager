import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AIRPORTS, AIRPORT_BY_ID } from '../src/data/airports.js';
import { AIRCRAFT, GOALS, ACHIEVEMENTS, UPGRADES } from '../src/data/catalog.js';
import { passengerMarket, passengerLoad, passengerTotal, PASSENGER_KEYS } from '../src/passengers.js';
import { routeEconomy } from '../src/rivals.js';
const saved = {};
globalThis.localStorage = { getItem: (k) => saved[k] ?? null, setItem: (k, v) => { saved[k] = v; } };
const { game } = await import('../src/game.js');
let s, hub;
const near = (a, b, tolerance = .00001) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const pure = (over = {}) => passengerMarket({ from: AIRPORT_BY_ID.LHR, to: AIRPORT_BY_ID.CDG, base: 300, ...over });
function route(dest = 'CDG', staffed = true) {
  const r = game.addRoute(hub.id, dest);
  if (staffed) game.assign(game.createPlane('heron', false, hub.id).id, r.id, true);
  return r;
}
beforeEach(() => {
  game.silent = true; game.newGame('LHR'); s = game.state; hub = s.hubs[0];
  s.money = 50e6; s.rivals = []; s.events = []; s.eventsUntil = 1e9; s.rng = 2345;
  hub.levels = { runway: 4, terminal: 4, gates: 4, amenities: 2, cargo: 2, fuel: 1, marketing: 1 };
  s.goalsDone = GOALS.map((g) => g.id); s.achDone = ACHIEVEMENTS.map((a) => a.id); game._rev++;
});

test('every airport has a finite, stable game profile with distinct market strengths', () => {
  for (const a of AIRPORTS) for (const key of ['leisure','business','businessShare','freight','operating','expansion','connections']) assert.ok(a.market[key] > 0 && Number.isFinite(a.market[key]), `${a.id}: ${key}`);
  assert.equal(AIRPORT_BY_ID.PMI.market.id, 'holiday');
  assert.equal(AIRPORT_BY_ID.ZRH.market.id, 'corporate');
  assert.equal(AIRPORT_BY_ID.FRA.market.id, 'logistics');
  assert.ok(AIRPORT_BY_ID.LHR.market.constrained);
  assert.ok(AIRPORT_BY_ID.LHR.market.expansion > AIRPORT_BY_ID.FRA.market.expansion);
});

test('local profiles change passenger mix even at the same base demand', () => {
  const holiday = pure({to: AIRPORT_BY_ID.PMI}), corporate = pure({to: AIRPORT_BY_ID.ZRH});
  assert.ok(holiday.segments.leisure > corporate.segments.leisure);
  assert.ok(corporate.segments.business > holiday.segments.business);
  const reversed = passengerMarket({from:AIRPORT_BY_ID.CDG,to:AIRPORT_BY_ID.LHR,base:300});
  assert.deepEqual(reversed.segments,pure().segments);
});

test('leisure is more fare-sensitive; business and connections respond more to frequency', () => {
  const normal = pure({connection:.5}), expensive = pure({price:1.4,connection:.5});
  assert.ok(expensive.segments.leisure/normal.segments.leisure < expensive.segments.business/normal.segments.business);
  const frequent = pure({service:'frequent',connection:.5}), economy = pure({service:'economy',connection:.5});
  assert.ok(frequent.segments.business/normal.segments.business > frequent.segments.leisure/normal.segments.leisure);
  assert.ok(economy.segments.business < normal.segments.business && economy.segments.connecting < normal.segments.connecting);
  assert.equal(economy.segments.leisure, normal.segments.leisure);
});

test('season, reputation and fleet condition have different effects by passenger group', () => {
  const normal = pure(), summer = pure({season:1.35}), poor = pure({reputation:.8,readiness:.6});
  assert.ok(summer.segments.leisure/normal.segments.leisure > summer.segments.business/normal.segments.business);
  assert.ok(poor.segments.business/normal.segments.business < poor.segments.leisure/normal.segments.leisure);
  const r = route(); const before = game.routeFactors(r);
  game.planesOn(r.id)[0].phase = 'repair'; game._rev++;
  const after = game.routeFactors(r);
  assert.ok(after.readiness < before.readiness);
  assert.ok(after.segments.business < before.segments.business);
});

test('connecting demand requires active feeders and disappears when they cannot operate', () => {
  const target = route('JFK');
  assert.equal(game.routeFactors(target).segments.connecting, 0);
  const feeder = route('CDG', false);
  assert.equal(game.routeFactors(target).segments.connecting, 0);
  const p = game.createPlane('kestrel', false, hub.id); game.assign(p.id, feeder.id, true);
  assert.ok(game.routeFactors(target).segments.connecting > 0);
  p.phase = 'repair'; game._rev++; assert.equal(game.routeFactors(target).segments.connecting, 0);
  p.phase = 'home'; s.events.push({type:'storm',airport:'CDG',start:0,days:2}); game._rev++;
  assert.equal(game.routeFactors(target).segments.connecting, 0);
});

test('contract passengers remain separate and unaffected by fare or service preferences', () => {
  const a = pure({charter:75}), b = pure({charter:75,price:1.6,service:'economy',reputation:.7,readiness:.6});
  assert.equal(a.segments.charter,75); assert.equal(b.segments.charter,75);
  near(b.total,passengerTotal(b.segments));
  const r=route(); s.contracts=[{id:99,hub:'LHR',dest:'CDG',kind:'pax',due:8,days:8,amount:500,done:0}]; game._rev++;
  const f=game.routeFactors(r); assert.ok(f.segments.charter>0); near(f.charter,f.segments.charter);
});

test('business cabins attract business demand and never invent premium passengers', () => {
  assert.ok(pure({cabin:2}).segments.business>pure({cabin:0}).segments.business);
  const leisureOnly=passengerLoad({leisure:500,business:0,connecting:10,charter:50},{eco:100,biz:20},.9,true);
  assert.equal(leisureOnly.biz,0); assert.equal(leisureOnly.eco,100);
  const businessOnly=passengerLoad({business:100},{eco:60,biz:10},.7,true);
  assert.equal(businessOnly.biz,10); assert.equal(businessOnly.eco,60); assert.equal(businessOnly.counts.business,70);
});

test('boarding conserves each queue and never exceeds cabin capacity', () => {
  const r=route(); r.cabin=2; route('AMS'); game._rev++;
  game.growPassengerPools(r,300);
  const before=structuredClone(r.passengerPools.poolOut), type=AIRCRAFT.heron;
  const load=game.boardPassengers(r,type,'poolOut'), seats=game.seatsFor(type,r.cabin);
  for (const id of PASSENGER_KEYS) { assert.ok(Number.isInteger(load.counts[id])); assert.ok(r.passengerPools.poolOut[id]>=0); near(before[id]-r.passengerPools.poolOut[id],load.counts[id]); }
  near(passengerTotal(load.counts),load.eco+load.biz);
  near(passengerTotal(before)-r.poolOut,load.eco+load.biz);
  assert.ok(load.eco<=seats.eco && load.biz<=seats.biz);
});

test('actual flights record passenger groups and revenue without counting people twice', () => {
  const r=route(), p=game.planesOn(r.id)[0]; r.cabin=1; r.poolOut=300; game._rev++;
  p.t=1000; game.stepPlane(p,1); assert.equal(p.phase,'out');
  const manifest=structuredClone(p.passengers), count=p.pax+p.biz;
  const revenue=(p.pax+p.biz*game.businessMultiplier(hub))*game.ticket(r)+count*11+game.cargoIncome(AIRCRAFT.heron,r,hub);
  game.land(p,r,AIRCRAFT.heron);
  near(r.today.rev,revenue); assert.equal(r.today.pax,count); assert.deepEqual(r.today.passengers,manifest);
  assert.equal(passengerTotal(r.today.passengers),count); assert.equal(p.passengers,null);
});

test('airport cost and freight traits affect real expenses and income without changing cargo volume', () => {
  const r=route(), type=AIRCRAFT.heron;
  near(game.handlingCost(type,hub),type.fee*AIRPORT_BY_ID.LHR.market.operating);
  const plain=UPGRADES.terminal.costs[hub.levels.terminal-UPGRADES.terminal.start];
  near(game.upgradeCost(hub,'terminal'),Math.round(plain*AIRPORT_BY_ID.LHR.market.expansion/1000)*1000);
  near(game.upgradeCost(hub,'amenities'),UPGRADES.amenities.costs[2]);
  const quoted=game.upgradeCost(hub,'gates'), cash=s.money; assert.equal(game.upgrade('gates'),null); near(cash-s.money,quoted);
  const units=game.cargoUnits(type,hub), freight=(AIRPORT_BY_ID.LHR.market.freight+AIRPORT_BY_ID.CDG.market.freight)/2;
  near(game.cargoIncome(type,r,hub),units*r.km*.25*(.5+AIRPORT_BY_ID.CDG.size/10)*freight);
  near(game.cargoUnits(type,hub),units);
});

test('service, launch and specialization previews are pure and include the current passenger model', () => {
  const r=route(); game.growPassengerPools(r,100); const snapshot=JSON.stringify(s);
  const service=game.serviceQuote(r.id,'frequent'), role=game.specializationQuote(hub.id,'premium');
  const fresh=game.launchQuote(hub.id,'AMS',{mode:'new',typeId:'heron'}), used=game.launchQuote(hub.id,'AMS',{mode:'used',typeId:'heron'});
  assert.equal(JSON.stringify(s),snapshot);
  near(passengerTotal(service.after.segments)*2,service.after.demand);
  assert.ok(used.market.segments.business<fresh.market.segments.business);
  assert.ok(Number.isFinite(role.after));
  game.setService(r.id,'frequent'); near(game.routeDemand(r)*2,service.after.demand);
});

test('legacy saves keep cash, aircraft in flight, contracts and unclassified history', () => {
  const r=route(), p=game.planesOn(r.id)[0]; r.poolOut=123.5; r.poolIn=77.25; delete s.passengerVersion;
  p.phase='out'; p.pax=25; p.biz=3; p.t=15; p.dur=90; delete p.passengers;
  r.yesterday={pax:42,rev:10000,cost:2000,seats:80,flights:2};
  s.contracts=[{id:90,clientId:'summit',hub:'LHR',dest:'CDG',kind:'pax',amount:500,reward:10000,due:8,days:8,done:20}];
  game.setPrice(r.id,-.1); const cash=s.money, plane=JSON.stringify(p), contracts=JSON.stringify(s.contracts);
  game.save(); assert.equal(game.load(),true); s=game.state;
  const loaded=game.route(r.id);
  near(s.money,cash); assert.equal(JSON.stringify(game.plane(p.id)),plane); assert.equal(JSON.stringify(s.contracts),contracts);
  near(loaded.poolOut,123.5); near(passengerTotal(loaded.passengerPools.poolOut),123.5);
  assert.equal(loaded.yesterday.passengers,undefined); assert.equal(s.managementChanges[0].status,'changed');
  const snapshot=JSON.stringify(s); game.migratePassengers(); assert.equal(JSON.stringify(s),snapshot);
});

test('new saves preserve exact passenger queues and manifests across reloads', () => {
  const r=route(); route('AMS'); game.growPassengerPools(r,300);
  game.planesOn(r.id)[0].t=1000; game.stepPlane(game.planesOn(r.id)[0],1);
  const queues=structuredClone(r.passengerPools), manifest=structuredClone(game.planesOn(r.id)[0].passengers);
  game.save(); game.load(); assert.deepEqual(game.route(r.id).passengerPools,queues); assert.deepEqual(game.planesOn(r.id)[0].passengers,manifest);
});

test('rival forecasts use local costs and the same mix-sensitive fare response', () => {
  const rv={id:10,style:0,rep:50,hubs:[{id:'LHR',level:3}],routes:[]};
  const r={hub:'LHR',dest:'CDG',type:'heron',age:0,price:1};rv.routes=[r];
  const normal=routeEconomy(s,rv,r,{steady:true}), costly=routeEconomy(s,rv,{...r,price:1.5},{steady:true});
  assert.ok(normal.cost>0 && Number.isFinite(normal.profit)); assert.ok(costly.pax<normal.pax);
});
