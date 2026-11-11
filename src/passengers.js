import { AIRCRAFT } from './data/catalog.js';
import { AIRPORT_BY_ID } from './data/airports.js';
import { routeMarket } from './data/markets.js';

export const PASSENGERS = {
  leisure: { name: 'Leisure', preference: 'Lower fares and seasonal destinations', price: 2.2, confidence: .5, season: 1, service: { economy: 1, balanced: 1, frequent: 1.02 } },
  business: { name: 'Business', preference: 'Frequent, dependable service and business cabins', price: .85, confidence: 1.6, season: .15, service: { economy: .72, balanced: 1, frequent: 1.22 } },
  connecting: { name: 'Connecting', preference: 'An active feeder network and frequent departures', price: 1.35, confidence: 1.2, season: .35, service: { economy: .7, balanced: 1, frequent: 1.25 } },
};
export const PASSENGER_KEYS = [...Object.keys(PASSENGERS), 'charter'];
export const emptyPassengers = () => Object.fromEntries(PASSENGER_KEYS.map((id) => [id, 0]));
export const passengerTotal = (counts) => PASSENGER_KEYS.reduce((sum, id) => sum + (counts?.[id] || 0), 0);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

// Shared by player forecasts, waiting passengers and rival market decisions.
// Connections are additional demand; local travelers are never counted twice.
export function passengerMarket({ from, to, base, price = 1, service = 'balanced', cabin = 0, season = 1, reputation = 1,
  readiness = 1, connection = 0, charter = 0, role = 'general' }) {
  const market = routeMarket(from, to), segments = {}, details = {};
  const weights = { leisure: (1 - market.businessShare) * market.leisure,
    business: market.businessShare * market.business, connecting: Math.max(0, connection) * market.connections };
  for (const [id, type] of Object.entries(PASSENGERS)) {
    const fare = Math.max(.05, (1.9 - price) / .9) ** type.price;
    const frequency = type.service[service] ?? 1;
    const confidence = reputation ** type.confidence * readiness ** type.confidence;
    const seasonal = 1 + (season - 1) * type.season;
    const cabinFactor = id === 'business' ? [1, 1.06, 1.12][cabin] ?? 1 : 1;
    segments[id] = Math.max(0, base * weights[id] * fare * frequency * confidence * seasonal * cabinFactor);
    details[id] = { fare, frequency, confidence, seasonal, cabin: cabinFactor };
  }
  segments.charter = Math.max(0, charter);
  const total = passengerTotal(segments);
  const businessPreference = role === 'premium' ? .9 : role === 'budget' ? .4 : .7;
  return { segments, segmentFactors: details, total, businessPreference,
    businessShare: total ? segments.business * businessPreference / total : 0, readiness, market };
}

// Business travelers may buy economy if no business seat is available.
// Leisure, connecting and charter passengers use economy seats in this model.
export function passengerLoad(pool, seats, preference = .7, integer = false) {
  const round = integer ? Math.floor : (n) => n;
  const available = Object.fromEntries(PASSENGER_KEYS.map((id) => [id, Math.max(0, round(pool[id] || 0))]));
  const biz = Math.min(seats.biz, round(available.business * preference));
  available.business -= biz;
  const total = passengerTotal(available), eco = Math.min(seats.eco, total);
  const counts = Object.fromEntries(PASSENGER_KEYS.map((id) => [id, total ? round(eco * available[id] / total) : 0]));
  if (integer) {
    let remaining = eco - passengerTotal(counts);
    const order = PASSENGER_KEYS.slice().sort((a, b) => (eco * available[b] / (total || 1) - counts[b]) - (eco * available[a] / (total || 1) - counts[a]));
    for (const id of order) if (remaining > 0 && counts[id] < available[id]) { counts[id]++; remaining--; }
  }
  counts.business += biz;
  return { eco, biz, counts };
}

export const passengerActions = {
  planeReadiness(p) {
    return p.phase === 'repair' || p.lease?.returning ? .6 : 1 - Math.min(.15, Math.max(0, this.breakdownRisk(p) - .002) * 1.5);
  },
  routeReadiness(hubId, destId) {
    const route = this.routeTo(hubId, destId), planes = route ? this.planesOn(route.id).filter(p=>!AIRCRAFT[p.type].freighter && !p.conversion) : [];
    if (!planes.length) return 1; // An unstaffed route preview assumes a ready aircraft.
    return clamp(planes.reduce((sum, p) => sum + this.planeReadiness(p), 0) / planes.length, .45, 1);
  },
  ensurePassengerPool(route, key) {
    const total = Math.max(0, route[key] || 0);
    const existing = route.passengerPools?.[key];
    if (existing && Math.abs(passengerTotal(existing) - total) < .00001) return existing;
    const demand = this.factors(route.hub,route.dest,route.price,route.service,route.cabin,null,false), pool = emptyPassengers();
    for (const id of PASSENGER_KEYS) pool[id] = demand.total ? total * demand.segments[id] / demand.total : id === 'leisure' ? total : 0;
    (route.passengerPools ||= {})[key] = pool;
    return pool;
  },
  growPassengerPools(route, minutes) {
    const f = this.routeFactors(route);
    for (const key of ['poolOut', 'poolIn']) {
      const pool = this.ensurePassengerPool(route, key);
      for (const id of PASSENGER_KEYS) if (id!=='connecting') pool[id] = Math.min(f.segments[id] * .75, pool[id] + f.segments[id] * minutes / 1440);
      pool.connecting=this.connectionQueueCount(route.id,key);
      route[key] = passengerTotal(pool);
    }
  },
  boardPassengers(route, type, key) {
    const pool = this.syncConnectionPool(route, key), f = this.routeFactors(route);
    const seats=this.seatsFor(type,route.cabin);
    // Travelers who have already flown their first leg board ahead of new
    // economy bookings. This does not create seats or consume business cabins.
    const onward=Math.min(seats.eco,this.state.connections.queues.reduce((n,q)=>n+(q.leg===1 && q.routeId===route.id && q.direction===key && this.connectionReady(q)?Math.floor(q.count):0),0));
    const load = passengerLoad({...pool,connecting:Math.max(0,pool.connecting-onward)}, {...seats,eco:seats.eco-onward}, f.businessPreference, true);
    load.eco+=onward;load.counts.connecting+=onward;
    for (const id of PASSENGER_KEYS) pool[id] = Math.max(0, pool[id] - load.counts[id]);
    route[key] = passengerTotal(pool);
    load.journeys=this.takeConnectionPassengers(route,key,load.counts.connecting);
    return load;
  },
  migratePassengers() {
    const s = this.state;
    if (s.passengerVersion === 1) return;
    // Keep cash, bookings and aircraft in flight. Only waiting-pool composition
    // is inferred; older flown passengers remain explicitly unclassified.
    for (const r of s.routes) for (const key of ['poolOut', 'poolIn']) this.ensurePassengerPool(r, key);
    for (const entry of s.managementChanges || []) if (entry.status === 'watching') {
      entry.status = 'changed'; entry.reason = 'Passenger and airport model updated';
    }
    s.passengerVersion = 1;
  },
};
