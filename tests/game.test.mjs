// Rules of the game, checked without a browser. Run with: npm test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = {};
globalThis.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const { game } = await import('../src/game.js');
const { aircraftPlan, applyAircraftPlan, fleetMatches, fleetBatchPlan, applyFleetBatch } = await import('../src/aircraftManagement.js');
const { operationsAttention, resolveAlertTarget, contractDueSoon } = await import('../src/operationsAttention.js');
const { changeOutcome, collectChangeResults } = await import('../src/changeResults.js');
const { matchesSearch, routeMatches, planeMatches, searchNetwork } = await import('../src/search.js');
const { AIRCRAFT, AIRCRAFT_LIST, UPGRADES, DIFFICULTY, LISTING_VALUE, ACHIEVEMENTS, GOALS, maxLevel } = await import('../src/data/catalog.js');
const { AIRPORTS, AIRPORT_BY_ID, CONTINENTS, continentOf } = await import('../src/data/airports.js');
const { geoDistance } = await import('d3-geo');
const kmBetween = (a, b) => geoDistance([AIRPORT_BY_ID[a].lon, AIRPORT_BY_ID[a].lat], [AIRPORT_BY_ID[b].lon, AIRPORT_BY_ID[b].lat]) * 6371;

const DAY = 1440;
let s;
const days = (n) => { for (let i = 0; i < (n * DAY) / 5; i++) game.tick(5); };
const toMidnight = () => { while (s.minute % DAY > 5) game.tick(5); };
// A rich company at London with a long runway, so tests can open and fly anything.
function rich(diff = 'normal') {
  game.newGame('LHR', 'free', diff);
  s = game.state;
  s.rng = 12345; // same dice every run
  s.money = 500e6;
  s.rivals.forEach((rv) => { rv.routes = []; rv.next = 1e9; rv.nextHub = 1e9; rv.hub = 'SYD'; rv.hubs = [{ id: 'SYD', level: 2 }]; }); // rivals out of the way unless a test wants them
  s.events = []; s.eventsUntil = 1e9; // no storms or strikes
  game._rev++;
  for (const k of ['runway', 'runway', 'runway', 'terminal', 'terminal', 'gates', 'gates', 'gates', 'cargo']) game.upgrade(k);
  return s;
}
const routeTo = (dest) => game.routeTo('LHR', dest);

beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; game.silent = false; });

// ---------- demand ----------
test('demand falls as the fare rises and rises with city size', () => {
  rich();
  const cheap = game.factors('LHR', 'CDG', 0.8).total;
  const normal = game.factors('LHR', 'CDG', 1).total;
  const dear = game.factors('LHR', 'CDG', 1.4).total;
  assert.ok(cheap > normal && normal > dear);
  const big = AIRPORTS.find((a) => a.size === 5 && a.id !== 'LHR' && !a.leisure);
  const small = AIRPORTS.find((a) => a.size === 1 && !a.leisure);
  const per = (a) => game.factors('LHR', a.id, 1).total * (1 + game.factors('LHR', a.id, 1).km / 9000) / game.factors('LHR', a.id, 1).season;
  assert.ok(per(big) > per(small) * 3);
});

test('reputation and difficulty scale demand', () => {
  rich();
  s.rep = 20; game._rev++;
  const low = game.factors('LHR', 'CDG', 1).total;
  s.rep = 90;
  const high = game.factors('LHR', 'CDG', 1).total;
  assert.ok(high > low * 1.3);
  const at = (d) => { rich(d); s.rep = 50; return game.factors('LHR', 'MAD', 1).total / game.factors('LHR', 'MAD', 1).season; };
  const e = at('easy'), n = at('normal'), h = at('hard');
  assert.ok(e > n && n > h);
});

test('connecting demand requires a staffed onward route as well as feeders', () => {
  rich();
  const before = game.factors('LHR', 'JFK', 1);
  for (const d of ['CDG', 'AMS', 'FRA', 'MAD']) {
    assert.equal(game.openRoute(d), null);
    const r = routeTo(d), p = game.createPlane('kestrel', false, 'LHR');
    game.assign(p.id, r.id, true);
  }
  assert.equal(game.factors('LHR','JFK',1).connect,1);
  const onward=game.addRoute('LHR','JFK'),plane=game.createPlane('heron',false,'LHR');
  game.assign(plane.id,onward.id,true);onward.service='frequent';game._rev++;
  const after = game.factors('LHR', 'JFK', 1,'frequent');
  assert.equal(before.connect, 1);
  assert.ok(after.connect > 1);
  assert.ok(after.connect > game.factors('LHR', 'DUB', 1).connect);
});

// ---------- routes and aircraft ----------
test('search matches city names, airport codes, aircraft and accents without treating punctuation as patterns', () => {
  rich(); game.openRoute('CDG'); game.buyPlane('sparrow');
  const r = routeTo('CDG'), p = s.planes[0];
  assert.ok(matchesSearch('sao paulo', 'São Paulo'));
  assert.ok(routeMatches(r, 'London Paris'));
  assert.ok(routeMatches(r, 'LHR-CDG'));
  assert.ok(planeMatches(game, p, 'sparrow paris'));
  assert.ok(planeMatches(game, p, p.name.toLowerCase()));
  assert.equal(searchNetwork(game, 'paris').routes[0].id, r.id);
  assert.equal(searchNetwork(game, 'CDG').airports[0].id, 'CDG');
  assert.equal(searchNetwork(game, 'not-a-city-xyz').routes.length, 0);
  assert.equal(searchNetwork(game, '').airports.length, 0);
  assert.equal(matchesSearch('[.*]', 'London'), true);
});

test('a move records the original preview, both routes and a stable actual baseline', () => {
  rich(); game.openRoute('CDG'); game.openRoute('AMS'); game.buyFor(routeTo('CDG').id, 'sparrow');
  const from = routeTo('CDG'), to = routeTo('AMS'), p = s.planes[0];
  from.yesterday = { profit: 6000 }; to.yesterday = { profit: 0 };
  const action = { kind: 'move', id: p.id, target: to.id }, plan = aircraftPlan(game, action);
  assert.equal(s.managementChanges.length, 0);
  assert.equal(applyAircraftPlan(game, action, plan.revision), null);
  const entry = s.managementChanges[0];
  assert.deepEqual(entry.routes.map((r) => r.id), [from.id, to.id]);
  assert.equal(entry.beforeActual, 6000);
  assert.ok(Math.abs(changeOutcome(entry).estimatedGain - plan.gain) < 1e-6);
  assert.equal(game.routeProfit(from), 6000, 'moving an aircraft cannot rewrite yesterday');
  assert.equal(changeOutcome(entry).actual, null);
});

test('results exclude the change day, average three complete days, and never resample one day', () => {
  rich(); game.openRoute('CDG'); game.buyPlane('sparrow');
  const r = routeTo('CDG'); r.yesterday = { profit: 5000 };
  game.setPrice(r.id, .1);
  const entry = s.managementChanges[0], estimate = entry.estimatedAfter;
  r.yesterday = { profit: 999999 }; collectChangeResults(game);
  assert.equal(entry.samples.length, 0, 'mixed change day is excluded');
  for (const [day, profit] of [[1, 6000], [2, 9000], [3, 12000]]) {
    s.day = day; r.yesterday = { profit }; collectChangeResults(game); collectChangeResults(game);
  }
  assert.equal(entry.samples.length, 3);
  assert.equal(entry.status, 'complete');
  assert.equal(changeOutcome(entry).actual, 9000);
  assert.equal(changeOutcome(entry).actualGain, 4000);
  assert.equal(entry.estimatedAfter, estimate);
  s.day++; r.yesterday = { profit: 1 }; collectChangeResults(game);
  assert.equal(changeOutcome(entry).actual, 9000, 'completed observations stay fixed');
});

test('end-of-day closes route profit and collects result observations before clearing daily ledgers', () => {
  rich(); game.openRoute('CDG'); game.buyPlane('sparrow');
  const r = routeTo('CDG'), p = s.planes[0];
  game.setPrice(r.id, .1); game.endOfDay();
  assert.equal(s.managementChanges[0].samples.length, 0);
  s.day = 1; r.today.rev = 10000; r.today.cost = 1000; game.endOfDay();
  const profit = 9000 - game.planeUpkeep(p);
  assert.equal(r.yesterday.profit, profit);
  assert.equal(s.managementChanges[0].samples[0].profit, profit);
  p.age = 300; game.assign(p.id, null);
  assert.equal(game.routeProfit(r), profit);
});

test('fare clicks coalesce while preserving the first baseline, and limits create no fake changes', () => {
  rich(); game.openRoute('CDG'); game.buyPlane('sparrow');
  const r = routeTo('CDG'); game.setPrice(r.id, .1);
  const before = s.managementChanges[0].estimatedBefore;
  game.setPrice(r.id, .1); game.setPrice(r.id, .1);
  assert.equal(s.managementChanges.length, 1);
  assert.equal(s.managementChanges[0].estimatedBefore, before);
  game.setPrice(r.id, 1); const last = JSON.stringify(s.managementChanges);
  game.setPrice(r.id, .1); assert.equal(JSON.stringify(s.managementChanges), last);
});

test('overlapping changes stop comparisons and unrelated routes remain under observation', () => {
  rich(); game.openRoute('CDG'); game.openRoute('AMS'); game.buyFor(routeTo('CDG').id, 'sparrow');
  const r = routeTo('CDG'), other = routeTo('AMS');
  game.setPrice(r.id, .1); const original = s.managementChanges[0];
  game.setPrice(other.id, .1);
  assert.equal(original.status, 'watching');
  const action = { kind: 'move', id: s.planes[0].id, target: other.id };
  applyAircraftPlan(game, action, game._rev);
  assert.equal(original.status, 'changed');
  assert.equal(s.managementChanges[1].status, 'changed');
  game.closeRoute(other.id); s.day++; collectChangeResults(game);
  assert.equal(s.managementChanges[0].status, 'changed');
});

test('untracked assignment changes are detected instead of attributed to a previous decision', () => {
  rich(); game.openRoute('CDG'); game.buyPlane('sparrow');
  game.setPrice(routeTo('CDG').id, .1);
  game.buyPlane('sparrow'); s.day++; collectChangeResults(game);
  assert.equal(s.managementChanges[0].status, 'changed');
});

test('bulk maintenance creates one comparison and parked costs are observed without invented baselines', () => {
  rich(); game.buyPlane('sparrow', true); game.buyPlane('sparrow', true);
  assert.equal(applyFleetBatch(game, 'maintain', 'LHR', game._rev), null);
  assert.equal(s.managementChanges.length, 1);
  const entry = s.managementChanges[0];
  assert.equal(entry.beforeActual, null);
  assert.equal(entry.cost, s.planes.reduce((sum, p) => sum + game.overhaulCost(p), 0));
  s.day = 1; game.endOfDay();
  assert.equal(changeOutcome(entry).actual, -game.maintenancePerDay());
  assert.equal(changeOutcome(entry).actualGain, null);
});

test('change history persists through saves, is bounded, and older saves load without it', () => {
  rich(); game.openRoute('CDG'); const r = routeTo('CDG');
  for (let i = 0; i < 35; i++) { s.minute += 6; game.setPrice(r.id, i % 2 ? -.1 : .1); }
  assert.equal(s.managementChanges.length, 30);
  game.save(); const history = JSON.stringify(s.managementChanges);
  assert.equal(game.load(), true); s = game.state;
  assert.equal(JSON.stringify(s.managementChanges), history);
  delete s.managementChanges; delete s.nextChangeId; game.save();
  assert.equal(game.load(), true); s = game.state;
  assert.deepEqual(s.managementChanges, []);
});

test('Operations counts current problems without mutating state or duplicating entity rows', () => {
  rich(); game.openRoute('CDG'); game.openRoute('AMS');
  game.buyFor(routeTo('CDG').id, 'sparrow', true); game.buyPlane('sparrow');
  const [worn, parked] = s.planes;
  game.assign(parked.id, null);
  worn.phase = 'repair'; worn.t = 0; worn.resume = 'home';
  routeTo('CDG').yesterday = { rev: 0, cost: 1000, pax: 0, seats: 0, flights: 0 };
  const before = JSON.stringify(s), result = operationsAttention(game);
  assert.equal(JSON.stringify(s), before);
  assert.equal(result.alerts.length, 4);
  assert.equal(new Set(result.alerts.map((a) => a.id)).size, 4);
  for (const id of ['unassigned', 'losing', 'disrupted', 'parked', 'repair', 'maintenance']) {
    assert.equal(result.groups.find((g) => g.id === id).count, 1, id);
  }
  assert.equal(result.alerts.find((a) => a.target.id === worn.id).target.kind, 'plane');
});

test('resolved assignments, maintenance and completed repairs disappear from Operations', () => {
  rich(); game.openRoute('CDG'); game.buyFor(routeTo('CDG').id, 'sparrow', true);
  const p = s.planes[0];
  game.assign(p.id, null);
  assert.equal(operationsAttention(game).alerts.length, 2);
  game.assign(p.id, routeTo('CDG').id); game.overhaul(p.id);
  assert.equal(operationsAttention(game).alerts.length, 0);
  p.phase = 'repair'; p.t = 0; p.resume = 'home';
  assert.equal(operationsAttention(game).alerts.length, 2);
  game.stepPlane(p, 720);
  assert.equal(operationsAttention(game).alerts.length, 0);
});

test('airport disruption alerts clear after settlement or expiry', () => {
  rich(); game.openRoute('CDG'); game.buyFor(routeTo('CDG').id, 'sparrow');
  const e = { id: s.nextId++, type: 'strike', airport: 'LHR', start: s.day, days: 2, settled: false };
  s.events.push(e);
  assert.ok(operationsAttention(game).alerts.some((a) => a.categories.includes('disrupted')));
  e.settled = true;
  assert.equal(operationsAttention(game).alerts.length, 0);
  e.type = 'storm'; e.start = s.day - 2;
  assert.equal(operationsAttention(game).alerts.length, 0);
});

test('loss alerts reflect actual results and survive a fare change until new results arrive', () => {
  rich(); game.openRoute('CDG'); game.buyFor(routeTo('CDG').id, 'sparrow');
  const r = routeTo('CDG');
  assert.equal(operationsAttention(game).groups.find((g) => g.id === 'losing').count, 0);
  r.yesterday = { rev: 0, cost: 1000, pax: 0, seats: 0, flights: 0 };
  game.setPrice(r.id, 0.8);
  assert.equal(operationsAttention(game).groups.find((g) => g.id === 'losing').count, 1);
  r.yesterday = { rev: 100000, cost: 1000, pax: 100, seats: 100, flights: 2 };
  assert.equal(operationsAttention(game).groups.find((g) => g.id === 'losing').count, 0);
  game.closeRoute(r.id);
  assert.ok(!operationsAttention(game).alerts.some((a) => a.target.kind === 'route'));
});

test('deadline alerts include only unfinished signed contracts due within three days', () => {
  rich();
  const c = { id: s.nextId++, hub: 'LHR', dest: 'CDG', kind: 'pax', amount: 200, done: 20, due: s.day + 3 };
  s.contracts.push(c);
  assert.equal(contractDueSoon(c, s.day), true);
  assert.equal(operationsAttention(game).groups.find((g) => g.id === 'contracts').count, 1);
  c.due++; assert.equal(contractDueSoon(c, s.day), false);
  c.due = s.day; assert.equal(operationsAttention(game).alerts[0].priority, 0);
  c.done = c.amount; assert.equal(operationsAttention(game).alerts.length, 0);
  c.done = 20; c.due = null; assert.equal(contractDueSoon(c, s.day), false);
  c.due = s.day - 1; assert.equal(contractDueSoon(c, s.day), false);
  c.due = s.day; c.finished = true; assert.equal(contractDueSoon(c, s.day), false);
});

test('Operations scopes route, aircraft and deadline alerts to the selected hub', () => {
  rich(); game.openRoute('CDG'); game.buyPlane('sparrow');
  game.assign(s.planes[0].id, null);
  s.contracts.push({ id: s.nextId++, hub: 'CDG', dest: 'AMS', kind: 'pax', amount: 100, done: 0, due: s.day });
  assert.equal(operationsAttention(game, 'LHR').alerts.length, 2);
  assert.equal(operationsAttention(game, 'CDG').alerts.length, 1);
  assert.equal(operationsAttention(game, 'all').alerts.length, 3);
});

test('news stores exact route and aircraft targets and safely handles removed entities and legacy entries', () => {
  rich(); game.openRoute('CDG');
  const r = routeTo('CDG');
  const routeEntry = s.log.find((l) => l.text.startsWith('Route opened:'));
  assert.deepEqual(resolveAlertTarget(game, routeEntry), { kind: 'route', id: r.id });
  game.buyPlane('sparrow', true);
  const p = s.planes[0], delivery = s.log.find((l) => l.text.includes('delivered'));
  assert.deepEqual(resolveAlertTarget(game, delivery), { kind: 'plane', id: p.id });
  game.overhaul(p.id);
  assert.deepEqual(s.log.find((l) => l.text.includes('overhauled')).target, delivery.target);
  game.save(); assert.equal(game.load(), true); s = game.state;
  assert.deepEqual(resolveAlertTarget(game, s.log.find((l) => l.text.includes('delivered'))), delivery.target);
  game.sellPlane(p.id); game.buyPlane('sparrow');
  assert.equal(resolveAlertTarget(game, delivery), null);
  game.closeRoute(r.id); assert.equal(resolveAlertTarget(game, routeEntry), null);
  assert.deepEqual(resolveAlertTarget(game, { at: 'CDG' }), { kind: 'airport', id: 'CDG' });
  assert.equal(resolveAlertTarget(game, { text: 'An older announcement' }), null);
  assert.equal(resolveAlertTarget(game, { target: { kind: 'page', id: 'unknown' } }), null);
});

test('breakdown news links to the exact damaged aircraft', () => {
  rich(); game.openRoute('CDG'); game.buyPlane('sparrow');
  const p = s.planes[0], r = routeTo('CDG'), rand = game.rand;
  p.phase = 'out'; p.pax = 10; p.biz = 0;
  try { game.rand = () => 0; game.land(p, r, AIRCRAFT[p.type]); } finally { game.rand = rand; }
  const entry = s.log.find((l) => l.text.includes('broke down'));
  assert.equal(p.phase, 'repair');
  assert.deepEqual(resolveAlertTarget(game, entry), { kind: 'plane', id: p.id });
});

test('fleet assignment preview allocates parked aircraft without mutating the game', () => {
  rich(); game.buyPlane('sparrow'); game.buyPlane('sparrow'); game.openRoute('CDG'); game.openRoute('AMS');
  const before = JSON.stringify(s), plan = fleetBatchPlan(game, 'assign', 'LHR');
  assert.equal(plan.why, null);
  assert.equal(JSON.stringify(s), before);
  assert.equal(new Set(plan.actions.map((a) => a.target)).size, 2, 'serve each empty route first');
  assert.equal(applyFleetBatch(game, 'assign', 'LHR', plan.revision), null);
  assert.equal(s.planes.filter((p) => p.routeId == null).length, 0);
});

test('bulk maintenance checks the complete cost before applying', () => {
  rich(); game.buyPlane('sparrow'); game.buyPlane('sparrow');
  for (const p of s.planes) p.age = 300;
  s.money = game.overhaulCost(s.planes[0]);
  const before = JSON.stringify(s);
  assert.match(fleetBatchPlan(game, 'maintain', 'LHR').why, /cash/);
  assert.equal(JSON.stringify(s), before);
});

test('bulk maintenance includes the same aircraft as the high-maintenance filter', () => {
  rich(); game.buyPlane('sparrow'); game.buyPlane('sparrow');
  s.planes[0].age = 150;
  const plan = fleetBatchPlan(game, 'maintain', 'LHR');
  assert.equal(plan.why, null);
  assert.deepEqual(plan.actions.map((a) => a.id), s.planes.filter((p) => fleetMatches(game, p, 'maintenance')).map((p) => p.id));
  assert.equal(applyFleetBatch(game, 'maintain', 'LHR', plan.revision), null);
  assert.equal(s.planes[0].age, 60);
  assert.equal(s.planes[1].age, 0);
});

test('aircraft move previews are read-only and include both affected routes', () => {
  rich(); game.openRoute('CDG'); game.openRoute('AMS'); game.buyFor(routeTo('CDG').id, 'sparrow');
  const p = s.planes[0], action = { kind: 'move', id: p.id, target: routeTo('AMS').id };
  const before = JSON.stringify(s);
  const plan = aircraftPlan(game, action);
  assert.equal(plan.why, null);
  assert.equal(plan.cost, 0);
  assert.equal(plan.routes.length, 2);
  assert.equal(plan.routes.find((r) => r.route.dest === 'CDG').countAfter, 0);
  assert.equal(JSON.stringify(s), before);
  assert.equal(applyAircraftPlan(game, action, plan.revision), null);
  assert.equal(p.routeId, routeTo('AMS').id);
});

test('swap preview validates both aircraft and swaps only after confirmation', () => {
  rich(); game.openRoute('CDG'); game.openRoute('AMS');
  game.buyFor(routeTo('CDG').id, 'sparrow'); game.buyFor(routeTo('AMS').id, 'kestrel');
  const [a, b] = s.planes, aRoute = a.routeId, bRoute = b.routeId;
  const action = { kind: 'swap', id: a.id, target: b.id }, plan = aircraftPlan(game, action);
  assert.equal(a.routeId, aRoute); assert.equal(b.routeId, bRoute);
  assert.equal(plan.changes[0].after.routeId, bRoute);
  assert.equal(plan.changes[1].after.routeId, aRoute);
  assert.equal(applyAircraftPlan(game, action, plan.revision), null);
  assert.equal(a.routeId, bRoute); assert.equal(b.routeId, aRoute);
  b.phase = 'repair';
  assert.match(aircraftPlan(game, action).why, /repairs/i);
});

test('aircraft previews revalidate conditions and reject stale reviews', () => {
  rich(); game.openRoute('CDG'); game.openRoute('AMS'); game.buyFor(routeTo('CDG').id, 'sparrow', true);
  const p = s.planes[0], action = { kind: 'overhaul', id: p.id }, plan = aircraftPlan(game, action);
  game.setPrice(routeTo('CDG').id, 0.1);
  assert.match(applyAircraftPlan(game, action, plan.revision), /Conditions changed/);
  assert.equal(p.age, 150);
  s.money = 0;
  assert.match(aircraftPlan(game, action).why, /cash/);
  assert.match(aircraftPlan(game, { kind: 'move', id: p.id, target: 999999 }).why, /route/);
});

test('maintenance, replacement and sale previews use age and upkeep consistently', () => {
  rich(); game.buyPlane('sparrow', true);
  const p = s.planes[0];
  const maintenance = aircraftPlan(game, { kind: 'overhaul', id: p.id });
  assert.equal(maintenance.changes[0].after.age, 60);
  assert.equal(maintenance.gain, game.planeUpkeep(p) - game.planeUpkeep({ ...p, age: 60 }));
  assert.equal(p.age, 150);
  const replacement = aircraftPlan(game, { kind: 'replace', id: p.id });
  assert.equal(replacement.cost, game.replaceCost(p));
  assert.equal(replacement.changes[0].after.age, 0);
  const sale = aircraftPlan(game, { kind: 'sell', id: p.id });
  assert.equal(sale.gain, game.planeUpkeep(p));
  assert.equal(sale.cost, -game.planeValue(p));
});

test('fleet filters distinguish maintenance, repairs, parked aircraft and actual losses', () => {
  rich(); game.buyPlane('sparrow', true);
  const p = s.planes[0];
  assert.equal(fleetMatches(game, p, 'parked'), true);
  assert.equal(fleetMatches(game, p, 'maintenance'), true);
  assert.equal(fleetMatches(game, p, 'losing'), false);
  game.openRoute('CDG'); game.assign(p.id, routeTo('CDG').id); p.yday = -50;
  assert.equal(fleetMatches(game, p, 'losing'), true);
  p.phase = 'repair';
  assert.equal(fleetMatches(game, p, 'repair'), true);
  assert.equal(fleetMatches(game, p, 'attention'), true);
});

test('reassignment previews warn about interrupted flights and account for parked upkeep', () => {
  rich(); game.openRoute('CDG'); game.buyFor(routeTo('CDG').id, 'sparrow');
  const p = s.planes[0]; p.phase = 'out'; p.pax = 30;
  const plan = aircraftPlan(game, { kind: 'park', id: p.id });
  assert.match(plan.warning, /interrupts/);
  assert.equal(plan.gain, -plan.routes[0].before - game.planeUpkeep(p));
  assert.equal(p.pax, 30);
});

test('route launch buys and assigns the chosen aircraft with one complete charge', () => {
  rich();
  // Another empty route must not steal the purchased aircraft.
  game.openRoute('AMS');
  const choice = { mode: 'new', typeId: 'sparrow' };
  const before = s.money;
  const q = game.launchQuote('LHR', 'CDG', choice);
  assert.equal(q.why, null);
  assert.equal(s.money, before, 'reviewing a quote does not spend money');
  assert.equal(routeTo('CDG'), undefined);
  assert.equal(game.launchRoute('LHR', 'CDG', choice), null);
  assert.equal(s.money, before - q.total);
  assert.equal(game.planesOn(routeTo('CDG').id).length, 1);
  assert.equal(game.planesOn(routeTo('AMS').id).length, 0);
  const p = game.planesOn(routeTo('CDG').id)[0];
  assert.equal(p.type, 'sparrow');
  assert.equal(p.phase, 'home');
  assert.equal(p.age, 0);
  assert.match(game.launchRoute('LHR', 'CDG', choice), /already/i);
});

test('launch quote includes used-aircraft upkeep and launch preserves its age', () => {
  rich();
  game.openRoute('AMS');
  const fresh = game.launchQuote('LHR', 'CDG', { mode: 'new', typeId: 'sparrow' });
  const choice = { mode: 'used', typeId: 'sparrow' };
  const used = game.launchQuote('LHR', 'CDG', choice);
  assert.ok(used.total < fresh.total);
  assert.ok(used.profit < fresh.profit);
  const before = s.money;
  assert.equal(game.launchRoute('LHR', 'CDG', choice), null);
  assert.equal(s.money, before - used.total);
  assert.equal(game.planesOn(routeTo('CDG').id)[0].age, 150);
});

test('launch rejects an unaffordable bundle without spending or creating anything', () => {
  game.newGame('LHR'); s = game.state;
  const choice = { mode: 'new', typeId: 'sparrow' };
  const q = game.launchQuote('LHR', 'CDG', choice);
  s.money = q.total - 1;
  const before = JSON.stringify(s);
  assert.match(game.launchRoute('LHR', 'CDG', choice), /cash/i);
  assert.equal(JSON.stringify(s), before, 'must not rely on first-route goal rewards to cover the purchase');
});

test('launch revalidates gates, runway, range, terminal and parked availability', () => {
  game.newGame('LHR'); s = game.state; s.money = 50e6;
  const choice = { mode: 'new', typeId: 'sparrow' };
  assert.match(game.launchRoute('LHR', 'CDG', { mode: 'new', typeId: 'heron' }), /runway/i);
  game.buyPlane('sparrow'); game.buyPlane('sparrow');
  assert.match(game.launchRoute('LHR', 'CDG', choice), /gates/i);
  const parked = { mode: 'parked', planeId: s.planes[0].id };
  assert.equal(game.launchRoute('LHR', 'CDG', parked), null, 'parked aircraft uses its existing gate');
  assert.match(game.launchRoute('LHR', 'AMS', parked), /parked/i);
  game.openRoute('AMS'); game.openRoute('BRU');
  assert.match(game.launchRoute('LHR', 'DUB', { mode: 'none' }), /terminal/i);
  assert.match(game.launchRoute('LHR', 'SYD', choice), /range/i);
  rich();
  assert.match(game.launchRoute('LHR', 'JFK', choice), /range/i);
  assert.equal(routeTo('JFK'), undefined);
});

test('opening without aircraft is explicit and launch honors the specified hub', () => {
  rich();
  game.buyHub('FCO');
  const active = s.active;
  assert.equal(game.launchRoute('LHR', 'CDG', { mode: 'none' }), null);
  assert.equal(s.active, active);
  assert.equal(game.planesOn(routeTo('CDG').id).length, 0);
  assert.match(game.launchRoute('LHR', 'AMS', {}), /choose an aircraft/i);
  assert.equal(routeTo('AMS'), undefined);
});

test('opening a route charges for it and refuses bad requests', () => {
  game.newGame('LHR'); s = game.state;
  const cash = s.money;
  assert.equal(game.openRoute('CDG'), null);
  const firstRouteGoal = GOALS.find((g) => g.id === 'route1').reward;
  assert.equal(s.money, cash - game.openCost(routeTo('CDG').km) + firstRouteGoal);
  assert.match(game.openRoute('CDG'), /already/i);
  assert.match(game.openRoute('SYD'), /range/i);
  game.openRoute('AMS'); game.openRoute('BRU');
  assert.match(game.openRoute('DUB'), /terminal is full/i);
  s.money = 0;
  game.closeRoute(routeTo('BRU').id);
  assert.match(game.openRoute('DUB'), /cash/i);
});

test('buying aircraft respects the runway, the gates and the bank balance', () => {
  game.newGame('LHR'); s = game.state;
  game.openRoute('CDG');
  assert.match(game.buyPlane('heron'), /runway/i);
  assert.equal(game.buyPlane('sparrow'), null);
  assert.equal(s.planes[0].routeId, routeTo('CDG').id, 'goes straight onto the empty route');
  assert.equal(game.buyPlane('sparrow', true), null);
  assert.equal(s.planes[1].age, 150);
  assert.match(game.buyPlane('sparrow'), /gates/i);
  game.sellPlane(s.planes[1].id);
  s.money = 10;
  assert.match(game.buyPlane('sparrow'), /cash/i);
});

test('an aircraft cannot be assigned beyond its range or to another hub’s route', () => {
  rich();
  game.openRoute('JFK'); game.openRoute('CDG');
  game.buyPlane('sparrow');
  const p = s.planes[0];
  assert.match(game.assign(p.id, routeTo('JFK').id), /range/i);
  assert.equal(game.assign(p.id, routeTo('CDG').id), null);
});

test('a day of flying earns money and the books add up', () => {
  rich();
  game.openRoute('CDG'); game.buyPlane('kestrel');
  toMidnight();
  const start = s.money;
  for (let i = 0; i < 200; i++) game.tick(5); // well inside one day
  assert.ok(s.flights > 0);
  assert.ok(Math.abs((s.money - start) - (s.today.rev - s.today.cost)) < 1, 'cash moves by exactly what the ledger says');
  days(1);
  assert.ok(s.yesterday && s.history.length >= 1);
  assert.ok(routeTo('CDG').yesterday.flights > 0);
  assert.ok(s.planes[0].yday != null);
});

test('five days in the red is bankruptcy', () => {
  game.newGame('LHR'); s = game.state;
  s.money = -50e6;
  days(6);
  assert.equal(s.over?.type, 'bankrupt');
});

test('a destination you already fly to can become a hub, and the route becomes a hub link', () => {
  rich();
  game.openRoute('MAD'); game.buyPlane('heron');
  const r = routeTo('MAD');
  const before = game.factors('LHR', 'MAD', 1);
  assert.equal(game.whyNotHub('MAD'), null);
  assert.equal(game.buyHub('MAD'), null);
  assert.ok(game.isHub('MAD'));
  assert.ok(s.routes.includes(r) && s.planes[0].routeId === r.id, 'route and aircraft are untouched');
  game._rev++;
  const after = game.factors('LHR', 'MAD', 1);
  assert.equal(before.trunk, 1);
  assert.ok(after.trunk > 1 && after.total > before.total);
  s.active = 'MAD';
  assert.match(game.openRoute('LHR'), /Already flown/);
  days(2);
  assert.ok(r.yesterday.flights > 0 && !s.over);
});

// ---------- contracts ----------
function offer(over = {}) {
  const c = { id: s.nextId++, kind: 'pax', hub: 'LHR', dest: 'CDG', amount: 200, done: 0, days: 5, reward: 100e3, what: 'football fans', expires: s.day + 4, due: null, ...over };
  s.contracts.push(c);
  return c;
}

test('a signed contract completes when enough is carried, and pays', () => {
  rich();
  game.openRoute('CDG'); game.buyPlane('kestrel');
  const c = offer();
  assert.equal(game.acceptContract(c.id), null);
  assert.equal(c.due, s.day + 5);
  const rep = s.rep, cash = s.money;
  days(2);
  assert.ok(!s.contracts.includes(c), 'the finished contract is cleared');
  assert.equal(s.contractsDone, 1);
  assert.ok(s.money > cash + 90e3);
  assert.ok(s.rep > rep);
});

test('a missed contract is dropped and costs reputation; unsigned offers expire', () => {
  rich();
  const c = offer({ dest: 'MAD', amount: 1e9, days: 2 });
  game.acceptContract(c.id);
  const lapsing = offer({ dest: 'FCO' });
  s.rep = 60;
  days(6);
  assert.ok(!s.contracts.includes(c));
  assert.ok(!s.contracts.includes(lapsing));
  assert.ok(s.rep < 60);
  assert.equal(s.contractsDone, 0);
});

test('only three contracts can run at once', () => {
  rich();
  const made = ['CDG', 'MAD', 'FCO', 'AMS'].map((dest) => offer({ dest }));
  assert.deepEqual(made.slice(0, 3).map((c) => game.acceptContract(c.id)), [null, null, null]);
  assert.match(game.acceptContract(made[3].id), /3 contracts/);
});

test('generated contracts are sized so the aircraft involved can finish them', () => {
  rich();
  for (const d of ['CDG', 'AMS', 'FRA', 'MAD', 'FCO']) { game.openRoute(d); game.buyPlane('heron'); }
  days(1);
  let seen = 0;
  for (let i = 0; i < 400; i++) {
    const c = game.makeContract();
    if (!c) continue;
    seen++;
    assert.ok(c.reward >= 30e3 && c.amount > 0 && c.days >= 8 && c.days <= 14);
    const hub = game.hub(c.hub);
    const km = game.factors(c.hub, c.dest, 1).km;
    const types = AIRCRAFT_LIST.filter((t) => t.cls <= hub.levels.runway && t.range >= km);
    assert.ok(types.length, 'destination is reachable');
    if (c.kind === 'cargo') {
      const r = game.routeTo(c.hub, c.dest);
      const flying = r ? game.planesOn(r.id).map((p) => AIRCRAFT[p.type]) : [types[0]];
      const daily = flying.reduce((n, t) => n + (DAY / ((km / t.speed) * 60 + t.turnaround)) * t.cargo * 0.4, 0);
      assert.ok(c.amount <= Math.max(5, daily * c.days), `cargo job of ${c.amount} t fits ${Math.round(daily * c.days)} t of hold space`);
    } else {
      const t = types[0];
      assert.ok(c.amount <= Math.max(100, (DAY / ((km / t.speed) * 60 + t.turnaround)) * t.seats * c.days * 0.35));
    }
  }
  assert.ok(seen > 50);
});

// Rival strategy, migration and long-run economies are checked in rivals.test.mjs.

// ---------- fuel ----------
test('the fuel price wanders but stays in bounds and near normal on average', () => {
  rich();
  let sum = 0;
  for (let i = 0; i < 2000; i++) { game.stepFuel(); sum += s.fuel; assert.ok(s.fuel >= 0.65 && s.fuel <= 1.6); }
  assert.ok(Math.abs(sum / 2000 - 1) < 0.1);
  assert.ok(s.fuelHist.length <= 60);
});

test('a fuel lock fixes the price for 30 days, spikes included', () => {
  rich();
  const hub = game.activeHub;
  s.fuel = 0.8;
  const cash = s.money;
  assert.equal(game.lockFuel(), null);
  assert.ok(s.money < cash);
  assert.match(game.lockFuel(), /already/);
  const locked = game.flightCost(AIRCRAFT.heron, 1000, hub);
  s.fuel = 1.5;
  s.events.push({ id: 1, type: 'fuelSpike', start: s.day, days: 4, hedged: false });
  assert.equal(game.flightCost(AIRCRAFT.heron, 1000, hub), locked);
  s.day += 30;
  assert.ok(game.flightCost(AIRCRAFT.heron, 1000, hub) > locked * 1.4, 'back on the market price once the lock runs out');
});

test('locking cheap fuel costs more than locking dear fuel', () => {
  rich();
  s.yesterday = { fuel: 100e3 };
  const at = (price) => { s.fuel = price; s.yesterday.fuel = 100e3 * price; return game.fuelLockCost(); };
  const cheap = at(0.7), normal = at(1), dear = at(1.4);
  assert.ok(cheap > normal * 3, `${cheap} vs ${normal}`);
  assert.equal(normal, dear);
  assert.equal(normal, 90e3); // 3% of thirty days at $100k
});

// ---------- diagnosis, fleet care ----------
test('a losing route is explained', () => {
  rich();
  game.openRoute('LUX');
  assert.match(game.diagnose(routeTo('LUX'))[0], /No aircraft/);
  game.buyPlane('albatross');
  days(2);
  const r = routeTo('LUX');
  assert.ok(game.routeProfit(r) < 0);
  assert.match(game.diagnose(r)[0], /too big/i);
  game.openRoute('CDG'); game.buyPlane('kestrel');
  days(2);
  if (game.routeProfit(routeTo('CDG')) >= 0) assert.deepEqual(game.diagnose(routeTo('CDG')), []);
  game.buyPlane('albatross'); game.assign(s.planes[s.planes.length - 1].id, r.id);
  days(2);
  const two = game.diagnose(r)[0];
  assert.match(two, /Too many aircraft: 2 offer about [\d,]+ seats a day but only [\d,]+ people want to fly/);
  assert.match(two, /Without LHR-\d+ they would be about \d+% full|Even one is more than this route needs\. Move LHR-\d+ away/);
});

test('replacing an aircraft resets its age and keeps its route', () => {
  rich();
  game.openRoute('CDG'); game.buyPlane('kestrel', true);
  const p = s.planes[0];
  const cash = s.money, cost = game.replaceCost(p), route = p.routeId, name = p.name;
  assert.ok(cost > 0 && cost < AIRCRAFT.kestrel.price);
  assert.equal(game.replacePlane(p.id), null);
  assert.equal(p.age, 0);
  assert.equal(p.routeId, route);
  assert.equal(p.name, name);
  assert.equal(s.money, cash - cost);
  assert.match(game.replacePlane(p.id), /still new/);
});

test('bulk actions: parked aircraft go to empty routes first, worn ones are overhauled', () => {
  rich();
  game.openRoute('CDG'); game.openRoute('AMS');
  game.buyPlane('kestrel'); game.buyPlane('kestrel'); game.buyPlane('kestrel');
  for (const p of s.planes) game.assign(p.id, null);
  assert.equal(game.assignIdle(), null);
  assert.ok(s.planes.every((p) => p.routeId != null));
  assert.ok(game.planesOn(routeTo('CDG').id).length >= 1 && game.planesOn(routeTo('AMS').id).length >= 1);
  assert.match(game.assignIdle(), /No parked/);
  s.planes[0].age = 400;
  assert.equal(game.risky().length, 1);
  assert.equal(game.overhaulRisky(), null);
  assert.equal(s.planes[0].age, 160);
});

test('older aircraft cost more to keep and break down more', () => {
  rich();
  game.buyPlane('heron');
  const p = s.planes[0];
  const young = [game.planeUpkeep(p), game.breakdownRisk(p), game.planeValue(p)];
  p.age = 300;
  assert.ok(game.planeUpkeep(p) > young[0] && game.breakdownRisk(p) > young[1] && game.planeValue(p) < young[2]);
});

// ---------- operations board ----------
function twoHubs() {
  rich();
  for (const d of ['CDG', 'AMS', 'JFK']) game.openRoute(d);
  game.buyPlane('kestrel'); game.buyPlane('heron'); game.buyPlane('albatross');
  game.buyHub('MAD');
  game.upgrade('runway'); // MAD is active after buying it; level 2 takes regional jets
  game.openRoute('LIS');
  s.active = 'LHR';
  return { cdg: routeTo('CDG'), ams: routeTo('AMS'), jfk: routeTo('JFK'), lis: game.routeTo('MAD', 'LIS') };
}

test('an aircraft can be moved to another route, and rebased to another hub if there is room', () => {
  const { cdg, ams, jfk, lis } = twoHubs();
  const k = s.planes.find((p) => p.type === 'kestrel');
  assert.equal(k.routeId, cdg.id);
  assert.equal(game.movePlane(k.id, ams.id), null);
  assert.equal(k.routeId, ams.id);
  assert.match(game.movePlane(k.id, jfk.id), /range/);
  const big = s.planes.find((p) => p.type === 'albatross');
  assert.match(game.movePlane(big.id, lis.id), /runway is too short/);
  assert.equal(game.movePlane(k.id, lis.id), null, 'Madrid has free gates');
  assert.equal(k.hub, 'MAD');
  assert.equal(k.routeId, lis.id);
  assert.equal(game.planesAt('MAD').length, 1);
  game.atHub('MAD', () => game.buyPlane('sparrow'));
  const h = s.planes.find((p) => p.type === 'heron');
  assert.match(game.movePlane(h.id, lis.id), /No free gate|runway/);
});

test('two aircraft swap routes and hubs, unless one cannot fly the other’s route', () => {
  const { cdg, ams, jfk } = twoHubs();
  const k = s.planes.find((p) => p.type === 'kestrel'), h = s.planes.find((p) => p.type === 'heron'), a = s.planes.find((p) => p.type === 'albatross');
  assert.deepEqual([k.routeId, h.routeId, a.routeId], [cdg.id, ams.id, jfk.id]);
  assert.equal(game.swapPlanes(k.id, h.id), null);
  assert.deepEqual([k.routeId, h.routeId], [ams.id, cdg.id]);
  assert.match(game.swapPlanes(k.id, a.id), /range/);
  assert.deepEqual([k.routeId, a.routeId], [ams.id, jfk.id], 'nothing moved');
  game.assign(h.id, null);
  assert.equal(game.swapPlanes(k.id, h.id), null, 'swapping with a parked aircraft parks the other one');
  assert.equal(k.routeId, null);
  assert.equal(h.routeId, ams.id);
});

test('trading an aircraft in for another type keeps its name and route and charges the difference', () => {
  const { cdg, jfk } = twoHubs();
  const k = s.planes.find((p) => p.type === 'kestrel'), a = s.planes.find((p) => p.type === 'albatross');
  const cash = s.money, cost = game.changeTypeCost(k, 'heron'), name = k.name;
  assert.equal(cost, AIRCRAFT.heron.price - game.planeValue(k));
  assert.equal(game.changeType(k.id, 'heron'), null);
  assert.deepEqual([k.type, k.name, k.routeId, k.age], ['heron', name, cdg.id, 0]);
  assert.equal(s.money, cash - cost);
  assert.match(game.changeType(a.id, 'kestrel'), /Cannot reach JFK/);
  assert.match(game.changeType(a.id, 'albatross'), /already/);
  game.assign(a.id, null);
  const before = s.money;
  assert.equal(game.changeType(a.id, 'sparrow'), null);
  assert.ok(s.money > before, 'trading down pays you the difference');
  days(1);
  assert.ok(cdg.yesterday.flights > 0 && jfk);
});

test('buying for a route works from any screen and suggests a type that fits', () => {
  const { lis, jfk } = twoHubs();
  assert.equal(s.active, 'LHR');
  const n = s.planes.length;
  assert.equal(game.buyFor(lis.id, 'kestrel'), null);
  const p = s.planes[n];
  assert.deepEqual([p.hub, p.routeId], ['MAD', lis.id]);
  assert.equal(s.active, 'LHR', 'the hub on screen is left alone');
  assert.match(game.buyFor(lis.id, 'albatross'), /runway/);
  assert.match(game.buyFor(jfk.id, 'sparrow'), /reach/);
  const fits = game.fitsFor(jfk, 1);
  assert.ok(fits.length >= 1 && fits.every((f) => f.type.range >= jfk.km));
  assert.ok(fits.every((f, i) => i === 0 || fits[i - 1].profit >= f.profit));
  assert.ok(game.seatsPerDay(jfk) > 0 && game.seatsPerDay(lis) > 0);
  const one = game.typeProfit(jfk, AIRCRAFT.albatross, 1), three = game.typeProfit(jfk, AIRCRAFT.albatross, 30);
  assert.ok(three.profit < one.profit && three.load < one.load, 'sharing a route thins each aircraft’s load');
});

test('suggestions name a concrete fix with a gain, and applying one works', () => {
  rich();
  game.openRoute('LUX'); game.openRoute('JFK');
  game.buyPlane('albatross'); // lands on Luxembourg, far too big
  const lux = routeTo('LUX'), jfk = routeTo('JFK');
  days(1);
  const fixes = game.suggest(lux);
  assert.ok(fixes.length >= 1 && fixes.length <= 3);
  assert.ok(fixes.every((f) => f.gain > 0 && ['swap', 'type', 'move', 'park', 'add'].includes(f.kind)));
  const trade = fixes.find((f) => f.kind === 'type');
  assert.match(trade.text, /Trade LHR-\d+ in for a/);
  const empty = game.suggest(jfk);
  assert.equal(empty[0].kind, 'add', 'an unflown route suggests buying');
  game.buyPlane('sparrow'); game.assign(s.planes[1].id, null);
  const withParked = game.suggest(lux);
  assert.ok(withParked.some((f) => f.kind === 'swap'), 'a parked aircraft that fits better is offered as a swap');
  const sw = withParked.find((f) => f.kind === 'swap');
  assert.equal(game.applySuggestion(sw.kind, sw.arg), null);
  assert.equal(game.planesOn(lux.id)[0].type, 'sparrow');
  assert.ok(game.suggest(jfk).every((f) => f.kind === 'move' || f.kind === 'add'), 'an empty route is offered a parked aircraft or a purchase');
});

test('auto-fit proposes a better assignment, changes nothing until applied, and never makes things worse', () => {
  rich();
  for (const d of ['LUX', 'CDG', 'JFK']) game.openRoute(d);
  game.buyPlane('albatross'); game.buyPlane('sparrow'); game.buyPlane('heron');
  const [alb, spa, her] = s.planes;
  game.assign(alb.id, routeTo('LUX').id); game.assign(spa.id, routeTo('CDG').id); game.assign(her.id, routeTo('CDG').id);
  days(1);
  const snapshot = s.planes.map((p) => p.routeId);
  const plan = game.autoFit('LHR');
  assert.deepEqual(s.planes.map((p) => p.routeId), snapshot, 'planning moves nothing');
  assert.ok(plan.gain > 0 && plan.after > plan.before && plan.moves.length >= 1);
  assert.equal(game.applyAutoFit('LHR'), null);
  assert.notEqual(alb.routeId, routeTo('LUX').id, 'the wide-body comes off Luxembourg');
  assert.ok(game.planesOn(routeTo('JFK').id).length >= 1, 'New York gets an aircraft');
  assert.ok(s.planes.every((p) => p.routeId == null || AIRCRAFT[p.type].range >= game.route(p.routeId).km));
  const again = game.autoFit('LHR');
  assert.ok(again.gain < 1000);
  assert.match(game.applyAutoFit('LHR'), /already/);
});

// ---------- reputation ----------
test('reputation stays between 0 and 100 and drifts toward its target', () => {
  rich();
  game.bumpRep(-500); assert.equal(s.rep, 0);
  game.bumpRep(900); assert.equal(s.rep, 100);
  s.rep = 50;
  game.openRoute('CDG'); game.setPrice(routeTo('CDG').id, -0.4);
  const target = game.repTarget();
  assert.ok(target > 50);
  days(3);
  assert.ok(s.rep > 50 && s.rep <= 100);
});

// ---------- company value, goals ----------
test('listing needs a Global Hub and the company value, and pays a tenth of it', () => {
  rich();
  assert.match(game.whyNotList(), /Global Hub/);
  for (const k of Object.keys(UPGRADES)) while (game.upgradeCost(game.activeHub, k) != null) { s.money = 1e9; game.upgrade(k); }
  s.money = 1e6;
  assert.match(game.whyNotList(), /company value/);
  s.money = LISTING_VALUE;
  const cash = s.money;
  assert.equal(game.listCompany(), null);
  assert.ok(s.listed && s.money > cash + LISTING_VALUE * 0.09);
  assert.match(game.listCompany(), /Already/);
  assert.ok(s.achDone.includes('listed'));
});

test('goals pay once, achievements unlock', () => {
  game.newGame('LHR'); s = game.state;
  const cash = s.money;
  game.openRoute('CDG');
  const g = GOALS.find((x) => x.id === 'route1');
  assert.ok(s.goalsDone.includes('route1'));
  assert.equal(s.money, cash - game.openCost(routeTo('CDG').km) + g.reward);
  game.changed();
  assert.equal(s.goalsDone.filter((x) => x === 'route1').length, 1);
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
});

test('every continent has airports', () => {
  const seen = new Set(AIRPORTS.map(continentOf));
  for (const c of CONTINENTS) assert.ok(seen.has(c), c);
  assert.equal(continentOf(AIRPORT_BY_ID.LHR), 'Europe');
  assert.equal(continentOf(AIRPORT_BY_ID.JFK), 'North America');
  assert.equal(continentOf(AIRPORT_BY_ID.GRU), 'South America');
  assert.equal(continentOf(AIRPORT_BY_ID.NBO), 'Africa');
  assert.equal(continentOf(AIRPORT_BY_ID.SIN), 'Asia');
  assert.equal(continentOf(AIRPORT_BY_ID.SYD), 'Oceania');
});

// ---------- difficulty ----------
test('difficulty changes starting cash and what things cost', () => {
  const cash = {}, cost = {}, upkeep = {};
  for (const d of Object.keys(DIFFICULTY)) {
    game.newGame('LHR', 'free', d);
    cash[d] = game.state.money; cost[d] = game.upgradeCost(game.activeHub, 'runway'); upkeep[d] = game.upkeepPerDay();
  }
  assert.ok(cash.easy > cash.normal && cash.normal > cash.hard);
  assert.ok(cost.easy < cost.normal && cost.normal < cost.hard);
  assert.ok(upkeep.easy < upkeep.normal && upkeep.normal < upkeep.hard);
  game.newGame('LHR', 'daily', 'easy');
  assert.equal(game.state.diff, 'normal', 'the daily challenge is the same for everyone');
});

test('upgrades stop at their maximum and get dearer each level', () => {
  rich();
  const hub = game.activeHub;
  for (const k of Object.keys(UPGRADES)) {
    let last = 0;
    while (game.upgradeCost(hub, k) != null) { const c = game.upgradeCost(hub, k); assert.ok(c > last); last = c; s.money = 1e9; game.upgrade(k); }
    assert.equal(hub.levels[k], maxLevel(k));
    assert.match(game.upgrade(k), /Fully/);
  }
});

// ---------- weekly report, news, saves ----------
test('a report is produced every seventh day and announcements are logged', () => {
  rich();
  game.openRoute('CDG'); game.openRoute('LUX'); game.buyPlane('kestrel'); game.buyPlane('albatross');
  let reports = 0;
  game.on('report', () => reports++);
  days(15);
  assert.equal(reports, 2);
  const r = s.report;
  assert.equal(r.day, 14);
  assert.ok(r.prev != null && r.best && r.worst && r.best.v >= r.worst.v);
  assert.ok(s.log.length > 0 && s.log.length <= 60);
  assert.ok(s.log.every((l) => typeof l.text === 'string' && l.day <= s.day));
});

test('a save from before these features loads with sensible defaults', () => {
  rich();
  game.openRoute('CDG'); game.buyPlane('kestrel');
  const old = JSON.parse(JSON.stringify(s));
  for (const k of ['fuel', 'fuelHist', 'fuelLock', 'log', 'achDone', 'streak', 'listed', 'report', 'diff', 'tips', 'rep', 'contracts', 'warsWon']) delete old[k];
  localStorage.setItem('airport-manager-save-v2', JSON.stringify(old));
  assert.equal(game.load(), true);
  s = game.state;
  assert.equal(s.fuel, 1);
  assert.equal(s.diff, 'normal');
  assert.deepEqual([s.log, s.achDone, s.tips, s.contracts], [[], [], [], []]);
  days(8); // and it keeps running
  assert.ok(s.day >= 8 && !s.over);
});

test('time away is caught up without announcements reaching the screen', () => {
  rich();
  game.openRoute('CDG'); game.buyPlane('kestrel');
  let shown = 0;
  game.on('toast', () => shown++);
  s.savedAt = Date.now() - 3 * 3600 * 1000;
  const before = shown;
  const r = game.catchUp();
  assert.ok(r && r.days >= 1 && r.pax > 0);
  assert.equal(shown, before);
});
