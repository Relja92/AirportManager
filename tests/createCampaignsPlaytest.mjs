// Disposable browser saves on an isolated origin; never reads the player's save.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {GOALS,ACHIEVEMENTS} from '../src/data/catalog.js';
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
const {game}=await import('../src/game.js');game.silent=true;game.newGame('LHR');const s=game.state;
s.money=28e6;s.events=[];s.eventsUntil=1e9;s.rivals=[];s.rng=12345;s.goalsDone=GOALS.map(g=>g.id);s.achDone=ACHIEVEMENTS.map(a=>a.id);s.tips=['contract','rep','rivalWeak','hub2','value','losing','worn','fuelHigh','fuelLow'];
s.hubs[0].levels={runway:3,terminal:3,gates:3,amenities:1,cargo:2,fuel:1,marketing:1};
for(const dest of ['VIE','ZRH','CPH']){const r=game.addRoute('LHR',dest);r.service='frequent';game.assign(game.createPlane('sparrow',false,'LHR').id,r.id,true);}
while(s.day<5)game.tick(10);s.speed=0;s.savedAt=Date.now();s.report=null;s.contracts=[];s.logSeen=s.logN;
const dir=new URL('../reports/campaigns-pass/',import.meta.url);await mkdir(dir,{recursive:true});
await writeFile(new URL('ready.json',dir),JSON.stringify(s));
game.startCampaign('regional');while(game.campaignRun().phase!=='ready' && s.day<30)game.tick(10);
s.contracts=[];s.report=null;s.logSeen=s.logN;await writeFile(new URL('claim.json',dir),JSON.stringify(s));
game.claimCampaign('regional',0);game.tick(1000);s.contracts=[];s.report=null;s.logSeen=s.logN;
await writeFile(new URL('progress.json',dir),JSON.stringify(s));
s.hubs.push({id:'MAD',levels:{...s.hubs[0].levels},projects:[],specialization:'general'});
const added=game.addRoute('MAD','LIS');added.service='frequent';game.assign(game.createPlane('sparrow',false,'MAD').id,added.id,true);
assert.equal(game.applyProject('LHR','solar'),null);const site=s.hubs[0].projects[0];
for(let stage=0;stage<3;stage++){if(stage)assert.equal(game.applyProject('LHR',site.id,'fund'),null);game.tick(site.durations[stage]);}
while(game.campaignRun('regional').phase!=='complete' && s.day<100){game.tick(10);const run=game.campaignRun('regional');if(run.phase==='ready')game.claimCampaign('regional',run.chapter);}
assert.equal(game.campaignRun('regional').phase,'complete');s.speed=0;s.contracts=[];s.report=null;s.logSeen=s.logN;
await writeFile(new URL('complete.json',dir),JSON.stringify(s));
const html=(await readFile(new URL('../index.html',import.meta.url),'utf8')).replace('<script type="module" src="/src/main.js"></script>',`<script type="module">const choice=new URLSearchParams(location.search).get('state');const kind=['claim','progress','complete'].includes(choice)?choice:'ready';const state=await(await fetch('./'+kind+'.json')).json();state.savedAt=Date.now();localStorage.setItem('airport-manager-save-v2',JSON.stringify(state));localStorage.setItem('airport-manager-tutorial-seen','1');localStorage.setItem('airport-manager-weekly-off','1');await import('/src/main.js');</script>`);
await writeFile(new URL('playtest.html',dir),html);console.log({states:['ready','claim','progress','complete']});
