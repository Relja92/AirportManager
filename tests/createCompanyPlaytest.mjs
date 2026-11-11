// Disposable saves for browser checks, plus a campaign played with actual flights.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
const {game}=await import('../src/game.js');game.silent=true;game.newGame('LHR');const s=game.state;
s.money=28e6;s.events=[];s.eventsUntil=1e9;s.rivals=[];s.rng=12345;
s.tips=['contract','rep','rivalWeak','hub2','value','losing','worn','fuelHigh','fuelLow'];
s.hubs[0].levels={runway:3,terminal:3,gates:3,amenities:1,cargo:2,fuel:1,marketing:1};
for(const dest of ['VIE','ZRH','CPH']){const r=game.addRoute('LHR',dest);r.service='frequent';game.assign(game.createPlane('sparrow',false,'LHR').id,r.id,true);}
game.setCompanyIdentity('Adriatic Airways','amber');game.renameAircraft(s.planes[0].id,'Northern Star');
assert.equal(game.startCampaign('regional'),null);assert.equal(game.buyHub('MAD'),null);s.active='LHR';
const h=game.hub('MAD');h.levels={...s.hubs[0].levels};
const route=game.addRoute('MAD','LIS');route.service='frequent';game.assign(game.createPlane('sparrow',false,'MAD').id,route.id,true);
assert.equal(game.applyProject('LHR','solar'),null);const project=s.hubs[0].projects[0];
while(s.day<90 && game.campaignRun('regional').phase!=='complete') {
 game.tick(10);
 if(project.status==='awaiting')assert.equal(game.applyProject('LHR',project.id,'fund'),null);
 const run=game.campaignRun('regional');if(run.phase==='ready')assert.equal(game.claimCampaign('regional',run.chapter),null);
}
assert.equal(game.campaignRun('regional').phase,'complete');
assert.equal(s.company.timeline.filter(e=>e.key==='first-flight').length,1);
assert.equal(s.company.timeline.filter(e=>e.key==='campaign:regional').length,1);
assert.equal(s.company.timeline.filter(e=>e.key===`project:LHR:${project.id}`).length,1);
assert.ok(s.company.records.busiestDay.pax>0);assert.ok(s.company.records.longestFlight.km>0);
s.speed=0;s.savedAt=Date.now();s.report=null;s.contracts=[];s.logSeen=s.logN;game.syncCompany();
const dir=new URL(process.env.COMPANY_PLAYTEST_REPORT || '../reports/company-pass/',import.meta.url);await mkdir(dir,{recursive:true});
await writeFile(new URL('ready.json',dir),JSON.stringify(s));
await writeFile(new URL('simulation.json',dir),JSON.stringify({day:s.day,flights:s.flights,passengers:s.totalPax,records:s.company.records,timeline:s.company.timeline,campaign:game.campaignRun('regional').phase},null,2));
const legacy=structuredClone(s);delete legacy.company;for(const p of legacy.planes)delete p.registration;
await writeFile(new URL('legacy.json',dir),JSON.stringify(legacy));
const html=(await readFile(new URL('../index.html',import.meta.url),'utf8')).replace('<script type="module" src="/src/main.js"></script>',`<script type="module">const kind=new URLSearchParams(location.search).get('state')==='legacy'?'legacy':'ready';const state=await(await fetch('./'+kind+'.json')).json();state.savedAt=Date.now();localStorage.setItem('airport-manager-save-v2',JSON.stringify(state));localStorage.setItem('airport-manager-tutorial-seen','1');localStorage.setItem('airport-manager-weekly-off','1');await import('/src/main.js');</script>`);
await writeFile(new URL('playtest.html',dir),html);console.log({day:s.day,flights:s.flights,passengers:s.totalPax,events:s.company.timeline.length,campaign:game.campaignRun('regional').phase});
