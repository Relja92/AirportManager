// Live disruption cases, response previews and temporary fleet assignments.
import { AIRCRAFT } from './data/catalog.js';
import { isActive } from './events.js';
import { prepareChange, finishChange } from './changeResults.js';

const DAY = 1440;
const closure = (e) => e.type === 'storm' || (e.type === 'strike' && !e.settled);
const eventKey = (e) => `event:${e.id ?? `${e.type}-${e.airport}-${e.start}`}`;
const repairKey = (p) => `repair:${p.id}:${p.breakdown?.id ?? `legacy-${p.id}`}`;
export const contractDeadline = (c) => (c.due + (c.series ? 0 : 1)) * DAY;
const contractActive = (s, c) => c?.due != null && !c.paid && !c.finished && c.done < c.amount && s.minute < contractDeadline(c);
const contractRoutes = (s, c) => s.routes.filter((r) => r.dest === c.dest && (!c.series || r.hub === c.hub));
const touches = (r, e) => r.hub === e.airport || r.dest === e.airport;
const clone = (g) => Object.assign(Object.create(g), { state: structuredClone(g.state), _cache: new Map(), _cacheKey: '' });
const token = (g) => `${g._rev}:${g.state.minute}`;
const sum = (rows, key) => rows.reduce((n, row) => n + row[key], 0);

function eventRoutes(g, e) {
  return g.state.routes.filter((r) => touches(r, e) && (e.recovery?.routeIds?.includes(r.id)
    || g.planesOn(r.id).length || r.today?.flights || r.yesterday?.flights
    || g.state.planes.some((p) => p.recoveryAssignment?.originalRoute === r.id)));
}

export function liveIncidents(g) {
  const s = g.state, incidents = [];
  for (const e of s.events) if (closure(e) && isActive(e, s.day)) {
    const routes = eventRoutes(g, e);
    if (routes.length) incidents.push({ key: eventKey(e), kind: e.type, event: e, routeIds: routes.map((r) => r.id),
      until: (e.start + e.days) * DAY, title: `${e.type === 'storm' ? 'Storm' : 'Strike'} at ${e.airport}`, compensated: !!e.recovery?.compensated });
  }
  for (const p of s.planes) if (p.phase === 'repair' && g.route(p.routeId)) incidents.push({ key: repairKey(p), kind: 'repair', plane: p,
    routeIds: [p.routeId], until: s.minute + Math.max(0, 720 - p.t), title: `${p.name} in repair`, compensated: !!p.breakdown?.compensated });
  return incidents;
}

function returnDue(g, cover) {
  if (cover.kind === 'contract') {
    const c = g.state.contracts.find((c) => c.id === cover.id);
    return !contractActive(g.state, c) || (c.series?.week || 0) !== cover.week;
  }
  const active = new Set(liveIncidents(g).map((i) => i.key));
  return !cover.incidentKeys.some((key) => active.has(key));
}

function returnProblem(g, p) {
  const cover = p.recoveryAssignment;
  if (!['home', 'idle'].includes(p.phase)) return 'Waiting for the current trip or repair to finish';
  if (g.closed(p.hub) || g.closed(cover.originalHub)) return 'Waiting for both home airports to reopen';
  const hub = g.hub(cover.originalHub);
  if (!hub) return 'The original hub is no longer available';
  if (p.hub !== hub.id && g.planesAt(hub.id).length >= g.planeCap(hub)) return `No free gate at ${hub.id}`;
  const route = g.route(cover.originalRoute);
  if (route && (g.closed(route.hub) || g.closed(route.dest))) return 'The original route is now closed';
  if (route && g.whyNotMove(p.id, route.id)) return g.whyNotMove(p.id, route.id);
  return null;
}

// Estimates split at reopenings, repair completions and lease expiries. They do
// not run the simulation, pay contracts, consume randomness, or mutate bookings.
function modelAt(g, minute, ignore = false) {
  const model = clone(g), elapsed = minute - g.state.minute;
  model.state.minute = minute; model.state.day = Math.floor(minute / DAY);
  if (ignore) model.state.events = model.state.events.filter((e) => !closure(e));
  model.state.planes = model.state.planes.filter((p) => !p.lease || p.lease.end > minute);
  for (const p of model.state.planes) {
    if (p.phase === 'repair') {
      if (ignore || p.t + elapsed >= 720) { p.phase = 'home'; p.t = 0; }
      else p.t += elapsed;
    }
    if(p.conversion && minute>=p.conversion.until){p.type=p.conversion.type;delete p.conversion;p.phase=p.routeId==null?'idle':'home';}
    const cover = p.recoveryAssignment;
    if (cover && !p.conversion && minute >= cover.until) {
      if (p.phase !== 'repair') p.phase = 'home';
      if (!returnProblem(model, p)) {
        p.hub = cover.originalHub; p.routeId = model.route(cover.originalRoute)?.id ?? null;
        p.phase = p.routeId == null ? 'idle' : 'home'; delete p.recoveryAssignment;
      }
    }
  }
  for(const h of model.state.hubs)for(const p of h.projects || [])if(p.status==='building'){
    p.worked+=elapsed;if(p.worked>=p.durations[p.stage]){p.worked=p.durations[p.stage];p.status=p.stage===2?'complete':'awaiting';if(p.stage<2){p.stage++;p.worked=0;}}
  }
  return model;
}

export function disruptionForecast(g, routeIds, minutes = DAY, { ignore = false, trackedPlanes = [] } = {}) {
  const start = g.state.minute, end = start + Math.max(0, minutes), points = new Set([start, end]);
  const add = (n) => { if (n > start && n < end) points.add(n); };
  for (const e of g.state.events) { add(e.start * DAY); add((e.start + e.days) * DAY); }
  for(const h of g.state.hubs)for(const p of h.projects || [])if(p.status==='building')add(start+p.durations[p.stage]-p.worked);
  for (const p of g.state.planes) {
    if (p.phase === 'repair') add(start + Math.max(0, 720 - p.t));
    if (p.lease) add(p.lease.end);
    if (p.conversion) add(p.conversion.until);
    if (p.recoveryAssignment) add(p.recoveryAssignment.until);
  }
  const boundaries = [...points].sort((a, b) => a - b), result = { revenue: 0, profit: 0, passengers: 0, cargo: 0 };
  for (let i = 0; i < boundaries.length - 1; i++) {
    const model = modelAt(g, (boundaries[i] + boundaries[i + 1]) / 2, ignore), portion = (boundaries[i + 1] - boundaries[i]) / DAY;
    for (const id of [...new Set(routeIds)]) {
      const r = model.route(id); if (!r) continue;
      const assigned = model.planesOn(id), flying = assigned.filter((p) => !['repair','conversion'].includes(p.phase) && !p.lease?.returning);
      result.profit -= assigned.reduce((n, p) => n + model.planeUpkeep(p), 0) * portion;
      if (model.closed(r.hub) || model.closed(r.dest)) continue;
      for (const p of flying) {
        const type = AIRCRAFT[p.type], q = model.typeProfit({...r,forecastTypes:flying.map(p=>AIRCRAFT[p.type])}, type, flying.length), seats = model.seatsFor(type, r.cabin);
        const operating = q.profit + type.price * .008;
        result.profit += operating * portion;
        result.revenue += (operating + model.flightCost(type, r.km, model.hub(r.hub)) * q.flights) * portion;
        result.passengers += q.flights * q.load * (seats.eco + seats.biz) * portion;
        result.cargo += (type.freighter?q.onTimeTonnes/2:q.flights * model.cargoUnits(type, model.hub(r.hub))) * portion;
      }
    }
    for (const id of trackedPlanes) {
      const p = model.plane(id);
      if (p && p.routeId == null) result.profit -= model.planeUpkeep(p) * portion;
    }
  }
  return result;
}

export function contractOutlook(g, c) {
  const remaining = Math.max(0, c.amount - c.done), minutes = Math.max(0, contractDeadline(c) - g.state.minute);
  const routes = contractRoutes(g.state, c), forecast = disruptionForecast(g, routes.map((r) => r.id), minutes);
  const projected = forecast[c.kind === 'cargo' ? 'cargo' : 'passengers'];
  return { id: c.id, contract: c, remaining, minutes, routeIds: routes.map((r) => r.id),
    projected: Math.min(remaining, projected), shortfall: Math.max(0, remaining - projected), deadline: contractDeadline(c) };
}

export function responseContext(g, target) {
  const s = g.state;
  if (target.kind === 'return') {
    const plane = g.plane(target.id);
    return plane?.recoveryAssignment ? { target, plane, title: `${plane.name} · temporary assignment`, routeIds: [plane.routeId].filter(Boolean), until: plane.recoveryAssignment.until, incidents: [] } : null;
  }
  if (target.kind === 'contract') {
    const c = s.contracts.find((c) => c.id === target.id);
    if (!contractActive(s, c)) return null;
    const outlook = contractOutlook(g, c);
    return { target, title: `Protect contract to ${c.dest}`, contract: c, outlook, routeIds: outlook.routeIds, until: outlook.deadline,
      incidents: liveIncidents(g).filter((i) => i.routeIds.some((id) => outlook.routeIds.includes(id))) };
  }
  const route = g.route(target.id);
  if (!route || target.kind !== 'route') return null;
  const incidents = liveIncidents(g).filter((i) => i.routeIds.includes(route.id));
  if (!incidents.length) return null;
  return { target, route, title: `${route.hub} ⇄ ${route.dest} · disruption response`, routeIds: [route.id], incidents,
    until: Math.max(...incidents.map((i) => i.until)), closed: incidents.some((i) => i.kind !== 'repair') };
}

export function responseCases(g, hub = 'all') {
  const incidents = liveIncidents(g), routeIds = new Set(incidents.flatMap((i) => i.routeIds));
  const routes = g.state.routes.filter((r) => routeIds.has(r.id) && (hub === 'all' || r.hub === hub));
  const contracts = g.state.contracts.filter((c) => contractActive(g.state, c) && c.due <= g.state.day + 3 && (hub === 'all' || c.hub === hub));
  const returns = g.state.planes.filter((p) => p.recoveryAssignment && (hub === 'all' || p.hub === hub || p.recoveryAssignment.originalHub === hub));
  return { routes, contracts, returns, count: routes.length + contracts.length + returns.length };
}

export function responseTargets(g, ctx) {
  const routes = ctx.closed ? g.state.routes.filter((r) => r.id !== ctx.route.id) : g.state.routes.filter((r) => ctx.routeIds.includes(r.id));
  return routes.filter((r) => !g.closed(r.hub) && !g.closed(r.dest)).sort((a, b) => {
    const urgent = (r) => g.state.contracts.some((c) => contractActive(g.state, c) && c.due <= g.state.day + 3 && contractRoutes(g.state, c).some((x) => x.id === r.id));
    return Number(urgent(b)) - Number(urgent(a)) || a.id - b.id;
  });
}

export function responseAircraft(g, ctx, routeId) {
  const route = g.route(routeId); if (!route) return [];
  return g.state.planes.filter((p) => ['home', 'idle'].includes(p.phase) && !p.lease?.returning && (!p.lease || p.lease.end > g.state.minute)
    && !p.recoveryAssignment && !g.closed(p.hub) && p.routeId !== routeId && (!ctx.closed || p.routeId === ctx.route.id)
    && !g.whyNotMove(p.id, routeId)).sort((a, b) => Number(a.routeId != null) - Number(b.routeId != null) || a.id - b.id);
}

function coverFor(g, ctx, p) {
  return { originalHub: p.hub, originalRoute: p.routeId, kind: ctx.target.kind, id: ctx.target.id, week: ctx.contract?.series?.week || 0,
    incidentKeys: ctx.incidents.map((i) => i.key), until: ctx.until, started: g.state.minute };
}

export function responseQuote(g, target, action) {
  const ctx = responseContext(g, target);
  if (!ctx) return { why: 'This problem is resolved or no longer available' };
  const model = clone(g), minutes = ctx.target.kind === 'return' ? DAY : Math.max(1, Math.min(DAY, ctx.until - g.state.minute));
  const routeIds = new Set(ctx.routeIds), trackedPlanes = [], notes = [];
  let why = null, cost = 0, lease = null, title = '', repRestore = 0, repSavedDaily = 0, incident;
  if (action.kind === 'move') {
    const r = g.route(action.routeId), p = g.plane(action.planeId);
    if (!responseTargets(g, ctx).some((x) => x.id === r?.id) || !responseAircraft(g, ctx, r?.id).some((x) => x.id === p?.id)) why = 'Choose a compatible aircraft waiting at an open home airport';
    if (!why) {
      title = `Temporarily assign ${p.name}`; routeIds.add(r.id); if (p.routeId != null) routeIds.add(p.routeId); trackedPlanes.push(p.id);
      const next = model.plane(p.id); next.recoveryAssignment = coverFor(g, ctx, p); next.hub = r.hub; next.routeId = r.id; next.phase = 'home'; next.t = 0;
      notes.push(`Returns to ${p.routeId == null ? `parking at ${p.hub}` : `${p.hub} ⇄ ${g.route(p.routeId)?.dest}`} after ${ctx.contract ? 'this contract target is reached or its deadline passes' : 'the current disruption ends'}, once its current trip is finished. A later assignment change cancels the planned return.`);
      if (p.routeId != null) notes.push(`${g.route(p.routeId).hub} ⇄ ${g.route(p.routeId).dest} loses this aircraft while it is away.`);
    }
  } else if (action.kind === 'lease') {
    const r = g.route(action.routeId);
    if (ctx.closed || !responseTargets(g, ctx).some((x) => x.id === r?.id)) why = 'Lease cover needs an open route';
    else {
      lease = g.leaseQuote(action.typeId, r.hub, 7, r.id); why = lease.why; cost = lease.fee || 0; title = `Lease ${lease.type?.name || 'aircraft'} for 7 days`;
      if (!why) {
        routeIds.add(r.id);
        model.state.planes.push({ id: -1, hub: r.hub, routeId: r.id, type: action.typeId, age: 0, phase: 'home', t: 0,
          lease: { daily: lease.daily, end: g.state.minute + 7 * DAY } });
        notes.push('The full 7-day rent is committed even if repairs finish sooner. The lease stays assigned until expiry; use its return controls to settle rent and return it earlier.');
      }
    }
  } else if (action.kind === 'service') {
    const r = g.route(action.routeId);
    if (ctx.closed || !responseTargets(g, ctx).some((x) => x.id === r?.id)) why = 'Choose an open route for more frequent service';
    else if (r.service === 'frequent') why = 'This route already uses Frequent service';
    else { title = 'Switch to Frequent service'; model.route(r.id).service = 'frequent'; routeIds.add(r.id); notes.push('Applies to future departures without interrupting flights. This service policy stays in place until you change it.'); }
  } else if (action.kind === 'compensate' || action.kind === 'settle') {
    incident = ctx.incidents.find((i) => i.key === action.incidentKey);
    if (!incident) why = 'This incident has ended';
    else if (action.kind === 'settle') {
      if (incident.kind !== 'strike') why = 'Only a strike can be settled';
      else {
        title = `Settle strike at ${incident.event.airport}`; cost = g.settleCost(incident.event);
        model.state.events.find((e) => eventKey(e) === incident.key).settled = true;
        incident.routeIds.forEach((id) => routeIds.add(id)); notes.push('Reopens this airport for every affected route. Other closures and repairs still apply.');
      }
    } else {
      title = 'Offer passenger compensation';
      if (incident.compensated) why = 'Compensation has already been paid for this incident';
      if (incident.kind === 'repair') {
        repRestore = (incident.plane.breakdown?.repLoss || 0) * .5;
        if (!repRestore) why ||= 'No recorded reputation loss to recover for this repair';
        model.state.rep = Math.min(100, model.state.rep + repRestore);
        cost = Math.max(2500, Math.ceil(AIRCRAFT[incident.plane.type].seats * 25 / 500) * 500);
        notes.push('Recovers half the reputation lost in this breakdown, once. It does not shorten the repair or alter contract targets.');
      } else {
        const demand = incident.routeIds.reduce((n, id) => n + g.routeDemand(g.route(id)) * 2, 0);
        cost = Math.max(2500, Math.ceil(demand * Math.min(2, Math.max(0, incident.until - g.state.minute) / DAY) * 25 / 1000) * 1000);
        repSavedDaily = g.closureReputationRates().find((x) => x.key === incident.key)?.daily / 2 || 0;
        notes.push('Covers every route affected by this airport closure. Halves its remaining reputation penalty; past losses stay. Flights still wait and contract deadlines stay unchanged.');
      }
    }
  } else if (action.kind === 'keep') {
    if (ctx.target.kind !== 'return' || action.planeId !== ctx.plane?.id) why = 'This temporary assignment is no longer available';
    else { title = 'Keep the current assignment'; if (ctx.plane.recoveryAssignment.originalRoute != null) routeIds.add(ctx.plane.recoveryAssignment.originalRoute); trackedPlanes.push(ctx.plane.id); delete model.plane(action.planeId).recoveryAssignment; notes.push('Cancels the automatic return. The current aircraft assignment, lease terms and repair status stay as they are.'); }
  } else why = 'Choose a response';
  if (why) return { why, ctx, title, cost, lease, action, target };
  const ids = [...routeIds], before = disruptionForecast(g, ids, minutes, { trackedPlanes }), after = disruptionForecast(model, ids, minutes, { trackedPlanes });
  const contracts = g.state.contracts.filter((c) => contractActive(g.state, c) && contractRoutes(g.state, c).some((r) => ids.includes(r.id)))
    .map((c) => ({ before: contractOutlook(g, c), after: contractOutlook(model, model.state.contracts.find((x) => x.id === c.id)) }));
  const routes = ids.map((id) => ({ route: g.route(id), before: disruptionForecast(g, [id], minutes), after: disruptionForecast(model, [id], minutes),
    countBefore: g.planesOn(id).length, countAfter: model.planesOn(id).length }));
  return { why: cost > g.state.money ? 'Not enough cash for this response' : null, ctx, title, action, target, incident, lease, cost, remaining: g.state.money - cost, minutes, before, after, contracts,
    repRestore, repSavedDaily, notes, routes, routeIds: ids, trackedPlanes, snapshot: token(g), gain: after.profit - before.profit - cost };
}

export const disruptionActions = {
  migrateDisruptions() {
    this.state.nextBreakdownId ??= 0; this.state.today.recovery ??= 0;
    for (const p of this.state.planes) if (p.phase === 'repair' && !p.breakdown) p.breakdown = { id: `legacy-${p.id}`, repLoss: 0 };
  },
  recordBreakdown(p, repLoss) { p.breakdown = { id: ++this.state.nextBreakdownId, started: this.state.minute, repLoss, compensated: false }; this._rev++; },
  closureReputationRates() {
    const rows = liveIncidents(this).filter((i) => i.kind !== 'repair').map((i) => ({ ...i, base: i.kind === 'strike' ? 4 : 1 }));
    const scale = Math.max(1, sum(rows, 'base') / 4);
    return rows.map((i) => ({ ...i, daily: i.base / scale * (i.compensated ? .5 : 1) }));
  },
  stepDisruptions(dt) {
    const s = this.state;
    for (const row of this.closureReputationRates()) {
      const e = row.event, recovery = e.recovery ||= { routeIds: row.routeIds, chargedThrough: s.minute - dt, repLoss: 0 };
      const start = Math.max(s.minute - dt, recovery.chargedThrough ?? s.minute - dt, e.start * DAY);
      const minutes = Math.max(0, Math.min(s.minute, (e.start + e.days) * DAY) - start);
      recovery.chargedThrough = Math.max(recovery.chargedThrough || 0, s.minute);
      const before = s.rep; this.bumpRep(-row.daily * minutes / DAY); recovery.repLoss = (recovery.repLoss || 0) + before - s.rep;
    }
    for (const p of [...s.planes]) {
      const cover = p.recoveryAssignment;
      if (!cover || (p.lease && p.lease.end <= s.minute) || !returnDue(this, cover)) continue;
      const why = returnProblem(this, p);
      if (why) {
        if (cover.pending !== why) {
          cover.pending = why;
          if (['home', 'idle'].includes(p.phase)) this.emit('toast', { text: `${p.name}: temporary assignment finished. ${why}`, kind: 'bad', target: { kind: 'plane', id: p.id } });
        }
        continue;
      }
      p.hub = cover.originalHub; const route = this.route(cover.originalRoute); delete p.recoveryAssignment;
      this.assign(p.id, route?.id ?? null, true);
      this.emit('toast', { text: `${p.name} returned ${route ? `to ${route.hub}–${route.dest}` : `to parking at ${p.hub}`} after temporary cover`, kind: 'good', target: { kind: 'plane', id: p.id } });
    }
  },
  applyResponse(target, action, snapshot) {
    const q = responseQuote(this, target, action);
    if (q.why) return q.why;
    if (snapshot !== token(this)) return 'Conditions changed. Review the refreshed response before applying.';
    const s = this.state, change = prepareChange(this, { kind: 'recovery', title: q.title, routeIds: q.routeIds, planeIds: q.trackedPlanes, cost: q.cost,
      estimatedBefore: disruptionForecast(this, q.routeIds, DAY, {trackedPlanes:q.trackedPlanes}).profit });
    for (const i of q.ctx.incidents) if (i.kind !== 'repair') i.event.recovery ||= { routeIds: i.routeIds, chargedThrough: s.minute, repLoss: 0 };
    s.money -= q.cost; s.today.cost += q.cost;
    if (action.kind === 'lease') {
      s.today.leases = (s.today.leases || 0) + q.cost;
      const p = this.createPlane(action.typeId, false, q.lease.hubId); this.attachLease(p, q.lease); this.assign(p.id, action.routeId, true); change.planeIds.push(p.id);
    } else {
      s.today.recovery = (s.today.recovery || 0) + q.cost;
      if (action.kind === 'move') {
        const p = this.plane(action.planeId), cover = coverFor(this, q.ctx, p), r = this.route(action.routeId);
        p.hub = r.hub; this.assign(p.id, r.id, true); p.recoveryAssignment = cover;
      } else if (action.kind === 'service') this.route(action.routeId).service = 'frequent';
      else if (action.kind === 'settle') q.incident.event.settled = true;
      else if (action.kind === 'keep') delete this.plane(action.planeId).recoveryAssignment;
      else if (q.incident.kind === 'repair') { q.incident.plane.breakdown.compensated = true; this.bumpRep(q.repRestore); }
      else {
        const e = q.incident.event;
        e.recovery ||= { routeIds: q.incident.routeIds, repLoss: 0, chargedThrough: s.minute };
        e.recovery.compensated = true;
      }
    }
    this._rev++;
    finishChange(this, change, disruptionForecast(this, q.routeIds, DAY, {trackedPlanes:change.planeIds}).profit);
    this.emit('toast', { text: `${q.title} applied`, kind: 'good', target: q.ctx.contract ? { kind: 'contract', id: q.ctx.contract.id } : { kind: 'route', id: q.routeIds[0] } });
    this.changed(); return null;
  },
};
