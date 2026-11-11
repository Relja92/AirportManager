import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {planConnections,connectionTime,CONNECTION_WAIT} from '../src/connections.js';
import {AIRCRAFT,GOALS,ACHIEVEMENTS} from '../src/data/catalog.js';
import {aircraftPlan} from '../src/aircraftManagement.js';
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v};
const {game}=await import('../src/game.js');
let s,hub,feeder,trunk;
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
function route(dest,type='heron',hubId='LHR') {const r=game.addRoute(hubId,dest),p=game.createPlane(type,false,hubId);game.assign(p.id,r.id,true);r.service='frequent';return {r,p};}
function origins(minutes=720) {game.stepConnections(minutes);for(const r of s.routes)game.growPassengerPools(r,minutes);}
function depart(connection,phase='turn') {connection.p.phase=phase;connection.p.t=1e4;game.stepPlane(connection.p,1);assert.ok(['out','back'].includes(connection.p.phase));}
function arrive(connection) {game.land(connection.p,connection.r,AIRCRAFT[connection.p.type]);}
function tracked() {return s.connections.queues.filter(q=>q.leg===1).reduce((n,q)=>n+q.count,0)+s.planes.reduce((n,p)=>n+(p.journeys||[]).reduce((a,q)=>a+q.count,0),0);}
beforeEach(()=>{game.silent=true;game.newGame('LHR');s=game.state;hub=s.hubs[0];s.money=50e6;s.minute=0;s.rivals=[];s.events=[];s.eventsUntil=1e9;s.rng=1234;
 hub.levels={runway:4,terminal:4,gates:4,amenities:1,cargo:1,fuel:1,marketing:1};s.goalsDone=GOALS.map(g=>g.id);s.achDone=ACHIEVEMENTS.map(a=>a.id);
 feeder=route('CDG','kestrel');trunk=route('JFK','heron');game._rev++;});

test('each connecting market consumes shared capacity on both legs without duplicate itineraries',()=>{
 const edges=[{id:1,hub:'LHR',dest:'CDG',km:344,price:1,capacity:40,flights:8},{id:2,hub:'LHR',dest:'JFK',km:5540,price:1,capacity:400,flights:8},{id:3,hub:'LHR',dest:'BOS',km:5260,price:1,capacity:400,flights:8}];
 const plan=planConnections(edges,[hub]);assert.ok(plan.pairs.length>=2);
 for(const e of edges)assert.ok((plan.rates[e.id]||0)<=plan.budgets[e.id]+1e-7);
 const duplicate=planConnections([...edges,{...edges[0],id:4,hub:'FRA',km:450},{...edges[1],id:5,hub:'FRA',km:6200}],[hub,{...hub,id:'FRA'}]);
 assert.equal(duplicate.pairs.filter(p=>p.key==='CDG:JFK').length,1);
 assert.ok(plan.pairs.some(p=>p.limited && p.bottleneck===1));
});

test('impractical detours and departures further apart than the connection window do not sell journeys',()=>{
 assert.equal(planConnections([{id:1,hub:'LHR',dest:'CDG',km:344,price:1,capacity:400,flights:8},{id:2,hub:'LHR',dest:'AMS',km:372,price:1,capacity:400,flights:8}],[hub]).pairs.length,0);
 assert.equal(planConnections([{id:1,hub:'LHR',dest:'CDG',km:344,price:1,capacity:400,flights:8},{id:2,hub:'LHR',dest:'JFK',km:5540,price:1,capacity:400,flights:1}],[hub]).pairs.length,0);
});

test('repairing or withdrawing the onward aircraft removes new connecting bookings',()=>{
 assert.ok(game.connectionPlan().pairs.length);trunk.p.phase='repair';game._rev++;
 assert.equal(game.connectionPlan().pairs.length,0);origins();assert.equal(s.connections.queues.length,0);
 trunk.p.phase='home';game._rev++;origins();assert.ok(s.connections.queues.length);
 game.assign(trunk.p.id,null);game.stepConnections(1);assert.equal(s.connections.queues.length,0);
});

test('connecting passengers appear at the transfer hub only after the first flight lands',()=>{
 origins();const before=s.connections.queues.filter(q=>q.leg===1).length;assert.equal(before,0);
 depart(feeder);const n=feeder.p.journeys.reduce((n,q)=>n+q.count,0);assert.ok(n>0);
 assert.equal(game.connectionQueueCount(trunk.r.id,'poolOut'),0);assert.equal(s.connections.today.started,n);
 arrive(feeder);assert.equal(s.connections.queues.filter(q=>q.leg===1).reduce((n,q)=>n+q.count,0),n);
 assert.equal(game.connectionQueueCount(trunk.r.id,'poolOut'),0);
 s.minute=connectionTime(hub);assert.equal(game.connectionQueueCount(trunk.r.id,'poolOut'),n);
 assert.equal(s.connections.total.started,tracked());
});

test('a two-leg journey uses real seats, pays each flown leg once, and completes only at its destination',()=>{
 origins();depart(feeder);const first=feeder.p.journeys.reduce((n,q)=>n+q.count,0);arrive(feeder);s.minute=connectionTime(hub);origins(0);
 depart(trunk,'home');const completed=trunk.p.journeys.filter(q=>q.leg===1).reduce((n,q)=>n+q.count,0);assert.ok(completed>0 && completed<=first);
 assert.ok(trunk.p.pax+trunk.p.biz<=AIRCRAFT.heron.seats);
 const revBefore=trunk.r.today.rev,people=trunk.p.pax+trunk.p.biz,expected=(trunk.p.pax+trunk.p.biz*game.businessMultiplier(hub))*game.ticket(trunk.r)+people*5+game.cargoIncome(AIRCRAFT.heron,trunk.r,hub);
 arrive(trunk);near(trunk.r.today.rev-revBefore,expected);assert.equal(s.connections.today.completed,completed);
 assert.equal(s.connections.total.started,s.connections.total.completed+s.connections.total.missed+tracked());
 const snapshot=JSON.stringify(s.connections);game.landConnections(trunk.p,trunk.r,'JFK');assert.equal(JSON.stringify(s.connections),snapshot);
});

test('missed connections pay compensation once and leave historical results without active queues',()=>{
 origins();depart(feeder);arrive(feeder);const n=tracked(),money=s.money;
 s.events.push({type:'storm',airport:'JFK',start:0,days:2});game._rev++;
 assert.equal(game.connectionStatus(trunk.r).atRisk,n);
 s.minute=CONNECTION_WAIT;game.stepConnections(0);
 assert.equal(s.connections.total.missed,n);assert.ok(s.money<money);near(money-s.money,s.connections.total.compensation);
 assert.equal(game.connectionStatus(trunk.r).atRisk,0);assert.equal(trunk.r.today.connections.missed,n);
 const cash=s.money;game.stepConnections(0);assert.equal(s.money,cash);
 game.closeConnectionDay();assert.equal(s.connections.yesterday.missed,n);assert.equal(s.connections.today.missed,0);
});

test('closing an onward route cannot strand or duplicate travelers already in flight',()=>{
 origins();depart(feeder);const n=tracked();game.closeRoute(trunk.r.id);arrive(feeder);
 assert.equal(s.connections.total.missed,n);assert.equal(tracked(),0);
});

test('previews and direct aircraft actions protect journeys currently in flight',()=>{
 origins();depart(feeder);const other=route('AMS','kestrel');
 for(const action of [{kind:'move',id:feeder.p.id,target:other.r.id},{kind:'swap',id:feeder.p.id,target:other.p.id},{kind:'park',id:feeder.p.id},{kind:'sell',id:feeder.p.id},{kind:'type',id:feeder.p.id,target:'heron'}]) assert.match(aircraftPlan(game,action).why,/land/);
 const snapshot=JSON.stringify(s);
 assert.match(game.swapPlanes(feeder.p.id,other.p.id),/land/);assert.match(game.assign(feeder.p.id,null),/land/);assert.match(game.closeRoute(feeder.r.id),/land/);assert.match(game.sellPlane(feeder.p.id),/land/);assert.match(game.changeType(feeder.p.id,'heron'),/land/);
 assert.equal(JSON.stringify(s),snapshot);
});

test('forecasts, service and hub-role previews are pure and react to shared leg capacity',()=>{
 const normal=game.connectionPlan();const snapshot=JSON.stringify(s);
 game.serviceQuote(trunk.r.id,'economy');game.specializationQuote('LHR','transfer');game.connectionStatus(trunk.r);
 assert.equal(JSON.stringify(s),snapshot);assert.ok(normal.rates[trunk.r.id]>0);
 hub.specialization='transfer';game._rev++;assert.ok(game.connectionPlan().pairs[0].wanted>normal.pairs[0].wanted);
 assert.ok(game.connectionPlan().rates[trunk.r.id]<=game.connectionPlan().budgets[trunk.r.id]);
 assert.ok(connectionTime(hub)<connectionTime({...hub,specialization:'general'}));
});

test('saving preserves exact waiting batches, onboard journeys and continuation',()=>{
 origins();depart(feeder);const before=structuredClone(s);game.save();assert.equal(game.load(),true);s=game.state;feeder={r:game.route(feeder.r.id),p:game.plane(feeder.p.id)};trunk={r:game.route(trunk.r.id),p:game.plane(trunk.p.id)};
 assert.deepEqual(s.connections,before.connections);assert.deepEqual(feeder.p.journeys,before.planes[0].journeys);
 arrive(feeder);s.minute=connectionTime(hub);origins(0);depart(trunk,'home');arrive(trunk);assert.ok(s.connections.total.completed>0);
});

test('legacy connection demand becomes local waiting demand without altering cash or flights',()=>{
 delete s.connectionVersion;delete s.connections;game.ensurePassengerPool(feeder.r,'poolOut');feeder.r.passengerPools.poolOut.connecting=7;feeder.r.poolOut+=7;
 feeder.p.phase='out';feeder.p.pax=15;feeder.p.passengers={leisure:5,business:0,connecting:10,charter:0};const flight=JSON.stringify(feeder.p),total=feeder.r.poolOut,cash=s.money;
 game.migrateConnections();assert.equal(feeder.r.poolOut,total);assert.equal(s.money,cash);assert.equal(JSON.stringify(feeder.p),flight);assert.equal(feeder.r.passengerPools.poolOut.connecting,0);
 const snapshot=JSON.stringify(s);game.migrateConnections();assert.equal(JSON.stringify(s),snapshot);
});

test('arriving transfers board before fresh economy bookings and never overfill the aircraft',()=>{
 origins();depart(feeder);arrive(feeder);s.minute=connectionTime(hub);const waiting=game.connectionQueueCount(trunk.r.id,'poolOut');
 const pool=game.ensurePassengerPool(trunk.r,'poolOut');pool.leisure=1e4;pool.business=1000;trunk.r.poolOut=Object.values(pool).reduce((n,v)=>n+v,0);
 const load=game.boardPassengers(trunk.r,AIRCRAFT.heron,'poolOut');assert.equal(load.journeys.filter(q=>q.leg===1).reduce((n,q)=>n+q.count,0),Math.min(waiting,AIRCRAFT.heron.seats));assert.ok(load.eco<=AIRCRAFT.heron.seats);
});

test('moving a feeder previews the changed onward-route economics without changing live bookings',()=>{
 trunk.p.type='albatross';game._rev++;
 const snapshot=JSON.stringify(s),plan=aircraftPlan(game,{kind:'park',id:feeder.p.id});
 assert.equal(plan.why,null);const linked=plan.routes.find(x=>x.route.id===trunk.r.id);assert.ok(linked);assert.ok(linked.after<linked.before);assert.equal(JSON.stringify(s),snapshot);
});

test('connection alerts link to the onward route and clear when the queued travelers board',async()=>{
 const {operationsAttention}=await import('../src/operationsAttention.js');
 origins();depart(feeder);arrive(feeder);s.minute=400;
 assert.ok(operationsAttention(game).alerts.find(a=>a.target.id===trunk.r.id && a.categories.includes('connections')));
 const status=game.connectionStatus(trunk.r);assert.ok(status.waitingJourneys.some(q=>q.firstRouteId===feeder.r.id));
 depart(trunk,'home');assert.equal(game.connectionStatus(trunk.r,false).waiting,0);
 assert.ok(!operationsAttention(game).alerts.find(a=>a.target.id===trunk.r.id && a.categories.includes('connections')));
});

test('hub links work in either stored direction and still require a real first landing',()=>{
 s.hubs.push({id:'FRA',levels:{...hub.levels},specialization:'general'});
 const link=route('LHR','heron','FRA');game._rev++;const pair=game.connectionPlan().pairs.find(p=>p.from==='FRA' && p.to==='JFK' && p.via==='LHR');assert.ok(pair);
 origins();depart(link,'home');assert.ok(link.p.journeys.some(q=>q.secondRouteId===trunk.r.id));
 arrive(link);assert.ok(s.connections.queues.some(q=>q.leg===1 && q.from==='FRA' && q.routeId===trunk.r.id && q.direction==='poolOut'));
});

test('boarding is blocked by an expired onward lease even before forecast cache refresh',()=>{
 origins();const q=s.connections.queues.find(q=>q.routeId===feeder.r.id && q.leg===0);assert.ok(q);
 trunk.p.lease={daily:100,end:s.minute,billedUntil:s.minute};
 const load=game.boardPassengers(feeder.r,AIRCRAFT.kestrel,'poolIn');assert.equal(load.counts.connecting,0);assert.equal(load.journeys.length,0);
});
