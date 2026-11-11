// Disposable, isolated browser fixture. Run: node tests/createPlaytest.mjs
// Open /reports/ui-usability-pass/playtest.html on a separate development port.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const store = {};
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
const { game, distKm } = await import('../src/game.js');
const { AIRPORTS, AIRPORT_BY_ID } = await import('../src/data/airports.js');
const { UPGRADES, maxLevel } = await import('../src/data/catalog.js');
const { applyAircraftPlan } = await import('../src/aircraftManagement.js');

game.newGame('LHR'); game.silent = true;
const s = game.state;
s.hubs = ['LHR', 'JFK', 'HND'].map((id) => ({ id, levels: Object.fromEntries(Object.keys(UPGRADES).map((key) => [key, maxLevel(key)])) }));
s.rivals = []; s.events = []; s.eventsUntil = 1e9; s.money = 500e6;
s.day = 0; s.minute = 360; s.rng = 12345;
for (const hub of s.hubs) {
  const destinations = AIRPORTS.filter((a) => !s.hubs.some((h) => h.id === a.id) && distKm(AIRPORT_BY_ID[hub.id], a) < 6000)
    .sort((a, b) => b.size - a.size || a.city.localeCompare(b.city)).slice(0, 12);
  for (const a of destinations) {
    const r = game.addRoute(hub.id, a.id);
    for (let n = 0; n < 2; n++) {
      const p = game.createPlane('heron', n === 1, hub.id);
      game.assign(p.id, r.id, true);
    }
  }
}
while (s.day < 2) game.tick(5);
const worn = s.planes.find((p) => p.hub === 'LHR' && p.age >= 150);
applyAircraftPlan(game, { kind: 'overhaul', id: worn.id }, game._rev);
game.setPrice(game.routesAt('JFK')[0].id, .1);
const nr = game.routesAt('HND');
applyAircraftPlan(game, { kind: 'move', id: game.planesOn(nr[0].id)[0].id, target: nr[1].id }, game._rev);
while (s.day < 6) game.tick(5);
const lr = game.routesAt('LHR');
game.setPrice(lr[5].id, -.1);
game.setPrice(lr[6].id, .1);
applyAircraftPlan(game, { kind: 'move', id: game.planesOn(lr[6].id)[0].id, target: lr[7].id }, game._rev);
for (const p of [...game.planesOn(lr[10].id)]) game.assign(p.id, null, true);
const repair = game.planesOn(lr[8].id)[0]; repair.phase = 'repair'; repair.t = 200; repair.resume = 'home';
s.contracts = [{ id: s.nextId++, hub: 'LHR', dest: lr[5].dest, kind: 'pax', amount: 3000, done: 2300, due: s.day + 1, days: 8, reward: 200000, what: 'conference delegates' }];
s.tut = null; s.tips = ['contract', 'losing', 'war', 'rivalWeak', 'worn', 'fuelHigh', 'fuelLow', 'rep', 'hub2', 'value'];
s.speed = 0; s.active = 'LHR'; s.savedAt = Date.now(); s.over = null;
const directory = new URL('../reports/ui-usability-pass/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('playtest-state.json', directory), JSON.stringify(s));
const html = (await readFile(new URL('../index.html', import.meta.url), 'utf8')).replace('<script type="module" src="/src/main.js"></script>',
  `<script type="module">const state = await (await fetch('./playtest-state.json')).json(); state.savedAt = Date.now(); localStorage.setItem('airport-manager-save-v2', JSON.stringify(state)); localStorage.setItem('airport-manager-weekly-off', '1'); await import('/src/main.js');</script>`);
await writeFile(new URL('playtest.html', directory), html);
console.log(`Prepared ${s.hubs.length} hubs, ${s.routes.length} routes, ${s.planes.length} aircraft and ${s.managementChanges.length} comparisons.`);
