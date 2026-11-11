// Airline identity and durable milestones, separate from the rolling news log.
import { AIRPORT_BY_ID } from './data/airports.js';
import { RANKS, rankFor } from './data/catalog.js';
import { AIRPORT_PROJECTS } from './projects.js';
import { CAMPAIGNS } from './campaigns.js';

export const BRAND_COLORS = {
  amber: { name: 'Amber', hex: '#ffb454' },
  blue: { name: 'Sky', hex: '#7cc4e8' },
  green: { name: 'Mint', hex: '#5fd69a' },
  rose: { name: 'Rose', hex: '#e88bb4' },
  violet: { name: 'Lilac', hex: '#b79cff' },
  coral: { name: 'Coral', hex: '#ff9b88' },
};
export const companyColor = s => (BRAND_COLORS[s?.company?.color] || BRAND_COLORS.amber).hex;
export const companyInk = s => s?.company?.color && s.company.color !== 'amber' ? companyColor(s) : '#fff4e0';
export const companySoft = s => `rgba(${companyColor(s).slice(1).match(/../g).map(v => parseInt(v,16)).join(',')},`;
export const planeRegistration = p => {
  if (p.registration) return p.registration;
  const old = /^([A-Z]{3})-(\d+)$/.exec(p.name || '');
  return old && AIRPORT_BY_ID[old[1]] && +old[2] === p.id ? p.name : `${p.hub}-${String(p.id).padStart(3,'0')}`;
};
const thresholds = { totalPax: [1000,10000,100000,1000000,10000000], flights: [100,1000,10000,100000] };
const cleanName = value => String(value ?? '').normalize('NFKC').trim().replace(/ +/g,' ');
export function nameProblem(value, max = 40) {
  const name = cleanName(value);
  if (!name) return 'Enter a name.';
  if ([...name].length > max) return `Use ${max} characters or fewer.`;
  if (!/^[\p{L}\p{M}\p{N} .,'’()\-]+$/u.test(name)) return 'Use letters, numbers, spaces, apostrophes, periods, commas, brackets or hyphens.';
  return null;
}

// Historical facts remain visible after routes close or projects are removed,
// but actions only point at records that are still available today.
export function companyEventTarget(game, event) {
  const [kind,id,part]=event.key.split(':');
  const target=event.target || (kind==='campaign'?{kind:'campaign',id}
    :kind==='project'?{kind:'project',id:`${id}/${part}`}
      :['hub','rank'].includes(kind)?{kind:'airport',id}
        :kind==='founded'?{kind:'airport',id:game.state.company.home}
          :kind==='listing'?{kind:'page',id:'finance'}
            :['goal','achievement','scenario'].includes(kind)?{kind:'page',id:'goals'}
              :kind==='takeover'?{kind:'page',id:'rivals'}:null);
  if (!target) return null;
  if (target.kind==='route') return game.route(target.id)?target:null;
  if (target.kind==='airport') return AIRPORT_BY_ID[target.id]?target:null;
  if (target.kind==='campaign') return CAMPAIGNS[target.id]?target:null;
  if (target.kind==='page') return ['finance','goals','rivals'].includes(target.id)?target:null;
  if (target.kind==='project') {
    const [hub,id]=String(target.id).split('/'),project=game.airportProject(hub,+id);
    return project && !['cancelled','removed'].includes(project.status)?target:null;
  }
  return null;
}

export const companyActions = {
  migrateCompany(fresh = false) {
    const s = this.state;
    for (const p of s.planes) p.registration ||= planeRegistration(p);
    if (s.company) return;
    const home = s.hubs[0].id;
    s.company = { name: `${AIRPORT_BY_ID[home].city} Air`, color: 'amber', home,
      since: s.minute, legacy: !fresh, timeline: [], seen: {}, archived: 0,
      records: { fleet: s.planes.length, hubs: s.hubs.length, routes: s.routes.length, streak: s.streak || 0,
        reputation: s.rep, value: this.valuation(), longestFlight: null, busiestDay: null },
      day: { id: s.day, pax: s.totalPax, flights: s.flights, eligible: fresh || s.minute % 1440 === 0 },
    };
    for (const h of s.hubs) for (const [,name] of RANKS.slice(0,rankFor(h.levels).index+1)) s.company.seen[`rank:${h.id}:${name}`] = true;
    // Old saves retain known facts; do not invent dates for flights, goals or hubs.
    if (!fresh) {
      if (s.routes.length || s.flights) s.company.seen['first-route'] = true;
      for (const [key,steps] of Object.entries(thresholds)) for (const n of steps) if (s[key] >= n) s.company.seen[`${key}:${n}`] = true;
      for (const h of s.hubs) for (const p of h.projects || []) if (p.completed != null) this.recordCompanyEvent(`project:${h.id}:${p.id}`, 'network', `${h.id} · ${AIRPORT_PROJECTS[p.kind]?.name || 'Airport project'} completed`, '', p.completed);
      for (const [id,run] of Object.entries(s.campaigns?.runs || {})) if (run.completed != null) this.recordCompanyEvent(`campaign:${id}`, 'milestones', `${CAMPAIGNS[id]?.name || 'Campaign'} completed`, 'Campaign badge earned.', run.completed);
      if (s.listed) this.recordCompanyEvent('listing', 'milestones', 'Listed on the stock exchange', '', s.listed.day * 1440, true);
    }
    this.recordCompanyEvent('founded', 'identity', fresh ? 'Airline founded' : 'Company history started',
      fresh ? `Home airport: ${home} · ${AIRPORT_BY_ID[home].city}.` : `Existing airline: ${s.hubs.length} hubs, ${s.planes.length} aircraft and ${s.flights.toLocaleString()} completed flights. Earlier undated events are not reconstructed.`);
  },
  recordCompanyEvent(key, kind, title, detail = '', minute = this.state.minute, dayOnly = false, target = null) {
    const c = this.state.company;
    if (!c || c.seen[key]) return;
    c.seen[key] = true;
    c.timeline.push({ key, kind, title, detail, minute, dayOnly, ...(target?{target:{...target}}:{}) });
    c.timeline.sort((a,b) => a.minute - b.minute);
    // Keep the newest 500 milestones; deduplication survives archival.
    if (c.timeline.length > 500) { c.archived += c.timeline.length - 500; c.timeline.splice(0,c.timeline.length - 500); }
  },
  setCompanyIdentity(name, color) {
    const why = nameProblem(name); if (why) return why;
    if (!BRAND_COLORS[color]) return 'Choose one of the airline colors.';
    this.state.company.name = cleanName(name); this.state.company.color = color;
    this.changed(); return null;
  },
  renameAircraft(id, name) {
    const p = this.plane(id); if (!p) return 'That aircraft is no longer in your fleet.';
    const why = nameProblem(name,32); if (why) return why;
    const next = cleanName(name);
    if (this.state.planes.some(q => q.id !== id && q.name.toLocaleLowerCase() === next.toLocaleLowerCase())) return 'Another aircraft already uses that name.';
    p.registration ||= planeRegistration(p); p.name = next;
    this.changed(); return null;
  },
  syncCompany() {
    const s = this.state, c = s.company; if (!c) return;
    const r = c.records;
    r.fleet = Math.max(r.fleet,s.planes.length); r.hubs = Math.max(r.hubs,s.hubs.length); r.routes = Math.max(r.routes,s.routes.length);
    r.streak = Math.max(r.streak,s.streak); r.reputation = Math.max(r.reputation,s.rep); r.value = Math.max(r.value,this.valuation());
    for (const h of s.hubs) {
      const rank = rankFor(h.levels);
      if (rank.index > 0) this.recordCompanyEvent(`rank:${h.id}:${rank.name}`, 'network', `${h.id} became a ${rank.name}`);
    }
    this.companyTrafficMilestones();
  },
  companyTrafficMilestones() {
    const s = this.state;
    for (const [key,steps] of Object.entries(thresholds)) for (const n of steps) if (s[key] >= n)
      this.recordCompanyEvent(`${key}:${n}`, 'milestones', `${n.toLocaleString()} ${key === 'totalPax' ? 'passengers carried' : 'flights completed'}`);
  },
  recordCompanyFlight(p, route, minute) {
    const s = this.state, c = s.company; if (!c) return;
    const from = p.phase === 'out' ? route.hub : route.dest, to = p.phase === 'out' ? route.dest : route.hub;
    if (s.flights === 1) this.recordCompanyEvent('first-flight','network','First flight completed',`${p.name} · ${from} → ${to}`,minute,false,{kind:'route',id:route.id});
    if (!c.records.longestFlight || route.km > c.records.longestFlight.km) c.records.longestFlight = { from, to, km: route.km, minute };
    c.records.value = Math.max(c.records.value,this.valuation());
    this.companyTrafficMilestones();
  },
  closeCompanyDay() {
    const s = this.state, c = s.company; if (!c) return;
    const d = c.day, pax = s.totalPax-d.pax, flights = s.flights-d.flights;
    if (d.id === s.day && d.eligible && (!c.records.busiestDay || pax > c.records.busiestDay.pax)) c.records.busiestDay = { day:s.day,pax,flights };
    c.day = { id:s.day+1,pax:s.totalPax,flights:s.flights,eligible:true };
    this.syncCompany();
  },
};
