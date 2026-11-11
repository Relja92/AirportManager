import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AIRCRAFT, GOALS, ACHIEVEMENTS } from '../src/data/catalog.js';
import { liveIncidents, responseCases, responseContext, responseTargets, responseAircraft, responseQuote, disruptionForecast, contractOutlook, contractDeadline } from '../src/disruptions.js';
import { operationsAttention } from '../src/operationsAttention.js';
import { aircraftPlan, fleetMatches } from '../src/aircraftManagement.js';
const saved={};globalThis.localStorage={getItem:k=>saved[k]??null,setItem:(k,v)=>saved[k]=v};
const { game }=await import('../src/game.js');
let s, hub, r, p;
const near=(a,b)=>assert.ok(Math.abs(a-b)<.00001,`${a} != ${b}`);
function route(dest,hubId='LHR',type='heron') { const r=game.addRoute(hubId,dest);const p=game.createPlane(type,false,hubId);game.assign(p.id,r.id,true);return {r,p}; }
function repair(plane=p,t=0) {plane.phase='repair';plane.t=t;plane.resume='home';game.bumpRep(-.8);game.recordBreakdown(plane,.8);}
function storm(airport='CDG',days=2,type='storm') {const e={id:90+s.events.length,type,airport,start:0,days};s.events.push(e);game._rev++;return e;}
function contract({series,...over}={}) {const c={id:500,hub:'LHR',dest:'CDG',kind:'pax',amount:12000,done:0,due:2,days:3,reward:10000,...over,...(series?{series:{week:1,weeks:3}}:{})};s.contracts.push(c);game._rev++;return c;}
const target=()=>({kind:'route',id:r.id});
const quote=a=>responseQuote(game,target(),a);
function apply(a,t=target()) {const q=responseQuote(game,t,a);assert.equal(q.why,null);assert.equal(game.applyResponse(t,a,q.snapshot),null);return q;}
function advance(minutes){s.minute+=minutes;s.day=Math.floor(s.minute/1440);game._rev++;game.stepDisruptions(minutes);}
beforeEach(()=>{
 game.silent=true;game.newGame('LHR');s=game.state;hub=s.hubs[0];s.money=50e6;s.minute=0;s.rivals=[];s.events=[];s.eventsUntil=1e9;s.rng=2345;s.contracts=[];
 hub.levels={runway:4,terminal:4,gates:4,amenities:2,cargo:2,fuel:1,marketing:1};
 s.goalsDone=GOALS.map(g=>g.id);s.achDone=ACHIEVEMENTS.map(a=>a.id);({r,p}=route('CDG'));game._rev++;
});

test('all response previews are pure, including contract projections and candidate selection',()=>{
 repair();const spare=game.createPlane('kestrel',false,'LHR');const c=contract();const e=storm('AMS',2,'strike');route('AMS');
 const snapshot=JSON.stringify(s), rev=game._rev;
 const ctx=responseContext(game,target());responseAircraft(game,ctx,r.id);responseTargets(game,ctx);responseCases(game);contractOutlook(game,c);
 for(const action of [{kind:'move',planeId:spare.id,routeId:r.id},{kind:'lease',typeId:'kestrel',routeId:r.id},{kind:'service',routeId:r.id},{kind:'compensate',incidentKey:liveIncidents(game).find(i=>i.plane===p).key}]) assert.equal(quote(action).why,null);
 const strike=liveIncidents(game).find(i=>i.event===e);responseQuote(game,{kind:'route',id:strike.routeIds[0]},{kind:'settle',incidentKey:strike.key});
 assert.equal(JSON.stringify(s),snapshot);assert.equal(game._rev,rev);
});

test('temporary cover shows both routes, no free aircraft, and automatically returns between trips',()=>{
 repair();const donor=route('AMS');const count=s.planes.length,cash=s.money,beforeDonor=disruptionForecast(game,[donor.r.id],720).passengers;const q=apply({kind:'move',planeId:donor.p.id,routeId:r.id});
 assert.ok(q.routeIds.includes(donor.r.id));near(q.before.passengers,beforeDonor);assert.equal(q.routes.find(x=>x.route.id===donor.r.id).countAfter,0);assert.ok(q.after.passengers>0);assert.equal(s.planes.length,count);assert.equal(s.money,cash);
 assert.equal(donor.p.routeId,r.id);assert.equal(donor.p.recoveryAssignment.originalRoute,donor.r.id);
 p.phase='home';donor.p.phase='out';donor.p.pax=30;donor.p.t=4;game.stepDisruptions(5);
 assert.equal(donor.p.phase,'out');assert.equal(donor.p.pax,30);assert.equal(donor.p.routeId,r.id);assert.ok(donor.p.recoveryAssignment.pending);
 donor.p.phase='turn';game.stepDisruptions(5);assert.equal(donor.p.routeId,r.id);
 donor.p.phase='home';donor.p.pax=0;game.stepDisruptions(5);assert.equal(donor.p.routeId,donor.r.id);assert.equal(donor.p.recoveryAssignment,undefined);
 assert.equal(responseCases(game).returns.length,0);assert.equal(responseCases(game).routes.length,0);
});

test('parked reserve returns to parking and manual assignment cancels return',()=>{
 repair();const spare=game.createPlane('kestrel',false,'LHR');apply({kind:'move',planeId:spare.id,routeId:r.id});
 p.phase='home';game.stepDisruptions(5);assert.equal(spare.phase,'idle');assert.equal(spare.routeId,null);
 repair();apply({kind:'move',planeId:spare.id,routeId:r.id});const donor=route('AMS');
 assert.match(aircraftPlan(game,{kind:'move',id:spare.id,target:donor.r.id}).warning,/planned return/);
 game.movePlane(spare.id,donor.r.id);assert.equal(spare.recoveryAssignment,undefined);p.phase='home';game.stepDisruptions(5);assert.equal(spare.routeId,donor.r.id);
});

test('cross-hub returns wait for a free gate and clear their attention alert when resolved',()=>{
 repair();const other={id:'FRA',levels:{...hub.levels,gates:1}};s.hubs.push(other);const donor=route('AMS','FRA');
 apply({kind:'move',planeId:donor.p.id,routeId:r.id});
 while(game.planesAt('FRA').length<game.planeCap(other)) game.createPlane('kestrel',false,'FRA');
 p.phase='home';game.stepDisruptions(5);assert.equal(donor.p.hub,'LHR');assert.match(donor.p.recoveryAssignment.pending,/free gate/);
 assert.ok(fleetMatches(game,donor.p,'returns'));assert.ok(operationsAttention(game).alerts.find(a=>a.id===`plane-${donor.p.id}`).categories.includes('returns'));
 game.sellPlane(game.planesAt('FRA')[0].id);game.stepDisruptions(5);assert.equal(donor.p.hub,'FRA');assert.equal(donor.p.routeId,donor.r.id);assert.equal(fleetMatches(game,donor.p,'returns'),false);
});

test('keeping a temporary assignment requires a preview and cancels only the return',()=>{
 repair();const spare=game.createPlane('kestrel',false,'LHR');apply({kind:'move',planeId:spare.id,routeId:r.id});
 const cash=s.money;apply({kind:'keep',planeId:spare.id},{kind:'return',id:spare.id});assert.equal(spare.recoveryAssignment,undefined);assert.equal(s.money,cash);
 p.phase='home';game.stepDisruptions(5);assert.equal(spare.routeId,r.id);
});

test('closed destinations allow redeployment only from home; closed home airports block it',()=>{
 storm();const open=route('AMS');const ctx=responseContext(game,target());assert.equal(ctx.closed,true);
 assert.deepEqual(responseTargets(game,ctx).map(r=>r.id),[open.r.id]);assert.ok(responseAircraft(game,ctx,open.r.id).some(x=>x.id===p.id));
 for(const phase of ['out','back','turn','repair']) {p.phase=phase;assert.ok(!responseAircraft(game,ctx,open.r.id).some(x=>x.id===p.id));}
 p.phase='home';storm('LHR');assert.equal(responseAircraft(game,ctx,open.r.id).length,0);assert.equal(responseTargets(game,ctx).length,0);
 assert.match(quote({kind:'lease',typeId:'kestrel',routeId:r.id}).why,/open route/);
});

test('redeployed closure cases remain visible until reopening and return to the affected route',()=>{
 const e=storm();const open=route('AMS');apply({kind:'move',planeId:p.id,routeId:open.r.id});
 assert.ok(liveIncidents(game).find(i=>i.event===e).routeIds.includes(r.id));assert.ok(responseCases(game).routes.some(x=>x.id===r.id));
 advance(2880);assert.equal(p.routeId,r.id);assert.equal(responseCases(game).routes.length,0);
});

test('repair compensation restores only half the actual loss and cannot be bought twice',()=>{
 repair();const key=liveIncidents(game)[0].key,rep=s.rep,cash=s.money,fees=s.today.cost;
 const q=apply({kind:'compensate',incidentKey:key});near(s.rep,rep+.4);near(s.money,cash-q.cost);near(s.today.cost,fees+q.cost);near(s.today.recovery,q.cost);assert.equal(p.phase,'repair');
 const snapshot=JSON.stringify(s);assert.match(game.applyResponse(target(),{kind:'compensate',incidentKey:key},q.snapshot),/already/);assert.equal(JSON.stringify(s),snapshot);
 repair();assert.notEqual(liveIncidents(game)[0].key,key);assert.equal(liveIncidents(game)[0].compensated,false);
});

test('closure compensation halves only future time-weighted damage, survives reload, and is incident-wide',()=>{
 const e=storm('LHR',2,'strike');route('AMS');const key=liveIncidents(game)[0].key;
 const rep=s.rep;advance(360);near(s.rep,rep-1);const atPayment=s.rep;const q=apply({kind:'compensate',incidentKey:key});near(s.rep,atPayment);near(q.repSavedDaily,2);
 advance(360);near(s.rep,rep-1.5);game.stepDisruptions(360);near(s.rep,rep-1.5);
 assert.equal(liveIncidents(game).length,1);assert.equal(e.recovery.routeIds.length,2);
 game.save();game.load();s=game.state;assert.equal(liveIncidents(game)[0].compensated,true);assert.match(quote({kind:'compensate',incidentKey:key}).why,/already/);
});

test('overlapping closure penalties are capped, and inactive airports do not hurt reputation',()=>{
 storm('CDG',2,'strike');storm('LHR',2,'strike');storm('AMS');const rates=game.closureReputationRates();assert.equal(rates.length,2);near(rates.reduce((n,i)=>n+i.daily,0),4);
 const rep=s.rep;advance(720);near(s.rep,rep-2);
});

test('settlement spends the quoted fee, reopens all its routes and clears active alerts',()=>{
 const e=storm('LHR',2,'strike');route('AMS');const key=liveIncidents(game)[0].key, cash=s.money;const q=apply({kind:'settle',incidentKey:key});
 near(s.money,cash-q.cost);near(s.today.recovery,q.cost);assert.equal(e.settled,true);assert.ok(!game.closed('LHR'));assert.equal(responseCases(game).routes.length,0);
 assert.ok(!operationsAttention(game).alerts.some(a=>a.categories.includes('disrupted')));assert.ok(q.after.revenue>q.before.revenue);
 assert.ok(s.managementChanges[0].estimatedAfter>s.managementChanges[0].estimatedBefore);
});

test('leases state full minimum commitment, need a spare gate and keep original repair intact',()=>{
 repair();const count=s.planes.length,cash=s.money;const q=apply({kind:'lease',typeId:'kestrel',routeId:r.id});
 near(q.lease.commitment,q.lease.fee+q.lease.daily*7);near(cash-s.money,q.lease.fee);assert.equal(s.planes.length,count+1);assert.equal(p.phase,'repair');assert.equal(p.routeId,r.id);
 const leased=s.planes.at(-1);assert.equal(leased.lease.end,s.minute+7*1440);near(s.today.leases,q.lease.fee);assert.equal(s.today.recovery,0);
 while(s.planes.length<game.planeCap(hub)) game.createPlane('kestrel',false,'LHR');
 assert.match(quote({kind:'lease',typeId:'kestrel',routeId:r.id}).why,/gate/i);
});

test('forecasts account for repair completion, reopening and lease expiry',()=>{
 repair(p,660);const oneHour=disruptionForecast(game,[r.id],60),day=disruptionForecast(game,[r.id],1440);
 near(oneHour.passengers,0);assert.ok(oneHour.profit<0);assert.ok(day.passengers>0);assert.ok(day.passengers<disruptionForecast(game,[r.id],1440,{ignore:true}).passengers);
 p.phase='home';const lease=game.leaseQuote('heron','LHR',7,r.id);game.attachLease(p,lease);p.lease.end=s.minute+60;game._rev++;
 near(disruptionForecast(game,[r.id],1440).passengers,disruptionForecast(game,[r.id],60).passengers);
 delete p.lease;storm('CDG',1);const shut=disruptionForecast(game,[r.id],1440),twoDays=disruptionForecast(game,[r.id],2880);near(shut.passengers,0);assert.ok(twoDays.passengers>0);
});

test('contract projections use real deadlines and never award progress or extend targets',()=>{
 repair();const a=contract(),b=contract({id:501,series:true});assert.equal(contractDeadline(a),4320);assert.equal(contractDeadline(b),2880);
 const spare=game.createPlane('kestrel',false,'LHR'),due=a.due,cash=s.money;
 const before=contractOutlook(game,a);const q=apply({kind:'move',planeId:spare.id,routeId:r.id},{kind:'contract',id:a.id});
 assert.ok(q.contracts.find(c=>c.before.id===a.id).after.projected>before.projected);assert.equal(a.done,0);assert.equal(a.due,due);assert.equal(s.money,cash);
 a.done=a.amount;game.stepDisruptions(5);assert.equal(spare.routeId,null);assert.equal(spare.recoveryAssignment,undefined);
});

test('repeat contract cover returns after its paid week, even when the agreement continues',()=>{
 const c=contract({series:true});const spare=game.createPlane('kestrel',false,'LHR');apply({kind:'move',planeId:spare.id,routeId:r.id},{kind:'contract',id:c.id});
 c.paid=true;game.stepDisruptions(5);assert.equal(spare.routeId,null);assert.equal(responseContext(game,{kind:'contract',id:c.id}),null);
});

test('cargo contract forecasts count hold tonnage, and series only count the named hub',()=>{
 const c=contract({kind:'cargo',amount:1e5,series:true});const forecast=disruptionForecast(game,[r.id],2880);near(contractOutlook(game,c).projected,forecast.cargo);
 s.hubs.push({id:'FRA',levels:{...hub.levels}});route('CDG','FRA');game._rev++;assert.deepEqual(contractOutlook(game,c).routeIds,[r.id]);
 c.series=null;assert.equal(contractOutlook(game,c).routeIds.length,2);
});

test('invalid, cash-short and stale responses are atomic',()=>{
 repair();const spare=game.createPlane('kestrel',false,'LHR'),a={kind:'move',planeId:spare.id,routeId:r.id};const q=quote(a);s.minute+=5;
 const snapshot=JSON.stringify(s);assert.match(game.applyResponse(target(),a,q.snapshot),/Conditions changed/);assert.equal(JSON.stringify(s),snapshot);
 s.money=0;const next=JSON.stringify(s);assert.match(game.applyResponse(target(),{kind:'compensate',incidentKey:liveIncidents(game)[0].key},quote(a).snapshot),/cash/);assert.equal(JSON.stringify(s),next);
 spare.phase='out';const inFlight=JSON.stringify(s);assert.ok(quote(a).why);assert.equal(JSON.stringify(s),inFlight);
});

test('older saves load without invented refunds; new assignments survive reload',()=>{
 repair();delete p.breakdown;delete s.nextBreakdownId;delete s.today.recovery;game.migrateDisruptions();assert.equal(p.breakdown.repLoss,0);
 assert.match(quote({kind:'compensate',incidentKey:liveIncidents(game)[0].key}).why,/No recorded/);
 const spare=game.createPlane('kestrel',false,'LHR');apply({kind:'move',planeId:spare.id,routeId:r.id});const assignment=structuredClone(spare.recoveryAssignment);
 game.save();game.load();s=game.state;assert.deepEqual(game.plane(spare.id).recoveryAssignment,assignment);
 const snapshot=JSON.stringify(s);game.migrateDisruptions();assert.equal(JSON.stringify(s),snapshot);
});

test('real ticks finish repairs, return reserve aircraft and preserve contract accounting',()=>{
 repair(p,600);const spare=game.createPlane('kestrel',false,'LHR');const c=contract({amount:1000,reward:35000});
 apply({kind:'move',planeId:spare.id,routeId:r.id});apply({kind:'compensate',incidentKey:liveIncidents(game)[0].key});
 const cost=s.today.recovery;for(let i=0;i<1440/5;i++) game.tick(5);
 assert.equal(p.phase==='repair',false);assert.equal(spare.recoveryAssignment,undefined);assert.equal(spare.routeId,null);
 assert.equal(responseCases(game).routes.length,0);assert.ok(s.totalPax>0);assert.ok(c.done>0);assert.ok(c.done<=c.amount);
 near(s.yesterday.recovery,cost);assert.ok(s.money>0);assert.ok(Number.isFinite(s.rep));assert.ok(s.rep>=0 && s.rep<=100);
});

test('lease expiry during temporary cover removes the aircraft only once',()=>{
 repair();const spare=game.createPlane('kestrel',false,'LHR');game.attachLease(spare,game.leaseQuote('kestrel','LHR',7));spare.lease.end=30;
 apply({kind:'move',planeId:spare.id,routeId:r.id});
 for(let i=0;i<360/5;i++) game.tick(5);
 assert.equal(game.plane(spare.id),undefined);assert.equal(responseCases(game).returns.length,0);assert.equal(s.planes.filter(p=>p.id===spare.id).length,0);
});

test('a removed original route returns reserve aircraft to parking without resurrecting it',()=>{
 repair();const donor=route('AMS');apply({kind:'move',planeId:donor.p.id,routeId:r.id});game.closeRoute(donor.r.id);p.phase='home';game.stepDisruptions(5);
 assert.equal(donor.p.routeId,null);assert.equal(donor.p.hub,'LHR');assert.equal(donor.p.phase,'idle');assert.equal(game.route(donor.r.id),undefined);
});

test('a planned return cannot make a new breakdown vanish from forecasts',()=>{
 const c=contract();const spare=game.createPlane('kestrel',false,'LHR');apply({kind:'move',planeId:spare.id,routeId:r.id},{kind:'contract',id:c.id});
 repair(spare);spare.recoveryAssignment.until=30;game.assign(p.id,null,true);
 near(disruptionForecast(game,[r.id],60).passengers,0);assert.ok(disruptionForecast(game,[r.id],60).profit<0);
 c.paid=true;game.stepDisruptions(5);assert.equal(spare.phase,'repair');assert.equal(spare.routeId,r.id);
});
