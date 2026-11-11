// Disposable fixture. Serve on its own port, separate from the player's save.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { game } from '../src/game.js';
import { GOALS, ACHIEVEMENTS } from '../src/data/catalog.js';
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};game.silent=true;
const directory=new URL('../reports/specialization-pass/',import.meta.url);await mkdir(directory,{recursive:true});
game.newGame('LHR');game.state.speed=0;game.state.tut=null;
await writeFile(new URL('locked-state.json',directory),JSON.stringify(game.state));
game.newGame('LHR');const s=game.state;s.rng=2345;s.money=7.5e6;s.speed=0;s.tut=null;s.events=[];
s.hubs[0].levels={runway:3,terminal:3,gates:3,amenities:2,cargo:2,fuel:1,marketing:1};
s.hubs.push({id:'FRA',levels:{...s.hubs[0].levels},specialization:'cargo',specializationUntil:14});
s.goalsDone=GOALS.map(g=>g.id);s.achDone=ACHIEVEMENTS.map(a=>a.id);s.tips=['contract','losing','war','rivalWeak','worn','fuelHigh','fuelLow','rep','hub2','value'];
for(const [i,dest] of ['CDG','AMS','MAD','FCO'].entries()) {const r=game.addRoute('LHR',dest);r.price=i<2?.9:1.1;r.cabin=i<2?0:1;r.service=i%2?'frequent':'balanced';game.assign(game.createPlane('kestrel',false,'LHR').id,r.id,true);}
const r=game.addRoute('FRA','IST');game.assign(game.createPlane('heron',false,'FRA').id,r.id,true);
await writeFile(new URL('ready-state.json',directory),JSON.stringify(s));
const html=(await readFile(new URL('../index.html',import.meta.url),'utf8')).replace('<script type="module" src="/src/main.js"></script>',`<script type="module">const file=location.search.includes('locked')?'locked-state.json':'ready-state.json';const state=await(await fetch('./'+file)).json();state.savedAt=Date.now();localStorage.setItem('airport-manager-save-v2',JSON.stringify(state));localStorage.setItem('airport-manager-tutorial-seen','1');localStorage.setItem('airport-manager-weekly-off','1');await import('/src/main.js');</script>`);
await writeFile(new URL('playtest.html',directory),html);console.log('Prepared locked and ready hub fixtures.');
