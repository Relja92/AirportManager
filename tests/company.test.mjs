import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AIRCRAFT, GOALS, ACHIEVEMENTS } from '../src/data/catalog.js';
import { companyColor, companySoft, nameProblem, companyEventTarget } from '../src/company.js';
import { planeMatches, searchNetwork } from '../src/search.js';
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=String(v)};
const { game } = await import('../src/game.js');let s;
const events = key => s.company.timeline.filter(e=>e.key===key);
function aircraft(dest='VIE') {const r=game.addRoute('LHR',dest),p=game.createPlane('sparrow',false,'LHR');game.assign(p.id,r.id,true);return {r,p};}
function land(r,p,people=40) {p.phase='out';p.pax=people;p.biz=0;game.land(p,r,AIRCRAFT[p.type]);}
beforeEach(()=>{game.silent=true;game.newGame('LHR');s=game.state;s.rivals=[];s.events=[];s.eventsUntil=1e9;s.contracts=[];s.rng=12345;s.money=100e6;s.goalsDone=GOALS.map(g=>g.id);s.achDone=ACHIEVEMENTS.map(a=>a.id);s.hubs[0].levels={runway:4,terminal:4,gates:4,amenities:2,cargo:2,fuel:1,marketing:1};});

test('a new airline has a home, default livery and a dated founding entry',()=>{
 assert.equal(s.company.name,'London Air');assert.equal(s.company.home,'LHR');assert.equal(s.company.legacy,false);
 assert.equal(events('founded').length,1);assert.equal(events('founded')[0].minute,360);assert.equal(companyColor(s),'#ffb454');
});
test('branding changes are free, normalize names and do not change the network',()=>{
 aircraft();const cash=s.money,network=JSON.stringify([s.routes,s.planes]);
 assert.equal(game.setCompanyIdentity('  Adriatic   Airways  ','blue'),null);assert.equal(s.company.name,'Adriatic Airways');
 assert.equal(companyColor(s),'#7cc4e8');assert.equal(companySoft(s),'rgba(124,196,232,');assert.equal(s.money,cash);assert.equal(JSON.stringify([s.routes,s.planes]),network);
});
test('invalid branding is rejected atomically, including markup and control characters',()=>{
 const before=JSON.stringify(s.company);
 for(const name of ['', ' ', 'a'.repeat(41), '<img src=x>', 'Air\nLine', 'Air\u202Eline', 'a" onfocus="x']) assert.ok(game.setCompanyIdentity(name,'blue'));
 assert.ok(game.setCompanyIdentity('Valid','url(x)'));assert.equal(JSON.stringify(s.company),before);
 assert.equal(nameProblem("Željko's Air (Europe)"),null);
});
test('renaming an aircraft preserves registration and operational state, and search finds both',()=>{
 const {r,p}=aircraft();p.phase='out';p.t=12;p.pax=20;const before={...p},reg=p.registration;
 assert.equal(game.renameAircraft(p.id,'Јадран'),null);assert.deepEqual({...p,name:before.name},before);
 assert.ok(planeMatches(game,p,'Јадран'));assert.ok(planeMatches(game,p,reg));assert.equal(searchNetwork(game,'Јадран').planes[0],p);
 assert.equal(p.routeId,r.id);assert.equal(game.renameAircraft(p.id,reg),null);
});
test('aircraft names reject duplicates, excessive length and missing aircraft',()=>{
 const {p}=aircraft(),q=game.createPlane('sparrow',false,'LHR');game.renameAircraft(p.id,'Blue Bird');
 assert.match(game.renameAircraft(q.id,'blue bird'),/already uses/);assert.match(game.renameAircraft(q.id,'x'.repeat(33)),/32/);
 assert.match(game.renameAircraft(-1,'Ghost'),/no longer/);assert.notEqual(q.name,'blue bird');
});
test('aircraft name and registration survive replacement and transfer',()=>{
 const {p}=aircraft();game.renameAircraft(p.id,'Adriatic Star');const reg=p.registration;p.age=200;
 assert.equal(game.replacePlane(p.id),null);assert.equal(p.name,'Adriatic Star');assert.equal(p.registration,reg);
 assert.equal(game.buyHub('MAD'),null);p.hub='MAD';game.park(p);game.save();assert.equal(game.load(),true);s=game.state;
 assert.equal(game.plane(p.id).registration,reg);assert.ok(planeMatches(game,game.plane(p.id),reg));
});
test('first route and first completed flight are separate, one-time events',()=>{
 const {r,p}=aircraft();assert.equal(events('first-route').length,1);assert.equal(events('first-flight').length,0);
 s.minute=500;land(r,p);assert.equal(events('first-flight').length,1);assert.equal(events('first-flight')[0].minute,500);
 land(r,p);aircraft('ZRH');assert.equal(events('first-route').length,1);assert.equal(events('first-flight').length,1);
 assert.equal(s.company.records.longestFlight.from,'LHR');assert.equal(s.company.records.longestFlight.to,'VIE');
});
test('traffic milestones cross thresholds once and remain after news rolls over',()=>{
 const {r,p}=aircraft();s.totalPax=990;land(r,p);game.syncCompany();game.syncCompany();assert.equal(events('totalPax:1000').length,1);
 for(let i=0;i<80;i++)game.emit('toast',{text:'Routine event '+i});assert.equal(s.log.length,60);assert.equal(events('first-flight').length,1);
});
test('records retain fleet and route peaks after sales and route closures',()=>{
 const a=aircraft(),b=aircraft('ZRH');game.syncCompany();assert.equal(s.company.records.fleet,2);
 game.sellPlane(b.p.id);game.closeRoute(b.r.id);assert.equal(s.company.records.fleet,2);assert.equal(s.company.records.routes,2);assert.equal(s.planes.length,1);
});
test('busiest day counts actual landed passengers and records the closing day',()=>{
 const {r,p}=aircraft();land(r,p,42);game.endOfDay();assert.deepEqual(s.company.records.busiestDay,{day:0,pax:42,flights:1});
 s.day=1;s.minute=1440;land(r,p,10);game.endOfDay();assert.equal(s.company.records.busiestDay.day,0);
});
test('new hubs, goals and achievements are recorded once',()=>{
 assert.equal(game.buyHub('MAD'),null);assert.ok(game.buyHub('MAD'));assert.equal(events('hub:MAD').length,1);
 s.goalsDone=[];s.achDone=[];game.checkGoals();const n=s.company.timeline.length;game.checkGoals();assert.equal(s.company.timeline.length,n);assert.ok(s.company.timeline.some(e=>e.key.startsWith('goal:')));
});
test('construction completion is recorded by the real stage transitions',()=>{
 assert.equal(game.applyProject('LHR','solar'),null);const p=s.hubs[0].projects[0];
 for(let stage=0;stage<3;stage++){if(stage)assert.equal(game.applyProject('LHR',p.id,'fund'),null);game.stepProjects(p.durations[stage]);}
 assert.equal(p.status,'complete');assert.equal(events(`project:LHR:${p.id}`).length,1);game.stepProjects(10);assert.equal(events(`project:LHR:${p.id}`).length,1);
});
test('legacy migration keeps balances, restores dated completions and does not fabricate first flights',()=>{
 const {r,p}=aircraft();land(r,p);s.totalPax=20000;s.flights=300;s.minute=12*1440+100;s.day=12;
 s.hubs[0].projects=[{id:7,kind:'solar',status:'removed',completed:8000}];s.campaigns.runs.regional={phase:'complete',completed:9000,rewards:[]};
 s.listed={day:4,value:123};delete s.company;delete p.registration;const cash=s.money;
 game.migrateCompany();assert.equal(s.money,cash);assert.equal(s.company.legacy,true);assert.equal(events('project:LHR:7')[0].minute,8000);
 assert.equal(events('campaign:regional')[0].minute,9000);assert.equal(events('listing')[0].dayOnly,true);assert.ok(p.registration);
 game.syncCompany();aircraft('ZRH');land(r,p);assert.equal(events('first-flight').length,0);assert.equal(events('first-route').length,0);assert.equal(events('totalPax:10000').length,0);
 const before=JSON.stringify(s.company);game.migrateCompany();assert.equal(JSON.stringify(s.company),before);
});
test('legacy migration excludes the partially observed day from daily records',()=>{
 const {r,p}=aircraft();s.totalPax=99999;s.flights=999;s.minute=9*1440+300;s.day=9;delete s.company;game.migrateCompany();
 land(r,p);game.endOfDay();assert.equal(s.company.records.busiestDay,null);
 s.day=10;s.minute=10*1440;land(r,p,50);game.endOfDay();assert.equal(s.company.records.busiestDay.pax,50);
});
test('legacy registrations retain the original airport after an aircraft moved hubs',()=>{
 const {p}=aircraft();const original=p.name;delete p.registration;p.hub='MAD';delete s.company;
 game.migrateCompany();assert.equal(p.registration,original);
});
test('identity and permanent history round-trip through saving without duplicate entries',()=>{
 const {r,p}=aircraft();land(r,p);game.setCompanyIdentity('Adriatic Airways','green');game.renameAircraft(p.id,'Blue Bird');
 game.save();const before=JSON.stringify(s.company);assert.equal(game.load(),true);s=game.state;assert.equal(JSON.stringify(s.company),before);assert.equal(game.plane(p.id).name,'Blue Bird');
});
test('history retains the latest 500 milestones and does not resurrect archived ones',()=>{
 for(let i=0;i<510;i++)game.recordCompanyEvent('test:'+i,'network','Event '+i,'',400+i);
 assert.equal(s.company.timeline.length,500);assert.equal(s.company.archived,11);game.recordCompanyEvent('test:0','network','Duplicate');assert.equal(s.company.timeline.length,500);assert.equal(s.company.archived,11);
});
test('route history links survive save/load but do not point at a reopened replacement',()=>{
 const {r,p}=aircraft();land(r,p);const entry=events('first-flight')[0];
 assert.deepEqual(companyEventTarget(game,entry),{kind:'route',id:r.id});
 game.save();assert.equal(game.load(),true);s=game.state;assert.deepEqual(companyEventTarget(game,events('first-route')[0]),{kind:'route',id:r.id});
 game.park(game.plane(p.id));game.closeRoute(r.id);aircraft('VIE');assert.equal(companyEventTarget(game,events('first-flight')[0]),null);
 assert.equal(events('first-flight').length,1,'The historical event remains after its route closes');
});
test('known older milestones resolve to the exact hub, project, campaign or goal screen',()=>{
 s.hubs[0].projects=[{id:9,kind:'solar',status:'complete'}];
 for(const [key,target] of [
  ['project:LHR:9',{kind:'project',id:'LHR/9'}],['campaign:regional',{kind:'campaign',id:'regional'}],
  ['hub:MAD',{kind:'airport',id:'MAD'}],['rank:LHR:Global Hub',{kind:'airport',id:'LHR'}],
  ['listing',{kind:'page',id:'finance'}],['achievement:test',{kind:'page',id:'goals'}],['founded',{kind:'airport',id:'LHR'}],
 ])assert.deepEqual(companyEventTarget(game,{key}),target);
 assert.equal(companyEventTarget(game,{key:'totalPax:1000'}),null);
});
test('removed projects and invalid targets leave readable history without dead actions',()=>{
 s.hubs[0].projects=[{id:9,kind:'solar',status:'removed'}];
 for(const key of ['project:LHR:9','project:MAD:1','campaign:missing','hub:ZZZ']) assert.equal(companyEventTarget(game,{key}),null);
 assert.equal(companyEventTarget(game,{key:'listing',target:{kind:'page',id:'missing'}}),null);
});
