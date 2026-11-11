import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {AIRCRAFT,GOALS,ACHIEVEMENTS} from '../src/data/catalog.js';
import {SERVICES,LEASE_TERMS} from '../src/commercial.js';
import {SPECIALIZATIONS,specializationRequirementsFor} from '../src/specializations.js';
import {migrateRivals,stepRivals,routeEconomy,rivalPolicyQuote,rivalHubRoleQuote,reviewRivalLeases,competition} from '../src/rivals.js';
import {DAY,rivalAircraftValue,rivalLeaseTerms,rivalLeaseCommitment,rivalLeaseAccrued,rivalHubLevels,rivalRoleSetup,rivalHubUpkeep} from '../src/rivalCommercial.js';
let s,rv,r;
const near=(a,b,t=.00001)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);
function add(dest='CDG',over={}) {const route={hub:'FRA',dest,type:'kestrel',age:0,price:1,service:'balanced',cabin:0,lossDays:0,...over};rv.routes.push(route);return route;}
function lease(route=r,days=7) {route.lease=rivalLeaseTerms(s,route.type,days).lease;return route.lease;}
beforeEach(()=>{
 s={day:0,minute:0,diff:'normal',hubs:[{id:'LHR'}],routes:[],planes:[],events:[],rivals:[],fuel:1,rep:50};
 rv={id:1,name:'Test Air',color:'#fff',hub:'FRA',hubs:[{id:'FRA',level:3}],routes:[],cash:50e6,history:[100000],profit:100000,cost:50000,rep:55,next:1e9,nextHub:1e9,nextRole:1e9,aiVersion:2,style:0};s.rivals.push(rv);r=add();migrateRivals(s);
});

test('rival leases use the same setup fees, rates and minimum terms as the player',()=>{
 for(const t of Object.values(AIRCRAFT)) for(const term of LEASE_TERMS) {
  const q=rivalLeaseTerms(s,t.id,term.days);near(q.fee,Math.round(t.price*.03));near(q.lease.daily,Math.round(t.price*term.rate));near(q.commitment,q.fee+term.days*q.lease.daily);assert.equal(q.lease.end,term.days*DAY);
 }
});

test('leases have no resale value and the remaining commitment shrinks only with elapsed time',()=>{
 const owned=rivalAircraftValue(r);assert.ok(owned>0);const l=lease();assert.equal(rivalAircraftValue(r),0);
 near(rivalLeaseCommitment(rv,0),7*l.daily);near(rivalLeaseCommitment(rv,2*DAY),5*l.daily);
 near(rivalLeaseAccrued(rv,DAY/4),l.daily/4);l.billedUntil=DAY/4;near(rivalLeaseAccrued(rv,DAY/4),0);
});

test('daily rent is charged during closures and is never charged twice',()=>{
 const l=lease(),cash=rv.cash;s.events=[{type:'storm',airport:'FRA',start:0,days:3}];s.day=1;stepRivals(s,()=>.5);
 assert.equal(rv.leaseRent,l.daily);assert.equal(rv.pax,0);assert.equal(rv.cash,cash+rv.profit);assert.equal(l.billedUntil,DAY);
 const before=rv.cash;s.day=2;stepRivals(s,()=>.5);assert.equal(rv.leaseRent,l.daily);assert.equal(rv.cash,before+rv.profit);
});

test('full days of rent are paid exactly once before a profitable expiry buys a new owned aircraft',()=>{
 const l=lease();l.billedUntil=6*DAY;s.day=7;const cash=rv.cash;stepRivals(s,()=>.5);
 assert.equal(r.lease,undefined);assert.equal(r.age,0);assert.equal(rv.commercialStats.purchased,1);
 near(rv.cash,cash+rv.profit-AIRCRAFT[r.type].price);near(rv.leaseRent,l.daily);assert.equal(rivalLeaseCommitment(rv,7*DAY),0);
});

test('a viable cash-constrained airline renews an affordable lease without inventing a purchase',()=>{
 s.diff='easy';const l=lease();l.billedUntil=6*DAY;s.day=7;rv.cash=900000;rv.cost=0;const cash=rv.cash;
 stepRivals(s,()=>.5);assert.ok(r.lease);assert.equal(l.end,14*DAY);assert.equal(rv.commercialStats.renewed,1);assert.equal(rv.commercialStats.purchased,0);near(rv.cash,cash+rv.profit);near(rivalLeaseCommitment(rv,7*DAY),l.daily*7);
});

test('expiry returns unaffordable aircraft and cannot generate resale cash',()=>{
 const l=lease();l.billedUntil=6*DAY;s.day=7;rv.cash=0;const cash=rv.cash;stepRivals(s,()=>.5);
 assert.equal(rv.routes.length,0);assert.equal(rv.commercialStats.returned,1);near(rv.cash,cash+rv.profit);
 reviewRivalLeases(s,rv);near(rv.cash,cash+rv.profit);
});

test('withdrawing early settles all remaining rent without crediting the leased aircraft value',()=>{
 Object.assign(r,{dest:'LUX',type:'condor',price:.6,age:0,lossDays:20,avgProfit:-1e6});lease(r,30);rv.hubs[0].level=5;rv.cash=1000;rv.next=0;s.day=1;
 const cash=rv.cash,daily=r.lease.daily;stepRivals(s,()=>.5);
 assert.ok(!rv.routes.includes(r));near(rv.cash,cash+rv.profit-29*daily);assert.equal(rv.commercialStats.returned,1);
});

test('service preferences alter business demand, departure frequency and competitive pressure',()=>{
 const normal=routeEconomy(s,rv,r),frequent=routeEconomy(s,rv,{...r,service:'frequent'}),economy=routeEconomy(s,rv,{...r,service:'economy'});
 assert.ok(frequent.segments.business>normal.segments.business);assert.ok(economy.segments.business<normal.segments.business);assert.ok(frequent.flights>=normal.flights);assert.ok(economy.flights<=normal.flights);
 const share=competition(s,'FRA','CDG',1).share;r.service='frequent';assert.ok(competition(s,'FRA','CDG',1).share<share);
});

test('policy review chooses profitable service and cabin changes without mutating the quote',()=>{
 Object.assign(r,{type:'heron',price:.65,service:'frequent',cabin:0});const snapshot=JSON.stringify(s),q=rivalPolicyQuote(s,rv,r);
 assert.equal(JSON.stringify(s),snapshot);assert.ok(q.profit>=routeEconomy(s,rv,r,{steady:true}).profit);assert.ok(SERVICES[q.route.service]);assert.ok([0,1,2].includes(q.route.cabin));
 rv.next=0;s.day=1;stepRivals(s,()=>.5);assert.ok(SERVICES[r.service]);assert.ok(Number.isFinite(r.profit));
});

test('budget and premium roles apply both benefits and penalties to rival earnings',()=>{
 rv.hubs[0].specialization='budget';const fit=routeEconomy(s,rv,{...r,price:.9}),wrong=routeEconomy(s,rv,{...r,price:1.2,cabin:1});
 assert.ok(fit.pax>wrong.pax);const budgetUpkeep=rivalHubUpkeep(rv.hubs[0],s);
 rv.hubs[0].specialization='general';assert.ok(rivalHubUpkeep(rv.hubs[0],s)>budgetUpkeep);
 rv.hubs[0].specialization='premium';r.cabin=1;const premium=routeEconomy(s,rv,r);rv.hubs[0].specialization='general';const general=routeEconomy(s,rv,r);
 assert.ok(premium.revenue>general.revenue);assert.ok(premium.cost>general.cost);
});

test('cargo facilities earn freight revenue; cargo specialization boosts freight with a passenger tradeoff',()=>{
 r.type='heron';r.dest='IST';const empty=routeEconomy(s,rv,r);assert.equal(empty.cargo,0);
 rv.hubs[0].cargo=2;const freight=routeEconomy(s,rv,r);assert.ok(freight.cargo>0);
 rv.hubs[0].specialization='cargo';const role=routeEconomy(s,rv,r);assert.ok(role.cargo>freight.cargo);assert.ok(role.pax<freight.pax);
});

test('transfer specialization needs operating feeders and benefits frequent connections',()=>{
 rv.hubs[0].specialization='transfer';const none=routeEconomy(s,rv,r).segments.connecting;assert.equal(none,0);
 const feeder=add('DXB',{service:'frequent',type:'heron'});const connected=routeEconomy(s,rv,{...r,service:'frequent'}).segments.connecting;assert.ok(connected>0);
 s.events=[{type:'storm',airport:feeder.dest,start:0,days:2}];near(routeEconomy(s,rv,r).segments.connecting,0);
});

test('hub-role quotes are pure and pay for facilities, fees and ongoing airport upkeep',()=>{
 add('AMS');add('MAD');const h=rv.hubs[0],snapshot=JSON.stringify(s),q=rivalHubRoleQuote(s,rv,h.id,'premium');
 assert.equal(q.why,null);assert.equal(JSON.stringify(s),snapshot);near(q.cost,SPECIALIZATIONS.premium.fee+150000+500000);
 assert.equal(q.hub.amenities,2);assert.ok(rivalHubUpkeep(q.hub,s)>rivalHubUpkeep(h,s));assert.ok(q.requirements.every(r=>r.met));
 assert.deepEqual(q.requirements,specializationRequirementsFor(rivalHubLevels(q.hub),'premium',rv.routes.length));
});

test('role commitments and cash reserved for future leases block conversions',()=>{
 const h=rv.hubs[0];h.specialization='budget';h.specializationUntil=14;s.day=10;assert.match(rivalHubRoleQuote(s,rv,h.id,'premium').why,/committed/);
 s.day=14;rv.cash=700000;lease(r,30);assert.match(rivalHubRoleQuote(s,rv,h.id,'general').why,/reserves/);
});

test('rival role unlocks match player requirements, including three routes for a transfer hub',()=>{
 const h=rv.hubs[0];assert.ok(rivalRoleSetup(h,'transfer',2,s).why);assert.equal(rivalRoleSetup(h,'transfer',3,s).why,null);
 assert.ok(rivalRoleSetup({...h,level:1},'premium',4,s).why);
 const cargo=rivalRoleSetup(h,'cargo',1,s);assert.equal(cargo.hub.cargo,2);assert.ok(cargo.cost>SPECIALIZATIONS.cargo.fee);
});

test('save migration preserves commercial decisions, lease obligations and existing cash',()=>{
 r.service='frequent';r.cabin=1;lease(r,14);rv.hubs[0].specialization='premium';rv.hubs[0].amenities=2;rv.hubs[0].specializationUntil=14;rv.cash=123456;
 const copy=structuredClone(s);migrateRivals(copy);assert.deepEqual(copy,s);
});

test('takeovers carry leases, facilities, hub roles and route settings without granting rented assets',async()=>{
 globalThis.localStorage={getItem:()=>null,setItem:()=>{}};const {game}=await import('../src/game.js');game.silent=true;game.newGame('LHR');
 const state=game.state;state.money=200e6;state.events=[];state.contracts=[];state.goalsDone=GOALS.map(g=>g.id);state.achDone=ACHIEVEMENTS.map(a=>a.id);
 r.cabin=1;r.service='frequent';lease(r,14);Object.assign(rv.hubs[0],{specialization:'premium',specializationUntil:14,amenities:2});
 Object.assign(rv,{cash:-100000,str:10,lossDays:8,negativeDays:3,cost:100000});state.rivals=[rv];
 const leasedPrice=game.takeoverCost(rv),terms=structuredClone(r.lease);delete r.lease;const ownedPrice=game.takeoverCost(rv);r.lease=terms;assert.ok(ownedPrice>leasedPrice);
 const cash=state.money;assert.equal(game.takeover(rv.id),null);near(state.money,cash-leasedPrice);const p=state.planes[0],route=game.route(p.routeId),hub=game.hub('FRA');
 assert.equal(route.service,'frequent');assert.equal(route.cabin,1);assert.equal(hub.specialization,'premium');assert.equal(hub.levels.amenities,2);assert.equal(hub.specializationUntil,14);
 assert.equal(p.lease.end,terms.end);assert.equal(p.lease.daily,terms.daily);assert.equal(p.lease.billedUntil,state.minute);assert.equal(game.planeValue(p),0);
 const after=state.money;game.tick(5);near(after-state.money,terms.daily*5/DAY);assert.ok(p.lease);
});

test('a value carrier pays to become Budget and keeps its low-fare economy strategy',()=>{
 rv.style=1;rv.hubs[0].level=2;rv.cash=1e6;rv.cost=0;rv.next=0;rv.nextRole=0;s.diff='easy';r.price=.9;
 for(const dest of ['AMS','MAD','ZRH']) add(dest,{price:.9});const cash=rv.cash;s.day=1;stepRivals(s,()=>.5);
 assert.equal(rv.hubs[0].specialization,'budget');assert.equal(rv.hubs[0].specializationUntil,15);assert.equal(rv.commercialStats.roles,1);
 near(rv.cash,cash+rv.profit-SPECIALIZATIONS.budget.fee);assert.ok(rv.routes.every(r=>r.cabin===0 && r.price<=.9));
 assert.ok(rv.decisions.some(d=>/Converted/.test(d.text)));
});

test('commercial choices remain deterministic across save/load, including an approaching lease expiry',()=>{
 lease(r,7);r.service='frequent';r.cabin=1;rv.hubs[0].specialization='premium';rv.hubs[0].amenities=2;rv.hubs[0].specializationUntil=14;
 const copy=structuredClone(s);migrateRivals(copy);
 for(let day=1;day<=9;day++) {s.day=copy.day=day;stepRivals(s,()=>.5);stepRivals(copy,()=>.5);}
 assert.deepEqual(copy,s);
});
