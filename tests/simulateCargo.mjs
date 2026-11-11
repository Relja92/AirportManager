// Reproducible freight conservation and balance audit; no player save is read.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {AIRCRAFT,GOALS,ACHIEVEMENTS} from '../src/data/catalog.js';
import {rivalHubIds,createRivals} from '../src/rivals.js';
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
const {game}=await import('../src/game.js');game.silent=true;
const runs=[];
function setup(home='LHR',rivals=false){game.newGame(home,'free','hard');const s=game.state;s.money=200e6;s.diff='hard';s.rng=12345;s.events=[];s.eventsUntil=1e9;s.goalsDone=GOALS.map(g=>g.id);s.achDone=ACHIEVEMENTS.map(a=>a.id);
 s.rivals=rivals?createRivals(s,()=>game.rand()):[];s.contracts=[];s.hubs[0].levels={runway:4,terminal:4,gates:4,amenities:1,cargo:3,fuel:1,marketing:1};return s;}
function conserve(s){const queued=s.routes.reduce((n,r)=>n+Object.values(r.freightPools).flat().reduce((n,q)=>n+q.tonnes,0),0),airborne=s.planes.reduce((n,p)=>n+(p.freightManifest || []).reduce((n,q)=>n+q.tonnes,0),0);
 assert.ok(Math.abs(s.freight.booked-s.freight.delivered-s.freight.expired-s.freight.cancelled-queued-airborne)<1e-5);assert.ok(Number.isFinite(s.money));}
for(const [type,dest] of [['sparrow_f','FRA'],['heron_f','DXB'],['albatross_f','HKG']])for(const service of ['bulk','express']){
 const s=setup(),r=game.addRoute('LHR',dest);r.cargoService=service;s.hubs[0].specialization='cargo';
 const p=game.createPlane(type,false,'LHR');game.assign(p.id,r.id,true);const forecast=game.typeProfit(r,AIRCRAFT[type]).profit,profits=[];
 while(s.day<30){const before=s.day;game.tick(10);conserve(s);if(s.day>before && s.day>7)profits.push(game.routeProfit(r));}
 assert.ok(s.freight.delivered>0);runs.push({type,route:`LHR-${dest}`,service,days:30,forecast:Math.round(forecast),meanRouteProfit:Math.round(profits.reduce((n,v)=>n+v,0)/profits.length),...s.freight});
}
const s=setup('LHR',true),r=game.addRoute('LHR','FRA');game.assign(game.createPlane('sparrow_f',false,'LHR').id,r.id,true);game.assign(game.createPlane('kestrel',false,'LHR').id,r.id,true);
s.events=[{type:'storm',airport:'FRA',start:10,days:4}];const freightRivals=new Set();let maxFreighters=0;
while(s.day<120){game.tick(30);conserve(s);const active=s.rivals.flatMap(rv=>rv.routes.filter(r=>AIRCRAFT[r.type].freighter).map(r=>({rv,r})));maxFreighters=Math.max(maxFreighters,active.length);for(const {rv,r} of active){freightRivals.add(rv.name);assert.ok(Number.isFinite(rv.profit));assert.ok(['bulk','express'].includes(r.cargoService));}}
const ai={days:120,difficulty:'hard',survivors:s.rivals.filter(rv=>rv.hub).length,hubs:s.rivals.map(rv=>rivalHubIds(rv).length),maxFreighters,freightRivals:[...freightRivals],playerFreight:s.freight};
assert.ok(ai.survivors>=3);assert.ok(ai.hubs.some(n=>n>1));
await mkdir(new URL('../reports/cargo-pass/',import.meta.url),{recursive:true});await writeFile(new URL('../reports/cargo-pass/simulation.json',import.meta.url),JSON.stringify({runs,ai},null,2));console.log(JSON.stringify({cases:runs.map(({type,service,forecast,meanRouteProfit})=>({type,service,forecast,meanRouteProfit})),ai},null,2));
