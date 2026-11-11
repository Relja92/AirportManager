import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {AIRCRAFT,GOALS,ACHIEVEMENTS} from '../src/data/catalog.js';
import {freightHold,freightService} from '../src/cargo.js';
import {routeEconomy,rivalPolicyQuote} from '../src/rivals.js';
import {aircraftPlan,fleetMatches} from '../src/aircraftManagement.js';
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v};
const {game}=await import('../src/game.js');
let s,r,p;
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
const tonnes=manifest=>(manifest || []).reduce((n,q)=>n+q.tonnes,0);
const waiting=()=>s.routes.reduce((n,r)=>n+Object.values(r.freightPools || {}).flat().reduce((n,q)=>n+q.tonnes,0),0);
beforeEach(()=>{game.silent=true;game.newGame('LHR');s=game.state;s.money=100e6;s.events=[];s.eventsUntil=1e9;s.rivals=[];s.minute=0;s.rng=12345;
 s.goalsDone=GOALS.map(g=>g.id);s.achDone=ACHIEVEMENTS.map(a=>a.id);s.hubs[0].levels={runway:4,terminal:4,gates:4,amenities:1,cargo:2,fuel:1,marketing:1};
 r=game.addRoute('LHR','FRA');p=game.createPlane('sparrow_f',false,'LHR');game.assign(p.id,r.id,true);game.migrateCargo();});

test('freighter purchases, leases and launches require a cargo terminal',()=>{
 s.hubs[0].levels.cargo=0;assert.match(game.whyNotBuy('sparrow_f'),/cargo terminal/);
 assert.match(game.leaseQuote('heron_f','LHR').why,/cargo terminal/);assert.match(game.launchQuote('LHR','MAD',{mode:'new',typeId:'heron_f'}).why,/cargo terminal/);
});
test('freighters have finite holds, zero passenger seats and cannot create connections',()=>{
 assert.equal(AIRCRAFT.sparrow_f.seats,0);assert.ok(freightHold(AIRCRAFT.sparrow_f,s.hubs[0])<=6);
 const onward=game.addRoute('LHR','JFK');game.assign(game.createPlane('heron_f',false,'LHR').id,onward.id,true);
 assert.equal(game.connectionPlan().pairs.length,0);assert.equal(game.seatsPerDay(r),0);
});
test('cargo forecasts are finite, pure and share demand between freighters',()=>{
 const before=JSON.stringify(s),q=game.freightForecast(r,AIRCRAFT.sparrow_f),two=game.freightForecast(r,AIRCRAFT.sparrow_f,2);
 assert.equal(JSON.stringify(s),before);assert.ok(Number.isFinite(q.profit));assert.ok(q.cargoTonnes<=q.capacity);assert.ok(two.cargoTonnes<=q.cargoTonnes);
 const quote=game.freightServiceQuote(r.id,'express');assert.equal(quote.why,null);assert.notEqual(quote.after,quote.before);
});
test('actual cargo loads consume bookings once and only landings earn freight income',()=>{
 game.stepFreight(720);const booked=s.freight.booked,cash=s.money;p.t=10000;game.stepPlane(p,1);
 assert.equal(p.phase,'out');assert.ok(tonnes(p.freightManifest)>0);assert.ok(tonnes(p.freightManifest)<=freightHold(AIRCRAFT[p.type],s.hubs[0]));
 assert.equal(p.pax,0);assert.equal(p.biz,0);near(s.money,cash);
 near(booked,waiting()+tonnes(p.freightManifest));const load=tonnes(p.freightManifest),rev=p.freightManifest.reduce((n,q)=>n+q.price*q.tonnes,0);
 game.land(p,r,AIRCRAFT[p.type],p.dur);near(s.today.cargo,rev);near(s.freight.delivered,load);assert.equal(p.freightManifest,undefined);
});
test('late express earns only a quarter of its agreed rate and cannot complete a delivery contract',()=>{
 r.cargoService='express';game.stepFreight(720);p.t=10000;game.stepPlane(p,1);const full=p.freightManifest.reduce((n,q)=>n+q.price*q.tonnes,0),load=tonnes(p.freightManifest);
 s.contracts=[{id:999,kind:'cargo',clientId:'medair',hub:r.hub,dest:r.dest,amount:100,done:0,due:5,reward:10000}];
 game.land(p,r,AIRCRAFT[p.type],1441);near(s.today.cargo,full*.25);near(s.freight.late,load);assert.equal(s.contracts[0].done,0);
});
test('expired bookings pay one ten-percent claim and stop showing as waiting',()=>{
 r.cargoService='express';game.stepFreight(720);const cost=Object.values(r.freightPools).flat().reduce((n,q)=>n+q.price*q.tonnes*.1,0),booked=s.freight.booked,cash=s.money;
 p.phase='repair';s.minute=1441;game.stepFreight(1);near(s.money,cash-cost);near(s.freight.expired,booked);assert.equal(waiting(),0);
 game.stepFreight(1);near(s.money,cash-cost);
});
test('switching freight service previews and settles cancellations, while airborne bookings retain their terms',()=>{
 game.stepFreight(720);p.t=10000;game.stepPlane(p,1);const manifest=JSON.stringify(p.freightManifest),q=game.freightServiceQuote(r.id,'express'),cash=s.money;
 assert.ok(q.cost>0);assert.equal(game.setFreightService(r.id,'express'),null);near(s.money,cash-q.cost);assert.equal(waiting(),0);assert.equal(JSON.stringify(p.freightManifest),manifest);
 assert.equal(game.setFreightService(r.id,'express'),null);near(s.money,cash-q.cost);
});
test('loaded freighters cannot be moved, sold, swapped or returned early',()=>{
 game.stepFreight(720);p.t=10000;game.stepPlane(p,1);
 assert.match(game.assign(p.id,null),/freight/);assert.match(game.sellPlane(p.id),/freight/);assert.match(aircraftPlan(game,{kind:'park',id:p.id}).why,/freight/);
 p.lease={daily:100,days:7,start:0,end:10000,billedUntil:0};assert.match(game.leaseActionQuote(p.id,'return').why,/freight/);
});
test('a conversion retains identity and age, takes two days and cannot be bypassed',()=>{
 game.park(p);p.type='sparrow';p.age=100;game.assign(p.id,r.id,true);const q=game.conversionQuote(p.id),cash=s.money,id=p.id;
 assert.equal(q.why,null);assert.equal(game.convertFreighter(p.id),null);near(s.money,cash-q.cost);assert.equal(p.phase,'conversion');
 assert.match(game.assign(p.id,null),/conversion/);assert.ok(game.convertFreighter(p.id));assert.ok(game.sellPlane(p.id));assert.ok(aircraftPlan(game,{kind:'replace',id:p.id}).why);
 s.minute=q.until-1;game.stepConversion(p);assert.equal(p.type,'sparrow');s.minute=q.until;game.stepConversion(p);
 assert.equal(p.type,'sparrow_f');assert.equal(p.id,id);assert.equal(p.age,100);assert.equal(p.routeId,r.id);assert.equal(p.phase,'home');near(s.money,cash-q.cost);
});
test('conversion requires ownership and the aircraft to be at its home base',()=>{
 p.type='heron';p.phase='turn';assert.match(game.conversionQuote(p.id).why,/home hub/);p.phase='home';p.lease={};assert.match(game.conversionQuote(p.id).why,/Leased/);
 delete p.lease;s.hubs[0].levels.cargo=0;assert.match(game.conversionQuote(p.id).why,/cargo terminal/);
});
test('cargo contract credits use actual outward tonnes once across all signed jobs',()=>{
 s.contracts=[1,2].map(id=>({id,kind:'cargo',clientId:'medair',hub:r.hub,dest:r.dest,amount:10,done:0,due:5,reward:10000}));
 game.contractProgress(r,AIRCRAFT.sparrow_f,s.hubs[0],0,{bulk:3,express:2});near(s.contracts.reduce((n,c)=>n+c.done,0),5);
 game.contractProgress(r,AIRCRAFT.sparrow_f,s.hubs[0],0);near(s.contracts.reduce((n,c)=>n+c.done,0),5);
});
test('cargo filters recognize freighters and conversions',()=>{
 assert.equal(fleetMatches(game,p,'freighters'),true);p.type='sparrow';game.convertFreighter(p.id);assert.equal(fleetMatches(game,p,'conversion'),true);
});
test('cargo state, loaded manifests and conversions survive a save without payments repeating',()=>{
 game.stepFreight(720);p.t=10000;game.stepPlane(p,1);const next=game.createPlane('heron',false,'LHR');game.convertFreighter(next.id);
 const data=JSON.stringify({freight:s.freight,manifest:p.freightManifest,conversion:next.conversion}),cash=s.money;game.save();assert.equal(game.load(),true);
 near(game.state.money,cash);assert.equal(JSON.stringify({freight:game.state.freight,manifest:game.plane(p.id).freightManifest,conversion:game.plane(next.id).conversion}),data);
});
test('mixed fleets do not divide passenger demand or connection seats among freighters',()=>{
 const passenger=game.createPlane('kestrel',false,'LHR');game.assign(passenger.id,r.id,true);
 const mixed=game.typeProfit(r,AIRCRAFT.kestrel,2),withCargo=game.seatsPerDay(r);game.park(p);
 const alone=game.typeProfit(r,AIRCRAFT.kestrel,1);near(mixed.profit,alone.profit);near(withCargo,game.seatsPerDay(r));
});
test('rival freighters use finite cargo demand, pay all costs and choose a freight policy',()=>{
 const rv={id:1,hub:'FRA',hubs:[{id:'FRA',level:4,cargo:2,specialization:'cargo'}],routes:[],rep:60,style:4};
 const rr={hub:'FRA',dest:'DXB',type:'heron_f',price:1,cabin:0,service:'balanced',age:0};rv.routes=[rr];s.rivals=[rv];
 const q=routeEconomy(s,rv,rr);assert.equal(q.pax,0);assert.ok(q.cargoTonnes>0);assert.ok(q.cargoTonnes<=q.capacity);near(q.profit,q.revenue-q.cost);
 assert.ok(['bulk','express'].includes(rivalPolicyQuote(s,rv,rr).route.cargoService || 'bulk'));
});
test('a 12-day mixed network conserves freight through closures and service changes',()=>{
 game.assign(game.createPlane('kestrel',false,'LHR').id,r.id,true);s.events=[{type:'storm',airport:'FRA',start:3,days:2}];let changed=false;
 while(s.day<12){if(s.day===7 && !changed){game.setFreightService(r.id,'express');changed=true;}game.tick(10);
 const held=s.planes.reduce((n,p)=>n+tonnes(p.freightManifest),0);near(s.freight.booked,s.freight.delivered+s.freight.expired+s.freight.cancelled+waiting()+held);
 assert.ok(Number.isFinite(s.money));for(const plane of s.planes)assert.ok(tonnes(plane.freightManifest)<=AIRCRAFT[plane.type].cargo+1e-6);}
 assert.ok(s.freight.delivered>0);assert.ok(s.freight.expired>0);assert.ok(s.totalPax>0);
});

test('future mixed fleets share each market separately, including conversion previews',()=>{
 const passenger=game.createPlane('heron',false,'LHR');game.assign(passenger.id,r.id,true);
 const types=[AIRCRAFT.heron,AIRCRAFT.sparrow_f,AIRCRAFT.sparrow_f];
 const before=JSON.stringify(s),forecast=game.routeEstimate(r,types);
 const model=Object.assign(Object.create(game),{state:structuredClone(s),_cache:new Map(),_cacheKey:''});
 model.assign(model.createPlane('sparrow_f',false,'LHR').id,r.id,true);
 near(forecast,model.planesOn(r.id).reduce((n,p)=>n+model.typeProfit(model.route(r.id),AIRCRAFT[p.type],3).profit,0));
 assert.equal(JSON.stringify(s),before);
 const q=game.conversionQuote(passenger.id);model.state.planes=model.state.planes.filter(p=>p.id!==model.state.planes.at(-1).id);model.plane(passenger.id).type='heron_f';
 near(q.after,model.typeProfit(model.route(r.id),AIRCRAFT.heron_f,2).profit);
});
test('freight attention is live and clears when waiting bookings are canceled',async()=>{
 const {operationsAttention}=await import('../src/operationsAttention.js');
 r.cargoService='express';game.stepFreight(10);s.minute=1200;
 assert.ok(operationsAttention(game).alerts.some(a=>a.target.id===r.id && a.categories.includes('freight')));
 game.setFreightService(r.id,'bulk');assert.ok(!operationsAttention(game).alerts.some(a=>a.categories.includes('freight')));
});
test('conversion locks factory replacement and appears in forecasts only after completion',async()=>{
 const {disruptionForecast}=await import('../src/disruptions.js');p.type='sparrow';p.age=80;game.convertFreighter(p.id);
 assert.match(game.replacePlane(p.id),/conversion/);assert.equal(disruptionForecast(game,[r.id],1440).cargo,0);
 assert.ok(disruptionForecast(game,[r.id],4320).cargo>0);
});
test('cargo-only capacity advice uses tonnes rather than passenger warnings',async()=>{
 const {routeStatus}=await import('../src/routeStatus.js');const status=routeStatus({cargo:true,aircraftCount:1,want:10,seats:100,profit:1000,freightAtRisk:2});
 assert.equal(status.matches('freight'),true);assert.match(status.issues.find(i=>i.id==='spare').text,/tonnes/);
 assert.ok(!status.issues.some(i=>/passengers|seats/.test(i.text)));
});

test('long express previews account for late deliveries and expired bookings',()=>{
 const long=game.addRoute('LHR','HKG');long.cargoService='express';const q=game.freightForecast(long,AIRCRAFT.albatross_f);
 assert.ok(q.onTime>0 && q.onTime<.7);assert.ok(q.expired>0);assert.ok(q.penalties>0);assert.ok(q.onTimeTonnes<q.cargoTonnes);
 const raw=q.cargoTonnes*(350+long.km*1.1)*game.cargoMarket(long).rate;assert.ok(q.revenue<raw*.8);
});
test('closing a route settles remaining cargo bookings once',()=>{
 game.stepFreight(10);const cash=s.money,cost=Object.values(r.freightPools).flat().reduce((n,q)=>n+q.price*q.tonnes*.1,0),booked=s.freight.booked;
 game.closeRoute(r.id);near(cash-s.money,cost);near(s.freight.cancelled,booked);game.closeRoute(r.id);near(cash-s.money,cost);
});
test('freighter condition cannot depress passenger readiness on a mixed route',()=>{
 const passenger=game.createPlane('heron',false,'LHR');game.assign(passenger.id,r.id,true);
 const before=game.routeReadiness('LHR','FRA');p.age=400;p.phase='repair';near(game.routeReadiness('LHR','FRA'),before);
});
test('route finding separates passenger and freight businesses',()=>{
 assert.ok(game.estimate('LHR','JFK',null,null,'cargo').best.type.freighter);
 assert.ok(!game.estimate('LHR','JFK',null,null,'passenger').best.type.freighter);
 s.hubs[0].levels.cargo=0;assert.equal(game.estimate('LHR','JFK',null,null,'cargo').best,null);
});

test('mixed-route seat advice cannot recommend removing a zero-seat freighter',()=>{
 const passenger=game.createPlane('heron',false,'LHR');game.assign(passenger.id,r.id,true);
 r.yesterday={rev:0,cost:10000,pax:50,seats:500,flights:6,freight:{flights:3}};
 const advice=game.diagnose(r).join(' ');assert.ok(!advice.includes(p.name));assert.ok(!advice.includes('2 offer'));
});

test('freight service results retain passenger profit and stop comparisons during conversion',async()=>{
 const {estimateScope,collectChangeResults}=await import('../src/changeResults.js');
 const passenger=game.createPlane('heron',false,'LHR');game.assign(passenger.id,r.id,true);
 const before=estimateScope(game,[r.id]);game.setFreightService(r.id,'express');const change=s.managementChanges[0];
 near(change.estimatedBefore,before);near(change.estimatedAfter,estimateScope(game,[r.id]));
 game.convertFreighter(passenger.id);collectChangeResults(game);assert.equal(change.status,'changed');
});
