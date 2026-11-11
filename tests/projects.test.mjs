import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {AIRCRAFT,GOALS,ACHIEVEMENTS} from '../src/data/catalog.js';
import {AIRPORT_PROJECTS,projectEffects,constructionDelay} from '../src/projects.js';
import {freightHold} from '../src/cargo.js';
import {operationsAttention,resolveAlertTarget} from '../src/operationsAttention.js';
import {collectChangeResults} from '../src/changeResults.js';
import {disruptionForecast} from '../src/disruptions.js';
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v};
const {game}=await import('../src/game.js');
let s,h;const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const work=p=>{const minutes=p.durations[p.stage]-p.worked;s.minute+=minutes;game.stepProjects(minutes);};
const start=kind=>{assert.equal(game.applyProject('LHR',kind),null);return h.projects.at(-1);};
const complete=kind=>{const p=start(kind);work(p);assert.equal(game.applyProject('LHR',p.id,'fund'),null);work(p);assert.equal(game.applyProject('LHR',p.id,'fund'),null);work(p);return p;};
const route=(type='sparrow',dest='FRA')=>{const r=game.addRoute('LHR',dest),p=game.createPlane(type,false,'LHR');game.assign(p.id,r.id,true);return {r,p};};
beforeEach(()=>{game.silent=true;game.newGame('LHR');s=game.state;s.rivals=[];s.rng=12345;s.events=[];s.eventsUntil=1e9;s.contracts=[];s.money=50e6;s.minute=0;
 s.goalsDone=GOALS.map(g=>g.id);s.achDone=ACHIEVEMENTS.map(a=>a.id);h=s.hubs[0];h.levels={runway:4,terminal:2,gates:2,amenities:1,cargo:2,fuel:1,marketing:1};});

test('quotes are pure, show all stage payments, and include local construction costs',()=>{
 route();const state=JSON.stringify(s),q=game.projectQuote('LHR','concourse');assert.equal(q.why,null);assert.equal(JSON.stringify(s),state);
 assert.equal(q.payments.reduce((n,x)=>n+x,0),q.total);near(q.cost,q.total*.25);assert.ok(q.durations.reduce((n,d)=>n+d,0)>=6*1440);
 assert.equal(q.afterRoutes,q.beforeRoutes+2);assert.equal(q.afterGates,q.beforeGates+2);assert.ok(q.afterUpkeep>q.beforeUpkeep);
});
test('project requirements and one active construction site are enforced without spending',()=>{
 h.levels.cargo=0;const cash=s.money;assert.match(game.applyProject('LHR','freight'),/requirements/);near(s.money,cash);
 start('solar');assert.match(game.applyProject('LHR','turnaround'),/current project/);
});
test('each stage charges once, pauses at its boundary, and does not spend while away',()=>{
 const cash=s.money,invested=s.invested,p=start('concourse');near(s.money,cash-p.payments[0]);assert.equal(projectEffects(h).gates,0);
 work(p);assert.equal(p.status,'awaiting');assert.equal(p.stage,1);const paid=p.paid;game.stepProjects(100*1440);near(p.paid,paid);near(p.worked,0);
 assert.equal(game.applyProject('LHR',p.id,'fund'),null);assert.match(game.applyProject('LHR',p.id,'fund'),/not waiting/);work(p);
 assert.equal(game.applyProject('LHR',p.id,'fund'),null);work(p);assert.equal(p.status,'complete');near(p.paid,p.total);near(s.money,cash-p.total);near(s.invested,invested+p.total);
 near(s.today.projectSpending,p.total);near(s.today.cost,0);game.stepProjects(9999);near(s.money,cash-p.total);
});
test('funding previews become stale if conditions change',()=>{
 const q=game.projectQuote('LHR','solar');s.minute++;
 assert.match(game.applyProject('LHR','solar','start',q.revision),/Conditions changed/);assert.equal(h.projects.length,0);
});
test('cash shortages leave stage progress and commitments unchanged',()=>{
 const p=start('solar');work(p);s.money=p.payments[1]-1;const before=JSON.stringify(p);
 assert.match(game.applyProject('LHR',p.id,'fund'),/Not enough cash/);assert.equal(JSON.stringify(p),before);near(game.projectFunding(),p.total-p.paid);
});
test('two completed sites block a third project and a duplicate project',()=>{
 complete('solar');complete('turnaround');assert.match(game.applyProject('LHR','freight'),/Both project sites/);assert.match(game.applyProject('LHR','solar'),/already occupies/);
});
test('canceling forfeits paid stages, removes book value and frees the site',()=>{
 const {p:plane}=route(),p=start('concourse');work(p);game.applyProject('LHR',p.id,'fund');const cash=s.money,assets=game.assets();
 assert.ok(constructionDelay(h)>0);const q=game.projectQuote('LHR',p.id,'cancel');near(q.writeOff,p.paid*.5);
 assert.equal(game.applyProject('LHR',p.id,'cancel'),null);near(s.money,cash);near(game.assets(),assets-q.writeOff);near(game.projectFunding(),0);near(constructionDelay(h),0);assert.equal(plane.routeId,s.routes[0].id);
 assert.match(game.applyProject('LHR',p.id,'fund'),/not waiting/);assert.equal(game.applyProject('LHR','solar'),null);
});
test('removing a concourse is blocked while extra aircraft or route capacity is in use',()=>{
 const p=complete('concourse');for(let i=0;i<5;i++)game.createPlane('sparrow',false,'LHR');const cash=s.money;
 assert.match(game.applyProject('LHR',p.id,'remove'),/aircraft/);near(s.money,cash);s.planes=[];
 for(const dest of ['FRA','CDG','AMS','MAD','ATH','BER','FCO'])game.addRoute('LHR',dest);
 assert.match(game.applyProject('LHR',p.id,'remove'),/Close 1 route/);s.routes.pop();const assets=game.assets();
 assert.equal(game.applyProject('LHR',p.id,'remove'),null);near(game.assets(),assets-p.paid*.5);near(s.money,cash-p.total*.1);assert.equal(game.routeCap(h),6);assert.equal(game.planeCap(h),4);
});
test('ground operations shorten only local turnaround, including actual departure timing',()=>{
 complete('turnaround');const {r,p}=route();near(game.turnaround(AIRCRAFT.sparrow,'LHR'),32);near(game.turnaround(AIRCRAFT.sparrow,'FRA'),40);near(game.routeTurnaround(AIRCRAFT.sparrow,r),36);
 r.poolOut=1000;game.stepPlane(p,31);assert.equal(p.phase,'home');game.stepPlane(p,1);assert.equal(p.phase,'out');
});
test('construction delays departures and forecasts, and waiting for funding removes the delay',()=>{
 const {r,p}=route();const before=game.plannedLegs(r,AIRCRAFT.sparrow);const site=start('solar');work(site);game.applyProject('LHR',site.id,'fund');r.poolOut=1000;
 near(game.turnaround(AIRCRAFT.sparrow,'LHR'),48);assert.ok(game.plannedLegs(r,AIRCRAFT.sparrow)<before);game.stepPlane(p,47);assert.equal(p.phase,'home');game.stepPlane(p,1);assert.equal(p.phase,'out');
 work(site);near(game.turnaround(AIRCRAFT.sparrow,'LHR'),40);near(constructionDelay(h),0);
});
test('freight depot changes real booking rates and usable holds without exceeding aircraft capacity',()=>{
 const {r}=route('heron_f');const before=game.cargoMarket(r).bulk,hold=freightHold(AIRCRAFT.heron_f,h);complete('freight');
 near(game.cargoMarket(r).bulk,before*1.15);near(freightHold(AIRCRAFT.heron_f,h),hold*1.1);game.stepFreight(60);near(r.freightPools.poolOut[0].tonnes,before*1.15/24);
 h.levels.cargo=4;h.specialization='cargo';assert.ok(freightHold(AIRCRAFT.heron_f,h)<=AIRCRAFT.heron_f.cargo);
});
test('solar cuts standard upkeep while other projects keep their listed running cost',()=>{
 const baseline=game.hubUpkeep(h);complete('solar');assert.ok(Math.abs(game.hubUpkeep(h)-baseline*.85)<=1);complete('concourse');assert.ok(Math.abs(game.hubUpkeep(h)-baseline*.85-4000)<=1);
});
test('save and load retain construction and never repeat payments',()=>{
 const p=start('freight');work(p);game.applyProject('LHR',p.id,'fund');p.worked=500;const cash=s.money,invested=s.invested,record=JSON.stringify(p);game.save();assert.equal(game.load(),true);
 near(game.state.money,cash);near(game.state.invested,invested);assert.equal(JSON.stringify(game.airportProject('LHR',p.id)),record);
});
test('legacy saves acquire empty project sites without changing their finances',()=>{
 delete h.projects;delete s.nextProjectId;const cash=s.money,assets=game.assets();game.save();assert.equal(game.load(),true);assert.deepEqual(game.hub('LHR').projects,[]);near(game.state.money,cash);near(game.assets(),assets);
});
test('funding alerts link to the exact project, clear on payment and remain readable after cancellation',()=>{
 const p=start('solar');work(p);let alert=operationsAttention(game).alerts.find(a=>a.categories.includes('projects'));assert.equal(alert.target.id,`LHR/${p.id}`);assert.deepEqual(resolveAlertTarget(game,alert),alert.target);
 game.applyProject('LHR',p.id,'fund');assert.ok(!operationsAttention(game).alerts.some(a=>a.categories.includes('projects')));game.applyProject('LHR',p.id,'cancel');assert.ok(resolveAlertTarget(game,alert));
});
test('construction invalidates earlier result comparisons and completion starts a fresh observation',()=>{
 const {r}=route();game.setPrice(r.id,-.1);const entry=s.managementChanges[0];const p=start('solar');collectChangeResults(game);assert.equal(entry.status,'changed');
 work(p);game.applyProject('LHR',p.id,'fund');work(p);game.applyProject('LHR',p.id,'fund');work(p);assert.equal(s.managementChanges[0].kind,'project');assert.equal(s.managementChanges[0].status,'watching');
});
test('disruption forecasts end paid construction but never assume later stages are funded',()=>{
 const {r}=route();const p=start('turnaround');const saved=JSON.stringify(s);const before=disruptionForecast(game,[r.id],10*1440);assert.equal(JSON.stringify(s),saved);
 p.status='complete';game._rev++;const after=disruptionForecast(game,[r.id],10*1440);assert.ok(after.passengers>=before.passengers);assert.ok(after.profit>before.profit);
});
test('separate hubs can build concurrently and only affected turnarounds change',()=>{
 s.hubs.push({id:'MAD',levels:{...h.levels},specialization:'general',projects:[]});const p=start('concourse');work(p);game.applyProject('LHR',p.id,'fund');
 assert.equal(game.applyProject('MAD','solar'),null);near(game.turnaround(AIRCRAFT.sparrow,'MAD'),40);near(game.turnaround(AIRCRAFT.sparrow,'LHR'),48);
});
test('construction at an owned destination invalidates a route comparison too',()=>{
 s.hubs.push({id:'FRA',levels:{...h.levels},specialization:'general',projects:[]});const {r}=route();game.setPrice(r.id,-.1);const entry=s.managementChanges[0];
 assert.equal(game.applyProject('FRA','turnaround'),null);collectChangeResults(game);assert.equal(entry.status,'changed');
});
test('offline simulation finishes a funded stage but never pays for another',()=>{
 route();const p=start('solar');p.worked=p.durations[0]-10;s.speed=1;s.savedAt=Date.now()-10*60*1000;const paid=p.paid,invested=s.invested;
 assert.ok(game.catchUp());assert.equal(p.status,'awaiting');assert.equal(p.stage,1);assert.equal(p.worked,0);near(p.paid,paid);near(s.invested,invested);
});
test('completed project upkeep is charged in the real daily ledger',()=>{
 const baseline=game.hubUpkeep(h);complete('solar');complete('concourse');s.today.cost=0;s.today.rev=0;s.day=Math.floor(s.minute/1440);
 const cash=s.money;game.tick(1440);const charged=game.state.yesterday.hubUpkeep.LHR;
 assert.ok(Math.abs(charged-baseline*.85-4000)<=1);near(cash-s.money,charged);assert.ok(!game.state.yesterday.projectRemoval);
});
