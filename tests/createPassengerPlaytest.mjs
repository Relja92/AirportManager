// Disposable fixture: serve on a separate port to keep the player's save intact.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { game } from '../src/game.js';
import { GOALS, ACHIEVEMENTS } from '../src/data/catalog.js';
globalThis.localStorage = {getItem:()=>null,setItem:()=>{}}; game.silent=true;
const directory=new URL('../reports/passenger-pass/',import.meta.url);await mkdir(directory,{recursive:true});
game.newGame('LHR');const s=game.state;s.rng=2345;s.money=12e6;s.speed=0;s.tut=null;s.events=[];s.rivals=[];s.eventsUntil=1e9;
s.hubs[0].levels={runway:4,terminal:3,gates:3,amenities:2,cargo:2,fuel:1,marketing:1};
s.hubs.push({id:'FRA',levels:{...s.hubs[0].levels},specialization:'cargo',specializationUntil:14});
s.goalsDone=GOALS.map(g=>g.id);s.achDone=ACHIEVEMENTS.map(a=>a.id);
s.tips=['contract','losing','war','rivalWeak','worn','fuelHigh','fuelLow','rep','hub2','value'];
for(const [i,dest] of ['ZRH','PMI','CDG','JFK'].entries()) {
  const r=game.addRoute('LHR',dest);r.price=i===1?.9:1.1;r.cabin=i===1?0:1;r.service=i===1?'economy':'balanced';
  game.assign(game.createPlane(i===3?'albatross':'kestrel',false,'LHR').id,r.id,true);
}
const cargo=game.addRoute('FRA','IST');game.assign(game.createPlane('heron',false,'FRA').id,cargo.id,true);
while(s.day<2) game.tick(5);
s.speed=0;s.logSeen=s.logN;s.active='LHR';s.contracts=[];
await writeFile(new URL('ready-state.json',directory),JSON.stringify(s));
const html=(await readFile(new URL('../index.html',import.meta.url),'utf8')).replace('<script type="module" src="/src/main.js"></script>',`<script type="module">const state=await(await fetch('./ready-state.json')).json();state.savedAt=Date.now();localStorage.setItem('airport-manager-save-v2',JSON.stringify(state));localStorage.setItem('airport-manager-tutorial-seen','1');localStorage.setItem('airport-manager-weekly-off','1');await import('/src/main.js');</script>`);
await writeFile(new URL('playtest.html',directory),html);console.log('Prepared passenger and airport market fixture.');
