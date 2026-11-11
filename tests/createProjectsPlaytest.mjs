// Isolated browser fixtures; never read or replace the player's save on port 5174.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {GOALS,ACHIEVEMENTS} from '../src/data/catalog.js';
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
const {game}=await import('../src/game.js');game.silent=true;game.newGame('LHR');const s=game.state;
s.money=28e6;s.events=[];s.eventsUntil=1e9;s.rivals=[];s.rng=12345;
s.goalsDone=GOALS.map(g=>g.id);s.achDone=ACHIEVEMENTS.map(a=>a.id);s.tips=['contract','rep','rivalWeak','hub2','value','losing','worn','fuelHigh','fuelLow'];
s.hubs[0].levels={runway:4,terminal:2,gates:2,amenities:1,cargo:2,fuel:1,marketing:1};
for(const [dest,type] of [['FRA','sparrow'],['DXB','heron_f']]){const r=game.addRoute('LHR',dest);game.assign(game.createPlane(type,false,'LHR').id,r.id,true);}
while(s.day<8)game.tick(10);s.contracts=[];s.speed=0;s.savedAt=Date.now();s.report=null;s.logSeen=s.logN;
const dir=new URL('../reports/projects-pass/',import.meta.url);await mkdir(dir,{recursive:true});
await writeFile(new URL('ready.json',dir),JSON.stringify(s));
game.applyProject('LHR','concourse');const p=s.hubs[0].projects[0];
const work=()=>{game.tick(p.durations[p.stage]-p.worked);s.contracts=[];s.report=null;s.logSeen=s.logN;};
work();await writeFile(new URL('awaiting.json',dir),JSON.stringify(s));
game.applyProject('LHR',p.id,'fund');work();game.applyProject('LHR',p.id,'fund');game.tick(p.durations[2]-20);
s.contracts=[];s.report=null;s.logSeen=s.logN;await writeFile(new URL('commissioning.json',dir),JSON.stringify(s));
work();for(let i=0;i<3;i++)game.createPlane('sparrow',false,'LHR');
await writeFile(new URL('completed.json',dir),JSON.stringify(s));
const html=(await readFile(new URL('../index.html',import.meta.url),'utf8')).replace('<script type="module" src="/src/main.js"></script>',`<script type="module">const choice=new URLSearchParams(location.search).get('state');const kind=['awaiting','commissioning','completed'].includes(choice)?choice:'ready';const state=await(await fetch('./'+kind+'.json')).json();state.savedAt=Date.now();localStorage.setItem('airport-manager-save-v2',JSON.stringify(state));localStorage.setItem('airport-manager-tutorial-seen','1');localStorage.setItem('airport-manager-weekly-off','1');await import('/src/main.js');</script>`);
await writeFile(new URL('playtest.html',dir),html);console.log({states:['ready','awaiting','commissioning','completed']});
