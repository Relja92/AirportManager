// Optional, persistent story objectives for an existing free-play airline.
// Counters advance only in the active chapter; grants are separate from profit.
import {AIRCRAFT} from './data/catalog.js';
import {AIRPORT_BY_ID} from './data/airports.js';
const DAY=1440;
const goal=(key,label,target,help,unit='')=>({key,label,target,help,unit});
export const CAMPAIGNS={
  regional:{name:'Regional Lifeline',badge:'Regional lifeline',pitch:'Give smaller cities a dependable link, then build a regional network that can pay its own way.',
    rules:'Qualifying links are at most 2,500 km long, touch a Local, Regional or Major airport, and have an assigned passenger aircraft. Both directions count toward passenger deliveries.',
    chapters:[
      {name:'First links',story:'Two smaller communities need a connection to the wider world. Start with aircraft that fit the market.',reward:150000,
        goals:[goal('regionalRoutes','Qualifying regional links',2,'routes'),goal('regionalPax','Regional passengers delivered',1500,'routes','passengers')]},
      {name:'A dependable timetable',story:'The first services have found their passengers. Expand carefully and prove the timetable can support itself.',reward:400000,streak:{regionalRoutes:3},
        goals:[goal('regionalRoutes','Qualifying regional links',3,'routes'),goal('regionalPax','Regional passengers delivered',5000,'routes','passengers'),goal('profitDays','Consecutive profitable full days with 3 regional links',3,'finance','days')]},
      {name:'A network that lasts',story:'A second base brings more communities within reach. Invest in the airports and keep the expanded network profitable.',reward:1000000,streak:{regionalRoutes:4,regionalHubs:2},
        goals:[goal('regionalRoutes','Qualifying regional links',4,'routes'),goal('regionalHubs','Hubs serving those links',2,'network'),goal('projects','Operating airport projects',1,'projects'),goal('regionalPax','Regional passengers delivered',12000,'routes','passengers'),goal('profitDays','Consecutive profitable full days with 4 links at 2 hubs',5,'finance','days')]},
    ]},
  freight:{name:'Freight Corridor',badge:'Freight specialist',pitch:'Build a dedicated cargo operation, earn a reputation for urgent deliveries, and develop a freight network.',
    rules:'Dedicated freighters count; passenger belly cargo does not. On-time reliability includes delivered, late, expired and canceled freight handled during the active chapter.',
    chapters:[
      {name:'The first shipment',story:'Shippers need a dependable alternative. Put a freighter to work and deliver its first loads on time.',reward:200000,
        goals:[goal('freightRoutes','Links with assigned freighters',1,'freight'),goal('onTimeFreight','Freight delivered on time',100,'freight','t')]},
      {name:'Time matters',story:'Urgent goods pay more, but a missed deadline has a cost. Match the service and aircraft to the delivery window.',reward:500000,
        goals:[goal('freightRoutes','Links with assigned freighters',2,'freight'),goal('express','Express freight delivered on time',60,'freight','t'),goal('freightReliability','On-time freight · at least 100 t resolved',90,'freight','%')]},
      {name:'The freight backbone',story:'A second cargo base and better handling can support a larger operation. Make the network earn its keep.',reward:1200000,streak:{freightRoutes:3,freightHubs:2},
        goals:[goal('freightRoutes','Links with assigned freighters',3,'freight'),goal('freightHubs','Hubs serving those links',2,'network'),goal('freightDepots','Operating automated freight depots',1,'projects'),goal('onTimeFreight','Freight delivered on time',400,'freight','t'),goal('profitDays','Consecutive profitable full days with 3 links at 2 hubs',5,'finance','days')]},
    ]},
  connector:{name:'World Connector',badge:'World connector',pitch:'Turn separate routes into useful journeys, reach more countries, and run a profitable network of connected hubs.',
    rules:'Countries and hubs must be served by routes with assigned passenger aircraft. Only completed two-leg journeys count; airline partnerships can help.',
    chapters:[
      {name:'The transfer desk',story:'Your airline is ready to offer journeys beyond a single flight. Build around two bases and get travelers to their final destination.',reward:300000,
        goals:[goal('passengerHubs','Hubs with passenger service',2,'network'),goal('connections','Completed connecting journeys',100,'connections','passengers')]},
      {name:'A wider map',story:'Offer useful connections across borders and earn the confidence of travelers who depend on your timetable.',reward:650000,
        goals:[goal('countries','Countries served by passenger links',4,'network'),goal('connections','Completed connecting journeys',300,'connections','passengers'),goal('reputation','Airline reputation',65,'routes')]},
      {name:'One connected airline',story:'Three bases should work as one airline. Grow the map while protecting connections and the bottom line.',reward:1500000,streak:{passengerHubs:3,countries:6},
        goals:[goal('passengerHubs','Hubs with passenger service',3,'network'),goal('countries','Countries served by passenger links',6,'network'),goal('connections','Completed connecting journeys',1000,'connections','passengers'),goal('connectionReliability','Successful connections · at least 300 resolved',90,'connections','%'),goal('profitDays','Consecutive profitable full days with 3 hubs in 6 countries',5,'finance','days')]},
    ]},
};
export const isRegionalLink=r=>r.km<=2500 && Math.min(AIRPORT_BY_ID[r.hub].size,AIRPORT_BY_ID[r.dest].size)<=3;
const freshProgress=()=>({regionalPax:0,onTimeFreight:0,express:0,lateFreight:0,lostFreight:0,connections:0,missedConnections:0,profitDays:0});
const activeRun=g=>g.state?.campaigns?.runs[g.state.campaigns.active];
// Open-ended ways to play (no deadline) can run campaigns; timed scenarios and the daily challenge cannot.
const openEnded=g=>['free','world'].includes(g.state.mode.id);
const counting=g=>{const r=activeRun(g);return openEnded(g) && !g.state.over && r?.phase==='progress'?r:null;};
const uniqueLinks=routes=>[...new Map(routes.map(r=>[[r.hub,r.dest].sort().join(':'),r])).values()];
export function campaignNetwork(g){
  const passenger=[],freight=[];
  for(const r of g.state.routes){const planes=g.planesOn(r.id).filter(p=>!p.conversion && !p.lease?.returning);
    if(planes.some(p=>!AIRCRAFT[p.type].freighter))passenger.push(r);
    if(planes.some(p=>AIRCRAFT[p.type].freighter))freight.push(r);
  }
  const regional=passenger.filter(isRegionalLink),projects=g.state.hubs.flatMap(h=>h.projects || []).filter(p=>p.status==='complete');
  return {regionalRoutes:uniqueLinks(regional).length,regionalHubs:new Set(regional.map(r=>r.hub)).size,
    freightRoutes:uniqueLinks(freight).length,freightHubs:new Set(freight.map(r=>r.hub)).size,
    passengerHubs:new Set(passenger.map(r=>r.hub)).size,countries:new Set(passenger.flatMap(r=>[r.hub,r.dest]).map(id=>AIRPORT_BY_ID[id].country)).size,
    projects:projects.length,freightDepots:projects.filter(p=>p.kind==='freight').length,
    routes:{regional:uniqueLinks(regional),freight:uniqueLinks(freight),connector:uniqueLinks(passenger)}};
}
export const campaignActions={
  migrateCampaigns(){this.state.campaigns ||= {active:null,runs:{}};},
  campaignRun(id=this.state.campaigns?.active){return this.state.campaigns?.runs[id] || null;},
  campaignWhy(){return this.state.over?'Continue the game before starting a campaign.':!openEnded(this)?'Campaigns are available in free play. Finish this scenario, then choose Keep playing in free play.':null;},
  campaignStatus(id){
    const profile=CAMPAIGNS[id],run=this.campaignRun(id);if(!profile)return null;
    const chapter=profile.chapters[run?.chapter || 0],network=campaignNetwork(this),p=run?.progress || freshProgress();
    const freightResolved=p.onTimeFreight+p.lateFreight+p.lostFreight,connectionsResolved=p.connections+p.missedConnections;
    const values={...network,...p,reputation:this.state.rep,
      freightReliability:freightResolved?100*p.onTimeFreight/freightResolved:0,
      connectionReliability:connectionsResolved?100*p.connections/connectionsResolved:0};
    const goals=run?.phase==='ready' || run?.phase==='complete'?run.verified:chapter.goals.map(q=>{
      const sample=q.key==='freightReliability'?{value:freightResolved,target:100,unit:'t'}:q.key==='connectionReliability'?{value:connectionsResolved,target:300,unit:'passengers'}:null;
      return {...q,value:values[q.key],sample,met:values[q.key]+1e-8>=q.target && (!sample || sample.value+1e-8>=sample.target)};
    });
    return {id,profile,run,chapter,goals,network,active:this.state.campaigns?.active===id,
      progress:goals.reduce((n,q)=>n+Math.min(1,q.value/q.target,q.sample?q.sample.value/q.sample.target:1),0)/goals.length};
  },
  startCampaign(id){
    const why=this.campaignWhy();if(why)return why;if(!CAMPAIGNS[id])return 'Choose an available campaign.';
    this.migrateCampaigns();const c=this.state.campaigns;
    if(c.runs[id]?.phase==='complete')return 'This airline has already completed that campaign.';
    if(c.active===id)return 'This campaign is already active.';
    const previous=this.campaignRun();if(previous?.phase==='progress'){previous.progress.profitDays=0;previous.lastDay=null;}
    const run=c.runs[id] ||= {chapter:0,phase:'progress',started:this.state.minute,chapterStarted:this.state.minute,progress:freshProgress(),rewards:[]};
    run.eligibleDay=Math.ceil(this.state.minute/DAY);run.lastDay=null;
    if(run.phase==='progress')run.progress.profitDays=0;
    c.active=id;this.emit('toast',{text:`${CAMPAIGNS[id].name}: ${CAMPAIGNS[id].chapters[run.chapter].name} is active.`,kind:'goal',target:{kind:'campaign',id}});
    this.changed();return null;
  },
  pauseCampaign(id){
    if(this.state.campaigns?.active!==id)return 'This campaign is not active.';
    const run=this.campaignRun(id);if(run.phase==='progress'){run.progress.profitDays=0;run.lastDay=null;}
    this.state.campaigns.active=null;this.changed();return null;
  },
  recordCampaignFlight(route,people){const run=counting(this);if(run && isRegionalLink(route))run.progress.regionalPax+=people;},
  recordCampaignFreight({bulk=0,express=0,late=0,lost=0}){const run=counting(this);if(!run)return;run.progress.onTimeFreight+=bulk+express;run.progress.express+=express;run.progress.lateFreight+=late;run.progress.lostFreight+=lost;},
  recordCampaignConnection(key,count){const run=counting(this);if(run)run.progress[key==='completed'?'connections':'missedConnections']+=count;},
  closeCampaignDay(profit){
    const run=counting(this);if(!run || this.state.day<run.eligibleDay || run.lastDay===this.state.day)return;
    const chapter=CAMPAIGNS[this.state.campaigns.active].chapters[run.chapter],network=campaignNetwork(this);
    const qualifies=profit>0 && Object.entries(chapter.streak || {}).every(([key,min])=>network[key]>=min);
    run.progress.profitDays=qualifies?(run.lastDay===this.state.day-1?run.progress.profitDays:0)+1:0;run.lastDay=this.state.day;
  },
  checkCampaign(){
    const run=counting(this);if(!run)return;const id=this.state.campaigns.active,st=this.campaignStatus(id);
    if(!st.goals.every(q=>q.met))return;
    run.phase='ready';run.verified=st.goals;run.verifiedAt=this.state.minute;this._rev++;
    this.emit('toast',{text:`${st.profile.name}: ${st.chapter.name} complete. Review your chapter reward.`,kind:'goal',sound:'goal',target:{kind:'campaign',id}});
  },
  claimCampaign(id,chapterIndex){
    const why=this.campaignWhy();if(why)return why;const run=this.campaignRun(id),profile=CAMPAIGNS[id];
    if(!run || this.state.campaigns.active!==id || run.phase!=='ready' || run.chapter!==chapterIndex)return 'This chapter is not ready to claim. Review the current campaign.';
    const chapter=profile.chapters[chapterIndex],s=this.state;
    if(run.rewards.some(r=>r.chapter===chapterIndex))return 'This chapter reward was already collected.';
    s.money+=chapter.reward;s.today.campaignRewards=(s.today.campaignRewards || 0)+chapter.reward;
    run.rewards.push({chapter:chapterIndex,amount:chapter.reward,minute:s.minute,verified:run.verified});
    if(chapterIndex===profile.chapters.length-1){run.phase='complete';run.completed=s.minute;s.campaigns.active=null;this.recordCompanyEvent(`campaign:${id}`, 'milestones', `${profile.name} completed`, `${profile.badge} badge earned.`);}
    else {run.chapter++;run.phase='progress';run.chapterStarted=s.minute;run.progress=freshProgress();run.eligibleDay=Math.ceil(s.minute/DAY);run.lastDay=null;delete run.verified;delete run.verifiedAt;}
    this.emit('toast',{text:`${profile.name}: ${chapterIndex===profile.chapters.length-1?'campaign completed':chapter.name+' reward collected'}. +$${chapter.reward.toLocaleString()}`,kind:'goal',target:{kind:'campaign',id}});
    this.changed();return null;
  },
};
