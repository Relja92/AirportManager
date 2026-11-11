// Stage funding, accounting and flight operations over full simulated days.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {GOALS,ACHIEVEMENTS} from '../src/data/catalog.js';
import {AIRPORT_PROJECTS,projectEffects} from '../src/projects.js';
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
const {game}=await import('../src/game.js');game.silent=true;const runs=[];
for(const kind of Object.keys(AIRPORT_PROJECTS)){
 game.newGame('LHR','free','hard');const s=game.state;s.money=100e6;s.rivals=[];s.rng=12345;s.events=[];s.eventsUntil=1e9;s.contracts=[];
 s.goalsDone=GOALS.map(g=>g.id);s.achDone=ACHIEVEMENTS.map(a=>a.id);
 const h=s.hubs[0];h.levels={runway:4,terminal:2,gates:2,amenities:1,cargo:2,fuel:1,marketing:1};
 for(const [dest,type] of [['FRA','sparrow'],['DXB','heron_f']]){const r=game.addRoute('LHR',dest);game.assign(game.createPlane(type,false,'LHR').id,r.id,true);}
 const initialCash=s.money,initialInvestment=s.invested,q=game.projectQuote('LHR',kind);assert.equal(game.applyProject('LHR',kind),null);
 const p=h.projects[0],stages=[],daily=[];let waitingAt=null,operatingProfit=0,capital=0;
 while(s.day<35){
   const day=s.day;game.tick(10);
   if(p.status==='awaiting'){
     waitingAt ??= s.minute;
     // Deliberately wait two days at both boundaries; there is no automatic debit.
     assert.equal(p.paid,p.payments.slice(0,p.stage).reduce((n,v)=>n+v,0));assert.equal(p.worked,0);
     if(s.minute-waitingAt>=2880){stages.push({stage:p.stage,minute:s.minute,paidBefore:p.paid});assert.equal(game.applyProject('LHR',p.id,'fund'),null);waitingAt=null;}
   }
   if(day!==s.day){const y=s.yesterday;operatingProfit+=y.profit;capital+=y.projectSpending || 0;
     daily.push({day:s.day,profit:Math.round(y.profit),upkeep:y.hubUpkeep.LHR,status:p.status,paid:p.paid});
     assert.ok(Math.abs(s.money-initialCash-operatingProfit+capital)<1e-5,'Cash must reconcile with operating profit and capital payments');
     assert.ok(Number.isFinite(s.money));assert.ok(game.planesAt(h.id).length<=game.planeCap(h));
   }
 }
 assert.equal(p.status,'complete');assert.equal(p.paid,q.total);assert.equal(capital,q.total);assert.equal(s.invested,initialInvestment+q.total);
 assert.equal(stages.length,2);assert.ok(s.flights>0);assert.ok(s.freight.delivered>0);assert.equal(game.projectFunding(),0);
 assert.ok(s.managementChanges.some(e=>e.kind==='project' && e.status==='complete'));
 runs.push({kind,days:s.day,total:q.total,stages,completedDay:p.completed/1440,effects:projectEffects(h),flights:s.flights,freightDelivered:s.freight.delivered,closingCash:s.money,capital,operatingProfit,daily});
}
const dir=new URL('../reports/projects-pass/',import.meta.url);await mkdir(dir,{recursive:true});await writeFile(new URL('simulation.json',dir),JSON.stringify({seed:12345,runs},null,2));
console.log(JSON.stringify(runs.map(({kind,days,total,completedDay,flights,capital,operatingProfit})=>({kind,days,total,completedDay,flights,capital,operatingProfit})),null,2));
