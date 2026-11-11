import { AIRPORT_PROJECTS, PROJECT_STAGES } from './projects.js';
import { CAMPAIGNS } from './campaigns.js';
import { AIRPORT_BY_ID } from './data/airports.js';
import { fleetMatches } from './aircraftManagement.js';
import { fmtMoney, fmtSigned, fmtDate } from './game.js';

export const ATTENTION_GROUPS = [
  { id: 'campaigns', label: 'Campaign chapter ready', view: 'campaigns' },
  { id: 'projects', label: 'Projects awaiting funding', view: 'projects' },
  { id: 'unassigned', label: 'Routes without aircraft', view: 'routes', filter: 'unassigned' },
  { id: 'losing', label: 'Losing routes', view: 'routes', filter: 'losing' },
  { id: 'disrupted', label: 'Disrupted routes', view: 'routes', filter: 'disrupted' },
  { id: 'freight', label: 'Freight at risk', view: 'routes', filter: 'freight' },
  { id: 'connections', label: 'Connections at risk', view: 'routes', filter: 'connections' },
  { id: 'parked', label: 'Parked aircraft', view: 'aircraft', filter: 'parked' },
  { id: 'repair', label: 'Aircraft in repair', view: 'aircraft', filter: 'repair' },
  { id: 'maintenance', label: 'High maintenance', view: 'aircraft', filter: 'maintenance' },
  { id: 'leases', label: 'Leases ending soon', view: 'aircraft', filter: 'leases' },
  { id: 'returns', label: 'Returns awaiting action', view: 'aircraft', filter: 'returns' },
  { id: 'partnerships', label: 'Partnerships to review', view: 'partnerships' },
  { id: 'contracts', label: 'Contracts due soon', view: 'contracts' },
];

export const contractDueSoon = (c, day) => c.due != null && !c.finished && c.done < c.amount && c.due >= day && c.due <= day + 3;

// Derive current problems instead of storing a second alert state that can go stale.
// One row per route, aircraft or contract; summary categories can overlap.
export function operationsAttention(game, hub = 'all') {
  const s = game.state, alerts = [];
  const inScope = (x) => hub === 'all' || x.hub === hub;
  const campaign=game.campaignRun();
  if(campaign?.phase==='ready'){
    const id=s.campaigns.active,profile=CAMPAIGNS[id],chapter=profile.chapters[campaign.chapter];
    alerts.push({id:`campaign-${id}-${campaign.chapter}`,categories:['campaigns'],title:`${profile.name} · chapter complete`,detail:`${chapter.name}: objectives verified. Review your ${fmtMoney(chapter.reward)} reward and the next step.`,target:{kind:'campaign',id},tone:'good',priority:4});
  }
  for(const h of s.hubs.filter(x=>hub==='all' || x.id===hub))for(const p of h.projects || [])if(p.status==='awaiting')alerts.push({
    id:`project-${h.id}-${p.id}`,categories:['projects'],title:`${h.id} · ${AIRPORT_PROJECTS[p.kind].name}`,detail:`Ready for ${PROJECT_STAGES[p.stage].name.toLowerCase()}. Review the ${fmtMoney(p.payments[p.stage])} stage payment to continue. No construction delay while work is waiting.`,target:{kind:'project',id:`${h.id}/${p.id}`},tone:'amber',priority:3});
  for (const r of s.routes.filter(inScope)) {
    const planes = game.planesOn(r.id), profit = game.routeProfit(r);
    const closed = game.closed(r.hub) || game.closed(r.dest);
    const repairs = planes.filter((p) => p.phase === 'repair').length;
    const categories = [], messages = [];
    if (!planes.length) { categories.push('unassigned'); messages.push('No aircraft assigned. Assign or buy an aircraft to start flying.'); }
    if (closed || repairs) {
      categories.push('disrupted');
      messages.push(closed ? 'Airport closed. Review the disruption before changing capacity.' : `${repairs} aircraft in repair. Review their status before adding capacity.`);
    }
    if (profit != null && profit < 0) { categories.push('losing'); messages.push(`${fmtSigned(profit)} yesterday. Review fares, running costs and assignments.`); }
    const freight=game.freightStatus(r);
    if(freight.atRisk>.01){categories.push('freight');messages.push(`${freight.atRisk.toFixed(1)} t waiting with blocked flights or delivery due within 6 hours. Review freight deadlines and aircraft assignments.`);}
    const connections=game.connectionStatus(r,false);
    if (connections.atRisk) { categories.push('connections');messages.push(`${Math.floor(connections.atRisk)} connecting travelers are waiting. Review onward capacity or Frequent service before their connection window expires.`); }
    if (categories.length) alerts.push({ id: `route-${r.id}`, categories, title: `${r.hub} ⇄ ${r.dest} · ${AIRPORT_BY_ID[r.dest].city}`,
      detail: messages.join(' '), target: { kind: 'route', id: r.id }, tone: 'bad', priority: closed || repairs ? 1 : profit < 0 ? 2 : 3 });
  }
  for (const p of s.planes.filter(inScope)) {
    const categories = ['repair', 'maintenance', 'parked', 'leases', 'returns'].filter((id) => fleetMatches(game, p, id));
    if (!categories.length) continue;
    const messages = [];
    if (categories.includes('returns')) messages.push(`Temporary cover finished. ${p.recoveryAssignment.pending}. Review its planned return.`);
    if (categories.includes('repair')) messages.push(`In repair · about ${Math.max(0, Math.ceil((720 - p.t) / 60))}h remaining.`);
    if (categories.includes('maintenance')) messages.push(`${Math.floor(p.age)} days old · ${(game.breakdownRisk(p) * 100).toFixed(1)}% breakdown risk. Compare maintenance or replacement.`);
    if (categories.includes('parked')) messages.push(`Parked at ${p.hub}, costing ${fmtMoney(game.planeUpkeep(p))}/day. Assign it to a route.`);
    if (categories.includes('leases')) messages.push(p.lease.returning ? 'Lease expired. Aircraft returns after its current flight.' : `Lease ends in ${Math.max(0, Math.ceil((p.lease.end - s.minute) / 1440))} days. Extend it or arrange a replacement.`);
    alerts.push({ id: `plane-${p.id}`, categories, title: p.name, detail: messages.join(' '), target: { kind: 'plane', id: p.id },
      tone: categories.includes('repair') ? 'bad' : 'amber', priority: categories.includes('repair') ? 1 : 4 });
  }
  for (const c of s.contracts.filter((c) => inScope(c) && contractDueSoon(c, s.day))) {
    const left = c.due - s.day;
    alerts.push({ id: `contract-${c.id}`, categories: ['contracts'], title: `Contract to ${c.dest} · ${left ? `${left} day${left === 1 ? '' : 's'} left` : 'due today'}`,
      detail: `${Math.floor(c.done).toLocaleString()} of ${c.amount.toLocaleString()} ${c.kind === 'cargo' ? 't' : 'passengers'} delivered · due ${fmtDate(c.due)}. Review progress and the serving routes.`,
      target: { kind: 'contract', id: c.id }, tone: left <= 1 ? 'bad' : 'amber', priority: left <= 1 ? 0 : 2 });
  }
  for(const a of s.partnerships?.agreements || []) {
    const status=game.partnershipStatus(a);
    const routes=[...status.pairs,...status.queues].flatMap(p=>[game.route(p.firstRouteId),game.route(p.secondRouteId)]).filter(Boolean);
    if(hub!=='all' && !routes.some(r=>r.hub===hub))continue;
    if(!status.atRisk && !status.expiring && !(status.active && status.reason))continue;
    const detail=[status.atRisk?`${Math.floor(status.atRisk)} passengers are at risk of missing the onward flight.`:'',status.expiring?'Agreement ends within three days. Review renewal terms.':'',status.active && status.reason?`${status.reason}. Review shared routes.`:''].filter(Boolean).join(' ');
    alerts.push({id:`partnership-${a.id}`,categories:['partnerships'],title:`${a.name} partnership`,detail,target:{kind:'partnership',id:a.id},tone:status.atRisk?'bad':'amber',priority:status.atRisk?1:3});
  }
  alerts.sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title));
  const groups = ATTENTION_GROUPS.map((g) => ({ ...g, count: alerts.filter((a) => a.categories.includes(g.id)).length }));
  return { alerts, groups };
}

// Historical alerts keep their exact entity id. Never guess an aircraft or route
// from message text, or silently redirect a sold aircraft to another one.
export function resolveAlertTarget(game, entry) {
  const target = entry.target || (entry.at ? { kind: 'airport', id: entry.at } : null);
  if (!target) return null;
  const { kind, id } = target;
  const exists = kind==='campaign' ? CAMPAIGNS[id] : kind==='project' ? game.airportProject(String(id).split('/')[0],+String(id).split('/')[1]) : kind === 'plane' ? game.plane(id) : kind === 'route' ? game.route(id)
    : kind === 'contract' ? game.state.contracts.some((c) => c.id === id)
      : kind === 'partnership' ? game.agreement(+id)
      : kind === 'airport' ? AIRPORT_BY_ID[id]
        : kind === 'page' ? ['finance', 'contracts', 'calendar', 'rivals', 'goals'].includes(id) : false;
  return exists ? { kind, id } : null;
}

export const alertTargetLabel = (target) => ({ campaign:'Review campaign', project:'Review project', plane: 'View aircraft', route: 'View route', contract: 'View contract', partnership: 'Review partnership', airport: 'View airport',
  page: ({ finance: 'View finances', contracts: 'View contracts', calendar: 'View calendar', rivals: 'View rivals', goals:'View goals & campaigns' })[target?.id] })[target?.kind] || 'View details';
