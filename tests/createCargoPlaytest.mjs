// Isolated browser fixture; generated saves are disposable and never read the player's storage.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {GOALS,ACHIEVEMENTS} from '../src/data/catalog.js';
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
const {game}=await import('../src/game.js');game.silent=true;game.newGame('LHR');const s=game.state;s.money=28e6;s.events=[];s.eventsUntil=1e9;s.rivals=[];s.rng=12345;
s.goalsDone=GOALS.map(g=>g.id);s.achDone=ACHIEVEMENTS.map(a=>a.id);s.tips=['contract','rep','rivalWeak','hub2','value'];
s.hubs[0].levels={runway:4,terminal:4,gates:4,amenities:1,cargo:3,fuel:1,marketing:1};
const r=game.addRoute('LHR','FRA');game.assign(game.createPlane('sparrow_f',false,'LHR').id,r.id,true);
const mixed=game.addRoute('LHR','DXB');game.assign(game.createPlane('heron_f',false,'LHR').id,mixed.id,true);game.assign(game.createPlane('heron',false,'LHR').id,mixed.id,true);
while(s.day<8)game.tick(10);
const convert=game.createPlane('sparrow',true,'LHR');convert.name='LHR-CONVERT';
s.contracts=[];s.speed=0;s.savedAt=Date.now();s.report=null;s.logSeen=s.logN;
const dir=new URL('../reports/cargo-pass/',import.meta.url);await mkdir(dir,{recursive:true});
await writeFile(new URL('ready.json',dir),JSON.stringify(s));
game.setFreightService(r.id,'express');game.stepFreight(20);s.minute+=1200;
await writeFile(new URL('attention.json',dir),JSON.stringify(s));
const html=(await readFile(new URL('../index.html',import.meta.url),'utf8')).replace('<script type="module" src="/src/main.js"></script>',`<script type="module">const kind=new URLSearchParams(location.search).get('state')==='attention'?'attention':'ready';const state=await(await fetch('./'+kind+'.json')).json();state.savedAt=Date.now();localStorage.setItem('airport-manager-save-v2',JSON.stringify(state));localStorage.setItem('airport-manager-tutorial-seen','1');localStorage.setItem('airport-manager-weekly-off','1');await import('/src/main.js');</script>`);
await writeFile(new URL('playtest.html',dir),html);console.log({cargoRoute:r.id,mixedRoute:mixed.id,convert:convert.id});
