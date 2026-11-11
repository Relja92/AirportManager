import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geoDistance } from 'd3-geo';
import { AIRPORT_BY_ID } from '../src/data/airports.js';
import { AIRCRAFT, PLANE_CAP, GOALS } from '../src/data/catalog.js';
import { createRivals, stepRivals, migrateRivals, competition, marketOverlap, routeEconomy, canTakeOver, rivalAt, rivalHubIds } from '../src/rivals.js';

function random(seed = 12345) {
  return () => { let t = seed = (seed + 0x6d2b79f5) | 0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function world(diff = 'normal', home = 'LHR') {
  return { day: 0, diff, hubs: [{ id: home }], routes: [], planes: [], events: [], rivals: [], fuel: 1, rep: 50 };
}
function airline(s, options = {}) {
  const rv = { id: 1, name: 'Test Air', color: '#fff', hub: 'FRA', aiVersion: 2, routes: [{ dest: 'MAD', type: 'kestrel', price: 1 }], next: 1e9, nextHub: 1e9, ...options };
  s.rivals.push(rv); migrateRivals(s); return rv;
}
const distance = (a, b) => { const x = AIRPORT_BY_ID[a], y = AIRPORT_BY_ID[b]; return geoDistance([x.lon, x.lat], [y.lon, y.lat]) * 6371; };
function invariants(s) {
  const hubs = [...s.hubs.map((h) => h.id), ...s.rivals.flatMap(rivalHubIds)];
  assert.equal(new Set(hubs).size, hubs.length, 'hubs never overlap ownership');
  for (const rv of s.rivals) {
    assert.ok(Number.isFinite(rv.cash) && Number.isFinite(rv.profit));
    assert.ok(rv.str >= 0 && rv.str <= 100);
    assert.ok(rv.history.length <= 30);
    const corridors = rv.routes.map((r) => [r.hub, r.dest].sort().join(':'));
    assert.equal(new Set(corridors).size, corridors.length, 'no reverse duplicate routes');
    for (const h of rv.hubs) assert.ok(rv.routes.filter((r) => r.hub === h.id).length <= PLANE_CAP[h.level]);
    for (const r of rv.routes) {
      const h = rv.hubs.find((h) => h.id === r.hub);
      assert.ok(h && h.level >= AIRCRAFT[r.type].cls);
      assert.ok(distance(r.hub, r.dest) <= AIRCRAFT[r.type].range);
      assert.ok(Number.isFinite(r.price) && r.price >= 0.6 && r.price <= 1.6);
    }
  }
}

test('rivals start with distinct hubs and nearby competition across world regions', () => {
  for (const home of ['BEG', 'LHR', 'DEN', 'NBO', 'AKL', 'GRU', 'SIN', 'ANC']) {
    const s = world('hard', home); s.rivals = createRivals(s, random());
    assert.equal(s.rivals.length, 6);
    assert.ok(s.rivals.filter((r) => distance(r.hub, home) < 4500).length >= 2, home);
    assert.ok(s.rivals.every((r) => r.routes.length > 0 && r.cash < 8e6), 'initial fleet is paid for');
    invariants(s);
  }
});

test('old saves migrate origins, range and working cash once; closed airlines stay closed', () => {
  const s = world();
  s.rivals = [{ id: 1, hub: 'LHR', str: 1, routes: [{ dest: 'JFK', price: 0.9, war: 15 }] }, { id: 2, hub: null, routes: [], back: 30 }];
  migrateRivals(s);
  const rv = s.rivals[0];
  assert.equal(rv.routes[0].hub, 'LHR');
  assert.ok(AIRCRAFT[rv.routes[0].type].range >= distance('LHR', 'JFK'));
  assert.equal(rv.routes[0].war, undefined);
  assert.ok(rv.cash > 0 && rv.str > 25);
  rv.cash = 123456; rv.hubs.push({ id: 'FRA', level: 2 });
  rv.routes.push({ hub: 'FRA', dest: 'MAD', type: 'kestrel', price: 1, age: 30, lossDays: 3 });
  const saved = JSON.parse(JSON.stringify(s)); migrateRivals(saved);
  assert.deepEqual(saved, s, 'reloading preserves cash, hubs, aircraft and plans');
  assert.equal(saved.rivals[1].hub, null); assert.equal(saved.rivals[1].back, 30);
});

test('competition distinguishes direct, nearby and unrelated origin markets in both directions', () => {
  assert.equal(marketOverlap('LHR', 'CDG', 'CDG', 'LHR'), 1);
  assert.ok(marketOverlap('LHR', 'CDG', 'FRA', 'CDG') > 0);
  assert.equal(marketOverlap('LHR', 'CDG', 'SYD', 'CDG'), 0);
  const s = world(); const rv = airline(s, { hub: 'SYD', routes: [{ dest: 'CDG', type: 'condor', price: 1 }] });
  assert.equal(competition(s, 'LHR', 'CDG', 1).share, 1);
  rv.hub = 'FRA'; rv.hubs = [{ id: 'FRA', level: 2 }]; rv.routes = [{ hub: 'FRA', dest: 'CDG', type: 'kestrel', price: 1 }];
  const plain = competition(s, 'LHR', 'CDG', 1).share;
  assert.ok(plain < 1 && competition(s, 'LHR', 'CDG', 1.3).share < plain);
  s.rep = 95; assert.ok(competition(s, 'LHR', 'CDG', 1).share > plain);
  s.rep = 50; rv.routes[0].war = 10;
  assert.ok(competition(s, 'LHR', 'CDG', 1).share < plain);
});

test('empty player routes do not damage a rival; real capacity in an overlapping market does', () => {
  const s = world(), rv = airline(s), rr = rv.routes[0];
  const untouched = routeEconomy(s, rv, rr).profit;
  s.routes.push({ id: 1, hub: 'LHR', dest: 'MAD', price: 0.6, yesterday: { pax: 800 } });
  assert.equal(routeEconomy(s, rv, rr).profit, untouched);
  s.planes.push({ routeId: 1, type: 'heron', phase: 'home' });
  assert.ok(routeEconomy(s, rv, rr).profit < untouched);
  s.routes[0].hub = 'SYD'; assert.equal(routeEconomy(s, rv, rr).profit, untouched);
});

test('daily planning snapshots refresh after player capacity, fare and closure changes',()=>{
  const s=world('hard'),rv=airline(s),rr=rv.routes[0];
  s.routes=[{id:100,hub:'LHR',dest:'MAD',price:.7,service:'frequent',yesterday:{pax:1200}}];
  s.planes=[{routeId:100,type:'heron',phase:'home'}];
  const run=()=>{s.day++;const expected=routeEconomy(s,rv,rr);stepRivals(s,random());assert.equal(rr.profit,expected.profit);assert.equal(rr.pax,expected.pax);};
  run();s.planes[0].phase='repair';run();s.planes[0].phase='home';s.routes[0].price=1.4;run();
  s.events=[{type:'storm',airport:'FRA',start:s.day,days:3}];run();assert.equal(rr.pax,0);
  s.events=[];s.planes=[];run();assert.ok(rr.pax>0);
});

test('rival market quotes remain live after a planning turn ends',()=>{
  const s=world('hard'),rv=airline(s),rr=rv.routes[0];s.day=1;stepRivals(s,random());
  const other=airline(s,{id:2,hub:'AMS',hubs:[{id:'AMS',level:2}],routes:[{hub:'AMS',dest:'MAD',type:'kestrel',price:1,service:'balanced'}]});
  const before=routeEconomy(s,rv,rr).profit;other.routes[0].price=.6;other.routes[0].service='frequent';
  assert.ok(routeEconomy(s,rv,rr).profit<before);other.routes=[];assert.ok(routeEconomy(s,rv,rr).profit>before);
});

test('daily accounts reconcile to cash and a single negative route is supported by reserves', () => {
  const s = world(), rv = airline(s, { cash: 10e6 });
  const cash = rv.cash; s.day = 1; stepRivals(s, random());
  assert.equal(rv.cash, cash + rv.profit);
  assert.equal(rv.pax, rv.routes.reduce((n, r) => n + r.pax, 0));
  assert.ok(rv.cost > rv.routes[0].cost, 'airport upkeep is charged too');
  assert.ok(rv.profit > 0);
  rv.str = 1; s.day++; stepRivals(s, random());
  assert.ok(rv.hub && rv.str > 25, 'a low legacy strength score cannot kill a viable business');
});

test('a closure removes flying revenue but still charges aircraft and airport upkeep', () => {
  const s = world(), rv = airline(s), cash = rv.cash;
  s.events.push({ type: 'storm', airport: 'FRA', start: 0, days: 3 });
  s.day = 1; stepRivals(s, random());
  assert.equal(rv.pax, 0); assert.ok(rv.profit < 0 && rv.cash < cash);
  assert.equal(rv.routes.length, 1, 'temporary weather does not discard a sound route');
  s.day = 4; stepRivals(s, random()); assert.ok(rv.profit > 0 && rv.hub);
});

test('player fuel locks and event hedges never subsidize rival operating costs', () => {
  const s = world(), rv = airline(s), rr = rv.routes[0];
  s.fuel = 1.5; const normal = routeEconomy(s, rv, rr).cost;
  s.fuelLock = { price: 0.65, until: 30 }; assert.equal(routeEconomy(s, rv, rr).cost, normal);
  s.events.push({ type: 'fuelSpike', hedged: true, start: 0, days: 5 });
  assert.ok(routeEconomy(s, rv, rr).cost > normal);
});

test('expansion never spends a reserve it cannot afford and maintenance is paid', () => {
  const s = world('hard'), rv = airline(s, { cash: 1, next: 0 });
  s.day = 1; stepRivals(s, random());
  assert.equal(rv.routes.length, 1); assert.equal(rv.hubs.length, 1);
  rv.cash = 10e6; rv.next = 0; rv.routes[0].age = 150;
  const cash = rv.cash; s.day++; stepRivals(s, random());
  assert.ok(rv.routes[0].age < 100);
  assert.ok(rv.cash < cash + rv.profit - AIRCRAFT.kestrel.price * 0.17);
});

test('a loss-making route is sold and its proceeds can support a profitable recovery', () => {
  const s = world('hard'), rv = airline(s, { cash: 2e6, next: 0, hubs: [{ id: 'FRA', level: 5 }], routes: [
    { hub: 'FRA', dest: 'LUX', type: 'condor', price: 0.6, lossDays: 20, avgProfit: -100e3 },
    { hub: 'FRA', dest: 'MAD', type: 'kestrel', price: 1, lossDays: 0 },
  ] });
  const lost = rv.routes[0]; s.day = 20;
  const news = stepRivals(s, random());
  assert.ok(!rv.routes.includes(lost)); assert.ok(rv.cash > 2e6);
  assert.ok(news.some((n) => /Withdrew/.test(n.text)));
  rv.next = 1e9;
  for (let i = 0; i < 10; i++) { s.day++; stepRivals(s, random()); }
  assert.ok(rv.hub && rv.cash > 0);
});

test('profitable price wars can become permanent even when the player matches the fare', () => {
  const s = world(), rv = airline(s, { cash: 20e6, history: [100e3], profit: 100e3 });
  const rr = rv.routes[0]; rr.war = 12; rr.price = 0.8; rr.avgProfit = 100e3;
  s.routes.push({ id: 1, hub: 'LHR', dest: 'MAD', price: 0.8 });
  s.planes.push({ routeId: 1, type: 'sparrow', phase: 'home' }); s.rep = 90;
  s.day = 12; const news = stepRivals(s, random());
  assert.ok(rv.routes.includes(rr)); assert.equal(rr.war, undefined);
  assert.equal(s.warsWon || 0, 0); assert.ok(news.some((n) => /Kept.*price war/.test(n.text)));
});

test('a funded challenger buys capacity for a price war; it cannot attack before day 15', () => {
  for (const day of [10, 20]) {
    const s = world('hard'), rv = airline(s, { cash: 20e6, next: 0 });
    s.routes.push({ id: 1, hub: 'LHR', dest: 'CDG', price: 1.2, hot: 8 });
    s.planes.push({ routeId: 1, type: 'heron', phase: 'home' });
    s.day = day; const cash = rv.cash, news = stepRivals(s, () => 0);
    const war = rv.routes.find((r) => r.war != null);
    if (day < 15) assert.equal(war, undefined);
    else {
      assert.equal(war.war, 32); assert.equal(war.price, 0.8);
      assert.ok(rv.cash < cash + rv.profit - AIRCRAFT[war.type].price);
      assert.ok(news.some((n) => /Price war/.test(n.text)));
    }
  }
});

test('unsustainable price wars end with a withdrawal and a recorded player win', () => {
  const s = world(), rv = airline(s, { cash: 300e3, history: [-200e3], routes: [{ dest: 'LUX', type: 'condor', price: 0.8, war: 12, avgProfit: -200e3 }] });
  const rr = rv.routes[0]; s.day = 12;
  const news = stepRivals(s, random());
  assert.ok(!rv.routes.includes(rr)); assert.equal(s.warsWon, 1);
  assert.ok(news.some((n) => /price war was not sustainable/.test(n.text)));
});

test('a takeover requires sustained financial distress; bankruptcy requires ten cash-negative days', () => {
  const s = world(), rv = airline(s, { cash: -1e6, routes: [] });
  rv.str = 1; assert.equal(canTakeOver(rv), false);
  for (let day = 1; day <= 9; day++) { s.day = day; stepRivals(s, random()); assert.ok(rv.hub); }
  assert.equal(canTakeOver(rv), true);
  s.day = 10; const news = stepRivals(s, random());
  assert.equal(rv.hub, null); assert.deepEqual(rv.hubs, []); assert.equal(s.rivalsDown, 1);
  assert.ok(news.some((n) => /sustained cash losses/.test(n.text)));
  s.day = rv.back; stepRivals(s, random());
  assert.ok(rv.hub && rv.cash > 0 && rv.routes.length > 0); assert.notEqual(rv.name, 'Test Air');
});

test('a profitable airline can recover from negative cash before bankruptcy', () => {
  const s = world(), rv = airline(s, { cash: -10000, negativeDays: 8 });
  s.day = 1; stepRivals(s, random());
  assert.ok(rv.hub && rv.cash > 0); assert.equal(rv.negativeDays, 0); assert.equal(canTakeOver(rv), false);
});

test('multi-hub ownership, paid growth and survivability hold across 360-day seeded games', () => {
  const totals = {};
  for (const diff of ['easy', 'normal', 'hard']) {
    const s = world(diff), rand = random(); s.rivals = createRivals(s, rand);
    for (let day = 1; day <= 360; day++) { s.day = day; stepRivals(s, rand); if (day % 30 === 0) invariants(s); }
    assert.ok(s.rivals.filter((rv) => rv.hub).length >= 4);
    assert.ok(s.rivals.filter((rv) => rv.hubs.length >= 2).length >= 3);
    assert.ok(s.rivals.some((rv) => rv.routes.length > 14));
    totals[diff] = s.rivals.reduce((n, rv) => n + rv.routes.length, 0);
  }
  assert.ok(totals.hard > totals.normal && totals.normal > totals.easy);
});

test('new hub ownership is respected, including every secondary hub', () => {
  const s = world(), rv = airline(s, { hubs: [{ id: 'FRA', level: 2 }, { id: 'JFK', level: 3 }] });
  assert.equal(rivalAt(s, 'JFK'), rv); assert.deepEqual(rivalHubIds(rv), ['FRA', 'JFK']);
});

test('save/load keeps the same economic trajectory and does not regenerate working cash', () => {
  const s = world('hard'), rand = random(); s.rivals = createRivals(s, rand);
  for (let day = 1; day <= 60; day++) { s.day = day; stepRivals(s, rand); }
  const copy = JSON.parse(JSON.stringify(s)); migrateRivals(copy);
  const a = random(992), b = random(992);
  for (let day = 61; day <= 90; day++) { s.day = copy.day = day; stepRivals(s, a); stepRivals(copy, b); }
  assert.deepEqual(copy, s);
});

test('buying a distressed airline transfers every hub and flyable aircraft without duplicate links', async () => {
  const store = {};
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
  const { game } = await import('../src/game.js');
  game.newGame('LHR'); game.silent = true;
  const s = game.state; s.money = 200e6; s.rivals = [];
  const rv = airline(s, { cash: -100e3, cost: 100e3, lossDays: 8, hubs: [{ id: 'FRA', level: 3 }, { id: 'JFK', level: 4 }], routes: [
    { hub: 'FRA', dest: 'MAD', type: 'kestrel', price: 0.9, age: 44 },
    { hub: 'JFK', dest: 'FRA', type: 'albatross', price: 1, age: 20 },
  ] }); rv.str = 15;
  assert.match(game.whyNotHub('JFK'), /based here/);
  const cash = s.money, quote = game.takeoverCost(rv), done = new Set(s.goalsDone);
  assert.equal(game.takeover(rv.id), null);
  assert.ok(game.isHub('JFK') && game.isHub('FRA')); assert.equal(rv.hub, null);
  assert.equal(s.planes.length, 2);
  const rewards = GOALS.filter((g) => s.goalsDone.includes(g.id) && !done.has(g.id)).reduce((n, g) => n + g.reward, 0);
  assert.equal(s.money, cash - quote + rewards);
  assert.equal(game.routeTo('FRA', 'MAD').price, 0.9);
  assert.ok(s.planes.every((p) => game.route(p.routeId) && p.hub === game.route(p.routeId).hub));
  for (let i = 0; i < 100; i++) game.tick(5);
  assert.ok(s.planes.every((p) => Number.isFinite(p.t) && Number.isFinite(p.profit)));
  assert.match(game.takeover(rv.id), /gone/);
  game.silent = false;
});

test('a reverse player link parks the acquired aircraft at its original hub instead of losing it', async () => {
  const { game } = await import('../src/game.js');
  game.newGame('LHR'); game.silent = true;
  const s = game.state; s.money = 200e6; s.rivals = [];
  const existing = game.addRoute('LHR', 'FRA');
  const rv = airline(s, { cash: -1e6, cost: 100e3, lossDays: 8, hubs: [{ id: 'FRA', level: 3 }], routes: [{ hub: 'FRA', dest: 'LHR', type: 'heron', price: 1, age: 77 }] });
  rv.str = 15;
  assert.equal(game.takeover(rv.id), null);
  assert.equal(s.routes.length, 1); assert.equal(s.routes[0], existing);
  assert.equal(s.planes.length, 1); assert.equal(s.planes[0].hub, 'FRA');
  assert.equal(s.planes[0].routeId, null); assert.equal(s.planes[0].phase, 'idle'); assert.equal(s.planes[0].age, 77);
  game.silent = false;
});

test('loading a three-rival save introduces the missing airlines without refilling existing reserves', async () => {
  const { game } = await import('../src/game.js');
  game.newGame('LHR'); game.silent = true;
  const s = game.state; s.rivals = s.rivals.slice(0, 3); s.rivals[0].cash = 123456;
  game.save(); assert.equal(game.load(), true);
  const loaded = game.state;
  assert.equal(loaded.rivals.length, 6); assert.equal(loaded.rivals[0].cash, 123456);
  assert.ok(loaded.rivals.slice(3).every((r) => !r.hub && r.back > loaded.day));
  for (let day = 1; day <= 30; day++) { loaded.day = day; stepRivals(loaded, random(day)); }
  assert.ok(loaded.rivals.slice(3).every((r) => r.hub && r.routes.length));
  game.silent = false;
});
