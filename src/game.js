// Game state, economy and simulation. No DOM or rendering in here.
import { geoDistance } from 'd3-geo';
import { AIRPORTS, AIRPORT_BY_ID } from './data/airports.js';
import {
  AIRCRAFT, AIRCRAFT_LIST, UPGRADES, UPGRADE_KEYS, GOALS, SCENARIO_BY_ID, CABINS, USED,
  ROUTE_CAP, PLANE_CAP, AMENITY_INCOME, CARGO_FILL, CARGO_RATE, ACHIEVEMENTS, LISTING_VALUE, DIFFICULTY, difficultyOf, maxLevel, totalLevels, rankFor, bestRank,
} from './data/catalog.js';
import { scheduleEvents, eventDemand, fuelFactor, closedBy, aircraftDiscount, describe } from './events.js';
import { createRivals, stepRivals, competition, rivalAt, pressureOn, removeRival, addLateRivals, canTakeOver } from './rivals.js';
import { prepareChange, finishChange, collectChangeResults } from './changeResults.js';
import { specializationActions, specializationOf, migrateSpecializations } from './specializations.js';
import { commercialActions, migrateCommercial, CLIENTS, serviceOf } from './commercial.js';
import { passengerActions, passengerMarket, passengerLoad, emptyPassengers, PASSENGER_KEYS } from './passengers.js';
import { routeMarket } from './data/markets.js';
import { disruptionActions } from './disruptions.js';
import { rivalAircraftValue, rivalHubLevels, rivalLeaseAccrued } from './rivalCommercial.js';
import { connectionActions } from './connections.js';
import { projectActions, projectEffects } from './projects.js';
import { campaignActions } from './campaigns.js';
import { companyActions } from './company.js';
import { worldActions } from './worldCoverage.js';
import { cargoActions, freightService, freightHold } from './cargo.js';
import { partnershipActions } from './partnerships.js';
import { ensureTutorial } from './tutorial.js';

const LOG_MAX = 60;
const FUEL_LOCK_DAYS = 30;

export const MIN_PER_SEC = 10; // game minutes per real second at 1x
export const SPEEDS = [0, 1, 3, 10];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY = 1440;
const SAVE_KEY = 'airport-manager-save-v2';
const OLD_SAVE_KEY = 'airport-manager-save-v1';
const MEDAL_KEY = 'airport-manager-medals';
const INTEREST = 0.004; // per day
const BANKRUPT_DAYS = 5;
const OFFLINE = { maxSeconds: 4 * 3600, rate: 0.25 };
const MAX_CONTRACTS = 3; // accepted at once; the same number of offers are kept on the table
const CHARTER_PAX = ['football fans', 'conference delegates', 'wedding guests', 'festival-goers', 'exchange students', 'a touring orchestra and its fans', 'trade fair visitors', 'cruise passengers'];
const CHARTER_CARGO = ['fresh flowers', 'medical supplies', 'car parts', 'electronics', 'relief aid', 'racing cars', 'seafood on ice'];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function distKm(a, b) {
  return geoDistance([a.lon, a.lat], [b.lon, b.lat]) * 6371;
}
export function fmtMoney(n) {
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`;
  return `${sign}$${Math.round(a)}`;
}
export const fmtSigned = (n) => (n >= 0 ? '+' : '') + fmtMoney(n);

// The game year has twelve 30-day months.
export function dateOf(day) {
  const doy = ((day % 360) + 360) % 360;
  return { year: Math.floor(day / 360) + 1, month: Math.floor(doy / 30), dom: (doy % 30) + 1, weekday: day % 7 };
}
export const fmtDate = (day) => { const d = dateOf(day); return `${d.dom} ${MONTHS[d.month].slice(0, 3)}`; };

// Seasonal swing in demand. Holiday spots swing hard, business cities barely.
export function seasonFactor(dest, day) {
  const amp = dest.leisure ? 0.35 : 0.1;
  const peak = dest.lat > 23 ? 195 : 15; // northern summer, otherwise the December–January high season
  return 1 + amp * Math.cos((2 * Math.PI * ((day % 360) - peak)) / 360);
}

const todayStr = () => new Date().toISOString().slice(0, 10);
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
function mulberry(seed) {
  let a = seed;
  return () => {
    let t = (a = (a + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const freshLedger = () => ({ rev: 0, cost: 0, fuel: 0, cargo: 0, leases: 0, specialization: 0, recovery: 0 });
const freshRouteStats = () => ({ rev: 0, cost: 0, pax: 0, seats: 0, flights: 0, passengers: emptyPassengers() });
function makeHub(id, over = {}) {
  const levels = {};
  for (const k of UPGRADE_KEYS) levels[k] = UPGRADES[k].start;
  return { id, levels: { ...levels, ...over }, specialization: 'general', specializationUntil: 0 };
}

const listeners = {};

export const game = {
  ...commercialActions,
  ...specializationActions,
  ...passengerActions,
  ...disruptionActions,
  ...connectionActions,
  ...partnershipActions,
  ...cargoActions,
  ...projectActions,
  ...campaignActions,
  ...companyActions,
  ...worldActions,
  state: null,
  silent: false, // true while fast-forwarding offline time
  _rev: 0,
  _cache: new Map(),
  _cacheKey: '',

  on(ev, fn) { (listeners[ev] ||= []).push(fn); },
  emit(ev, data) {
    // Everything the game announces is also kept in the news log, including what happens while you are away.
    if (ev === 'toast' && this.state && !data.quiet) {
      const s = this.state;
      (s.log ||= []).unshift({ day: s.day, min: Math.floor(s.minute % DAY), text: data.text, kind: data.kind || '', at: data.at,
        ...(data.target ? { target: { ...data.target } } : {}) });
      if (s.log.length > LOG_MAX) s.log.length = LOG_MAX;
      s.logN = (s.logN || 0) + 1;
    }
    if (!this.silent) (listeners[ev] || []).forEach((f) => f(data));
  },

  // Seeded so the daily challenge plays out the same for everyone.
  rand() {
    const s = this.state;
    let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  },

  // ---------- lifecycle ----------
  newGame(homeId, modeId = 'free', diffId = 'normal') {
    this._rev++;
    const sc = SCENARIO_BY_ID[modeId] || SCENARIO_BY_ID.free;
    const diff = modeId !== 'daily' && DIFFICULTY[diffId] ? diffId : 'normal';
    const seed = modeId === 'daily' ? hash(todayStr()) : (Math.random() * 2 ** 32) >>> 0;
    const s = this.state = {
      v: 2, passengerVersion: 1, seed, rng: seed, mode: { id: sc.id, date: todayStr() }, diff,
      hubs: [makeHub(homeId, sc.levels)], active: homeId,
      money: sc.money ?? Math.round(1e6 * DIFFICULTY[diff].cash), /* scenarios with their own budget keep it */ debt: sc.debt || 0, equity: 0, invested: 0,
      minute: 6 * 60, day: 0, speed: 1,
      routes: [], planes: [], nextId: 1, events: [], eventsUntil: null, rivals: [], managementChanges: [], nextChangeId: 0, nextBreakdownId: 0,
      today: freshLedger(), yesterday: null, history: [],
      totalPax: 0, flights: 0, bestDay: 0, goalsDone: [], negDays: 0, over: null, savedAt: Date.now(),
      rep: 50, contracts: [], contractsDone: 0, clients: {},
      fuel: 1, fuelHist: [1], fuelLock: null, log: [], achDone: [], streak: 0, listed: null, report: null, weekRep: 50, weekPax: 0, warsWon: 0, tips: [], logN: 0, logSeen: 0, takeovers: 0, rivalsDown: 0, worldDone: [],
    };
    const rand = () => this.rand();
    s.rivals = createRivals(s, rand);
    this.migrateProjects();
    this.migrateCampaigns();
    this.migrateCargo();
    this.migratePartnerships();
    this.migrateConnections();
    this.migrateCompany(true);
    ensureTutorial(s);
    scheduleEvents(s, rand, this);
    this.save();
    this.emit('change');
  },

  load() {
    try {
      let s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!s) s = this.migrate(JSON.parse(localStorage.getItem(OLD_SAVE_KEY)));
      if (!s || s.v !== 2 || !s.hubs?.length || !s.hubs.every((h) => AIRPORT_BY_ID[h.id])) return false;
      s.routes = s.routes.filter((r) => AIRPORT_BY_ID[r.dest] && s.hubs.some((h) => h.id === r.hub));
      s.planes = s.planes.filter((p) => AIRCRAFT[p.type]);
      for (const h of s.hubs) for (const k of UPGRADE_KEYS) h.levels[k] ??= UPGRADES[k].start;
      s.rep ??= 50; s.contracts ??= []; s.contractsDone ??= 0;
      s.managementChanges ??= []; s.nextChangeId ??= 0;
      s.fuel ??= 1; s.fuelHist ??= [1]; s.fuelLock ??= null; s.log ??= []; s.achDone ??= []; s.streak ??= 0; s.listed ??= null; s.report ??= null; s.weekRep ??= s.rep; s.weekPax ??= s.totalPax; s.warsWon ??= 0; s.diff ??= 'normal'; s.tips ??= []; s.logN ??= 0; s.logSeen ??= 0; s.takeovers ??= 0; s.rivalsDown ??= 0; s.worldDone ??= [];
      for (const rv of s.rivals) { rv.str ??= 100; rv.base ??= 1; }
      addLateRivals(s); // saves from when there were only three airlines get the others as new arrivals
      migrateCommercial(s);
      migrateSpecializations(s);
      this.state = s; this._rev++;
      this.migratePassengers();
      this.migrateDisruptions();
      this.migrateProjects();
      this.migrateCampaigns();
      this.migrateCargo();
      this.migratePartnerships();
      this.migrateConnections();
      this.migrateCompany();
      ensureTutorial(s);
      return true;
    } catch {
      return false;
    }
  },

  // Bring a save from the first version (single airport) forward.
  migrate(old) {
    if (!old || old.v !== 1) return null;
    const seed = (Math.random() * 2 ** 32) >>> 0;
    const s = {
      ...old, v: 2, seed, rng: seed, mode: { id: 'free', date: todayStr() },
      hubs: [makeHub(old.home, old.levels)], active: old.home, debt: 0, equity: 0, invested: 0,
      events: [], eventsUntil: null, rivals: [], negDays: 0, over: null, savedAt: Date.now(),
      today: { ...freshLedger(), ...old.today },
    };
    delete s.home; delete s.levels;
    for (const r of s.routes) { r.hub = old.home; r.cabin = 0; }
    for (const p of s.planes) { p.hub = old.home; p.age = 0; p.profit = 0; p.flights = 0; p.biz = 0; }
    this.state = s;
    s.rivals = createRivals(s, () => this.rand());
    scheduleEvents(s, () => this.rand(), this);
    return s;
  },

  save() {
    if (!this.state) return true;
    this.state.savedAt = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.state)); return true; } catch { return false; }
  },

  reset() {
    try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem(OLD_SAVE_KEY); } catch { /* ignore */ }
    this.state = null;
    this.emit('change');
  },

  // Earn at a reduced rate for time spent away, up to a cap.
  catchUp() {
    const s = this.state;
    if (!s || s.over || !s.speed || !s.savedAt || !s.planes.length) return null;
    const seconds = Math.min((Date.now() - s.savedAt) / 1000, OFFLINE.maxSeconds);
    if (seconds < 90) return null;
    const before = { money: s.money, day: s.day, pax: s.totalPax };
    const minutes = seconds * MIN_PER_SEC * OFFLINE.rate;
    this.silent = true;
    for (let m = 0; m < minutes && !s.over; m += 5) this.tick(5);
    this.silent = false;
    this.save();
    return { seconds, days: s.day - before.day, earned: s.money - before.money, pax: s.totalPax - before.pax, capped: seconds >= OFFLINE.maxSeconds };
  },

  medals() {
    try { return { won: [], daily: {}, ...JSON.parse(localStorage.getItem(MEDAL_KEY)) }; } catch { return { won: [], daily: {} }; }
  },
  saveMedals(m) { try { localStorage.setItem(MEDAL_KEY, JSON.stringify(m)); } catch { /* ignore */ } },
  dailyHome() {
    const rand = mulberry(hash(`home${todayStr()}`));
    const pool = AIRPORTS.filter((a) => this.starterReach(a) >= 4);
    return pool[Math.floor(rand() * pool.length)];
  },

  // ---------- lookups ----------
  hub(id) { return this.state.hubs.find((h) => h.id === id); },
  isHub(id) { return !!this.hub(id); },
  get activeHub() { return this.hub(this.state.active) || this.state.hubs[0]; },
  setActive(id) { if (this.isHub(id)) { this.state.active = id; this.emit('change'); } },
  scenario() { return SCENARIO_BY_ID[this.state.mode.id] || SCENARIO_BY_ID.free; },
  route(id) { return this.state.routes.find((r) => r.id === id); },
  routeTo(hubId, dest) { return this.state.routes.find((r) => r.hub === hubId && r.dest === dest); },
  plane(id) { return this.state.planes.find((p) => p.id === id); },
  planesOn(routeId) { return this.state.planes.filter((p) => p.routeId === routeId); },
  planesAt(hubId) { return this.state.planes.filter((p) => p.hub === hubId); },
  routesAt(hubId) { return this.state.routes.filter((r) => r.hub === hubId); },
  routeCap(hub) { return ROUTE_CAP[hub.levels.terminal]+projectEffects(hub).routes; },
  planeCap(hub) { return PLANE_CAP[hub.levels.gates]+projectEffects(hub).gates; },
  maxRange(hub) {
    return Math.max(...AIRCRAFT_LIST.filter((a) => a.cls <= hub.levels.runway).map((a) => a.range));
  },
  // Airports any of your hubs could reach today (used to place events that matter to you).
  reachable() {
    const hubs = this.state.hubs.map((h) => [AIRPORT_BY_ID[h.id], this.maxRange(h)]);
    return AIRPORTS.filter((a) => hubs.some(([h, range]) => a !== h && distKm(a, h) <= range));
  },
  starterReach(from) {
    return AIRPORTS.filter((a) => a !== from && distKm(a, from) <= AIRCRAFT.sparrow.range).length;
  },
  closed(airportId) { return closedBy(this.state, airportId); },
  rivalAt(airportId) { return rivalAt(this.state, airportId); },

  // ---------- economy ----------
  baseTicket(km) { return 60 + 0.13 * km; },
  ticket(route) { return this.baseTicket(route.km) * route.price; },

  // Passengers per day each way, with the pieces that make up the number.
  factors(hubId, destId, price = 1, service = 'balanced', cabin = 0, readiness = null, connections = true) {
    const s = this.state;
    const { terminal, marketing } = this.hub(hubId).levels;
    const dest = AIRPORT_BY_ID[destId];
    const km = distKm(AIRPORT_BY_ID[hubId], dest);
    const hubF = (1 + 0.15 * (terminal - 1)) * (1 + 0.18 * marketing);
    // A link between two of your hubs draws on the far hub's terminal and marketing too.
    const far = this.hub(destId);
    const trunk = far ? Math.sqrt((1 + 0.15 * (far.levels.terminal - 1)) * (1 + 0.18 * far.levels.marketing)) * 1.15 : 1;
    const season = seasonFactor(dest, s.day);
    const event = eventDemand(s, hubId, destId);
    const comp = competition(s, hubId, destId, price);
    // Long flights live on connections: the further the route, the more of its cabin is transfer traffic.
    const transfer = connections ? this.specializationConnections(hubId, destId, service) : 1;
    const specialization = this.specializationDemand(this.hub(hubId), price, cabin, service);
    const rep = this.repFactor();
    const charter = this.charterDemand(destId, hubId), serviceFactor = serviceOf({ service }).demand;
    const world = this.worldFactor(); // a little extra everywhere for each continent you cover completely
    const base = 55 * difficultyOf(s).demand * dest.size * hubF * trunk * event * comp.share * specialization * world / (1 + km / 9000);
    const passengers = passengerMarket({ from: AIRPORT_BY_ID[hubId], to: dest, base, price, service, cabin, season,
      reputation: rep, readiness: readiness ?? this.routeReadiness(hubId, destId), connection: 0, charter, role: this.hub(hubId).specialization });
    const connecting = connections ? this.connectionDemand({hub:hubId,dest:destId,price,service,cabin}) : 0;
    passengers.segments.connecting = connecting;
    passengers.total += connecting;
    passengers.businessShare = passengers.total ? passengers.segments.business * passengers.businessPreference / passengers.total : 0;
    const connect = 1 + connecting / Math.max(1, passengers.total - connecting);
    return { km, season, event, share: comp.share, rivals: comp.names, connect, rep, charter, trunk, specialization, transfer, world,
      service: serviceFactor, war: comp.war, ...passengers };
  },
  routeFactors(route) {
    const key = `${Math.floor(this.state.minute / 20)}:${this._rev}`;
    if (key !== this._cacheKey) { this._cacheKey = key; this._cache.clear(); }
    const routeKey = `${route.hub}:${route.dest}:${route.price}:${route.service || 'balanced'}:${route.cabin || 0}:${route.forecastReadiness ?? ''}`;
    let f = this._cache.get(routeKey);
    if (!f) { f = this.factors(route.hub, route.dest, route.price, route.service, route.cabin, route.forecastReadiness); this._cache.set(routeKey, f); }
    return f;
  },
  routeDemand(route) { return this.routeFactors(route).total; },
  seatsFor(type, cabin) {
    const b = CABINS[cabin || 0].b;
    return { eco: Math.round(type.seats * (1 - b)), biz: Math.floor((type.seats * b) / 2) };
  },
  bizShare(destId, hub = null, route = null) {
    if (route) return this.routeFactors(route).businessShare;
    if (hub) return this.factors(hub.id, destId).businessShare;
    return AIRPORT_BY_ID[destId].market.businessShare * .7;
  },

  openCost(km) { return Math.round((20e3 + 30 * km) / 1000) * 1000; },
  flightCost(type, km, hub) {
    return km * type.burn * (1 - 0.08 * hub.levels.fuel) * fuelFactor(this.state) + this.handlingCost(type, hub);
  },
  // ---------- fuel market ----------
  fuelPrice() { return fuelFactor(this.state); },
  fuelLocked() { const l = this.state.fuelLock; return l && this.state.day < l.until ? l : null; },
  // The supplier charges for the risk it takes on: a small fee at normal prices, a much larger one when fuel is cheap,
  // since the price is then likely to climb back. Worked out on what 30 days of flying costs at the normal price.
  fuelLockRate() { return 0.03 + 0.3 * Math.max(0, 1 - this.state.fuel); },
  fuelLockCost() {
    const normalBill = (this.state.yesterday?.fuel || 0) / Math.max(0.5, this.fuelPrice());
    return Math.max(20e3, Math.round((normalBill * FUEL_LOCK_DAYS * this.fuelLockRate()) / 1000) * 1000);
  },
  lockFuel() {
    const s = this.state;
    if (this.fuelLocked()) return 'Fuel is already locked in';
    const cost = this.fuelLockCost();
    if (s.money < cost) return 'Not enough cash';
    s.money -= cost; s.today.cost += cost;
    s.fuelLock = { price: s.fuel, until: s.day + FUEL_LOCK_DAYS };
    this.emit('toast', { text: `Fuel locked at ${Math.round(s.fuel * 100)}% of the normal price for ${FUEL_LOCK_DAYS} days`, kind: 'good', sound: 'buy' });
    this.changed();
    return null;
  },
  stepFuel() {
    const s = this.state;
    s.fuel = clamp(s.fuel + (1 - s.fuel) * 0.04 + (this.rand() - 0.5) * 0.09 * difficultyOf(s).fuel, 0.65, 1.6);
    s.fuelHist.push(Math.round(s.fuel * 1000) / 1000);
    if (s.fuelHist.length > 60) s.fuelHist.shift();
    if (s.fuelLock && s.day === s.fuelLock.until) this.emit('toast', { text: 'Your fuel price lock has run out', kind: 'bad', target: { kind: 'page', id: 'finance' } });
  },
  cargoFill(hub, level = hub.levels.cargo) { return Math.min(1, CARGO_FILL[level] * (hub.specialization === 'cargo' ? 1.2 : 1)); },
  cargoUnits(type, hub) { return type.cargo * this.cargoFill(hub); },
  cargoIncome(type, route, hub) {
    return this.cargoUnits(type, hub) * route.km * CARGO_RATE * (0.5 + AIRPORT_BY_ID[route.dest].size / 10) * routeMarket(AIRPORT_BY_ID[route.hub], AIRPORT_BY_ID[route.dest]).freight * (hub.specialization === 'cargo' ? 2 : 1);
  },
  // Yesterday's result for a route, after the upkeep of the aircraft flying it. Null before its first full day.
  routeProfit(route) {
    const y = route.yesterday;
    if (!y) return null;
    return y.profit ?? y.rev - y.cost - this.planesOn(route.id).reduce((n, p) => n + this.planeMaintenance(p), 0);
  },
  // What a route nobody flies yet would earn per day with one new aircraft, trying each type the hub can handle.
  estimate(hubId, destId, typeId = null, readiness = null, kind = null) {
    const hub = this.hub(hubId);
    const f = this.factors(hubId, destId, 1, 'balanced', 0, readiness);
    const stub = { hub: hubId, km: f.km, dest: destId, price: 1, cabin: 0, service: 'balanced', forecastReadiness: readiness };
    let best = null;
    for (const t of AIRCRAFT_LIST) {
      if (typeId && t.id !== typeId) continue;
      if(kind && !!t.freighter !== (kind==='cargo'))continue;
      if (t.cls > hub.levels.runway || t.range < f.km || (t.freighter && hub.levels.cargo<1)) continue;
      const forecast = this.typeProfit(stub, t);
      if (!best || forecast.profit > best.profit) best = { type: t, ...forecast };
    }
    return { ...f, best };
  },

  // ---------- reputation ----------
  // 0..100. It drifts a little each day toward what your prices, fleet and airports deserve,
  // and takes one-off knocks and boosts from breakdowns, strikes and contracts.
  repFactor() { return 0.7 + 0.6 * (this.state.rep ?? 50) / 100; },
  repParts() {
    const s = this.state;
    const n = s.routes.length;
    const price = n ? s.routes.reduce((a, r) => a + r.price, 0) / n : 1;
    const age = s.planes.length ? s.planes.reduce((a, p) => a + p.age, 0) / s.planes.length : 100;
    const shops = s.hubs.reduce((a, h) => a + h.levels.amenities, 0) / s.hubs.length;
    const comfy = n ? s.routes.filter((r) => r.cabin > 0).length / n : 0;
    return [
      { label: 'Ticket prices', v: Math.round((1 - price) * 50), tip: `average ${Math.round(price * 100)}% of the standard fare` },
      { label: 'Fleet age', v: Math.round(10 - Math.min(25, age / 10)), tip: s.planes.length ? `average ${Math.round(age)} days` : 'no aircraft yet' },
      { label: 'Shops & lounges', v: Math.round(shops * 3), tip: `average level ${shops.toFixed(1)}` },
      { label: 'Business cabins', v: Math.round(comfy * 6), tip: `on ${Math.round(comfy * 100)}% of routes` },
    ];
  },
  repTarget() { return clamp(50 + this.repParts().reduce((n, p) => n + p.v, 0), 0, 100); },
  bumpRep(d) { const s = this.state; s.rep = clamp(s.rep + d, 0, 100); },

  // ---------- contracts ----------
  charterDemand(destId, hubId) {
    let n = 0;
    for (const c of this.state.contracts) if (c.due != null && !c.paid && c.kind === 'pax' && c.dest === destId && (!c.series || c.hub === hubId)) n += (c.amount / c.days) * 0.5;
    return n;
  },
  contractsFor(destId, hubId = null) { return this.state.contracts.filter((c) => c.dest === destId && (hubId == null || !c.series || c.hub === hubId)); },
  makeContract() {
    const s = this.state;
    const pick = (list) => list[Math.floor(this.rand() * list.length)];
    const cargoHubs = s.hubs.filter((h) => h.levels.cargo > 0);
    const cargoFocused = cargoHubs.filter((h) => h.specialization === 'cargo');
    const kind = cargoHubs.length && this.rand() < (cargoFocused.length ? .6 : .35) ? 'cargo' : 'pax';
    const hub = pick(kind === 'cargo' ? [...cargoHubs, ...cargoFocused, ...cargoFocused] : s.hubs);
    const origin = AIRPORT_BY_ID[hub.id];
    const range = this.maxRange(hub);
    const busy = new Set(s.contracts.map((c) => c.dest));
    // Most contracts send you somewhere new, as long as the terminal has room for another route.
    const fresh = this.rand() < 0.75 && this.routesAt(hub.id).length < this.routeCap(hub);
    if (!fresh && this.rand() < 0.5) return null; // repeat business is rarer
    const pool = AIRPORTS.filter((a) => a !== origin && !this.isHub(a.id) && !busy.has(a.id) && distKm(a, origin) <= range
      && !!this.routeTo(hub.id, a.id) !== fresh);
    if (!pool.length) return null;
    const dest = pick(pool);
    const km = distKm(origin, dest);
    const days = 8 + Math.floor(this.rand() * 7);
    const usable = AIRCRAFT_LIST.filter((t) => !t.freighter && t.cls <= hub.levels.runway && t.range >= km);
    const type = usable[0];
    const legs = DAY / ((km / type.speed) * 60 + this.routeTurnaround(type,{hub:hub.id,dest:dest.id}));
    let amount, reward, what;
    if (kind === 'pax') {
      amount = Math.max(100, Math.round((legs * type.seats * days * 0.3) / 50) * 50);
      reward = amount * this.baseTicket(km) * 0.35;
      what = pick(CHARTER_PAX);
    } else {
      // Sized to the holds you already send there, or to the smallest aircraft that could open the route.
      const existing=this.routeTo(hub.id,dest.id);
      const flying = fresh ? [] : this.planesOn(existing.id).filter(p=>!p.conversion);
      const perDay = (t) => t.freighter ? this.freightForecast(existing,t,flying.length).onTimeTonnes/2 : (DAY / ((km / t.speed) * 60 + this.routeTurnaround(t,{hub:hub.id,dest:dest.id}))) * this.cargoUnits(t, hub);
      const daily = flying.length ? flying.reduce((n, p) => n + perDay(AIRCRAFT[p.type]), 0) : perDay(type);
      amount = Math.max(5, Math.round(daily * days * (flying.length ? 0.6 : 0.5)));
      reward = amount * km * CARGO_RATE * 2;
      what = pick(CHARTER_CARGO);
    }
    // A destination you already fly to is easy money, so it pays half.
    reward = Math.max(30e3, Math.round((fresh ? reward + this.openCost(km) : reward * 0.5) / 1000) * 1000);
    const client = pick(CLIENTS.filter((c) => c.kind === kind));
    return { id: s.nextId++, clientId: client.id, kind, hub: hub.id, dest: dest.id, amount, done: 0, days, reward, what, expires: s.day + 4, due: null };
  },
  stepContracts() {
    const s = this.state;
    s.contracts = s.contracts.filter((c) => {
      if (c.due == null) return c.expires >= s.day;
      if (s.day < c.due + (c.series ? 0 : 1)) return true;
      if (c.series && c.paid && s.day < c.due + 7) {
        c.series.week++; c.done = 0; c.paid = false; c.due += 7;
        this.emit('toast', { text: `Week ${c.series.week} started: ${this.contractTitle(c)}`, target: { kind: 'contract', id: c.id } });
        return true;
      }
      this.recordClient(c, false);
      this.bumpRep(-4);
      this.emit('toast', { text: `Contract missed: ${this.contractTitle(c)}. Your reputation suffers`, kind: 'bad', sound: 'alert', at: c.dest });
      return false;
    });
    const offers = s.contracts.filter((c) => c.due == null).length;
    if (s.flights > 0 && offers < MAX_CONTRACTS && this.rand() < (offers ? 0.2 : 0.4)) {
      const c = this.makeContract();
      if (c) { s.contracts.push(c); this.emit('toast', { text: `New contract on offer: ${this.contractTitle(c)}`, kind: 'goal', at: c.dest, target: { kind: 'contract', id: c.id } }); }
    }
  },
  contractTitle(c) {
    const city = AIRPORT_BY_ID[c.dest].city;
    return c.kind === 'cargo' ? `${c.amount} t of ${c.what} to ${city}` : `${c.amount.toLocaleString()} ${c.what}, ${city}`;
  },
  acceptContract(id) {
    const s = this.state;
    const c = s.contracts.find((x) => x.id === id);
    if (!c || c.due != null || c.expires < s.day) return 'That offer is gone';
    if (s.contracts.filter((x) => x.due != null).length >= MAX_CONTRACTS) return `You can run ${MAX_CONTRACTS} contracts at a time`;
    c.due = s.day + c.days;
    this.emit('toast', { text: `Contract signed: ${this.contractTitle(c)} by ${fmtDate(c.due)}`, kind: 'good', sound: 'buy', target: { kind: 'contract', id: c.id } });
    this.changed();
    return null;
  },
  declineContract(id) {
    const s = this.state;
    s.contracts = s.contracts.filter((c) => c.id !== id || c.due != null);
    this.changed();
  },
  contractProgress(route, type, hub, people, freight=null) {
    const s = this.state;
    let finished = false,cargoRemaining=freight?freight.bulk+freight.express:null;
    for (const c of s.contracts) {
      if (c.due == null || s.minute >= (c.due + (c.series ? 0 : 1)) * DAY || c.paid || c.dest !== route.dest || (c.series && c.hub !== route.hub)) continue;
      const delivered=c.kind==='cargo'?(cargoRemaining!=null?cargoRemaining:type.freighter?0:this.cargoUnits(type,hub)):people;
      const credited=Math.min(c.amount-c.done,delivered);c.done+=credited;
      if(c.kind==='cargo' && cargoRemaining!=null)cargoRemaining-=credited;
      if (c.done < c.amount) continue;
      s.money += c.reward; s.today.rev += c.reward;
      if (c.series && c.series.week < c.series.weeks) {
        c.paid = true; this.bumpRep(1); this._rev++;
        this.emit('toast', { text: `Week ${c.series.week} delivered · ${fmtSigned(c.reward)}. Next target starts ${fmtDate(c.due)}`, kind: 'goal', target: { kind: 'contract', id: c.id } });
        continue;
      }
      c.finished = finished = true;
      s.contractsDone++;
      this.recordClient(c, true);
      this.bumpRep(3);
      this.emit('toast', { text: `Contract complete: ${this.contractTitle(c)} · ${fmtSigned(c.reward)}`, kind: 'goal', sound: 'goal', target: { kind: 'route', id: route.id } });
    }
    if (finished) { s.contracts = s.contracts.filter((c) => !c.finished); this._rev++; this.checkGoals(); }
  },
  // ---------- diagnosis ----------
  // Why a route lost money yesterday, in plain words, most likely cause first. Empty when it didn't.
  diagnose(route) {
    const y = route.yesterday;
    let planes = this.planesOn(route.id);
    if (!planes.length) return ['No aircraft is flying this route, so it earns nothing.'];
    if (!y || !y.flights) return [];
    if (this.routeProfit(route) >= 0) return [];
    if(this.cargoOnly(route))return ['Review freight demand, hold capacity and Bulk versus Express service. Aircraft maintenance is charged even while waiting.'];
    planes=planes.filter(p=>!AIRCRAFT[p.type].freighter);
    const out = [];
    const f = this.routeFactors(route);
    const load = y.seats ? y.pax / y.seats : 0;
    const full = Math.round(load * 100);
    const fare = Math.round(route.price * 100);
    if (load < 0.6) {
      const least = Math.min(...planes.map((p) => AIRCRAFT[p.type].seats));
      const smaller = AIRCRAFT_LIST.filter((t) => !t.freighter && t.range >= route.km && t.seats < least);
      const perFlight = y.pax / Math.max(1,y.flights-(y.freight?.flights || 0));
      const fit = smaller.find((t) => t.seats >= perFlight) || smaller[smaller.length - 1];
      if (planes.length > 1) {
        // Say what the route would look like with one aircraft fewer, so the advice can be judged.
        const perDay = (p) => { const t = AIRCRAFT[p.type], st = this.seatsFor(t, route.cabin); return DAY / (route.km / t.speed * 60 + this.routeTurnaround(t, route)) * (st.eco + st.biz); };
        const seats = planes.reduce((n, p) => n + perDay(p), 0);
        const spare = planes.reduce((m, p) => (perDay(p) < perDay(m) ? p : m));
        const after = Math.min(100, Math.round(((f.total * 2) / (seats - perDay(spare))) * 100));
        const lead = `Too many aircraft: ${planes.length} offer about ${Math.round(seats).toLocaleString()} seats a day but only ${Math.round(f.total * 2).toLocaleString()} people want to fly, so flights leave ${full}% full.`;
        // Aircraft wait until half full, so a figure under that only means there would still be seats to spare.
        out.push(after >= 55
          ? `${lead} Without ${spare.name} they would be about ${after}% full. Move it to another route or sell it.`
          : `${lead} Even one is more than this route needs. Move ${spare.name} away, and a smaller type would suit what is left.`);
      }
      else if (planes.length === 1 && fit) out.push(`Aircraft too big: the ${AIRCRAFT[planes[0].type].name} flies ${full}% full. A ${fit.name} would suit this demand.`);
      else if (planes.length === 1) out.push(`Not enough passengers: ${full}% full on the smallest aircraft that can reach.`);
      const cheaper = f.rivals.filter((r) => !r.base && r.price < route.price)[0];
      if (cheaper) out.push(`${cheaper.name} is undercutting you at ${Math.round(cheaper.price * 100)}% against your ${fare}%. Match the fare, or hold out with a better reputation.`);
      else if (route.price > 1) out.push(`The fare is ${fare}% of standard. Lowering it fills more seats.`);
      else if (f.season < 0.9) out.push(`It is low season here (${Math.round((f.season - 1) * 100)}%). Demand comes back by itself.`);
      else if (!fit || planes.length > 1) out.push('More routes at this hub feed transfer passengers in, and marketing lifts demand.');
    } else {
      if (route.price < 1) out.push(`Flights are ${full}% full but the fare is only ${fare}% of standard. Raise it.`);
      else if (load > 0.85 && route.price < 1.6) out.push(`Flights are ${full}% full, so passengers will bear a higher fare.`);
      const old = planes.find((p) => p.age > 150);
      if (old) out.push(`${old.name} is ${Math.floor(old.age)} days old and costs ${fmtMoney(this.planeUpkeep(old))} a day to keep. Overhaul or replace it.`);
      if (this.fuelPrice() > 1.15) out.push(`Fuel is ${Math.round((this.fuelPrice() - 1) * 100)}% above normal. A fuel depot or a price lock cuts that.`);
      if (!out.length) out.push('The fares here don’t cover the aircraft’s running costs. A cheaper type, or freight from a cargo terminal, would help.');
    }
    return out.slice(0, 2);
  },

  // ---------- company value ----------
  // What the market would pay: what you own, plus forty days of your recent profit.
  valuation() {
    const h = this.state.history.slice(-30);
    const avg = h.length ? h.reduce((a, b) => a + b, 0) / h.length : 0;
    return this.netWorth() + 40 * Math.max(0, avg);
  },
  whyNotList() {
    const s = this.state;
    if (s.listed) return 'Already listed';
    if (bestRank(s) < 4) return 'Needs a Global Hub';
    if (this.valuation() < LISTING_VALUE) return `Needs a company value of ${fmtMoney(LISTING_VALUE)}`;
    return null;
  },
  listCompany() {
    const why = this.whyNotList();
    if (why) return why;
    const s = this.state;
    const value = this.valuation();
    const raised = Math.round(value * 0.1);
    s.listed = { day: s.day, value, raised };
    this.recordCompanyEvent('listing', 'milestones', 'Listed on the stock exchange', `Company value: ${fmtMoney(value)}.`);
    s.money += raised;
    this.emit('toast', { text: `Listed on the stock exchange at ${fmtMoney(value)}`, kind: 'goal', sound: 'goal' });
    this.changed();
    this.emit('listed', s.listed);
    return null;
  },
  rivalPax(rv) { return rv.pax || 0; },
  myPax() { return this.state.routes.reduce((n, r) => n + (r.yesterday?.pax || 0), 0); },

  weeklyReport() {
    const s = this.state;
    const sum = (a) => a.reduce((x, v) => x + v, 0);
    const h = s.history;
    const ranked = s.routes.filter((r) => r.week)
      .map((r) => ({ id: r.id, hub: r.hub, dest: r.dest, v: Math.round(r.week) })).sort((a, b) => b.v - a.v);
    s.report = {
      day: s.day, profit: sum(h.slice(-7)), prev: h.length >= 14 ? sum(h.slice(-14, -7)) : null,
      best: ranked[0] || null, worst: ranked.length > 1 ? ranked[ranked.length - 1] : null,
      rep: Math.round(s.rep), repWas: Math.round(s.weekRep), pax: s.totalPax - s.weekPax,
      fuel: s.fuel, value: Math.round(this.valuation()),
    };
    s.weekRep = s.rep; s.weekPax = s.totalPax;
    for (const r of s.routes) r.week = 0;
    this.emit('report', s.report);
  },

  hubUpkeep(hub) {
    const l = totalLevels(hub.levels), k = difficultyOf(this.state).costs, projects=projectEffects(hub);
    return Math.round(500 * Math.pow(l, 1.6) * (1 + (l / 24) ** 3) * k * specializationOf(hub).upkeep * AIRPORT_BY_ID[hub.id].market.operating * projects.upkeepFactor + projects.upkeep);
  },
  upkeepPerDay() { return this.state.hubs.reduce((n, h) => n + this.hubUpkeep(h), 0); },
  planeMaintenance(p) { return AIRCRAFT[p.type].price * 0.008 * (1 + p.age / 150); },
  planeUpkeep(p) { return this.planeMaintenance(p) + (p.lease?.daily || 0); },
  maintenancePerDay() { return this.state.planes.reduce((n, p) => n + this.planeMaintenance(p), 0); },
  breakdownRisk(p) { return Math.min(0.12, 0.002 + 0.03 * Math.pow(p.age / 250, 2)); },
  planeValue(p) { return p.lease ? 0 : AIRCRAFT[p.type].price * Math.min(0.6, Math.max(0.12, 0.6 - p.age / 500)); },
  overhaulCost(p) { return AIRCRAFT[p.type].price * 0.18; },
  planePrice(typeId, used) { return AIRCRAFT[typeId].price * (used ? USED.price : 1) * aircraftDiscount(this.state); },
  upgradeCost(hub, key) {
    const u = UPGRADES[key];
    const lvl = hub.levels[key];
    return lvl >= maxLevel(key) ? null : Math.round((u.costs[lvl - u.start] * difficultyOf(this.state).costs * (['runway', 'terminal', 'gates', 'cargo'].includes(key) ? AIRPORT_BY_ID[hub.id].market.expansion : 1)) / 1000) * 1000;
  },
  hubCost(airport) { return (2e6 + 1.5e6 * airport.size) * this.state.hubs.length * airport.market.expansion; },
  assets() { return this.state.invested * 0.5 + this.state.planes.reduce((n, p) => n + this.planeValue(p), 0); },
  netWorth() { return this.state.money + this.assets() - this.state.debt; },
  creditLimit() { return Math.round((1e6 + 0.5 * this.assets()) / 1e5) * 1e5; },
  stakeOffer() {
    const s = this.state;
    if (s.equity >= 0.3) return null;
    const recent = s.history.slice(-5);
    const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
    return Math.max(500e3, Math.round((avg * 12) / 1e4) * 1e4);
  },
  hedgeCost(e) { return Math.max(15e3, Math.round(((this.state.yesterday?.fuel || 0) * 0.15 * e.days) / 1000) * 1000); },
  settleCost(e) {
    const base = 20e3 + 6 * 500 * Math.pow(totalLevels(this.hub(e.airport)?.levels || {}), 1.6);
    return Math.round((base * (e.start > this.state.day ? 0.6 : 1)) / 1000) * 1000; // cheaper if you negotiate early
  },

  // ---------- player actions: each returns null on success or a reason string ----------
  whyNotUpgrade(key) {
    const cost = this.upgradeCost(this.activeHub, key);
    if (cost == null) return 'Fully upgraded';
    if (this.state.money < cost) return 'Not enough cash';
    return null;
  },
  upgrade(key) {
    const why = this.whyNotUpgrade(key);
    if (why) return why;
    const hub = this.activeHub;
    const cost = this.upgradeCost(hub, key);
    this.state.money -= cost;
    this.state.invested += cost;
    hub.levels[key]++;
    this.emit('toast', { text: `${UPGRADES[key].name} at ${hub.id} upgraded to level ${hub.levels[key]}`, kind: 'good', sound: 'buy' });
    this.changed();
    return null;
  },

  whyNotOpen(destId) {
    const s = this.state;
    const hub = this.activeHub;
    const dest = AIRPORT_BY_ID[destId];
    if (!dest || destId === hub.id) return 'Invalid destination';
    if (this.routeTo(hub.id, destId)) return 'Route already open';
    if (this.routeTo(destId, hub.id)) return `Already flown from ${destId}`;
    const km = distKm(AIRPORT_BY_ID[hub.id], dest);
    if (km > this.maxRange(hub)) return `Beyond the range ${hub.id}’s runway supports`;
    if (this.routesAt(hub.id).length >= this.routeCap(hub)) return `${hub.id}’s terminal is full — upgrade it for more routes`;
    if (s.money < this.openCost(km)) return 'Not enough cash';
    return null;
  },
  openRoute(destId) {
    const why = this.whyNotOpen(destId);
    if (why) return why;
    const s = this.state;
    const hub = this.activeHub;
    const km = distKm(AIRPORT_BY_ID[hub.id], AIRPORT_BY_ID[destId]);
    s.money -= this.openCost(km);
    const route = this.addRoute(hub.id, destId);
    this.emit('toast', { text: `Route opened: ${hub.id} ⇄ ${destId}`, kind: 'good', sound: 'buy', target: { kind: 'route', id: route.id } });
    this.changed();
    return null;
  },
  // Quote and validate the whole launch before changing routes, aircraft or cash.
  launchQuote(hubId, destId, choice = {}) {
    const s = this.state, hub = this.hub(hubId);
    if (!hub || !AIRPORT_BY_ID[destId]) return { why: 'No such hub or destination' };
    const km = distKm(AIRPORT_BY_ID[hubId], AIRPORT_BY_ID[destId]);
    const routeCost = this.openCost(km);
    let why = this.atHub(hubId, () => this.whyNotOpen(destId));
    let type = null, plane = null, aircraftCost = 0, age = 0;
    if (choice.mode === 'parked') {
      plane = this.plane(choice.planeId);
      if (!plane || plane.hub !== hubId || plane.routeId != null || plane.phase !== 'idle') why ||= 'Choose a parked aircraft at this hub';
      else { type = AIRCRAFT[plane.type]; age = plane.age; }
    } else if (choice.mode === 'new' || choice.mode === 'used' || choice.mode === 'lease') {
      type = AIRCRAFT[choice.typeId];
      if (!type) why ||= 'Choose an aircraft';
      else {
        aircraftCost = choice.mode === 'lease' ? (this.leaseQuote(type.id, hubId, choice.days ?? 14).fee || 0) : this.planePrice(type.id, choice.mode === 'used');
        if (choice.mode === 'lease') why ||= this.leaseQuote(type.id, hubId, choice.days ?? 14).why;
        age = choice.mode === 'used' ? USED.age : 0;
        if (this.planesAt(hubId).length >= this.planeCap(hub)) why ||= 'No free gates — upgrade gates or use a parked aircraft';
      }
    } else if (choice.mode !== 'none') why ||= 'Choose an aircraft';
    if(type?.freighter && hub.levels.cargo<1)why ||= 'Build a cargo terminal at this hub first';
    if (type?.cls > hub.levels.runway) why ||= `Needs runway level ${type.cls}`;
    if (type?.range < km) why ||= 'Route is beyond this aircraft’s range';
    const total = routeCost + aircraftCost;
    if (s.money < total) why ||= 'Not enough cash for the route and aircraft';
    const market = this.estimate(hubId, destId, type?.id, this.planeReadiness(plane || { age }));
    const estimate = type ? market.best : null;
    const lease = choice.mode === 'lease' && type ? this.leaseQuote(type.id, hubId, choice.days ?? 14) : null;
    return { why, routeCost, aircraftCost, total, remaining: s.money - total, type, plane, lease, market,
      profit: estimate ? estimate.profit - type.price * 0.008 * age / 150 - (lease?.daily || plane?.lease?.daily || 0) : null,
      load: estimate?.load ?? null };
  },
  launchRoute(hubId, destId, choice) {
    const q = this.launchQuote(hubId, destId, choice);
    if (q.why) return q.why;
    this.state.money -= q.total;
    const route = this.addRoute(hubId, destId);
    const plane = choice.mode === 'parked' ? q.plane
      : q.type ? this.createPlane(q.type.id, choice.mode === 'used', hubId) : null;
    if (q.lease && plane) { this.attachLease(plane, q.lease); this.state.today.cost += q.lease.fee; this.state.today.leases += q.lease.fee; }
    if (plane) this.assign(plane.id, route.id, true);
    this.emit('toast', { text: plane ? `Route launched: ${hubId} ⇄ ${destId} · ${plane.name} assigned`
      : `Route opened: ${hubId} ⇄ ${destId} · assign an aircraft to start flying`, kind: 'good', sound: 'buy', target: { kind: 'route', id: route.id } });
    this.changed();
    return null;
  },
  addRoute(hubId, destId) {
    const s = this.state;
    const route = {
      id: s.nextId++, hub: hubId, dest: destId, km: distKm(AIRPORT_BY_ID[hubId], AIRPORT_BY_ID[destId]), price: 1, cabin: 0, service: 'balanced',
      poolOut: 0, poolIn: 0, cargoService: 'bulk', freightPools: {poolOut:[],poolIn:[]}, today: freshRouteStats(), yesterday: null,
    };
    s.routes.push(route);
    this.recordCompanyEvent('first-route', 'network', 'First route opened', `${hubId} ⇄ ${destId}`, s.minute, false, {kind:'route',id:route.id});
    this._rev++;
    // Start with a few hours of pent-up demand so the first flights aren't empty.
    route.poolOut = route.poolIn = this.routeDemand(route) * 0.25;
    return route;
  },
  closeRoute(routeId) {
    const s = this.state;
    const flight=s.planes.find(p=>p.routeId===routeId && this.connectionFlightWhy(p));
    if (flight) return this.connectionFlightWhy(flight);
    for(const pool of Object.values(this.route(routeId)?.freightPools || {}))for(const q of pool)this.freightClaim(this.route(routeId),q,'cancelled');
    for (const p of s.planes) if (p.routeId === routeId) this.park(p);
    s.routes = s.routes.filter((r) => r.id !== routeId);
    this.changed();
  },
  setPrice(routeId, delta) {
    const r = this.route(routeId);
    if (!r) return;
    const price = Math.round(Math.min(1.6, Math.max(0.6, r.price + delta)) * 10) / 10;
    if (price === r.price) return;
    const change = prepareChange(this, { kind: 'fare', title: `${r.hub} ⇄ ${r.dest} · fare ${Math.round(price * 100)}%`, routeIds: [r.id] });
    r.price = price;
    finishChange(this, change);
    this.changed();
  },
  setCabin(routeId, cabin) {
    const r = this.route(routeId);
    if (r && CABINS[cabin] && r.cabin !== cabin) {
      const change = prepareChange(this, { kind: 'cabin', title: `${r.hub} ⇄ ${r.dest} · ${CABINS[cabin].name} cabin`, routeIds: [r.id] });
      r.cabin = cabin; finishChange(this, change); this.changed();
    }
  },

  whyNotBuy(typeId, used = false) {
    const s = this.state;
    const hub = this.activeHub;
    const type = AIRCRAFT[typeId];
    if(type.freighter && hub.levels.cargo<1)return 'Build a cargo terminal at this hub first';
    if (type.cls > hub.levels.runway) return `Needs runway level ${type.cls}`;
    if (this.planesAt(hub.id).length >= this.planeCap(hub)) return 'No free gates — upgrade gates';
    if (s.money < this.planePrice(typeId, used)) return 'Not enough cash';
    return null;
  },
  buyPlane(typeId, used = false) {
    const why = this.whyNotBuy(typeId, used);
    if (why) return why;
    const s = this.state;
    const hub = this.activeHub;
    const type = AIRCRAFT[typeId];
    s.money -= this.planePrice(typeId, used);
    const plane = this.createPlane(typeId, used, hub.id);
    const id = plane.id;
    // Convenience: put it straight to work on a route nobody is flying.
    const options = this.routesAt(hub.id).filter((r) => r.km <= type.range);
    const unserved = options.filter((r) => this.planesOn(r.id).length === 0);
    if (unserved.length) this.assign(id, unserved[0].id, true);
    else if (options.length === 1) this.assign(id, options[0].id, true);
    this.emit('toast', { text: `${used ? 'Used ' : ''}${type.name} delivered${plane.routeId ? ` and assigned to ${this.route(plane.routeId).dest}` : ''}`, kind: 'good', sound: 'buy', target: { kind: 'plane', id } });
    this.changed();
    return null;
  },
  createPlane(typeId, used, hubId) {
    const s = this.state, id = s.nextId++;
    const plane = {
      id, type: typeId, name: `${hubId}-${String(id).padStart(3, '0')}`, registration: `${hubId}-${String(id).padStart(3, '0')}`, hub: hubId, routeId: null,
      phase: 'idle', t: 0, dur: 0, pax: 0, biz: 0, age: used ? USED.age : 0, profit: 0, flights: 0,
    };
    s.planes.push(plane);
    return plane;
  },
  sellPlane(planeId) {
    const s = this.state;
    const p = this.plane(planeId);
    if (!p) return;
    if (this.connectionFlightWhy(p)) return this.connectionFlightWhy(p);
    if (p.lease) return 'Return leased aircraft through the lease controls';
    s.money += this.planeValue(p);
    s.planes = s.planes.filter((x) => x.id !== planeId);
    this.changed();
  },
  overhaul(planeId) {
    const p = this.plane(planeId);
    if (!p) return 'No such aircraft';
    if(p.conversion)return 'Wait for the cargo conversion to finish';
    const cost = this.overhaulCost(p);
    if (this.state.money < cost) return 'Not enough cash';
    this.state.money -= cost;
    p.age *= 0.4;
    this.emit('toast', { text: `${p.name} overhauled`, kind: 'good', sound: 'buy', target: { kind: 'plane', id: p.id } });
    this.changed();
    return null;
  },
  // ---------- managing the fleet from the operations board ----------
  legsPerDay(type, km) { return DAY / ((km / type.speed) * 60 + type.turnaround); },
  plannedLegs(route, type, sharing = 1) {
    if(type.freighter)return this.freightForecast(route,type,sharing).flights;
    sharing=this.roleSharing(route,type,sharing);
    const policy = serviceOf(route), seats = this.seatsFor(type, route.cabin);
    const cycle = route.km / type.speed * 60 + this.routeTurnaround(type,route);
    const targetCycle = DAY * Math.max(1, sharing) * (seats.eco + seats.biz) * policy.fill / Math.max(1, this.routeDemand(route) * 2);
    return DAY / (cycle + Math.min(policy.wait, Math.max(0, targetCycle - cycle)));
  },
  // Seats offered per day on a route, both directions together.
  seatsPerDay(route) {
    return this.planesOn(route.id).reduce((n, p) => {
      const t = AIRCRAFT[p.type], seats = this.seatsFor(t, route.cabin);
      return n + this.plannedLegs(route, t, this.planesOn(route.id).length) * (seats.eco + seats.biz);
    }, 0);
  },
  // What one aircraft of this type would earn per day on a route shared by `sharing` aircraft in all, after its upkeep.
  typeProfit(route, type, sharing = 1) {
    if(type.freighter)return this.freightForecast(route,type,sharing);
    const allSharing=sharing;sharing=this.roleSharing(route,type,sharing);
    const hub = this.hub(route.hub);
    const legs = this.plannedLegs(route,type,allSharing), seats = this.seatsFor(type, route.cabin);
    const f = this.routeFactors(route), perLegDemand = Object.fromEntries(PASSENGER_KEYS.map((id) => [id, f.segments[id] * 2 / Math.max(1, sharing) / legs]));
    const { biz, eco } = passengerLoad(perLegDemand, seats, f.businessPreference);
    const perLeg = (eco + biz * this.businessMultiplier(hub)) * this.ticket(route) + (eco + biz) * AMENITY_INCOME[hub.levels.amenities] + this.cargoIncome(type, route, hub) - this.flightCost(type, route.km, hub);
    return { profit: perLeg * legs - type.price * 0.008, load: (eco + biz) / (seats.eco + seats.biz), flights: legs };
  },
  // Aircraft types that could fly a route, each with its estimate, best first.
  fitsFor(route, sharing = 1) {
    const hub = this.hub(route.hub);
    return AIRCRAFT_LIST.filter((t) => t.cls <= hub.levels.runway && t.range >= route.km && (!t.freighter || hub.levels.cargo>0))
      .map((t) => ({ type: t, ...this.typeProfit(route, t, sharing) })).sort((a, b) => b.profit - a.profit);
  },
  whyNotMove(planeId, routeId) {
    const p = this.plane(planeId), r = this.route(routeId);
    if (!p || !r) return 'No such aircraft or route';
    if (this.connectionFlightWhy(p)) return this.connectionFlightWhy(p);
    if (p.lease?.returning) return 'This aircraft is completing its last leased flight';
    const t = AIRCRAFT[p.type];
    if(t.freighter && this.hub(r.hub).levels.cargo<1)return 'Build a cargo terminal at the destination hub first';
    if (r.km > t.range) return `Beyond the ${t.name}’s range`;
    if (r.hub !== p.hub) {
      const hub = this.hub(r.hub);
      if (t.cls > hub.levels.runway) return `${r.hub}’s runway is too short for it`;
      if (this.planesAt(r.hub).length >= this.planeCap(hub)) return `No free gate at ${r.hub}`;
    }
    return null;
  },
  // Put an aircraft on any route you fly. If the route belongs to another hub, the aircraft is rebased there.
  movePlane(planeId, routeId) {
    const why = this.whyNotMove(planeId, routeId);
    if (why) return why;
    const p = this.plane(planeId), r = this.route(routeId);
    p.hub = r.hub;
    return this.assign(planeId, routeId);
  },
  // Two aircraft trade places, routes and home hubs both.
  whyNotSwap(aId, bId) {
    const a = this.plane(aId), b = this.plane(bId);
    if (!a || !b || a === b) return 'Pick two different aircraft';
    if (this.connectionFlightWhy(a) || this.connectionFlightWhy(b)) return this.connectionFlightWhy(a) || this.connectionFlightWhy(b);
    if (a.lease?.returning || b.lease?.returning) return 'An aircraft is completing its last leased flight';
    const ra = this.route(a.routeId), rb = this.route(b.routeId);
    const fits = (p, r, hubId) => {
      const t = AIRCRAFT[p.type];
      if (r && r.km > t.range) return `${r.hub} ⇄ ${r.dest} is beyond the ${t.name}’s range`;
      if(t.freighter && this.hub(hubId).levels.cargo<1)return 'Build a cargo terminal at the destination hub first';
      if (t.cls > this.hub(hubId).levels.runway) return `${hubId}’s runway is too short for the ${t.name}`;
      return null;
    };
    return fits(a, rb, b.hub) || fits(b, ra, a.hub);
  },
  swapPlanes(aId, bId) {
    const why = this.whyNotSwap(aId, bId);
    if (why) return why;
    const a = this.plane(aId), b = this.plane(bId);
    const ra = this.route(a.routeId), rb = this.route(b.routeId);
    const hubA = a.hub, hubB = b.hub;
    a.hub = hubB; b.hub = hubA;
    if (rb) this.assign(a.id, rb.id, true); else this.park(a);
    if (ra) this.assign(b.id, ra.id, true); else this.park(b);
    this.changed();
    return null;
  },
  changeTypeCost(p, typeId) { return this.planePrice(typeId) - this.planeValue(p); },
  whyNotChangeType(planeId, typeId) {
    const p = this.plane(planeId), t = AIRCRAFT[typeId];
    if (!p || !t) return 'No such aircraft';
    if (this.connectionFlightWhy(p)) return this.connectionFlightWhy(p);
    if(p.conversion)return 'Wait for the cargo conversion to finish';
    if (p.lease) return 'Return this lease before replacing the aircraft';
    if (p.type === typeId) return 'It already is one';
    if(t.freighter && this.hub(p.hub).levels.cargo<1)return 'Build a cargo terminal at this hub first';
    if (t.cls > this.hub(p.hub).levels.runway) return `Needs runway level ${t.cls} at ${p.hub}`;
    const r = this.route(p.routeId);
    if (r && r.km > t.range) return `Cannot reach ${r.dest}`;
    if (this.state.money < this.changeTypeCost(p, typeId)) return 'Not enough cash';
    return null;
  },
  // Trade an aircraft in for a new one of a different type. It keeps its gate, name and route.
  changeType(planeId, typeId) {
    const why = this.whyNotChangeType(planeId, typeId);
    if (why) return why;
    const p = this.plane(planeId);
    this.state.money -= this.changeTypeCost(p, typeId);
    const was = AIRCRAFT[p.type].name;
    p.type = typeId; p.age = 0; p.yday = null; p.day = 0;
    if (p.routeId != null) { p.phase = 'home'; p.t = 0; p.pax = 0; p.biz = 0; p.passengers = null; }
    this.emit('toast', { text: `${p.name}: ${was} traded in for a ${AIRCRAFT[typeId].name}`, kind: 'good', sound: 'buy', target: { kind: 'plane', id: p.id } });
    this.changed();
    return null;
  },
  atHub(hubId, fn) { const s = this.state, prev = s.active; s.active = hubId; try { return fn(); } finally { s.active = prev; } },
  whyNotBuyFor(routeId, typeId, used = false) {
    const r = this.route(routeId);
    if (!r) return 'No such route';
    if (AIRCRAFT[typeId].range < r.km) return 'Cannot reach';
    return this.atHub(r.hub, () => this.whyNotBuy(typeId, used));
  },
  // Buy an aircraft straight onto a route, whichever hub is on screen.
  buyFor(routeId, typeId, used = false) {
    const why = this.whyNotBuyFor(routeId, typeId, used);
    if (why) return why;
    const r = this.route(routeId);
    const n = this.state.planes.length;
    const err = this.atHub(r.hub, () => this.buyPlane(typeId, used));
    if (err) return err;
    if (this.state.planes.length > n) this.assign(this.state.planes[this.state.planes.length - 1].id, routeId);
    return null;
  },
  // ---------- suggestions ----------
  // Estimated daily profit of a route flown by a given list of aircraft types.
  routeEstimate(route, types) {
    return types.reduce((n, t) => n + this.typeProfit({...route,forecastTypes:types}, t, types.length).profit, 0);
  },
  // Up to three concrete fixes for a route, best first: { text, gain, kind, arg }.
  // kind is 'swap' (two aircraft ids), 'type' (aircraft id, type id), 'move' (aircraft id, route id), 'park' (aircraft id) or 'add' (route id).
  suggest(route) {
    if(this.cargoOnly(route))return [];
    const s = this.state;
    const on = this.planesOn(route.id);
    const types = on.map((p) => AIRCRAFT[p.type]);
    const now = this.routeEstimate(route, types);
    const out = [];
    const MIN = 4000;
    const parked = s.planes.filter((p) => !AIRCRAFT[p.type].freighter && p.routeId == null && !this.whyNotMove(p.id, route.id));
    const want = this.routeDemand(route) * 2, seats = this.seatsPerDay(route);
    if (!on.length || seats < want * 0.8) {
      // short of seats: a parked aircraft first, otherwise buy the type that fits
      const best = parked.map((p) => ({ p, gain: this.routeEstimate(route, [...types, AIRCRAFT[p.type]]) - now + this.planeUpkeep(p) }))
        .sort((a, b) => b.gain - a.gain)[0];
      if (best && best.gain > MIN) out.push({ text: `Put parked ${best.p.name} (${AIRCRAFT[best.p.type].name}) on it`, gain: best.gain, kind: 'move', arg: `${best.p.id}:${route.id}` });
      const fit = this.fitsFor(route, on.length + 1).find(x=>!x.type.freighter);
      if (fit && fit.profit > MIN && !this.whyNotBuyFor(route.id, fit.type.id)) out.push({ text: `Buy a ${fit.type.name} for it · ${fmtMoney(this.planePrice(fit.type.id))}`, gain: fit.profit, kind: 'add', arg: `${route.id}` });
    }
    if (on.length === 1) {
      const p = on[0];
      const swap = parked.filter((q) => q.type !== p.type).map((q) => ({ q, gain: this.routeEstimate(route, [AIRCRAFT[q.type]]) - now }))
        .sort((a, b) => b.gain - a.gain)[0];
      if (swap && swap.gain > MIN) out.push({ text: `Swap ${p.name} with parked ${swap.q.name} (${AIRCRAFT[swap.q.type].name})`, gain: swap.gain, kind: 'swap', arg: `${p.id}:${swap.q.id}` });
      const fit = this.fitsFor(route, 1).find(x=>!x.type.freighter);
      if (fit && fit.type.id !== p.type && fit.profit - now > MIN && !this.whyNotChangeType(p.id, fit.type.id)) {
        const cost = this.changeTypeCost(p, fit.type.id);
        out.push({ text: `Trade ${p.name} in for a ${fit.type.name} · ${cost >= 0 ? fmtMoney(cost) : `${fmtMoney(-cost)} back`}`, gain: fit.profit - now, kind: 'type', arg: `${p.id}:${fit.type.id}` });
      }
    }
    if (on.length > 1 && seats > want * 1.4) {
      // too many seats: send the least useful aircraft where it would earn most
      let best = null;
      for (const p of on.filter(x=>!AIRCRAFT[x.type].freighter)) {
        const rest = on.filter((x) => x !== p).map((x) => AIRCRAFT[x.type]);
        const freed = this.routeEstimate(route, rest) - now; // what this route gains (or loses) without it
        for (const r of s.routes) {
          if (r === route || this.whyNotMove(p.id, r.id)) continue;
          const there = this.planesOn(r.id).map((x) => AIRCRAFT[x.type]);
          const gain = freed + this.routeEstimate(r, [...there, AIRCRAFT[p.type]]) - this.routeEstimate(r, there);
          if (!best || gain > best.gain) best = { p, r, gain };
        }
      }
      // or simply stand it down, if nothing else would pay for it
      const idle = on.filter(p=>!AIRCRAFT[p.type].freighter).map((p) => ({ p, gain: this.routeEstimate(route, on.filter((x) => x !== p).map((x) => AIRCRAFT[x.type])) - now - AIRCRAFT[p.type].price * 0.008 }))
        .sort((a, b) => b.gain - a.gain)[0];
      if (best && best.gain > MIN && best.gain >= idle.gain) out.push({ text: `Move ${best.p.name} to ${best.r.hub} ⇄ ${best.r.dest}`, gain: best.gain, kind: 'move', arg: `${best.p.id}:${best.r.id}` });
      else if (idle.gain > MIN) out.push({ text: `Park ${idle.p.name}: no other route would pay for it. Then sell it or trade it for a smaller type`, gain: idle.gain, kind: 'park', arg: `${idle.p.id}:` });
    }
    return out.sort((a, b) => b.gain - a.gain).slice(0, 3);
  },
  applySuggestion(kind, arg) {
    const [a, b] = String(arg).split(':');
    if (kind === 'swap') return this.swapPlanes(+a, +b);
    if (kind === 'type') return this.changeType(+a, b);
    if (kind === 'move') return this.movePlane(+a, +b);
    if (kind === 'park') return this.assign(+a, null);
    return 'Nothing to do';
  },
  // Work out the best use of a hub's own aircraft on its own routes. Changes nothing; returns the plan.
  autoFit(hubId) {
    const planes = this.planesAt(hubId).filter((p) => !p.lease?.returning && !this.connectionFlightWhy(p) && (p.phase !== 'repair' || p.routeId == null));
    const routes = this.routesAt(hubId);
    const current = (r) => this.planesOn(r.id).map((p) => AIRCRAFT[p.type]);
    const extraUpkeep = this.planesAt(hubId).reduce((n, p) => n + this.planeUpkeep(p) - AIRCRAFT[p.type].price * .008, 0);
    const before = routes.reduce((n, r) => n + this.routeEstimate(r, current(r)), 0)
      - planes.filter((p) => p.routeId == null).reduce((n, p) => n + AIRCRAFT[p.type].price * 0.008, 0) - extraUpkeep;
    const plan = new Map(routes.map((r) => [r.id, this.planesOn(r.id).filter((p) => !planes.includes(p))])); // route id -> aircraft
    const free = [...planes];
    for (;;) {
      let best = null;
      for (const p of free) {
        const t = AIRCRAFT[p.type];
        for (const r of routes) {
          if (r.km > t.range) continue;
          const there = plan.get(r.id).map((x) => AIRCRAFT[x.type]);
          // flying must beat sitting parked, where it would only cost its upkeep
          const gain = this.routeEstimate(r, [...there, t]) - this.routeEstimate(r, there) + t.price * 0.008;
          if (gain > 0 && (!best || gain > best.gain)) best = { p, r, gain };
        }
      }
      if (!best) break;
      plan.get(best.r.id).push(best.p);
      free.splice(free.indexOf(best.p), 1);
    }
    const after = routes.reduce((n, r) => n + this.routeEstimate(r, plan.get(r.id).map((p) => AIRCRAFT[p.type])), 0)
      - free.reduce((n, p) => n + AIRCRAFT[p.type].price * 0.008, 0) - extraUpkeep;
    const moves = [];
    for (const r of routes) for (const p of plan.get(r.id)) if (p.routeId !== r.id) moves.push({ plane: p.id, name: p.name, type: AIRCRAFT[p.type].name, from: this.route(p.routeId)?.dest ?? null, to: r.dest, route: r.id });
    for (const p of free) if (p.routeId != null) moves.push({ plane: p.id, name: p.name, type: AIRCRAFT[p.type].name, from: this.route(p.routeId).dest, to: null, route: null });
    return { hub: hubId, moves, before, after, gain: after - before };
  },
  applyAutoFit(hubId) {
    const plan = this.autoFit(hubId);
    if (!plan.moves.length || plan.gain < 1000) return 'The aircraft are already where they earn most';
    const change = prepareChange(this, { kind: 'autofit', title: `${hubId} · auto-fit ${plan.moves.length} aircraft`,
      routeIds: this.routesAt(hubId).map((r) => r.id), planeIds: this.planesAt(hubId).map((p) => p.id), estimatedBefore: plan.before });
    for (const m of plan.moves) this.assign(m.plane, m.route, true);
    finishChange(this, change, plan.after);
    this.emit('toast', { text: `${hubId}: ${plan.moves.length} aircraft reassigned, about ${fmtSigned(plan.gain)} a day`, kind: 'good', sound: 'buy' });
    this.changed();
    return null;
  },
  replaceCost(p) { return this.planePrice(p.type) - this.planeValue(p); },
  // Trade an aircraft in for a factory-new one of the same type. It keeps its name, gate and route.
  replacePlane(planeId) {
    const p = this.plane(planeId);
    if (!p) return 'No such aircraft';
    if(p.conversion)return 'Wait for the cargo conversion to finish';
    if (p.lease) return 'Return this lease before replacing the aircraft';
    if (p.age < 20) return 'This aircraft is still new';
    const cost = this.replaceCost(p);
    if (this.state.money < cost) return 'Not enough cash';
    this.state.money -= cost;
    p.age = 0;
    if (p.phase === 'repair') { p.phase = p.resume || 'home'; p.t = 0; }
    this.emit('toast', { text: `${p.name} replaced with a new ${AIRCRAFT[p.type].name}`, kind: 'good', sound: 'buy', target: { kind: 'plane', id: p.id } });
    this.changed();
    return null;
  },
  // Put every parked aircraft to work: empty routes first, then wherever most passengers are waiting.
  assignIdle() {
    const s = this.state;
    let n = 0;
    for (const p of s.planes) {
      if (p.routeId != null) continue;
      const options = this.routesAt(p.hub).filter((r) => r.km <= AIRCRAFT[p.type].range);
      if (!options.length) continue;
      const score = (r) => (this.planesOn(r.id).length ? 0 : 1e6) + r.poolOut + r.poolIn;
      options.sort((a, b) => score(b) - score(a));
      this.assign(p.id, options[0].id, true);
      n++;
    }
    if (!n) return 'No parked aircraft has a route it can fly';
    this.emit('toast', { text: `${n} parked aircraft put to work`, kind: 'good', sound: 'buy' });
    this.changed();
    return null;
  },
  risky() { return this.state.planes.filter((p) => p.age >= 20 && this.breakdownRisk(p) > 0.03); },
  overhaulRisky() {
    const s = this.state;
    let n = 0;
    for (const p of this.risky()) {
      if(p.conversion)continue;
      const cost = this.overhaulCost(p);
      if (s.money < cost) break;
      s.money -= cost; p.age *= 0.4; n++;
    }
    if (!n) return 'Not enough cash';
    this.emit('toast', { text: `${n} aircraft overhauled`, kind: 'good', sound: 'buy' });
    this.changed();
    return null;
  },
  park(p) { delete p.recoveryAssignment; p.routeId = null; p.phase = 'idle'; p.t = 0; p.pax = 0; p.biz = 0; p.passengers = null; },
  assign(planeId, routeId, quiet = false) {
    const p = this.plane(planeId);
    if (!p) return 'No such aircraft';
    if (this.connectionFlightWhy(p)) return this.connectionFlightWhy(p);
    if (p.lease?.returning) return 'This aircraft is completing its last leased flight';
    if (routeId == null) { this.park(p); if (!quiet) this.changed(); else this._rev++; return null; }
    const r = this.route(routeId);
    if (!r || r.hub !== p.hub) return 'That route belongs to another hub';
    if(AIRCRAFT[p.type].freighter && this.hub(r.hub).levels.cargo<1)return 'Build a cargo terminal at this hub first';
    if (r.km > AIRCRAFT[p.type].range) return 'Route is beyond this aircraft’s range';
    delete p.recoveryAssignment;
    p.routeId = routeId; p.phase = 'home'; p.t = 0; p.pax = 0; p.biz = 0; p.passengers = null;
    if (!quiet) this.changed(); else this._rev++;
    return null;
  },

  whyNotHub(airportId) {
    const s = this.state;
    const a = AIRPORT_BY_ID[airportId];
    if (this.isHub(airportId)) return 'Already your hub';
    const rival = this.rivalAt(airportId);
    if (rival) return `${rival.name} is based here`;
    if (bestRank(s) < 1) return 'Grow a hub to Regional Airport first';
    if (s.money < this.hubCost(a)) return 'Not enough cash';
    return null;
  },
  buyHub(airportId) {
    const why = this.whyNotHub(airportId);
    if (why) return why;
    const s = this.state;
    const cost = this.hubCost(AIRPORT_BY_ID[airportId]);
    s.money -= cost;
    s.invested += cost;
    s.hubs.push(makeHub(airportId));
    s.active = airportId;
    this.recordCompanyEvent(`hub:${airportId}`, 'network', `New hub in ${AIRPORT_BY_ID[airportId].city}`, airportId);
    this.emit('toast', { text: `New hub opened in ${AIRPORT_BY_ID[airportId].city}`, kind: 'goal', sound: 'goal' });
    this.changed();
    return null;
  },

  // ---------- taking a rival down ----------
  rival(id) { return this.state.rivals.find((r) => r.id === id); },
  rivalPressure(rv) {
    return { parts: pressureOn(this.state, rv), change: rv.healthChange || 0 };
  },
  takeoverCost(rv) {
    if (!rv?.hub) return 0;
    const airports = rv.hubs.reduce((n, h) => n + (2e6 + AIRPORT_BY_ID[h.id].size * 1.5e6) * (1 + h.level * 0.15), 0);
    const fleet = rv.routes.reduce((n, r) => n + rivalAircraftValue(r), 0);
    return Math.max(1e6, Math.round((airports + fleet + Math.max(0, rv.cash)) / 1e5) * 1e5) + Math.ceil(rivalLeaseAccrued(rv,this.state.minute));
  },
  whyNotTakeover(id) {
    const rv = this.rival(id);
    if (!rv || !rv.hub) return 'That airline is gone';
    if(this.partnershipTakeoverWhy(rv))return this.partnershipTakeoverWhy(rv);
    if (!canTakeOver(rv)) return 'Not for sale — needs sustained losses and depleted cash reserves';
    if (this.state.money < this.takeoverCost(rv)) return 'Not enough cash';
    return null;
  },
  // Acquire every hub and the operating aircraft. Existing reverse hub links
  // are reused, so a takeover cannot create duplicate routes or orphan planes.
  takeover(id) {
    const why = this.whyNotTakeover(id);
    if (why) return why;
    const s = this.state;
    const rv = this.rival(id);
    const cost = this.takeoverCost(rv);
    const base = rv.hub, name = rv.name;
    const hubs = rv.hubs.map((h) => ({ ...h })), routes = rv.routes.map((r) => ({ ...r }));
    const fleetValue = routes.reduce((n, r) => n + rivalAircraftValue(r), 0);
    s.money -= cost; s.invested += Math.max(0, cost - fleetValue);
    removeRival(s, rv);
    for (const h of hubs) if (!this.isHub(h.id)) s.hubs.push({...makeHub(h.id,rivalHubLevels(h)),specialization:h.specialization || 'general',specializationUntil:h.specializationUntil || 0});
    s.active = base;
    let kept = 0, parked = 0;
    for (const rr of routes) {
      const hub = this.hub(rr.hub), type = AIRCRAFT[rr.type];
      let route = this.routeTo(rr.hub, rr.dest) || this.routeTo(rr.dest, rr.hub);
      if (!route && this.routesAt(rr.hub).length < this.routeCap(hub)) { route = this.addRoute(rr.hub, rr.dest); route.price = rr.price; route.service=rr.service || 'balanced'; route.cabin=rr.cabin || 0;route.cargoService=rr.cargoService || 'bulk'; kept++; }
      const plane = this.createPlane(rr.type, false, hub.id);
      plane.name = `${name} ${plane.id}`; plane.age = rr.age || 0;
      if (rr.lease) { plane.lease={...rr.lease,billedUntil:s.minute}; plane.leaseRentToday=0; }
      if (route?.hub === hub.id && route.km <= type.range) this.assign(plane.id, route.id, true);
      else parked++;
    }
    s.takeovers++;
    this.recordCompanyEvent(`takeover:${id}`, 'network', `${name} acquired`, `${hubs.length} hubs and ${routes.length} aircraft joined your airline.`);
    this.emit('toast', { text: `You bought ${name}: ${hubs.length} hubs, ${kept} new routes and ${routes.length} aircraft${parked ? ` (${parked} parked for assignment)` : ''}`, kind: 'goal', sound: 'goal', at: base });
    this.changed();
    return null;
  },

  borrow(amount) {
    const s = this.state;
    if (s.debt + amount > this.creditLimit()) return 'The bank won’t lend you that much';
    s.debt += amount; s.money += amount;
    this.changed();
    return null;
  },
  repay(amount) {
    const s = this.state;
    const pay = Math.min(amount, s.debt, Math.max(0, s.money));
    if (pay <= 0) return 'Nothing to repay with';
    s.debt -= pay; s.money -= pay;
    this.changed();
    return null;
  },
  sellStake() {
    const s = this.state;
    const offer = this.stakeOffer();
    if (offer == null) return 'Investors already own as much as they want';
    s.money += offer;
    s.equity = Math.round((s.equity + 0.1) * 10) / 10;
    this.emit('toast', { text: `Sold a 10% stake for ${fmtMoney(offer)}`, kind: 'good', sound: 'buy' });
    this.changed();
    return null;
  },
  hedge(eventId) {
    const s = this.state;
    const e = s.events.find((x) => x.id === eventId);
    if (!e || e.type !== 'fuelSpike' || e.hedged) return 'Nothing to hedge';
    const cost = this.hedgeCost(e);
    if (s.money < cost) return 'Not enough cash';
    s.money -= cost; e.hedged = true;
    this.emit('toast', { text: 'Fuel hedged — the spike won’t affect you', kind: 'good', sound: 'buy' });
    this.changed();
    return null;
  },
  settle(eventId) {
    const s = this.state;
    const e = s.events.find((x) => x.id === eventId);
    if (!e || e.type !== 'strike' || e.settled) return 'Nothing to settle';
    const cost = this.settleCost(e);
    if (s.money < cost) return 'Not enough cash';
    s.money -= cost; s.today.cost += cost; s.today.recovery = (s.today.recovery || 0) + cost; e.settled = true;
    this.emit('toast', { text: `Strike at ${e.airport} settled`, kind: 'good', sound: 'buy' });
    this.changed();
    return null;
  },
  bailout() {
    const s = this.state;
    if (s.over?.type !== 'bankrupt' || s.equity > 0.3) return 'No investor will touch this';
    s.equity = Math.round((s.equity + 0.2) * 10) / 10;
    s.money = Math.max(s.money, 0) + 750e3;
    s.negDays = 0; s.over = null;
    this.changed();
    return null;
  },
  keepPlaying() {
    const s = this.state;
    s.mode.id = 'free'; s.over = null;
    this.changed();
  },
  setSpeed(speed) {
    this.state.speed = speed;
    this.emit('change');
  },

  changed() {
    this._rev++;
    this.checkGoals();
    this.checkScenario(false);
    this.checkCampaign();
    this.syncCompany();
    if (!this.silent) this.save();
    this.emit('change');
  },

  // ---------- simulation ----------
  tick(dt) {
    const s = this.state;
    if (!s || s.over || dt <= 0) return;
    if (dt>30) {for (let left=dt;left>0 && !s.over;left-=30) this.tick(Math.min(30,left));return;}
    s.minute += dt;
    this.stepProjects(dt);
    this.stepDisruptions(dt);
    this.stepConnections(dt);
    this.stepPartnerships(dt);
    this.stepFreight(dt);
    for (const r of s.routes) this.growPassengerPools(r, dt);
    const aged = dt / DAY;
    for (const p of s.planes) {
      if (!this.stepLease(p)) continue;
      p.age += aged;
      if(this.stepConversion(p))continue;
      if (p.routeId != null) this.stepPlane(p, dt);
    }

    const day = Math.floor(s.minute / DAY);
    if (day > s.day) { this.endOfDay(); s.day = day; this.startOfDay(); }
    this.checkCampaign();
  },

  stepPlane(p, dt) {
    const route = this.route(p.routeId);
    if (!route) { this.park(p); return; }
    const type = AIRCRAFT[p.type];
    if(p.conversion)return;
    let left = dt;
    for (let guard = 0; left > 0 && guard < 8; guard++) {
      const turnaround=this.turnaround(type,(p.phase==='turn' || p.phase==='repair' && p.resume==='turn')?route.dest:route.hub);
      if (p.phase === 'repair') {
        p.t += left;
        if (p.t >= 720) { p.phase = p.resume || 'home'; p.t = turnaround; }
        break;
      }
      if (p.phase === 'home' || p.phase === 'turn') {
        p.t += left; left = 0;
        if (p.t < turnaround) break;
        if (this.closed(route.hub) || this.closed(route.dest)) break; // grounded by a storm or strike
        const key = p.phase === 'home' ? 'poolOut' : 'poolIn';
        const seats = this.seatsFor(type, route.cabin);
        const policy=type.freighter?freightService(route):serviceOf(route),waiting=type.freighter?(route.freightPools?.[key] || []).reduce((n,q)=>n+q.tonnes,0):route[key];
        const capacity=type.freighter?freightHold(type,this.hub(route.hub)):seats.eco+seats.biz;
        if(capacity<=0)break;
        if (waiting >= capacity * policy.fill || p.t >= turnaround + policy.wait) {
          const boarded = type.freighter?{eco:0,biz:0,counts:emptyPassengers(),journeys:[]}:this.boardPassengers(route, type, key);
          if(type.freighter){p.freightManifest=this.boardFreight(route,type,key);p.freightCapacity=freightHold(type,this.hub(route.hub));}
          p.biz = boarded.biz; p.pax = boarded.eco; p.passengers = boarded.counts;
          if (boarded.journeys.length) p.journeys=boarded.journeys;
          const from = p.phase === 'home' ? route.hub : route.dest;
          p.phase = p.phase === 'home' ? 'out' : 'back';
          p.t = 0;
          p.dur = (route.km / type.speed) * 60;
          this.emit('depart', { at: from, plane: p });
        }
      } else {
        const need = p.dur - p.t;
        if (left < need) { p.t += left; break; }
        left -= need;
        this.land(p, route, type, this.state.minute-left);
        if (!this.plane(p.id)) break;
      }
    }
  },

  land(p, route, type, arrivalMinute=this.state.minute) {
    const s = this.state;
    const hub = this.hub(route.hub);
    const fare = this.ticket(route);
    const people = p.pax + p.biz;
    const freight=type.freighter?this.deliverFreight(p,route,arrivalMinute):null;
    const cargo = freight?freight.revenue:this.cargoIncome(type, route, hub);
    const rev = p.pax * fare + p.biz * fare * this.businessMultiplier(hub) + people * AMENITY_INCOME[hub.levels.amenities] + cargo;
    const cost = this.flightCost(type, route.km, hub);
    const seats = this.seatsFor(type, route.cabin);
    s.money += rev - cost;
    s.today.rev += rev; s.today.cost += cost; s.today.cargo += cargo;
    s.today.fuel += cost - this.handlingCost(type, hub);
    const st = route.today;
    st.rev += rev; st.cost += cost; st.pax += people; st.seats += seats.eco + seats.biz; st.flights++;
    st.passengers ||= emptyPassengers();
    if (p.passengers) for (const id of PASSENGER_KEYS) st.passengers[id] += p.passengers[id] || 0;
    s.totalPax += people; s.flights++;
    this.recordCompanyFlight(p, route, arrivalMinute);
    if (s.contracts.length) this.contractProgress(route,type,hub,people,freight && (p.phase==='out'?freight:{bulk:0,express:0}));
    p.profit += rev - cost; p.flights++; p.day = (p.day || 0) + rev - cost;
    const at = p.phase === 'out' ? route.dest : route.hub;
    this.landConnections(p,route,at,arrivalMinute);
    this.recordCampaignFlight(route,people);
    this.emit('land', { at, from: p.phase === 'out' ? route.hub : route.dest, net: rev - cost, pax: people, plane: p });
    p.phase = p.phase === 'out' ? 'turn' : 'home';
    p.t = 0; p.pax = 0; p.biz = 0; p.passengers = null;
    if (p.lease?.returning) { this.finishLease(p); return; }
    if (this.rand() < this.breakdownRisk(p)) {
      const bill = type.price * 0.02;
      s.money -= bill; s.today.cost += bill;
      p.resume = p.phase; p.phase = 'repair';
      const repBefore = s.rep;
      this.bumpRep(-Math.min(1, Math.max(0.15, 4 / s.planes.length)));
      this.recordBreakdown(p, repBefore - s.rep);
      this.emit('toast', { text: `${p.name} broke down at ${at} — 12 hours in the hangar, ${fmtMoney(bill)}`, kind: 'bad', sound: 'alert', target: { kind: 'plane', id: p.id } });
    }
    if (s.flights === 1) this.checkGoals();
  },

  endOfDay() {
    const s = this.state;
    this.closeConnectionDay();
    this.closePartnershipDay();
    const hubUpkeep = Object.fromEntries(s.hubs.map((h) => [h.id, this.hubUpkeep(h)]));
    const upkeep = Object.values(hubUpkeep).reduce((n, value) => n + value, 0);
    const maintenance = this.maintenancePerDay();
    const interest = s.debt * INTEREST;
    s.money -= upkeep + maintenance + interest;
    s.today.cost += upkeep + maintenance + interest;
    let profit = s.today.rev - s.today.cost;
    const dividends = profit > 0 ? profit * s.equity : 0;
    s.money -= dividends;
    profit -= dividends;
    s.yesterday = { ...s.today, upkeep, hubUpkeep, maintenance, interest, dividends, profit };
    s.today = freshLedger();
    s.history.push(Math.round(profit));
    if (s.history.length > 60) s.history.shift();
    s.bestDay = Math.max(s.bestDay, profit);
    for (const r of s.routes) {
      r.yesterday = r.today; r.today = freshRouteStats();
      const made = this.routeProfit(r);
      r.yesterday.profit = made;
      r.week = (r.week || 0) + made;
      r.hot = made > 30e3 ? (r.hot || 0) + 1 : 0; // a steady earner is what rivals come looking for
    }
    for (const p of s.planes) { p.yday = (p.day || 0) - this.planeMaintenance(p) - (p.leaseRentToday || 0); p.day = 0; p.leaseRentToday = 0; }
    collectChangeResults(this);
    s.streak = profit >= 0 ? s.streak + 1 : 0;
    // Closure penalties accrue with elapsed disruption time; compensation reduces them.
    // The normal daily reputation drift remains independent of those penalties.
    s.rep += (this.repTarget() - s.rep) * 0.1;
    this.closeCampaignDay(profit);
    this.closeCompanyDay();
    this.emit('toast', { text: `Day ${s.day + 1} closed · ${fmtSigned(profit)}`, kind: profit >= 0 ? 'good' : 'bad', quiet: true });

    s.negDays = s.money < 0 ? s.negDays + 1 : 0;
    if (s.negDays >= BANKRUPT_DAYS) {
      s.over = { type: 'bankrupt' };
      this.emit('over', s.over);
    } else if (s.negDays > 0) {
      this.emit('toast', { text: `In the red. ${BANKRUPT_DAYS - s.negDays} day${BANKRUPT_DAYS - s.negDays === 1 ? '' : 's'} until the bank pulls the plug`, kind: 'bad', sound: 'alert', target: { kind: 'page', id: 'finance' } });
    }
  },

  startOfDay() {
    const s = this.state;
    const rand = () => this.rand();
    for (const n of stepRivals(s, rand)) this.emit('toast', { kind: 'bad', ...n });
    this.stepFuel();
    scheduleEvents(s, rand, this);
    this.stepContracts();
    for (const e of s.events) {
      if (e.start !== s.day) continue;
      // Don't announce a storm over an airport the player has nothing to do with.
      const mine = !e.airport || e.type === 'festival' || this.isHub(e.airport) || s.routes.some((r) => r.dest === e.airport);
      if (mine) this.emit('toast', { text: describe(e).title, kind: 'goal', sound: 'alert', at: e.airport });
      if (e.type === 'strike' && !e.settled) this.emit('choice', e);
    }
    if (s.day % 7 === 0) this.weeklyReport();
    this.checkScenario(true);
    this.changed();
  },

  checkGoals() {
    const s = this.state;
    if (!s) return;
    for (const g of GOALS) {
      if (s.goalsDone.includes(g.id) || !g.test(s)) continue;
      s.goalsDone.push(g.id);
      this.recordCompanyEvent(`goal:${g.id}`, 'milestones', g.title, 'Goal completed.');
      s.money += g.reward;
      this.emit('toast', { text: `Goal complete: ${g.title} · ${fmtSigned(g.reward)}`, kind: 'goal', sound: 'goal' });
    }
    for (const a of ACHIEVEMENTS) {
      if (s.achDone.includes(a.id) || !a.test(s, this)) continue;
      s.achDone.push(a.id);
      this.recordCompanyEvent(`achievement:${a.id}`, 'milestones', a.title, a.desc);
      this.emit('toast', { text: `Achievement: ${a.title}`, kind: 'goal', sound: 'goal' });
    }
    this.checkWorld();
  },

  checkScenario(dayStart) {
    const s = this.state;
    if (!s || s.over) return;
    const sc = this.scenario();
    if (sc.id === 'daily') {
      if (!dayStart || s.day < sc.deadline) return;
      const score = Math.round(this.netWorth());
      const m = this.medals();
      const best = Math.max(m.daily[s.mode.date] || 0, score);
      m.daily = { [s.mode.date]: best }; // only today's best is worth keeping
      this.saveMedals(m);
      s.over = { type: 'daily', score, best };
    } else if (sc.win?.(s)) {
      const m = this.medals();
      if (!m.won.includes(sc.id)) { m.won.push(sc.id); this.saveMedals(m); }
      s.over = { type: 'won', day: s.day + 1 };
      this.recordCompanyEvent(`scenario:${sc.id}`, 'milestones', `${sc.name} won`, sc.goal || 'Scenario completed.');
    } else if (dayStart && sc.deadline && s.day >= sc.deadline) {
      s.over = { type: 'failed' };
    }
    if (s.over) this.emit('over', s.over);
  },
};
