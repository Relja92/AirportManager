// Isolated browser fixture; serve on a separate port from the user's game.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const store = {};
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
const { game } = await import('../src/game.js');
const { createRivals } = await import('../src/rivals.js');
game.silent = true; game.newGame('LHR', 'free', 'hard');
const s = game.state; s.rng = 12345; s.money = 200e6; s.tut = null;
s.rivals = createRivals(s, () => game.rand());
s.hubs[0].levels = { runway: 4, terminal: 4, gates: 4, amenities: 2, fuel: 2, cargo: 1, marketing: 2 };
for (const dest of ['CDG', 'MAD', 'FCO', 'JFK', 'DXB']) {
  const r = game.addRoute('LHR', dest), p = game.createPlane(r.km > 6200 ? 'albatross' : 'heron', false, 'LHR');
  game.assign(p.id, r.id, true);
}
while (s.day < 110) {
  game.tick(30);
  if(s.day>=35 && s.rivals.some(r=>r.routes.some(x=>x.lease)) && new Set(s.rivals.flatMap(r=>r.hubs.map(h=>h.specialization || 'general'))).size>=4) break;
}
const leased=s.rivals.find(r=>r.routes.some(x=>x.lease));
if(leased) s.rivals=[leased,...s.rivals.filter(r=>r!==leased)];
s.events=[];s.eventsUntil=1e9;s.logSeen=s.logN;s.speed = 0; s.savedAt = Date.now(); s.report = null; s.over = null;
const directory = new URL('../reports/ai-integration-pass/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('playtest-state.json', directory), JSON.stringify(s));
const distressed = JSON.parse(JSON.stringify(s));
Object.assign(distressed.rivals[0], { cash: -1e6, profit: -200e3, history: [-300e3, -270e3, -240e3, -200e3], lossDays: 8, negativeDays: 4, str: 12 });
await writeFile(new URL('distressed-state.json', directory), JSON.stringify(distressed));
const html = (await readFile(new URL('../index.html', import.meta.url), 'utf8')).replace('<script type="module" src="/src/main.js"></script>',
  `<script type="module">const file = location.search.includes('distressed') ? 'distressed-state.json' : 'playtest-state.json'; const state = await (await fetch('./' + file)).json(); state.savedAt = Date.now(); localStorage.setItem('airport-manager-save-v2', JSON.stringify(state)); localStorage.setItem('airport-manager-tutorial-seen', '1'); localStorage.setItem('airport-manager-weekly-off', '1'); await import('/src/main.js');</script>`);
await writeFile(new URL('playtest.html', directory), html);
console.log(`Prepared day ${s.day}, rivals with ${s.rivals.map((r) => r.hubs.length).join('/')} hubs.`);
