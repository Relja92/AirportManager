// Service policies, temporary aircraft and relationships with repeat customers.
import { AIRCRAFT } from './data/catalog.js';
import { prepareChange, finishChange } from './changeResults.js';

const DAY = 1440;
export const SERVICES = {
  economy: { name: 'Economy', fill: 0.8, wait: 360, demand: 0.95, description: 'Wait for 80% full, up to 6 hours after turnaround. Fewer departures; less attractive to business and connecting travelers.' },
  balanced: { name: 'Balanced', fill: 0.5, wait: 240, demand: 1, description: 'Leave at 50% full, or after 4 hours. A steady balance of frequency and aircraft utilization.' },
  frequent: { name: 'Frequent', fill: 0.2, wait: 60, demand: 1.08, description: 'Leave at 20% full, or after 1 hour. Attract more business and connecting travelers, with more flying costs.' },
};
export const serviceOf = (route) => SERVICES[route.service] || SERVICES.balanced;
export const LEASE_TERMS = [{ days: 7, rate: 0.014 }, { days: 14, rate: 0.012 }, { days: 30, rate: 0.01 }];
export const CLIENTS = [
  { id: 'horizon', name: 'Horizon Tours', kind: 'pax', what: 'holiday guests' },
  { id: 'clubaway', name: 'Club Away Travel', kind: 'pax', what: 'football fans' },
  { id: 'summit', name: 'Summit Events', kind: 'pax', what: 'conference delegates' },
  { id: 'freshlink', name: 'FreshLink Foods', kind: 'cargo', what: 'fresh produce' },
  { id: 'medair', name: 'MedAir Logistics', kind: 'cargo', what: 'medical supplies' },
  { id: 'tradebridge', name: 'TradeBridge Freight', kind: 'cargo', what: 'electronics' },
];
export const clientOf = (c) => CLIENTS.find((x) => x.id === c.clientId);
export const leaseDaysLeft = (s, p) => p.lease ? Math.max(0, Math.ceil((p.lease.end - s.minute) / DAY)) : null;

export function migrateCommercial(s) {
  s.clients ??= {};
  for (const r of s.routes) if (!SERVICES[r.service]) r.service = 'balanced';
  for (const c of s.contracts) if (!clientOf(c)) {
    const pool = CLIENTS.filter((x) => x.kind === c.kind);
    c.clientId = pool[(c.id || 0) % pool.length].id;
  }
  s.today.leases ??= 0;
}

export const commercialActions = {
  serviceQuote(routeId, service) {
    const r = this.route(routeId);
    if (!r || !SERVICES[service]) return { why: 'Choose an existing route and service policy' };
    const planes = this.planesOn(routeId);
    const summarize = (route) => ({ demand: this.routeDemand(route) * 2, segments: this.routeFactors(route).segments,
      profit: planes.reduce((n, p) => n + this.typeProfit(route, AIRCRAFT[p.type], planes.length).profit - this.planeUpkeep(p) + AIRCRAFT[p.type].price * 0.008, 0),
      flights: planes.reduce((n, p) => n + this.plannedLegs(route, AIRCRAFT[p.type], planes.length), 0) });
    return { why: null, route: r, before: summarize(r), after: summarize({ ...r, service }), service };
  },
  setService(routeId, service) {
    const q = this.serviceQuote(routeId, service);
    if (q.why) return q.why;
    if ((q.route.service || 'balanced') === service) return null;
    const change = prepareChange(this, { kind: 'service', title: `${q.route.hub} ⇄ ${q.route.dest} · ${SERVICES[service].name} service`, routeIds: [routeId] });
    q.route.service = service;
    finishChange(this, change, q.after.profit); this.changed(); return null;
  },

  leaseQuote(typeId, hubId, days = 14, routeId = null) {
    const type = AIRCRAFT[typeId], hub = this.hub(hubId), term = LEASE_TERMS.find((t) => t.days === +days);
    if (!type || !hub || !term) return { why: 'Choose an aircraft, hub and lease term' };
    const fee = Math.round(type.price * 0.03), daily = Math.round(type.price * term.rate);
    let why = type.cls > hub.levels.runway ? `Needs runway level ${type.cls} at ${hubId}` : null;
    if(type.freighter && hub.levels.cargo<1)why ||= 'Build a cargo terminal at this hub first';
    if (this.planesAt(hubId).length >= this.planeCap(hub)) why ||= `No free gate at ${hubId}`;
    const route = routeId != null ? this.route(routeId) : null;
    if (routeId != null && (!route || route.hub !== hubId || route.km > type.range)) why ||= 'Choose a compatible route at this hub';
    if (this.state.money < fee) why ||= 'Not enough cash for the setup fee';
    return { why, type, hubId, days: term.days, route, fee, daily, rent: daily * term.days,
      commitment: fee + daily * term.days, end: this.state.minute + term.days * DAY, remaining: this.state.money - fee };
  },
  attachLease(p, q) {
    p.lease = { days: q.days, daily: q.daily, start: this.state.minute, end: q.end, billedUntil: this.state.minute };
    p.leaseRentToday = 0;
  },
  leasePlane(typeId, hubId, days = 14, routeId = null) {
    const q = this.leaseQuote(typeId, hubId, days, routeId);
    if (q.why) return q.why;
    const change = prepareChange(this, { kind: 'lease', title: `Leased ${q.type.name} for ${q.days} days`, routeIds: q.route ? [q.route.id] : [], cost: q.fee });
    this.state.money -= q.fee; this.state.today.cost += q.fee; this.state.today.leases = (this.state.today.leases || 0) + q.fee;
    const p = this.createPlane(typeId, false, hubId); this.attachLease(p, q);
    if (q.route) this.assign(p.id, q.route.id, true);
    change.planeIds.push(p.id); finishChange(this, change);
    this.emit('toast', { text: `${p.name} leased for ${q.days} days; daily rent ${q.daily.toLocaleString()} dollars`, kind: 'good', target: { kind: 'plane', id: p.id } });
    this.changed(); return null;
  },
  leaseCommitment() { return this.state.planes.reduce((n, p) => n + (p.lease ? Math.max(0, p.lease.end - this.state.minute) / DAY * p.lease.daily : 0), 0); },
  leaseActionQuote(id, action) {
    const p = this.plane(id);
    if (!p?.lease) return { why: 'This aircraft is not leased' };
    if (!['extend', 'return'].includes(action)) return { why: 'Choose extend or return' };
    const cost = action === 'return' ? Math.ceil(Math.max(0, p.lease.end - this.state.minute) / DAY * p.lease.daily) : 0;
    const why = (action==='return' && this.connectionFlightWhy(p)) || (action === 'extend' && p.lease.end <= this.state.minute ? 'The lease has expired' : cost > this.state.money ? 'Not enough cash to settle the remaining rent' : null);
    return { why, plane: p, cost, end: p.lease.end + (action === 'extend' ? p.lease.days * DAY : 0),
      extraRent: action === 'extend' ? p.lease.daily * p.lease.days : 0, remaining: this.state.money - cost };
  },
  leaseAction(id, action) {
    const q = this.leaseActionQuote(id, action); if (q.why) return q.why;
    const p = q.plane;
    if (action === 'extend') {
      p.lease.end = q.end; p.lease.warned = false;
      this.emit('toast', { text: `${p.name}: lease extended by ${p.lease.days} days`, kind: 'good', target: { kind: 'plane', id } });
    } else {
      this.state.money -= q.cost; this.state.today.cost += q.cost; this.state.today.leases = (this.state.today.leases || 0) + q.cost;
      this.finishLease(p);
    }
    this.changed(); return null;
  },
  finishLease(p) {
    const route = this.route(p.routeId);
    this.state.planes = this.state.planes.filter((x) => x.id !== p.id);
    this.emit('toast', { text: `${p.name} returned to the lessor${route ? `. Review aircraft on ${route.hub}–${route.dest}` : ''}`, kind: 'bad',
      target: route ? { kind: 'route', id: route.id } : { kind: 'page', id: 'finance' } });
    this._rev++;
  },
  stepLease(p) {
    const l = p.lease; if (!l) return true;
    const until = Math.min(this.state.minute, l.end);
    const charge = Math.max(0, until - l.billedUntil) / DAY * l.daily;
    l.billedUntil = Math.max(l.billedUntil, until);
    this.state.money -= charge; this.state.today.cost += charge; this.state.today.leases = (this.state.today.leases || 0) + charge;
    p.leaseRentToday = (p.leaseRentToday || 0) + charge;
    const r = this.route(p.routeId); if (r) r.today.cost += charge;
    if (!l.warned && l.end - this.state.minute <= 3 * DAY) {
      l.warned = true;
      this.emit('toast', { text: `${p.name}: lease ends within ${leaseDaysLeft(this.state, p)} days. Extend it or arrange a replacement`, kind: 'bad', target: { kind: 'plane', id: p.id } });
    }
    if (this.state.minute < l.end) return true;
    if (['out', 'back'].includes(p.phase)) { l.returning = true; return true; }
    this.finishLease(p); return false;
  },

  clientRecord(id) { return this.state.clients?.[id] || { completed: 0, missed: 0, trust: 0 }; },
  recordClient(c, success) {
    if (!clientOf(c)) return;
    this.state.clients ||= {};
    const record = this.state.clients[c.clientId] ||= { completed: 0, missed: 0, trust: 0 };
    record.trust = Math.max(0, Math.min(5, record.trust + (success ? 1 : -2)));
    if (success) {
      record.completed++;
      if (!c.series) record.lastJob = { hub: c.hub, dest: c.dest, kind: c.kind, what: c.what, amount: c.amount, days: c.days, reward: c.reward };
      record.available = this.state.day + (c.series ? 7 : 0);
    } else { record.missed++; record.available = this.state.day + 7; }
  },
  repeatQuote(clientId) {
    const client = CLIENTS.find((c) => c.id === clientId), record = this.clientRecord(clientId), job = record.lastJob;
    if (!client || !job) return { why: 'Complete a first job for this client to unlock repeat work' };
    let why = record.trust < 1 ? 'Complete another one-off job to rebuild this client’s trust' : null;
    if ((record.available || 0) > this.state.day) why ||= `New work available in ${record.available - this.state.day} days`;
    if (this.state.contracts.some((c) => c.clientId === clientId && c.due != null)) why ||= 'Finish this client’s current agreement first';
    if (this.state.contracts.filter((c) => c.due != null).length >= 3) why ||= 'You can run 3 contracts at a time';
    if (!this.hub(job.hub)) why ||= 'The original hub is no longer available';
    const amount = job.kind === 'pax' ? Math.max(100, Math.round(job.amount / job.days * 7 / 50) * 50) : Math.max(5, Math.round(job.amount / job.days * 7));
    const reward = Math.max(20000, Math.round(job.reward / job.days * 7 * 1.1 / 1000) * 1000);
    return { why, client, ...job, amount, reward, days: 7, weeks: 3, total: reward * 3 };
  },
  acceptRepeat(clientId) {
    const q = this.repeatQuote(clientId); if (q.why) return q.why;
    const s = this.state;
    // A declined/unused one-off offer from this client is superseded by the agreement.
    s.contracts = s.contracts.filter((c) => c.clientId !== clientId || c.due != null);
    const c = { id: s.nextId++, clientId, kind: q.kind, hub: q.hub, dest: q.dest, what: q.what,
      amount: q.amount, done: 0, days: 7, reward: q.reward, due: s.day + 7, series: { week: 1, weeks: 3 }, paid: false };
    s.contracts.push(c);
    this.emit('toast', { text: `${q.client.name}: signed a three-week agreement for ${q.hub}–${q.dest}`, kind: 'good', target: { kind: 'contract', id: c.id } });
    this.changed(); return null;
  },
};
