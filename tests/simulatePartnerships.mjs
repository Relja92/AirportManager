import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {setupPartnership} from './partnershipFixture.mjs';
import {partnerSeats} from '../src/partnerships.js';
const storage={};globalThis.localStorage={getItem:k=>storage[k]??null,setItem:(k,v)=>storage[k]=v};
const {game}=await import('../src/game.js');const runs=[];
for(const terms of ['reciprocal','access']) {
 const {s,rv}=setupPartnership(game);s.diff='hard';rv.next=2;rv.nextHub=30;s.rng=912345;
 assert.equal(game.applyPartnership(rv.id,terms),null);const a=s.partnerships.agreements[0];
 s.events.push({id:'partner-storm',type:'storm',airport:'CDG',start:10,days:2});let renewed=false,ended=false,max=0,steps=0,totalMs=0;
 while(s.day<65) {
  if(s.day===26 && !renewed){const why=game.applyPartnership(rv.id,terms,'renew');assert.equal(why,null);renewed=true;}
  if(s.day===50 && !ended){assert.equal(game.applyPartnership(rv.id,terms,'end'),null);ended=true;}
  const started=performance.now();game.tick(10);const ms=performance.now()-started;max=Math.max(max,ms);totalMs+=ms;steps++;
  const inProgress=s.connections.queues.filter(q=>q.leg===1).reduce((n,q)=>n+q.count,0)+[...s.planes,...s.partnerships.flights].reduce((n,p)=>n+(p.journeys || []).reduce((n,q)=>n+q.count,0),0);
  assert.equal(s.connections.total.started,s.connections.total.completed+s.connections.total.missed+inProgress);
  assert.ok(s.connections.queues.every(q=>Number.isFinite(q.count) && q.count>=0));
  for(const p of s.partnerships.flights)if(p.route)assert.ok((p.journeys || []).reduce((n,q)=>n+q.count,0)<=partnerSeats(p.route));
  assert.ok(Number.isFinite(s.money));assert.ok(Number.isFinite(rv.cash));
 }
 assert.equal(s.partnerships.flights.length,0);assert.equal(a.total.started,a.total.completed+a.total.missed);
 assert.ok(a.total.sent>0 && a.total.received>0);
 runs.push({terms,days:s.day,renewed,ended,stats:a.total,rival:{hubs:rv.hubs.length,routes:rv.routes.length,cash:Math.round(rv.cash)},timing:{maxMs:+max.toFixed(2),meanMs:+(totalMs/steps).toFixed(3)}});
}
const dir=new URL('../reports/partnerships-pass/',import.meta.url);await mkdir(dir,{recursive:true});await writeFile(new URL('simulation.json',dir),JSON.stringify(runs,null,2)+'\n');console.log(JSON.stringify(runs,null,2));
