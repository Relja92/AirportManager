// Hub identities. Benefits are conditional; upkeep and trade-offs remain in force.
import { AIRPORT_BY_ID } from './data/airports.js';
import { AIRCRAFT, rankFor } from './data/catalog.js';
import { prepareChange, finishChange } from './changeResults.js';

export const SPECIALIZATION_DAYS = 14;
export const SPECIALIZATIONS = {
  general: { name: 'General purpose', fee: 100000, upkeep: 1, handling: 1,
    summary: 'Flexible routes and cabins, with standard costs and demand.',
    benefits: 'No specialization restrictions or demand penalties.', tradeoff: 'No specialist bonuses.' },
  budget: { name: 'Budget', fee: 200000, upkeep: .85, handling: .8,
    summary: 'Keep fares low and aircraft simple.',
    benefits: '15% less airport upkeep and 20% lower flight handling fees. All-economy routes at 90% fare or less attract 12% more regular demand.',
    tradeoff: 'Other routes lose 15% of regular demand. 40% of business travelers consider business seats, compared with 70% normally. Fuel, maintenance and lease rent are unchanged.' },
  premium: { name: 'Premium', fee: 500000, upkeep: 1.3, handling: 1.15,
    summary: 'Build around business cabins and dependable service.',
    benefits: '90% of business travelers consider business seats, compared with 70% normally; business tickets earn 20% more. Mixed or Premium cabins on Balanced or Frequent service attract 8% more regular demand.',
    tradeoff: 'Other routes lose 12% of regular demand. Airport upkeep rises 30% and flight handling fees rise 15%.' },
  transfer: { name: 'Transfer', fee: 400000, upkeep: 1.2, handling: 1,
    summary: 'Bring several busy routes together at one hub.',
    benefits: 'Up to 60% more connecting demand and 20 minutes less transfer time, down to 30 minutes. Frequent service gives the strongest benefit. Both legs need available aircraft and practical routing; shared seat capacity still limits bookings.',
    tradeoff: '5% less regular demand before connections, and 20% more airport upkeep. Empty routes, repairs and closures weaken the extra transfer benefit.' },
  cargo: { name: 'Cargo', fee: 350000, upkeep: 1.15, handling: 1,
    summary: 'Make freight a larger part of the business.',
    benefits: '20% more freight loaded, capped at hold capacity, and 100% higher freight rates. More new cargo work is directed to cargo hubs.',
    tradeoff: '10% less regular passenger demand and 15% more airport upkeep. Existing contract targets and payouts stay as signed.' },
};
export const specializationOf = (hub) => SPECIALIZATIONS[hub?.specialization] || SPECIALIZATIONS.general;
export const serviceWeight = (service) => ({ frequent: 1, balanced: .65, economy: .25 })[service || 'balanced'] ?? .65;

export function specializationDemandFor(hub, price, cabin, service) {
  if (hub.specialization === 'budget') return price <= .9 && !cabin ? 1.12 : .85;
  if (hub.specialization === 'premium') return cabin > 0 && service !== 'economy' ? 1.08 : .88;
  return hub.specialization === 'transfer' ? .95 : hub.specialization === 'cargo' ? .9 : 1;
}

export function specializationRequirementsFor(levels, id, staffedRoutes = 0) {
  if (!SPECIALIZATIONS[id] || id === 'general') return [];
  const requirements = [{ label: 'Upgrade levels · Regional rank', value: rankFor(levels).total, target: 6 }];
  const level = (key, target, label) => requirements.push({ label, value: levels[key] || 0, target });
  level('terminal', id === 'transfer' ? 3 : 2, 'Terminal level');
  if (id === 'budget' || id === 'transfer') level('gates', 2, 'Gates level');
  if (id === 'premium') { level('runway', 2, 'Runway level'); level('amenities', 2, 'Shops & lounges level'); }
  if (id === 'cargo') level('cargo', 2, 'Cargo terminal level');
  if (id === 'transfer') requirements.push({ label: 'Routes with aircraft', target: 3, value: staffedRoutes });
  return requirements.map((r) => ({ ...r, met: r.value >= r.target }));
}

export function migrateSpecializations(s) {
  for (const h of s.hubs) {
    if (!SPECIALIZATIONS[h.specialization]) h.specialization = 'general';
    if (!Number.isFinite(h.specializationUntil)) h.specializationUntil = 0;
  }
  s.today.specialization ??= 0;
  for (const entry of s.managementChanges || []) {
    if (!entry.configuration) continue;
    try {
      const config = JSON.parse(entry.configuration);
      if (!config.hubs) {
        config.hubs = (entry.hubs || []).map((id) => [id, s.hubs.find((h) => h.id === id)?.specialization || 'general']);
        config.overhead = [];
        entry.configuration = JSON.stringify(config);
      }
    } catch { /* A malformed historic comparison does not affect a saved airline. */ }
  }
}

export const specializationActions = {
  specializationRequirements(hubId, id) {
    const h = this.hub(hubId);
    if (!h || !SPECIALIZATIONS[id]) return [];
    return specializationRequirementsFor(h.levels, id, this.routesAt(hubId).filter((r) => this.planesOn(r.id).some((p) => !p.lease?.returning)).length);
  },
  specializationDemand(hub, price, cabin, service) {
    return specializationDemandFor(hub, price, cabin, service);
  },
  specializationConnections(hubId, destId, service) {
    if (this.hub(hubId)?.specialization !== 'transfer' || this.closed(hubId) || this.closed(destId)) return 1;
    const others = this.state.routes.filter((r) => (r.hub === hubId && r.dest !== destId) || (r.dest === hubId && r.hub !== destId));
    const feed = others.reduce((n, r) => n + (!this.closed(r.hub) && !this.closed(r.dest)
      && this.planesOn(r.id).some((p) => p.phase !== 'repair' && !p.lease?.returning) ? serviceWeight(r.service) : 0), 0);
    return 1 + .6 * serviceWeight(service) * feed / Math.max(3, others.length);
  },
  businessMultiplier(hub) { return hub?.specialization === 'premium' ? 3.6 : 3; },
  handlingCost(type, hub) { return type.fee * specializationOf(hub).handling * AIRPORT_BY_ID[hub.id].market.operating; },
  specializationQuote(hubId, id) {
    const hub = this.hub(hubId), profile = SPECIALIZATIONS[id];
    if (!hub || !profile) return { why: 'Choose one of your hubs and a specialization' };
    const current = hub.specialization || 'general', requirements = this.specializationRequirements(hubId, id);
    const remainingDays = Math.max(0, (hub.specializationUntil || 0) - this.state.day);
    const cost = current === id ? 0 : profile.fee;
    let why = current === id ? 'This hub already has this specialization' : null;
    if (remainingDays) why ||= `This hub is committed for ${remainingDays} more days`;
    if (requirements.some((r) => !r.met)) why ||= 'Complete the unlock requirements before converting';
    if (this.state.money < cost) why ||= 'Not enough cash for the conversion fee';
    const model = Object.assign(Object.create(this), { state: { ...this.state,
      hubs: this.state.hubs.map((h) => h.id === hubId ? { ...h, specialization: id } : h) }, _cache: new Map(), _cacheKey: '' });
    const summarize = (g, r) => {
      const planes = g.planesOn(r.id);
      return { demand: g.routeDemand(r) * 2, profit: planes.reduce((n, p) => n + g.typeProfit(r, AIRCRAFT[p.type], planes.length).profit
        - g.planeUpkeep(p) + AIRCRAFT[p.type].price * .008, 0) };
    };
    const routes = this.routesAt(hubId).map((r) => ({ id: r.id, hub: r.hub, dest: r.dest, before: summarize(this, r), after: summarize(model, r) }));
    const parked = this.planesAt(hubId).filter((p) => p.routeId == null).reduce((n, p) => n + this.planeUpkeep(p), 0);
    const beforeUpkeep = this.hubUpkeep(hub), afterUpkeep = model.hubUpkeep(model.hub(hubId));
    const before = routes.reduce((n, r) => n + r.before.profit, 0) - parked - beforeUpkeep;
    const after = routes.reduce((n, r) => n + r.after.profit, 0) - parked - afterUpkeep;
    return { why, hub, profile, current, requirements, remainingDays, cost, remaining: this.state.money - cost,
      until: this.state.day + SPECIALIZATION_DAYS, routes, before, after, gain: after - before, beforeUpkeep, afterUpkeep, revision: this._rev };
  },
  setSpecialization(hubId, id, revision = this._rev) {
    const q = this.specializationQuote(hubId, id);
    if (q.why) return q.why;
    if (revision !== this._rev) return 'Conditions changed. Review the refreshed preview before applying.';
    const change = prepareChange(this, { kind: 'specialization', title: `${hubId} · ${q.profile.name} hub`,
      routeIds: q.routes.map((r) => r.id), planeIds: this.planesAt(hubId).map((p) => p.id), overheadHubIds: [hubId], cost: q.cost, estimatedBefore: q.before });
    this.state.money -= q.cost; this.state.today.cost += q.cost;
    this.state.today.specialization = (this.state.today.specialization || 0) + q.cost;
    q.hub.specialization = id; q.hub.specializationUntil = q.until;
    finishChange(this, change, q.after);
    this.emit('toast', { text: `${hubId} is now a ${q.profile.name.toLowerCase()} hub. Committed for ${SPECIALIZATION_DAYS} days`, kind: 'good', target: { kind: 'airport', id: hubId } });
    this.changed(); return null;
  },
};
