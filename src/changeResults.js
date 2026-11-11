import { projectSignature } from './projects.js';
import { AIRCRAFT } from './data/catalog.js';

export const RESULT_DAYS = 3;
const unique = (ids) => [...new Set(ids.filter((id) => id != null))];

export function estimateScope(game, routeIds, planeIds = [], overheadHubIds = []) {
  const routes = unique(routeIds).map((id) => game.route(id)).filter(Boolean);
  return routes.reduce((sum, r) => {
    const on = game.planesOn(r.id);
    return sum + on.reduce((n, p) => n + game.typeProfit(r, AIRCRAFT[p.type], on.length).profit
      - (game.planeUpkeep(p) - AIRCRAFT[p.type].price * .008), 0);
  }, 0) - unique(planeIds).map((id) => game.plane(id)).filter((p) => p && p.routeId == null).reduce((sum, p) => sum + game.planeUpkeep(p), 0)
    - overheadHubIds.reduce((sum, id) => sum + (game.hub(id) ? game.hubUpkeep(game.hub(id)) : 0), 0);
}

function actualScope(game, entry) {
  let total = 0;
  for (const { id } of entry.routes) {
    const r = game.route(id);
    if (!r || !r.yesterday) return null;
    total += game.routeProfit(r);
  }
  for (const id of entry.planeIds) {
    const p = game.plane(id);
    if (p && p.routeId == null) {
      if (p.yday == null) return null;
      total += p.yday;
    }
  }
  for (const id of entry.overheadHubIds || []) {
    const upkeep = game.state.yesterday?.hubUpkeep?.[id];
    if (upkeep == null) return null;
    total -= upkeep;
  }
  return total;
}

function configuration(game, entry) {
  return JSON.stringify({ routes: entry.routes.map(({ id }) => {
    const r = game.route(id);
    return r ? [id, r.price, r.cabin, r.service || 'balanced', r.cargoService || 'bulk', game.planesOn(id).map((p) => [p.id, p.type, p.lease?.daily || 0, p.conversion?.type || null]).sort((a, b) => a[0] - b[0]),
      ...(game.hub(r.dest)?.projects?.length ? [projectSignature(game.hub(r.dest))] : [])] : [id, 'closed'];
  }), planes: entry.planeIds.map((id) => {
    const p = game.plane(id);
    return p ? [id, p.hub, p.routeId, p.type] : [id, 'sold'];
  }), hubs: entry.hubs.map((id) => [id, game.hub(id)?.specialization || 'general', ...(game.hub(id)?.projects?.length?[projectSignature(game.hub(id))]:[])]),
    overhead: (entry.overheadHubIds || []).map((id) => [id, game.hub(id)?.levels,
      game.routesAt(id).map((r) => r.id), game.planesAt(id).map((p) => p.id)]) });
}

export function prepareChange(game, { title, kind, routeIds = [], planeIds = [], overheadHubIds = [], cost = 0, estimatedBefore }) {
  const routes = unique(routeIds).map((id) => game.route(id)).filter(Boolean).map((r) => ({ id: r.id, hub: r.hub, dest: r.dest }));
  const entry = { title, kind, day: game.state.day, minute: game.state.minute, routes, planeIds: unique(planeIds), overheadHubIds, cost,
    hubs: unique([...overheadHubIds, ...routes.map((r) => r.hub), ...planeIds.map((id) => game.plane(id)?.hub)]), samples: [], status: 'watching' };
  entry.beforeActual = actualScope(game, entry);
  entry.estimatedBefore = estimatedBefore ?? estimateScope(game, routes.map((r) => r.id), entry.planeIds, overheadHubIds);
  return entry;
}

export function finishChange(game, draft, estimatedAfter) {
  const s = game.state, history = s.managementChanges ||= [];
  draft.estimatedAfter = estimatedAfter ?? estimateScope(game, draft.routes.map((r) => r.id), draft.planeIds, draft.overheadHubIds);
  draft.hubs = unique([...draft.hubs, ...draft.planeIds.map((id) => game.plane(id)?.hub)]);
  draft.configuration = configuration(game, draft);
  const latest = history[0];
  // A short run of fare-button presses is one decision, with the original baseline.
  if (draft.kind === 'fare' && latest?.kind === 'fare' && latest.status === 'watching' && !latest.samples.length
      && latest.routes[0]?.id === draft.routes[0]?.id && latest.day === draft.day && draft.minute - latest.minute <= 5) {
    Object.assign(latest, { title: draft.title, minute: draft.minute, estimatedAfter: draft.estimatedAfter, configuration: draft.configuration });
    return latest;
  }
  for (const older of history) {
    if (older.status !== 'watching') continue;
    if (older.routes.some((r) => draft.routes.some((x) => r.id === x.id)) || older.planeIds.some((id) => draft.planeIds.includes(id))) older.status = 'changed';
  }
  draft.id = s.nextChangeId = (s.nextChangeId || 0) + 1;
  history.unshift(draft); history.length = Math.min(30, history.length);
  return draft;
}

// Called only after the day's ledgers have closed. The day of the change is
// excluded, even if the player made it shortly after midnight.
export function collectChangeResults(game) {
  for (const entry of game.state.managementChanges || []) {
    if (entry.status !== 'watching') continue;
    if (configuration(game, entry) !== entry.configuration) { entry.status = 'changed'; continue; }
    if (game.state.day <= entry.day || entry.samples.some((x) => x.day === game.state.day)) continue;
    const profit = actualScope(game, entry);
    if (profit == null) { entry.status = 'changed'; continue; }
    entry.samples.push({ day: game.state.day, profit });
    if (entry.samples.length >= RESULT_DAYS) entry.status = 'complete';
  }
}

export function changeOutcome(entry) {
  const actual = entry.samples.length ? entry.samples.reduce((sum, x) => sum + x.profit, 0) / entry.samples.length : null;
  return { actual, actualGain: actual != null && entry.beforeActual != null ? actual - entry.beforeActual : null,
    estimatedGain: entry.estimatedAfter - entry.estimatedBefore, days: entry.samples.length };
}
