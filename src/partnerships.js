// Reciprocal interline agreements. Rival flights reserve real economy seats;
// their remaining cabin and operating costs stay in the normal rival ledger.
import { geoDistance } from 'd3-geo';
import { AIRPORT_BY_ID } from './data/airports.js';
import { AIRCRAFT, CABINS } from './data/catalog.js';
import { serviceOf } from './commercial.js';

export const PARTNERSHIP_DAYS = 28;
export const PARTNERSHIP_LIMIT = 2;
export const PARTNERSHIP_TERMS = {
  reciprocal: { name: 'Reciprocal', fee: 75000, reputation: 50, receive: .1, pay: .1 },
  access: { name: 'Partner-favored', fee: 25000, reputation: 40, receive: .08, pay: .18 },
};
const DAY=1440;
export const airlineKey = rv => rv.generation || `${rv.id}:${rv.name}:${rv.hub}`;
export const agreementActive = (s,a) => a.status==='active' && a.end>s.minute;
export const partnerRouteId = (a,r) => `p:${a.id}:${r.hub}:${r.dest}`;
export const partnerSeats = r => Math.floor(Math.floor(AIRCRAFT[r.type].seats*(1-CABINS[r.cabin || 0].b))*.2);
const stats = () => ({started:0,completed:0,missed:0,sent:0,received:0,earned:0,paid:0,compensation:0,partnerCompensation:0});
const bump = (a,key,n) => {if(a) for(const st of [a.today,a.total]) st[key]=(st[key] || 0)+n;};
export function partnerReservation(s,rv,r) {
  const agreements=s.partnerships?.agreements || [];
  return agreements.some(a=>a.rivalId===rv.id && a.airlineKey===airlineKey(rv) &&
    ((agreementActive(s,a) && s.routes.some(pr=>[pr.hub,pr.dest].some(id=>id===r.hub || id===r.dest))) || (r.partnerDay?.pax || 0)>0 || s.connections?.queues.some(q=>q.agreementId===a.id && q.leg===1 && q.routeId===partnerRouteId(a,r))
      || s.planes?.some(p=>p.journeys?.some(q=>q.agreementId===a.id && q.secondRouteId===partnerRouteId(a,r)))
      || s.partnerships.flights.some(p=>p.routeId===partnerRouteId(a,r) && p.journeys?.length))) ? partnerSeats(r) : 0;
}
function edgeFor(a,rr) {
  const t=AIRCRAFT[rr.type],x=AIRPORT_BY_ID[rr.hub],y=AIRPORT_BY_ID[rr.dest],km=geoDistance([x.lon,x.lat],[y.lon,y.lat])*6371;
  const wait=t.turnaround+serviceOf(rr).wait*.25, duration=km/t.speed*60, flights=DAY/(duration+wait);
  return {...rr,id:partnerRouteId(a,rr),agreementId:a.id,owner:a.rivalId,partnerName:a.name,km,flights,wait,duration,
    capacity:flights*partnerSeats(rr)/2,connectionBudget:flights*partnerSeats(rr)/2,today:{}};
}

export const partnershipActions = {
  migratePartnerships() {
    const s=this.state;
    s.partnerships ??= {agreements:[],flights:[],nextId:1};
  },
  partnershipBookedTerms(a) {const t=PARTNERSHIP_TERMS[a.terms];return {pay:t.pay,receive:t.receive};},
  agreement(id) {return this.state.partnerships?.agreements.find(a=>a.id===id);},
  agreementFor(id) {return this.state.partnerships?.agreements.filter(a=>a.rivalId===id && a.airlineKey===airlineKey(this.rival(id) || {})).at(-1);},
  agreementRival(a) {const rv=a && this.rival(a.rivalId);return rv?.hub && airlineKey(rv)===a.airlineKey ? rv : null;},
  journeyRoute(id) {
    if (typeof id!=='string' || !id.startsWith('p:')) return this.route(id);
    const [,agreementId,hub,dest]=id.split(':'),a=this.agreement(+agreementId),rv=this.agreementRival(a);
    const rr=rv?.routes.find(r=>r.hub===hub && r.dest===dest);
    return rr ? edgeFor(a,rr) : null;
  },
  journeyHub(id) {
    return this.hub(id) || this.state.rivals.flatMap(rv=>rv.hubs || []).find(h=>h.id===id) || {id,level:1};
  },
  journeyAvailable(id) {
    const r=this.journeyRoute(id);
    if (!r || this.closed(r.hub) || this.closed(r.dest)) return false;
    if (r.agreementId) return !r.lease || r.lease.end>this.state.minute+120;
    return this.planesOn(r.id).some(p=>!['repair','conversion'].includes(p.phase) && !AIRCRAFT[p.type].freighter && !p.lease?.returning && (!p.lease || p.lease.end>this.state.minute+120));
  },
  partnerNetwork(agreements=null) {
    const s=this.state,edges=[],hubs=new Map(s.hubs.map(h=>[h.id,h]));
    const ownAirports=new Set(s.routes.flatMap(r=>[r.hub,r.dest]));
    for (const a of agreements || s.partnerships?.agreements || []) {
      const rv=this.agreementRival(a);
      if (!agreementActive(s,a) || !rv || rv.cash<0) continue;
      for(const h of rv.hubs) hubs.set(h.id,h);
      for(const rr of rv.routes) if ((ownAirports.has(rr.hub) || ownAirports.has(rr.dest)) && !this.closed(rr.hub) && !this.closed(rr.dest)
        && (!rr.lease || rr.lease.end>s.minute+120)) {
          edges.push(edgeFor(a,rr));
          for(const id of [rr.hub,rr.dest])if(ownAirports.has(id) && !hubs.has(id))hubs.set(id,{id,level:1});
        }
    }
    return {edges,hubs:[...hubs.values()]};
  },
  partnershipQuote(rivalId,termsId='reciprocal',action='sign') {
    const s=this.state,rv=this.rival(rivalId),terms=PARTNERSHIP_TERMS[termsId],current=this.agreementFor(rivalId);
    const key=`${rivalId}:${termsId}:${action}:${this._rev}:${Math.floor(s.minute/20)}`;
    if(this._partnershipQuoteCache?.state!==s) this._partnershipQuoteCache={state:s,values:new Map()};
    const cache=this._partnershipQuoteCache.values;
    if(cache.has(key))return cache.get(key);
    if(cache.size>40)cache.clear();
    const candidate={id:current && agreementActive(s,current)?current.id:s.partnerships?.nextId || 1,rivalId,name:rv?.name,airlineKey:rv?airlineKey(rv):'',
      status:'active',terms:termsId,start:s.minute,end:Math.max(s.minute,action==='renew'?current?.end || 0:0)+PARTNERSHIP_DAYS*DAY};
    let why=!['sign','renew','end'].includes(action)?'Choose an agreement action.':!rv?.hub?'This airline is no longer operating.':!terms?'Choose agreement terms.':null;
    if(!why && action==='end' && !agreementActive(s,current || {}))why='This agreement has already ended.';
    if(action!=='end' && !why) {
      if(action==='sign' && current && agreementActive(s,current))why='You already have an active agreement with this airline.';
      else if(action==='renew' && (!current || !agreementActive(s,current)))why='This agreement is no longer active. Review a new offer.';
      else if(action==='renew' && current.end-s.minute>3*DAY)why='Renewal opens in the final three days.';
      else if(action==='sign' && (s.partnerships?.agreements || []).filter(a=>agreementActive(s,a)).length>=PARTNERSHIP_LIMIT)why='You can have two active partnerships. End one before signing another.';
      else if(action==='sign' && current?.endedAt!=null && s.minute<current.endedAt+7*DAY)why='Wait seven days after ending this agreement before signing again.';
      else if(action==='sign' && current && this.partnershipOutstanding(current))why='Let the remaining booked journeys finish before starting a new agreement.';
      else if(rv.cash<0)why='The airline is rebuilding its cash reserves and is not accepting agreements.';
      else if(rv.routes.some(r=>r.war!=null && r.war>s.day))why='Resolve the active fare war before negotiating.';
      else if(s.rep<terms.reputation)why=`Needs reputation ${terms.reputation}. Yours is ${Math.floor(s.rep)}.`;
    }
    const agreements=[...(s.partnerships?.agreements || []).filter(a=>a.id!==candidate.id),candidate];
    const plan=rv?.hub && terms && action!=='end' ? this.connectionPlan(null,agreements) : this.connectionPlan();
    const pairs=plan.pairs.filter(p=>p.agreementId===candidate.id),volume=pairs.reduce((n,p)=>n+p.rate*2,0);
    const fee=action==='end'?0:terms?.fee || 0;
    if(!why && action!=='end' && volume<1)why='No viable shared journeys yet. Connect a staffed route to a partner hub or a shared airport, with practical onward service.';
    if(!why && action!=='end' && s.money<fee)why='Not enough cash for the agreement fee.';
    const forecast={fares:0,received:0,paid:0},partnerEdges=this.partnerNetwork([candidate]).edges;
    for(const p of pairs) {
      const own=this.route(p.firstRouteId) || this.route(p.secondRouteId),other=partnerEdges.find(e=>e.id===p.firstRouteId || e.id===p.secondRouteId);
      if(own && other) {forecast.fares+=p.rate*2*this.ticket(own);forecast.received+=p.rate*(60+.13*other.km)*other.price*terms.receive;forecast.paid+=p.rate*this.ticket(own)*terms.pay;}
    }
    const quote={candidate,rv,terms,current,pairs,volume,fee,forecast,remaining:s.money-fee,why,action,termsId};
    cache.set(key,quote);return quote;
  },
  applyPartnership(rivalId,termsId,action='sign') {
    // Re-evaluate against live cash, reputation, network and expiry at confirmation.
    this._partnershipQuoteCache=null;this._connectionCache=null;
    const q=this.partnershipQuote(rivalId,termsId,action);if(q.why)return q.why;
    const s=this.state;this.migratePartnerships();
    if(action==='end') {
      q.current.status='ended';q.current.endedAt=s.minute;
      this.emit('toast',{text:`Partnership with ${q.rv.name} ended. Existing journeys keep their booked terms.`,target:{kind:'partnership',id:q.current.id}});
    } else {
      s.money-=q.fee;s.today.cost+=q.fee;s.today.partnershipFees=(s.today.partnershipFees || 0)+q.fee;
      let a=q.current;
      if(action==='renew') {a.end=q.candidate.end;a.terms=termsId;}
      else {a={...q.candidate,today:stats(),yesterday:null,total:stats()};s.partnerships.agreements.push(a);s.partnerships.nextId++;}
      this.emit('toast',{text:`${action==='renew'?'Renewed':'Signed'} a ${PARTNERSHIP_DAYS}-day partnership with ${q.rv.name}.`,kind:'goal',target:{kind:'partnership',id:a.id}});
    }
    this.changed();return null;
  },
  partnershipStatus(a) {
    const s=this.state,rv=this.agreementRival(a),active=agreementActive(s,a);
    const queues=(s.connections?.queues || []).filter(q=>q.agreementId===a.id && q.leg===1);
    const atRisk=queues.filter(q=>!this.journeyAvailable(q.routeId) || s.minute-q.arrivedAt>=360);
    const pairs=active?this.connectionPlan().pairs.filter(p=>p.agreementId===a.id):[];
    const reason=!rv?'Partner stopped operating':!active?(a.status==='ended'?'Agreement ended':'Agreement expired'):rv.cash<0?'New bookings paused · partner cash shortage':!pairs.length?'No shared journeys available':null;
    return {active,reason,pairs,volume:pairs.reduce((n,p)=>n+p.rate*2,0),waiting:queues.reduce((n,q)=>n+q.count,0),
      atRisk:atRisk.reduce((n,q)=>n+q.count,0),queues,expiring:active && a.end-s.minute<=3*DAY};
  },
  stepPartnerships(minutes) {
    this.migratePartnerships();const s=this.state,ps=s.partnerships;
    for(const a of ps.agreements) if(a.status==='active' && (a.end<=s.minute || !this.agreementRival(a))) {
      a.status=a.end<=s.minute?'expired':'closed';
      this._connectionCache=null;
      this.emit('toast',{text:`Partnership with ${a.name} ${a.status==='expired'?'expired':'closed'}. New bookings stopped.`,target:{kind:'partnership',id:a.id}});
    }
    const routes=new Set(s.connections.queues.filter(q=>typeof q.routeId==='string').map(q=>q.routeId));
    for(const id of routes) if(!ps.flights.some(p=>p.routeId===id)) {
      const r=this.journeyRoute(id);
      if(r)ps.flights.push({routeId:id,from:r.hub,nextAt:s.minute});
    }
    for(const p of ps.flights) {
      for(let guard=0;guard<8;guard++) {
        if(p.arriveAt!=null) {
          if(p.arriveAt>s.minute)break;
          const r=p.route,at=p.from===r.hub?r.dest:r.hub;
          this.landConnections(p,r,at,p.arriveAt);
          p.from=at;p.nextAt=p.arriveAt+r.wait;delete p.arriveAt;delete p.route;
        }
        if(!routes.has(p.routeId))break;
        if(p.nextAt>s.minute)break;
        const r=this.journeyRoute(p.routeId);
        if(!r || !this.journeyAvailable(p.routeId)) {p.nextAt=s.minute;break;}
        const departure=Math.max(s.minute-minutes,p.nextAt),key=p.from===r.hub?'poolOut':'poolIn';
        p.journeys=this.takeConnectionPassengers(r,key,partnerSeats(r),departure);
        p.route=r;p.arriveAt=departure+r.duration;p.fare=(60+.13*r.km)*r.price;p.nextAt=departure;
      }
    }
    ps.flights=ps.flights.filter(p=>p.arriveAt!=null || routes.has(p.routeId));
  },
  settlePartnershipLeg(q,r,p) {
    const a=this.agreement(q.agreementId);if(!a)return;
    const rv=this.agreementRival(a),own=!r.agreementId,n=q.count,fare=own?this.ticket(r):p.fare;
    // The operating airline earns its fare. The seller of the first leg earns
    // the agreed referral only when the other airline completes the second leg.
    const referral=q.leg===1?n*fare*(own?q.pay:q.receive):0;
    if(!own) {
      const net=n*fare-referral;
      if(rv) {rv.cash+=net;this.recordPartnerEarnings(rv,r,{rev:net,pax:n});}
      if(q.leg===1) {
        this.state.money+=referral;this.state.today.rev+=referral;
        this.state.today.partnerIncome=(this.state.today.partnerIncome || 0)+referral;
        const first=this.route(q.firstRouteId);if(first)first.today.rev+=referral;
        bump(a,'earned',referral);bump(a,'sent',n);
      }
    } else if(q.leg===1) {
      this.state.money-=referral;this.state.today.cost+=referral;
      this.state.today.partnerPayments=(this.state.today.partnerPayments || 0)+referral;r.today.cost+=referral;
      p.profit-=referral;p.day-=referral;
      if(rv) {rv.cash+=referral;this.recordPartnerEarnings(rv,null,{rev:referral});}
      bump(a,'paid',referral);bump(a,'received',n);
    }
  },
  recordPartnerEarnings(rv,r,delta) {
    rv.partnerDay ??= {rev:0,cost:0,pax:0};
    for(const key of ['rev','cost','pax'])rv.partnerDay[key]+=delta[key] || 0;
    if(r) {
      const actual=rv.routes.find(rr=>rr.hub===r.hub && rr.dest===r.dest);
      if(actual) {actual.partnerDay ??= {rev:0,cost:0,pax:0};for(const key of ['rev','cost','pax'])actual.partnerDay[key]+=delta[key] || 0;}
    }
  },
  recordPartnershipJourney(q,key,n) {bump(this.agreement(q.agreementId),key,n);},
  partnershipOutstanding(a) {
    return this.state.connections?.queues.some(q=>q.leg===1 && q.agreementId===a.id) || [...this.state.planes,...(this.state.partnerships?.flights || [])].some(p=>p.journeys?.some(q=>q.agreementId===a.id));
  },
  partnershipTakeoverWhy(rv) {
    const agreements=(this.state.partnerships?.agreements || []).filter(a=>a.rivalId===rv.id && a.airlineKey===airlineKey(rv));
    if(agreements.some(a=>agreementActive(this.state,a)))return 'End the partnership before taking over this airline.';
    if(agreements.some(a=>this.partnershipOutstanding(a)))return 'Let the remaining partnership journeys finish before taking over this airline.';
    return null;
  },
  closePartnershipDay() {
    for(const a of this.state.partnerships?.agreements || []) {a.yesterday={...a.today};a.today=stats();}
  },
};
