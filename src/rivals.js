// Rival airlines run a daily fleet ledger and pay for every expansion from cash.
// `hub` remains the headquarters for old saves; each route now has its own origin.
import { geoDistance } from 'd3-geo';
import { AIRPORTS, AIRPORT_BY_ID } from './data/airports.js';
import { AIRCRAFT, AIRCRAFT_LIST, PLANE_CAP, UPGRADES, CABINS, AMENITY_INCOME, CARGO_FILL, difficultyOf } from './data/catalog.js';
import { eventDemand, closedBy, fuelFactor } from './events.js';
import { passengerMarket, passengerLoad, PASSENGER_KEYS } from './passengers.js';
import { SERVICES, serviceOf, LEASE_TERMS } from './commercial.js';
import { SPECIALIZATIONS, SPECIALIZATION_DAYS, specializationOf, specializationDemandFor } from './specializations.js';
import { DAY, rivalAircraftValue, rivalLeaseTerms, rivalLeaseCommitment, rivalHubUpkeep, rivalRoleSetup } from './rivalCommercial.js';
import { routeMarket } from './data/markets.js';
import { freightForecastFor, FREIGHT_SERVICES } from './cargo.js';
import { planConnections } from './connections.js';
import { partnerReservation, agreementActive, airlineKey } from './partnerships.js';

const BRANDS = [['Meridian Air', '#e86fa6'], ['Northwind', '#6fd3e8'], ['Crestline', '#a58cff'], ['Borealis', '#5b8def'], ['Sirocco', '#f08a5d'], ['Pacifica', '#c9dc6a']];
const NEW_NAMES = ['Aurora Lines', 'Halcyon Air', 'Tradewind', 'Zephyr', 'Polaris', 'Solstice', 'Albion Sky', 'Cobalt Air', 'Vela', 'Harbour Air'];
export const RIVAL_COUNT = BRANDS.length;
export const TAKEOVER_AT = 25;
export const RETREAT_AT = 50;
export const AI_RULES = {
  easy: { interval: 7, candidates: 5, hubCandidates: 2, reserveDays: 4, hubDelay: 70, maxHubs: 3, lossDays: 14, foresight: 0.2 },
  normal: { interval: 4, candidates: 12, hubCandidates: 3, reserveDays: 7, hubDelay: 45, maxHubs: 5, lossDays: 9, foresight: 0.6 },
  hard: { interval: 2, candidates: 24, hubCandidates: 4, reserveDays: 12, hubDelay: 30, maxHubs: 7, lossDays: 6, foresight: 1 },
};
const PROFILES = [
  { name: 'Network builder', fare: 1, spread: 1.2, hubs: 1 },
  { name: 'Value carrier', fare: 0.85, spread: 0.8, hubs: 0.85 },
  { name: 'Premium carrier', fare: 1.15, spread: 1, hubs: 0.7 },
  { name: 'Regional specialist', fare: 1, spread: 0.5, hubs: 0.45 },
  { name: 'Leisure specialist', fare: 0.9, spread: 0.9, hubs: 0.7 },
  { name: 'Long-haul builder', fare: 1.05, spread: 1.5, hubs: 1 },
];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rules = (s) => AI_RULES[s.diff] || AI_RULES.normal;
const profile = (rv) => PROFILES[rv.style ?? (rv.id - 1) % PROFILES.length];
export const rivalStrategy = (rv) => profile(rv).name;
export const rivalHubIds = (rv) => rv.hub ? (rv.hubs?.map((h) => h.id) || [rv.hub]) : [];
export const rivalAt = (s, id) => s.rivals.find((rv) => rivalHubIds(rv).includes(id)) || null;
const distances = new Map();
function km(a, b) {
  const key = a < b ? `${a}:${b}` : `${b}:${a}`;
  if (!distances.has(key)) {
    const x = AIRPORT_BY_ID[a], y = AIRPORT_BY_ID[b];
    distances.set(key, x && y ? geoDistance([x.lon, x.lat], [y.lon, y.lat]) * 6371 : Infinity);
  }
  return distances.get(key);
}
const origin = (rv, r) => r.hub || rv.hub;
const sameRoute = (a, b, c, d) => (a === c && b === d) || (a === d && b === c);

// A shared endpoint only competes if the other endpoints serve the same region.
// London–Paris and Sydney–Paris do not draw from the same passenger market.
export function marketOverlap(a, b, c, d) {
  if (sameRoute(a, b, c, d)) return 1;
  let distance;
  if (b === d) distance = km(a, c);
  else if (a === c) distance = km(b, d);
  else if (a === d) distance = km(b, c);
  else if (b === c) distance = km(a, d);
  else return 0;
  return distance < 1200 ? 0.55 * (1 - distance / 1600) : 0;
}

const aircraftValue = rivalAircraftValue;
const openCost = (a, b, type) => AIRCRAFT[type].price + Math.round((20e3 + 30 * km(a, b)) / 1000) * 1000;
const rangeFor = (level) => Math.max(...AIRCRAFT_LIST.filter((t) => t.cls <= level).map((t) => t.range));
const hubCost = (id, count) => (2e6 + 1.5e6 * AIRPORT_BY_ID[id].size) * count * AIRPORT_BY_ID[id].market.expansion + 2e6;
const reserve = (s, rv) => Math.max(600e3, (rv.cost || 0) * rules(s).reserveDays) + rivalLeaseCommitment(rv, s.day * DAY);
const hubUpkeep = rivalHubUpkeep;
const commercialStats = () => ({leased:0,renewed:0,purchased:0,returned:0,services:0,roles:0});
const candidateFares = (rv,fares) => [...new Set(fares.map((n)=>rv.style===1?Math.min(.9,n):n))];
const cabinChoices = (rv,h) => h.specialization==='budget' || [1,4].includes(rv.style) ? [0] : h.specialization==='premium' ? [1,2] : rv.style===3 ? [0,1] : [0,1,2];
const servicePressure = (r) => ({economy:.9,balanced:1,frequent:1.1})[r.service || 'balanced'] || 1;
const average = (values) => values.length ? values.reduce((n, v) => n + v, 0) / values.length : 0;
let connectionCache=null;
// Fare, cabin and aircraft candidates share the same competing network during
// one airline's planning turn. Never retain these snapshots across turns/days.
let marketCache=null, playerPresenceCache=null;
function networkConnections(s,rv,steady) {
  const cached=connectionCache?.get(rv)?.[steady?'steady':'current'];
  if (cached) return cached;
  const edges=rv.routes.filter(r=>steady || (!closedBy(s,origin(rv,r)) && !closedBy(s,r.dest))).map(r=>{
    const t=AIRCRAFT[r.type],distance=km(origin(rv,r),r.dest),policy=serviceOf(r),
      flights=DAY/(distance/t.speed*60+t.turnaround+policy.wait*.25);
    return {...r,id:`${origin(rv,r)}:${r.dest}`,hub:origin(rv,r),km:distance,flights,
      capacity:flights*(Math.floor(t.seats*(1-CABINS[r.cabin || 0].b))-partnerReservation(s,rv,r))/2};
  });
  const plan=planConnections(edges,rv.hubs,{reputation:.7+rv.rep*.006});
  if (connectionCache) connectionCache.set(rv,{...connectionCache.get(rv),[steady?'steady':'current']:plan});
  return plan;
}

// Old strength represented competitive damage, not debt. Keep the network and
// give it a one-time working balance; future loads never refill that balance.
export function migrateRivals(s) {
  for (const rv of s.rivals) {
    if (rv.hub && !AIRPORT_BY_ID[rv.hub]) rv.hub = null;
    const old = rv.aiVersion !== 2;
    rv.hubs ??= rv.hub ? [{ id: rv.hub, level: 2 }] : [];
    rv.hubs = rv.hubs.filter((h) => AIRPORT_BY_ID[h.id]).map((h) => ({ ...h, level: clamp(h.level || 2, 1, 5) }));
    if (!rv.hub) { rv.hubs = []; rv.routes = []; }
    if (rv.hub && !rv.hubs.some((h) => h.id === rv.hub)) rv.hubs.unshift({ id: rv.hub, level: 2 });
    rv.routes = (rv.routes || []).filter((r) => AIRPORT_BY_ID[r.dest] && rv.hubs.some((h) => h.id === (r.hub || rv.hub)) && r.dest !== (r.hub || rv.hub));
    const seen = new Set();
    rv.routes = rv.routes.filter((r) => {
      r.hub ||= rv.hub;
      const key = [r.hub, r.dest].sort().join(':');
      if (seen.has(key)) return false;
      seen.add(key);
      r.type ||= (AIRCRAFT_LIST.find((t) => t.range >= km(r.hub, r.dest)) || AIRCRAFT_LIST.at(-1)).id;
      if (!AIRCRAFT[r.type]) return false;
      const h = rv.hubs.find((h) => h.id === r.hub);
      h.level = Math.max(h.level, AIRCRAFT[r.type].cls);
      r.age ??= 0; r.price ??= 1; r.lossDays ??= 0;
      if (old) { delete r.war; delete r.warStarted; }
      return true;
    });
    // Older rivals could hold fourteen routes at a single base. Preserve that
    // network with enough gates instead of stranding it above the new limits.
    for (const h of rv.hubs) while (h.level < 5 && rv.routes.filter((r) => r.hub === h.id).length > PLANE_CAP[h.level]) h.level++;
    rv.cash ??= rv.hub ? 8e6 + rv.routes.length * 200e3 : 0;
    rv.rep ??= 55; rv.profit ??= 0; rv.cost ??= 0; rv.pax ??= 0;
    rv.history ??= []; rv.lossDays ??= 0; rv.negativeDays ??= 0;
    rv.next ??= s.day + 3; rv.nextHub ??= s.day + rules(s).hubDelay;
    rv.style ??= (rv.id - 1) % PROFILES.length;
    rv.str = old ? (rv.hub ? 85 : 0) : (rv.str ?? 85);
    rv.activity ??= 'Building a sustainable network';
    rv.decisions ??= []; rv.commercialStats ??= commercialStats();
    rv.aiVersion = 2;
  }
}

function playerPresence(s, r) {
  if (playerPresenceCache?.has(r)) return playerPresenceCache.get(r);
  if (closedBy(s, r.hub) || closedBy(s, r.dest)) return 0;
  const seats = (s.planes || []).filter((p) => p.routeId === r.id && !['repair','conversion'].includes(p.phase)).reduce((n, p) => n + (AIRCRAFT[p.type]?.seats || 0), 0);
  if (!seats) return 0;
  const presence=clamp(Math.max(r.yesterday?.pax || 0, seats * 2) / 600, 0.15, 1.5) * servicePressure(r);
  playerPresenceCache?.set(r,presence);
  return presence;
}

function rivalsInMarket(s, a, b, except) {
  const key=`${except?.id ?? 'player'}:${a}:${b}`;
  if (marketCache?.has(key)) return marketCache.get(key);
  const entries = [];
  for (const rv of s.rivals) {
    if (!rv.hub || rv.id === except?.id) continue;
    let best = null;
    for (const rr of rv.routes) {
      if(AIRCRAFT[rr.type].freighter)continue;
      const overlap = marketOverlap(a, b, origin(rv, rr), rr.dest);
      if (!overlap || closedBy(s, origin(rv, rr)) || closedBy(s, rr.dest)) continue;
      const capacity = AIRCRAFT[rr.type]?.seats || 90;
      const weight = overlap * clamp(capacity / 120, 0.4, 1.6) * servicePressure(rr);
      if (!best || weight > best.weight) best = { rv, rr, weight };
    }
    if (best) entries.push(best);
  }
  marketCache?.set(key,entries);
  return entries;
}

// Used by player forecasts as well as operating routes. Each airline is counted
// once in a market, so opening many nearby routes cannot multiply its pressure.
export function competition(s, hubId, destId, price) {
  let pressure = 0, war = false;
  const names = [];
  for (const { rv, rr, weight } of rivalsInMarket(s, hubId, destId)) {
    const fighting = rr.war != null && s.day < rr.war;
    pressure += 0.5 * weight * clamp(1 + 2 * (price - rr.price), 0.3, 2) * (fighting ? 1.15 : 1);
    war ||= fighting;
    names.push({ name: rv.name, color: rv.color, price: rr.price, base: rivalHubIds(rv).includes(destId), war: fighting ? rr.war : null });
  }
  pressure *= (1.25 - (s.rep ?? 50) / 200) * difficultyOf(s).rivals;
  return { share: 1 / (1 + pressure), names, war };
}

// Reused across policy/aircraft candidates for one market and fare. Keeping the
// expensive competition scan outside the cabin/service loop bounds planning work.
function routeContext(s, rv, r, steady) {
  const hubId=origin(rv,r),h=rv.hubs.find((h)=>h.id===hubId),a=AIRPORT_BY_ID[r.dest],distance=km(hubId,r.dest);
  let pressure=0;
  for (const {rr,rv:other,weight} of rivalsInMarket(s,hubId,r.dest,rv)) pressure+=.5*weight*clamp(1+2*(r.price-rr.price),.3,2)*(.8+other.rep/250);
  let playerWeight=0;
  for (const pr of s.routes) {
    const overlap=marketOverlap(hubId,r.dest,pr.hub,pr.dest);
    if (overlap) playerWeight=Math.max(playerWeight,overlap*playerPresence(s,pr)*clamp(1+2*(r.price-pr.price),.3,2));
  }
  pressure+=playerWeight*(.75+(s.rep??50)/200);
  const season=steady?1:1+(a.leisure ? .35 : .1)*Math.cos(2*Math.PI*((s.day%360)-(a.lat>23?195:15))/360);
  const event=steady?1:eventDemand(s,hubId,r.dest);
  const fuel=steady?(s.fuel||1):fuelFactor({...s,fuelLock:null,events:s.events.map((e)=>e.type==='fuelSpike'?{...e,hedged:false}:e)});
  return {hubId,h,a,distance,season,fuel,markets:new Map(),connecting:networkConnections(s,rv,steady).rates[`${hubId}:${r.dest}`] || 0,freight:routeMarket(AIRPORT_BY_ID[hubId],a).freight,
    base:55*a.size*(1+.15*(h.level-1))*event/(1+distance/9000)/(1+pressure),
    grounded:!steady && !!(closedBy(s,hubId) || closedBy(s,r.dest))};
}

export function routeEconomy(s, rv, r, {steady=false, context=null}={}) {
  const c=context || routeContext(s,rv,r,steady),{h,a,distance}=c,t=AIRCRAFT[r.type],policy=serviceOf(r),cabin=r.cabin || 0;
  const role=specializationOf(h);
  if(t.freighter) {
    const q=freightForecastFor(s,{...r,hub:c.hubId,km:distance},t,h,{rivalId:rv.id,reputation:.7+rv.rep*.006,closed:c.grounded,
      flightCost:distance*t.burn*c.fuel+t.fee*AIRPORT_BY_ID[c.hubId].market.operating*role.handling,maintenance:t.price*.008*(1+(r.age || 0)/150)+(r.lease?.daily || 0)});
    return {...q,pax:0,grounded:c.grounded,rent:r.lease?.daily || 0,cargo:q.revenue,segments:{leisure:0,business:0,connecting:0,charter:0}};
  }
  const marketKey=`${r.service || 'balanced'}:${cabin}`;
  let passengers=c.markets.get(marketKey);
  if (!passengers) { passengers=passengerMarket({from:AIRPORT_BY_ID[c.hubId],to:a,base:c.base*specializationDemandFor(h,r.price,cabin,r.service || 'balanced'),
    price:r.price,season:c.season,reputation:.7+rv.rep*.006,connection:0,service:r.service || 'balanced',cabin,role:h.specialization});
    passengers.segments.connecting=c.connecting;passengers.total+=c.connecting;c.markets.set(marketKey,passengers); }
  const seats={eco:Math.floor(t.seats*(1-CABINS[cabin].b)),biz:Math.floor(t.seats*CABINS[cabin].b/2)};
  const reserved=partnerReservation(s,rv,r);
  seats.eco=Math.max(0,seats.eco-reserved);
  const capacity=seats.eco+seats.biz,cycle=distance/t.speed*60+t.turnaround;
  const target=DAY*capacity*policy.fill/Math.max(1,passengers.total*2);
  const legs=c.grounded?0:DAY/(cycle+(reserved?policy.wait*.25:Math.min(policy.wait,Math.max(0,target-cycle))));
  const perLeg=Object.fromEntries(PASSENGER_KEYS.map((id)=>[id,passengers.segments[id]*2/Math.max(1,legs)]));
  const load=passengerLoad(perLeg,seats,passengers.businessPreference),pax=legs*(load.eco+load.biz);
  const freight=CARGO_FILL[h.cargo || 0]* (h.specialization==='cargo'?1.2:1);
  const cargo=legs*t.cargo*Math.min(1,freight)*distance*.25*(.5+a.size/10)*c.freight*(h.specialization==='cargo'?2:1);
  const revenue=legs*(load.eco+load.biz*(h.specialization==='premium'?3.6:3))*(60+.13*distance)*r.price + pax*AMENITY_INCOME[h.amenities || 0] + cargo;
  const rent=r.lease?.daily || 0;
  const cost=legs*(distance*t.burn*c.fuel+t.fee*AIRPORT_BY_ID[c.hubId].market.operating*role.handling)+t.price*.008*(1+(r.age || 0)/150)+rent;
  return {profit:Math.round(revenue-cost),revenue:Math.round(revenue),cost:Math.round(cost),pax:Math.round(pax),
    load:legs?pax/(legs*capacity):0,grounded:c.grounded,flights:legs,rent,cargo:Math.round(cargo),segments:passengers.segments};
}

function policyCandidates(s,rv,r,fares,steady=true,full=true) {
  const choices=[];
  if(AIRCRAFT[r.type].freighter)return Object.keys(FREIGHT_SERVICES).map(cargoService=>{const route={...r,cargoService};return {route,...routeEconomy(s,rv,route,{steady})};});
  for (const price of candidateFares(rv,fares)) {
    const context=routeContext(s,rv,{...r,price},steady);
    for (const service of full?Object.keys(SERVICES):[r.service || 'balanced']) for (const cabin of full?cabinChoices(rv,context.h):[r.cabin || 0]) {
      const route={...r,price,service,cabin};
      choices.push({route,...routeEconomy(s,rv,route,{steady,context})});
    }
  }
  return choices;
}

export function rivalPolicyQuote(s,rv,r,{full=true}={}) {
  const fares=r.war!=null?[r.price]:[r.price,...[-.1,.1].map((d)=>Math.round(clamp(r.price+d,.65,1.4)*100)/100)];
  const current={route:{...r},...routeEconomy(s,rv,r,{steady:true})};
  const choices=policyCandidates(s,rv,r,fares,true,full);
  return choices.reduce((best,q)=>q.profit>best.profit+500?q:best,rv.style===1 && r.price>.9 ? choices[0] : current);
}

export function pressureOn(s, rv) {
  const contested = rv.routes.filter((rr) => s.routes.some((r) => playerPresence(s, r) > 0 && marketOverlap(r.hub, r.dest, origin(rv, rr), rr.dest) > 0));
  return contested.length ? [{ label: `Competing with you in ${contested.length} ${contested.length === 1 ? 'market' : 'markets'}`, v: contested.length }] : [];
}

function quoteRoute(s, rv, hub, dest, war=false) {
  let best=null;
  const foresight=rules(s).foresight;
  const preferred=profile(rv).fare;
  const fares=war?[.8]:rules(s).foresight===1?([1,4].includes(rv.style)?[.75,.8,.9,1]:[.8,.9,1,1.1,1.2,1.3]):[preferred-.1,preferred,preferred+.1].map((n)=>Math.round(n*100)/100);
  const types=AIRCRAFT_LIST.filter((t)=>t.cls<=hub.level && t.range>=km(hub.id,dest) && (!t.freighter || (!war && hub.cargo>0)));
  const contexts=candidateFares(rv,fares).map((price)=>({price,now:routeContext(s,rv,{hub:hub.id,dest,price},false),normal:routeContext(s,rv,{hub:hub.id,dest,price},true)}));
  for (const t of types) {
    let chosen=null;
    for (const {price,now,normal} of (t.freighter?contexts.slice(0,1):contexts)) for (const service of (t.freighter?Object.keys(FREIGHT_SERVICES):Object.keys(SERVICES))) for (const cabin of (t.freighter?[0]:cabinChoices(rv,hub))) {
      const route={hub:hub.id,dest,type:t.id,age:0,price,service:t.freighter?'balanced':service,cargoService:t.freighter?service:'bulk',cabin,lossDays:0};
      const usual=routeEconomy(s,rv,route,{steady:true,context:normal});
      // Hard chooses by steady profit. Today's quote is only needed for the
      // winning policy of each aircraft, to evaluate a seasonal lease.
      const current=foresight===1?null:routeEconomy(s,rv,route,{context:now}).profit;
      const profit=foresight===1?usual.profit:current*(1-foresight)+usual.profit*foresight;
      if (!chosen || profit>chosen.profit) chosen={route,profit,current,usual:usual.profit,context:now};
    }
    if (!chosen) continue;
    if (chosen.current==null) chosen.current=routeEconomy(s,rv,chosen.route,{context:chosen.context}).profit;
    delete chosen.context;
    const ownedCost=openCost(hub.id,dest,t.id),routeFee=ownedCost-t.price;
    const purchaseFits=ownedCost<=rv.cash-reserve(s,rv);
    const seasonal=!war && chosen.current>chosen.usual*1.35 && eventDemand(s,hub.id,dest)>1.2;
    const consider=(q)=>{ if (q.profit>1500 && q.cost+(q.rentCommitment || 0)<=rv.cash-reserve(s,rv) && (!best || q.score>best.score)) best=q; };
    if (purchaseFits) consider({...chosen,cost:ownedCost,score:chosen.profit/Math.sqrt(ownedCost)});
    if (!purchaseFits || seasonal) for (const {days} of LEASE_TERMS) {
      const terms=rivalLeaseTerms(s,t.id,days),cost=routeFee+terms.fee;
      const boostDays=Math.max(0,...s.events.filter((e)=>e.airport===dest || e.airport===hub.id).filter((e)=>e.start<=s.day && e.start+e.days>s.day).map((e)=>Math.min(days,e.start+e.days-s.day)));
      const income=seasonal?(chosen.current*boostDays+chosen.usual*(days-boostDays))/days:chosen.profit;
      const profit=income-terms.lease.daily;
      if (profit*days<=cost) continue;
      consider({...chosen,route:{...chosen.route,lease:terms.lease},profit,cost,rentCommitment:terms.lease.daily*days,score:profit/Math.sqrt(cost+terms.lease.daily*days)});
    }
  }
  return best;
}

function candidates(s, rv, h, rand) {
  if (rv.routes.filter((r) => origin(rv, r) === h.id).length >= PLANE_CAP[h.level]) return [];
  return AIRPORTS.filter((a) => a.id !== h.id && km(h.id, a.id) > 250 && km(h.id, a.id) <= rangeFor(h.level)
    && !rv.routes.some((r) => sameRoute(h.id, a.id, origin(rv, r), r.dest))
    && !(rv.retired || []).some((r) => sameRoute(h.id, a.id, r.hub, r.dest) && r.until > s.day))
    .map((a) => ({ a, score: a.size * (a.leisure && rv.style === 4 ? 1.25 : 1) * (0.85 + rand() * 0.3) / (1 + km(h.id, a.id) / 7000) }))
    .sort((a, b) => b.score - a.score).slice(0, rules(s).candidates).map(({ a }) => a);
}

function bestExpansion(s, rv, rand, hubs = rv.hubs) {
  let best = null;
  for (const h of hubs) for (const a of candidates(s, rv, h, rand)) {
    const q = quoteRoute(s, rv, h, a.id);
    if (q && q.profit > 1500 && q.cost <= rv.cash - reserve(s, rv) && (!best || q.score > best.score)) best = q;
  }
  return best;
}

function buyRoute(s, rv, q) {
  if (!q || q.cost > rv.cash) return false;
  rv.cash -= q.cost;
  rv.routes.push(q.route);
  connectionCache?.delete(rv);
  rv.activity = `${q.route.lease ? 'Leased capacity for' : 'Opened'} ${q.route.hub}–${q.route.dest}${q.route.lease ? ` · ${q.route.lease.days} days` : ''}`;
  if (q.route.lease) { rv.commercialStats.leased++; commercialNote(s,rv,rv.activity); }
  rv.activityDay = s.day;
  return true;
}

function newAirline(s, id, name, color, hub) {
  return { id, name, color, hub, generation:`${id}:${s.day}:${name}:${hub}`, hubs: [{ id: hub, level: 2 }], routes: [], cash: 8e6, rep: 55,
    profit: 0, cost: 0, pax: 0, history: [], str: 85, lossDays: 0, negativeDays: 0,
    next: s.day + rules(s).interval + (id - 1) % rules(s).interval, nextHub: s.day + rules(s).hubDelay + (id - 1) * 2,
    style: (id - 1) % PROFILES.length, aiVersion: 2, decisions: [], commercialStats: commercialStats(), activity: 'Building a sustainable network' };
}

export function createRivals(s, rand) {
  const home = s.hubs[0].id, taken = s.hubs.map((h) => h.id), rivals = [];
  for (const [i, [name, color]] of BRANDS.entries()) {
    let pool = AIRPORTS.filter((a) => a.size >= 3 && !taken.includes(a.id));
    if (i < 2) pool = pool.filter((a) => km(a.id, home) > 400).sort((a, b) => km(a.id, home) - km(b.id, home)).slice(0, i === 0 ? 3 : 6);
    else {
      const far = pool.filter((a) => a.size >= 4 && taken.every((id) => km(id, a.id) > 3500));
      if (far.length) pool = far;
    }
    const h = pool[Math.floor(rand() * pool.length)];
    taken.push(h.id);
    rivals.push(newAirline(s, i + 1, name, color, h.id));
  }
  // All headquarters exist before route planning, independent of array order.
  const world = { ...s, rivals };
  for (const rv of rivals) for (let n = 0; n < 2; n++) buyRoute(world, rv, bestExpansion(world, rv, rand));
  return rivals;
}

function announce(s, rv, news, text, at = rv.hub) {
  rv.activity = text; rv.activityDay = s.day;
  news.push({ text: `${rv.name}: ${text}`, at, target: { kind: 'page', id: 'rivals' } });
}

function commercialNote(s,rv,text,news=null,at=rv.hub) {
  rv.decisions ||= [];rv.decisions.unshift({day:s.day,text});rv.decisions.length=Math.min(5,rv.decisions.length);
  if (news) announce(s,rv,news,text,at);
}

// Expiry is reviewed every day, independently of the airline's planning cadence.
// Owned replacements cost full purchase price; a returned lease has no resale value.
export function reviewRivalLeases(s,rv,news=[]) {
  for (const r of [...rv.routes]) {
    if (!r.lease || r.lease.end>s.day*DAY) continue;
    const owned={...r,age:0};delete owned.lease;
    const type=AIRCRAFT[r.type],normal=routeEconomy(s,rv,owned,{steady:true});
    if (normal.profit>1500 && rv.cash-type.price>=reserve(s,rv)) {
      rv.cash-=type.price;delete r.lease;r.age=0;rv.commercialStats.purchased++;
      commercialNote(s,rv,`Bought a ${type.name} to replace the expiring lease on ${r.hub}–${r.dest}`,news,r.dest);
    } else if (routeEconomy(s,rv,r,{steady:true}).profit>1500 && rv.cash-r.lease.daily*r.lease.days>=reserve(s,rv)) {
      r.lease.end=(s.day+r.lease.days)*DAY;r.lease.billedUntil=s.day*DAY;rv.commercialStats.renewed++;
      commercialNote(s,rv,`Renewed ${r.hub}–${r.dest} aircraft lease for ${r.lease.days} days`,news,r.dest);
    } else closeRoute(s,rv,r,news,'the aircraft lease ended without a sustainable replacement');
  }
}

export function rivalHubRoleQuote(s,rv,hubId,role) {
  const h=rv.hubs.find((h)=>h.id===hubId),current=h?.specialization || 'general';
  if (!h || !SPECIALIZATIONS[role]) return {why:'Unknown hub or role'};
  if (current===role) return {why:'Already using this role'};
  if ((h.specializationUntil || 0)>s.day) return {why:'Hub role is still committed'};
  const routes=rv.routes.filter((r)=>r.hub===hubId),setup=rivalRoleSetup(h,role,routes.length,s);
  if (setup.why) return setup;
  if (rv.cash-setup.cost<reserve(s,rv)) return {...setup,why:'Preserve operating reserves and lease commitments'};
  const model={...rv,hubs:rv.hubs.map((x)=>x.id===hubId?setup.hub:x),routes:rv.routes.map((r)=>({...r}))};
  for (const r of model.routes.filter((r)=>r.hub===hubId)) {
    const fares=r.war!=null?[r.price]:[...new Set([r.price,...(role==='budget'?[.8,.9]:[1,1.2])])];
    const best=policyCandidates(s,model,r,fares).reduce((a,b)=>b.profit>a.profit?b:a);
    Object.assign(r,{price:best.route.price,service:best.route.service,cabin:best.route.cabin});
  }
  connectionCache?.delete(model);
  const profit=(airline)=>airline.routes.filter((r)=>r.hub===hubId).reduce((n,r)=>n+routeEconomy(s,airline,r,{steady:true}).profit,0)-hubUpkeep(airline.hubs.find((x)=>x.id===hubId),s);
  const before=profit(rv),after=profit(model);
  return {...setup,why:null,before,after,gain:after-before,policies:model.routes.filter((r)=>r.hub===hubId).map((r)=>({dest:r.dest,price:r.price,service:r.service,cabin:r.cabin}))};
}

function reviewHubRole(s,rv,news) {
  if (s.day<(rv.nextRole || 0) || average(rv.history)<=0 || rv.cash<reserve(s,rv)+200e3) return;
  rv.nextRole=s.day+({easy:21,normal:14,hard:7}[s.diff] || 14);
  const h=rv.hubs.filter((h)=>(h.specializationUntil || 0)<=s.day && !closedBy(s,h.id) && rv.routes.filter((r)=>r.hub===h.id).length>=2)
    .sort((a,b)=>(a.roleReviewed || 0)-(b.roleReviewed || 0))[0];
  if (!h) return;h.roleReviewed=s.day;
  const preferred=[['transfer','premium'],['budget'],['premium'],['budget','transfer'],['budget','cargo'],['transfer','cargo']][rv.style];
  let best=null;
  for (const role of ['general',...preferred]) {
    const q=rivalHubRoleQuote(s,rv,h.id,role);
    if (q.why || q.gain<1500 || q.gain*60<q.cost) continue;
    const score=q.gain-q.cost/60+(preferred.includes(role)?q.gain*.15:0);
    if (!best || score>best.score) best={...q,role,score};
  }
  if (!best) return;
  rv.cash-=best.cost;Object.assign(h,best.hub,{specializationUntil:s.day+SPECIALIZATION_DAYS});
  connectionCache?.delete(rv);
  for (const choice of best.policies) Object.assign(rv.routes.find((r)=>r.hub===h.id && r.dest===choice.dest),choice);
  rv.commercialStats.roles++;
  commercialNote(s,rv,`Converted ${h.id} to ${SPECIALIZATIONS[best.role].name}; paid $${Math.round(best.cost).toLocaleString()} including required facilities`,news,h.id);
}

function closeRoute(s, rv, rr, news, reason) {
  rv.cash += aircraftValue(rr) - (rr.lease ? Math.max(0,rr.lease.end-(rr.lease.billedUntil ?? s.day*DAY))/DAY*rr.lease.daily : 0);
  if (rr.lease) rv.commercialStats.returned++;
  rv.routes = rv.routes.filter((r) => r !== rr);
  connectionCache?.delete(rv);
  (rv.retired ||= []).push({ hub: rr.hub, dest: rr.dest, until: s.day + 30 });
  if (rr.war != null) s.warsWon = (s.warsWon || 0) + 1;
  announce(s, rv, news, `Withdrew from ${rr.hub}–${rr.dest}; ${reason}`, rr.dest);
  if (rr.lease) commercialNote(s,rv,`Returned leased ${AIRCRAFT[rr.type].name} on ${rr.hub}–${rr.dest}; remaining rent settled`);
}

function collapse(s, rv, news, bought = false) {
  const hubs = rivalHubIds(rv);
  if (!bought) announce(s, rv, news, `Closed after sustained cash losses. ${hubs.join(', ')} ${hubs.length === 1 ? 'is' : 'are'} available for new hubs`);
  rv.was = hubs.join(', '); rv.hub = null; rv.hubs = []; rv.routes = []; rv.str = 0; rv.pax = 0;
  rv.gone = s.day; rv.back = s.day + 30;
  s.rivalsDown = (s.rivalsDown || 0) + 1;
}
export function removeRival(s, rv) { collapse(s, rv, [], true); }

function arrive(s, rv, rand, news) {
  const taken = new Set([...s.hubs.map((h) => h.id), ...s.rivals.flatMap(rivalHubIds)]);
  const nearby = s.rivals.filter((r) => rivalHubIds(r).some((id) => s.hubs.some((h) => km(h.id, id) < 3500))).length;
  let pool = AIRPORTS.filter((a) => a.size >= 3 && !taken.has(a.id));
  if (nearby < 2) { const near = pool.filter((a) => s.hubs.some((h) => km(h.id, a.id) < 3500)); if (near.length) pool = near; }
  if (!pool.length) { rv.back = s.day + 10; return; }
  const h = pool[Math.floor(rand() * pool.length)];
  const names = NEW_NAMES.filter((name) => !s.rivals.some((r) => r.name === name));
  const name = rv.fresh ? rv.name : names[Math.floor(rand() * names.length)] || `${h.city} Air`;
  const fresh = newAirline(s, rv.id, name, rv.color, h.id);
  for (const key of Object.keys(rv)) delete rv[key];
  Object.assign(rv, fresh);
  for (let n = 0; n < 2; n++) buyRoute(s, rv, bestExpansion(s, rv, rand));
  announce(s, rv, news, `A new airline has opened at ${h.id}`);
}

function openHub(s, rv, rand, news) {
  const hubLimit = Math.max(2, Math.round(rules(s).maxHubs * profile(rv).hubs));
  if (s.day < rv.nextHub || rv.hubs.length >= hubLimit || rv.routes.length < rv.hubs.length * 4 || average(rv.history) <= 0) return false;
  rv.nextHub = s.day + 10;
  const occupied = new Set([...s.hubs.map((h) => h.id), ...s.rivals.flatMap(rivalHubIds)]);
  const pool = AIRPORTS.filter((a) => a.size >= 3 && !occupied.has(a.id) && rv.hubs.every((h) => km(a.id, h.id) > 700)
    && (rv.style !== 3 || km(a.id, rv.hub) < 4500))
    .map((a) => ({ a, score: a.size * (1 + Math.min(1, Math.min(...rv.hubs.map((h) => km(h.id, a.id))) / 6000) * profile(rv).spread) * (0.9 + rand() * 0.2) }))
    .sort((a, b) => b.score - a.score)
    // Screen airport economics cheaply before the expensive route/cabin search.
    // Hard still compares 24 route markets at each of four viable hub locations.
    .filter(({a}) => hubCost(a.id, rv.hubs.length) + reserve(s,rv) + 600e3 <= rv.cash)
    .slice(0, rules(s).hubCandidates);
  let best = null;
  for (const { a } of pool) {
    const cost = hubCost(a.id, rv.hubs.length);
    if (cost + reserve(s, rv) + 600e3 > rv.cash) continue;
    const hub = { id: a.id, level: 2 }, projected = { ...rv, hubs: [...rv.hubs, hub], cash: rv.cash - cost };
    const q = bestExpansion(s, projected, rand, [hub]);
    if (q && q.profit > hubUpkeep(hub, s) * 1.5 && (!best || q.profit / (cost + q.cost) > best.score)) best = { hub, cost, q, score: q.profit / (cost + q.cost) };
  }
  if (!best) return false;
  rv.cash -= best.cost; rv.hubs.push(best.hub); buyRoute(s, rv, best.q);
  rv.nextHub = s.day + rules(s).hubDelay;
  announce(s, rv, news, `Opened hub ${rv.hubs.length} at ${best.hub.id}, with service to ${best.q.route.dest}`, best.hub.id);
  return true;
}

function upgradeHub(s, rv, news) {
  for (const h of rv.hubs) {
    if (h.level >= 5 || rv.routes.filter((r) => r.hub === h.id).length < PLANE_CAP[h.level] - 1) continue;
    const cost = ['runway', 'terminal', 'gates'].reduce((n, key) => n + UPGRADES[key].costs[h.level - 1], 0) * difficultyOf(s).costs * AIRPORT_BY_ID[h.id].market.expansion;
    if (rv.cash - cost < reserve(s, rv) || average(rv.history) <= 0) continue;
    rv.cash -= cost; h.level++;
    announce(s, rv, news, `Expanded ${h.id} to handle larger aircraft and more routes`, h.id);
    return true;
  }
  return false;
}

function reviewRoutes(s, rv, news) {
  let changes=0,first=null;
  for (const rr of [...rv.routes]) {
    if (rr.war!=null && s.day>=rr.war) {
      const canHold=(rr.avgProfit || 0)>0 || (rv.cash>reserve(s,rv)*2 && average(rv.history)>0 && (rr.avgProfit || 0)>-rv.profit*.15);
      if (!canHold) {closeRoute(s,rv,rr,news,'the price war was not sustainable');continue;}
      delete rr.war;delete rr.warStarted;announce(s,rv,news,`Kept ${rr.hub}–${rr.dest} after the price war`,rr.dest);
    }
    const full=s.day>=(rr.nextPolicy || 0) || (!rr.grounded && (rr.lossDays>=2 || rr.profit<rr.avgProfit*.8));
    const q=rivalPolicyQuote(s,rv,rr,{full}),changed=(rr.cargoService || 'bulk')!==(q.route.cargoService || 'bulk') || (rr.service || 'balanced')!==q.route.service || (rr.cabin || 0)!==q.route.cabin;
    Object.assign(rr,{price:q.route.price,service:q.route.service || 'balanced',cabin:q.route.cabin || 0,cargoService:q.route.cargoService || 'bulk'});
    if (full) rr.nextPolicy=s.day+({easy:21,normal:14,hard:7}[s.diff] || 14);
    if (changed) {changes++;first ||= rr;rv.commercialStats.services++;}
    if (rr.war==null && rr.lossDays>=rules(s).lossDays && q.profit<0 && !closedBy(s,rr.hub) && !closedBy(s,rr.dest)) {
      closeRoute(s,rv,rr,news,'redeploying capital from a loss-making service');continue;
    }
    if (!rr.lease && rr.age>=130 && rv.cash>AIRCRAFT[rr.type].price*.18+reserve(s,rv)*.5) {rv.cash-=AIRCRAFT[rr.type].price*.18;rr.age*=.4;}
  }
  if (changes) commercialNote(s,rv,`Adjusted service and cabins on ${changes} ${changes===1?'route':'routes'}; ${first.hub}–${first.dest} now ${AIRCRAFT[first.type].freighter?FREIGHT_SERVICES[first.cargoService || 'bulk'].name+' freight':SERVICES[first.service].name+', '+CABINS[first.cabin].name}`);
  connectionCache?.delete(rv);
}

function challenge(s, rv, rand, news) {
  if(s.partnerships?.agreements.some(a=>a.rivalId===rv.id && a.airlineKey===airlineKey(rv) && agreementActive(s,a)))return false;
  if (s.day < 15 || s.day < (rv.nextWar || 0) || rv.cash < reserve(s, rv) * 2 || rv.routes.some((r) => r.war != null)) return false;
  if (rand() > 0.12 * difficultyOf(s).wars) return false;
  const hot = s.routes.filter((r) => (r.hot || 0) >= 5 && playerPresence(s, r) > 0);
  for (const r of hot) for (const h of rv.hubs) {
    if (marketOverlap(h.id, r.dest, r.hub, r.dest) <= 0 || h.id === r.dest || rv.routes.some((rr) => sameRoute(h.id, r.dest, rr.hub, rr.dest))) continue;
    if (rv.routes.filter((rr) => rr.hub === h.id).length >= PLANE_CAP[h.level]) continue;
    const q = quoteRoute(s, rv, h, r.dest, true);
    if (!q || q.profit < -Math.max(3000, rv.profit * 0.1) || q.cost + reserve(s, rv) > rv.cash) continue;
    q.route.war = s.day + 12; q.route.warStarted = s.day;
    buyRoute(s, rv, q); rv.nextWar = s.day + 30;
    announce(s, rv, news, `Price war on ${h.id}–${r.dest}: introductory fares at 80%, reviewed in 12 days`, r.dest);
    return true;
  }
  return false;
}

function health(rv) {
  if (rv.cash < 0) return clamp(20 - rv.negativeDays * 2, 0, 20);
  const cover = rv.cash / Math.max(20e3, rv.cost);
  const margin = average(rv.history) / Math.max(20e3, rv.cost);
  return Math.round(clamp(40 + Math.min(40, cover * 2) + clamp(margin * 60, -35, 20), 5, 100));
}

export function canTakeOver(rv) {
  return !!rv.hub && rv.str < TAKEOVER_AT && rv.lossDays >= 7 && rv.cash < Math.max(500e3, rv.cost * 3);
}

export function stepRivals(s, rand) {
  connectionCache=new Map();marketCache=new Map();playerPresenceCache=new Map();
  try {return runRivalDay(s,rand);} finally {connectionCache=null;marketCache=null;playerPresenceCache=null;}
}
function runRivalDay(s, rand) {
  const news = [];
  migrateRivals(s);
  // Settle every airline against the same day's network before any decisions.
  const ledgers = s.rivals.filter((rv) => rv.hub).map((rv) => ({ rv, routes: rv.routes.map((r) => [r, routeEconomy(s, rv, r)]) }));
  for (const { rv, routes } of ledgers) {
    let profit = -rv.hubs.reduce((n, h) => n + hubUpkeep(h, s), 0), cost = -profit, pax = 0;
    for (const [rr, result] of routes) {
      if (rr.lease) {
        const until=Math.min(s.day*DAY,rr.lease.end),rent=Math.max(0,until-rr.lease.billedUntil)/DAY*rr.lease.daily;
        result.profit+=result.rent-rent;result.cost+=rent-result.rent;result.rent=rent;
        rr.lease.billedUntil=Math.max(rr.lease.billedUntil,until);
      }
      const partner=rr.partnerDay || {rev:0,cost:0,pax:0};
      rr.age++; Object.assign(rr, result,{profit:result.profit+partner.rev-partner.cost,revenue:result.revenue+partner.rev,cost:result.cost+partner.cost,pax:result.pax+partner.pax});
      delete rr.partnerDay;
      rr.avgProfit = rr.avgProfit == null ? rr.profit : rr.avgProfit * 0.75 + rr.profit * 0.25;
      rr.lossDays = rr.profit < 0 && !result.grounded ? rr.lossDays + 1 : 0;
      profit += result.profit; cost += result.cost; pax += result.pax;
    }
    const partner=rv.partnerDay || {rev:0,cost:0,pax:0},settled=partner.rev-partner.cost;
    profit+=settled;cost+=partner.cost;pax+=partner.pax;
    rv.partnerYesterday={...partner};delete rv.partnerDay;
    rv.profit = Math.round(profit); rv.cost = Math.round(cost); rv.pax = pax; rv.cash += rv.profit-settled; rv.leaseRent=routes.reduce((n,[,result])=>n+(result.rent || 0),0);
    rv.history.push(rv.profit); if (rv.history.length > 30) rv.history.shift();
    rv.lossDays = profit < 0 ? rv.lossDays + 1 : 0;
    rv.negativeDays = rv.cash < 0 ? rv.negativeDays + 1 : 0;
    rv.retired = (rv.retired || []).filter((r) => r.until > s.day);
    rv.rep = clamp(rv.rep + (routes.length && profit > 0 ? 0.08 : -0.15), 35, 85);
    const before = rv.str;
    rv.str = health(rv); rv.healthChange = rv.str - before;
  }
  for (const rv of s.rivals) {
    marketCache=new Map();
    if (!rv.hub) { if (rv.back != null && s.day >= rv.back) arrive(s, rv, rand, news); continue; }
    reviewRivalLeases(s,rv,news);
    if (s.day >= rv.next || rv.cash < 0 || rv.routes.some((r) => r.war != null && s.day >= r.war)) {
      rv.next = s.day + rules(s).interval;
      reviewRoutes(s, rv, news);
      reviewHubRole(s, rv, news);
      if (rv.cash < 0 && rv.routes.length > 1) {
        const worst = [...rv.routes].sort((a, b) => a.avgProfit - b.avgProfit)[0];
        if (worst.avgProfit < 0 && routeEconomy(s,rv,worst,{steady:true}).profit<0) closeRoute(s, rv, worst, news, worst.lease ? 'ending an unsustainable lease and settling its rent' : 'selling an aircraft to rebuild cash reserves');
      }
      if (!openHub(s, rv, rand, news) && !challenge(s, rv, rand, news)) {
        const q = bestExpansion(s, rv, rand);
        if (q) {
          buyRoute(s, rv, q);
          if (s.routes.some((r) => marketOverlap(r.hub, r.dest, q.route.hub, q.route.dest) > 0)) announce(s, rv, news, rv.activity, q.route.dest);
        } else upgradeHub(s, rv, news);
      }
    }
    rv.str = health(rv);
    if (canTakeOver(rv) && !rv.offered) { rv.offered = true; announce(s, rv, news, 'Seeking a buyer after sustained losses'); }
    if (!canTakeOver(rv)) rv.offered = false;
    if (rv.negativeDays >= 10 && rv.cash < 0) collapse(s, rv, news);
  }
  return news;
}

export function addLateRivals(s) {
  for (let i = s.rivals.length; i < BRANDS.length; i++) s.rivals.push({ id: i + 1, name: BRANDS[i][0], color: BRANDS[i][1], hub: null, routes: [], back: s.day + 4 + 7 * (i - 3), fresh: true });
  migrateRivals(s);
}
