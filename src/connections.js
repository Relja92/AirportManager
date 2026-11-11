// Two-leg journeys: forecasts share finite seats; only actual flights move travelers.
import { geoDistance } from 'd3-geo';
import { AIRPORT_BY_ID } from './data/airports.js';
import { AIRCRAFT, difficultyOf } from './data/catalog.js';
import { serviceOf } from './commercial.js';
import { passengerTotal } from './passengers.js';

const DAY = 1440;
export const CONNECTION_WAIT = 720;
export const connectionTime = (hub) => Math.max(30, 90 - 10 * (hub?.levels?.terminal || hub?.level || 1) - (hub?.specialization === 'transfer' ? 20 : 0));
export const freshConnections = () => ({ started: 0, completed: 0, missed: 0, compensation: 0 });
const distanceCache = new Map();
function distance(a,b) {
  const key=[a,b].sort().join(':');
  if (!distanceCache.has(key)) {
    const x=AIRPORT_BY_ID[a],y=AIRPORT_BY_ID[b];
    distanceCache.set(key,geoDistance([x.lon,x.lat],[y.lon,y.lat])*6371);
  }
  return distanceCache.get(key);
}
const strength = (service) => ({economy:.65,balanced:1,frequent:1.25})[service || 'balanced'];
const endpoint = (edge, via) => edge.hub === via ? edge.dest : edge.hub;
export const directionFrom = (route, from) => route.hub === from ? 'poolOut' : 'poolIn';

// Each undirected pair has one preferred transfer hub. Each daily rate is per
// direction and consumes capacity on BOTH legs, shared with all other pairs.
export function planConnections(edges, hubs, { reputation=1, demand=1, allowPair=()=>true }={}) {
  const available=edges.filter(e=>e.capacity>0 && e.flights>0), best=new Map(), budgets=new Map();
  const direct=new Set(available.map(e=>[e.hub,e.dest].sort().join(':')));
  for (const edge of available) budgets.set(edge.id,edge.connectionBudget ?? edge.capacity*.45);
  for (const hub of hubs) {
    const links=available.filter(e=>e.hub===hub.id || e.dest===hub.id);
    for (let i=0;i<links.length;i++) for (let j=i+1;j<links.length;j++) {
      if (!allowPair(links[i],links[j])) continue;
      let first=links[i],second=links[j],a=endpoint(first,hub.id),b=endpoint(second,hub.id);
      if (a===b) continue;
      if (a>b) { [a,b]=[b,a];[first,second]=[second,first]; }
      const key=`${a}:${b}`,km=distance(a,b),detour=(first.km+second.km)/Math.max(1,km);
      if (detour>1.65 || km<250) continue;
      const wait=DAY/Math.min(first.flights,second.flights);
      if (wait>CONNECTION_WAIT) continue;
      const fare=((60+.13*first.km)*first.price+(60+.13*second.km)*second.price)/(60+.13*km);
      const frequency=Math.sqrt(strength(first.service)*strength(second.service));
      const role=hub.specialization==='transfer' ? 1+.6*Math.min(strength(first.service),strength(second.service))/1.25 : 1;
      const x=AIRPORT_BY_ID[a],y=AIRPORT_BY_ID[b];
      const wanted=38*Math.sqrt(x.size*y.size)*demand*reputation**1.2
        *Math.max(.05,(2.1-fare)/1.1)**1.35*frequency*role
        *(x.market.connections+y.market.connections)/2/(1+km/9000)/detour
        *(direct.has(key)?.2:1);
      const score=fare+detour*.4+wait/720;
      const candidate={key,from:a,via:hub.id,to:b,firstRouteId:first.id,secondRouteId:second.id,
        wanted,rate:0,wait,transferMinutes:connectionTime(hub),score,
        ...(first.agreementId || second.agreementId ? {agreementId:first.agreementId || second.agreementId,partnerName:first.partnerName || second.partnerName} : {})};
      const previous=best.get(key);
      if (!previous || score<previous.score || (score===previous.score && hub.id<previous.via)) best.set(key,candidate);
    }
  }
  const pairs=[...best.values()].sort((a,b)=>a.key.localeCompare(b.key)), requested=new Map();
  for (const p of pairs) for (const id of [p.firstRouteId,p.secondRouteId]) requested.set(id,(requested.get(id)||0)+p.wanted);
  const rates={};
  for (const p of pairs) {
    p.rate=p.wanted*Math.min(1,...[p.firstRouteId,p.secondRouteId].map(id=>budgets.get(id)/requested.get(id)));
    p.limited=p.rate<p.wanted*.9;
    p.bottleneck=[p.firstRouteId,p.secondRouteId].sort((a,b)=>budgets.get(a)/requested.get(a)-budgets.get(b)/requested.get(b))[0];
    for (const id of [p.firstRouteId,p.secondRouteId]) rates[id]=(rates[id]||0)+p.rate;
  }
  return {pairs,rates,budgets:Object.fromEntries(budgets)};
}

export const connectionActions = {
  connectionPlan(override=null,partnerOverride=null) {
    const s=this.state, actual=override && s.routes.find(r=>r.hub===override.hub && r.dest===override.dest);
    const changed=actual && ['price','service','cabin'].some(k=>(actual[k] ?? (k==='service'?'balanced':0))!==(override[k] ?? (k==='service'?'balanced':0)));
    const key=`${Math.floor(s.minute/20)}:${this._rev}:${changed?`${actual.id}:${override.price}:${override.service}:${override.cabin}`:''}`;
    if (!partnerOverride && this._connectionCache?.state===s && this._connectionCache.key===key) return this._connectionCache.plan;
    const byRoute=new Map();
    for (const p of s.planes) if (p.routeId!=null && !['repair','conversion'].includes(p.phase) && !p.lease?.returning && (!p.lease || p.lease.end>s.minute+120)) {
      if (!byRoute.has(p.routeId)) byRoute.set(p.routeId,[]);
      byRoute.get(p.routeId).push(p);
    }
    const edges=[];
    for (const saved of s.routes) {
      const r=changed && saved.id===actual.id ? {...saved,...override} : saved, planes=byRoute.get(r.id)?.filter(p=>!AIRCRAFT[p.type].freighter);
      if (!planes?.length || this.closed(r.hub) || this.closed(r.dest)) continue;
      const local=this.factors(r.hub,r.dest,r.price,r.service,r.cabin,null,false).total,policy=serviceOf(r);
      let capacity=0,flights=0;
      for (const p of planes) {
        const t=AIRCRAFT[p.type],seats=this.seatsFor(t,r.cabin),cycle=r.km/t.speed*60+this.routeTurnaround(t,r);
        const target=DAY*planes.length*(seats.eco+seats.biz)*policy.fill/Math.max(1,local*2);
        const legs=DAY/(cycle+Math.min(policy.wait,Math.max(0,target-cycle)));
        capacity+=legs*seats.eco/2;flights+=legs;
      }
      edges.push({...r,capacity,flights});
    }
    const network=this.partnerNetwork(partnerOverride);
    const plan=planConnections([...edges,...network.edges],network.hubs,{reputation:this.repFactor(),demand:difficultyOf(s).demand,
      allowPair:(a,b)=>!a.agreementId || !b.agreementId});
    if(!partnerOverride)this._connectionCache={state:s,key,plan};
    return plan;
  },
  connectionDemand(route) {
    const actual=this.routeTo(route.hub,route.dest);
    return actual ? this.connectionPlan(route).rates[actual.id] || 0 : 0;
  },
  migrateConnections() {
    const s=this.state;
    s.connections ??= {queues:[],today:freshConnections(),yesterday:null,total:freshConnections()};
    if (s.connectionVersion===1) return;
    // Existing waiting travelers retain their seats and totals as local demand.
    // Legacy aircraft already in flight retain their manifest and earnings.
    for (const r of s.routes) for (const key of ['poolOut','poolIn']) {
      const pool=r.passengerPools?.[key];
      if (pool) {pool.leisure+=(pool.connecting || 0);pool.connecting=0;}
    }
    for (const entry of s.managementChanges || []) if (entry.status==='watching') {
      entry.status='changed';entry.reason='Connecting journeys updated';
    }
    s.connectionVersion=1;
  },
  connectionFlightWhy(p) {
    if(this.cargoFlightWhy(p))return this.cargoFlightWhy(p);
    return p?.journeys?.length && ['out','back'].includes(p.phase) ? 'Let this flight land before changing it; connecting passengers are on board.' : null;
  },
  connectionQueueCount(routeId,key,ready=true) {
    return (this.state.connections?.queues || []).reduce((n,q)=>n+(q.routeId===routeId && q.direction===key && (!ready || this.connectionReady(q)) ? Math.floor(q.count) : 0),0);
  },
  connectionReady(q,minute=this.state.minute) {
    if (q.readyAt>minute || (q.deadline!=null && q.deadline<=minute)) return false;
    if (q.leg===1) return true;
    if(q.agreementId) {
      const a=this.agreement(q.agreementId),rv=this.agreementRival(a);
      if(!a || a.status!=='active' || a.end<=minute || !rv || rv.cash<0)return false;
    }
    return this.journeyAvailable(q.secondRouteId);
  },
  syncConnectionPool(route,key) {
    const pool=this.ensurePassengerPool(route,key);
    pool.connecting=this.connectionQueueCount(route.id,key);
    route[key]=passengerTotal(pool);
    return pool;
  },
  stepConnections(minutes) {
    const s=this.state;
    this.migrateConnections();
    const plan=this.connectionPlan(), queues=s.connections.queues, origins=new Map();
    for (const p of plan.pairs) for (const reverse of [false,true]) {
      const firstRouteId=reverse?p.secondRouteId:p.firstRouteId,secondRouteId=reverse?p.firstRouteId:p.secondRouteId;
      const from=reverse?p.to:p.from,to=reverse?p.from:p.to,key=`${from}:${p.via}:${to}`;
      origins.set(key,{key,from,via:p.via,to,firstRouteId,secondRouteId,routeId:firstRouteId,
        direction:directionFrom(this.journeyRoute(firstRouteId),from),leg:0,readyAt:0,count:0,rate:p.rate,
        ...(p.agreementId?{agreementId:p.agreementId,partnerName:p.partnerName}:{})});
    }
    const kept=[];
    for (const q of queues) {
      if (q.leg===0) {
        const offer=origins.get(q.key);
        if (offer && q.firstRouteId===offer.firstRouteId && q.secondRouteId===offer.secondRouteId) {offer.count=q.count;}
      } else if (q.deadline<=s.minute || !this.journeyRoute(q.routeId)) this.missConnection(q);
      else if (q.count>0) kept.push(q);
    }
    for (const q of origins.values()) {
      q.count=Math.min(q.rate*.75,q.count+q.rate*minutes/DAY);
      delete q.rate;
      if (q.count>0) kept.push(q);
    }
    s.connections.queues=kept;
  },
  takeConnectionPassengers(route,key,count,minute=this.state.minute) {
    const s=this.state,manifest=[];
    const eligible=s.connections.queues.filter(q=>q.routeId===route.id && q.direction===key && this.connectionReady(q,minute))
      .sort((a,b)=>b.leg-a.leg || (a.deadline || Infinity)-(b.deadline || Infinity) || a.key.localeCompare(b.key));
    let left=count;
    for (const q of eligible) {
      const n=Math.min(left,Math.floor(q.count));
      if (n<=0) continue;
      q.count-=n;left-=n;
      const terms=q.agreementId && this.agreement(q.agreementId);
      manifest.push({...q,count:n,firstFare:q.firstFare ?? (route.agreementId?(60+.13*route.km)*route.price:this.ticket(route)),
        ...(q.leg===0 && terms?this.partnershipBookedTerms(terms):{})});
      if (q.leg===0) {s.connections.today.started+=n;s.connections.total.started+=n;this.recordPartnershipJourney(q,'started',n);}
      if (!left) break;
    }
    s.connections.queues=s.connections.queues.filter(q=>q.count>0);
    return manifest;
  },
  landConnections(p,route,at,minute=this.state.minute) {
    const s=this.state;
    for (const journey of p.journeys || []) {
      const n=journey.count;
      const statsRoute=route.agreementId?this.route(journey.firstRouteId) || this.route(journey.secondRouteId):route;
      if (journey.leg===1 && at===journey.to) {
        this.settlePartnershipLeg(journey,route,p);
        s.connections.today.completed+=n;s.connections.total.completed+=n;
        this.recordCampaignConnection('completed',n);
        if(statsRoute)(statsRoute.today.connections ||= freshConnections()).completed+=n;
        this.recordPartnershipJourney(journey,'completed',n);
      } else if (journey.leg===0 && at===journey.via) {
        this.settlePartnershipLeg(journey,route,p);
        const onward=this.journeyRoute(journey.secondRouteId);
        const transfer={...journey,leg:1,routeId:journey.secondRouteId,direction:onward?directionFrom(onward,at):'poolOut',
          arrivedAt:minute,readyAt:minute+connectionTime(this.journeyHub(at)),deadline:minute+CONNECTION_WAIT};
        if (onward) s.connections.queues.push(transfer);else this.missConnection(transfer);
        if(statsRoute)(statsRoute.today.connections ||= freshConnections()).started+=n;
      } else this.missConnection(journey);
    }
    delete p.journeys;
  },
  missConnection(q) {
    const s=this.state,n=Math.floor(q.count);
    if (!n) return;
    const compensation=Math.round(n*Math.min(120,Math.max(25,(q.firstFare || 100)*.25)));
    const a=this.agreement(q.agreementId),rv=this.agreementRival(a);
    const partnerLiable=typeof q.secondRouteId==='string' && !!rv;
    const charged=partnerLiable?0:compensation;
    if(partnerLiable) {
      rv.cash-=compensation;this.recordPartnerEarnings(rv,null,{cost:compensation});
      this.recordPartnershipJourney(q,'partnerCompensation',compensation);
    } else {
      s.money-=compensation;s.today.cost+=compensation;s.today.connectionCompensation=(s.today.connectionCompensation || 0)+compensation;
      this.recordPartnershipJourney(q,'compensation',compensation);
    }
    for (const stats of [s.connections.today,s.connections.total]) {stats.missed+=n;stats.compensation+=charged;}
    this.recordCampaignConnection('missed',n);
    this.recordPartnershipJourney(q,'missed',n);
    const r=this.route(q.secondRouteId) || this.route(q.firstRouteId);
    if (r) {r.today.cost+=charged;const stats=r.today.connections ||= freshConnections();stats.missed+=n;stats.compensation+=charged;}
  },

  connectionStatus(route,includePlan=true) {
    const s=this.state,queues=(s.connections?.queues || []).filter(q=>q.leg===1 && q.routeId===route.id);
    const blocked=this.closed(route.hub) || this.closed(route.dest) || !this.planesOn(route.id).some(p=>!['repair','conversion'].includes(p.phase) && !p.lease?.returning);
    const atRisk=queues.filter(q=>blocked || s.minute-q.arrivedAt>=CONNECTION_WAIT/2);
    const waitingJourneys=new Map();
    if (includePlan) for (const q of queues) {
      const previous=waitingJourneys.get(q.key);
      if (previous) previous.waiting+=q.count;
      else waitingJourneys.set(q.key,{key:q.key,from:q.from,via:q.via,to:q.to,firstRouteId:q.firstRouteId,secondRouteId:q.secondRouteId,waiting:q.count,transferMinutes:q.readyAt-q.arrivedAt,agreementId:q.agreementId,partnerName:q.partnerName});
    }
    return {blocked:!!blocked,waiting:queues.reduce((n,q)=>n+q.count,0),atRisk:atRisk.reduce((n,q)=>n+q.count,0),
      nextDeadline:queues.length?Math.min(...queues.map(q=>q.deadline)):null,
      pairs:includePlan?this.connectionPlan().pairs.filter(p=>p.firstRouteId===route.id || p.secondRouteId===route.id):[],
      waitingJourneys:[...waitingJourneys.values()],
      today:route.today.connections || freshConnections(),yesterday:route.yesterday?.connections || null};
  },
  closeConnectionDay() {
    const c=this.state.connections;
    if (!c) return;
    if (c.today.missed) {
      const route=this.state.routes.slice().sort((a,b)=>(b.today.connections?.missed || 0)-(a.today.connections?.missed || 0))[0];
      this.emit('toast',{text:`${c.today.missed} missed connections today · $${Math.round(c.today.compensation).toLocaleString()} compensation paid`,kind:'bad',...(route?{target:{kind:'route',id:route.id}}:{})});
    }
    c.yesterday={...c.today};c.today=freshConnections();
  },
};
