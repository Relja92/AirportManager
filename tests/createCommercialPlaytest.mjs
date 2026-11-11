// Disposable fixture on a separate origin; never loads the user's saved airline.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const store = {};
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
const { game } = await import('../src/game.js');
const { GOALS, ACHIEVEMENTS } = await import('../src/data/catalog.js');
game.silent = true; game.newGame('LHR', 'free', 'hard');
const s = game.state; s.rng = 12345; s.money = 4e6; s.tut = null; s.speed = 0;
s.hubs[0].levels = { runway: 4, terminal: 4, gates: 4, amenities: 1, fuel: 1, cargo: 1, marketing: 1 };
s.goalsDone = GOALS.map((x) => x.id); s.achDone = ACHIEVEMENTS.map((x) => x.id);
s.tips = ['contract', 'losing', 'war', 'rivalWeak', 'worn', 'fuelHigh', 'fuelLow', 'rep', 'hub2', 'value'];
const paris = game.addRoute('LHR', 'CDG'), madrid = game.addRoute('LHR', 'MAD');
const own = game.createPlane('heron', false, 'LHR'); game.assign(own.id, paris.id, true);
game.leasePlane('sparrow', 'LHR', 7, madrid.id);
const hired = s.planes.at(-1); hired.lease.start -= 5 * 1440; hired.lease.end -= 5 * 1440;
s.clients.horizon = { trust: 2, completed: 2, missed: 0, available: 0, lastJob: { hub: 'LHR', dest: 'CDG', kind: 'pax', what: 'holiday guests', amount: 200, days: 5, reward: 50000 } };
s.contracts = [{ id: s.nextId++, clientId: 'medair', kind: 'cargo', what: 'medical supplies', hub: 'LHR', dest: 'MAD', amount: 12, days: 7, reward: 80000, expires: 4, due: null, done: 0 }];
s.savedAt = Date.now(); s.report = null; s.over = null;
const directory = new URL('../reports/commercial-pass/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('playtest-state.json', directory), JSON.stringify(s));
const html = (await readFile(new URL('../index.html', import.meta.url), 'utf8')).replace('<script type="module" src="/src/main.js"></script>',
  `<script type="module">const state = await (await fetch('./playtest-state.json')).json(); state.savedAt = Date.now(); localStorage.setItem('airport-manager-save-v2', JSON.stringify(state)); localStorage.setItem('airport-manager-tutorial-seen', '1'); localStorage.setItem('airport-manager-weekly-off', '1'); await import('/src/main.js');</script>`);
await writeFile(new URL('playtest.html', directory), html);
console.log('Prepared isolated commercial playtest.');
