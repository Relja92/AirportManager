import { AIRCRAFT } from './data/catalog.js';
import { prepareChange, finishChange } from './changeResults.js';

export const FLEET_FILTERS = [['all', 'All aircraft'], ['attention', 'Needs attention'], ['leased', 'Leased'], ['leases', 'Lease ending soon'],
  ['freighters','Freighters'], ['conversion','In conversion'], ['returns', 'Return pending'], ['parked', 'Parked'], ['repair', 'In repair'], ['maintenance', 'High maintenance'], ['losing', 'Losing money']];

export function fleetMatches(game, p, filter) {
  const flags = { conversion:!!p.conversion, returns: !!p.recoveryAssignment?.pending, parked: p.routeId == null && !p.conversion, repair: p.phase === 'repair',
    maintenance: p.age >= 150 || game.breakdownRisk(p) > 0.03,
    losing: p.routeId != null && p.yday != null && p.yday < 0 };
  flags.leases = !!p.lease && p.lease.end - game.state.minute <= 3 * 1440;
  return filter === 'freighters' ? !!AIRCRAFT[p.type].freighter : filter === 'leased' ? !!p.lease : filter === 'all' || (filter === 'attention' ? Object.values(flags).some(Boolean) : !!flags[filter]);
}

// Work on copies so a preview cannot spend cash, move aircraft or reset flights.
export function aircraftPlan(game, action) {
  const p = game.plane(action.id), other = game.plane(action.target);
  if (!p) return { why: 'This aircraft is no longer available' };
  const next = { ...p }, nextOther = other && { ...other };
  if (p.lease && ['sell', 'replace', 'type'].includes(action.kind)) return { why: 'Return this lease before selling or replacing the aircraft' };
  if(p.conversion)return {why:'Wait for the cargo conversion to finish.'};
  let why = null, cost = 0;
  switch (action.kind) {
    case 'move': {
      why = game.whyNotMove(p.id, action.target);
      if (p.routeId === action.target) why = 'Already assigned to this route';
      const r = game.route(action.target);
      if (r) { next.hub = r.hub; next.routeId = r.id; }
      break;
    }
    case 'swap':
      why = game.whyNotSwap(p.id, action.target);
      if (!why && p.hub === other.hub && p.routeId === other.routeId) why = 'Both aircraft already have the same assignment';
      if (!why) { next.hub = other.hub; next.routeId = other.routeId; nextOther.hub = p.hub; nextOther.routeId = p.routeId; }
      break;
    case 'park': next.routeId = null; if (p.routeId == null) why = 'Already parked'; break;
    case 'type':
      why = game.whyNotChangeType(p.id, action.target);
      if (!why) { cost = game.changeTypeCost(p, action.target); next.type = action.target; next.age = 0; }
      break;
    case 'replace': cost = game.replaceCost(p); next.age = 0; if (p.age < 20) why = 'This aircraft is still new'; break;
    case 'overhaul': cost = game.overhaulCost(p); next.age *= 0.4; if (p.age < 20) why = 'This aircraft is still new'; break;
    case 'sell': cost = -game.planeValue(p); break;
    default: why = 'Unknown aircraft action';
  }
  const reassignment = ['move', 'swap', 'park'].includes(action.kind);
  if (['move','swap','park','type','sell'].includes(action.kind)) why ||= game.connectionFlightWhy(p) || (action.kind==='swap' && game.connectionFlightWhy(other));
  if (reassignment && (p.phase === 'repair' || (action.kind === 'swap' && other?.phase === 'repair'))) why ||= 'Wait for repairs to finish before changing assignments';
  if (cost > game.state.money) why ||= 'Not enough cash';
  if (why) return { why };
  const changes = [{ before: p, after: action.kind === 'sell' ? null : next }];
  if (action.kind === 'swap') changes.push({ before: other, after: nextOther });
  const routeIds = new Set(changes.flatMap((c) => [c.before.routeId, c.after?.routeId]).filter((id) => id != null));
  const future = game.state.planes.flatMap((plane) => {
    const change = changes.find((c) => c.before.id === plane.id);
    return change ? change.after ? [change.after] : [] : [plane];
  });
  const model=Object.assign(Object.create(game),{state:{...game.state,planes:future},_cache:new Map(),_cacheKey:''});
  const affected=new Set(routeIds);
  for (const plan of [game.connectionPlan(),model.connectionPlan()]) for (const pair of plan.pairs) {
    if (affected.has(pair.firstRouteId) || affected.has(pair.secondRouteId)) {routeIds.add(pair.firstRouteId);routeIds.add(pair.secondRouteId);}
  }
  const forecast = (r, planes, g) => {
    const assigned = planes.filter((x) => x.routeId === r.id);
    return assigned.reduce((sum, x) => sum + g.typeProfit(r, AIRCRAFT[x.type], assigned.length).profit
      - (g.planeUpkeep(x) - AIRCRAFT[x.type].price * 0.008), 0);
  };
  const routes = [...routeIds].filter(id=>game.route(id)).map((id) => {
    const r = game.route(id);
    return { route: r, before: forecast(r, game.state.planes,game), after: forecast(r, future,model),
      countBefore: game.planesOn(id).length, countAfter: future.filter((x) => x.routeId === id).length };
  });
  const parkedBefore = changes.reduce((sum, c) => sum + (c.before.routeId == null ? game.planeUpkeep(c.before) : 0), 0);
  const parkedAfter = changes.reduce((sum, c) => sum + (c.after && c.after.routeId == null ? game.planeUpkeep(c.after) : 0), 0);
  const gain = routes.reduce((sum, r) => sum + r.after - r.before, 0) + parkedBefore - parkedAfter;
  const resets = [...changes.map((c) => c.before)].some((x) => ['out', 'back', 'turn'].includes(x.phase))
    && ['move', 'swap', 'park', 'type', 'sell'].includes(action.kind);
  return { why: null, changes, routes, cost, gain, remaining: game.state.money - cost, revision: game._rev,
    warning: [resets ? 'This change interrupts the current trip. Passengers in transit will not complete it.' : '', reassignment && changes.some((c)=>c.before.recoveryAssignment) ? 'This assignment change cancels the aircraft’s planned return from temporary cover.' : ''].filter(Boolean).join(' '),
    repairNote: action.kind === 'overhaul' && p.phase === 'repair' ? 'An overhaul reduces age; the current repair still needs to finish.' : '' };
}

export function applyAircraftPlan(game, action, revision, track = true) {
  const plan = aircraftPlan(game, action);
  if (plan.why) return plan.why;
  if (revision !== game._rev) return 'Conditions changed. Review the refreshed preview before applying.';
  const { id, target } = action;
  const names = { move: 'Moved', swap: 'Swapped', park: 'Parked', type: 'Replaced', replace: 'Replaced', overhaul: 'Maintained', sell: 'Sold' };
  const change = track && prepareChange(game, { kind: action.kind, title: `${names[action.kind]} ${plan.changes.map((c) => c.before.name).join(' and ')}`,
    routeIds: plan.routes.map((r) => r.route.id), planeIds: plan.changes.map((c) => c.before.id), cost: plan.cost });
  let why;
  switch (action.kind) {
    case 'move': why = game.movePlane(id, target); break;
    case 'swap': why = game.swapPlanes(id, target); break;
    case 'park': why = game.assign(id, null); break;
    case 'type': why = game.changeType(id, target); break;
    case 'replace': why = game.replacePlane(id); break;
    case 'overhaul': why = game.overhaul(id); break;
    case 'sell': why = game.sellPlane(id); break;
  }
  if (!why && change) { finishChange(game, change, change.estimatedBefore + plan.gain); if (!game.silent) game.save(); game.emit('change'); }
  return why;
}

export function fleetBatchPlan(game, kind, hub = 'all') {
  // Only the small pieces read by the preview are copied. No simulation or
  // mutation methods run on this model, so previews cannot save or emit events.
  const model = Object.assign(Object.create(game), { state: { ...game.state, planes: game.state.planes.map((p) => ({ ...p })) }, _cache: new Map(), _cacheKey: '' });
  const candidates = model.state.planes.filter((p) => (hub === 'all' || p.hub === hub) && !p.conversion
    && (kind === 'assign' ? p.routeId == null && p.phase !== 'repair' : p.age >= 20 && fleetMatches(model, p, 'maintenance')));
  const actions = [], plans = [];
  for (const p of candidates) {
    let action = { kind: 'overhaul', id: p.id };
    if (kind === 'assign') {
      const score = (r) => (model.planesOn(r.id).length ? 0 : 1e6) + r.poolOut + r.poolIn;
      const r = model.routesAt(p.hub).filter((r) => !model.whyNotMove(p.id, r.id)).sort((a, b) => score(b) - score(a))[0];
      if (!r) continue;
      action = { kind: 'move', id: p.id, target: r.id };
    }
    const plan = aircraftPlan(model, action);
    if (plan.why) return { why: plan.why };
    plans.push(plan); actions.push(action);
    model.state.money -= plan.cost;
    model.state.planes = model.state.planes.map((p) => plan.changes.find((c) => c.before.id === p.id)?.after || p);
  }
  if (!actions.length) return { why: kind === 'assign' ? 'No parked aircraft has a compatible route in this hub selection' : 'No high-maintenance aircraft in this hub selection' };
  const routes = new Map();
  for (const plan of plans) for (const row of plan.routes) {
    const prev = routes.get(row.route.id);
    routes.set(row.route.id, prev ? { ...row, before: prev.before, countBefore: prev.countBefore } : row);
  }
  return { why: null, actions, changes: plans.flatMap((p) => p.changes), routes: [...routes.values()],
    cost: plans.reduce((sum, p) => sum + p.cost, 0), gain: plans.reduce((sum, p) => sum + p.gain, 0), revision: game._rev };
}

export function applyFleetBatch(game, kind, hub, revision) {
  if (revision !== game._rev) return 'Conditions changed. Review the plan again.';
  const plan = fleetBatchPlan(game, kind, hub);
  if (plan.why) return plan.why;
  const change = prepareChange(game, { kind: 'batch', title: `${kind === 'assign' ? 'Assigned' : 'Maintained'} ${plan.actions.length} aircraft`,
    routeIds: plan.routes.map((r) => r.route.id), planeIds: plan.changes.map((c) => c.before.id), cost: plan.cost });
  for (const action of plan.actions) {
    const why = applyAircraftPlan(game, action, game._rev, false);
    if (why) return why;
  }
  finishChange(game, change, change.estimatedBefore + plan.gain); if (!game.silent) game.save(); game.emit('change');
  return null;
}
