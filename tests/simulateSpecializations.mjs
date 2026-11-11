// Compare matching networks with the same network left as General purpose.
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { GOALS, ACHIEVEMENTS } from '../src/data/catalog.js';
import { game } from '../src/game.js';
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
game.silent = true;
const cases = {
  budget: { levels: {runway:2,terminal:2,gates:2,amenities:0,cargo:0,fuel:1,marketing:1}, destinations:['CDG','AMS','MAD'], type:'sparrow', copies:1, price:.9, cabin:0, service:'balanced' },
  premium: { levels: {runway:3,terminal:3,gates:3,amenities:2,cargo:1,fuel:1,marketing:2}, destinations:['JFK','DXB','IST'], type:'heron', copies:1, price:1.1, cabin:2, service:'balanced' },
  transfer: { levels: {runway:4,terminal:4,gates:4,amenities:2,cargo:1,fuel:2,marketing:2}, destinations:['JFK','DXB','BOS','FCO','AMS'], type:'heron', copies:2, price:1, cabin:1, service:'frequent' },
  cargo: { levels: {runway:4,terminal:3,gates:3,amenities:0,cargo:2,fuel:2,marketing:0}, destinations:['JFK','DXB','DEL'], type:'albatross', copies:1, price:1.2, cabin:0, service:'balanced' },
};
function setup(c) {
  game.newGame('LHR'); const s=game.state; s.rng=2345;s.money=50e6;s.rivals=[];s.events=[];s.eventsUntil=1e9;
  s.hubs[0].levels={...c.levels};s.fuelLock={price:1,until:99999};s.goalsDone=GOALS.map(g=>g.id);s.achDone=ACHIEVEMENTS.map(a=>a.id);
  for(const dest of c.destinations){ const r=game.addRoute('LHR',dest); Object.assign(r,{price:c.price,cabin:c.cabin,service:c.service});
    for(let i=0;i<c.copies;i++) assert.equal(game.assign(game.createPlane(c.type,false,'LHR').id,r.id,true),null);
  }
  assert.ok(s.planes.length<=game.planeCap(s.hubs[0]));game._rev++;return s;
}
const results=[];
for(const [role,c] of Object.entries(cases)){
  const runs={};
  for(const selected of ['general',role]){
    const s=setup(c),q=game.specializationQuote('LHR',role);
    if(selected!=='general') assert.equal(game.setSpecialization('LHR',selected),null);
    while(s.day<12) { game.tick(5); assert.ok(Number.isFinite(s.money));assert.equal(s.over,null); }
    runs[selected]={forecastDailyProfit:Math.round(selected==='general'?q.before:q.after),actualAverageProfit:Math.round(s.history.slice(1).reduce((a,b)=>a+b,0)/(s.history.length-1)),flights:s.flights,passengers:s.totalPax};
  }
  results.push({role,...runs,actualDailyGain:runs[role].actualAverageProfit-runs.general.actualAverageProfit});
}
await mkdir(new URL('../reports/specialization-pass/',import.meta.url),{recursive:true});
await writeFile(new URL('../reports/specialization-pass/balance.json',import.meta.url),JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
