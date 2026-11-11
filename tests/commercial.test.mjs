import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AIRCRAFT, GOALS, ACHIEVEMENTS } from '../src/data/catalog.js';
import { migrateCommercial, SERVICES } from '../src/commercial.js';
import { fleetMatches, aircraftPlan } from '../src/aircraftManagement.js';
import { operationsAttention } from '../src/operationsAttention.js';
const store = {};
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
const { game } = await import('../src/game.js');
const DAY = 1440;
let s;
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 0.001, `${message || ''}: ${a} != ${b}`);
const route = (dest = 'CDG') => game.addRoute('LHR', dest);
const lease = (r, days = 7) => { assert.equal(game.leasePlane('sparrow', 'LHR', days, r?.id), null); return s.planes.at(-1); };
const finish = (c, r) => game.contractProgress(r, AIRCRAFT.sparrow, game.hub(r.hub), c.amount);
function client(r = route()) {
  const c = { id: s.nextId++, clientId: 'horizon', kind: 'pax', what: 'holiday guests', hub: r.hub, dest: r.dest, amount: 200, days: 5, reward: 50000, due: s.day + 5, done: 0 };
  s.contracts.push(c); finish(c, r); return r;
}
beforeEach(() => {
  game.silent = true; game.newGame('LHR'); s = game.state;
  s.money = 50e6; s.rng = 12345; s.rivals = []; s.events = []; s.eventsUntil = 1e9;
  s.hubs[0].levels.runway = 4; s.hubs[0].levels.gates = 4; s.hubs[0].levels.terminal = 4;
  s.goalsDone = GOALS.map((g) => g.id); s.achDone = ACHIEVEMENTS.map((a) => a.id); game._rev++;
});

test('lease previews are pure, show all three terms and check cash, runway, gates and range', () => {
  const snapshot = JSON.stringify(s);
  const quotes = [7, 14, 30].map((n) => game.leaseQuote('sparrow', 'LHR', n));
  assert.equal(JSON.stringify(s), snapshot);
  assert.ok(quotes[0].daily > quotes[1].daily && quotes[1].daily > quotes[2].daily);
  for (const q of quotes) { assert.equal(q.why, null); assert.equal(q.commitment, q.fee + q.days * q.daily); }
  assert.ok(game.leaseQuote('sparrow', 'LHR', 8).why);
  assert.ok(game.leaseQuote('sparrow', 'LHR', 7, route('JFK').id).why);
  s.hubs[0].levels.runway = 1; assert.match(game.leaseQuote('condor', 'LHR').why, /runway/);
  s.money = 0; assert.match(game.leaseQuote('sparrow', 'LHR').why, /cash/);
  s.money = 50e6; s.hubs[0].levels.gates = 1;
  for (let i = 0; i < 2; i++) game.createPlane('sparrow', false, 'LHR');
  assert.match(game.leaseQuote('sparrow', 'LHR').why, /gate/);
});

test('lease purchase charges setup once and rent accrues proportionally without double billing', () => {
  const r = route(), q = game.leaseQuote('sparrow', 'LHR', 7, r.id), cash = s.money;
  const p = lease(r); near(s.money, cash - q.fee); assert.equal(p.routeId, r.id);
  s.minute += DAY / 4; game.stepLease(p);
  near(s.money, cash - q.fee - q.daily / 4); near(s.today.leases, q.fee + q.daily / 4);
  near(r.today.cost, q.daily / 4); near(p.leaseRentToday, q.daily / 4);
  game.stepLease(p); near(s.money, cash - q.fee - q.daily / 4);
  near(game.leaseCommitment(), q.daily * 6.75);
});

test('leasing does not create resale value, collateral or a trade-in loophole', () => {
  const r = route(), before = game.assets(), p = lease(r);
  assert.equal(game.assets(), before); assert.equal(game.planeValue(p), 0);
  const snapshot = JSON.stringify(s);
  assert.ok(game.sellPlane(p.id)); assert.ok(game.replacePlane(p.id)); assert.ok(game.changeType(p.id, 'kestrel'));
  assert.ok(aircraftPlan(game, { kind: 'sell', id: p.id }).why);
  assert.equal(JSON.stringify(s), snapshot);
});

test('saved leases resume billing from the saved minute, preserving rent and service', () => {
  const r = route(), p = lease(r); game.setService(r.id, 'frequent');
  s.minute += 300; game.stepLease(p); game.save();
  const cash = s.money; assert.equal(game.load(), true); s = game.state;
  const restored = game.plane(p.id); game.stepLease(restored); near(s.money, cash);
  assert.equal(game.route(r.id).service, 'frequent');
  s.minute += 100; game.stepLease(restored); near(s.money, cash - p.lease.daily * 100 / DAY);
});

test('early return settles remaining rent, frees the gate and preserves the route', () => {
  const r = route(), p = lease(r); s.minute += DAY; game.stepLease(p);
  const q = game.leaseActionQuote(p.id, 'return'), cash = s.money;
  near(q.cost, p.lease.daily * 6); assert.equal(game.leaseAction(p.id, 'return'), null);
  near(s.money, cash - q.cost); assert.equal(game.plane(p.id), undefined); assert.equal(game.planesOn(r.id).length, 0);
  assert.ok(game.route(r.id)); assert.equal(game.leaseCommitment(), 0);
});

test('return with insufficient cash is atomic', () => {
  const p = lease(); s.money = 0; const snapshot = JSON.stringify(s);
  assert.match(game.leaseAction(p.id, 'return'), /cash/); assert.equal(JSON.stringify(s), snapshot);
});

test('lease attention appears within three days, clears on extension and then on return', () => {
  const r = route(), p = lease(r), originalEnd = p.lease.end;
  assert.equal(fleetMatches(game, p, 'leases'), false); assert.equal(fleetMatches(game, p, 'leased'), true);
  s.minute = originalEnd - 2 * DAY; game.stepLease(p);
  assert.ok(operationsAttention(game).alerts.some((a) => a.categories.includes('leases')));
  const cash = s.money; assert.equal(game.leaseAction(p.id, 'extend'), null);
  assert.equal(s.money, cash); assert.equal(p.lease.end, originalEnd + 7 * DAY);
  assert.equal(fleetMatches(game, p, 'leases'), false);
  assert.equal(game.leaseAction(p.id, 'return'), null);
  assert.ok(!operationsAttention(game).alerts.some((a) => a.categories.includes('leases')));
});

test('expired ground leases return automatically and cannot be extended', () => {
  const p = lease(); s.minute = p.lease.end;
  assert.ok(game.leaseAction(p.id, 'extend'));
  assert.equal(game.stepLease(p), false); assert.equal(game.plane(p.id), undefined);
});

test('an expiring aircraft finishes only its current flight and pays no rent past expiry', () => {
  const r = route(), p = lease(r); p.phase = 'out'; p.t = 0; p.dur = 60; p.pax = 10;
  s.minute = p.lease.end; assert.equal(game.stepLease(p), true); assert.equal(p.lease.returning, true);
  assert.ok(game.assign(p.id, null)); assert.ok(game.whyNotMove(p.id, r.id));
  const rent = s.today.leases; s.minute += 60; game.stepLease(p); near(s.today.leases, rent);
  game.stepPlane(p, 120); assert.equal(p.flights, 1); assert.equal(game.plane(p.id), undefined);
  assert.equal(r.today.flights, 1);
});

test('rent and maintenance reconcile in company, aircraft and route daily results', () => {
  const r = route(), p = lease(r), q = p.lease;
  s.minute += DAY; game.stepLease(p);
  const maintenance = game.planeMaintenance(p); game.endOfDay();
  near(s.yesterday.leases, AIRCRAFT[p.type].price * .03 + q.daily);
  near(p.yday, -maintenance - q.daily); near(r.yesterday.profit, -maintenance - q.daily);
  near(s.yesterday.cost, s.yesterday.leases + s.yesterday.maintenance + s.yesterday.upkeep);
  assert.equal(p.leaseRentToday, 0);
});

test('route launch leases atomically include route fee, setup and ongoing forecast rent', () => {
  const choice = { mode: 'lease', typeId: 'sparrow', days: 30 };
  const q = game.launchQuote('LHR', 'CDG', choice), cash = s.money;
  assert.equal(q.why, null); assert.equal(q.total, q.routeCost + q.lease.fee);
  near(q.profit, game.launchQuote('LHR', 'CDG', { mode: 'new', typeId: 'sparrow' }).profit - q.lease.daily);
  assert.equal(game.launchRoute('LHR', 'CDG', choice), null); near(s.money, cash - q.total);
  const p = s.planes.at(-1); assert.equal(p.lease.days, 30); assert.equal(p.routeId, s.routes.at(-1).id);
  const snapshot = JSON.stringify(s);
  assert.ok(game.launchRoute('LHR', 'JFK', choice)); assert.equal(JSON.stringify(s), snapshot);
  assert.ok(game.launchRoute('LHR', 'AMS', { ...choice, days: 99 })); assert.equal(JSON.stringify(s), snapshot);
});

test('older saves retain balanced service and receive stable client identities', () => {
  const r = route(); delete r.service; delete s.clients; delete s.today.leases;
  s.contracts = [{ id: 3, kind: 'pax' }, { id: 4, kind: 'cargo' }];
  migrateCommercial(s); const snapshot = JSON.stringify(s); migrateCommercial(s);
  assert.equal(JSON.stringify(s), snapshot); assert.equal(r.service, 'balanced'); assert.ok(s.contracts.every((c) => c.clientId));
});

test('service previews change demand, flights and profit without changing live state', () => {
  const r = route(); const p = game.createPlane('condor', false, 'LHR'); game.assign(p.id, r.id, true);
  const snapshot = JSON.stringify(s), economy = game.serviceQuote(r.id, 'economy'), frequent = game.serviceQuote(r.id, 'frequent');
  assert.equal(JSON.stringify(s), snapshot);
  assert.ok(economy.after.demand < economy.before.demand && frequent.after.demand > frequent.before.demand);
  assert.ok(frequent.after.flights > economy.after.flights);
  assert.notEqual(economy.after.profit, frequent.after.profit);
  assert.equal(game.setService(r.id, 'frequent'), null); assert.equal(r.service, 'frequent');
  assert.equal(s.managementChanges[0].kind, 'service'); assert.equal(game.serviceQuote(r.id, 'unknown').why != null, true);
});

test('actual departures obey each service policy load threshold and maximum wait', () => {
  const r = route(), p = game.createPlane('sparrow', false, 'LHR'); game.assign(p.id, r.id, true);
  const type = AIRCRAFT.sparrow;
  for (const [id, policy] of Object.entries(SERVICES)) {
    r.service = id; r.poolOut = Math.ceil(type.seats * policy.fill) - 1; p.phase = 'home'; p.t = type.turnaround;
    game.stepPlane(p, 1); assert.equal(p.phase, 'home', id);
    r.poolOut = Math.ceil(type.seats * policy.fill); game.stepPlane(p, 1); assert.equal(p.phase, 'out', id);
    p.phase = 'home'; p.t = type.turnaround + policy.wait - 2; r.poolOut = 0;
    game.stepPlane(p, 1); assert.equal(p.phase, 'home', id);
    game.stepPlane(p, 1); assert.equal(p.phase, 'out', id);
  }
});

test('first successful job unlocks an explicit three-week agreement, with no duplicate signing', () => {
  assert.ok(game.repeatQuote('horizon').why); const r = client();
  assert.equal(game.clientRecord('horizon').completed, 1);
  const q = game.repeatQuote('horizon'); assert.equal(q.why, null); assert.equal(q.weeks, 3);
  assert.equal(q.total, q.reward * 3); assert.equal(game.acceptRepeat('horizon'), null);
  const c = s.contracts[0]; assert.equal(c.hub, r.hub); assert.equal(c.dest, r.dest); assert.equal(c.due, s.day + 7);
  const snapshot = JSON.stringify(s); assert.ok(game.acceptRepeat('horizon')); assert.equal(JSON.stringify(s), snapshot);
});

test('repeat agreements pay each week once, do not carry excess traffic, and finish after three targets', () => {
  const r = client(), baselineReward = game.repeatQuote('horizon').reward;
  game.acceptRepeat('horizon'); const c = s.contracts[0]; const cash = s.money, done = s.contractsDone;
  finish(c, r); near(s.money, cash + c.reward); assert.equal(c.paid, true); assert.equal(s.contractsDone, done);
  finish(c, r); near(s.money, cash + c.reward);
  game.save(); game.load(); s = game.state;
  const saved = s.contracts[0]; finish(saved, game.route(r.id)); near(s.money, cash + saved.reward);
  s.day = saved.due; s.minute = s.day * DAY; game.stepContracts();
  assert.equal(saved.series.week, 2); assert.equal(saved.done, 0); assert.equal(saved.paid, false);
  finish(saved, game.route(r.id)); s.day = saved.due; s.minute = s.day * DAY; game.stepContracts();
  assert.equal(saved.series.week, 3); finish(saved, game.route(r.id));
  near(s.money, cash + saved.reward * 3); assert.equal(s.contractsDone, done + 1); assert.equal(s.contracts.length, 0);
  assert.equal(game.clientRecord('horizon').completed, 2); assert.ok(game.repeatQuote('horizon').why);
  s.day += 7; assert.equal(game.repeatQuote('horizon').reward, baselineReward, 'repeat rewards do not compound each renewal');
});

test('a missed repeat week ends the agreement, reduces trust, and clears its attention alert', () => {
  client(); game.acceptRepeat('horizon'); const c = s.contracts[0], rep = s.rep;
  s.day = c.due - 1; assert.ok(operationsAttention(game).alerts.some((a) => a.categories.includes('contracts')));
  s.day = c.due; s.minute = s.day * DAY; game.stepContracts();
  assert.equal(s.contracts.length, 0); assert.equal(s.rep, rep - 4); assert.equal(game.clientRecord('horizon').missed, 1);
  assert.equal(game.clientRecord('horizon').trust, 0); assert.ok(game.repeatQuote('horizon').why);
  assert.ok(!operationsAttention(game).alerts.some((a) => a.categories.includes('contracts')));
});

test('repeat work counts only the named route and refuses arrivals at or after its deadline', () => {
  const r = client(); game.acceptRepeat('horizon'); const c = s.contracts[0];
  game.contractProgress({ ...r, hub: 'FRA' }, AIRCRAFT.sparrow, game.hub('LHR'), c.amount);
  assert.equal(c.done, 0); s.minute = c.due * DAY;
  finish(c, r); assert.equal(c.done, 0); assert.equal(c.paid, false);
});

test('one-off jobs still count deliveries from another hub and cargo client agreements work', () => {
  const r = route(); s.hubs[0].levels.cargo = 1;
  const c = { id: s.nextId++, clientId: 'medair', kind: 'cargo', what: 'medical supplies', hub: 'LHR', dest: r.dest, amount: 1, days: 5, reward: 30000, due: 5, done: 0 };
  s.contracts.push(c); game.contractProgress({ ...r, hub: 'FRA' }, AIRCRAFT.condor, game.hub('LHR'), 0);
  assert.equal(s.contracts.length, 0); assert.equal(game.acceptRepeat('medair'), null);
  assert.equal(s.contracts[0].kind, 'cargo'); assert.ok(s.contracts[0].amount >= 5);
});

test('repeat agreements respect the three-contract limit', () => {
  client(); s.contracts = [1, 2, 3].map((id) => ({ id, due: 5, clientId: 'summit' }));
  const snapshot = JSON.stringify(s); assert.ok(game.acceptRepeat('horizon')); assert.equal(JSON.stringify(s), snapshot);
});

test('a 22-day simulation completes repeat work, bills a full lease exactly, and returns its aircraft', () => {
  const r = client(), owned = game.createPlane('kestrel', false, 'LHR'); game.assign(owned.id, r.id, true);
  assert.equal(game.acceptRepeat('horizon'), null);
  const hired = lease(route('MAD')), q = hired.lease, expectedRent = q.daily * q.days + AIRCRAFT[hired.type].price * .03;
  let rentPaid = 0, lastDay = s.day;
  while (s.day < 22) {
    game.tick(5);
    if (s.day !== lastDay) { rentPaid += s.yesterday.leases; lastDay = s.day; }
    assert.ok(Number.isFinite(s.money)); assert.equal(s.over, null);
  }
  near(rentPaid + s.today.leases, expectedRent);
  assert.equal(game.plane(hired.id), undefined); assert.equal(game.leaseCommitment(), 0);
  assert.equal(game.clientRecord('horizon').completed, 2); assert.equal(s.contractsDone, 2);
  assert.ok(!s.contracts.some((c) => c.series));
});

test('multiple leases can expire together without skipping an aircraft', () => {
  const a = lease(), b = lease(); s.minute = a.lease.end - 1; s.day = Math.floor(s.minute / DAY);
  game.tick(1); assert.equal(game.plane(a.id), undefined); assert.equal(game.plane(b.id), undefined);
});

test('existing one-off jobs keep their full deadline day', () => {
  const r = route(), c = { id: s.nextId++, clientId: 'horizon', kind: 'pax', hub: r.hub, dest: r.dest, what: 'holiday guests', amount: 20, done: 0, due: 5, days: 5, reward: 20000 };
  s.contracts.push(c); s.day = 5; s.minute = 5 * DAY + 1000; game.stepContracts();
  assert.ok(s.contracts.includes(c)); finish(c, r); assert.equal(s.contractsDone, 1);
});

test('auto-fit forecasts include lease rent and leave expired airborne leases in place', () => {
  const r = route(), p = lease(r), cash = s.money, withRent = game.autoFit('LHR');
  const daily = p.lease.daily; p.lease.daily = 0; const withoutRent = game.autoFit('LHR'); p.lease.daily = daily;
  near(withRent.before, withoutRent.before - daily); near(withRent.after, withoutRent.after - daily); assert.equal(s.money, cash);
  p.phase = 'out'; p.lease.returning = true; const plan = game.autoFit('LHR');
  assert.ok(!plan.moves.some((m) => m.plane === p.id)); near(plan.before, plan.after);
});
