import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { game } from '../src/game.js';
import { AIRPORTS } from '../src/data/airports.js';
import { GOALS, ACHIEVEMENTS, AIRCRAFT } from '../src/data/catalog.js';
import { passengerTotal, emptyPassengers, PASSENGER_KEYS } from '../src/passengers.js';
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};game.silent=true;
function base(home) {
  game.newGame(home);const s=game.state;s.rng=2345;s.rivals=[];s.events=[];s.eventsUntil=1e9;s.fuelLock={price:1,until:99999};
  s.goalsDone=GOALS.map(g=>g.id);s.achDone=ACHIEVEMENTS.map(a=>a.id);return s;
}
function run(s,days=14) {
  const carried=emptyPassengers();let lastDay=s.day;
  while(s.day<days){game.tick(5);assert.ok(Number.isFinite(s.money));assert.equal(s.over,null);
    if(s.day!==lastDay){lastDay=s.day;for(const r of s.routes){
      assert.equal(passengerTotal(r.yesterday.passengers),r.yesterday.pax);
      for(const id of PASSENGER_KEYS) carried[id]+=r.yesterday.passengers[id];
      for(const key of ['poolOut','poolIn']) assert.ok(Math.abs(passengerTotal(r.passengerPools[key])-r[key])<.001);
    }}
  }
  return {days,cash:Math.round(s.money),dailyProfit:Math.round(s.history.slice(1).reduce((a,b)=>a+b,0)/(s.history.length-1)),flights:s.flights,passengers:s.totalPax,carried};
}
const comparisons=[];
for(const dest of ['ZRH','PMI']) for(const service of ['economy','balanced','frequent']) {
  const s=base('LHR');s.money=10e6;s.hubs[0].levels={runway:3,terminal:2,gates:2,amenities:1,cargo:1,fuel:1,marketing:0};
  const r=game.addRoute('LHR',dest);r.service=service;r.cabin=1;
  game.assign(game.createPlane('kestrel',false,'LHR').id,r.id,true);
  const forecast=game.routeFactors(r);comparisons.push({dest,service,forecast:forecast.segments,...run(s)});
}
const starters=[];
for(const home of ['LHR','BEG','DPS']) {
  const s=base(home);
  const best=AIRPORTS.filter(a=>a.id!==home&&!game.whyNotOpen(a.id)).map(a=>({id:a.id,estimate:game.estimate(home,a.id,'sparrow')})).filter(x=>x.estimate.best).sort((a,b)=>b.estimate.best.profit-a.estimate.best.profit)[0];
  assert.ok(best);assert.equal(game.launchRoute(home,best.id,{mode:'new',typeId:'sparrow'}),null);
  starters.push({home,dest:best.id,initialBudget:1e6,...run(s)});
}
const s=base('LHR');s.money=20e6;s.hubs[0].levels={runway:4,terminal:3,gates:3,amenities:2,cargo:2,fuel:1,marketing:1};
for(const dest of ['JFK','CDG','AMS']) {const r=game.addRoute('LHR',dest);r.cabin=1;r.service='frequent';const type=dest==='JFK'?'albatross':'kestrel';assert.ok(r.km<=AIRCRAFT[type].range);game.assign(game.createPlane(type,false,'LHR').id,r.id,true);}
const transfer=run(s);assert.ok(transfer.carried.connecting>0);
const report={comparisons,starters,transfer};
await mkdir(new URL('../reports/passenger-pass/',import.meta.url),{recursive:true});
await writeFile(new URL('../reports/passenger-pass/balance.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
