// Dedicated freight is booked once, occupies a hold, and earns only at delivery.
// Existing passenger belly cargo retains its established terminal contracts.
import {AIRCRAFT,AIRCRAFT_LIST,difficultyOf} from './data/catalog.js';
import {AIRPORT_BY_ID} from './data/airports.js';
import {routeMarket} from './data/markets.js';
import {eventDemand} from './events.js';
import {projectEffects} from './projects.js';
import {prepareChange,finishChange} from './changeResults.js';
const DAY=1440;
export const FREIGHT_SERVICES={
  bulk:{name:'Bulk',fill:.7,wait:360,deadline:3*DAY,rate:.55,base:180,description:'Steady freight. Leave at 70% of usable hold capacity or after 6 hours; deliver within 72 hours of booking.'},
  express:{name:'Express',fill:.25,wait:60,deadline:DAY,rate:1.1,base:350,description:'Higher-paying urgent freight. Leave at 25% full or after 1 hour; deliver within 24 hours of booking.'},
};
export const freightService=r=>FREIGHT_SERVICES[r.cargoService] || FREIGHT_SERVICES.bulk;
export const freightStats=()=>({booked:0,loaded:0,delivered:0,late:0,expired:0,cancelled:0,revenue:0,penalties:0,capacity:0,flights:0});
export const freightHold=(type,hub)=>type.cargo*Math.min(1,(hub.levels?.cargo ?? hub.cargo ?? 0)?(.6+.1*(hub.levels?.cargo ?? hub.cargo))*(hub.specialization==='cargo'?1.2:1)*projectEffects(hub).hold:0);
const matching=(a,b)=>a.hub===b.hub && a.dest===b.dest || a.hub===b.dest && a.dest===b.hub;
export function freightMarket(s,r,hub,{rivalId=null,reputation=1}={}) {
  const from=AIRPORT_BY_ID[r.hub],to=AIRPORT_BY_ID[r.dest],market=routeMarket(from,to);
  const rivals=(s.rivals || []).filter(rv=>rv.hub && rv.id!==rivalId).flatMap(rv=>rv.routes).filter(rr=>AIRCRAFT[rr.type]?.freighter && matching(r,rr)).length;
  const player=rivalId && s.routes.some(pr=>matching(r,pr) && s.planes.some(p=>p.routeId===pr.id && AIRCRAFT[p.type].freighter))?1:0;
  const base=12*projectEffects(hub).demand*Math.sqrt(from.size*to.size)*market.freight*reputation*difficultyOf(s).demand
    *eventDemand(s,r.hub,r.dest)/(1+r.km/12000)/(1+.45*(rivals+player));
  return {bulk:base,express:base*.35*(.7+market.businessShare),rate:market.freight*(.5+to.size/10)*(hub.specialization==='cargo'?2:1)};
}
export function freightForecastFor(s,r,type,hub,{sharing=1,reputation=1,rivalId=null,flightCost=0,maintenance=type.price*.008,closed=false,turnaround=type.turnaround}={}) {
  const policy=freightService(r),market=freightMarket(s,r,hub,{rivalId,reputation}),hold=freightHold(type,hub);
  const demand=market[r.cargoService || 'bulk']*2/Math.max(1,sharing),cycle=r.km/type.speed*60+turnaround;
  const target=DAY*hold*policy.fill/Math.max(.01,demand),flights=closed || !hold?0:DAY/(cycle+Math.min(policy.wait,Math.max(0,target-cycle)));
  const capacity=flights*hold,rate=(policy.base+r.km*policy.rate)*market.rate;
  // Model one direction's booking ages at departure. A slow round trip can miss
  // express deadlines even with empty hold space; excess bookings also expire.
  const bookingRate=demand*Math.max(1,sharing)/(2*DAY),headway=flights?2*DAY/(flights*Math.max(1,sharing)):0;
  const window=Math.min(headway,policy.deadline,hold/Math.max(.000001,bookingRate));
  const tonnes=flights?Math.min(demand,capacity,window*bookingRate*flights):0;
  const oldest=capacity<demand?policy.deadline:Math.min(headway,policy.deadline),travel=r.km/type.speed*60;
  const onTime=window?Math.max(0,Math.min(1,1-Math.max(0,oldest+travel-policy.deadline)/window)):0;
  const expired=flights?Math.max(0,demand-tonnes):0,penalties=expired*rate*.1;
  const revenue=tonnes*rate*(.25+.75*onTime),cost=flights*flightCost+maintenance+penalties;
  return {profit:revenue-cost,load:capacity?tonnes/capacity:0,flights,cargoTonnes:tonnes,onTimeTonnes:tonnes*onTime,onTime,expired,penalties,capacity,revenue,cost};
}
const addStats=(g,r,key,value)=>{g.state.freight ||= freightStats();g.state.freight[key]+=value;if(r)(r.today.freight ||= freightStats())[key]+=value;};
export const cargoActions={
  migrateCargo(){const s=this.state;s.freight ||= freightStats();for(const r of s.routes){r.cargoService ||= 'bulk';r.freightPools ||= {poolOut:[],poolIn:[]};}},
  freightPlanes(r){return this.planesOn(r.id).filter(p=>AIRCRAFT[p.type].freighter);},
  cargoOnly(r){const planes=this.planesOn(r.id);return planes.length>0 && planes.every(p=>AIRCRAFT[p.type].freighter || p.conversion);},
  roleSharing(r,type,sharing=1){const types=r.forecastTypes || this.planesOn(r.id).map(p=>AIRCRAFT[p.type]);const others=types.filter(t=>!!t.freighter!==!!type.freighter).length;return Math.max(1,sharing-others);},
  cargoFlightWhy(p){return p?.conversion?'Wait for this cargo conversion to finish.':p?.freightManifest?.length && ['out','back'].includes(p.phase)?'Let this flight land before changing it; freight is on board.':null;},
  cargoMarket(r){return freightMarket(this.state,r,this.hub(r.hub),{reputation:this.repFactor()});},
  freightForecast(r,type,sharing=1){return freightForecastFor(this.state,r,type,this.hub(r.hub),{sharing:this.roleSharing(r,type,sharing),reputation:this.repFactor(),
    flightCost:this.flightCost(type,r.km,this.hub(r.hub)),turnaround:this.routeTurnaround(type,r),closed:!!(this.closed(r.hub)||this.closed(r.dest))});},
  freightCapacity(r){const planes=this.freightPlanes(r);return planes.reduce((n,p)=>n+this.freightForecast(r,AIRCRAFT[p.type],this.planesOn(r.id).length).capacity,0);},
  freightStatus(r){
    const queues=Object.values(r.freightPools || {}).flat(),now=this.state.minute;
    const ready=this.freightPlanes(r).some(p=>!['repair','conversion'].includes(p.phase) && !p.lease?.returning);
    const blocked=!ready || !!(this.closed(r.hub)||this.closed(r.dest));
    const atRisk=queues.filter(q=>blocked || q.deadline-now<=360);
    return {waiting:queues.reduce((n,q)=>n+q.tonnes,0),atRisk:atRisk.reduce((n,q)=>n+q.tonnes,0),blocked,
      deadline:queues.length?Math.min(...queues.map(q=>q.deadline)):null,today:r.today.freight || freightStats(),yesterday:r.yesterday?.freight || null};
  },
  stepFreight(minutes){
    const s=this.state;this.migrateCargo();
    for(const r of s.routes){
      const planes=this.freightPlanes(r),accept=this.hub(r.hub).levels.cargo>0 && planes.some(p=>!['repair','conversion'].includes(p.phase) && !p.lease?.returning)
        && !this.closed(r.hub) && !this.closed(r.dest),market=accept?this.cargoMarket(r):null,kind=r.cargoService,policy=freightService(r);
      for(const key of ['poolOut','poolIn']){
        const kept=[];
        for(const q of r.freightPools[key])if(q.deadline<=s.minute){this.freightClaim(r,q,'expired');}else kept.push(q);
        if(accept){
          const tonnes=market[kind]*minutes/DAY,price=(policy.base+r.km*policy.rate)*market.rate,bucket=Math.floor(s.minute/30)*30;
          const last=kept.at(-1);
          if(last && last.kind===kind && last.bucket===bucket)last.tonnes+=tonnes;
          else kept.push({kind,tonnes,price,bucket,deadline:bucket+policy.deadline});
          addStats(this,r,'booked',tonnes);
        }
        r.freightPools[key]=kept;
      }
    }
  },
  freightClaim(r,q,kind){
    const cost=q.tonnes*q.price*.1;
    this.state.money-=cost;this.state.today.cost+=cost;this.state.today.freightPenalties=(this.state.today.freightPenalties || 0)+cost;
    if(r)r.today.cost+=cost;addStats(this,r,kind,q.tonnes);addStats(this,r,'penalties',cost);
    this.recordCampaignFreight({lost:q.tonnes});
  },
  boardFreight(r,type,key){
    let left=freightHold(type,this.hub(r.hub));const manifest=[];
    for(const q of r.freightPools[key]){const tonnes=Math.min(left,q.tonnes);if(tonnes<=1e-9)continue;
      manifest.push({...q,tonnes});q.tonnes-=tonnes;left-=tonnes;addStats(this,r,'loaded',tonnes);}
    r.freightPools[key]=r.freightPools[key].filter(q=>q.tonnes>1e-9);return manifest;
  },
  deliverFreight(p,r,minute){
    const result={revenue:0,bulk:0,express:0,late:0};
    for(const q of p.freightManifest || []){
      const late=minute>q.deadline,revenue=q.tonnes*q.price*(late?.25:1);
      result.revenue+=revenue;if(late)result.late+=q.tonnes;else result[q.kind]+=q.tonnes;
      addStats(this,r,'delivered',q.tonnes);if(late)addStats(this,r,'late',q.tonnes);addStats(this,r,'revenue',revenue);
    }
    addStats(this,r,'flights',1);addStats(this,r,'capacity',p.freightCapacity ?? freightHold(AIRCRAFT[p.type],this.hub(r.hub)));delete p.freightCapacity;
    delete p.freightManifest;this.recordCampaignFreight(result);return result;
  },
  freightServiceQuote(id,kind){
    const r=this.route(id);if(!r || !FREIGHT_SERVICES[kind])return {why:'Choose a route and freight service.'};
    const planes=this.freightPlanes(r),forecast=route=>planes.map(p=>({...this.freightForecast(route,AIRCRAFT[p.type],this.planesOn(r.id).length),plane:p}));
    const summary=rows=>rows.reduce((n,q)=>n+q.profit-this.planeUpkeep(q.plane)+AIRCRAFT[q.plane.type].price*.008,0),before=forecast(r),after=forecast({...r,cargoService:kind});
    const queues=Object.values(r.freightPools || {}).flat(),changing=kind!==r.cargoService;
    const cost=changing?queues.reduce((n,q)=>n+q.tonnes*q.price*.1,0):0;
    return {route:r,kind,cost,cancelled:changing?queues.reduce((n,q)=>n+q.tonnes,0):0,before:summary(before),after:summary(after),delivered:after.reduce((n,q)=>n+q.cargoTonnes,0),onTime:after.reduce((n,q)=>n+q.onTimeTonnes,0),expired:after.reduce((n,q)=>n+q.expired,0),
      demand:this.cargoMarket(r)[kind]*2,why:this.state.money<cost?'Not enough cash to compensate cancelled bookings.':null};
  },
  setFreightService(id,kind){
    const q=this.freightServiceQuote(id,kind);if(q.why)return q.why;if(q.route.cargoService===kind)return null;
    const change=prepareChange(this,{kind:'freight',title:`${q.route.hub} ⇄ ${q.route.dest} · ${FREIGHT_SERVICES[kind].name} freight`,routeIds:[id],cost:q.cost});
    for(const pool of Object.values(q.route.freightPools || {}))for(const item of pool)this.freightClaim(q.route,item,'cancelled');
    q.route.freightPools={poolOut:[],poolIn:[]};q.route.cargoService=kind;
    finishChange(this,change);this.changed();return null;
  },
  conversionQuote(id){
    const p=this.plane(id),type=p && AIRCRAFT_LIST.find(t=>t.convertFrom===p.type);
    if(!p || !type)return {why:'This aircraft has no freighter conversion.'};
    const cost=Math.round(AIRCRAFT[p.type].price*.3+50000),until=this.state.minute+2*DAY;
    let why=p.lease?'Leased aircraft cannot be converted.':p.conversion?'Conversion is already underway.':!['home','idle'].includes(p.phase)?'Wait until the aircraft is on the ground at its home hub.':null;
    if(this.hub(p.hub).levels.cargo<1)why ||= 'Build a cargo terminal at this hub first.';
    if(this.state.money<cost)why ||= 'Not enough cash for the conversion.';
    const r=this.route(p.routeId),others=r?this.planesOn(r.id):[];
    const after=r?this.freightForecast({...r,forecastTypes:others.map(x=>x===p?type:AIRCRAFT[x.type])},type,others.length).profit-type.price*.008*p.age/150:null;
    return {why,plane:p,type,cost,until,remaining:this.state.money-cost,route:r,after};
  },
  convertFreighter(id){
    const q=this.conversionQuote(id);if(q.why)return q.why;
    this.state.money-=q.cost;this.state.today.cost+=q.cost;this.state.today.cargoConversions=(this.state.today.cargoConversions || 0)+q.cost;
    q.plane.conversion={type:q.type.id,until:q.until};q.plane.phase='conversion';q.plane.t=0;
    this.emit('toast',{text:`${q.plane.name}: freighter conversion started. Ready in two days; age is retained.`,target:{kind:'plane',id}});this.changed();return null;
  },
  stepConversion(p){
    if(!p.conversion)return false;
    if(this.state.minute>=p.conversion.until){p.type=p.conversion.type;delete p.conversion;p.phase=p.routeId!=null?'home':'idle';p.t=0;
      this.emit('toast',{text:`${p.name}: freighter conversion complete.`,kind:'good',target:{kind:'plane',id:p.id}});this._rev++;}
    return true;
  },
};
