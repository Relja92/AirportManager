// Exercise every chapter through real flights and full daily ledgers.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {GOALS,ACHIEVEMENTS} from '../src/data/catalog.js';
import {CAMPAIGNS} from '../src/campaigns.js';
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
const {game}=await import('../src/game.js');game.silent=true;const results=[];
const levels={runway:3,terminal:3,gates:3,amenities:1,cargo:2,fuel:1,marketing:1};
for(const id of Object.keys(CAMPAIGNS)){
 game.newGame('LHR');const s=game.state;s.money=200e6;s.rng=12345;s.rivals=[];s.events=[];s.eventsUntil=1e9;s.contracts=[];s.minute=0;
 s.goalsDone=GOALS.map(g=>g.id);s.achDone=ACHIEVEMENTS.map(a=>a.id);s.hubs[0].levels={...levels};
 for(const hub of id==='connector'?['MAD','FRA']:['MAD'])s.hubs.push({id:hub,levels:{...levels},projects:[],specialization:id==='connector'?'transfer':'general'});
 if(id==='connector')for(const h of s.hubs){h.specialization='transfer';h.levels.amenities=3;}
 const routes=id==='regional'?[['LHR','VIE','sparrow'],['LHR','ZRH','sparrow'],['LHR','CPH','sparrow'],['MAD','LIS','sparrow'],['MAD','BUD','kestrel']]:id==='freight'?[['LHR','FRA','sparrow_f'],['LHR','DXB','heron_f'],['MAD','BCN','sparrow_f']]:[['LHR','CDG','kestrel'],['LHR','MAD','heron'],['LHR','FRA','kestrel'],['MAD','LIS','kestrel'],['FRA','VIE','kestrel'],['FRA','CPH','kestrel']];
 for(const [hub,dest,type] of routes){const r=game.addRoute(hub,dest);r.service='frequent';r.cargoService='express';if(id==='connector')r.price=.85;game.assign(game.createPlane(type,false,hub).id,r.id,true);}
 if(id==='freight')game.assign(game.createPlane('sparrow_f',false,'LHR').id,game.routeTo('LHR','FRA').id,true);
 // Complete a real project in advance; existing facilities may count in later chapters.
 if(id!=='connector'){
  assert.equal(game.applyProject('LHR',id==='freight'?'freight':'solar'),null);const p=s.hubs[0].projects[0];
  for(let stage=0;stage<3;stage++){if(stage)assert.equal(game.applyProject('LHR',p.id,'fund'),null);game.tick(p.durations[stage]);}
 }
 s.contracts=[];const startDay=s.day;assert.equal(game.startCampaign(id),null);const checkpoints=[];
 while(s.day-startDay<180 && game.campaignRun(id).phase!=='complete' && !s.over){
  game.tick(10);const run=game.campaignRun(id);
  if(run.phase==='ready'){
   const st=game.campaignStatus(id);assert.ok(st.goals.every(q=>q.met));const cash=s.money,rev=s.today.rev;
   checkpoints.push({chapter:run.chapter,day:s.day,goals:st.goals.map(({key,value,target})=>({key,value,target}))});
   assert.equal(game.claimCampaign(id,run.chapter),null);assert.equal(s.today.rev,rev);assert.ok(Math.abs(s.money-cash-st.chapter.reward)<1e-6);
  }
 }
 const run=game.campaignRun(id),summary={id,days:s.day-startDay,phase:run.phase,chapter:run.chapter,checkpoints,remaining:game.campaignStatus(id).goals,grants:run.rewards.reduce((n,r)=>n+r.amount,0),cash:s.money,profit:s.yesterday?.profit};
 results.push(summary);console.log(JSON.stringify(summary));
}
await mkdir(new URL('../reports/campaigns-pass/',import.meta.url),{recursive:true});await writeFile(new URL('../reports/campaigns-pass/simulation.json',import.meta.url),JSON.stringify({seed:12345,results},null,2));
assert.ok(results.every(r=>r.phase==='complete'),'Every campaign should be completable with its intended strategy');
