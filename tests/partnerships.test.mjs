import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {setupPartnership} from './partnershipFixture.mjs';
import {PARTNERSHIP_TERMS,partnerReservation,partnerSeats,partnerRouteId} from '../src/partnerships.js';
import {AIRCRAFT} from '../src/data/catalog.js';
import {routeEconomy,stepRivals} from '../src/rivals.js';
import {operationsAttention,resolveAlertTarget} from '../src/operationsAttention.js';
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v};
const {game}=await import('../src/game.js');
let s,rv,r,p,a;
const near=(x,y)=>assert.ok(Math.abs(x-y)<1e-6,`${x} != ${y}`);
function sign(terms='reciprocal') {assert.equal(game.applyPartnership(rv.id,terms),null);a=s.partnerships.agreements[0];return a;}
function inProgress() {return s.connections.queues.filter(q=>q.leg===1).reduce((n,q)=>n+q.count,0)+[...s.planes,...s.partnerships.flights].reduce((n,p)=>n+(p.journeys || []).reduce((m,q)=>m+q.count,0),0);}
beforeEach(()=>({s,rv,r,p}=setupPartnership(game)));

test('preview is pure, requires a useful network, and offers explicit negotiated terms',()=>{
 const before=JSON.stringify(s),q=game.partnershipQuote(rv.id);
 assert.equal(q.why,null);assert.ok(q.volume>0);assert.ok(q.pairs.every(p=>p.via==='CDG'));assert.equal(JSON.stringify(s),before);
 assert.equal(q.fee,75000);s.rep=45;game._rev++;
 assert.match(game.partnershipQuote(rv.id).why,/reputation 50/);assert.equal(game.partnershipQuote(rv.id,'access').why,null);
 rv.routes=[];game._rev++;assert.match(game.partnershipQuote(rv.id,'access').why,/No viable shared/);
});
test('confirmation checks current state, charges once, and preserves booked revenue shares',()=>{
 game.partnershipQuote(rv.id);s.money=1;assert.match(game.applyPartnership(rv.id,'reciprocal'),/cash/);
 s.money=50e6;const cash=s.money;sign();near(s.money,cash-75000);assert.match(game.applyPartnership(rv.id,'reciprocal'),/already/);
 game.stepConnections(720);const q=s.connections.queues.find(q=>q.routeId===r.id),manifest=game.takeConnectionPassengers(r,q.direction,4);
 assert.ok(manifest.length);assert.equal(manifest[0].receive,.1);a.terms='access';assert.equal(manifest[0].pay,.1);
});
test('cash shortages and fare wars prevent acceptance',()=>{
 rv.cash=-1;assert.match(game.applyPartnership(rv.id,'reciprocal'),/cash reserves/);rv.cash=20e6;rv.routes[0].war=10;
 assert.match(game.applyPartnership(rv.id,'reciprocal'),/fare war/);
});
test('all itineraries share player capacity and the reserved partner cabin',()=>{
 sign();const plan=game.connectionPlan();assert.ok(plan.pairs.some(p=>p.agreementId===a.id));
 for(const [id,rate] of Object.entries(plan.rates))assert.ok(rate<=plan.budgets[id]+1e-7);
 for(const pair of plan.pairs)assert.ok(typeof pair.firstRouteId==='number' || typeof pair.secondRouteId==='number');
 const rr=rv.routes[0];assert.equal(partnerReservation(s,rv,rr),partnerSeats(rr));
 const reserved=routeEconomy(s,rv,rr);a.status='ended';game._rev++;const free=routeEconomy(s,rv,rr);
 assert.ok(reserved.load<=1);assert.ok(reserved.pax<=free.pax || reserved.flights!==free.flights);
});
test('real flights exchange passengers both ways without losing or duplicating journeys',()=>{
 sign();for(let i=0;i<4*144;i++){game.tick(10);assert.equal(s.connections.total.started,s.connections.total.completed+s.connections.total.missed+inProgress());
 for(const flight of s.partnerships.flights)assert.ok((flight.journeys || []).reduce((n,q)=>n+q.count,0)<=partnerSeats(flight.route || game.journeyRoute(flight.routeId)));}
 assert.ok(a.total.sent>0);assert.ok(a.total.received>0);assert.ok(a.total.earned>0);assert.ok(a.total.paid>0);
 assert.ok(a.total.completed>0);assert.ok(rv.partnerYesterday.pax>0);assert.ok(s.partnerships.flights.length<=rv.routes.length);
});
test('outbound referral is paid only after the partner flight lands and rival cash reconciles',()=>{
 sign();const rr=game.journeyRoute(partnerRouteId(a,rv.routes[0]));
 const q={key:'LHR:CDG:JFK',agreementId:a.id,routeId:rr.id,firstRouteId:r.id,secondRouteId:rr.id,from:'LHR',via:'CDG',to:'JFK',leg:1,count:10,firstFare:100,receive:.1,pay:.1,readyAt:0,deadline:720,direction:'poolOut'};
 s.connections.queues=[q];const cash=s.money,rivalCash=rv.cash;game.stepPartnerships(1);near(s.money,cash);near(rv.cash,rivalCash);
 const flight=s.partnerships.flights[0],fare=flight.fare;s.minute=flight.arriveAt;game.stepPartnerships(1);
 near(s.money,cash+10*fare*.1);near(rv.cash,rivalCash+10*fare*.9);near(s.today.partnerIncome,10*fare*.1);
 near(r.today.rev,10*fare*.1);assert.equal(a.total.sent,10);
 const after=rv.cash;game.stepPartnerships(1);near(rv.cash,after);
});
test('inbound flights pay the partner referral and record the player route cost',()=>{
 sign();const partnerId=partnerRouteId(a,rv.routes[0]),cash=s.money,rivalCash=rv.cash;
 p.journeys=[{agreementId:a.id,leg:1,firstRouteId:partnerId,secondRouteId:r.id,from:'JFK',via:'CDG',to:'LHR',count:7,pay:.18,receive:.08}];
 p.profit=1000;p.day=1000;game.landConnections(p,r,'LHR');const referral=7*game.ticket(r)*.18;
 near(s.money,cash-referral);near(rv.cash,rivalCash+referral);near(r.today.cost,referral);near(p.profit,1000-referral);assert.equal(a.total.received,7);
});
test('daily rival accounting includes settled partnership earnings without paying them twice',()=>{
 sign();game.recordPartnerEarnings(rv,null,{rev:250,cost:40,pax:3});rv.cash+=210;
 const before=rv.cash;s.day=1;s.minute=1440;stepRivals(s,()=>.99);
 near(rv.cash-before,rv.profit-210);assert.deepEqual(rv.partnerYesterday,{rev:250,cost:40,pax:3});assert.equal(rv.partnerDay,undefined);
});
test('ending stops new sales while booked onward flights retain their seats and terms',()=>{
 sign();game.stepConnections(720);const origin=s.connections.queues.find(q=>q.routeId===r.id);const manifest=game.takeConnectionPassengers(r,origin.direction,3);
 assert.ok(manifest.length);assert.equal(game.applyPartnership(rv.id,a.terms,'end'),null);
 assert.equal(game.connectionReady(origin),false);assert.equal(game.connectionPlan().pairs.filter(p=>p.agreementId).length,0);
 p.journeys=manifest;game.landConnections(p,r,'CDG');const transfer=s.connections.queues.find(q=>q.leg===1);
 assert.ok(transfer);s.minute=transfer.readyAt;assert.equal(game.connectionReady(transfer),true);
 assert.ok(partnerReservation(s,rv,rv.routes.find(rr=>partnerRouteId(a,rr)===transfer.routeId))>0);
 assert.match(game.applyPartnership(rv.id,'reciprocal'),/seven days/);
});
test('renewal extends once from the original end and revalidates the agreement',()=>{
 sign();assert.match(game.applyPartnership(rv.id,'reciprocal','renew'),/final three/);
 const end=a.end;s.minute=end-1440;game._rev++;assert.equal(game.applyPartnership(rv.id,'access','renew'),null);
 assert.equal(a.end,end+28*1440);assert.equal(a.terms,'access');assert.match(game.applyPartnership(rv.id,'access','renew'),/final three/);
});
test('expiry and closed airlines stop bookings; a replacement airline cannot inherit the agreement',()=>{
 sign();s.minute=a.end;game.stepPartnerships(1);assert.equal(a.status,'expired');assert.equal(game.connectionPlan().pairs.filter(p=>p.agreementId).length,0);
 rv.generation='replacement';assert.equal(game.agreementRival(a),null);assert.equal(game.agreementFor(rv.id),undefined);
});
test('missed connections charge the onward operator exactly once',()=>{
 sign();const cash=s.money,rivalCash=rv.cash;
 s.connections.queues=[{agreementId:a.id,leg:1,routeId:partnerRouteId(a,rv.routes[0]),secondRouteId:partnerRouteId(a,rv.routes[0]),firstRouteId:r.id,count:6,firstFare:200,deadline:0}];
 game.stepConnections(1);near(s.money,cash);near(rv.cash,rivalCash-300);assert.equal(a.total.partnerCompensation,300);assert.equal(a.total.missed,6);
 game.stepConnections(1);near(rv.cash,rivalCash-300);
 s.connections.queues=[{agreementId:a.id,leg:1,routeId:r.id,secondRouteId:r.id,count:5,firstFare:100,deadline:0}];game.stepConnections(1);
 near(s.money,cash-125);assert.equal(a.total.compensation,125);
});
test('saved agreements, waiting transfers and flights round-trip without charging again',()=>{
 sign();for(let i=0;i<50;i++)game.tick(10);const before=JSON.stringify(s.partnerships),cash=s.money,connections=JSON.stringify(s.connections);
 game.save();assert.equal(game.load(),true);assert.equal(JSON.stringify(game.state.partnerships),before);near(game.state.money,cash);assert.equal(JSON.stringify(game.state.connections),connections);
 delete game.state.partnerships;game.save();assert.equal(game.load(),true);assert.deepEqual(game.state.partnerships,{agreements:[],flights:[],nextId:1});
});

test('live renewal and capacity alerts link to the exact agreement and clear on resolution',()=>{
 sign();s.minute=a.end-1440;game._rev++;
 let alerts=operationsAttention(game).alerts.filter(x=>x.categories.includes('partnerships'));
 assert.equal(alerts.length,1);assert.deepEqual(resolveAlertTarget(game,alerts[0]),{kind:'partnership',id:a.id});
 assert.equal(game.applyPartnership(rv.id,'reciprocal','renew'),null);
 assert.equal(operationsAttention(game).alerts.filter(x=>x.categories.includes('partnerships')).length,0);
 p.phase='repair';game._rev++;assert.ok(operationsAttention(game).alerts.some(x=>x.id===`partnership-${a.id}`));
 p.phase='home';game._rev++;assert.ok(!operationsAttention(game).alerts.some(x=>x.id===`partnership-${a.id}`));
});
test('onward route removal settles one claim and a closed partner cannot leave a fictitious payment',()=>{
 sign();const id=partnerRouteId(a,rv.routes[0]);s.connections.queues=[{agreementId:a.id,leg:1,routeId:id,secondRouteId:id,firstRouteId:r.id,count:4,firstFare:200,deadline:720}];
 rv.hub=null;rv.routes=[];game._rev++;const cash=s.money;
 game.stepConnections(1);near(s.money,cash-200);assert.equal(a.total.partnerCompensation,0);assert.equal(a.total.compensation,200);
 game.stepConnections(1);near(s.money,cash-200);
});
test('takeover waits for the agreement and booked passengers to finish',()=>{
 sign();assert.match(game.whyNotTakeover(rv.id),/End the partnership/);
 a.status='ended';s.connections.queues=[{agreementId:a.id,leg:1,routeId:r.id,count:1}];assert.match(game.whyNotTakeover(rv.id),/remaining partnership journeys/);
 s.connections.queues=[];assert.doesNotMatch(game.whyNotTakeover(rv.id),/partnership/);
});
test('two active partners is the limit and expired agreements release a slot',()=>{
 sign();s.partnerships.agreements.push({...a,id:2,rivalId:99});s.partnerships.nextId=3;
 const other=structuredClone(rv);other.id=8;other.generation='test-other';other.name='Another airline';other.routes=[{...rv.routes[0],dest:'MIA'}];s.rivals.push(other);
 assert.match(game.applyPartnership(other.id,'reciprocal'),/two active/);
 s.partnerships.agreements[1].status='expired';assert.equal(game.applyPartnership(other.id,'reciprocal'),null);
});
test('stopped traffic removes its scheduled aircraft after the last landing',()=>{
 sign();for(let i=0;i<50;i++)game.tick(10);assert.ok(s.partnerships.flights.length);
 assert.equal(game.applyPartnership(rv.id,'reciprocal','end'),null);
 for(let i=0;i<3*144;i++)game.tick(10);
 assert.equal(s.partnerships.flights.length,0);assert.equal(inProgress(),0);
 assert.equal(s.connections.total.started,s.connections.total.completed+s.connections.total.missed);
});

test('renewed sales cannot duplicate a still-operating expired partner flight',()=>{
 sign();s.minute=a.end;a.status='expired';p.journeys=[{agreementId:a.id,count:1}];
 assert.match(game.applyPartnership(rv.id,'reciprocal'),/remaining booked journeys/);
 delete p.journeys;assert.equal(game.applyPartnership(rv.id,'reciprocal'),null);
});
test('ending an agreement remains possible while the company has negative cash',()=>{
 sign();s.money=-1;assert.equal(game.applyPartnership(rv.id,'reciprocal','end'),null);assert.equal(s.money,-1);
});
