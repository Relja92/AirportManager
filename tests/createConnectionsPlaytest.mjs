import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {GOALS,ACHIEVEMENTS} from '../src/data/catalog.js';
const storage={};globalThis.localStorage={getItem:k=>storage[k]??null,setItem:(k,v)=>storage[k]=v};
const {game}=await import('../src/game.js');
game.silent=true;game.newGame('LHR');const s=game.state;s.rivals=[];s.events=[];s.eventsUntil=1e9;s.money=50e6;s.minute=0;s.rng=54321;
s.goalsDone=GOALS.map(g=>g.id);s.achDone=ACHIEVEMENTS.map(a=>a.id);s.tips=['contract'];s.tut=null;s.hubs[0].levels={runway:4,terminal:4,gates:4,amenities:2,cargo:1,fuel:1,marketing:1};s.hubs[0].specialization='transfer';
for (const [dest,type] of [['CDG','kestrel'],['FRA','kestrel'],['MAD','heron'],['JFK','heron'],['DXB','heron']]) {const r=game.addRoute('LHR',dest);r.service='balanced';game.assign(game.createPlane(type,false,'LHR').id,r.id,true);}
while(s.day<5)game.tick(10);
// A naturally generated queue is held at JFK by a breakdown, giving the UI a
// real response case with service and aircraft actions to review.
const r=s.routes.find(r=>r.dest==='JFK'),p=game.planesOn(r.id)[0];
let guard=0;
while((!game.connectionStatus(r,false).waiting || !['home','turn'].includes(p.phase) || p.journeys?.length) && guard++<288)game.tick(10);
p.resume=p.phase;p.phase='repair';p.t=240;game.recordBreakdown(p,0);game._rev++;
s.speed=0;s.report=null;s.savedAt=Date.now();s.logSeen=s.logN;s.contracts=[];
const dir=new URL('../reports/connections-pass/',import.meta.url);await mkdir(dir,{recursive:true});
await writeFile(new URL('playtest-state.json',dir),JSON.stringify(s));
const html=(await readFile(new URL('../index.html',import.meta.url),'utf8')).replace('<script type="module" src="/src/main.js"></script>',`<script type="module">const state=await(await fetch('./playtest-state.json')).json();state.savedAt=Date.now();localStorage.setItem('airport-manager-save-v2',JSON.stringify(state));localStorage.setItem('airport-manager-tutorial-seen','1');localStorage.setItem('airport-manager-weekly-off','1');await import('/src/main.js');</script>`);
await writeFile(new URL('playtest.html',dir),html);
console.log({day:s.day,routeId:r.id,connections:game.connectionStatus(r),total:s.connections.total});
