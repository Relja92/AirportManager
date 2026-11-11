// Disposable fixture, served on a separate origin from the player's save.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {game} from '../src/game.js';
import {GOALS,ACHIEVEMENTS} from '../src/data/catalog.js';
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};game.silent=true;
const dir=new URL('../reports/disruption-pass/',import.meta.url);await mkdir(dir,{recursive:true});
game.newGame('LHR');const s=game.state;s.rng=2345;s.money=4e6;s.speed=0;s.tut=null;s.events=[];s.rivals=[];s.eventsUntil=1e9;s.contracts=[];
s.hubs[0].levels={runway:4,terminal:3,gates:3,amenities:2,cargo:2,fuel:1,marketing:1};
s.hubs.push({id:'FRA',levels:{...s.hubs[0].levels},specialization:'general'});
s.goalsDone=GOALS.map(g=>g.id);s.achDone=ACHIEVEMENTS.map(a=>a.id);s.tips=['contract','losing','war','rivalWeak','worn','fuelHigh','fuelLow','rep','hub2','value'];
for(const dest of ['CDG','AMS','JFK']) {const r=game.addRoute('LHR',dest);const p=game.createPlane(dest==='JFK'?'albatross':'heron',false,'LHR');game.assign(p.id,r.id,true);if(dest==='CDG') {p.phase='repair';p.resume='home';p.t=120;game.bumpRep(-.8);game.recordBreakdown(p,.8);}}
game.createPlane('kestrel',false,'LHR');const r=game.addRoute('FRA','IST');game.assign(game.createPlane('heron',false,'FRA').id,r.id,true);
s.events=[{id:901,type:'storm',airport:'JFK',start:0,days:2}];
s.contracts=[{id:801,clientId:'summit',hub:'LHR',dest:'CDG',kind:'pax',what:'conference delegates',amount:1400,done:220,due:1,days:2,reward:35000}];s.logSeen=s.logN;s.active='LHR';
await writeFile(new URL('ready-state.json',dir),JSON.stringify(s));
const html=(await readFile(new URL('../index.html',import.meta.url),'utf8')).replace('<script type="module" src="/src/main.js"></script>',`<script type="module">const state=await(await fetch('./ready-state.json')).json();if(new URLSearchParams(location.search).has('strike')) state.events=[{id:902,type:'strike',airport:'LHR',start:0,days:2}];state.savedAt=Date.now();localStorage.setItem('airport-manager-save-v2',JSON.stringify(state));localStorage.setItem('airport-manager-tutorial-seen','1');localStorage.setItem('airport-manager-weekly-off','1');await import('/src/main.js');</script>`);
await writeFile(new URL('playtest.html',dir),html);console.log('Prepared disruption fixture.');
