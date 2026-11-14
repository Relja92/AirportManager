import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {AIRCRAFT,GOALS,ACHIEVEMENTS} from '../src/data/catalog.js';
import {CAMPAIGNS,campaignNetwork,isRegionalLink} from '../src/campaigns.js';
import {operationsAttention,resolveAlertTarget} from '../src/operationsAttention.js';
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=String(v)};
const {game}=await import('../src/game.js');let s;
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
function route(dest,type='sparrow',hub='LHR'){const r=game.addRoute(hub,dest),p=game.createPlane(type,false,hub);game.assign(p.id,r.id,true);return {r,p};}
function regionalNetwork(){return [route('VIE'),route('ZRH'),route('CPH')];}
function start(id='regional'){assert.equal(game.startCampaign(id),null);return game.campaignRun(id);}
function readyRegional(){regionalNetwork();const run=start();game.recordCampaignFlight(s.routes[0],1500);game.checkCampaign();assert.equal(run.phase,'ready');return run;}
function advanceDay(profit=1000){game.closeCampaignDay(profit);s.day++;s.minute=s.day*1440;game.checkCampaign();}
beforeEach(()=>{game.silent=true;game.newGame('LHR');s=game.state;s.rivals=[];s.rng=12345;s.events=[];s.eventsUntil=1e9;s.contracts=[];s.money=50e6;
 s.goalsDone=GOALS.map(g=>g.id);s.achDone=ACHIEVEMENTS.map(a=>a.id);s.hubs[0].levels={runway:4,terminal:4,gates:4,amenities:1,cargo:2,fuel:1,marketing:1};});

test('campaign previews are pure and show three distinct chapters with one-time grants',()=>{
 const before=JSON.stringify(s);for(const id of Object.keys(CAMPAIGNS)){const st=game.campaignStatus(id);assert.equal(st.profile.chapters.length,3);assert.equal(st.run,null);assert.ok(st.goals.every(g=>!g.met));}
 assert.equal(JSON.stringify(s),before);
});
test('starting a campaign preserves the airline and does not credit historic activity',()=>{
 const {r}=route('VIE');s.totalPax=1e6;s.freight.delivered=5000;s.connections.total.completed=1000;const cash=s.money,run=start();
 near(s.money,cash);assert.equal(s.routes[0],r);assert.equal(run.progress.regionalPax,0);assert.equal(run.progress.connections,0);assert.equal(game.campaignStatus('regional').goals[0].value,1);
});
test('daily challenges and scenarios cannot start or claim campaign grants',()=>{
 for(const mode of ['daily','sprint']){s.mode.id=mode;assert.match(game.startCampaign('regional'),/free play/);assert.equal(s.campaigns.active,null);}
 s.mode.id='world';assert.equal(game.campaignWhy(),null,'the open-ended world mission allows campaigns');
 s.mode.id='free';const run=readyRegional(),cash=s.money;s.mode.id='daily';assert.match(game.claimCampaign('regional',0),/free play/);near(s.money,cash);assert.equal(run.phase,'ready');
});
test('regional links need a passenger aircraft and the stated size and distance',()=>{
 route('FRA');route('VIE','sparrow_f');const {r,p}=route('ZRH');assert.equal(campaignNetwork(game).regionalRoutes,1);
 p.conversion={type:'sparrow_f',until:s.minute+1440};assert.equal(campaignNetwork(game).regionalRoutes,0);delete p.conversion;
 assert.ok(isRegionalLink(r));assert.ok(!isRegionalLink({...r,km:2501}));
});
test('opposite-direction duplicates count as one link',()=>{
 s.hubs.push({id:'VIE',levels:{...s.hubs[0].levels},projects:[]});route('VIE');route('LHR','sparrow','VIE');assert.equal(campaignNetwork(game).regionalRoutes,1);
});
test('actual landings add regional passengers, not passenger totals on other routes',()=>{
 const {r,p}=route('VIE'),other=route('FRA');const run=start();p.phase='out';p.pax=40;p.biz=2;p.passengers={};game.land(p,r,AIRCRAFT.sparrow);
 near(run.progress.regionalPax,42);other.p.phase='out';other.p.pax=40;other.p.biz=0;game.land(other.p,other.r,AIRCRAFT.sparrow);near(run.progress.regionalPax,42);
});
test('chapter verification does not pay or automatically start the next chapter',()=>{
 const run=readyRegional(),cash=s.money;game.recordCampaignFlight(s.routes[0],99999);game.checkCampaign();game.tick(1440);
 assert.equal(run.phase,'ready');assert.equal(run.chapter,0);assert.equal(run.rewards.length,0);near(run.progress.regionalPax,1500);assert.ok(s.money!==cash);assert.ok(!s.today.campaignRewards);
});
test('verified objectives stay complete when the network changes before claiming',()=>{
 const run=readyRegional();s.planes=[];game.checkCampaign();assert.equal(run.phase,'ready');assert.ok(game.campaignStatus('regional').goals.every(q=>q.met));assert.equal(game.claimCampaign('regional',0),null);
});
test('claiming pays once, resets counters and rejects stale chapter actions',()=>{
 const run=readyRegional(),cash=s.money;assert.equal(game.claimCampaign('regional',0),null);near(s.money,cash+150000);assert.equal(run.chapter,1);near(run.progress.regionalPax,0);
 assert.match(game.claimCampaign('regional',0),/not ready/);near(s.money,cash+150000);assert.equal(run.rewards.length,1);near(s.today.campaignRewards,150000);near(s.today.rev,0);
});
test('grants do not inflate operating profit or the daily profit history',()=>{
 readyRegional();const priorCost=s.today.cost;game.claimCampaign('regional',0);game.endOfDay();near(s.yesterday.rev,0);assert.ok(s.yesterday.profit<0);near(s.yesterday.campaignRewards,150000);assert.ok(s.history.at(-1)<0);assert.ok(s.yesterday.cost>=priorCost);
});
test('pausing and switching retain deliveries but reset a live profit streak',()=>{
 const run=readyRegional();game.claimCampaign('regional',0);game.recordCampaignFlight(s.routes[0],100);run.progress.profitDays=2;
 assert.equal(game.pauseCampaign('regional'),null);game.recordCampaignFlight(s.routes[0],9999);near(run.progress.regionalPax,100);near(run.progress.profitDays,0);
 start('freight');game.recordCampaignFlight(s.routes[0],50);start('regional');near(run.progress.regionalPax,100);near(game.campaignRun('freight').progress.regionalPax,50);assert.equal(s.campaigns.active,'regional');
});
test('partial days, repeated closing and non-profitable days cannot inflate a streak',()=>{
 const run=readyRegional();game.claimCampaign('regional',0);advanceDay();near(run.progress.profitDays,0);advanceDay();near(run.progress.profitDays,1);
 game.closeCampaignDay(1000);game.closeCampaignDay(1000);near(run.progress.profitDays,2);s.day++;s.minute=s.day*1440;advanceDay(0);near(run.progress.profitDays,0);
 advanceDay();near(run.progress.profitDays,1);s.planes.pop();advanceDay();near(run.progress.profitDays,0);
});
test('resuming mid-day excludes that partial day from a profitable streak',()=>{
 const run=readyRegional();game.claimCampaign('regional',0);game.pauseCampaign('regional');s.minute=6*1440+400;s.day=6;start('regional');advanceDay();near(run.progress.profitDays,0);advanceDay();near(run.progress.profitDays,1);
});
test('actual freight deliveries distinguish express, on-time and late tonnes',()=>{
 const {r,p}=route('FRA','sparrow_f'),run=start('freight');p.freightManifest=[{kind:'express',tonnes:8,price:10,deadline:s.minute+1},{kind:'bulk',tonnes:2,price:10,deadline:s.minute-1}];
 game.deliverFreight(p,r,s.minute);near(run.progress.onTimeFreight,8);near(run.progress.express,8);near(run.progress.lateFreight,2);
 game.freightClaim(r,{tonnes:10,price:10},'cancelled');near(run.progress.lostFreight,10);
});
test('freight reliability needs a real sample and includes expired and canceled goods',()=>{
 route('FRA','sparrow_f');route('CDG','sparrow_f');const run=start('freight');game.recordCampaignFreight({bulk:100});game.checkCampaign();game.claimCampaign('freight',0);
 game.recordCampaignFreight({express:60});let q=game.campaignStatus('freight').goals.find(q=>q.key==='freightReliability');assert.equal(q.value,100);assert.equal(q.met,false);
 game.recordCampaignFreight({bulk:40,lost:20});q=game.campaignStatus('freight').goals.find(q=>q.key==='freightReliability');assert.ok(q.value<90);assert.equal(q.met,false);
 game.recordCampaignFreight({bulk:100});game.checkCampaign();assert.equal(run.phase,'ready');
});
test('completed and missed connecting journeys feed the campaign from real handlers',()=>{
 const {r,p}=route('VIE'),run=start('connector');p.journeys=[{leg:1,to:'VIE',count:12}];game.landConnections(p,r,'VIE');near(run.progress.connections,12);
 game.missConnection({count:3,firstFare:100,firstRouteId:r.id,secondRouteId:999});near(run.progress.missedConnections,3);
});
test('connection reliability does not award a chapter on a tiny perfect sample',()=>{
 const run=start('connector');run.chapter=2;run.progress.connections=20;const q=game.campaignStatus('connector').goals.find(q=>q.key==='connectionReliability');assert.equal(q.value,100);assert.equal(q.met,false);
 run.progress.connections=270;run.progress.missedConnections=30;assert.equal(game.campaignStatus('connector').goals.find(q=>q.key==='connectionReliability').met,true);
});
test('ready chapters have an exact alert link that clears on claim or pause',()=>{
 readyRegional();const alert=operationsAttention(game).alerts.find(a=>a.categories.includes('campaigns'));assert.equal(alert.target.id,'regional');assert.deepEqual(resolveAlertTarget(game,alert),alert.target);
 game.pauseCampaign('regional');assert.ok(!operationsAttention(game).alerts.some(a=>a.categories.includes('campaigns')));start();game.claimCampaign('regional',0);assert.ok(!operationsAttention(game).alerts.some(a=>a.categories.includes('campaigns')));
});
test('save and load retain ready and paid chapters without repeated grants',()=>{
 readyRegional();const cash=s.money;game.save();assert.ok(game.load());s=game.state;near(s.money,cash);assert.equal(game.campaignRun().phase,'ready');game.claimCampaign('regional',0);game.save();const paid=s.money;game.load();s=game.state;
 near(s.money,paid);assert.equal(game.campaignRun().rewards.length,1);assert.match(game.claimCampaign('regional',0),/not ready/);
});
test('legacy saves initialize campaigns without starting one or changing finances',()=>{
 delete s.campaigns;const cash=s.money;game.save();assert.ok(game.load());s=game.state;assert.deepEqual(s.campaigns,{active:null,runs:{}});near(s.money,cash);
});
test('the final chapter awards its badge once and releases the active campaign',()=>{
 const run=readyRegional();run.chapter=2;run.phase='ready';const cash=s.money;assert.equal(game.claimCampaign('regional',2),null);assert.equal(run.phase,'complete');assert.equal(s.campaigns.active,null);near(s.money,cash+CAMPAIGNS.regional.chapters[2].reward);
 assert.match(game.startCampaign('regional'),/already completed/);assert.match(game.claimCampaign('regional',2),/not ready/);assert.ok(game.campaignStatus('regional').goals.every(q=>q.met));
});
test('offline play progresses the current chapter and leaves the reward for review',()=>{
 regionalNetwork();const run=start();run.progress.regionalPax=1499;s.speed=1;s.savedAt=Date.now()-30*60*1000;assert.ok(game.catchUp());assert.equal(run.phase,'ready');assert.equal(run.chapter,0);assert.equal(run.rewards.length,0);
});
