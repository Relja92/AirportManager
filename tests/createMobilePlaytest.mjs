// Browser QA fixture: use a separate development port to isolate the real save.
// Run node tests/createMobilePlaytest.mjs, then open /reports/mobile-shell-pass/playtest.html.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { game } = await import('../src/game.js');
const { UPGRADES, maxLevel } = await import('../src/data/catalog.js');
game.newGame('LHR'); game.silent = true;
const s = game.state;
s.hubs[0].levels = Object.fromEntries(Object.keys(UPGRADES).map(key => [key, maxLevel(key)]));
s.money = 50e6; s.rivals = []; s.events = []; s.eventsUntil = 1e9; s.rng = 12345;
for (const dest of ['CDG', 'AMS', 'FCO', 'MAD', 'DUB', 'ATH']) {
  const route = game.addRoute('LHR', dest);
  const p = game.createPlane('heron', false, 'LHR');
  game.assign(p.id, route.id, true);
}
while (s.day < 2) game.tick(5);
const parked = game.createPlane('sparrow', false, 'LHR');
parked.name = 'Mobile test parked';
const worn = s.planes[1]; worn.age = 300;
s.planes[2].phase = 'repair'; s.planes[2].t = 200; s.planes[2].resume = 'home';
s.contracts = [{ id:s.nextId++,hub:'LHR',dest:'CDG',kind:'pax',amount:3000,done:1800,due:s.day+2,days:8,reward:200000,what:'conference delegates' }];
s.tips = ['contract','losing','war','rivalWeak','worn','fuelHigh','fuelLow','rep','hub2','value'];
s.speed = 0; s.active = 'LHR'; s.savedAt = Date.now(); s.over = null;
const directory = new URL('../reports/mobile-shell-pass/', import.meta.url);
await mkdir(directory, {recursive:true});
await writeFile(new URL('playtest-state.json', directory), JSON.stringify(s));
const html = (await readFile(new URL('../index.html', import.meta.url), 'utf8')).replace('<script type="module" src="/src/main.js"></script>',
  `<script type="module">const state=await(await fetch('./playtest-state.json')).json();state.savedAt=Date.now();localStorage.setItem('airport-manager-save-v2',JSON.stringify(state));localStorage.setItem('airport-manager-weekly-off','1');localStorage.setItem('airport-manager-tutorial-seen','1');await import('/src/main.js');</script>`);
await writeFile(new URL('playtest.html', directory), html);
console.log(`Prepared ${s.routes.length} routes and ${s.planes.length} aircraft, including parked, worn and repairing aircraft.`);
