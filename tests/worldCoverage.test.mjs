// Connect-the-world mission: what counts as served, milestones, and the continent bonus.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AIRPORTS, CONTINENTS, continentOf } from '../src/data/airports.js';
import { GOALS, ACHIEVEMENTS } from '../src/data/catalog.js';
import { WORLD_TOTAL, WORLD_MILESTONES, CONTINENT_BONUS, servedIds, worldProgress, milestoneName } from '../src/worldCoverage.js';

const store = {};
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
const { game } = await import('../src/game.js');
let s;
const link = (dest, hub = 'LHR') => game.addRoute(hub, dest);
const others = (n, skip = []) => AIRPORTS.filter((a) => a.id !== 'LHR' && !skip.includes(a.id)).slice(0, n).map((a) => a.id);

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  game.silent = true;
  game.newGame('LHR'); s = game.state;
  s.rivals = []; s.rng = 12345; s.events = []; s.eventsUntil = 1e9; s.contracts = [];
  s.goalsDone = GOALS.map((g) => g.id); s.achDone = ACHIEVEMENTS.map((a) => a.id);
});

test('milestones climb to the whole map and every airport belongs to a continent', () => {
  assert.equal(WORLD_TOTAL, AIRPORTS.length);
  assert.equal(WORLD_MILESTONES[WORLD_MILESTONES.length - 1].n, WORLD_TOTAL);
  for (let i = 1; i < WORLD_MILESTONES.length; i++) {
    assert.ok(WORLD_MILESTONES[i].n > WORLD_MILESTONES[i - 1].n && WORLD_MILESTONES[i].reward > WORLD_MILESTONES[i - 1].reward);
  }
  assert.ok(AIRPORTS.every((a) => CONTINENTS.includes(continentOf(a))));
  assert.match(milestoneName(WORLD_MILESTONES[0]), /Serve 25 airports/);
  assert.match(milestoneName(WORLD_MILESTONES[WORLD_MILESTONES.length - 1]), /every airport/);
});

test('a new airline serves only its own hub', () => {
  const w = game.worldProgress();
  assert.equal(w.served, 1);
  assert.equal(w.total, WORLD_TOTAL);
  assert.ok(game.isServed('LHR') && !game.isServed('CDG'));
  assert.equal(w.continents.reduce((n, c) => n + c.total, 0), WORLD_TOTAL);
  assert.equal(w.continents.find((c) => c.name === 'Europe').served, 1);
  assert.equal(w.next.n, 25);
  assert.equal(w.bonus, 1);
});

test('hubs and route ends count once each, from any hub', () => {
  link('CDG'); link('AMS');
  assert.equal(game.worldProgress().served, 3);
  s.hubs.push({ ...JSON.parse(JSON.stringify(s.hubs[0])), id: 'MAD' });
  game._rev++;
  assert.equal(game.worldProgress().served, 4, 'a second hub counts');
  link('CDG', 'MAD');
  assert.equal(game.worldProgress().served, 4, 'the same city from two hubs counts once');
  link('LIS', 'MAD');
  assert.equal(game.worldProgress().served, 5);
  assert.deepEqual([...servedIds(s)].sort(), ['AMS', 'CDG', 'LHR', 'LIS', 'MAD']);
});

test('closing a route takes its airport off the network again', () => {
  const r = link('CDG');
  assert.ok(game.isServed('CDG'));
  game.closeRoute(r.id);
  assert.ok(!game.isServed('CDG'));
  assert.equal(game.worldProgress().served, 1);
});

test('a milestone pays once when reached and is not taken back', () => {
  for (const id of others(23)) link(id);
  const cash = s.money;
  game.checkGoals();
  assert.equal(s.money, cash, '24 airports is not 25');
  assert.deepEqual(s.worldDone, []);
  const last = link(others(24)[23]);
  game.checkGoals();
  assert.equal(s.money, cash + WORLD_MILESTONES[0].reward);
  assert.deepEqual(s.worldDone, [25]);
  game.checkGoals(); game.checkGoals();
  assert.equal(s.money, cash + WORLD_MILESTONES[0].reward, 'no second payment');
  game.closeRoute(last.id);
  game.checkGoals();
  assert.deepEqual(s.worldDone, [25]);
  link(others(24)[23]);
  game.checkGoals();
  assert.equal(s.money, cash + WORLD_MILESTONES[0].reward, 'reaching it again pays nothing');
  assert.equal(game.worldProgress().next.n, 50);
});

test('several milestones can land at once, and the whole map pays the last one', () => {
  const cash = s.money;
  for (const a of AIRPORTS) if (a.id !== 'LHR') link(a.id);
  game.checkGoals();
  const w = game.worldProgress();
  assert.equal(w.served, WORLD_TOTAL);
  assert.equal(w.next, null);
  assert.equal(w.full, CONTINENTS.length);
  assert.deepEqual(s.worldDone, WORLD_MILESTONES.map((m) => m.n));
  assert.equal(s.money, cash + WORLD_MILESTONES.reduce((n, m) => n + m.reward, 0));
});

test('covering a whole continent lifts demand on every route; one airport short does not', () => {
  link('CDG');
  const before = game.factors('LHR', 'CDG', 1);
  assert.equal(before.world, 1);
  const oceania = AIRPORTS.filter((a) => continentOf(a) === 'Oceania').map((a) => a.id);
  for (const id of oceania.slice(1)) link(id);
  assert.equal(game.worldProgress().full, 0);
  assert.equal(game.factors('LHR', 'CDG', 1).world, 1);
  link(oceania[0]);
  const w = game.worldProgress();
  assert.ok(w.continents.find((c) => c.name === 'Oceania').full);
  assert.equal(w.bonus, 1 + CONTINENT_BONUS);
  assert.equal(game.factors('LHR', 'CDG', 1).world, 1 + CONTINENT_BONUS);
});

test('working out progress changes nothing, and an older save gets an empty record', () => {
  link('CDG');
  const snapshot = JSON.stringify(s);
  worldProgress(s); game.worldProgress(); game.isServed('CDG');
  assert.equal(JSON.stringify(s), snapshot);
  const old = JSON.parse(snapshot);
  delete old.worldDone;
  localStorage.setItem('airport-manager-save-v2', JSON.stringify(old));
  assert.equal(game.load(), true);
  assert.deepEqual(game.state.worldDone, []);
  assert.equal(game.worldProgress().served, 2);
});

test('the Connect the World start option is won only when every airport is served', () => {
  game.newGame('LHR', 'world'); s = game.state; s.rivals = [];
  assert.equal(game.scenario().id, 'world');
  for (const a of AIRPORTS.slice(0, -1)) if (a.id !== 'LHR') link(a.id);
  game.checkScenario(true);
  assert.equal(s.over, null, 'one airport short, and no deadline to fail');
  const last = AIRPORTS[AIRPORTS.length - 1].id;
  if (last !== 'LHR') link(last);
  game.checkScenario(false);
  assert.equal(s.over.type, 'won');
});
