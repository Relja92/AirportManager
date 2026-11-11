// Paid construction stages and permanent airport improvements. No DOM or timers.
import { AIRPORT_BY_ID } from './data/airports.js';
import { AIRCRAFT, difficultyOf, rankFor } from './data/catalog.js';
import { prepareChange, finishChange } from './changeResults.js';
const DAY=1440;
export const PROJECT_SITES=2;
export const PROJECT_STAGES=[
  {name:'Site preparation',share:.25,delay:0},
  {name:'Construction',share:.5,delay:.2},
  {name:'Commissioning',share:.25,delay:.1},
];
export const AIRPORT_PROJECTS={
  concourse:{name:'Satellite concourse',cost:1200000,days:6,upkeep:4000,requirements:{terminal:2,gates:2},
    benefit:'Room for 2 more routes and 2 more aircraft, without changing your upgrade levels.',routes:2,gates:2},
  turnaround:{name:'Ground operations center',cost:750000,days:4,upkeep:2000,requirements:{terminal:2,gates:2},
    benefit:'20% shorter aircraft turnarounds at this hub. Boarding policies and flight time stay the same.',turnaround:.8},
  freight:{name:'Automated freight depot',cost:650000,days:5,upkeep:2500,requirements:{terminal:2,cargo:2},
    benefit:'10% more usable freighter hold space, capped at the aircraft’s physical hold, and 15% more freight bookings. Passenger belly cargo keeps its existing terms.',hold:1.1,demand:1.15},
  solar:{name:'Solar utilities',cost:950000,days:5,upkeep:0,requirements:{terminal:2,fuel:1},
    benefit:'15% less upkeep for the airport’s standard facilities. Other projects keep their listed running costs.',upkeepFactor:.85},
};
export const completedProjects=h=>(h?.projects || []).filter(p=>p.status==='complete' && AIRPORT_PROJECTS[p.kind]);
const BASE_EFFECTS=Object.freeze({routes:0,gates:0,upkeep:0,upkeepFactor:1,turnaround:1,hold:1,demand:1});
export function projectEffects(h) {
  if(!h?.projects?.length)return BASE_EFFECTS;
  const result={routes:0,gates:0,upkeep:0,upkeepFactor:1,turnaround:1,hold:1,demand:1};
  for(const p of completedProjects(h)){const v=AIRPORT_PROJECTS[p.kind];for(const k of ['routes','gates','upkeep'])result[k]+=v[k] || 0;for(const k of ['upkeepFactor','turnaround','hold','demand'])result[k]*=v[k] || 1;}
  return result;
}
export const constructionDelay=h=>Math.max(0,...(h?.projects || []).filter(p=>p.status==='building').map(p=>PROJECT_STAGES[p.stage]?.delay || 0));
export const projectSignature=h=>(h?.projects || []).map(p=>[p.id,p.kind,p.status,p.stage]);
const active=p=>['building','awaiting'].includes(p.status);
const modelOf=g=>Object.assign(Object.create(g),{state:structuredClone(g.state),_cache:new Map(),_cacheKey:''});
const token=g=>`${g._rev}:${g.state.minute}`;
const touch=(g,id)=>g.state.routes.filter(r=>r.hub===id || r.dest===id);
function forecast(g,hubId){
  return touch(g,hubId).reduce((n,r)=>{const on=g.planesOn(r.id);return n+on.reduce((m,p)=>m+g.typeProfit(r,AIRCRAFT[p.type],on.length).profit-g.planeUpkeep(p)+AIRCRAFT[p.type].price*.008,0);},0)-g.hubUpkeep(g.hub(hubId));
}
export const projectActions={
  migrateProjects(){for(const h of this.state.hubs)h.projects ||= [];this.state.nextProjectId ||= 1;},
  airportProject(hubId,id){return this.hub(hubId)?.projects?.find(p=>p.id===id);},
  projectFunding(hubId=null){return this.state.hubs.filter(h=>!hubId || h.id===hubId).reduce((n,h)=>n+(h.projects || []).filter(active).reduce((m,p)=>m+p.total-p.paid,0),0);},
  projectRequirements(hubId,kind){
    const h=this.hub(hubId),v=AIRPORT_PROJECTS[kind];if(!h || !v)return [];
    return [{label:'Upgrade levels · Regional rank',value:rankFor(h.levels).total,target:6},...Object.entries(v.requirements).map(([key,target])=>({label:`${key[0].toUpperCase()+key.slice(1)} level`,value:h.levels[key] || 0,target}))].map(q=>({...q,met:q.value>=q.target}));
  },
  projectStatus(hubId,id){
    const p=this.airportProject(hubId,id);if(!p)return null;
    const worked=p.durations.slice(0,p.stage).reduce((n,d)=>n+d,0)+(p.worked || 0),duration=p.durations.reduce((n,d)=>n+d,0);
    const remaining=p.status==='complete'?0:Math.max(0,duration-worked),stageLeft=p.status==='building'?Math.max(0,p.durations[p.stage]-p.worked):null;
    return {project:p,profile:AIRPORT_PROJECTS[p.kind],progress:p.status==='complete'?1:worked/duration,remaining,stageLeft,
      nextAmount:p.status==='awaiting'?p.payments[p.stage]:0,nextAt:stageLeft!=null?this.state.minute+stageLeft:null};
  },
  projectQuote(hubId,kindOrId,action='start'){
    const h=this.hub(hubId),p=action==='start'?null:this.airportProject(hubId,+kindOrId),kind=action==='start'?kindOrId:p?.kind,v=AIRPORT_PROJECTS[kind];
    if(!h || !v)return {why:'Choose an available project at one of your hubs.'};
    const siteCount=(h.projects || []).filter(p=>p.status!=='cancelled' && p.status!=='removed').length;
    const requirements=this.projectRequirements(hubId,kind),total=p?.total ?? Math.round(v.cost*difficultyOf(this.state).costs*AIRPORT_BY_ID[hubId].market.expansion/1000)*1000;
    const payments=p?.payments || [Math.round(total*.25),Math.round(total*.5),total-Math.round(total*.25)-Math.round(total*.5)];
    const durations=p?.durations || [DAY,(v.days-2+(AIRPORT_BY_ID[hubId].market.constrained?2:0))*DAY,DAY];
    let why=null,cost=0,writeOff=0;
    if(action==='start'){
      if((h.projects || []).some(active))why='Finish or cancel the current project at this hub first.';
      else if((h.projects || []).some(p=>p.kind===kind && !['cancelled','removed'].includes(p.status)))why='This project already occupies a site.';
      else if(siteCount>=PROJECT_SITES)why=`Both project sites are occupied. Remove a completed project to free a site.`;
      else if(requirements.some(r=>!r.met))why='Complete the unlock requirements first.';
      cost=payments[0];
    }else if(action==='fund'){
      if(p.status!=='awaiting')why='This project is not waiting for a stage payment.';cost=payments[p.stage] || 0;
    }else if(action==='cancel'){
      if(!active(p))why='Only unfinished projects can be canceled.';writeOff=p.paid*.5;
    }else if(action==='remove'){
      if(p.status!=='complete')why='Only completed projects can be removed.';cost=Math.round(total*.1);writeOff=p.paid*.5;
      const excessRoutes=this.routesAt(hubId).length-(this.routeCap(h)-(v.routes || 0)),excessPlanes=this.planesAt(hubId).length-(this.planeCap(h)-(v.gates || 0));
      if(v.routes && excessRoutes>0)why=`Close ${excessRoutes} route${excessRoutes===1?'':'s'} before removing this concourse.`;
      if(v.gates && excessPlanes>0)why ||= `Move or sell ${excessPlanes} aircraft before removing this concourse.`;
    }else why='Choose a project action.';
    if(this.state.money<cost && cost>0)why ||= 'Not enough cash for this payment. Work can wait without extra fees.';
    const now=modelOf(this),during=modelOf(this),after=modelOf(this);
    for(const g of [now,during,after])g.hub(hubId).projects=(g.hub(hubId).projects || []).filter(x=>x.id!==p?.id);
    const base=p || {id:-1,kind,total,payments,durations,paid:0,stage:0,worked:0};
    if(action==='remove')now.hub(hubId).projects.push({...base,status:'complete'});
    else if(action!=='cancel'){
      during.hub(hubId).projects.push({...base,status:'building',stage:action==='fund'?p.stage:1});
      after.hub(hubId).projects.push({...base,status:'complete'});
    }
    // Cancellation compares the current construction state with a cleared site.
    if(action==='cancel')now.state=structuredClone(this.state);
    const before=forecast(now,hubId),duringProfit=forecast(during,hubId),afterProfit=forecast(after,hubId);
    return {why,action,hub:h,project:p,kind,profile:v,requirements,total,payments,durations,cost,writeOff,siteCount,
      remaining:this.state.money-cost,remainingFunding:action==='start'?total-cost:action==='fund'?total-p.paid-cost:0,
      before,during:duringProfit,after:afterProfit,gain:afterProfit-before,beforeUpkeep:now.hubUpkeep(now.hub(hubId)),afterUpkeep:after.hubUpkeep(after.hub(hubId)),
      beforeRoutes:now.routeCap(now.hub(hubId)),afterRoutes:after.routeCap(after.hub(hubId)),beforeGates:now.planeCap(now.hub(hubId)),afterGates:after.planeCap(after.hub(hubId)),revision:token(this)};
  },
  applyProject(hubId,kindOrId,action='start',revision=token(this)){
    const q=this.projectQuote(hubId,kindOrId,action);if(q.why)return q.why;
    if(revision!==token(this))return 'Conditions changed. Review the updated preview before applying.';
    this.migrateProjects();const s=this.state;let p=q.project;
    if(action==='start'){
      p={id:s.nextProjectId++,kind:q.kind,status:'building',stage:0,worked:0,started:s.minute,total:q.total,payments:q.payments,durations:q.durations,paid:0};
      q.hub.projects.push(p);
    }
    if(action==='start' || action==='fund'){
      s.money-=q.cost;s.invested+=q.cost;s.today.projectSpending=(s.today.projectSpending || 0)+q.cost;p.paid+=q.cost;p.status='building';
    }else{
      s.money-=q.cost;s.today.cost+=q.cost;s.today.projectRemoval=(s.today.projectRemoval || 0)+q.cost;
      s.invested-=p.paid;s.today.projectWriteOff=(s.today.projectWriteOff || 0)+q.writeOff;
      p.status=action==='cancel'?'cancelled':'removed';p.ended=s.minute;
    }
    this.emit('toast',{text:`${hubId}: ${q.profile.name} ${action==='start'?'started':action==='fund'?`${PROJECT_STAGES[p.stage].name.toLowerCase()} funded`:action==='cancel'?'canceled; paid stages are not refunded':'removed'}.`,kind:action==='cancel'?'amber':'good',target:{kind:'project',id:`${hubId}/${p.id}`}});
    this.changed();return null;
  },
  stepProjects(minutes){
    for(const h of this.state.hubs)for(const p of h.projects || []){
      if(p.status!=='building')continue;p.worked=Math.min(p.durations[p.stage],p.worked+minutes);
      if(p.worked<p.durations[p.stage])continue;
      const profile=AIRPORT_PROJECTS[p.kind];
      if(p.stage<2){p.stage++;p.worked=0;p.status='awaiting';this._rev++;
        this.emit('toast',{text:`${h.id}: ${profile.name} is ready for ${PROJECT_STAGES[p.stage].name.toLowerCase()}. Fund the next stage to continue.`,target:{kind:'project',id:`${h.id}/${p.id}`}});
      }else{
        const routes=touch(this,h.id),change=prepareChange(this,{kind:'project',title:`${h.id} · ${profile.name} completed`,routeIds:routes.map(r=>r.id),overheadHubIds:[h.id]});
        p.status='complete';p.completed=this.state.minute;this._rev++;finishChange(this,change);
        this.recordCompanyEvent(`project:${h.id}:${p.id}`, 'network', `${h.id} · ${profile.name} completed`, profile.benefit);
        this.emit('toast',{text:`${h.id}: ${profile.name} completed. ${profile.benefit}`,kind:'good',target:{kind:'project',id:`${h.id}/${p.id}`}});
      }
    }
  },
  turnaround(type,airportId){const h=this.hub(airportId);return type.turnaround*projectEffects(h).turnaround*(1+constructionDelay(h));},
  routeTurnaround(type,r){return (this.turnaround(type,r.hub)+this.turnaround(type,r.dest))/2;},
};
