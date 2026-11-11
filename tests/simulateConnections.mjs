// Full flight simulation, including closures and exact journey conservation.
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {AIRCRAFT,GOALS,ACHIEVEMENTS} from '../src/data/catalog.js';
const storage={};globalThis.localStorage={getItem:k=>storage[k]??null,setItem:(k,v)=>storage[k]=v};
const {game}=await import('../src/game.js');
const runs=[];
for (const policy of ['economy','balanced','frequent']) {
 game.silent=true;game.newGame('LHR');const s=game.state;s.rivals=[];s.events=[];s.eventsUntil=1e9;s.money=100e6;s.rng=54321;s.minute=0;s.contracts=[];
 s.goalsDone=GOALS.map(g=>g.id);s.achDone=ACHIEVEMENTS.map(a=>a.id);s.hubs[0].levels={runway:4,terminal:4,gates:4,amenities:2,cargo:1,fuel:1,marketing:1};s.hubs[0].specialization='transfer';
 for (const [dest,type] of [['CDG','kestrel'],['FRA','kestrel'],['MAD','heron'],['JFK','heron'],['DXB','heron']]) {
   const r=game.addRoute('LHR',dest);r.service=policy;for(let i=0;i<(dest==='JFK'?2:1);i++)game.assign(game.createPlane(type,false,'LHR').id,r.id,true);
 }
 let maxMs=0,sumMs=0,ticks=0,peakWaiting=0,closureWaiting=0,afterReopen=0;
 // The hub closes on day 10, then reopens after two days.
 s.events=[{id:90,type:'storm',airport:'LHR',start:10,days:2}];game._rev++;
 while(s.day<30) {
   const start=performance.now();game.tick(10);const elapsed=performance.now()-start;maxMs=Math.max(maxMs,elapsed);sumMs+=elapsed;ticks++;
   const c=s.connections,waiting=c.queues.filter(q=>q.leg===1).reduce((n,q)=>n+q.count,0),flying=s.planes.reduce((n,p)=>n+(p.journeys||[]).reduce((a,q)=>a+q.count,0),0);
   assert.equal(c.total.started,c.total.completed+c.total.missed+waiting+flying);
   assert.ok(c.queues.every(q=>q.count>=0));peakWaiting=Math.max(peakWaiting,waiting);
   if(s.day===10)closureWaiting=Math.max(closureWaiting,waiting);
   if(s.day>12)afterReopen=c.total.completed;
   for(const p of s.planes) {const r=game.route(p.routeId);if(!r)continue;const seats=game.seatsFor(AIRCRAFT[p.type],r.cabin);assert.ok(p.pax<=seats.eco && p.biz<=seats.biz);}
 }
 assert.ok(s.connections.total.completed>0);assert.ok(afterReopen>0);assert.ok(Number.isFinite(s.money));
 runs.push({policy,days:s.day,...s.connections.total,completionRate:s.connections.total.completed/s.connections.total.started,peakWaiting,closureWaiting,cashMillions:Math.round(s.money/1e6),timing:{maxMs:Math.round(maxMs*100)/100,meanMs:Math.round(sumMs/ticks*100)/100}});
 console.log(runs.at(-1));
}
await mkdir(new URL('../reports/connections-pass/',import.meta.url),{recursive:true});
await writeFile(new URL('../reports/connections-pass/journeys.json',import.meta.url),JSON.stringify(runs,null,2));
