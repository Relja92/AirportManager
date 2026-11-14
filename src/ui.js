// DOM interface: HUD, side panel tabs, cards, calendar, modals, toasts.
import { AIRPORTS, AIRPORT_BY_ID, TIER_NAMES } from './data/airports.js';
import {
  AIRCRAFT, AIRCRAFT_LIST, UPGRADES, UPGRADE_KEYS, GOALS, ACHIEVEMENTS, LISTING_VALUE, DIFFICULTY, difficultyOf, SCENARIOS, CABINS, USED, maxLevel, rankFor, bestRank,
} from './data/catalog.js';
import { EVENT_TYPES, describe, isActive, activeEvents } from './events.js';
import { game, distKm, fmtMoney, fmtSigned, fmtDate, dateOf, MONTHS, SPEEDS } from './game.js';
import { audio } from './audio.js';
import { ROUTE_FILTERS, routeStatus } from './routeStatus.js';
import { FLEET_FILTERS, fleetMatches, aircraftPlan, applyAircraftPlan, fleetBatchPlan, applyFleetBatch } from './aircraftManagement.js';
import { ATTENTION_GROUPS, operationsAttention, contractDueSoon, resolveAlertTarget, alertTargetLabel } from './operationsAttention.js';
import { matchesSearch, airportMatches, routeMatches, planeMatches, searchNetwork } from './search.js';
import { RESULT_DAYS, changeOutcome } from './changeResults.js';
import { icon } from './icons.js';
import { pwa } from './pwa.js';
import { SPECIALIZATIONS, SPECIALIZATION_DAYS, specializationOf } from './specializations.js';
import { CLIENTS, clientOf, SERVICES, serviceOf, LEASE_TERMS, leaseDaysLeft } from './commercial.js';
import { rivalHubIds, rivalStrategy, marketOverlap, canTakeOver } from './rivals.js';
import { AIRPORT_PROJECTS, PROJECT_STAGES, PROJECT_SITES, projectEffects, constructionDelay } from './projects.js';
import { CAMPAIGNS } from './campaigns.js';
import { BRAND_COLORS, companyColor, planeRegistration, companyEventTarget } from './company.js';
import { FREIGHT_SERVICES, freightService, freightHold } from './cargo.js';
import { PARTNERSHIP_TERMS, PARTNERSHIP_DAYS, agreementActive } from './partnerships.js';
import { rivalLeaseCommitment } from './rivalCommercial.js';
import { MARKET_PROFILES } from './data/markets.js';
import { WORLD_MILESTONES, CONTINENT_BONUS, milestoneName } from './worldCoverage.js';
import { PASSENGERS, PASSENGER_KEYS, passengerTotal } from './passengers.js';
import { liveIncidents, contractDeadline, responseCases, responseContext, responseTargets, responseAircraft, responseQuote, disruptionForecast, contractOutlook } from './disruptions.js';
import { LESSONS, LESSON_BY_ID, ensureTutorial, startLesson, currentLesson, tutorialRoute, observeTutorial, canAdvanceLesson, nextLessonStep, lessonWhy } from './tutorial.js';

const $ = (sel) => document.querySelector(sel);
const km = (n) => `${Math.round(n).toLocaleString()} km`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (f) => `${f >= 1 ? '+' : '−'}${Math.round(Math.abs(f - 1) * 100)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 || word === 'aircraft' ? '' : 's'}`;
// The side panel holds what belongs to the selected hub; company-wide screens open from the top bar.
const TABS = [['routes', 'Routes'], ['market', 'Fleet'], ['airport', 'Upgrades']];
const PAGES = [['company', 'Company'], ['finance', 'Finance'], ['contracts', 'Contracts'], ['calendar', 'Calendar'], ['rivals', 'Rivals'], ['goals', 'Goals & campaigns'], ['log', 'News'], ['learn', 'Tutorials'], ['more', 'More']];
const NAV = PAGES.filter(([id]) => ['finance', 'contracts', 'rivals'].includes(id));
const PAGE_KEYS = { finance: 'B', contracts: 'C', calendar: 'K', rivals: 'R', goals: 'G', log: 'N' };
const PAGE_TITLES = { ...Object.fromEntries(PAGES), finder: 'Route finder', market: 'Buy or lease aircraft', 'mobile-menu': 'More' };
const FINDER_SORTS = [['profit', 'Profit'], ['demand', 'Demand'], ['near', 'Nearest']];
const CONTRACT_COLOR = '#5fd69a';
const repName = (r) => (r < 30 ? 'Poor' : r < 45 ? 'Shaky' : r < 60 ? 'Decent' : r < 75 ? 'Well liked' : 'Beloved');
const BORROW = [500e3, 2e6, 10e6];
const TUTORIAL_KEY = 'airport-manager-tutorial-seen';
const WEEKLY_KEY = 'airport-manager-weekly-off';
const DIFF_KEY = 'airport-manager-difficulty';
const FLEET_SORTS = [['profit', 'Worst first'], ['age', 'Oldest'], ['hub', 'By hub']];
const OPS_SORTS = [['profit', 'Worst first'], ['demand', 'Busiest'], ['name', 'A–Z']];
const KEY_PAGES = { f: 'finder', c: 'contracts', n: 'log', g: 'goals', b: 'finance', k: 'calendar', r: 'rivals' };

// Shown once each, the first time the thing they explain turns up. `go` is the tab or page that deals with it.
const TIPS = [
  { id: 'contract', go: 'contracts', when: (s) => s.contracts.some((c) => c.due == null),
    title: 'A contract is on offer', text: 'Contracts are timed jobs with a cash reward. The airport is ringed in green on the map. Sign only what you can fly: a missed contract costs reputation.' },
  { id: 'losing', go: 'routes', when: (s) => s.routes.some((r) => game.planesOn(r.id).length && game.diagnose(r).length),
    title: 'A route is losing money', text: 'In the Routes tab, the red line under a route says why it lost money yesterday and what to change.' },
  { id: 'war', go: 'rivals', when: (s) => s.routes.some((r) => game.routeFactors(r).war),
    title: 'A rival has started a price war', text: 'A rival has entered one of your markets with introductory fares. It will review the route after 12 days using earnings and cash reserves. Matching its price may help, but a sustainable rival can stay.' },
  { id: 'rivalWeak', go: 'rivals', when: (s) => s.rivals.some((rv) => rv.hub && (rv.str ?? 100) < 50),
    title: 'A rival is struggling', text: 'Rivals have cash reserves and operating profits. A struggling airline can recover by adjusting fares, selling aircraft or growing elsewhere. A takeover becomes available after sustained losses and depleted reserves; review its finances on the Rivals page.' },
  { id: 'worn', go: 'aircraft', when: () => game.risky().length > 0,
    title: 'An aircraft is wearing out', text: 'Old aircraft cost more to keep and break down more often. Overhaul it, or replace it with a new one from its card. Operations’ “By aircraft” list flags the worn ones.' },
  { id: 'fuelHigh', go: 'finance', when: (s) => s.fuel > 1.15 && s.planes.length > 0 && !game.fuelLocked(),
    title: 'Fuel is getting expensive', text: 'The fuel price drifts from day to day. Finance shows where it stands. A fuel depot cuts every bill, and when the price is low you can lock it for 30 days.' },
  { id: 'fuelLow', go: 'finance', when: (s) => s.fuel < 0.9 && s.planes.length > 1 && !game.fuelLocked(),
    title: 'Fuel is cheap right now', text: 'You can lock today’s price for 30 days in Finance. It will drift back up sooner or later.' },
  { id: 'rep', go: 'contracts', when: (s) => s.flights > 0 && (s.rep < 43 || s.rep > 60),
    title: 'Your reputation is moving', text: 'Reputation raises or lowers demand on every route. Fair fares, young aircraft, lounges and business cabins lift it; breakdowns, strikes and missed contracts drag it down. The Contracts page shows the sums.' },
  { id: 'hub2', go: null, when: (s) => s.hubs.length === 1 && bestRank(s) >= 1 && s.money > 4e6,
    title: 'You can open a second hub', text: 'Click any airport without a rival base and choose “Open a hub here”. Link the two hubs with a route and each feeds passengers to the other.' },
  { id: 'value', go: 'finance', when: (s) => bestRank(s) >= 3,
    title: 'Your company has a market value', text: 'Finance now matters for the end game: with a Global Hub and a big enough company value you can list on the stock exchange, the last milestone.' },
];

// Plain-words explanations shown when the pointer rests on (or a finger taps) a term.
const GLOSSARY = {
  coverage: 'The long mission: put every airport on the map on your network. An airport counts when it is one of your hubs or any of your routes ends there. Milestones pay cash, and each continent you cover completely adds 3% demand on every route.',
  demand: 'How many people want to fly this route each day, in each direction. It depends on the size of the city, the distance, your fare, the season, events, rivals, reputation and transfer passengers.',
  waiting: 'Passengers at the gate right now, each way. The route’s service policy sets the minimum load and longest wait after turnaround.',
  fare: 'What one economy ticket costs. 100% is the standard fare for the distance. Cheaper fills more seats and is good for reputation; dearer earns more per seat but fewer people fly.',
  cabin: 'How the seats are split. A business seat takes the room of two economy seats and normally sells for three times the fare (3.6× at a Premium hub), so it only pays where enough business travelers want one. Business travelers can also fly economy.',
  competition: 'Airlines serving this route or a nearby departure market. Their capacity and fares affect your passenger share. Flights from distant origins do not automatically compete. The percentage is their fare.',
  yesterday: 'The last full day: money in minus flying costs minus the upkeep of the aircraft on the route, and how full the flights were.',
  estimate: 'A forecast for one new aircraft at the standard fare, after its upkeep. It uses today’s demand, so seasons, events and rivals can change it.',
  smallest: 'The cheapest aircraft type with enough range for this distance. Your runway level decides which types you may buy.',
  load: 'Share of seats that were filled yesterday. Around 70–95% is healthy. Lower means the aircraft is too big or the fare too high; 100% means you are turning people away.',
  wantSeats: 'Left: people who want to fly this route each day, both directions together. Right: seats your aircraft on it offer each day. The two should be close.',
  tooMany: 'You offer far more seats than there are passengers, so aircraft fly part-empty and still cost the same to run. Use a smaller aircraft, move one away, or lower the fare to draw more people.',
  roomFor: 'More people want to fly than you have seats for, so you are turning passengers away. Add an aircraft, use a bigger one, or raise the fare.',
  noAircraft: 'Nothing is flying this route, so it earns nothing. Press “+ aircraft” to assign or buy one.',
  routeProfit: 'Yesterday’s income on this route minus its flying costs and the upkeep of its aircraft. Airport upkeep and loan interest are not included.',
  opsAircraft: 'The aircraft flying this route. Click one to inspect it, then preview a move, swap, maintenance or replacement.',
  hubLink: 'A route between two of your own hubs. It draws on both hubs’ terminals and marketing and feeds transfer passengers both ways.',
  priceWar: 'A rival is offering introductory fares. After 12 days it reviews route earnings, cash reserves and the wider network. It may leave a costly market or keep a sustainable service.',
  contractMark: 'A signed contract counts what you carry to this city.',
  risk: 'The chance this aircraft breaks down after each landing. A breakdown costs a repair bill, twelve hours in the hangar and a little reputation. It grows with age; an overhaul or replacement brings it down.',
  age: 'Days since it was built. Older aircraft cost more to maintain, break down more and are worth less.',
  planeUpkeep: 'Daily maintenance, plus rent for leased aircraft, flying or not. Maintenance rises with age.',
  lifetime: 'Everything this aircraft has earned from its flights since you bought it, before upkeep.',
  planeYesterday: 'What this aircraft’s flights brought in yesterday, minus its own upkeep.',
  overhaul: 'A workshop visit that takes 60% off the aircraft’s age, so it costs less to keep and breaks down less.',
  replaceNew: 'Sell this one back and take a factory-new aircraft of the same type. It keeps its name, gate and route.',
  used: 'A second-hand aircraft: about half the price, but it arrives 150 days old, so it costs more to maintain and breaks down more.',
  parked: 'Sitting at a gate with no route. It earns nothing and still costs upkeep.',
  losing: 'Its flights brought in less than its own upkeep yesterday.',
  worn: 'More than a 3% chance of breaking down after each flight. Overhaul or replace it.',
  rank: 'An airport’s rank comes from its total upgrade levels. A Regional Airport lets you open more hubs; a Global Hub is needed to list the company.',
  cash: 'Money in the bank. Five days in a row below zero and the bank closes you down.',
  today: 'Income minus costs since midnight. Airport upkeep, maintenance and interest are charged at the end of the day, so this looks better than the final figure.',
  nextGoal: 'Goals pay cash when you reach them. Click to see them all.',
  news: 'Everything the game has announced lately. The number is what you haven’t read yet.',
  netWorth: 'Cash plus what your aircraft and buildings are worth, minus debt.',
  assets: 'What your aircraft would sell for today plus half of what you have spent on airports.',
  companyValue: 'What the market would pay for the airline: net worth plus forty days of your average daily profit over the last month. A Global Hub and a high enough value let you list on the stock exchange.',
  borrowed: 'The bank lends up to a limit that grows with what you own. Interest is 0.4% of the debt every day.',
  investors: 'Each 10% stake gives you cash now. In return investors take that share of every profitable day, permanently. They never share your losses.',
  fuelMarket: 'Today’s fuel price compared with normal. It drifts between about 65% and 160% and tends back toward 100%. It applies to every flight from every hub.',
  fuelLock: 'Fixes the price you pay at today’s level for 30 days, whatever the market does, including spikes. The fee is higher when fuel is cheap, because the price is then likely to rise.',
  airportUpkeep: 'The daily cost of running your airports. It grows faster than the airport does, so a fully built hub is expensive to keep.',
  maintenance: 'The daily upkeep of every aircraft you own, flying or not.',
  dividends: 'The share of yesterday’s profit paid to investors you sold stakes to.',
  reputation: 'How much passengers like your airline, 0 to 100. At 50 it changes nothing; above it every route gets more passengers, below it fewer. Rivals also take less from an airline people like.',
  strength: 'Financial health reflects cash coverage and recent operating profit. A sale needs health below 25, at least seven losing days and depleted reserves. Ten days of negative cash causes bankruptcy.',
  standings: 'Passengers carried during the last settled day. Rival figures account for aircraft capacity, fares, competition, demand and closures.',
  routesUsed: 'Routes open from this hub out of the number its terminal allows. Upgrade the terminal for more.',
  gatesUsed: 'Aircraft based at this hub out of the number its gates allow. Upgrade the gates for more.',
  reach: 'The furthest a route from this hub can go. It is the range of the biggest aircraft the runway can take.',
  season: 'Leisure demand swings up to ±35% at holiday destinations. Business demand varies much less. The north peaks in July, the tropics and south around the New Year.',
  transfers: 'Passengers changing planes at your hub. Other routes with available aircraft and open airports supply demand. Airport profiles and service frequency matter; long flights gain the most.',
  starter: 'Airports your first aircraft could reach from here. More neighbours makes for an easier start.',
  difficulty: 'Set when the game was started. It changes starting cash, passenger numbers, costs, rivals and fuel swings.',
  contractReward: 'Paid when the target is reached. Repeat agreements pay separately for each weekly target.',
  profitView: 'Colours every route line on the map by yesterday’s result: green earned money, red lost it, grey has no data yet.',
  earthView: 'Switch between the flat map and the globe.',
  speed: 'How fast time runs. II pauses. Keys: Space, 1, 2, 3.',
};
const term = (text, key) => `<span class="term" data-tip="${GLOSSARY[key].replace(/"/g, '&quot;')}">${text}</span>`;
const tipAttr = (key) => `data-tip="${GLOSSARY[key].replace(/"/g, '&quot;')}"`;

export function createUI(map, view) {
  document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
  let tab = 'routes';
  let page = null; // company-wide screen open in the drawer, if any
  let navOpen = false; // hamburger menu, on narrow screens
  let sel = null; // { kind: 'airport' | 'plane', id }
  let pendingMode = null; // scenario waiting for the player to pick an airport
  let calMonth = null, calDay = null;
  let launch = null;
  let commercialReview = null;
  let disruptionReview = null;
  let partnershipReview = null;
  let cargoReview = null;
  let projectReview = null;
  let campaignReview = null;
  let companyReview = null, companyPane = 'profile', historyFilter = 'all', historyLimit = 25;
  let shopKind = 'passenger';
  let routeBack = false;
  let modalFocus = null;
  let modal = null; // { resume } while a dialog is up
  let overShown = false;
  let resumeSpeed = 1;
  let hubMenu = false;
  let finderNew = false; // only airports no hub of yours serves yet
  let coverView = false; // map highlights airports not yet on the network
  let finderSort = 'profit', finderClear = false, finderMarket = 'all', finderKind = 'passenger';
  let profitView = false;
  let fleetSort = 'profit';
  let fleetFilter = 'all', aircraftReview = null, aircraftPicker = null, aircraftBack = 'market';
  let opsOpen = false, opsHub = 'all', opsSort = 'profit', opsView = 'overview';
  let contractReview = null; // focused contract or approaching deadlines, with a return destination
  let routeQuery = '', fleetQuery = '', finderQuery = '', networkQuery = '', searchOpen = false;
  let routePane = 'overview';
  const mobileMedia = window.matchMedia('(max-width: 760px)');
  let mobileTab = 'map', mobilePreview = null, mobileTools = false, mobileFleetHub = 'all';
  let mobileGuideExpanded = false, mobileScrollRestore = null;
  const mobileScroll = {}, mobileFilters = { routes: false, fleet: false };
  const backStack = [];
  let routeFilter = 'all';
  let pick = null; // aircraft in hand
  let addFor = null; // route whose “+ aircraft” list is open
  let dragging = null; // aircraft being dragged
  let diff = 'normal'; // chosen on the start screen
  try { const d = localStorage.getItem(DIFF_KEY); if (DIFFICULTY[d]) diff = d; } catch { /* ignore */ }
  let weeklyOff = false;
  try { weeklyOff = localStorage.getItem(WEEKLY_KEY) === '1'; } catch { /* ignore */ }
  let guideFinished = null;
  let tutorialBrowse = false;
  const board = [];
  const cache = {}; // element id -> last html, so we only touch the DOM when something changed

  const scrollIds = ['panel-body', 'ops-body', 'page-body', 'card', 'card-body'];
  const controlKey = (el) => el?.dataset && (el.dataset.search ? { search: el.dataset.search }
    : el.dataset.act ? { act: el.dataset.act, arg: el.dataset.arg || '' } : null);
  const findControl = (root, key) => key && [...root.querySelectorAll('[data-act], [data-search]')].find((el) =>
    key.search ? el.dataset.search === key.search : el.dataset.act === key.act && (el.dataset.arg || '') === key.arg);
  function rememberView() {
    if (!game.state) return;
    backStack.push({ tab, page, sel: sel && { ...sel }, mobileTab, mobilePreview: mobilePreview && { ...mobilePreview }, mobileFleetHub, active: game.state.active, opsOpen, opsView, opsHub, opsSort, fleetSort,
      routeFilter, fleetFilter, routeQuery, fleetQuery, finderQuery, finderSort, finderClear, finderMarket, finderKind, contractReview, routeBack, aircraftBack, addFor, routePane, companyPane, historyFilter, historyLimit,
      collapsed: $('#panel').classList.contains('collapsed'), expandedPanel: $('#panel').classList.contains('expanded'), scroll: scrollIds.map((id) => [id, $(`#${id}`)?.scrollTop || 0]),
      expanded: scrollIds.map((id) => [id, [...($(`#${id}`)?.querySelectorAll('details[open][data-section]') || [])].map((d) => d.dataset.section)]),
      focus: controlKey(document.activeElement) });
    if (backStack.length > 20) backStack.shift();
  }
  function backLabel(fallback) {
    const v = backStack.at(-1);
    if (!v) return fallback;
    if (v.opsOpen) return 'Operations';
    if (v.page) return PAGE_TITLES[v.page];
    if (v.sel?.kind === 'plane') return game.plane(v.sel.id)?.name || 'aircraft';
    if (v.sel?.kind === 'route') { const r = game.route(v.sel.id); if (r) return `${r.hub} ⇄ ${r.dest}`; }
    if (v.sel?.kind === 'airport') return AIRPORT_BY_ID[v.sel.id]?.city || 'map';
    if (mobileMedia.matches && v.mobileTab === 'map') return 'map';
    return TABS.find(([id]) => id === v.tab)?.[1] || fallback;
  }
  function returnToView() {
    const v = backStack.pop();
    if (!v || !game.state) return false;
    ({ tab, page, sel, mobileTab, mobilePreview, mobileFleetHub, opsOpen, opsView, opsHub, opsSort, fleetSort, routeFilter, fleetFilter, routeQuery, fleetQuery,
      finderQuery, finderSort, finderClear, finderMarket, finderKind, contractReview, routeBack, aircraftBack, addFor, routePane, companyPane, historyFilter, historyLimit } = v);
    if (sel?.kind === 'plane' && !game.plane(sel.id) || sel?.kind === 'route' && !game.route(sel.id)) sel = null;
    if (game.isHub(v.active)) game.state.active = v.active;
    $('#panel').classList.toggle('collapsed', v.collapsed); $('#panel').classList.toggle('expanded', v.expandedPanel); map.setSelected(sel || (mobileMedia.matches && mobilePreview) || null); render();
    for (const [id, sections] of v.expanded) $(`#${id}`)?.querySelectorAll('details[data-section]').forEach((el) => { el.open = sections.includes(el.dataset.section); });
    for (const [id, top] of v.scroll) { const el = $(`#${id}`); if (el) el.scrollTop = top; }
    const surface = v.opsOpen ? $('#ops-body') : v.page ? $('#page-body') : v.sel ? $('#card') : $(mobileMedia.matches ? '#panel' : '#panel-body');
    findControl(surface, v.focus)?.focus({ preventScroll: true });
    return true;
  }

  function setHTML(el, html) {
    if (document.activeElement?.tagName === 'SELECT' && el.contains(document.activeElement)) return;
    if (cache[el.id] === html) return;
    const active = el.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = controlKey(active), caret = active?.tagName === 'INPUT' ? [active.selectionStart, active.selectionEnd] : null;
    const scroll = el.scrollTop;
    const innerScroll = [...el.querySelectorAll('[data-scroll]')].map((node) => [node.id, node.scrollTop]);
    cache[el.id] = html;
    const expanded = [...el.querySelectorAll('details[open][data-section]')].map((d) => d.dataset.section);
    const searchField = active?.closest('.list-search');
    if (searchField?.parentElement === el) {
      // Keep the actual input attached while typing (including IME composition),
      // rather than replacing it and trying to recover focus after every key.
      const template = document.createElement('template'); template.innerHTML = html;
      const incomingInput = findControl(template.content, focusKey), incomingField = incomingInput?.closest('.list-search');
      if (incomingField?.parentNode === template.content) {
        for (const child of [...el.childNodes]) if (child !== searchField) child.remove();
        let after = false;
        for (const child of [...template.content.childNodes]) {
          if (child === incomingField) { after = true; continue; }
          if (after) el.append(child); else el.insertBefore(child, searchField);
        }
        searchField.querySelector('.search-clear')?.remove();
        const clear = incomingField.querySelector('.search-clear'); if (clear) searchField.append(clear);
      } else el.innerHTML = html;
    } else el.innerHTML = html;
    el.querySelectorAll('details[data-section]').forEach((d) => { d.open = expanded.includes(d.dataset.section); });
    el.scrollTop = scroll;
    for (const [id, top] of innerScroll) { const node = $(`#${id}`); if (node) node.scrollTop = top; }
    const replacement = findControl(el, focusKey);
    if (replacement) { replacement.focus({ preventScroll: true }); if (caret && replacement.setSelectionRange) replacement.setSelectionRange(...caret); }
  }
  function select(next, focus = false, fromOperations = false) {
    const newSelection = next && (!sel || sel.kind !== next.kind || sel.id !== next.id);
    if (next && (page || opsOpen || newSelection)) rememberView();
    mobilePreview = null; mobileTools = false;
    if (newSelection) routePane = 'overview';
    if (next?.kind === 'plane' && !(sel?.kind === 'plane' && sel.id === next.id)) {
      aircraftBack = opsOpen || (sel?.kind === 'route' && routeBack === true) ? 'ops' : page === 'log' || (sel?.kind === 'route' && routeBack === 'log') ? 'log' : tab;
      pick = null;
    }
    routeBack = fromOperations;
    sel = next;
    if (next) { page = null; opsOpen = false; } // one detail surface at a time
    map.setSelected(sel);
    let target = null;
    if (sel?.kind === 'airport') {
      if (game.state && game.isHub(sel.id)) game.state.active = sel.id;
      target = sel.id;
    } else if (sel?.kind === 'route') {
      const r = game.route(sel.id);
      if (r) { game.state.active = r.hub; target = r.dest; }
    } else if (sel?.kind === 'plane') {
      const p = game.plane(sel.id);
      if (p) { game.state.active = p.hub; target = p.hub; }
    }
    render(); // first, so the map knows where the card sits before it centres on the airport
    if (newSelection) {
      $('#card').scrollTop = 0; if ($('#card-body')) $('#card-body').scrollTop = 0;
      if (window.innerWidth <= 760) $('#card .card-nav button')?.focus({ preventScroll: true });
    }
    if (focus && target) map.focus(target, 3);
  }
  // The part of the map that neither the side panel (or bottom sheet) nor the card covers.
  function freeRect() {
    const w = window.innerWidth, h = window.innerHeight;
    const box = (el) => (el.hidden ? null : el.getBoundingClientRect());
    const hudBox = box($('#hud')), panel = box($('#panel')), card = box($('#card'));
    const top = hudBox ? hudBox.bottom : 0;
    if (w > 760) return { x0: panel ? panel.right : 0, x1: card ? card.left : w, y0: top, y1: h };
    // Full reading panels cover the map; keep its camera usable when returning.
    const bottom = box($('#mobile-nav'))?.top ?? h, preview = box($('#mobile-map-preview')), guide = box($('#guide'));
    return { x0: 0, x1: w, y0: top + (game.state ? 56 : 0), y1: Math.max(top + 140, Math.min(bottom, preview?.top ?? h, guide?.top ?? h)) };
  }
  const selectAirport = (id, focus) => select(id ? { kind: 'airport', id } : null, focus);
  const searchField = (key, value, label) => `<div class="list-search"><label><span class="sr-only">${label}</span><input type="search" data-search="${key}" value="${esc(value)}" placeholder="${label}" aria-label="${label}" autocomplete="off"></label>${value ? `<button class="search-clear" data-act="clear-search" data-arg="${key}" aria-label="Clear ${label.toLowerCase()}">×</button>` : ''}</div>`;
  const routeShown = (r) => routeMatches(r, routeQuery) && fitOf(r).matches(routeFilter);
  const planeShown = (p) => planeMatches(game, p, fleetQuery) && fleetMatches(game, p, fleetFilter);

  // Phone navigation changes presentation only; all purchases, previews and
  // management actions continue through the same handlers as the desktop UI.
  function mobileNavigate(destination) {
    if (!game.state || !['map', 'routes', 'fleet', 'operations', 'more'].includes(destination)) return;
    if (!page && !sel && !opsOpen) mobileScroll[mobileTab] = $('#panel-body').scrollTop;
    backStack.length = 0;
    mobileTab = destination; mobilePreview = null; mobileTools = false;
    page = null; sel = null; opsOpen = false; hubMenu = false; navOpen = false; pick = null;
    map.setSelected(null);
    if (destination === 'routes' || destination === 'fleet') tab = destination === 'routes' ? 'routes' : 'market';
    if (destination === 'operations') { opsOpen = true; opsView = 'overview'; opsHub = 'all'; $('#ops-body').scrollTop = 0; }
    if (destination === 'more') page = 'mobile-menu';
    mobileScrollRestore = mobileScroll[destination] || 0;
  }
  function selectFromMap(next) {
    if (!mobileMedia.matches || !game.state) { select(next); return; }
    if (modal) return;
    mobilePreview = next && { ...next }; mobileTools = false;
    map.setSelected(mobilePreview); render();
  }
  function mobileMenuHTML(s) {
    const groups = [
      ['Company', PAGES.filter(([id]) => ['company', 'finance', 'contracts', 'rivals', 'goals', 'log'].includes(id))],
      ['Airports & planning', [['upgrades', 'Hub & upgrades'], ['finder', 'Find a route'], ['calendar', 'Calendar']]],
      ['Game', [['learn', 'Tutorials & lessons'], ['more', 'Settings & help']]],
    ];
    return `<button class="mobile-menu-row" data-act="search">${icon('search')}<span>Search airports, routes & aircraft</span><span aria-hidden="true">›</span></button><button class="mobile-menu-row" data-act="pwa-open">${icon('install')}<span>${pwa.getState().installed ? 'App & updates' : 'Install app'}${pwa.getState().updateReady ? ' · Update available' : ''}</span><span aria-hidden="true">›</span></button>` + groups.map(([label, items]) =>
      `<div class="section-label">${label}</div>${items.map(([id, name]) => {
        const count = id === 'contracts' ? s.contracts.filter(c => c.due == null).length : id === 'log' ? Math.max(0, Math.min(s.logN - s.logSeen, s.log.length)) : 0;
        return `<button class="mobile-menu-row" data-act="${id === 'upgrades' ? 'mobile-upgrades' : 'page'}" data-arg="${id}">${icon(id === 'upgrades' ? 'hub' : id === 'finder' ? 'routes' : id)}<span>${name}</span>${count ? `<b class="badge">${count}</b>` : ''}<span aria-hidden="true">›</span></button>`;
      }).join('')}`).join('');
  }
  function mobileHubButton() {
    const hub = game.activeHub;
    return `<button class="mobile-hub" data-act="hub-menu" aria-label="Switch hub, current hub ${hub.id}" aria-haspopup="true" aria-expanded="${hubMenu}">${icon('hub')}<b class="mono amber">${hub.id}</b><span>${esc(AIRPORT_BY_ID[hub.id].city)}</span><span aria-hidden="true">▾</span></button>`;
  }
  function mobilePanelHead(s) {
    const fleet = tab === 'market', airport = tab === 'airport';
    return `<div class="mobile-screen-heading"><h2>${fleet ? 'Fleet' : airport ? 'Hub & upgrades' : 'Routes'}</h2>${airport ? '<button class="btn ghost" data-act="mobile-upgrades-back">← Back</button>' : `<button class="btn" data-act="page" data-arg="${fleet ? 'market' : 'finder'}">${fleet ? '+ Buy' : '+ New route'}</button>`}</div>
      <div class="mobile-scope">${fleet ? `<label><span class="sr-only">Fleet hub</span><select data-act="mobile-fleet-hub" aria-label="Fleet hub"><option value="all" ${mobileFleetHub === 'all' ? 'selected' : ''}>All hubs</option>${s.hubs.map(h => `<option value="${h.id}" ${mobileFleetHub === h.id ? 'selected' : ''}>${h.id} · ${esc(AIRPORT_BY_ID[h.id].city)}</option>`).join('')}</select></label>` : mobileHubButton()}${airport ? '' : `<button class="mobile-filter-toggle" data-act="mobile-filters" data-arg="${fleet ? 'fleet' : 'routes'}" aria-label="More ${fleet ? 'fleet' : 'route'} filters" aria-expanded="${mobileFilters[fleet ? 'fleet' : 'routes']}">${icon('filters')}Filters</button>`}</div>`;
  }
  function mobileListControls(s) {
    if (tab === 'airport') return '';
    const fleet = tab === 'market', key = fleet ? 'fleet' : 'routes';
    const entities = fleet ? s.planes.filter(p => mobileFleetHub === 'all' || p.hub === mobileFleetHub) : game.routesAt(s.active);
    const states = fleet ? null : entities.map(fitOf);
    const filter = fleet ? fleetFilter : routeFilter;
    const matches = id => fleet ? entities.filter(p => fleetMatches(game, p, id)).length : states.filter(h => h.matches(id)).length;
    const quick = fleet ? [['all', 'All'], ['attention', 'Needs attention'], ['parked', 'Parked']] : [['all', 'All'], ['attention', 'Needs attention'], ['demand', 'Demand']];
    const selected = quick.some(([id]) => id === filter) ? quick : [...quick, (fleet ? FLEET_FILTERS : ROUTE_FILTERS).find(([id]) => id === filter)];
    return `${searchField(key, fleet ? fleetQuery : routeQuery, fleet ? 'Search aircraft, routes or cities' : 'Search routes or cities')}
      <div class="mobile-quick-filters">${selected.filter(Boolean).map(([id, label]) => `<button class="chip ${id === filter ? 'on' : ''}" data-act="${fleet ? 'fleet-filter' : 'route-filter'}" data-arg="${id}" aria-pressed="${id === filter}">${label} <span class="mono">${matches(id)}</span></button>`).join('')}</div>
      ${mobileFilters[key] ? `<div class="mobile-filter-options"><label>Show<select data-act="${fleet ? 'fleet-filter' : 'route-filter'}" aria-label="Filter ${key}">${(fleet ? FLEET_FILTERS : ROUTE_FILTERS).map(([id, label]) => `<option value="${id}" ${filter === id ? 'selected' : ''}>${label} (${matches(id)})</option>`).join('')}</select></label><label>Sort<select data-act="${fleet ? 'fleet-sort' : 'ops-sort'}" aria-label="Sort ${key}">${(fleet ? FLEET_SORTS : OPS_SORTS).map(([id, label]) => `<option value="${id}" ${(fleet ? fleetSort : opsSort) === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${fleet ? '' : `<button class="btn ghost" data-act="autofit" data-arg="${s.active}" ${entities.length ? '' : 'disabled'}>Preview auto-fit</button>`}</div>` : ''}`;
  }
  function mobileRoutesHTML(s) {
    const routes = game.routesAt(s.active), shown = sortRoutes(routes).filter(routeShown);
    return `<div class="mobile-list-caption"><span>${shown.length} of ${routes.length} routes</span><span>Yesterday’s result</span></div>` + shown.map(r => {
      const f = fitOf(r), profit = game.routeProfit(r), y = r.yesterday, cargo = game.cargoOnly(r);
      const load = cargo ? y?.freight?.capacity ? Math.round(y.freight.delivered / y.freight.capacity * 100) : null : y?.seats ? Math.round(y.pax / y.seats * 100) : null;
      return `<button class="mobile-entity-row" data-act="select-route" data-arg="${r.id}" aria-label="${r.hub} to ${r.dest}, ${esc(AIRPORT_BY_ID[r.dest].city)}, route details"><span class="mobile-entity-top"><b class="mono">${r.hub} <span class="sub">⇄</span> ${r.dest}</b><span class="mono ${profit == null ? 'sub' : signCls(profit)}">${profit == null ? '—' : fmtSigned(profit)}</span></span><span class="mobile-entity-meta"><span>${esc(AIRPORT_BY_ID[r.dest].city)} · ${plural(f.on.length, 'aircraft')}</span><span>${load == null ? 'No data yet' : `${load}% full`}</span></span>${f.issues.length ? `<span class="mobile-entity-warning ${f.issues[0].tone}">${esc(f.issues[0].label)}${f.issues.length > 1 ? ` · +${f.issues.length - 1}` : ''}<span aria-hidden="true">›</span></span>` : ''}</button>`;
    }).join('') + (!shown.length ? `<div class="empty">${routes.length ? 'No routes match your search and filter.' : `No routes from ${s.active} yet.`}<br><button class="btn ghost" data-act="${routes.length ? 'reset-routes' : 'page'}" data-arg="finder">${routes.length ? 'Show all routes' : 'Find your first route'}</button></div>` : '') + '<p class="note">Profit and load use yesterday’s results. Open a route to manage its aircraft, pricing and service.</p>';
  }
  function mobileFleetHTML(s) {
    const scoped = s.planes.filter(p => mobileFleetHub === 'all' || p.hub === mobileFleetHub);
    const shown = scoped.filter(planeShown).sort({profit:(a,b) => (a.routeId == null ? -1e12 : a.yday ?? 0) - (b.routeId == null ? -1e12 : b.yday ?? 0), age:(a,b) => b.age-a.age, hub:(a,b) => a.hub.localeCompare(b.hub) || a.id-b.id}[fleetSort]);
    return `<div class="mobile-list-caption"><span>${shown.length} of ${scoped.length} aircraft</span><span>${mobileFleetHub === 'all' ? 'Across all hubs' : mobileFleetHub}</span></div>` + shown.map(p => {
      const r = game.route(p.routeId), t = AIRCRAFT[p.type];
      const status = p.conversion ? 'Converting' : ({out:'In flight', back:'In flight', home:'At gate', turn:'Turnaround', repair:'In repair', idle:'Parked'})[p.phase] || 'At gate';
      return `<button class="mobile-entity-row" data-act="select-plane" data-arg="${p.id}"><span class="mobile-entity-top"><b>${esc(p.name)}</b><span class="tag ${p.phase === 'repair' ? 'bad' : ''}">${status}</span></span><span class="mobile-entity-meta"><span>${t.name} · ${planeRegistration(p)}</span><span class="mono">${r ? `${r.hub} ⇄ ${r.dest}` : p.hub}</span></span>${fleetFlags(p) ? `<span class="mobile-fleet-flags">${fleetFlags(p)}</span>` : ''}</button>`;
    }).join('') + (!shown.length ? scoped.length ? fleetEmpty : '<div class="empty">No aircraft here yet. Buy an aircraft or launch a route to get started.</div>' : '');
  }
  function mobilePreviewHTML() {
    const selected = mobilePreview, s = game.state;
    if (!selected || !s) return '';
    let title, code, detail, primary = '<button class="btn" data-act="mobile-inspect">View details</button>';
    if (selected.kind === 'plane') {
      const p = game.plane(selected.id); if (!p) { mobilePreview = null; return ''; }
      const r = game.route(p.routeId); code = planeRegistration(p); title = p.name;
      detail = `${AIRCRAFT[p.type].name} · ${r ? `${r.hub} ⇄ ${r.dest}` : `Parked at ${p.hub}`}`;
      primary = '<button class="btn" data-act="mobile-inspect">Inspect aircraft</button>';
    } else if (selected.kind === 'route') {
      const r = game.route(selected.id); if (!r) { mobilePreview = null; return ''; }
      code = `${r.hub} ⇄ ${r.dest}`; title = AIRPORT_BY_ID[r.dest].city;
      detail = `${plural(game.planesOn(r.id).length, 'aircraft')} · ${game.routeProfit(r) == null ? 'No results yet' : `${fmtSigned(game.routeProfit(r))} yesterday`}`;
      primary = '<button class="btn" data-act="mobile-inspect">View route</button>';
    } else {
      const a = AIRPORT_BY_ID[selected.id]; if (!a) { mobilePreview = null; return ''; }
      const h = game.hub(a.id), r = game.routeTo(s.active, a.id);
      code = a.id; title = a.city;
      detail = h ? `${plural(game.routesAt(h.id).length, 'route')} · ${plural(game.planesAt(h.id).length, 'aircraft')} · ${rankFor(h.levels).name}` : `${a.country} · ${km(distKm(AIRPORT_BY_ID[s.active], a))} from ${s.active}`;
      primary = h ? `<button class="btn" data-act="mobile-hub-manage" data-arg="${h.id}">Manage hub</button><button class="btn ghost" data-act="mobile-inspect">Airport details</button>` : r ? `<button class="btn" data-act="select-route" data-arg="${r.id}">View route</button><button class="btn ghost" data-act="mobile-inspect">Airport details</button>` : `<button class="btn" data-act="mobile-inspect">View airport</button>${!game.whyNotOpen(a.id) ? `<button class="btn ghost" data-act="open-route" data-arg="${a.id}">Plan route</button>` : ''}`;
    }
    return `<button class="x" data-act="mobile-preview-close" aria-label="Close map preview">×</button><span class="mobile-preview-code mono amber">${esc(code)}</span><h3>${esc(title)}</h3><p class="sub">${esc(detail)}</p><div class="btn-row">${primary}</div>`;
  }
  function renderMobile(s) {
    const enabled = mobileMedia.matches && !!s;
    document.body.classList.toggle('mobile-game', enabled);
    const mapVisible = enabled && !page && !opsOpen && !sel && mobileTab === 'map';
    document.body.classList.toggle('mobile-map-active', mapVisible);
    $('#mobile-nav').hidden = !enabled;
    $('#mobile-map-toolbar').hidden = !mapVisible;
    $('#mobile-map-tools').hidden = !mapVisible || !mobileTools;
    $('#mobile-map-preview').hidden = !mapVisible || !mobilePreview;
    if (!enabled) return;
    const alerts = operationsAttention(game, 'all').alerts.length;
    setHTML($('#mobile-nav'), [['map','Map'],['routes','Routes'],['fleet','Fleet'],['operations','Operations'],['more','More']].map(([id,label]) => `<button data-act="mobile-tab" data-arg="${id}" ${id === mobileTab ? 'aria-current="page"' : ''} aria-label="${label}${id === 'operations' && alerts ? `, ${alerts} items need attention` : ''}"><span class="mobile-nav-icon">${icon(id)}${id === 'operations' && alerts ? `<b class="badge" aria-hidden="true">${alerts > 99 ? '99+' : alerts}</b>` : ''}</span><span>${label}</span></button>`).join(''));
    $('#mobile-nav').inert = !!modal || !$('#view').hidden;
    setHTML($('#mobile-map-toolbar'), `${mobileHubButton()}<button class="mobile-map-action" data-act="search" aria-label="Search network">${icon('search')}</button><button class="mobile-map-action" data-act="mobile-tools" aria-label="Map controls" aria-expanded="${mobileTools}">${icon('filters')}</button>`);
    setHTML($('#mobile-map-tools'), `<button class="mobile-menu-row" data-act="map-mode">${icon(map.getMode() === 'globe' ? 'map' : 'globe')}<span>${map.getMode() === 'globe' ? 'Map view' : 'Earth view'}</span></button><button class="mobile-menu-row" data-act="profit-view" aria-pressed="${profitView}">${icon('finance')}<span>${profitView ? 'Hide route profit colors' : 'Color routes by profit'}</span></button><button class="mobile-menu-row" data-act="world-view" aria-pressed="${coverView}">${icon('globe')}<span>${coverView ? 'Hide network coverage' : 'Show unserved airports'}</span></button><div class="mobile-zoom"><button class="btn ghost" data-act="zoom" data-arg="out" aria-label="Zoom out">−</button><button class="btn ghost" data-act="zoom" data-arg="fit">Whole world</button><button class="btn ghost" data-act="zoom" data-arg="in" aria-label="Zoom in">+</button></div>`);
    if (mapVisible) { const html = mobilePreviewHTML(); setHTML($('#mobile-map-preview'), html); $('#mobile-map-preview').hidden = !html; }
    if (!$('#panel').hidden) { setHTML($('#mobile-panel-head'), mobilePanelHead(s)); setHTML($('#mobile-panel-controls'), mobileListControls(s)); }
    $('#page').classList.toggle('mobile-root-page', page === 'mobile-menu');
    $('#mobile-page-back').textContent = `← Back to ${backLabel(mobileTab === 'map' ? 'map' : 'More')}`;
    $('#hud').inert = !!modal || !$('#view').hidden;
    if (mobileScrollRestore != null) { $('#panel-body').scrollTop = mobileScrollRestore; mobileScrollRestore = null; }
  }

  // ---------- small pieces ----------
  const pips = (level, max) =>
    `<span class="pips">${Array.from({ length: max }, (_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('')}</span>`;
  const kv = (label, value, cls = '') => `<div class="kv"><span>${label}</span><span class="${cls}">${value}</span></div>`;
  const signCls = (n) => (n >= 0 ? 'good' : 'bad');

  function sparkline(values, label = 'Daily profit history') {
    if (values.length < 2) return '';
    const w = 280, h = 44, max = Math.max(...values, 1), min = Math.min(...values, 0);
    const span = max - min || 1;
    const yOf = (v) => (h - 3 - ((v - min) / span) * (h - 6)).toFixed(1);
    const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${yOf(v)}`);
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${label}">
      <line x1="0" x2="${w}" y1="${yOf(0)}" y2="${yOf(0)}" stroke="rgba(140,175,205,.25)" stroke-dasharray="3 3"/>
      <polyline points="${pts.join(' ')}" fill="none" stroke="#ffb454" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function eventItem(e) {
    const s = game.state, t = EVENT_TYPES[e.type], d = describe(e);
    const end = e.start + e.days - 1;
    const when = isActive(e, s.day) ? 'Now' : e.start > s.day ? `In ${plural(e.start - s.day, 'day')}` : 'Over';
    const range = e.days > 1 ? `${fmtDate(e.start)} – ${fmtDate(end)}` : fmtDate(e.start);
    let action = '';
    if (end >= s.day && e.type === 'fuelSpike' && !e.hedged && !game.fuelLocked()) {
      const c = game.hedgeCost(e);
      action = `<button class="btn small" data-act="hedge" data-arg="${e.id}" ${s.money < c ? 'disabled' : ''}>Hedge fuel · ${fmtMoney(c)}</button>`;
    } else if (end >= s.day && e.type === 'strike' && !e.settled) {
      const c = game.settleCost(e);
      action = `<button class="btn small" data-act="settle" data-arg="${e.id}" ${s.money < c ? 'disabled' : ''}>${e.start > s.day ? 'Negotiate early' : 'Settle'} · ${fmtMoney(c)}</button>`;
    }
    const incident = liveIncidents(game).find((i)=>i.event === e);
    if (incident) action = `<button class="btn ghost small" data-act="response-open" data-arg="route:${incident.routeIds[0]}">Review disruption responses</button>`;
    return `<div class="item event ${e.airport ? 'clickable' : ''}" ${e.airport ? `data-act="select" data-arg="${e.airport}"` : ''} style="--ev:${t.color}">
      <div class="row"><span class="name"><span class="ev-icon">${t.icon}</span> ${esc(d.title)}</span><span class="sub nowrap">${when}</span></div>
      <div class="sub">${range} · ${esc(d.text)}</div>${action ? `<div style="margin-top:8px">${action}</div>` : ''}</div>`;
  }

  // ---------- tabs ----------
  function specializationCard(hub) {
    const profile = specializationOf(hub), days = Math.max(0, (hub.specializationUntil || 0) - game.state.day);
    const unlocked = Object.keys(SPECIALIZATIONS).filter((id) => id !== 'general' && game.specializationRequirements(hub.id, id).every((r) => r.met)).length;
    const mismatched = game.routesAt(hub.id).filter((r) => game.specializationDemand(hub, r.price, r.cabin, r.service) < 1 && ['budget', 'premium'].includes(hub.specialization));
    return `<div class="item specialization-card"><div class="section-label">Hub specialization</div><div class="row"><b>${profile.name}</b><span class="sub">${hub.id}</span></div>
      <p class="note">${profile.summary}</p>
      ${days ? `<div class="sub">Committed until ${fmtDate(hub.specializationUntil)} · ${days} days left</div>` : `<div class="sub">${unlocked} / 4 specializations unlocked</div>`}
      ${mismatched.length ? `<div class="why amber">${plural(mismatched.length, 'route')} ${mismatched.length === 1 ? 'attracts' : 'attract'} less demand because the ${profile.name} service conditions aren’t met. Review fares, cabins and frequency.</div><div class="chips tight">${mismatched.map((r) => `<button class="chip" data-act="specialization-route" data-arg="${r.id}">Review ${r.dest}</button>`).join('')}</div>` : ''}
      <button class="btn ghost wide" data-act="specialization-open" data-arg="${hub.id}">Compare specializations</button></div>`;
  }
  function specializationRequirementsHTML(requirements) {
    return `<div class="specialization-requirements">${requirements.map((r) => `<div class="kv"><span class="${r.met ? 'good' : ''}">${r.met ? '✓' : '○'} ${r.label}</span><span class="mono">${r.value} / ${r.target}</span></div>`).join('')}</div>`;
  }
  function specializationsModal(hubId) {
    const hub = game.hub(hubId); if (!hub) return;
    commercialReview = { kind: 'specialization-list', hubId };
    const current = hub.specialization || 'general';
    showModal(`<div class="row"><div class="eyebrow">Hub strategy · ${hubId}</div><button class="x" data-act="close-modal" aria-label="Close specializations">×</button></div>
      <h2>Give this hub a role</h2><p>Choose what ${AIRPORT_BY_ID[hubId].city} does best. Each role has trade-offs and applies to routes based here, in both directions.</p>
      <p class="note">One role per hub. Converting costs cash and commits the hub for ${SPECIALIZATION_DAYS} days. Preview the effect on your current routes before choosing.</p>
      <div class="row"><span class="sub">Current role: ${specializationOf(hub).name}</span><button class="btn ghost small" data-act="specialization-review" data-arg="${hubId}:${current}">View current role</button></div><div class="specialization-options">${Object.entries(SPECIALIZATIONS).filter(([id]) => id !== current).map(([id, profile]) => {
        const requirements = game.specializationRequirements(hubId, id), met = requirements.filter((r) => r.met).length;
        return `<div class="item specialization-option"><div class="row"><b>${profile.name}</b><span class="tag ${current === id ? 'amber' : ''}">${current === id ? 'Current role' : met === requirements.length ? 'Unlocked' : `${met} / ${requirements.length} ready`}</span></div>
          <p class="note">${profile.summary}</p>${current === id ? '' : `${met < requirements.length ? specializationRequirementsHTML(requirements) : ''}<button class="btn ghost wide" data-act="specialization-review" data-arg="${hubId}:${id}">Preview ${profile.name} · ${fmtMoney(profile.fee)}</button>`}</div>`;
      }).join('')}</div><button class="btn ghost wide" data-act="close-modal">Back to game</button>`);
  }
  function specializationModal() {
    const review = commercialReview;
    const q = game.specializationQuote(review.hubId, review.id);
    if (!q.hub) { closeModal(); return; }
    review.revision = q.revision;
    const routes = q.routes.map((r) => `<div class="specialization-route"><b>${r.hub} ⇄ ${r.dest}</b>
      ${kv('Demand / day · both ways', `${Math.round(r.before.demand)} → ${Math.round(r.after.demand)}`, 'mono')}
      ${kv('Route profit / day', `${fmtSigned(r.before.profit)} → ${fmtSigned(r.after.profit)}`, 'mono')}</div>`).join('');
    showModal(`<div class="row"><div class="eyebrow">Review hub strategy · ${q.hub.id}</div><button class="x" data-act="close-modal" aria-label="Cancel specialization">×</button></div>
      <h2>${q.profile.name} hub</h2><p>${SPECIALIZATIONS[q.current].name} → ${q.profile.name}</p>
      <div class="specialization-effects"><p><b class="good">Benefits</b><br>${q.profile.benefits}</p><p><b class="amber">Trade-offs</b><br>${q.profile.tradeoff}</p></div>
      <div class="item">${kv('Conversion fee · paid now', fmtMoney(q.cost), 'mono amber')}${kv('Cash after conversion', fmtMoney(q.remaining), `mono ${q.remaining < 0 ? 'bad' : ''}`)}
        ${q.current === review.id ? kv('Current commitment', q.remainingDays ? `${q.remainingDays} days left` : 'None') : kv('New commitment', q.remainingDays ? `${SPECIALIZATION_DAYS} days after conversion` : `${SPECIALIZATION_DAYS} days · until ${fmtDate(q.until)}`)}
        ${kv('Airport upkeep / day', `${fmtMoney(q.beforeUpkeep)} → ${fmtMoney(q.afterUpkeep)}`, 'mono')}
        ${kv('Hub profit / day · estimated', `${fmtSigned(q.before)} → ${fmtSigned(q.after)}`, 'mono')}
        ${kv('Estimated change / day', fmtSigned(q.gain), `mono ${signCls(q.gain)}`)}</div>
      <p class="note">Estimates use your current routes, cabins, fares and service. Includes aircraft maintenance, lease rent, parked aircraft and this airport’s upkeep. Excludes contract rewards, interest, dividends and the conversion fee. No routes or aircraft change automatically.</p>
      ${q.routes.length ? `<details class="route-section"><summary>Route-by-route preview · ${q.routes.length}</summary>${routes}</details>` : '<p class="why amber">No routes are based here yet. The forecast includes airport upkeep and any parked aircraft.</p>'}
      <details class="route-section" ${q.requirements.some((r) => !r.met) ? 'open' : ''}><summary>Unlock requirements · ${q.requirements.every((r) => r.met) ? 'all met' : 'in progress'}</summary>${q.requirements.length ? specializationRequirementsHTML(q.requirements) : '<p class="note">No infrastructure requirements.</p>'}</details>
      ${q.requirements.some((r) => !r.met) ? `<button class="btn ghost wide" data-act="specialization-upgrades" data-arg="${q.hub.id}">Go to upgrades</button>` : ''}
      <p class="note">${q.remainingDays ? `Current commitment ends ${fmtDate(q.hub.specializationUntil)}.` : q.current === review.id ? 'This hub can change its role now.' : `Your next change will be available on ${fmtDate(q.until)} (${SPECIALIZATION_DAYS} days).`} Switching again requires another conversion fee; returning to General purpose costs ${fmtMoney(SPECIALIZATIONS.general.fee)}. Conversion fees have no resale value.</p>
      ${q.why ? `<div class="why bad" role="alert">${q.why}</div>` : ''}
      <div class="btn-row"><button class="btn ghost" data-act="specialization-open" data-arg="${q.hub.id}">Back</button><button class="btn" data-act="specialization-apply" ${q.why ? 'disabled' : ''}>Choose ${q.profile.name}</button></div>`);
  }

  const projectTime = minutes => minutes>=1440 ? `${(minutes/1440).toFixed(minutes%1440?1:0)} day${minutes===1440?'':'s'}` : `${Math.max(0,Math.ceil(minutes/60))}h`;
  function projectSummary(h) {
    const sites=(h.projects || []).filter(p=>!['cancelled','removed'].includes(p.status)),pending=sites.find(p=>p.status==='awaiting'),building=sites.find(p=>p.status==='building');
    const status=building && game.projectStatus(h.id,building.id);
    return `<div class="item project-summary"><div class="row"><b>Airport projects</b><span class="tag">${sites.length} / ${PROJECT_SITES} sites</span></div>
      <p class="note">${pending ? `${AIRPORT_PROJECTS[pending.kind].name} · ready for ${PROJECT_STAGES[pending.stage].name.toLowerCase()}.` : building ? `${AIRPORT_PROJECTS[building.kind].name} · ${PROJECT_STAGES[building.stage].name.toLowerCase()}, ${projectTime(status.stageLeft)} left.` : sites.length ? `Operating: ${sites.map(p=>AIRPORT_PROJECTS[p.kind].name).join(' · ')}.` : 'Choose long-term improvements for capacity, aircraft handling, freight or upkeep.'}</p>
      ${status?`<div class="meter"><i style="width:${status.progress*100}%"></i></div>`:''}
      <button class="btn ${pending?'':'ghost'} wide" data-act="projects-open" data-arg="${h.id}">${pending?'Review stage funding':'Plan & manage projects'}</button></div>`;
  }
  function projectTimeline(p) {
    return `<ol class="project-stages">${PROJECT_STAGES.map((stage,i)=>{
      const finished=p.status==='complete' || i<p.stage, current=i===p.stage && !finished;
      return `<li class="${finished?'done':current?'current':''}"><span class="project-step">${finished?'✓':i+1}</span><div><b>${stage.name}</b><span class="sub">${projectTime(p.durations[i])} · ${fmtMoney(p.payments[i])} ${i<p.stage || p.status==='complete' || current && p.status==='building'?'paid':current && p.status==='awaiting'?'to continue':current && p.status==='planned'?'due now':'later'}</span>${current?`<span class="sub ${p.status==='awaiting'?'amber':''}">${p.status==='building'?`${projectTime(p.durations[i]-p.worked)} remaining`:p.status==='awaiting'?'Waiting for your payment':'Not started'}</span>`:''}</div></li>`;
    }).join('')}</ol>`;
  }
  function projectModal() {
    const r=projectReview;if(!r)return;
    const header=label=>`<div class="row"><div class="eyebrow">${label}</div><button class="x" data-act="close-modal" aria-label="Close airport projects">×</button></div>`;
    if(r.mode==='list'){
      const hubs=game.state.hubs.filter(h=>(!r.hubId || h.id===r.hubId) && (!r.pendingOnly || (h.projects || []).some(p=>p.status==='awaiting')));
      const rows=hubs.map(h=>{
        const projects=(h.projects || []).filter(p=>!['cancelled','removed'].includes(p.status));
        return `<section class="project-hub"><div class="row"><h3>${h.id} · ${esc(AIRPORT_BY_ID[h.id].city)}</h3><span class="sub">${projects.length} / ${PROJECT_SITES} sites</span></div>
          ${projects.map(p=>{const st=game.projectStatus(h.id,p.id);return `<div class="item"><div class="row"><b>${st.profile.name}</b><span class="tag ${p.status==='awaiting'?'amber':''}">${p.status==='complete'?'Operating':p.status==='awaiting'?'Needs funding':PROJECT_STAGES[p.stage].name}</span></div><p class="note">${p.status==='complete'?st.profile.benefit:`${Math.floor(st.progress*100)}% complete · ${p.status==='awaiting'?fmtMoney(st.nextAmount)+' to continue':projectTime(st.stageLeft)+' left in this stage'}`}</p>${p.status!=='complete'?`<div class="meter"><i style="width:${st.progress*100}%"></i></div>`:''}<button class="btn ghost wide" data-act="project-detail" data-arg="${h.id}:${p.id}">${p.status==='awaiting'?'Review funding':'View project'}</button></div>`;}).join('')}
          ${r.hubId && !r.pendingOnly?`<div class="section-label">Choose a project</div><div class="project-options">${Object.entries(AIRPORT_PROJECTS).filter(([kind])=>!projects.some(p=>p.kind===kind)).map(([kind,v])=>{
            const q=game.projectQuote(h.id,kind);return `<div class="item project-option"><b>${v.name}</b><p class="note">${v.benefit}</p><div class="sub">${fmtMoney(q.total)} total · ${projectTime(q.durations.reduce((n,d)=>n+d,0))} construction</div><div class="sub">${v.upkeep?fmtMoney(v.upkeep)+'/day extra upkeep':'No extra project upkeep'}</div><button class="btn ghost wide" data-act="project-review" data-arg="${h.id}:${kind}:start">Compare project</button></div>`;}).join('')}</div>`:`<button class="btn ghost wide" data-act="projects-open" data-arg="${h.id}">Plan projects at ${h.id}</button>`}
        </section>`;
      }).join('');
      showModal(`${header('Airport development')}<h2>${r.pendingOnly?'Projects awaiting funding':'Build for the next chapter'}</h2><p>Two sites per hub. One project can be under construction or waiting for funding at a time. Pay 25%, 50%, then 25%; work pauses between stages until you choose to fund it.</p><p class="note">Preparation causes no delay. Active construction adds 20% to turnarounds at this hub; commissioning adds 10%. Waiting stages cause no delay. Benefits start only after completion.</p>${rows || '<div class="empty">No projects are waiting for funding.</div>'}<div class="btn-row">${r.pendingOnly?'<button class="btn ghost" data-act="projects-open" data-arg="all">All projects</button>':''}<button class="btn" data-act="close-modal">Back to game</button></div>`);return;
    }
    if(r.mode==='detail'){
      const st=game.projectStatus(r.hubId,r.id);if(!st){closeModal();return;}const p=st.project,v=st.profile,retired=['cancelled','removed'].includes(p.status);
      showModal(`${header(`${r.hubId} · airport project`)}<h2>${v.name}</h2><p>${retired?'This site is available again. Paid stages were not refunded, and this project provides no benefits or running costs.':v.benefit}</p><div class="item">${kv('Status',({building:PROJECT_STAGES[p.stage].name,awaiting:'Waiting for funding',complete:'Operating',cancelled:'Canceled',removed:'Removed'})[p.status])}${kv('Paid so far',fmtMoney(p.paid),'mono')}${['building','awaiting'].includes(p.status)?kv('Funding still needed',fmtMoney(p.total-p.paid),'mono')+kv('Construction remaining',projectTime(st.remaining),'mono'):''}${!retired?kv('Upkeep after completion',v.upkeep?fmtMoney(v.upkeep)+'/day extra':'No extra project upkeep'):''}</div>
        ${['building','awaiting','complete'].includes(p.status)?projectTimeline(p):''}
        ${p.status==='building'?`<p class="note">${PROJECT_STAGES[p.stage].delay?`${Math.round(PROJECT_STAGES[p.stage].delay*100)}% longer turnarounds at ${r.hubId} during this stage.`:'No turnaround delay during preparation.'} ${p.stage<2?'Work stops at the next stage until you fund it.':'The project opens automatically when this funded stage finishes.'}</p>`:p.status==='awaiting'?'<p class="why amber">Construction is paused. No extra fees or turnaround delay while you wait. Review the next payment when your budget is ready.</p>':''}
        <div class="btn-row">${page==='company' && companyPane==='history'?'<button class="btn ghost" data-act="close-modal">Back to history</button>':''}<button class="btn ghost" data-act="projects-open" data-arg="${r.hubId}">All hub projects</button>${p.status==='awaiting'?`<button class="btn" data-act="project-review" data-arg="${r.hubId}:${p.id}:fund">Review ${fmtMoney(st.nextAmount)} payment</button>`:''}${['building','awaiting'].includes(p.status)?`<button class="btn danger" data-act="project-review" data-arg="${r.hubId}:${p.id}:cancel">Cancel project…</button>`:p.status==='complete'?`<button class="btn danger" data-act="project-review" data-arg="${r.hubId}:${p.id}:remove">Remove project…</button>`:''}</div>`);return;
    }
    const q=game.projectQuote(r.hubId,r.action==='start'?r.kind:r.id,r.action);if(!q.hub){closeModal();return;}r.revision=q.revision;
    const removing=['cancel','remove'].includes(r.action),title=r.action==='start'?'Start':r.action==='fund'?`Fund ${PROJECT_STAGES[q.project.stage].name.toLowerCase()}`:r.action==='cancel'?'Cancel':'Remove';
    showModal(`${header('Review before applying')}<h2>${title} · ${q.profile.name}</h2><p>${r.hubId} · ${removing?'Paid stages are not refunded. The site will be free for another project.':q.profile.benefit}</p>
      ${r.action==='start'?`<div class="project-requirements">${q.requirements.map(x=>`<span class="${x.met?'good':'amber'}">${x.met?'✓':'○'} ${x.label} · ${x.value}/${x.target}</span>`).join('')}</div>`:''}
      <div class="item">${kv(removing?'Site clearance now':r.action==='start'?'Preparation payment now':'Stage payment now',fmtMoney(q.cost),'mono amber')}${kv('Cash after payment',fmtMoney(q.remaining),`mono ${q.remaining<0?'bad':''}`)}${!removing?kv('Later payments to finish',fmtMoney(q.remainingFunding),'mono')+kv('Total project budget',fmtMoney(q.total),'mono'):kv('Asset value written off',fmtMoney(q.writeOff),'mono')}${kv('Airport upkeep / day',`${fmtMoney(q.beforeUpkeep)} → ${fmtMoney(q.afterUpkeep)}`,'mono')}${kv('Route capacity',`${q.beforeRoutes} → ${q.afterRoutes}`,'mono')}${kv('Aircraft capacity',`${q.beforeGates} → ${q.afterGates}`,'mono')}</div>
      ${!removing?`<p class="note amber">${r.action==='start'?'Preparation adds no delay. Main construction adds 20% to local turnarounds; commissioning adds 10%.':`${Math.round(PROJECT_STAGES[q.project.stage].delay*100)}% longer turnarounds at ${r.hubId} during this funded stage.`} Benefits and extra upkeep start after completion.</p>`+projectTimeline(q.project || {stage:0,status:'planned',worked:0,durations:q.durations,payments:q.payments}):''}
      <div class="item">${kv('Affected network profit / day',`${fmtSigned(q.before)} → ${fmtSigned(q.after)}`,'mono')}${!removing?kv(r.action==='fund'?'During this stage / day':'During main construction / day',fmtSigned(q.during),`mono ${signCls(q.during)}`):''}</div>
      <p class="note">Forecast includes routes touching this hub, aircraft upkeep and this airport’s upkeep. It uses today’s fleet, demand and fuel prices; new capacity earns nothing until you use it. Construction payments are separate capital spending. ${removing?'Removing a concourse requires enough spare route and aircraft capacity.':'Later stages need your approval and cash. Durations assume you fund each stage promptly. Costs are fixed when you start; airports with limited space take longer.'}</p>
      ${q.why?`<p class="why bad" role="alert">${esc(q.why)}</p>`:''}
      <div class="btn-row"><button class="btn ghost" data-act="${q.project?'project-detail':'projects-open'}" data-arg="${q.project?r.hubId+':'+q.project.id:r.hubId}">Back</button><button class="btn ${removing?'danger':''}" data-act="project-apply" ${q.why?'disabled':''}>${r.action==='start'?'Start preparation':r.action==='fund'?'Pay & continue':r.action==='cancel'?'Cancel project':'Remove project'}${q.cost?' · '+fmtMoney(q.cost):''}</button></div>`);
  }

  function airportTab(s) {
    const hub = game.activeHub;
    const a = AIRPORT_BY_ID[hub.id];
    const rank = rankFor(hub.levels);
    const pctDone = rank.nextAt ? ((rank.total - rank.at) / (rank.nextAt - rank.at)) * 100 : 100;
    const chips = s.hubs.length > 1
      ? `<div class="chips">${s.hubs.map((h) => `<button class="chip ${h.id === hub.id ? 'on' : ''}" data-act="hub" data-arg="${h.id}">${h.id}</button>`).join('')}</div>` : '';
    const ups = UPGRADE_KEYS.map((key) => {
      const u = UPGRADES[key], lvl = hub.levels[key];
      const cost = game.upgradeCost(hub, key);
      const effect = (l) => key==='terminal' ? `${UPGRADES.terminal.fx(l)}${projectEffects(hub).routes?' · +2 project routes':''}` : key==='gates' ? `${UPGRADES.gates.fx(l)}${projectEffects(hub).gates?' · +2 project gates':''}` : key === 'cargo' && hub.specialization === 'cargo' ? `Freight fills ${Math.round(game.cargoFill(hub, l) * 100)}% of every hold · freight rate ×2` : u.fx(l);
      const next = cost != null ? ` → <b>${effect(lvl + 1)}</b>` : '';
      return `<div class="item">
        <div class="row"><span class="name">${u.name}</span>${pips(lvl, maxLevel(key))}</div>
        <div class="fx">${effect(lvl)}${next}</div>
        ${cost != null
          ? `<button class="btn wide" data-act="upgrade" data-arg="${key}" ${game.whyNotUpgrade(key) ? 'disabled' : ''}>Upgrade · ${fmtMoney(cost)}</button>`
          : `<div class="sub">Fully upgraded</div>`}
      </div>`;
    }).join('');
    const left = rank.nextAt - rank.total;
    return `${chips}<div class="rank-card">
        <h2>${esc(a.city)} ${term(rank.name, 'rank')}</h2>
        <div class="bar"><i style="width:${pctDone}%"></i></div>
        <div class="sub">${rank.nextName ? `${plural(left, 'more upgrade')} to ${rank.nextName}` : 'Top rank reached'}</div>
      </div>
      ${specializationCard(hub)}
      ${projectSummary(hub)}
      ${airportMarketHTML(a, false, 'upgrades')}
      <div class="section-label">Upgrades</div>${ups}
      <div class="note">To open another hub, click an airport on the map once one of yours is a Regional Airport.</div>`;
  }

  // ---------- aircraft chips, the aircraft in hand, adding aircraft: shared by the side panel, the route card and the board ----------
  function pickedPlane() {
    const p = pick != null ? game.plane(pick) : null;
    if (!p) pick = null;
    return p;
  }
  function planeChip(p) {
    const hand = pickedPlane();
    const risk = game.breakdownRisk(p);
    const cls = `${hand === p ? 'on' : ''} ${p.phase === 'repair' ? 'broken' : risk > 0.03 ? 'worn' : ''} ${hand && hand !== p ? 'swap' : ''}`;
    const tip = `${AIRCRAFT[p.type].name} · ${AIRCRAFT[p.type].freighter ? AIRCRAFT[p.type].cargo+' t hold' : AIRCRAFT[p.type].seats+' seats'} · ${Math.floor(p.age)} days old${p.yday != null && p.routeId != null ? ` · ${fmtSigned(p.yday)} yesterday` : ''}${p.phase === 'repair' ? ' · in the hangar' : ''}\nClick to inspect. Drag onto a route or aircraft to preview a move or swap.`;
    return `<button class="pchip ${cls}" draggable="true" data-plane="${p.id}" data-act="select-plane" data-arg="${p.id}" data-tip="${esc(tip)}"><b>${p.name}</b> ${AIRCRAFT[p.type].name}</button>`;
  }
  // Assignment now uses an explicit preview instead of an aircraft-in-hand mode.
  function handHTML() { return ""; }
  // Seats against demand for a route, and the flag that goes with it.
  function fitOf(r) {
    const on = game.planesOn(r.id);
    const cargo = game.cargoOnly(r);
    const want = cargo ? game.cargoMarket(r)[r.cargoService || 'bulk']*2 : game.routeDemand(r)*2, seats = cargo ? game.freightCapacity(r) : game.seatsPerDay(r);
    const health = routeStatus({ aircraftCount: on.length, repairCount: on.filter((p) => p.phase === 'repair').length,
      conversionCount:on.filter(p=>p.conversion).length, cargo, freightAtRisk: game.freightStatus(r).atRisk, connectionsAtRisk: game.connectionStatus(r,false).atRisk,
      canDownsize: on.length === 1 && AIRCRAFT_LIST.some((t) => t.cls <= game.hub(r.hub).levels.runway && t.range >= r.km && !!t.freighter === cargo && (cargo ? t.cargo < AIRCRAFT[on[0].type].cargo : t.seats < AIRCRAFT[on[0].type].seats)),
      closed: !!(game.closed(r.dest) || game.closed(r.hub)), want, seats, profit: game.routeProfit(r),
      estimatedProfit: game.routeEstimate(r, on.map((p) => AIRCRAFT[p.type])) - on.reduce((sum, p) => sum + game.planeUpkeep(p) - AIRCRAFT[p.type].price * 0.008, 0) });
    const first = health.issues[0];
    const tag = first ? `<span class="route-flag ${first.tone}" data-tip="${esc(health.issues.map((i) => i.text).join('\n\n'))}">${first.label}${health.issues.length > 1 ? ` +${health.issues.length - 1}` : ''}</span>` : '';
    return { on, want, seats, tag, ...health };
  }

  function routeControls(routes, scope) {
    const states = routes.map(fitOf);
    const count = routes.filter(routeShown).length;
    return `${searchField('routes', routeQuery, 'Search routes or cities')}<div class="route-controls">
      <label>Show<select data-act="route-filter" aria-label="Filter ${scope} routes">${ROUTE_FILTERS.map(([id, label]) => `<option value="${id}" ${routeFilter === id ? 'selected' : ''}>${label} (${states.filter((h) => h.matches(id)).length})</option>`).join('')}</select></label>
      <label>Sort<select data-act="ops-sort" aria-label="Sort ${scope} routes">${OPS_SORTS.map(([id, label]) => `<option value="${id}" ${opsSort === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      </div><div class="route-results"><span>${count} of ${routes.length} routes${routeFilter === 'attention' ? ' · includes opportunities' : ''}</span>${routeFilter !== 'all' ? '<button class="detail-back" data-act="route-filter" data-arg="all">Clear filter</button>' : ''}</div>`;
  }
  function moveBtn(r) {
    const hand = pickedPlane();
    if (!hand || hand.routeId === r.id) return '';
    const why = game.whyNotMove(hand.id, r.id);
    return `<button class="btn small" data-act="ops-move" data-arg="${r.id}" ${why ? `disabled data-tip="${esc(why)}"` : ''}>Move here</button>`;
  }
  const addBtn = (r) => `<button class="pchip add ${addFor === r.id ? 'on' : ''}" data-act="ops-add" data-arg="${r.id}">${addFor === r.id ? 'Close' : '+ aircraft'}</button>`;
  // Parked aircraft that could fly a route, and the types worth buying for it.
  function addPanelHTML(r) {
    const s = game.state, hub = game.hub(r.hub);
    const on = game.planesOn(r.id);
    const idle = s.planes.filter((x) => x.routeId == null && !game.whyNotMove(x.id, r.id));
    const fits = game.fitsFor(r, on.length + 1);
    return `<div class="ops-add">
      ${idle.length ? `<div class="sub">Parked aircraft that can fly it:</div><div class="btn-row wrap">${idle.map((x) => `<button class="btn small" data-act="ops-assign" data-arg="${x.id}:${r.id}">${x.name} ${AIRCRAFT[x.type].name}${x.hub !== r.hub ? ` (from ${x.hub})` : ''}</button>`).join('')}</div>` : ''}
      <div class="sub" style="margin-top:${idle.length ? 8 : 0}px">Buy one for this route. The figure is what it would earn a day here${on.length ? ` alongside the ${on.length} already flying` : ''}:</div>
      ${fits.map((x, i) => {
        const wn = game.whyNotBuyFor(r.id, x.type.id), wu = game.whyNotBuyFor(r.id, x.type.id, true);
        return `<div class="ops-buy"><div>${i === 0 ? '<span class="amber">★</span> ' : ''}${x.type.name} <span class="sub">${x.type.freighter ? x.type.cargo+' t hold' : x.type.seats+' seats'}, ${Math.round(x.load * 100)}% full</span> <span class="mono ${signCls(x.profit)}">${fmtSigned(x.profit)}/day</span></div>
          <div class="btn-row" style="margin:4px 0 0"><button class="btn small" data-act="ops-buy" data-arg="${r.id}:${x.type.id}:0" ${wn ? `disabled data-tip="${esc(wn)}"` : ''}>New ${fmtMoney(game.planePrice(x.type.id))}</button>
          <button class="btn ghost small" data-act="ops-buy" data-arg="${r.id}:${x.type.id}:1" ${wu ? `disabled data-tip="${esc(wu)}"` : ''} ${wu ? '' : tipAttr('used')}>Used ${fmtMoney(game.planePrice(x.type.id, true))}</button>
          <button class="btn ghost small" data-act="lease-review" data-arg="${r.hub}:${x.type.id}:${r.id}">Review lease</button></div></div>`;
      }).join('') || '<div class="sub bad">No aircraft this hub’s runway can take reaches that far.</div>'}
      ${game.planesAt(hub.id).length >= game.planeCap(hub) ? `<div class="why bad">Every gate at ${hub.id} is taken. Upgrade the gates, or sell or move an aircraft.</div>` : ''}
    </div>`;
  }
  // The route the card on the right is showing, if any; its "+ aircraft" list opens there rather than in the list.
  function cardRouteId() {
    if (!sel || !game.state) return null;
    if (sel.kind === 'route') return sel.id;
    if (sel.kind === 'airport') return game.routeTo(game.state.active, sel.id)?.id ?? null;
    return null;
  }
  const hubChips = (s, act = 'hub') => (s.hubs.length > 1
    ? `<div class="chips">${s.hubs.map((h) => `<button class="chip ${h.id === s.active ? 'on' : ''}" data-act="${act}" data-arg="${h.id}">${h.id}</button>`).join('')}</div>` : '');
  const sortRoutes = (routes) => [...routes].sort({
    profit: (x, y) => (game.routeProfit(x) ?? 0) - (game.routeProfit(y) ?? 0),
    demand: (x, y) => game.routeDemand(y) - game.routeDemand(x),
    name: (x, y) => AIRPORT_BY_ID[x.dest].city.localeCompare(AIRPORT_BY_ID[y.dest].city),
  }[opsSort]);

  // The hub's home screen: every route with the aircraft that fly it.
  function routesTab(s) {
    const hub = game.activeHub;
    const planes = game.planesAt(hub.id), routes = game.routesAt(hub.id);
    const parked = planes.filter((p) => p.routeId == null && !p.conversion);
    const profit = routes.reduce((n, r) => n + (game.routeProfit(r) ?? 0), 0);
    const hand = pickedPlane();
    const inCard = cardRouteId();
    const rows = sortRoutes(routes).filter(routeShown).map((r) => {
      const d = AIRPORT_BY_ID[r.dest];
      const { on, tag, issues } = fitOf(r);
      const y = r.yesterday;
      const p = game.routeProfit(r);
      const load = game.cargoOnly(r) ? y?.freight?.capacity ? Math.round(y.freight.delivered/y.freight.capacity*100) : null : y?.seats ? Math.round(y.pax/y.seats*100) : null;
      return `<div class="item rrow compact-route ${hand && hand.routeId === r.id ? 'has-pick' : ''} ${inCard === r.id ? 'sel' : ''}" data-drop-route="${r.id}">
        <button class="route-line" data-act="select-route" data-arg="${r.id}" aria-label="${r.dest} ${esc(d.city)} route details">
          <span class="route-dest"><b class="mono amber">${r.dest}</b><span>${esc(d.city)}</span></span>
          <span class="mono ${p == null ? '' : signCls(p)}">${p == null ? '—' : fmtSigned(p)}</span><span class="mono sub">${load == null ? '—' : `${load}%`}</span></button>
        ${tag ? `<button class="route-status-link" data-act="select-route" data-arg="${r.id}" aria-label="Review ${r.dest}: ${esc(issues.map((i) => i.label).join(', '))}">${tag}<span aria-hidden="true">›</span></button>` : ''}
        <details class="route-aircraft" data-section="aircraft-${r.id}"><summary>${plural(on.length, 'aircraft')}${on.length ? '' : ' · assign'}${game.contractsFor(r.dest, r.hub).some((c) => c.due != null) ? ' · ◆ contract' : ''}</summary>
          <div class="ops-planes">${on.map(planeChip).join('')}${addBtn(r)}</div></details>
        ${moveBtn(r)}${addFor === r.id && inCard !== r.id ? addPanelHTML(r) : ''}
      </div>`;
    }).join('');
    return `${hubChips(s)}<div class="item hubsum">
        <div class="row"><span ${tipAttr('routesUsed')}><b>${routes.length}</b> / ${game.routeCap(hub)} routes</span><span ${tipAttr('gatesUsed')}><b>${planes.length}</b> / ${game.planeCap(hub)} gates</span><span class="mono ${signCls(profit)}" data-tip="Yesterday’s profit of this hub’s routes, after the upkeep of their aircraft.">${fmtSigned(profit)}</span></div>
        <div class="btn-row" style="margin-top:8px">
          <button class="btn small" data-act="page" data-arg="finder" data-tip="Every airport this hub can reach, ranked by what a route there would earn.">Find routes</button>
          <button class="btn ghost small" data-act="autofit" data-arg="${hub.id}" ${planes.length && routes.length ? '' : 'disabled'} data-tip="Works out the best route for each of this hub’s aircraft and shows you the plan before changing anything.">Auto-fit</button>
        </div>
      </div>
      ${handHTML()}
      ${parked.length || hand ? `<div class="item parked" data-drop-park="${hub.id}"><span class="sub" ${tipAttr('parked')}>Parked${parked.length ? '' : ': none'}</span>${parked.map(planeChip).join('')}</div>` : ''}
      ${routes.length ? routeControls(routes, 'hub') : ''}
      ${rows ? `<div class="route-list-head"><span>Destination</span><span>Profit</span><span>Full</span></div>${rows}` : routes.length ? '<div class="empty">No routes match your search and filter.<br><button class="btn ghost small" data-act="reset-routes">Show all routes</button></div>' : `<div class="empty">No routes from ${hub.id} yet. Press “Find routes” to plan your first flight.</div>`}
      <div class="note">Profit and seats or hold filled are yesterday’s results; — means no data. Select a route for advice, or expand its aircraft to assign, move or swap.</div>`;
  }

  // Every destination the active hub could open today, ranked.
  function finderTab(s) {
    const hub = game.activeHub;
    const origin = AIRPORT_BY_ID[hub.id];
    const range = game.maxRange(hub);
    const used = game.routesAt(hub.id).length, cap = game.routeCap(hub);
    let rows = AIRPORTS
      .filter((a) => a.id !== hub.id && !game.routeTo(hub.id, a.id) && !game.routeTo(a.id, hub.id) && distKm(origin, a) <= range)
      .map(a=>{const e=game.estimate(hub.id,a.id,null,null,finderKind);if(finderKind==='cargo'){e.total=game.cargoMarket({hub:hub.id,dest:a.id,km:e.km}).bulk;e.rivals=s.rivals.filter(rv=>rv.hub && rv.routes.some(r=>AIRCRAFT[r.type].freighter && (r.hub===hub.id && r.dest===a.id || r.dest===hub.id && r.hub===a.id)));}return {a,e};}).filter(x=>x.e.best);
    const total = rows.length;
    rows = rows.filter((x) => airportMatches(x.a, finderQuery));
    if (finderClear) rows = rows.filter((x) => !x.e.rivals.length);
    if (finderNew) rows = rows.filter((x) => !game.isServed(x.a.id));
    if (finderMarket !== 'all') rows = rows.filter((x) => x.a.market.id === finderMarket);
    const by = {
      profit: (x, y) => y.e.best.profit - x.e.best.profit, demand: (x, y) => y.e.total - x.e.total,
      near: (x, y) => x.e.km - y.e.km,
    }[finderSort];
    rows.sort(by);
    const list = rows.slice(0, 40).map(({ a, e }) => {
      const cost = game.openCost(e.km);
      const why = game.whyNotOpen(a.id);
      const tags = [
        ...e.rivals.map((r) => `<span class="nowrap"><span class="dot" style="background:${r.color}"></span>${r.name}</span>`),
        ...game.contractsFor(a.id).map((c) => `<span class="nowrap" style="color:${CONTRACT_COLOR}">◆ contract ${fmtMoney(c.reward)}</span>`),
        ...(e.event > 1.05 ? ['<span class="nowrap amber">★ event now</span>'] : []),
      ].join(' ');
      return `<div class="item">
        <div class="row"><button class="linkish name" data-act="select" data-arg="${a.id}"><span class="mono amber">${a.id}</span> ${esc(a.city)}</button>
          <span class="mono ${signCls(e.best.profit)} nowrap">${fmtSigned(e.best.profit)} / day</span></div>
        <div class="sub" style="margin-top:3px">${a.market.name} · ${km(e.km)} · ${finderKind==='cargo'?e.total.toFixed(1)+' t bulk freight' : Math.round(e.total)+' passengers'} a day each way · ${e.best.type.name} ${Math.round(e.best.load * 100)}% full</div>
        <div class="row" style="margin-top:7px"><span class="sub">${tags || 'No competition'}<br>Route fee ${fmtMoney(cost)} · aircraft extra</span>
          <button class="btn small nowrap" data-act="open-route" data-arg="${a.id}" ${why ? 'disabled' : ''} ${why ? `title="${esc(why)}"` : ''}>Plan route</button></div>
      </div>`;
    }).join('');
    const chips = s.hubs.length > 1
      ? `<div class="chips">${s.hubs.map((h) => `<button class="chip ${h.id === hub.id ? 'on' : ''}" data-act="hub-quiet" data-arg="${h.id}">${h.id}</button>`).join('')}</div>` : '';
    return `${chips}<div class="item">
        ${kv(`From ${hub.id}`, `${used} of ${cap} routes in use`, used >= cap ? 'bad' : '')}
        ${kv(term('Runway reaches', 'reach'), km(range), 'mono')}
        ${used >= cap ? '<div class="why">The terminal is full. Upgrade it, or close a route, before opening another.</div>' : ''}
      </div>
      <div class="seg service-options" aria-label="Route business">${[['passenger','Passenger'],['cargo','Freight']].map(([id,label])=>`<button data-act="finder-kind" data-arg="${id}" class="${finderKind===id?'on':''}" aria-pressed="${finderKind===id}">${label}</button>`).join('')}</div>
      ${finderKind==='cargo' && !hub.levels.cargo ? '<p class="why amber">Build a cargo terminal at this hub to plan freight routes.</p>' : ''}
      ${searchField('finder', finderQuery, 'Search destinations')}<label class="market-filter">Airport market<select data-act="finder-market" aria-label="Airport market"><option value="all" ${finderMarket === 'all' ? 'selected' : ''}>All markets</option>${Object.entries(MARKET_PROFILES).map(([id, m]) => `<option value="${id}" ${finderMarket === id ? 'selected' : ''}>${m.name}</option>`).join('')}</select></label><div class="chips">${FINDER_SORTS.map(([id, name]) => `<button class="chip ${finderSort === id ? 'on' : ''}" data-act="finder-sort" data-arg="${id}">${name}</button>`).join('')}
        <button class="chip ${finderClear ? 'on' : ''}" data-act="finder-clear">No rivals</button>
        <button class="chip ${finderNew ? 'on' : ''}" data-act="finder-new" data-tip="Only airports that none of your hubs serves yet. Each one counts toward connecting the world.">New to your network</button></div>
      ${list || (total && (finderQuery || finderClear || finderNew || finderMarket !== 'all') ? '<div class="empty">No destinations match your search and filter.<br><button class="btn ghost small" data-act="reset-finder">Show all destinations</button></div>' : '<div class="empty">No new destinations in range. A longer runway reaches further.</div>')}
      <div class="note">${finderQuery || finderClear || finderNew || finderMarket !== 'all' ? `${rows.length} of ${total} destinations match. ` : ''}${rows.length > 40 ? `Showing the best 40 of ${rows.length}. ` : ''}${total} airports are in range. Profit is an estimate for one new aircraft of the type shown ${finderKind==='cargo'?'with Bulk freight, including expected deadline penalties':'at the standard fare'}, after its upkeep. Select a destination name to inspect it on the map.</div>`;
  }

  // ---------- contracts and reputation ----------
  function contractItem(c) {
    const s = game.state, d = AIRPORT_BY_ID[c.dest];
    const title = c.kind === 'cargo'
      ? `Deliver ${c.amount} t of ${c.what} to ${d.city}`
      : `Fly ${c.amount.toLocaleString()} ${c.what} to and from ${d.city}`;
    const routes = s.routes.filter((r) => r.dest === c.dest && (!c.series || r.hub === c.hub));
    const flown = routes.some((r) => game.planesOn(r.id).length);
    const unit = c.kind === 'cargo' ? 't' : 'passengers';
    let body;
    if (c.due != null) {
      const left = c.due - s.day;
      const need = c.paid ? '' : !routes.length ? `You have no route to ${c.dest} yet.` : !flown ? `No aircraft is flying to ${c.dest}.` : '';
      body = `<div class="meter"><i style="width:${Math.min(100, (c.done / c.amount) * 100)}%;background:${CONTRACT_COLOR}"></i></div>
        <div class="row sub"><span>${Math.floor(c.done).toLocaleString()} of ${c.amount.toLocaleString()} ${unit}</span>
          <span class="${!c.paid && left <= 2 ? 'bad' : ''}">${left > 0 ? `${plural(left, 'day')} left` : 'due today'} · ${fmtDate(c.due)}${c.series ? ' · 00:00' : ' · end of day'}</span></div>
        ${c.paid ? `<div class="why good">Week ${c.series.week} paid. Next target starts ${fmtDate(c.due)}.</div>` : ''}
        ${need ? `<div class="why bad">${need}</div>` : ''}
        <button class="btn ghost small" style="margin-top:8px" data-act="contract-show" data-arg="${c.id}">Show ${c.dest} on map</button>
        ${!c.paid && !c.finished && c.done < c.amount && s.minute < contractDeadline(c) ? `<button class="btn ghost small" data-act="response-open" data-arg="contract:${c.id}">Protect contract</button>` : ''}`;
    } else {
      const ends = c.expires - s.day;
      body = `<div class="sub">${plural(c.days, 'day')} to finish once signed · ${routes.length ? `you already fly to ${c.dest}` : `needs a new route from ${c.hub}`}${c.kind === 'cargo' ? ' · counts freight in your holds' : ' · brings its own passengers'}</div>
        <div class="row" style="margin-top:8px"><span class="sub">${ends > 0 ? `Offer ends in ${plural(ends, 'day')}` : 'Offer ends today'}</span>
          <span class="btn-row" style="margin:0"><button class="btn ghost small" data-act="contract-show" data-arg="${c.id}">Show on map</button><button class="btn ghost small" data-act="contract-no" data-arg="${c.id}">Decline</button>
          <button class="btn small" data-act="contract-yes" data-arg="${c.id}">Sign</button></span></div>`;
    }
    return `<div class="item clickable" data-act="contract-show" data-arg="${c.id}" style="border-left:3px solid ${CONTRACT_COLOR}">
      <div class="sub">${esc(clientOf(c)?.name || 'Charter client')} · ${c.series ? `Week ${c.series.week} of ${c.series.weeks} · ${c.hub} ⇄ ${c.dest}` : 'One-off job'}</div>
      <div class="row"><span class="name">${esc(title)}</span><span class="mono good nowrap" ${tipAttr('contractReward')}>${fmtSigned(c.reward)}${c.series ? ' / week' : ''}</span></div>${body}</div>`;
  }
  function clientsHTML(s) {
    const known = CLIENTS.filter((c) => s.clients?.[c.id] || s.contracts.some((job) => job.clientId === c.id));
    return `<div class="section-label">Client relationships</div>${known.map((c) => {
      const record = game.clientRecord(c.id), q = game.repeatQuote(c.id);
      return `<div class="item"><div class="row"><b>${c.name}</b><span class="sub">Trust ${record.trust} / 5</span></div>
        <div class="sub">${record.completed} completed · ${record.missed} missed${record.lastJob ? ` · ${record.lastJob.hub} ⇄ ${record.lastJob.dest}` : ''}</div>
        ${record.lastJob ? `<button class="btn ghost wide" data-act="client-repeat" data-arg="${c.id}" ${q.why ? 'disabled' : ''}>Review repeat work</button>` : ''}
        <div class="note">${q.why || 'Three weekly targets, with a payout for each. Review before signing.'}</div></div>`;
    }).join('') || '<div class="sub">Finish your first charter to unlock repeat work.</div>'}`;
  }
  function contractsTab(s) {
    if (contractReview) {
      const { id, hub, back } = contractReview;
      const list = s.contracts.filter((c) => id != null ? c.id === id : (hub === 'all' || c.hub === hub) && contractDueSoon(c, s.day)).sort((a, b) => a.due - b.due);
      return `<button class="detail-back" data-act="contract-review-back">← Back to ${back === 'ops' ? 'Operations' : 'News'}</button>
        <div class="section-label">${id != null ? 'Contract details' : `Due within 3 days · ${hub === 'all' ? 'all hubs' : hub}`}</div>
        ${list.map(contractItem).join('') || '<div class="empty">No active contracts match this view. Completed or expired contracts clear automatically.</div>'}
        <button class="btn ghost wide" data-act="contract-review-all">Show all contracts</button>`;
    }
    const rep = s.rep, target = game.repTarget();
    const active = s.contracts.filter((c) => c.due != null).sort((a, b) => a.due - b.due);
    const offers = s.contracts.filter((c) => c.due == null);
    const parts = game.repParts().map((p) => kv(`${p.label} <span class="sub">· ${p.tip}</span>`, `${p.v >= 0 ? '+' : '−'}${Math.abs(p.v)}`, `mono ${p.v > 0 ? 'good' : p.v < 0 ? 'bad' : ''}`)).join('');
    const trend = Math.abs(target - rep) < 1.5 ? 'steady' : target > rep ? `rising toward ${target}` : `falling toward ${target}`;
    return `<div class="rank-card">
        <h2>${term('Reputation', 'reputation')} ${Math.round(rep)} · ${repName(rep)}</h2>
        <div class="bar"><i style="width:${rep}%"></i></div>
        <div class="sub">Base passenger confidence ${pct(game.repFactor())} · ${trend}</div>
      </div>
      <div class="item">${kv('Starting point', '50', 'mono')}${parts}
        <div class="note">Reputation moves a tenth of the way to that total each day. Finished contracts add 3; intermediate weeks in a repeat agreement add 1; a missed contract costs 4, a breakdown up to 1 (less in a big fleet). Active storms cost 1 point per day and strikes 4, capped at 4 across closures before compensation. Losses accrue over time; passenger compensation halves the remaining penalty for its closure.</div></div>
      <div class="section-label"><span>Signed</span><span>${active.length} / 3</span></div>
      ${active.map(contractItem).join('') || '<div class="sub" style="margin-bottom:8px">No contracts running.</div>'}
      ${clientsHTML(s)}
      <div class="section-label"><span>On offer</span><span>${offers.length}</span></div>
      ${offers.map(contractItem).join('') || `<div class="sub">${s.flights ? 'Nothing on offer today. New work turns up every few days.' : 'Offers start arriving once your first flight has landed.'}</div>`}
      <div class="note">Contract airports are ringed in green on the map and marked ◆: dashed while on offer, solid once signed. One-off jobs count traffic from any hub. Repeat work counts only its named route, with a separate target each week. Missing a target ends the agreement. One-off deadlines run through the end of the stated day. Weekly targets close at 00:00 on their deadline date. Both also show on the calendar.</div>`;
  }

  // ---------- news log and weekly report ----------
  function logTab(s) {
    const active = operationsAttention(game).alerts.length;
    const rows = s.log.map((l) => {
      const target = resolveAlertTarget(game, l);
      return `<div class="item log ${l.kind}">
        <div class="sub mono">Day ${l.day + 1} · ${String(Math.floor(l.min / 60)).padStart(2, '0')}:${String(l.min % 60).padStart(2, '0')}</div>
        <div>${esc(l.text)}</div>${target ? `<button class="btn ghost small log-action" data-act="alert-open" data-arg="${target.kind}:${target.id}">${alertTargetLabel(target)}</button>` : l.target ? '<div class="sub">This item is no longer active.</div>' : ''}</div>`;
    }).join('');
    return `<div class="item"><div class="row"><span class="name">Active problems</span><b class="mono ${active ? 'amber' : 'good'}">${active}</b></div>
      <div class="sub">Current issues clear when resolved. Announcements below stay as history.</div>
      <button class="btn ghost wide log-action" data-act="ops">Review in Operations</button></div>
      ${s.report ? `<button class="btn ghost wide" data-act="report" style="margin-bottom:10px">Weekly report · week to ${fmtDate(s.report.day - 1)}</button>` : ''}
      <div class="section-label">Recent news · history</div>
      ${rows || '<div class="empty">Nothing has happened yet.</div>'}
      <div class="note">The last 60 announcements, newest first. Use the action on an entry to inspect its route, aircraft or destination.</div>`;
  }
  function reportModal(r) {
    const change = r.prev == null ? '' : `<span class="sub"> · ${fmtSigned(r.profit - r.prev)} on the week before</span>`;
    const routeLine = (x) => `<button class="chip" data-act="report-route" data-arg="${x.id}">${x.hub} ⇄ ${x.dest}</button> <span class="mono ${signCls(x.v)}">${fmtSigned(x.v)}</span>`;
    const dRep = r.rep - r.repWas;
    showModal(`<div class="row"><div class="eyebrow" style="margin:0">Weekly report · to ${fmtDate(r.day - 1)}</div><button class="x" data-act="close-modal" aria-label="Close">×</button></div>
      <div class="big ${signCls(r.profit)}">${fmtSigned(r.profit)}</div>
      <p style="margin-top:0">Profit this week${change}</p>
      ${r.best ? kv('Best route', routeLine(r.best)) : ''}
      ${r.worst ? kv('Worst route', routeLine(r.worst)) : ''}
      ${kv('Passengers', r.pax.toLocaleString(), 'mono')}
      ${kv(term('Reputation', 'reputation'), `${r.rep} <span class="${dRep > 0 ? 'good' : dRep < 0 ? 'bad' : 'sub'}">${dRep > 0 ? '+' : dRep < 0 ? '−' : '±'}${Math.abs(dRep)}</span>`, 'mono')}
      ${kv('Fuel price', `${Math.round(r.fuel * 100)}% of normal`, `mono ${r.fuel > 1.1 ? 'bad' : r.fuel < 0.92 ? 'good' : ''}`)}
      ${kv(term('Company value', 'companyValue'), fmtMoney(r.value), 'mono')}
      <div class="card-actions"><button class="btn wide" data-act="close-modal">Carry on</button>
        <button class="btn ghost wide" data-act="weekly-toggle">${weeklyOff ? 'Show this every week' : 'Don’t show this every week'}</button></div>`);
  }
  function listedModal(l) {
    showModal(`<div class="eyebrow">Day ${l.day + 1}</div><h2>The bell rings. You are a public company.</h2>
      <div class="big good">${fmtMoney(l.value)}</div>
      <p>That is what the market says your airline is worth. The listing raised ${fmtMoney(l.raised)} in cash. There is nothing left to prove, but the airports are still yours to run.</p>
      <div class="card-actions"><button class="btn wide" data-act="close-modal">Keep flying</button></div>`);
  }

  // ---------- every aircraft you own, across all hubs (the board's second view) ----------
  function fleetControls(planes, scope) {
    return `${searchField('fleet', fleetQuery, 'Search aircraft, routes or cities')}<div class="fleet-controls"><label>Show aircraft<select data-act="fleet-filter" aria-label="Filter ${scope} fleet">${FLEET_FILTERS.map(([id, label]) => `<option value="${id}" ${fleetFilter === id ? 'selected' : ''}>${label} (${planes.filter((p) => fleetMatches(game, p, id)).length})</option>`).join('')}</select></label>
      <div class="route-results"><span>${planes.filter(planeShown).length} of ${planes.length} aircraft</span>${fleetFilter !== 'all' ? '<button class="detail-back" data-act="fleet-filter" data-arg="all">Clear filter</button>' : ''}</div></div>`;
  }
  const fleetEmpty = '<div class="empty">No aircraft match your search and filter.<br><button class="btn ghost small" data-act="reset-fleet">Show all aircraft</button></div>';

  function fleetFlags(p) {
    return [
      p.routeId == null && !p.conversion ? `<span class="tag bad" ${tipAttr('parked')}>parked</span>` : '',
      p.lease ? `<span class="tag ${leaseDaysLeft(game.state, p) <= 3 ? 'amber' : ''}">${p.lease.returning ? 'returning after landing' : `lease · ${leaseDaysLeft(game.state, p)} days left`}</span>` : '',
      p.phase === 'repair' ? '<span class="tag bad">in repair</span>' : '',
      p.conversion ? '<span class="tag amber">in conversion</span>' : AIRCRAFT[p.type].freighter ? '<span class="tag">freighter</span>' : '',
      fleetMatches(game, p, 'losing') ? `<span class="tag bad" ${tipAttr('losing')}>losing money</span>` : '',
      fleetMatches(game, p, 'maintenance') ? '<span class="tag amber">high maintenance</span>' : '',
    ].filter(Boolean).join(' ');
  }

  function aircraftListHTML(s) {
    if (!s.planes.length) return '<div class="empty">There are no aircraft in your fleet yet.</div>';
    const by = {
      profit: (a, b) => (a.routeId == null ? -1e12 : a.yday ?? 0) - (b.routeId == null ? -1e12 : b.yday ?? 0),
      age: (a, b) => b.age - a.age,
      hub: (a, b) => a.hub.localeCompare(b.hub) || a.id - b.id,
    }[fleetSort];
    const scoped = s.planes.filter((p) => opsHub === 'all' || p.hub === opsHub);
    const shown = scoped.filter(planeShown);
    const rows = [...shown].sort(by).map((p) => {
      const t = AIRCRAFT[p.type];
      const r = game.route(p.routeId);
      const risk = game.breakdownRisk(p);
      const flags = fleetFlags(p);
      return `<div class="ops-row air ${pick === p.id ? 'has-pick' : ''}">
        <div class="ops-c">${planeChip(p)}</div>
        <div class="ops-c">${r ? `<button class="linkish" data-act="ops-route" data-arg="${r.id}">${r.hub} ⇄ <span class="mono amber">${r.dest}</span> ${esc(AIRPORT_BY_ID[r.dest].city)}</button>` : `<span class="sub">at ${p.hub}</span>`}</div>
        <div class="ops-c mono">${Math.floor(p.age)} <span class="sub">days</span></div>
        <div class="ops-c mono ${risk > 0.03 ? 'bad' : ''}">${(risk * 100).toFixed(1)}%</div>
        <div class="ops-c mono ${r && p.yday != null ? signCls(p.yday) : ''}">${r && p.yday != null ? fmtSigned(p.yday) : '—'}</div>
        <div class="ops-c">${flags}</div>
      </div>`;
    }).join('');
    return `${fleetControls(scoped, 'operations')}<div class="btn-row wrap" style="margin-bottom:10px">
        <button class="btn ghost small" data-act="fleet-batch" data-arg="assign">Assign parked aircraft…</button>
        <button class="btn ghost small" data-act="fleet-batch" data-arg="maintain">Maintain worn aircraft…</button>
        <span class="ops-gap"></span>
        ${FLEET_SORTS.map(([id, name]) => `<button class="chip ${fleetSort === id ? 'on' : ''}" data-act="fleet-sort" data-arg="${id}">${name}</button>`).join('')}
      </div>
      ${rows ? `<div class="ops-table"><div class="ops-row air ops-head"><div>Aircraft</div><div>Route</div><div>${term('Age', 'age')}</div><div>${term('Risk', 'risk')}</div><div>${term('Yesterday', 'planeYesterday')}</div><div></div></div>${rows}</div>` : fleetEmpty}
      <div class="note">${shown.length} shown · ${fmtMoney(shown.reduce((n, p) => n + game.planeUpkeep(p), 0))}/day upkeep. High maintenance means age 150+ days or breakdown risk above 3%. Click an aircraft to inspect and preview changes.</div>`;
  }

  // Live departures board under the airport close-up.
  function viewLegend(id) {
    const s = game.state, h = game.hub(id);
    const planes = game.planesAt(id);
    const hm = (m) => `${Math.floor(m / 60)}h ${String(Math.floor(m % 60)).padStart(2, '0')}m`;
    const rows = planes.map((p) => {
      const r = game.route(p.routeId), t = AIRCRAFT[p.type];
      const seats = r ? game.seatsFor(t, r.cabin) : null;
      const cap = seats ? seats.eco + seats.biz : 0;
      let status, cls = '';
      if (!r) { status = 'Parked, no route'; cls = 'bad'; }
      else if (p.phase === 'repair') { status = `In the hangar, ${hm(Math.max(0, 720 - p.t))} to go`; cls = 'bad'; }
      else if (p.phase === 'home') status = game.closed(r.hub) || game.closed(r.dest) ? 'Held: airport closed' : p.t < game.turnaround(t,id) ? `Turning around, ${Math.ceil(game.turnaround(t,id) - p.t)} min` : `Boarding ${Math.min(cap, Math.floor(r.poolOut))} / ${cap}`;
      else if (p.phase === 'out') status = `Flying out, ${p.pax + p.biz} on board`;
      else if (p.phase === 'turn') status = `On the ground in ${r.dest}`;
      else status = `Inbound, lands in ${hm(Math.max(0, p.dur - p.t))}`;
      return `<tr><td class="mono amber">${p.name}</td><td>${t.name}</td><td class="mono">${r ? r.dest : '—'}</td><td class="${cls}">${status}</td>
        <td class="mono ${p.yday != null && r ? signCls(p.yday) : ''}">${p.yday != null && r ? fmtSigned(p.yday) : '—'}</td></tr>`;
    }).join('');
    const today = game.routesAt(id).reduce((n, r) => n + r.today.flights, 0);
    const paxToday = game.routesAt(id).reduce((n, r) => n + r.today.pax, 0);
    return `<span><b>${planes.length}</b> of ${game.planeCap(h)} stands taken</span>
      <span><b>${planes.filter((p) => ['home', 'idle', 'repair'].includes(p.phase)).length}</b> on the ground now</span>
      <span><b>${today}</b> flights and <b>${paxToday.toLocaleString()}</b> passengers so far today</span>
      ${rows ? `<table class="deps"><tr><th>Aircraft</th><th>Type</th><th>To</th><th>Status</th><th>Yesterday</th></tr>${rows}</table>` : '<span>No aircraft are based here yet.</span>'}`;
  }

  // ---------- wide view: the same route list for all hubs as a table, and every aircraft as a list ----------
  function changeCard(entry) {
    const { actual, actualGain, estimatedGain, days } = changeOutcome(entry);
    const status = entry.status === 'changed' ? 'Further changes made · comparison stopped'
      : entry.status === 'complete' ? `${RESULT_DAYS} full days observed` : days ? `Collecting results · ${days} of ${RESULT_DAYS} full days` : 'Not enough data yet';
    return `<article class="item change-result"><div class="row"><b>${esc(entry.title)}</b><span class="sub">${fmtDate(entry.day)} · day ${entry.day + 1}</span></div>
      <div class="sub result-status ${entry.status === 'changed' ? 'amber' : ''}">${status}</div>
      <div class="result-metrics"><div><span>Original estimate / day</span><b class="mono">${fmtSigned(entry.estimatedAfter)}</b><small>${fmtSigned(estimatedGain)} expected change</small></div>
        <div><span>${days ? `Observed average · ${days} full day${days === 1 ? '' : 's'}` : 'Observed average / day'}</span><b class="mono ${actual == null ? '' : signCls(actual)}">${actual == null ? '—' : fmtSigned(actual)}</b><small>${actualGain != null ? `${fmtSigned(actualGain)} vs. the day before the change` : entry.beforeActual != null ? `Before change: ${fmtSigned(entry.beforeActual)} / day` : 'No comparable previous-day result'}</small></div></div>
      ${entry.overheadHubIds?.length ? '<div class="note">Hub results include this airport’s upkeep and all aircraft based here. Conversion fees are shown separately.</div>' : ''}
      ${kv(entry.cost < 0 ? 'Cash received' : 'One-time cost', fmtMoney(Math.abs(entry.cost)), 'mono')}
      ${!days && entry.status === 'watching' ? `<p class="note">Starts with the first full day after the change (${fmtDate(entry.day + 1)}). Its result appears the following morning.</p>` : ''}
      ${entry.status === 'changed' ? `<p class="note">${entry.reason ? esc(entry.reason) + '.' : 'Another change affected this route or aircraft.'} Any observations shown were collected before that change.</p>` : ''}
      <div class="chips tight">${entry.routes.map((r) => game.route(r.id) ? `<button class="chip" data-act="select-route" data-arg="${r.id}">${r.hub} ⇄ ${r.dest}</button>` : `<span class="sub">${r.hub} ⇄ ${r.dest} · closed</span>`).join('')}
        ${entry.planeIds.filter((id) => game.plane(id)).map((id) => `<button class="chip" data-act="select-plane" data-arg="${id}">${game.plane(id).name}</button>`).join('')}</div></article>`;
  }
  function resultsHTML(s) {
    const entries = (s.managementChanges || []).filter((e) => opsHub === 'all' || e.hubs.includes(opsHub));
    return `<div class="attention-heading"><h3>Results after changes</h3><p class="note">The last 30 management changes. Estimates stay as they were when you applied the change. Observations average the next ${RESULT_DAYS} full days, excluding the change day.</p></div>
      <p class="note results-explainer">Figures cover the affected routes and any parked aircraft, after aircraft upkeep. Hub specialization results also include the affected airport’s upkeep. One-time costs and interest are separate; other comparisons exclude airport overhead. Fuel prices, demand, disruptions and competition also affect results; this comparison does not isolate the effect of your decision.</p>
      ${entries.map(changeCard).join('') || '<div class="empty">No changes recorded here yet.<br>Move or replace an aircraft, maintain the fleet, or adjust a route’s fare to start a comparison.</div>'}`;
  }
  function recentResult(kind, id) {
    const entry = (game.state.managementChanges || []).find((e) => kind === 'plane' ? e.planeIds.includes(id) : e.routes.some((r) => r.id === id));
    return entry ? `<div class="route-section"><div class="sub">Latest change · ${esc(entry.title)}</div><button class="btn ghost small wide" data-act="show-results">View results after changes</button></div>` : '';
  }
  function opsOverview(s) {
    const { alerts, groups } = operationsAttention(game, opsHub), cases = responseCases(game, opsHub);
    if (mobileMedia.matches) {
      const activeGroups = groups.filter(g => g.count);
      const routeCount = alerts.filter(a => a.target.kind === 'route').length, planeCount = alerts.filter(a => a.target.kind === 'plane').length;
      return `<div class="row attention-heading"><div><h3>Needs attention</h3><div class="sub">${plural(alerts.length, 'item')} · live status</div></div></div>
        <div class="mobile-ops-stats"><div><b class="mono">${routeCount}</b><span>Routes</span></div><div><b class="mono">${planeCount}</b><span>Aircraft</span></div><div><b class="mono">${alerts.length - routeCount - planeCount}</b><span>Other</span></div></div>
        <button class="btn ghost wide" data-act="response-list">Review disruption responses${cases.routes.length ? ` · ${cases.routes.length}` : ''}</button>
        ${activeGroups.length ? `<details class="mobile-alert-filters" data-section="mobile-attention"><summary>Filter issues · ${activeGroups.length} categories</summary><div class="chips">${activeGroups.map(g => `<button class="chip" data-act="attention-filter" data-arg="${g.id}">${g.label} · ${g.count}</button>`).join('')}</div></details>` : ''}
        <div class="section-label">Items to review</div>${alerts.map(a => `<button class="attention-alert ${a.tone}" data-act="alert-open" data-arg="${a.target.kind}:${a.target.id}"><span class="attention-copy"><b>${esc(a.title)}</b><span class="sub">${esc(a.detail)}</span></span><span class="attention-action">${alertTargetLabel(a.target)} ›</span></button>`).join('') || '<div class="empty attention-clear"><b class="good">No active problems here.</b><br>Route advice is available in Routes.</div>'}
        <p class="note">Resolved problems disappear. Yesterday’s losses update after the next full day.</p>`;
    }
    return `<div class="row attention-heading"><div><h3>Needs attention</h3><div class="sub">${opsHub === 'all' ? 'Across all hubs' : `At ${opsHub}`} · live status</div></div><span class="sub">${plural(alerts.length, 'item')} to review</span></div>
      <div class="item recovery-summary"><div><b>Disruption management</b><div class="sub">${plural(cases.routes.length, 'disrupted route')} · ${plural(cases.contracts.length, 'contract')} due soon · ${plural(cases.returns.length, 'temporary assignment')}</div></div><button class="btn ghost" data-act="response-list">Review responses</button></div>
      <div class="attention-summary">${groups.map((g) => `<button class="attention-count ${g.count ? 'needs-review' : ''}" data-act="attention-filter" data-arg="${g.id}" aria-label="${g.label}: ${g.count}">
        <b class="mono">${g.count}</b><span>${g.label}</span></button>`).join('')}</div>
      <p class="note">Items disappear when resolved. Losses use yesterday’s results and update after the next full day. A route or aircraft can appear in more than one count.</p>
      <div class="section-label">Items to review <span>${alerts.length}</span></div>
      ${alerts.map((a) => `<button class="attention-alert ${a.tone}" data-act="alert-open" data-arg="${a.target.kind}:${a.target.id}" aria-label="${esc(alertTargetLabel(a.target) + ': ' + a.title)}">
        <span class="attention-copy"><b>${esc(a.title)}</b><span class="sub">${esc(a.detail)}</span></span><span class="attention-action">${alertTargetLabel(a.target)} <span aria-hidden="true">›</span></span></button>`).join('') ||
        `<div class="empty attention-clear"><b class="good">No active problems here.</b><br>${s.routes.length || s.planes.length ? 'Route capacity advice is available in “By route”.' : 'Plan your first route to start flying.'}</div>`}`;
  }

  function opsHTML(s) {
    if (opsHub !== 'all' && !game.isHub(opsHub)) opsHub = s.active;
    const hubs = opsHub === 'all' ? s.hubs : [game.hub(opsHub)];
    const hand = pickedPlane();
    const top = `<div class="chips"><span class="seg"><button class="${opsView === 'overview' ? 'on' : ''}" data-act="ops-view" data-arg="overview">Overview</button><button class="${opsView === 'routes' ? 'on' : ''}" data-act="ops-view" data-arg="routes">By route</button><button class="${opsView === 'aircraft' ? 'on' : ''}" data-act="ops-view" data-arg="aircraft">By aircraft</button><button class="${opsView === 'results' ? 'on' : ''}" data-act="ops-view" data-arg="results">Results</button></span>
      ${s.hubs.length > 1 ? `<button class="chip ${opsHub === 'all' ? 'on' : ''}" data-act="ops-hub" data-arg="all">All hubs</button>${s.hubs.map((h) => `<button class="chip ${opsHub === h.id ? 'on' : ''}" data-act="ops-hub" data-arg="${h.id}">${h.id}</button>`).join('')}` : ''}
      </div>`;
    if (opsView === 'overview') return `${top}${opsOverview(s)}`;
    if (opsView === 'results') return `${top}${resultsHTML(s)}`;
    if (opsView === 'aircraft') return `${top}${handHTML()}${aircraftListHTML(s)}`;

    const block = (hub) => {
      const a = AIRPORT_BY_ID[hub.id];
      const planes = game.planesAt(hub.id);
      const parked = planes.filter((p) => p.routeId == null && !p.conversion);
      const routes = game.routesAt(hub.id);
      const profit = routes.reduce((n, r) => n + (game.routeProfit(r) ?? 0), 0);
      const rows = sortRoutes(routes).filter(routeShown).map((r) => {
        const d = AIRPORT_BY_ID[r.dest];
        const f = game.routeFactors(r);
        const { on, want, seats, tag } = fitOf(r);
        const y = r.yesterday;
        const load = game.cargoOnly(r) ? y?.freight?.capacity ? Math.round(y.freight.delivered/y.freight.capacity*100) : null : y?.seats ? Math.round(y.pax/y.seats*100) : null;
        const p = game.routeProfit(r);
        const why = on.length ? game.diagnose(r)[0] : null;
        return `<div class="ops-row ${hand && hand.routeId === r.id ? 'has-pick' : ''}" data-drop-route="${r.id}">
          <div class="ops-c ops-name"><button class="linkish" data-act="ops-route" data-arg="${r.id}"><span class="mono amber">${r.dest}</span> ${esc(d.city)}</button>
            <div class="sub">${km(r.km)}${game.isHub(r.dest) ? ` · ${term('hub link', 'hubLink')}` : ''}${f.war ? ` · <span class="bad" ${tipAttr('priceWar')}>price war</span>` : ''}${game.closed(r.dest) || game.closed(r.hub) ? ' · <span class="bad">closed today</span>' : ''}</div></div>
          <div class="ops-c"><div class="mono">${Math.round(want).toLocaleString()} <span class="sub">${game.cargoOnly(r)?'t booked / day':'want to fly'}</span></div><div class="mono">${Math.round(seats).toLocaleString()} <span class="sub">${game.cargoOnly(r)?'t hold / day':'seats a day'}</span></div>${tag}</div>
          <div class="ops-c"><div class="mono">${load == null ? '—' : `${load}%`}</div><div class="sub">full</div></div>
          <div class="ops-c">${game.cargoOnly(r)?`<button class="btn ghost small" data-act="cargo-service" data-arg="${r.id}:${r.cargoService || 'bulk'}">${freightService(r).name} freight</button>`:`<span class="stepper"><button data-act="price" data-arg="${r.id}:-0.1" aria-label="Lower price">−</button><span class="mono">${Math.round(r.price * 100)}%</span><button data-act="price" data-arg="${r.id}:0.1" aria-label="Raise price">+</button></span><div class="sub">${fmtMoney(game.ticket(r))} fare</div>`}</div>
          <div class="ops-c"><div class="mono ${p == null ? '' : signCls(p)}">${p == null ? '—' : fmtSigned(p)}</div><div class="sub">yesterday</div></div>
          <div class="ops-c ops-planes">${on.map(planeChip).join('')}${moveBtn(r)}${addBtn(r)}</div>
          ${why ? `<div class="diag ops-wide">${esc(why)}</div>` : ''}${addFor === r.id ? `<div class="ops-wide">${addPanelHTML(r)}</div>` : ''}
        </div>`;
      }).join('');
      return `<div class="ops-hub">
        <div class="row"><span class="name"><span class="code">${hub.id}</span> ${esc(a.city)} <span class="sub">${rankFor(hub.levels).name}</span></span>
          <span class="sub nowrap"><span ${tipAttr('routesUsed')}>${routes.length}/${game.routeCap(hub)} routes</span> · <span ${tipAttr('gatesUsed')}>${planes.length}/${game.planeCap(hub)} gates</span> · <span class="mono ${signCls(profit)}">${fmtSigned(profit)}</span> yesterday
            <button class="btn ghost small" style="margin-left:8px" data-act="autofit" data-arg="${hub.id}" ${planes.length && routes.length ? '' : 'disabled'}>Auto-fit</button></span></div>
        ${parked.length || hand ? `<div class="ops-parked" data-drop-park="${hub.id}"><span class="sub" ${tipAttr('parked')}>Parked${parked.length ? '' : ': none'}</span>${parked.map(planeChip).join('')}</div>` : ''}
      </div>
      ${rows ? `<div class="ops-table"><div class="ops-row ops-head"><div>Route</div><div>${'Demand / capacity'}</div><div>${term('Load', 'load')}</div><div>Fare / freight</div><div>${term('Profit', 'routeProfit')}</div><div>${term('Aircraft', 'opsAircraft')}</div></div>${rows}</div>` : `<div class="empty">${routes.length ? 'No routes match this filter at this hub.' : 'No routes from this hub yet.'}</div>`}`;
    };
    return `${top}${routeControls(hubs.flatMap((h) => game.routesAt(h.id)), 'operations')}${handHTML()}${hubs.map(block).join('')}
      <div class="note">Click an aircraft to inspect it. Drag onto a route or another aircraft to preview a move or swap. Moving to another hub’s route works if that hub has a free gate and a long enough runway. Click a route’s name to see it on the map.</div>`;
  }

  // What auto-fit would do, for the player to accept or not.
  function autoFitModal(hubId) {
    const plan = game.autoFit(hubId);
    const a = AIRPORT_BY_ID[hubId];
    if (!plan.moves.length || plan.gain < 1000) {
      showModal(`<div class="eyebrow">Auto-fit · ${hubId}</div><h2>Nothing to change.</h2>
        <p>Every aircraft at ${esc(a.city)} is already on the route where it earns most. To grow from here, open more routes or buy aircraft.</p>
        <div class="card-actions"><button class="btn wide" data-act="close-modal">Fine</button></div>`);
      return;
    }
    const where = (dest) => (dest ? `${hubId} ⇄ ${dest}` : 'parked');
    const lines = plan.moves.map((m) => `<div class="kv"><span><span class="mono amber">${m.name}</span> ${m.type}</span><span>${where(m.from)} → <b>${where(m.to)}</b></span></div>`).join('');
    showModal(`<div class="row"><div class="eyebrow" style="margin:0">Auto-fit · ${hubId} ${esc(a.city)}</div><button class="x" data-act="close-modal" aria-label="Close">×</button></div>
      <div class="big good">${fmtSigned(plan.gain)} <span class="sub">a day, estimated</span></div>
      <p style="margin-top:0">From about ${fmtSigned(plan.before)} to ${fmtSigned(plan.after)} a day for this hub’s routes, at today’s demand and fares.</p>
      <div class="autofit-list">${lines}</div>
      <div class="note">It only moves this hub’s own aircraft between its own routes. It buys and sells nothing, and you can move anything back afterwards.</div>
      <div class="card-actions"><button class="btn wide" data-act="autofit-apply" data-arg="${hubId}">Apply ${plural(plan.moves.length, 'move')}</button>
        <button class="btn ghost wide" data-act="close-modal">Leave it as it is</button></div>`);
  }

  // The aircraft market for the active hub. Each type shows where it would earn most right now.
  function fleetTab(s) {
    const hub = game.activeHub, planes = game.planesAt(hub.id);
    return `${hubChips(s)}<div class="item hubsum">
      <div class="row"><span class="name">Fleet at ${hub.id}</span><span class="sub">${planes.length} / ${game.planeCap(hub)} gates</span></div>
      <button class="btn wide" style="margin-top:10px" data-act="page" data-arg="market">Buy or lease aircraft</button></div>
      ${fleetControls(planes, 'hub')}
      ${planes.filter(planeShown).map((p) => {
        const r = game.route(p.routeId), type = AIRCRAFT[p.type];
        return `<div class="item"><button class="linkish" data-act="select-plane" data-arg="${p.id}"><span class="mono amber">${p.name}</span> ${type.name}</button>
          <div class="sub" style="margin-top:4px">${p.conversion ? 'In conversion · '+responseHours(p.conversion.until-s.minute)+' left' : r ? `${r.hub} ⇄ ${r.dest}` : 'Parked · ready to assign'} · ${Math.floor(p.age)} days old</div>
          ${fleetFlags(p) ? `<div style="margin-top:6px">${fleetFlags(p)}</div>` : ''}</div>`;
      }).join('') || (planes.length ? fleetEmpty : '<div class="empty">No aircraft yet. Plan a route to buy and assign your first aircraft together.</div>')}
      <div class="note">High maintenance: 150+ days old or breakdown risk above 3%. Select an aircraft to inspect and preview changes. Operations compares your whole fleet.</div>`;
  }

  function marketTab(s) {
    const hub = game.activeHub;
    const planes = game.planesAt(hub.id), routes = game.routesAt(hub.id);
    const sale = game.planePrice('sparrow') < AIRCRAFT.sparrow.price;
    const shop = AIRCRAFT_LIST.filter(t=>!!t.freighter === (shopKind==='cargo')).map((t) => {
      const best = routes.filter((r) => r.km <= t.range)
        .map((r) => ({ r, ...game.typeProfit(r, t, game.planesOn(r.id).length + 1) })).sort((a, b) => b.profit - a.profit)[0];
      const target = best && best.profit > 0 ? best : null;
      const why = game.whyNotBuy(t.id);
      const whyUsed = game.whyNotBuy(t.id, true);
      const arg = (used) => (target ? `${target.r.id}:${t.id}:${used}` : `${t.id}`);
      return `<div class="item ${t.cls > hub.levels.runway ? 'locked' : ''}">
        <div class="row"><span class="name">${t.name}</span><span class="sub">${t.kind}</span></div>
        <div class="specs">
          <div><span>${t.freighter ? 'Usable hold' : 'Seats'}</span>${t.freighter ? freightHold(t,hub).toFixed(1)+' t' : t.seats}</div>
          <div><span>Range</span>${km(t.range)}</div>
          <div><span>Cargo</span>${t.cargo} t</div>
        </div>
        ${t.cls > hub.levels.runway ? '' : `<div class="sub" style="margin:-4px 0 8px">${target ? `Would earn most on <span class="mono amber">${target.r.dest}</span>: <span class="mono good">${fmtSigned(target.profit)}/day</span>, ${Math.round(target.load * 100)}% full. It goes straight there.`
          : best ? `<span class="bad">Would lose money on every route from ${hub.id} today.</span>` : `No route from ${hub.id} it can reach yet.`}</div>`}
        <div class="btn-row">
          <button class="btn" data-act="${target ? 'ops-buy' : 'buy'}" data-arg="${arg(0)}" ${why ? 'disabled' : ''}>New · ${fmtMoney(game.planePrice(t.id))}</button>
          <button class="btn ghost" data-act="${target ? 'ops-buy' : 'buy-used'}" data-arg="${arg(1)}" ${whyUsed ? 'disabled' : ''} ${tipAttr('used')}>Used · ${fmtMoney(game.planePrice(t.id, true))}</button>
          <button class="btn ghost" data-act="lease-review" data-arg="${hub.id}:${t.id}:${target?.r.id || ''}">Review lease</button>
        </div>
        ${whyUsed ? `<div class="why">${whyUsed}</div>` : ''}
      </div>`;
    }).join('');
    return `${hubChips(s)}<div class="section-label"><span>Aircraft for ${hub.id}</span><span ${tipAttr('gatesUsed')}>${planes.length} / ${game.planeCap(hub)} gates${sale ? ' · <span class="good">sale: 20% off</span>' : ''}</span></div><div class="seg service-options" aria-label="Aircraft market">${[["passenger","Passenger"],["cargo","Freighters"]].map(([id,label])=>`<button data-act="shop-kind" data-arg="${id}" class="${shopKind===id?"on":""}" aria-pressed="${shopKind===id}">${label}</button>`).join('')}</div>${shopKind==='cargo'?'<p class="note">Dedicated freighters carry no passengers. A cargo terminal unlocks freight bookings; larger terminals increase usable hold space. Add them to an existing route or launch a new one.</p>':''}${shop}
      <div class="note">An aircraft you buy here is based at ${hub.id}. Used aircraft arrive ${USED.age} days old: cheaper to buy, costlier to maintain and more likely to break down. To buy for one particular route, use “+ aircraft” on it.</div>`;
  }

  function financeTab(s) {
    const limit = game.creditLimit(), room = limit - s.debt;
    const y = s.yesterday;
    const offer = game.stakeOffer();
    const listWhy = game.whyNotList();
    const fuel = s.fuel, lock = game.fuelLocked(), lockCost = game.fuelLockCost();
    const borrow = BORROW.map((n) => `<button class="btn ghost small" data-act="borrow" data-arg="${n}" ${n > room ? 'disabled' : ''}>+${fmtMoney(n)}</button>`).join('');
    const books = y ? `
        ${kv('Revenue', fmtMoney(y.rev), 'mono')}
        ${kv('of which cargo', fmtMoney(y.cargo || 0), 'mono')}
        ${y.partnerIncome ? kv('of which partner referrals', fmtMoney(y.partnerIncome), 'mono') : ''}
        ${y.partnerPayments ? kv('Referrals paid to partners', fmtMoney(-y.partnerPayments), 'mono') : ''}
        ${y.partnershipFees ? kv('Partnership agreement fees', fmtMoney(-y.partnershipFees), 'mono') : ''}
        ${y.projectRemoval ? kv('Project clearance fees', fmtMoney(-y.projectRemoval), 'mono') : ''}
        ${y.cargoConversions ? kv('Freighter conversions', fmtMoney(-y.cargoConversions), 'mono') : ''}
        ${y.freightPenalties ? kv('Freight claims', fmtMoney(-y.freightPenalties), 'mono') : ''}
        ${kv('Fuel', fmtMoney(-(y.fuel || 0)), 'mono')}
        ${kv(term('Airport upkeep', 'airportUpkeep'), fmtMoney(-y.upkeep), 'mono')}
        ${kv(term('Fleet maintenance', 'maintenance'), fmtMoney(-y.maintenance), 'mono')}
        ${y.leases ? kv('Lease rent and fees', fmtMoney(-y.leases), 'mono') : ''}
        ${y.specialization ? kv('Hub conversion fees', fmtMoney(-y.specialization), 'mono') : ''}
        ${y.recovery ? kv('Disruption response fees', fmtMoney(-y.recovery), 'mono') : ''}
        ${y.connectionCompensation ? kv('Missed connection compensation', fmtMoney(-y.connectionCompensation), 'mono') : ''}
        ${y.interest ? kv('Loan interest', fmtMoney(-y.interest), 'mono') : ''}
        ${y.dividends ? kv(term('Paid to investors', 'dividends'), fmtMoney(-y.dividends), 'mono') : ''}
        ${kv('<b>Profit</b>', fmtSigned(y.profit), `mono ${signCls(y.profit)}`)}
        ${y.projectSpending ? kv('Project capital spending · separate',fmtMoney(-y.projectSpending),'mono') : ''}
        ${y.campaignRewards ? kv('Campaign grants · separate',fmtSigned(y.campaignRewards),'mono good') : ''}
        ${y.projectWriteOff ? kv('Project asset value written off',fmtMoney(-y.projectWriteOff),'mono') : ''}` : '<div class="sub">Your first day isn’t over yet.</div>';
    return `<div class="section-label">Position</div>
      <div class="item">
        ${kv(term('Cash', 'cash'), fmtMoney(s.money), `mono ${s.money < 0 ? 'bad' : ''}`)}
        ${kv(term('Aircraft and buildings', 'assets'), fmtMoney(game.assets()), 'mono')}
        ${kv('Debt', fmtMoney(-s.debt), 'mono')}
        ${game.leaseCommitment() ? kv('Remaining lease rent', fmtMoney(game.leaseCommitment()), 'mono amber') + '<div class="note">Future rent is paid over the remaining term. Leased aircraft have no resale value.</div>' : ''}
        ${game.projectFunding()?kv('Funding to finish airport projects',fmtMoney(game.projectFunding()),'mono amber')+'<p class="note">Future stages wait for your approval. Canceling a project forfeits paid stages.</p><button class="btn ghost wide" data-act="projects-open" data-arg="all">Review project funding</button>':''}
        ${kv(term('<b>Net worth</b>', 'netWorth'), fmtMoney(game.netWorth()), 'mono')}
        ${kv(term('Company value', 'companyValue'), fmtMoney(game.valuation()), 'mono')}
        <div class="note">Company value is net worth plus forty days of your average profit over the last month.</div>
        ${s.listed
          ? `<div class="why good">Listed on the stock exchange on day ${s.listed.day + 1} at ${fmtMoney(s.listed.value)}.</div>`
          : `<button class="btn wide" style="margin-top:8px" data-act="list" ${listWhy ? 'disabled' : ''}>List on the stock exchange</button>
             <div class="why">${listWhy ? `${listWhy}. ` : ''}Listing is the last milestone: it raises 10% of the company’s value in cash.</div>`}
      </div>
      <div class="section-label"><span>${term('Fuel market', 'fuelMarket')}</span><span class="${fuel > 1.1 ? 'bad' : fuel < 0.92 ? 'good' : ''}">${Math.round(fuel * 100)}% of normal</span></div>
      <div class="item">
        ${sparkline(s.fuelHist.map((v) => v - 1), 'Fuel price history')}
        ${kv('Yesterday’s fuel bill', fmtMoney(y?.fuel || 0), 'mono')}
        ${lock
          ? `<div class="why good">Locked at ${Math.round(lock.price * 100)}% until ${fmtDate(lock.until)} (${plural(lock.until - s.day, 'day')} left). Spikes can’t touch you.</div>`
          : `<button class="btn ghost wide" style="margin-top:8px" data-act="lock-fuel" ${s.money < lockCost ? 'disabled' : ''} ${tipAttr('fuelLock')}>Lock today’s price for 30 days · ${fmtMoney(lockCost)}</button>
             <div class="why">The fee is ${Math.round(game.fuelLockRate() * 100)}% of a month’s fuel at the normal price. It is 3% when fuel is at or above normal and climbs the cheaper fuel gets, because a low price is likely to drift back up. One price applies to all your hubs; a hub’s fuel depot takes its discount on top.</div>`}
      </div>
      <div class="section-label"><span>${term('Bank loan', 'borrowed')}</span><span>0.4% a day</span></div>
      <div class="item">
        ${kv(term('Borrowed', 'borrowed'), `${fmtMoney(s.debt)} of ${fmtMoney(limit)}`, 'mono')}
        <div class="meter"><i style="width:${Math.min(100, (s.debt / limit) * 100)}%"></i></div>
        <div class="btn-row" style="margin-top:8px">${borrow}</div>
        ${s.debt > 0 ? `<div class="btn-row" style="margin-top:6px">
          <button class="btn small" data-act="repay" data-arg="500000" ${s.money <= 0 ? 'disabled' : ''}>Repay ${fmtMoney(Math.min(500e3, s.debt))}</button>
          <button class="btn small" data-act="repay" data-arg="${s.debt}" ${s.money < s.debt ? 'disabled' : ''}>Repay all</button></div>` : ''}
        <div class="note">Your limit grows with what you own. Five days in a row with negative cash and the bank shuts you down.</div>
      </div>
      <div class="section-label"><span>${term('Investors', 'investors')}</span><span>${Math.round(s.equity * 100)}% sold</span></div>
      <div class="item">
        <div class="sub">Sell a 10% stake for cash now. Investors then take that share of every profitable day, forever.</div>
        <button class="btn ghost wide" style="margin-top:8px" data-act="stake" ${offer == null ? 'disabled' : ''}>${offer == null ? 'No more stakes for sale' : `Sell 10% · ${fmtMoney(offer)}`}</button>
      </div>
      <div class="section-label">Yesterday’s books</div>
      <div class="item">${books}${sparkline(s.history)}</div>`;
  }

  function calendarTab(s) {
    const milestones=s.hubs.flatMap(h=>(h.projects || []).filter(p=>['building','awaiting'].includes(p.status)).map(p=>({hub:h.id,...game.projectStatus(h.id,p.id)})));
    const projectOn=d=>milestones.filter(m=>Math.floor((m.nextAt ?? s.minute)/1440)===d);
    const projectEvent=m=>`<div class="item"><b>${m.hub} · ${m.profile.name}</b><p class="note">${m.project.status==='awaiting'?'Ready for stage funding now':`${fmtDate(Math.floor(m.nextAt/1440))} · ${m.project.stage===2?'Completion expected':'Next stage ready for funding'}`}</p><button class="btn ghost small" data-act="project-detail" data-arg="${m.hub}:${m.project.id}">View project</button></div>`;
    const nowMonth = Math.floor(s.day / 30);
    const lastMonth = Math.floor(s.eventsUntil / 30);
    const m = Math.min(lastMonth, Math.max(nowMonth, calMonth ?? nowMonth));
    const first = m * 30;
    const active = activeEvents(s);
    const eventsOn = (d) => s.events.filter((e) => e.start <= d && d < e.start + e.days);
    const dueOn = (d) => s.contracts.filter((c) => c.due === d);
    let cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w) => `<div class="wd">${w}</div>`).join('');
    cells += '<div></div>'.repeat(first % 7);
    for (let d = first; d < first + 30; d++) {
      const dots = eventsOn(d).slice(0, 3).map((e) => `<i style="background:${EVENT_TYPES[e.type].color}"></i>`).join('')
        + (dueOn(d).length ? `<i style="background:${CONTRACT_COLOR}"></i>` : '') + (projectOn(d).length ? '<i style="background:var(--amber)"></i>' : '');
      const cls = `${d < s.day ? 'past' : ''} ${d === s.day ? 'today' : ''} ${d === calDay ? 'sel' : ''}`;
      cells += `<button class="cell ${cls}" data-act="cal-day" data-arg="${d}" aria-label="${fmtDate(d)}">${dateOf(d).dom}<span class="dots">${dots}</span></button>`;
    }
    let list, title;
    if (calDay != null) {
      const evs = eventsOn(calDay);
      title = `${fmtDate(calDay)}${calDay === s.day ? ' · today' : calDay > s.day ? ` · in ${plural(calDay - s.day, 'day')}` : ''}`;
      list = (projectOn(calDay).map(projectEvent).join('') + dueOn(calDay).map(contractItem).join('') + evs.map(eventItem).join('')) || '<div class="sub">Nothing scheduled. A quiet day.</div>';
    } else {
      const coming = s.events.filter((e) => e.start > s.day).sort((a, b) => a.start - b.start).slice(0, 8);
      title = 'Coming up';
      const due = s.contracts.filter((c) => c.due != null).sort((a, b) => a.due - b.due);
      list = (milestones.sort((a,b)=>(a.nextAt ?? s.minute)-(b.nextAt ?? s.minute)).map(projectEvent).join('') + due.map(contractItem).join('') + coming.map(eventItem).join('')) || '<div class="sub">Nothing on the horizon.</div>';
    }
    const dt = dateOf(first);
    return `${active.length ? `<div class="section-label">Happening now</div>${active.map(eventItem).join('')}` : ''}
      <div class="cal-head">
        <button data-act="cal-month" data-arg="-1" ${m <= nowMonth ? 'disabled' : ''} aria-label="Previous month">‹</button>
        <b>${MONTHS[dt.month]}, year ${dt.year}</b>
        <button data-act="cal-month" data-arg="1" ${m >= lastMonth ? 'disabled' : ''} aria-label="Next month">›</button>
      </div>
      <div class="cal">${cells}</div>
      <div class="section-label"><span>${title}</span>${calDay != null ? '<button class="chip" data-act="cal-day" data-arg="">Show all</button>' : ''}</div>${list}
      <div class="note">Holiday spots peak in their summer; tropical ones around December. Each route’s card shows the season’s effect. Green dots are contract deadlines; amber dots mark project stages. Later stages wait for funding.</div>`;
  }

  function strengthHTML(rv) {
    const str = rv.str ?? 85;
    const state = canTakeOver(rv) ? 'seeking a buyer' : rv.cash < 0 ? 'cash shortage' : rv.profit < 0 ? 'restructuring' : str >= 75 ? 'healthy' : 'recovering';
    const why = game.whyNotTakeover(rv.id);
    const contested = game.rivalPressure(rv).parts;
    return `<div class="row sub" style="margin-top:8px"><span>${term('Financial health', 'strength')} · ${state}</span><span class="mono">${Math.round(str)} / 100</span></div>
      <div class="meter"><i style="width:${str}%;background:${rv.color}"></i></div>
      <div class="rival-metrics">
        <div><span class="sub">Cash reserves</span><strong class="mono ${rv.cash < 0 ? 'bad' : ''}">${fmtMoney(rv.cash)}</strong></div>
        <div><span class="sub">Last day's profit</span><strong class="mono ${rv.profit < 0 ? 'bad' : 'good'}">${rv.history.length ? fmtSigned(rv.profit) : 'Awaiting flights'}</strong></div>
      </div>
      <div class="rival-fleet-summary"><span>${rv.routes.filter((r)=>!r.lease).length} owned · ${rv.routes.filter((r)=>r.lease).length} leased aircraft</span>${rv.routes.some((r)=>r.lease) ? `<span>Rent ${fmtMoney(rv.routes.reduce((n,r)=>n+(r.lease?.daily || 0),0))}/day · ${fmtMoney(rivalLeaseCommitment(rv,game.state.minute))} still committed</span>` : ''}</div>
      ${rv.history.length > 1 ? sparkline(rv.history, `${rv.name} daily profit`) : ''}
      ${contested.map((p) => `<div class="sub">${esc(p.label)}</div>`).join('')}
      ${rv.cash < 0 ? `<div class="sub bad">${rv.negativeDays} of 10 days with negative cash. Asset sales or profitable services may still fund recovery.</div>` : ''}
      ${canTakeOver(rv) ? `<button class="btn wide" style="margin-top:8px" data-act="takeover" data-arg="${rv.id}" ${why ? 'disabled' : ''}>Review takeover · ${fmtMoney(game.takeoverCost(rv))}</button><div class="why">${why || `Acquire ${plural(rv.hubs.length, 'hub')}, routes and aircraft. Review before buying.`}</div>` : ''}`;
  }

  function partnershipSummary(rv) {
    const a=game.agreementFor(rv.id),status=a && game.partnershipStatus(a);
    if(!a || (!status.active && !status.waiting))return `<div class="partnership-summary"><div class="sub">${a?'Previous agreement ended.':'Cooperate on connecting journeys.'}</div><button class="btn ghost wide" data-act="partnership-offer" data-arg="${rv.id}">Review partnership offer</button>${a?`<button class="linkish" data-act="partnership-open" data-arg="${a.id}">View previous results</button>`:''}</div>`;
    return `<div class="partnership-summary"><div class="row"><b class="amber">${status.active?'Partner airline':'Finishing booked journeys'}</b><span class="sub">${status.active?`${Math.max(1,Math.ceil((a.end-game.state.minute)/1440))} days left`:''}</span></div><p class="note ${status.atRisk?'bad':''}">${status.atRisk?`${Math.floor(status.atRisk)} travelers at risk. `:''}${status.reason || `${Math.round(status.volume)} connecting travelers / day forecast · ${a.today.completed} completed today.`}</p><button class="btn ghost wide" data-act="partnership-open" data-arg="${a.id}">Manage partnership</button></div>`;
  }
  function partnershipJourneys(pairs) {
    return pairs.length?pairs.slice().sort((a,b)=>a.waiting!=null?(a.deadline || Infinity)-(b.deadline || Infinity):b.rate-a.rate).slice(0,6).map(p=>{
      const own=game.route(p.firstRouteId) || game.route(p.secondRouteId),onward=p.routeId && game.journeyRoute(p.routeId);
      return `<div class="connection-journey"><b class="mono">${p.from} → ${p.via} → ${p.to}</b><span class="sub">${p.waiting!=null?`${Math.floor(p.waiting)} waiting`:`About ${Math.round(p.rate*2)} travelers / day · both ways`}${p.transferMinutes?` · ${p.transferMinutes} min transfer`:''}</span>${p.waiting!=null?`<span class="sub amber">Next: ${onward?.agreementId?esc(p.partnerName || 'partner airline'):'your flight'} · expires in ${responseHours(Math.max(0,p.deadline-game.state.minute))}</span>`:''}${own?`<button class="btn ghost small" data-act="partnership-route" data-arg="${own.id}">Your flight · ${own.hub} ⇄ ${own.dest}</button>`:'<span class="sub bad">Your connecting route has closed.</span>'}</div>`;
    }).join('')+(pairs.length>6?`<p class="note">Plus ${pairs.length-6} other shared markets.</p>`:''):'<p class="note">No viable shared journeys right now. Both airlines need staffed flights that meet at a transfer airport without a large detour.</p>';
  }
  function partnershipModal() {
    const review=partnershipReview;if(!review)return;
    const a=game.agreement(review.agreementId),rv=a?game.agreementRival(a):game.rival(review.rivalId);
    const title=esc(a?.name || rv?.name || 'Airline partnership'),termsId=review.terms || a?.terms || 'reciprocal',terms=PARTNERSHIP_TERMS[termsId];
    let content='',footer='';
    const revenueTerms=`<div class="item">${kv('Your referral on partner flights', `${Math.round(terms.receive*100)}% of their onward fare`)}${kv('Their referral on your flights', `${Math.round(terms.pay*100)}% of your onward fare`)}</div><p class="note">The first airline sells the journey and earns a referral when the other airline completes the second flight. Each operator keeps the rest of its own fare and pays its flying costs. No referral is paid for a missed onward flight.</p>`;
    if(review.action==='view' && a) {
      const status=game.partnershipStatus(a),t=a.total;
      const waiting=new Map();for(const q of status.queues) {const old=waiting.get(q.key);if(old){old.waiting+=q.count;old.deadline=Math.min(old.deadline,q.deadline);}else waiting.set(q.key,{...q,waiting:q.count,transferMinutes:q.readyAt-q.arrivedAt});}
      content=`<div class="partnership-status ${status.atRisk?'bad':'amber'}">${status.reason || 'Agreement active'}${status.active?` · ${Math.max(1,Math.ceil((a.end-game.state.minute)/1440))} days left`:''}</div>
        ${status.active?kv('Expires',fmtDate(Math.floor(a.end/1440))):''}
        <div class="route-metrics"><div><span>Completed today</span><b>${a.today.completed}</b></div><div><span>Waiting at transfer</span><b>${status.waiting}</b></div><div><span>At risk</span><b class="${status.atRisk?'bad':''}">${status.atRisk}</b></div><div><span>Missed today</span><b>${a.today.missed}</b></div></div>
        ${status.expiring?'<p class="note amber">Renewal is available now. Without renewal, new bookings stop at expiry and booked journeys continue.</p>':''}
        <details open><summary>Agreement results · lifetime</summary><div class="item">${kv('Travelers sent to partner',t.sent,'mono')}${kv('Travelers received from partner',t.received,'mono')}${kv('Completed journeys',t.completed,'mono')}${kv('Missed journeys',t.missed,'mono')}${kv('Referral income',fmtMoney(t.earned),'mono good')}${kv('Referral payments',fmtMoney(t.paid),'mono')}${kv('Compensation you paid',fmtMoney(t.compensation),'mono')}${kv('Compensation partner paid',fmtMoney(t.partnerCompensation),'mono')}</div><p class="note">Your own flight fares and operating costs remain in route results. Referral income and payments are also included in Finance.</p></details>
        ${status.waiting?`<details open><summary>Waiting journeys</summary>${partnershipJourneys([...waiting.values()])}<p class="note">The onward operator has up to 12 hours after the first landing to carry these travelers. Review your route if your flight is blocked; the partner manages its own fleet.</p></details>`:''}
        <details><summary>Shared journeys · ${Math.round(status.volume)} travelers / day forecast</summary>${partnershipJourneys(status.pairs)}</details>
        <details><summary>${terms.name} terms</summary>${revenueTerms}<p class="note">Partner flights reserve 20% of economy seats for this agreement. Your passengers use the normal shared capacity of your own flights. The onward operator pays missed-connection compensation; you cover the claim if the partner closes. Direct competition continues; new fare wars with this partner pause during the agreement.</p></details>`;
      footer=`<div class="btn-row"><button class="btn ghost" data-act="close-modal">Close</button>${status.active?`${status.expiring?'<button class="btn" data-act="partnership-action" data-arg="renew">Review renewal</button>':''}<button class="btn danger" data-act="partnership-action" data-arg="end">Review ending</button>`:rv?'<button class="btn" data-act="partnership-action" data-arg="sign">Review new offer</button>':''}</div>`;
    } else {
      const q=game.partnershipQuote(a?.rivalId || review.rivalId,termsId,review.action);
      if(review.action==='end') {
        const status=game.partnershipStatus(a);
        content=`<p>Stop accepting new shared bookings with ${title} now. ${status.waiting} travelers are waiting at transfer airports; passengers already flying also keep their booked terms.</p><div class="item">${kv('Ending fee',fmtMoney(0),'mono')}${kv('Agreement fee refund','None')}${kv('New agreement with this airline','Available after 7 days')}</div><p class="note">Reserved seats remain available for booked onward flights while the partner keeps that route operating. Unserved travelers receive normal compensation from their onward operator; you cover the claim if the partner closes. New fare wars become possible again.</p>`;
      } else {
        content=`<p>${review.action==='renew'?'Extend this agreement by':'Connect your network for'} ${PARTNERSHIP_DAYS} days. Review both revenue shares before choosing terms.</p>
        <div class="partnership-terms">${Object.entries(PARTNERSHIP_TERMS).map(([id,t])=>`<button class="item partnership-term ${id===termsId?'selected':''}" data-act="partnership-terms" data-arg="${id}" aria-pressed="${id===termsId}"><b>${t.name}</b><span>You receive ${Math.round(t.receive*100)}% · partner receives ${Math.round(t.pay*100)}%</span><small>${fmtMoney(t.fee)} fee · reputation ${t.reputation} required</small></button>`).join('')}</div>
        <div class="item">${kv('Agreement fee · paid now',fmtMoney(q.fee),'mono amber')}${kv('Cash after signing',fmtMoney(q.remaining),'mono')}${kv('New expiry',fmtDate(Math.floor(q.candidate.end/1440)))}</div>${revenueTerms}
        <details open><summary>Shared journey forecast · ${Math.round(q.volume)} travelers / day</summary>${partnershipJourneys(q.pairs)}<div class="item">${kv('Your gross flight fares / day',fmtMoney(q.forecast.fares),'mono')}${kv('Referral income / day',fmtMoney(q.forecast.received),'mono')}${kv('Referral payments / day',fmtMoney(q.forecast.paid),'mono')}</div><p class="note">Estimates at today’s demand, before flying costs and any local passengers displaced. Actual boarding, fare changes, closures and available seats affect results.</p></details>
        <p class="note">Partners reserve 20% of economy seats on shared legs. Your own flights keep their normal capacity limits. The onward operator pays missed-connection compensation; you cover the claim if the partner closes. Up to two agreements may be active. Renew during the final three days; ending early stops new bookings without cancelling journeys already underway.</p>`;
      }
      content+=q.why?`<div class="why bad" role="alert">${esc(q.why)}</div>`:'<div class="why good">Terms available. Ready for your confirmation.</div>';
      footer=`<div class="btn-row"><button class="btn ghost" data-act="${a?'partnership-action':'close-modal'}" ${a?'data-arg="view"':''}>${a?'Back':'Cancel'}</button><button class="btn ${review.action==='end'?'danger':''}" data-act="partnership-apply" ${q.why?'disabled':''}>${review.action==='end'?'End partnership':review.action==='renew'?'Renew partnership':'Sign partnership'}${q.fee?` · ${fmtMoney(q.fee)}`:''}</button></div>`;
    }
    showModal(`<div class="row"><div class="eyebrow">${review.action==='view'?'Airline partnership':'Review agreement'}</div><button class="x" data-act="close-modal" aria-label="Close partnership">×</button></div><h2>${title}</h2>${content}${footer}`);
  }

  function rivalsTab(s) {
    const rows = [{ name: 'You', color: '#ffb454', routes: s.routes.length, pax: game.myPax(), hubs: s.hubs.length },
      ...s.rivals.filter((rv) => rv.hub).map((rv) => ({ name: rv.name, color: rv.color, routes: rv.routes.length, hubs: rv.hubs.length, pax: game.rivalPax(rv) }))]
      .sort((a, b) => b.pax - a.pax);
    const table = rows.map((r, i) => `<div class="kv rival-standing"><span><span class="mono">${i + 1}</span> <span class="dot" style="background:${r.color};margin-left:6px"></span><span style="color:var(--text)">${esc(r.name)}</span><small class="sub">${plural(r.hubs, 'hub')} · ${plural(r.routes, 'route')}</small></span><span class="mono">${r.pax.toLocaleString()}</span></div>`).join('');
    const cards = s.rivals.map((rv) => {
      if (!rv.hub) return `<div class="item locked"><div class="row"><span class="name"><span class="dot" style="background:${rv.color}"></span>${esc(rv.name)}</span><span class="sub">${rv.was ? 'closed' : 'arriving soon'}</span></div><div class="sub">${rv.was ? `Former hubs: ${rv.was}. ` : ''}A new airline is expected in about ${plural(Math.max(1, rv.back - s.day), 'day')}.</div></div>`;
      const clash = rv.routes.filter((rr) => s.routes.some((r) => marketOverlap(r.hub, r.dest, rr.hub, rr.dest) > 0));
      return `<div class="item rival-card">
        <div class="row"><span class="name"><span class="dot" style="background:${rv.color}"></span>${esc(rv.name)}</span><span class="sub">${plural(rv.hubs.length, 'hub')} · ${plural(rv.routes.length, 'route')}</span></div>
        <div class="sub">${rivalStrategy(rv)}</div>
        <div class="rival-hubs">${rv.hubs.map((h) => `<button class="chip" data-act="select" data-arg="${h.id}" aria-label="Inspect ${h.id}, ${esc(rv.name)} hub">${h.id}${h.id === rv.hub ? ' · HQ' : ''}${h.specialization && h.specialization !== 'general' ? ` · ${specializationOf(h).name}` : ''}</button>`).join('')}</div>
        ${strengthHTML(rv)}
        ${partnershipSummary(rv)}
        <div class="note rival-activity">${rv.activityDay != null ? `Day ${rv.activityDay + 1} · ` : ''}${esc(rv.activity)}</div>
        ${rv.decisions?.length ? `<details class="rival-decisions"><summary>Recent commercial decisions</summary>${rv.decisions.map((d)=>`<p class="note"><span class="mono">${fmtDate(d.day)}</span> · ${esc(d.text)}</p>`).join('')}</details>` : ''}
        <details><summary>Network · ${clash.length} overlapping ${clash.length === 1 ? 'market' : 'markets'}</summary>
          ${rv.hubs.map((h) => `<div class="section-label">${h.id} · ${specializationOf(h).name} · runway ${h.level}</div>
          ${h.specializationUntil > s.day ? `<div class="note">Hub role committed until ${fmtDate(h.specializationUntil)}.</div>` : ''}
          ${rv.routes.filter((r) => r.hub === h.id).map((r) => `<div class="rival-route"><div class="kv"><button class="linkish" data-act="select" data-arg="${r.dest}">${h.id} ⇄ ${r.dest}</button><span class="mono">${Math.round(r.price * 100)}%${r.war != null ? ' · fare war' : ''}</span></div><div class="sub">${AIRCRAFT[r.type].name} · ${SERVICES[r.service || 'balanced'].name} · ${CABINS[r.cabin || 0].name}</div>${r.lease ? `<div class="sub amber">Leased until ${fmtDate(Math.floor(r.lease.end/1440))} · ${fmtMoney(r.lease.daily)}/day rent</div>` : ''}</div>`).join('')}`).join('')}
        </details>
      </div>`;
    }).join('');
    return `<div class="item partnership-intro"><div class="row"><b>Airline partnerships</b><span class="sub">${(s.partnerships?.agreements || []).filter(a=>agreementActive(s,a)).length} / 2 active</span></div><p class="note">Connect your flights with another airline. Compare shared journeys, reserved seats and revenue shares before signing a 28-day agreement. Direct-route competition continues.</p></div><div class="section-label"><span>Standings</span><span>${term('passengers / day', 'standings')}</span></div><div class="item">${table}</div><div class="section-label">Airlines</div>${cards}
      <div class="note">Rivals pay for aircraft, leases, facilities, hub conversions, fuel and maintenance from their own cash. They compare service and cabins against passenger demand, keep cash for committed rent, and buy, renew or return aircraft at lease expiry. Hub roles have the same requirements, fees and 14-day commitment as yours. Healthy routes fund new hubs and recovery. They compete for direct routes and nearby departure markets; a distant flight to the same city does not automatically take your passengers. Price wars are reviewed on earnings and reserves. A takeover needs sustained losses and depleted cash; bankruptcy follows ten days of negative cash.</div>`;
  }

  const campaignNumber=(value,unit,withUnit=true)=>`${unit==='t'?Math.floor(value*10+1e-7)/10:Math.floor(value+1e-8).toLocaleString()}${!withUnit?'':unit==='%'?'%':unit?' '+unit:''}`;
  function campaignGoals(st,links=true){
    const helpers={routes:'Review routes',freight:'Review freight',network:'View network',projects:'Manage projects',finance:'Review finances',connections:'Review connections'};
    return `<ol class="campaign-goals">${st.goals.map(q=>`<li class="${q.met?'done':''}"><div class="campaign-objective"><b>${q.met?'✓ ':''}${q.label}</b><span class="mono ${q.met?'good':'amber'}">${campaignNumber(q.value,q.unit,false)} / ${campaignNumber(q.target,q.unit)}</span></div>
      <div class="meter"><i style="width:${Math.min(100,q.value/q.target*100,q.sample?q.sample.value/q.sample.target*100:100)}%"></i></div>
      ${q.sample?`<span class="sub">${campaignNumber(q.sample.value,q.sample.unit)} resolved · minimum ${campaignNumber(q.sample.target,q.sample.unit)}</span>`:''}
      ${links && !q.met?`<button class="linkish" data-act="campaign-help" data-arg="${q.help}">${helpers[q.help]} →</button>`:''}</li>`).join('')}</ol>`;
  }
  function campaignSummary(s){
    const active=s.campaigns?.active,why=game.campaignWhy();
    return `<div class="section-label"><span>Campaigns</span><span>3 stories · 3 chapters each</span></div><p class="note">Build a longer story with this airline. Existing routes and facilities count; delivery totals start fresh each chapter. No campaign deadline.</p>
      ${why?`<p class="why amber">${esc(why)}</p>`:''}<div class="campaign-cards">${Object.entries(CAMPAIGNS).sort(([a],[b])=>(b===active)-(a===active)).map(([id,profile])=>{
        const st=game.campaignStatus(id),run=st.run,status=run?.phase==='complete'?'Completed':st.active?run.phase==='ready'?'Reward ready':'Active':run?'Paused':'Available';
        return `<div class="item campaign-card ${st.active?'active':''}"><div class="row"><b>${profile.name}</b><span class="tag ${st.active?'amber':''}">${status}</span></div><p class="note">${run?.phase==='complete'?`Badge earned: ${profile.badge}. All three chapters completed.`:run?`Chapter ${run.chapter+1} / 3 · ${st.chapter.name}`:profile.pitch}</p>
          ${st.active?`<div class="meter"><i style="width:${st.progress*100}%"></i></div><span class="sub">${st.goals.filter(q=>q.met).length} / ${st.goals.length} objectives · ${fmtMoney(st.chapter.reward)} chapter grant</span>`:''}
          <button class="btn ${st.active && run.phase==='ready'?'':'ghost'} wide" data-act="campaign-open" data-arg="${id}">${st.active && run.phase==='ready'?'Review chapter reward':run?.phase==='complete'?'View completed campaign':st.active?'View chapter':'Explore campaign'}</button></div>`;
      }).join('')}</div>`;
  }
  function campaignModal(){
    const st=game.campaignStatus(campaignReview);if(!st){closeModal();return;}
    const {id,profile,run,chapter,active}=st,ready=run?.phase==='ready',complete=run?.phase==='complete',why=game.campaignWhy(),current=game.campaignRun();
    const next=profile.chapters[(run?.chapter || 0)+1],rules=`<p class="note">${profile.rules}</p>`;
    const chapters=`<ol class="campaign-chapters">${profile.chapters.map((c,i)=>{
      const earned=run?.rewards.some(r=>r.chapter===i),now=run && i===run.chapter && !complete;
      return `<li class="${earned?'done':now?'current':''}"><div class="row"><b>${earned?'✓ ':''}${i+1}. ${c.name}</b><span class="mono">${fmtMoney(c.reward)}</span></div><p class="note">${c.story}</p>
        <ul>${c.goals.map(q=>`<li>${q.label} · ${campaignNumber(q.target,q.unit)}</li>`).join('')}</ul>${earned?'<span class="sub good">Reward collected</span>':now?'<span class="sub amber">Current chapter</span>':''}</li>`;
    }).join('')}</ol>`;
    const body=run?`<div class="row"><span class="tag ${ready?'amber':''}">${complete?'Campaign complete':active?ready?'Chapter complete':'Active chapter':'Paused'}</span><span class="sub">Chapter ${run.chapter+1} of 3</span></div><h3>${chapter.name}</h3><p>${complete?`You earned the ${profile.badge} badge. Your airline completed all three chapters.`:chapter.story}</p>
      ${rules}${complete?`<div class="item">${kv('Badge earned',profile.badge)}${kv('Campaign grants collected',fmtMoney(run.rewards.reduce((n,r)=>n+r.amount,0)),'mono good')}</div>`:''}${campaignGoals(st,active && !ready && !complete)}
      ${ready?`<div class="item">${kv('Chapter grant',fmtMoney(chapter.reward),'mono good')}${kv('Cash after claiming',fmtMoney(game.state.money+chapter.reward),'mono')}
        <p class="note">Objectives are verified and stay complete. ${next?`Claiming starts “${next.name}” now, with fresh delivery counters and a fresh profitable-day streak.`:'Claiming finishes this campaign and awards its badge.'} Grants do not count as operating profit.</p></div>`:''}
      ${!ready && !complete?`<p class="note">Only activity while this campaign is active counts. Pausing keeps delivery totals and collected rewards.${chapter.streak?' Profitable-day streaks start with the next full day, require the listed network at each day’s close, and reset on a loss, a missing network requirement or a pause.':''}</p>`:''}
      ${st.network.routes[id].length?`<details class="route-section"><summary>Qualifying links · ${st.network.routes[id].length}</summary><div class="campaign-links">${st.network.routes[id].map(r=>`<button class="btn ghost small" data-act="campaign-route" data-arg="${r.id}">${r.hub} ⇄ ${r.dest}</button>`).join('')}</div></details>`:''}
      <details class="route-section"><summary>All chapters & rewards</summary>${chapters}</details>`:`<p>${profile.pitch}</p>${rules}${chapters}
      <p class="note">Start with this airline and its existing network. Only new deliveries count. Rewards are paid once per chapter, after you review them. You can pause or switch campaigns; delivery totals stay, but a profitable-day streak resets. Only one campaign can progress at a time.</p>`;
    showModal(`<div class="row"><div class="eyebrow">Airline campaign</div><button class="x" data-act="close-modal" aria-label="Close campaign">×</button></div><h2>${profile.name}</h2>
      ${!active && !complete && current?`<div class="item"><b class="amber">Switch active campaign</b><p class="note">Starting this campaign pauses ${CAMPAIGNS[game.state.campaigns.active].name}. Its completed work is kept; any current profitable-day streak resets.</p></div>`:''}${body}
      ${why?`<p class="why amber">${esc(why)}</p>`:''}<div class="btn-row"><button class="btn ghost" data-act="close-modal">${page==='company' && companyPane==='history'?'Back to history':'Back to game'}</button>
      ${complete?'':!active?`<button class="btn" data-act="campaign-start" data-arg="${id}" ${why?'disabled':''}>${run?'Resume campaign':current?'Switch campaign':'Start campaign'}</button>`:ready?`<button class="btn" data-act="campaign-claim" data-arg="${id}:${run.chapter}" ${why?'disabled':''}>${next?'Claim & next chapter':'Finish campaign'} · ${fmtMoney(chapter.reward)}</button>`:`<button class="btn ghost" data-act="campaign-pause" data-arg="${id}">Pause campaign</button>`}</div>`);
  }
  // The long mission: how much of the map is on your network, by continent, and what the next milestone pays.
  function worldSummary(s) {
    const w = game.worldProgress();
    const rows = w.continents.map((c) => `<div class="world-row"><span>${c.name}${c.full ? ' <span class="good">✓</span>' : ''}</span><span class="meter"><i style="width:${(c.served / c.total) * 100}%;${c.full ? 'background:var(--good)' : ''}"></i></span><span class="mono">${c.served} / ${c.total}</span></div>`).join('');
    const steps = WORLD_MILESTONES.map((m) => {
      const done = s.worldDone.includes(m.n);
      return `<div class="item goal ${done ? 'done' : ''}"><span class="tick"></span><div><div class="name">${milestoneName(m)}</div><div class="sub">Reward ${fmtMoney(m.reward)}${!done && w.next === m ? ` · ${m.n - w.served} to go` : ''}</div></div></div>`;
    }).join('');
    return `<div class="section-label"><span>${term('Connect the world', 'coverage')}</span><span>${w.served} / ${w.total} airports</span></div>
      <div class="item"><div class="meter"><i style="width:${(w.served / w.total) * 100}%"></i></div>
        <div class="world-rows">${rows}</div>
        <div class="sub" style="margin-top:8px">${w.full ? `${plural(w.full, 'continent')} fully covered: demand ${pct(w.bonus)} on every route.` : `Cover a whole continent for +${Math.round(CONTINENT_BONUS * 100)}% demand on every route, once per continent.`}</div>
        <button class="btn ghost wide" style="margin-top:8px" data-act="world-view">${coverView ? 'Hide coverage on the map' : 'Show unserved airports on the map'}</button></div>
      ${steps}`;
  }

  function goalsTab(s) {
    const sc = game.scenario();
    const w = game.worldProgress();
    const box = sc.goal && !sc.deadline ? `<div class="section-label"><span>${sc.name}</span><span>${w.served} of ${w.total} airports</span></div>
      <div class="item"><div class="name">${sc.goal}</div>
      <div class="meter"><i style="width:${Math.min(100, (w.served / w.total) * 100)}%"></i></div></div>` : sc.goal ? `<div class="section-label"><span>${sc.name}</span><span>Day ${Math.min(s.day + 1, sc.deadline)} of ${sc.deadline}</span></div>
      <div class="item"><div class="name">${sc.goal}</div>
      <div class="meter"><i style="width:${Math.min(100, (s.day / sc.deadline) * 100)}%"></i></div>
      ${sc.id === 'daily' ? kv('Net worth so far', fmtMoney(game.netWorth()), 'mono') : ''}</div>` : '';
    return `${box}${campaignSummary(s)}${worldSummary(s)}<div class="section-label"><span>Goals</span><span>${s.goalsDone.length} / ${GOALS.length}</span></div>` +
      GOALS.map((g) => `<div class="item goal ${s.goalsDone.includes(g.id) ? 'done' : ''}">
        <span class="tick"></span>
        <div><div class="name">${g.title}</div><div class="sub">Reward ${fmtMoney(g.reward)}</div></div>
      </div>`).join('') +
      `<div class="section-label"><span>Achievements</span><span>${s.achDone.length} / ${ACHIEVEMENTS.length}</span></div>` +
      ACHIEVEMENTS.map((a) => `<div class="item goal ${s.achDone.includes(a.id) ? 'done' : ''}">
        <span class="tick"></span>
        <div><div class="name">${a.title}</div><div class="sub">${a.desc}${a.id === 'streak100' && !s.achDone.includes(a.id) ? ` · ${s.streak} so far` : ''}</div></div>
      </div>`).join('') +
      `<div class="note">Achievements pay nothing. They are there for when the goals run out. The last one needs a Global Hub and a company value of ${fmtMoney(LISTING_VALUE)}; see Finance.</div>`;
  }

  const companyDate = minute => { const day = Math.floor(minute/1440); return `Day ${day+1} · ${fmtDate(day)}, year ${dateOf(day).year}`; };
  function companyTab(s) {
    const c=s.company, r=c.records;
    const stat=(label,value)=>`<div class="company-stat"><span class="sub">${label}</span><strong>${value}</strong></div>`;
    const badges=Object.entries(CAMPAIGNS).filter(([id])=>s.campaigns.runs[id]?.phase==='complete');
    const events=c.timeline.filter(e=>historyFilter==='all' || e.kind===historyFilter).slice().reverse();
    const history=`<div class="company-filters" role="group" aria-label="History filters">${[['all','All events'],['network','Network'],['milestones','Milestones']].map(([id,label])=>`<button class="btn ghost small ${historyFilter===id?'on':''}" aria-pressed="${historyFilter===id}" data-act="company-filter" data-arg="${id}">${label}</button>`).join('')}</div>
      <p class="note">Major moments are kept separately from News.${c.legacy?' History started '+companyDate(c.since)+'. Older events appear only where their date is known.':''}${c.archived?` ${c.archived} older entries archived; the latest 500 are retained.`:''}</p>
      <ol class="company-timeline">${events.slice(0,historyLimit).map(e=>{const target=companyEventTarget(game,e);return `<li><span class="sub">${companyDate(e.minute)}${e.dayOnly?'':` · ${String(Math.floor(e.minute%1440/60)).padStart(2,'0')}:${String(Math.floor(e.minute%60)).padStart(2,'0')}`}</span><b>${esc(e.title)}</b>${e.detail?`<p>${esc(e.detail)}</p>`:''}${target?`<button class="btn ghost small company-event-link" data-act="company-event" data-arg="${esc(e.key)}">${alertTargetLabel(target)} →</button>`:''}</li>`;}).join('') || '<li class="note">No milestones in this category yet. Your next chapter is still ahead.</li>'}</ol>
      ${events.length>historyLimit?`<button class="btn ghost wide" data-act="company-more">Show 25 more events</button>`:''}`;
    const profile=`<div class="section-label">Lifetime activity</div><div class="company-stats">${stat('Passengers carried',s.totalPax.toLocaleString())}${stat('Flights completed',s.flights.toLocaleString())}${stat('Contracts completed',s.contractsDone.toLocaleString())}${stat('Freight delivered',`${(s.freight?.delivered || 0).toLocaleString(undefined,{maximumFractionDigits:1})} t`)}${stat('Connecting journeys',(s.connections?.total?.completed || 0).toLocaleString())}${stat('Airlines acquired',s.takeovers)}</div>
      <div class="section-label">Your network today</div><div class="item">${kv('Hubs / routes / aircraft',`${s.hubs.length} / ${s.routes.length} / ${s.planes.length}`,'mono')}${kv('Company value',fmtMoney(game.valuation()),'mono')}${kv('Reputation',`${Math.round(s.rep)} / 100 · ${repName(s.rep)}`)}</div>
      <div class="section-label">Company records</div>${c.legacy?`<p class="note">Network, value and flight records are tracked from ${companyDate(c.since)}. Lifetime activity and best daily profit include your earlier progress.</p>`:''}
      <div class="item">${kv('Largest fleet',`${Math.max(r.fleet,s.planes.length)} aircraft`)}${kv('Largest network',`${Math.max(r.hubs,s.hubs.length)} hubs · ${Math.max(r.routes,s.routes.length)} routes`)}${kv('Highest company value',fmtMoney(Math.max(r.value,game.valuation())),'mono')}${kv('Best daily profit',s.bestDay>0?fmtMoney(s.bestDay):'No profitable day yet','mono')}${kv('Longest run without a loss',`${r.streak} days`)}${kv('Highest reputation',`${Math.round(Math.max(r.reputation,s.rep))} / 100`)}
      ${r.busiestDay?kv('Busiest passenger day',`${r.busiestDay.pax.toLocaleString()} passengers · day ${r.busiestDay.day+1}`):'<p class="note">Your busiest day appears after a full recorded day closes.</p>'}
      ${r.longestFlight?kv('Longest completed flight',`${r.longestFlight.from} → ${r.longestFlight.to} · ${km(r.longestFlight.km)}`):'<p class="note">Complete a flight to set your distance record.</p>'}</div>
      <div class="section-label">Honors</div><div class="company-badges">${badges.map(([,p])=>`<span class="tag amber">✓ ${p.badge}</span>`).join('') || '<p class="note">Complete a campaign to earn your first airline badge.</p>'}</div>
      <details class="route-section"><summary>Achievements earned · ${s.achDone.length} / ${ACHIEVEMENTS.length}</summary>${ACHIEVEMENTS.filter(a=>s.achDone.includes(a.id)).map(a=>`<div class="item"><b class="good">✓ ${a.title}</b><p class="note">${a.desc}</p></div>`).join('') || '<p class="note">Achievements will be displayed here as you earn them.</p>'}</details>
      <button class="btn ghost wide" data-act="page" data-arg="goals">View goals & campaigns</button>`;
    return `<div class="company-page"><section class="company-banner" style="--brand:${companyColor(s)}"><div class="company-mark" aria-hidden="true">${icon('company')}</div><div><div class="eyebrow">Your airline</div><h3>${esc(c.name)}</h3><p class="sub">Home: ${c.home} · ${AIRPORT_BY_ID[c.home].city} · ${difficultyOf(s).name}</p></div><button class="btn ghost wide" data-act="company-edit">Edit airline identity</button></section>
      <div class="seg company-tabs" role="group" aria-label="Company view">${[['profile','Profile & records'],['history','History']].map(([id,label])=>`<button data-act="company-pane" data-arg="${id}" aria-pressed="${companyPane===id}" class="${companyPane===id?'on':''}">${label}</button>`).join('')}</div>${companyPane==='history'?history:profile}</div>`;
  }
  function companyModal() {
    const draft=companyReview;if(!draft)return;
    const plane=draft.kind==='plane'?game.plane(draft.id):null;
    if(draft.kind==='plane' && !plane){closeModal();return;}
    showModal(`<div class="row"><div class="eyebrow">${plane?'Aircraft identity':'Airline identity'}</div><button class="x" data-act="close-modal" aria-label="Cancel identity changes">×</button></div><h2>${plane?'Name your aircraft':'Make this airline yours'}</h2>
      <label class="company-field" for="company-name">${plane?'Aircraft name':'Airline name'}<input id="company-name" data-company-name type="text" maxlength="${plane?32:40}" value="${esc(draft.name)}" autocomplete="off" aria-describedby="company-name-help company-error"></label>
      <p class="note" id="company-name-help">${plane?'Up to 32 characters. Its registration and assignments stay the same.':'Up to 40 characters. Letters, numbers and simple punctuation.'}</p>
      ${plane?`<button class="btn ghost small" data-act="company-registration">Use registration · ${planeRegistration(plane)}</button>`:`<fieldset class="company-colors"><legend>Airline color</legend>${Object.entries(BRAND_COLORS).map(([id,color])=>`<button type="button" class="company-swatch ${draft.color===id?'on':''}" style="--swatch:${color.hex}" data-act="company-color" data-arg="${id}" aria-pressed="${draft.color===id}"><i aria-hidden="true"></i>${color.name}${draft.color===id?' ✓':''}</button>`).join('')}</fieldset>`}
      <div class="company-preview" style="--brand:${BRAND_COLORS[draft.color].hex}"><span class="sub">Preview</span><div><span class="company-preview-plane" aria-hidden="true">✈</span><b id="company-preview-name">${esc(draft.name) || 'Your airline'}</b></div><span class="sub">${plane?`${planeRegistration(plane)} · ${AIRCRAFT[plane.type].name}`:'Your hubs, routes and aircraft will use this color.'}</span></div>
      <p class="note">${plane?'Find this aircraft by its name or registration in Search.':'Profit colors and warning colors keep their usual meaning. Branding is free.'}</p><p id="company-error" class="bad" role="alert"></p>
      <div class="btn-row"><button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn" data-act="company-save">Save changes</button></div>`);
  }

  function moreTab() {
    return `<div class="section-label">App</div><button class="btn ghost wide" data-act="pwa-open">${pwa.getState().updateReady ? 'App update available' : pwa.getState().installed ? 'App & offline play' : 'Install Airport Manager'}</button><div class="section-label">Help</div>
      <div class="btn-row"><button class="btn ghost" data-act="help">How to play</button>
        <button class="btn ghost" data-act="guide-library">Tutorials & lessons</button></div>
      <div class="section-label">Sound</div>
      <button class="btn ghost wide" data-act="mute">${audio.muted ? 'Turn sound on' : 'Turn sound off'}</button>
      <div class="section-label">Share</div>
      <div class="item"><div class="sub">Save a picture of the map as it looks right now, with your stats along the bottom.</div>
        <button class="btn ghost wide" style="margin-top:8px" data-act="share">Save network picture</button></div>
      <div class="section-label">While you’re away</div>
      <div class="item"><div class="sub">Close the tab with the game running and your aircraft keep flying at a quarter of normal pace, for up to four hours. Pausing first stops that.</div></div>
      <div class="section-label">Keys</div>
      <div class="item"><div class="sub">Space pauses. 1, 2 and 3 set the speed. Esc closes whatever is open.<br>
        / search the network · O Operations · A every aircraft · F route finder · C contracts · N news · K calendar · R rivals · B finance (books) · G goals<br>
        P profit view · E Earth or map view · S sound · H help</div></div>
      <div class="section-label">Weekly report</div>
      <button class="btn ghost wide" data-act="weekly-toggle">${weeklyOff ? 'Show the report every week' : 'Stop showing it every week'}</button>
      <div class="note">The latest report can always be opened from News.</div>
      <div class="section-label">Map imagery</div>
      <div class="item"><div class="sub">Earth terrain: NASA Blue Marble Next Generation, August 2004, with shaded land and ocean relief. Higher-resolution satellite detail loads as you zoom in.</div><a class="btn ghost wide" href="https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/" target="_blank" rel="noopener noreferrer" style="margin-top:8px">Terrain imagery source ↗</a></div>
      <div class="item"><div class="sub">Night lights: NASA Earth Observatory / NASA Goddard, Black Marble 2016, from Suomi NPP VIIRS observations. A satellite composite, colored to match the game; the day/night fade follows the game clock.</div><a class="btn ghost wide" href="https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/" target="_blank" rel="noopener noreferrer" style="margin-top:8px">Satellite imagery source ↗</a></div>
      <div class="section-label">Game</div>
      <div class="item">${kv(term('Difficulty', 'difficulty'), difficultyOf(game.state).name)}<div class="note">Chosen when the game was started. Start over to change it.</div></div>
      <button class="btn danger wide" data-act="new-game">Start over</button>`;
  }

  function appModal() {
    const s = pwa.getState();
    const offline = s.offlineReady ? 'Ready for offline play' : !s.production ? 'Offline play is available on the published game.' : !s.supported ? 'Open the secure game website in Safari or Chrome to set up offline play.' : 'Preparing offline play. Keep the game open and online until this says Ready.';
    showModal(`<div data-pwa-panel><div class="row"><div class="eyebrow">Play from your home screen</div><button class="x" data-act="close-modal" aria-label="Close app settings">×</button></div>
      <div class="pwa-heading"><img src="/icons/airport-manager-192.png" width="64" height="64" alt=""><div><h2>Airport Manager</h2><p class="sub">${s.installed ? 'Running as an app' : 'Your airline, one tap away.'}</p></div></div>
      ${!s.installed ? `${s.canInstall ? '<button class="btn wide" data-act="pwa-install">Install app</button>' : ''}<div class="section-label">Add to your phone</div><div class="item"><b>iPhone / iPad</b><p class="note">Open the game in Safari. Tap Share (or Menu → Share), then Add to Home Screen. Keep Open as Web App on if shown, then tap Add.</p></div><div class="item"><b>Android</b><p class="note">Open the game in Chrome. Tap Install app above when available, or use the browser menu → Install app / Add to Home screen.</p></div>` : ''}
      <div class="section-label">Offline play</div><div class="item"><b class="${s.offlineReady ? 'good' : 'sub'}">${offline}</b><p class="note">The game and base maps are saved for offline use. Sharper satellite detail loads online and recent areas are kept as space allows.</p></div>
      <p class="note">Progress is stored on this device and browser. There is no cloud sync between your phone and computer.</p>
      ${s.updateReady ? '<div class="item"><b class="amber">An update is ready</b><p class="note">Apply it when you’re ready. Your game is saved before the app restarts.</p></div>' : ''}
      ${s.message ? `<p class="note" role="status">${esc(s.message)}</p>` : ''}</div>
      <div class="btn-row"><button class="btn ghost" data-act="close-modal">Back to game</button>${s.updateReady ? `<button class="btn" data-act="pwa-update" ${s.updating ? 'disabled' : ''}>${s.updating ? 'Updating…' : 'Save & update'}</button>` : s.offlineReady ? `<button class="btn ghost" data-act="pwa-check" ${s.checking ? 'disabled' : ''}>${s.checking ? 'Checking…' : 'Check for updates'}</button>` : ''}</div>`);
  }

  function tutorialSeen() { try { return localStorage.getItem(TUTORIAL_KEY) === '1'; } catch { return false; } }
  function tutorialMenu() {
    tutorialBrowse = true;
    const first = LESSON_BY_ID['first-flight'];
    showModal(`<div class="row"><div class="eyebrow">Learn at your own pace</div><button class="x" data-act="close-modal" aria-label="Close tutorials">×</button></div>
      <h2>Tutorials</h2><p>Learn by playing, then explore the other mechanics whenever you’re ready.</p>
      <article class="item lesson-card lesson-first"><div class="sub amber">Recommended · ${first.steps.length} guided steps</div><h3>${first.title}</h3><p>${first.summary}</p>
        <div class="tutorial-start-details"><b>London · Easy · Free play</b><span>Starts paused so you can follow along. Keep building the same airline after the tutorial.</span></div></article>
      <div class="section-label">Optional lessons · ${LESSONS.length - 1}</div>
      <p class="note">Preview a topic below. Once you’re playing, open Menu → Tutorials to start or resume any lesson.</p>
      ${LESSONS.filter(l => l.id !== 'first-flight').map(l => `<details class="route-section tutorial-preview"><summary>${esc(l.title)}</summary><p>${esc(l.summary)}</p><ol>${l.steps.map(step => `<li>${esc(step.title)}</li>`).join('')}</ol>${l.requires ? `<p class="note">Practice this lesson after ${l.requires === 'route' ? 'opening a route' : 'adding an aircraft'}.</p>` : ''}</details>`).join('')}
      <div class="btn-row"><button class="btn ghost" data-act="close-modal">Back</button><button class="btn" data-act="tutorial-begin">Start guided game</button></div>`, false);
  }
  function guideAt(go) {
    if (!$('#view').hidden) return false;
    if (modal) return go === 'projects' ? !!projectReview : go === 'roles' ? commercialReview?.kind?.startsWith('specialization')
      : go === 'responses' ? !!disruptionReview : ['aircraft-choice', 'launch'].includes(go) && !!launch;
    if (go === 'operations') return opsOpen && opsView === 'overview';
    if (go === 'ops-routes') return opsOpen && opsView === 'routes';
    if (go === 'ops-fleet') return opsOpen && opsView === 'aircraft';
    if (go === 'results') return opsOpen && opsView === 'results';
    if (go === 'upgrades') return !page && !opsOpen && !sel && tab === 'airport' && (!mobileMedia.matches || mobileTab !== 'map');
    if (go === 'plane') return !page && !opsOpen && sel?.kind === 'plane';
    if (['route-overview', 'route-fare', 'watch'].includes(go)) return !page && !opsOpen && cardRouteId() === tutorialRoute(game.state)?.id && routePane === (go === 'route-fare' ? 'fare' : 'overview');
    if (go === 'history') return page === 'company' && companyPane === 'history';
    if (go === 'freight-finder') return page === 'finder' && finderKind === 'cargo';
    if (go === 'freighter-shop') return page === 'market' && shopKind === 'cargo';
    return page === go;
  }
  function guideGo(go = currentLesson(game.state)?.step.go) {
    if (!go) return;
    if (['aircraft-choice', 'launch'].includes(go) && launch) return;
    closeModal(); actions['close-view'](); navOpen = false; hubMenu = false;
    const route = tutorialRoute(game.state);
    if (['route-overview', 'route-fare', 'watch', 'aircraft-choice', 'launch'].includes(go)) {
      if (!route) { actions.page('finder'); return; }
      select({kind: 'route', id: route.id}, true);
      routePane = go === 'route-fare' ? 'fare' : ['aircraft-choice', 'launch'].includes(go) ? 'aircraft' : 'overview';
      if (routePane === 'aircraft') addFor = route.id;
    } else if (go === 'plane') {
      const p = game.state.planes.find(p => p.hub === game.state.active) || game.state.planes[0];
      if (p) select({kind: 'plane', id: p.id}, true);
    } else if (['operations', 'ops-routes', 'ops-fleet', 'results'].includes(go)) {
      rememberView(); opsOpen = true; opsHub = 'all'; page = null; sel = null; map.setSelected(null);
      opsView = {operations:'overview', 'ops-routes':'routes', 'ops-fleet':'aircraft', results:'results'}[go];
      routeFilter = 'all'; fleetFilter = 'all'; routeQuery = ''; fleetQuery = ''; $('#ops-body').scrollTop = 0;
    } else if (go === 'upgrades') { actions.tab('airport'); $('#panel').classList.add('expanded'); }
    else if (go === 'roles') actions['specialization-open'](game.state.active);
    else if (go === 'projects') actions['projects-open'](game.state.active);
    else if (go === 'responses') actions['response-list']();
    else {
      rememberView(); page = go === 'history' ? 'company' : go === 'freight-finder' ? 'finder' : go === 'freighter-shop' ? 'market' : go;
      if (go === 'history') companyPane = 'history';
      if (go === 'company') companyPane = 'profile';
      if (go === 'freighter-shop') shopKind = 'cargo';
      if (page === 'finder') { finderKind = go === 'freight-finder' ? 'cargo' : 'passenger'; finderQuery = ''; finderClear = false; finderMarket = 'all'; }
      opsOpen = false; sel = null; map.setSelected(null); $('#page-body').scrollTop = 0;
    }
  }
  function lessonsTab(s) {
    const t = ensureTutorial(s);
    return `<div class="lesson-intro"><div class="eyebrow">Learn at your own pace</div><p>Start with one flight, then explore any lesson. Guidance stays with you across screens. Progress is saved; pause and return whenever you like.</p><div class="row"><span class="sub">${t.completed.length} of ${LESSONS.length} lessons completed</span><button class="btn ghost small" data-act="help">How to play</button></div></div>` + LESSONS.map(l => {
      const run = t.progress[l.id], done = t.completed.includes(l.id), why = lessonWhy(s, l);
      const status = run ? `${t.active === l.id ? 'In progress' : 'Paused'} · step ${run.step + 1} of ${l.steps.length}` : done ? 'Completed' : l.id === 'first-flight' ? 'Start here · guided play' : `${l.steps.length} short steps · optional`;
      return `<article class="item lesson-card ${l.id === 'first-flight' ? 'lesson-first' : ''}"><div class="sub ${done ? 'good' : ''}">${status}</div><h3>${l.title}</h3><p>${l.summary}</p>${why ? `<p class="note">${why}</p>` : ''}<div class="btn-row"><button class="btn ${l.id === 'first-flight' ? '' : 'ghost'}" data-act="guide-start" data-arg="${l.id}" ${why ? 'disabled' : ''}>${run ? 'Resume' : done ? 'Replay' : 'Start'} ${l.id === 'first-flight' ? 'first flight' : 'lesson'}</button>${run ? `<button class="btn ghost" data-act="guide-restart" data-arg="${l.id}" ${why ? 'disabled' : ''}>Restart</button>` : ''}</div></article>`;
    }).join('');
  }
  function updateGuideSpace() {
    const height = $('#guide').hidden ? 0 : Math.ceil($('#guide').getBoundingClientRect().height) + 12;
    document.documentElement.style.setProperty('--guide-space', `${height}px`);
  }
  new ResizeObserver(updateGuideSpace).observe($('#guide'));
  function setGuideHTML(html) {
    const guide = $('#guide'), hadFocus = guide.contains(document.activeElement);
    setHTML(guide, html);
    if (hadFocus && !guide.contains(document.activeElement)) guide.querySelector('.guide-toggle, [data-act="guide-library"]')?.focus({preventScroll:true});
  }
  function renderGuide(s) {
    const guide = $('#guide'), current = s && currentLesson(s);
    const visible = !!s && !s.over && page !== 'learn' && (!!current || !!guideFinished);
    guide.hidden = !visible;
    document.body.classList.toggle('has-guide', visible);
    if (!visible) { updateGuideSpace(); return; }
    const parent = modal ? $('#modal') : document.body;
    if (guide.parentElement !== parent) parent.append(guide);
    if ($('#guide-status').parentElement !== parent) parent.append($('#guide-status'));
    const t = ensureTutorial(s), collapsed = mobileMedia.matches ? !mobileGuideExpanded : t.collapsed;
    guide.classList.toggle('collapsed', collapsed);
    if (guideFinished && !current) {
      setGuideHTML(`<div class="guide-head"><b>✓ ${esc(LESSON_BY_ID[guideFinished].title)} complete</b><button class="x" data-act="guide-dismiss" aria-label="Dismiss lesson completion">×</button></div><div class="guide-copy"><p>Keep building at your own pace. Optional lessons are always available in Menu → Tutorials.</p></div><div class="guide-actions"><button class="btn" data-act="guide-library">Choose another lesson</button><button class="btn ghost" data-act="guide-dismiss">Keep exploring</button></div>`);
      updateGuideSpace(); return;
    }
    const {lesson, run, step} = current, first = lesson.id === 'first-flight';
    let text = step.text, label = step.label;
    const route = tutorialRoute(s), staffed = route && game.planesOn(route.id).length;
    if (first && run.step === 2 && route && !launch && !staffed) { text = 'This route is open but has no aircraft. Open its Aircraft section to assign a parked aircraft, buy one or review a lease. It will start earning only after an aircraft is assigned and lands.'; label = 'Assign an aircraft'; }
    if (first && run.step === 4) text += modal ? ' Close this dialog to let time run.' : s.speed ? ` Time is running at ${s.speed}×.` : ' The game is paused.';
    const canNext = canAdvanceLesson(s), manual = !first || run.step === 0 || run.step === 5;
    const alreadyThere = step.go && guideAt(step.go);
    const title = `${lesson.title} · ${run.step + 1}/${lesson.steps.length}`;
    setGuideHTML(`<div class="guide-head"><button class="guide-toggle" data-act="guide-collapse" aria-expanded="${!collapsed}" aria-controls="guide-detail"><span class="tut-step">${esc(title)}</span><strong>${esc(step.title)}</strong><span aria-hidden="true">${collapsed ? '▴' : '▾'}</span></button><button class="x" data-act="guide-pause" aria-label="Pause lesson" data-tip="Pause lesson · resume from Tutorials">×</button></div>
      <div id="guide-detail" ${collapsed ? 'hidden' : ''}><div class="guide-copy"><p>${esc(text)}</p>${!first && !run.seen ? '<span class="guide-prompt">Open the screen below, then continue when you’re ready.</span>' : ''}</div><div class="guide-actions">${step.go && !alreadyThere ? `<button class="btn ${manual && canNext ? 'ghost' : ''}" data-act="guide-go">${esc(label)}</button>` : ''}${first && alreadyThere && [2, 3].includes(run.step) ? `<span class="guide-prompt">${run.step === 2 ? 'Choose Review launch above.' : 'Confirm Launch route above.'}</span>` : ''}${first && run.step === 4 ? `<button class="btn" data-act="guide-speed" ${modal ? 'disabled' : ''}>${s.speed === 10 ? 'Pause' : s.speed ? 'Run at 10×' : 'Resume time'}</button>` : ''}${manual ? `<button class="btn" data-act="guide-next" ${canNext ? '' : 'disabled'}>${run.step === lesson.steps.length - 1 ? 'Finish lesson' : first ? 'Let’s begin' : 'Next'}</button>` : ''}<button class="btn ghost" data-act="guide-library">Lessons</button></div></div>`);
    const announcement = `${title}. ${step.title}`;
    if ($('#guide-status').textContent !== announcement) $('#guide-status').textContent = announcement;
    updateGuideSpace();
  }
  function helpModal() {
    const sec = (h, t) => `<h4>${h}</h4><p>${t}</p>`;
    showModal(`<div class="row"><div class="eyebrow" style="margin:0">How to play</div><button class="x" data-act="close-modal" aria-label="Close">×</button></div>
      <div class="help">
      ${sec('Tutorials', 'Menu → Tutorials opens the guided first flight and optional lessons for the other mechanics. The guide stays visible across panels and review dialogs. Collapse it for more space, or pause it and resume later. Each lesson saves its progress. Lessons explain decisions; purchases still need your normal confirmation.')}
      ${sec('The goal', 'Grow a small airstrip into a Global Hub. Open routes, buy aircraft, and spend the profit on upgrades.')}
      ${sec('Routes', 'Click any airport to see what a route there would earn, then open it. Demand depends on the city’s size, the distance, your ticket price, the season, events, rivals, and how many other routes feed transfers into it.')}
      ${sec('Finding routes', 'The Routes tab has a route finder: every airport your hub can reach, ranked by what one aircraft would earn there. Turn on Profit view on the map to see which of your routes make money (green) and which lose it (red).')}
      ${sec('Aircraft', 'Each aircraft flies one route back and forth, and a busy route can take several. It needs enough range for the route and a runway of its class. They age: older ones cost more and break down more, so overhaul or replace them.')}
      ${sec('Transfers', 'Connecting journeys need two staffed flights through a hub, available seats and open airports. Passengers share capacity with local travelers, wait for their onward flight and can miss their connection. Useful short routes can feed a longer flight when both legs have capacity.')}
      ${sec('Company and history', 'Company lets you change your airline’s name and color, track records and browse major milestones. History links back to routes, airports, projects and campaigns that are still available. Aircraft names can be changed from their inspection cards; registrations stay stable for search.')}
      ${sec('Contracts and reputation', 'Contracts in the top bar are timed jobs with a cash reward, such as flying fans to a cup final. Fair prices, a young fleet, lounges and business cabins raise your reputation, which lifts demand everywhere; missed contracts, breakdowns and strikes lower it.')}
      ${sec('Price and cabin', 'On a route’s card, lower prices fill seats and higher prices earn more per seat. Business seats take double the room and pay triple, which works best to big cities.')}
      ${sec('Upgrades', 'Runway: bigger aircraft and longer routes. Terminal: more routes and demand. Gates: more aircraft. Shops: income per passenger. Cargo: freight on every flight. Fuel depot: cheaper flights. Marketing: more demand.')}
      ${sec('Calendar and events', 'Events are known weeks ahead. Festivals multiply demand to a city, storms and strikes close airports, fuel prices move. Hedge fuel or negotiate with strikers early from the Calendar page.')}
      ${sec('Partnerships', 'In Rivals, review a 28-day agreement with an airline that connects to your staffed network. Choose reciprocal or partner-favored revenue shares; up to two agreements can be active. Partners reserve 20% of economy seats on shared legs. Your flights use their normal cabin capacity. Referral payments happen only after the onward flight lands. The onward operator pays missed-connection compensation; you cover the claim if the partner closes. End an agreement to stop new bookings; existing journeys retain their terms. Renew in the last three days. Partners still compete on direct routes but do not start new fare wars during an active agreement.')}
      ${sec('Rivals', 'Six airlines run paid aircraft networks and can expand into multiple hubs. Each earns revenue and pays fuel, maintenance and airport costs. They adjust fares, service frequency and cabins, compare owned and leased aircraft, and invest in hub specializations and required facilities. Lease rent and conversion costs come from their own reserves. At expiry they buy a replacement, renew a sustainable lease, or withdraw. They still abandon loss-making markets and invest surplus cash. Hard rivals plan more frequently, examine more opportunities and keep larger reserves. Their hubs and routes show on the map.')}
      ${sec('Taking a rival down', 'Rival hubs are occupied while their airline operates. Competitive services can reduce their earnings, but profitable routes elsewhere can support recovery. Sustained losses and depleted reserves may trigger a takeover offer for its hubs, routes and aircraft. Ten days of negative cash closes the airline; a new entrant may arrive later.')}
      ${sec('Connecting the world', 'Goals tracks how many of the map’s airports are on your network, by continent. Milestones at 25, 50, 100, 200, 300 and every airport pay cash, and each fully covered continent lifts demand on all routes by 3%. Coverage view (W) highlights the airports you don’t serve yet, and the route finder can list only those.')}
      ${sec('Hubs', 'Once a hub is a Regional Airport you can buy another airport as a hub. Link hubs with a route and each feeds passengers to the other.')}
      ${sec('Money', 'Loans and investors give cash now at a cost later. Five days in a row below zero ends the game.')}
      ${sec('Fuel and price wars', 'The fuel price drifts from day to day; Finance shows it and lets you lock a price for 30 days. A route that earns well can draw a rival in with introductory fares. After twelve days it reviews profitability and reserves. It may withdraw, or remain as a lasting competitor.')}
      ${sec('Managing routes and aircraft', 'The Routes tab lists the hub’s routes with the aircraft that fly each one. Click an aircraft to inspect it, then choose Move / assign, Swap, Replace aircraft, or Maintain. Each action previews its cost and affected routes before you apply it. Dragging also opens a preview. “+ aircraft” assigns a parked one or buys the type that suits the route. A route’s card suggests fixes with the gain per day, and Auto-fit proposes the best route for every aircraft at a hub. “Operations” (O) opens a live needs-attention overview. Click a count to filter the lists, or an active problem to inspect the exact route, aircraft or contract. Resolved problems clear automatically; News keeps the announcement history.')}
      ${sec('Disruption management', 'Open Operations → Review responses, or use the response button on a disrupted route, repairing aircraft, or signed contract. Compare waiting, temporary aircraft cover, a 7-day lease, Frequent service, strike settlement and passenger compensation. Previews show affected routes, costs and expected contract deliveries. Temporary aircraft return after the incident ends or contract target completes, between trips; full gates or closures delay that return. Manual assignment changes cancel it. Compensation is paid once per incident: it recovers half a breakdown’s recorded reputation loss, or halves a closure’s remaining penalty. It does not reopen airports or extend deadlines.')}
      ${sec('Finding things and returning', 'Use Search (/) to find cities, routes and aircraft across your network. Route, fleet and destination lists have their own search fields, which work together with filters. Back returns to your previous selection, filters and list position. Operations → Results compares the original estimate with the next three full days after a management change; further changes stop an unfinished comparison.')}
      ${sec('Campaigns', 'Open Goals & campaigns from the menu. Free-play airlines can pursue Regional Lifeline, Freight Corridor or World Connector without starting over. Each has three chapters, actual delivery targets and one-time grants. Existing routes and facilities count immediately; delivery totals start at zero each chapter. A ready chapter waits for you to claim its reward and start the next one. Grants are separate from operating profit. Pause or switch campaigns to keep delivery totals and rewards; profitable-day streaks reset, and paused activity does not count. Scenarios and the daily challenge keep their existing rules; campaigns become available if you continue in free play.')}
      ${sec('Passenger types and airport markets', 'Leisure travelers respond most to fares and seasons. Business travelers value frequent service, reputation, aircraft condition and business cabins. Connecting travelers fly two actual legs through one of your hubs, using economy seats on both. They transfer for 30–80 minutes and board onward flights ahead of new economy bookings. After 12 hours without an onward flight, their connection is missed and compensation is paid. Route Overview shows journeys, shared capacity limits and waiting travelers; Operations links to connections at risk. Fare & cabin shows the live passenger mix; service previews show each group before and after. Business travelers can buy economy, while contracts remain separate. Airport market cards show local passenger strengths, freight yields, upkeep and construction costs. These are balanced game profiles, not live airport statistics.')}
      ${sec('Airport projects', 'In Upgrades, open Plan & manage projects. Each hub has two sites and can build one project at a time. Choose a satellite concourse, ground operations center, automated freight depot or solar utilities. Pay 25% for preparation, 50% for construction and 25% for commissioning; each stage waits for your next payment, without extra fees. Active construction adds 20% to local turnaround times, commissioning 10%; preparation and waiting add no delay. Benefits start after completion. Previews show costs, capacity, operating upkeep and affected network profit. Operations links to stages awaiting funding; Finance separates capital payments from operating profit. Canceled projects forfeit paid stages. Completed projects can be removed for a clearance fee; a concourse can only be removed if its extra capacity is no longer needed.')}
      ${sec('Freight operations', 'Buy or lease freighters in the aircraft market, or convert an owned Sparrow, Heron or Albatross from its inspection panel. Conversions require a cargo terminal and two days on the ground; age is retained. Freighters share routes with passenger aircraft but carry no passengers. Larger cargo terminals unlock more of their hold. Bulk leaves at 70% full or after 6 hours, with a 72-hour deadline. Express leaves at 25% full or after 1 hour, with a 24-hour deadline and higher rates. Bookings use finite demand and earn on delivery. Late deliveries earn 25%; expired or canceled waiting bookings cost 10% compensation. Switching service cancels waiting bookings after a preview. Airborne freight keeps its original terms. Cargo contracts count actual on-time outward tonnes once. Operations links to waiting freight at risk.')}
      ${sec('Hub specializations', 'In Upgrades, compare Budget, Premium, Transfer and Cargo roles. Requirements show your progress toward unlocking each. Review the conversion fee, operating costs and route-by-route forecast before committing for 14 days. Benefits depend on your routes and service choices; fees and trade-offs stay in force. Each hub has its own role, and older saves start as General purpose.')}
      ${sec('Leasing and repeat work', 'Lease an aircraft from Fleet or while planning a route. Review the setup fee, daily rent and minimum term before confirming. Finance tracks remaining rent; Fleet and Operations flag leases in their final three days. Finish a client’s first charter to unlock a three-week agreement in Contracts. Each week pays separately and only traffic on the named route counts.')}
      ${sec('Service frequency', 'Open a route’s Fare & cabin section to preview Economy, Balanced or Frequent service. Economy waits for fuller aircraft; Frequent leaves sooner and attracts extra regular demand. Review estimated departures and profit before applying; actual flights depend on loads and disruptions.')}
      ${sec('On a phone', 'Use the bottom navigation for Map, Routes, Fleet, Operations and More. Tap an airport or aircraft on the map for a short preview, then open its details. Routes and Fleet have search and attention filters; Filters opens every filter and sorting choice. More contains hub upgrades, finance, contracts and tutorials. Route details have Overview, Aircraft, and Fare & cabin sections. Back restores your previous list and scroll position. Tap the tutorial strip to expand or collapse instructions.')}
      ${sec('Keys', '/ Search, O Operations, A every aircraft, F route finder, C contracts, N news, K calendar, R rivals, B finance, G goals, P profit view, E Earth view, S sound, H this help.')}
      ${sec('Time', 'Space pauses; 1, 2 and 3 set the speed. Leave the game running and it keeps earning at a quarter pace for up to four hours.')}
      </div>
      <div class="card-actions"><button class="btn wide" data-act="close-modal">Got it</button></div>`);
  }

  const currentTip = (s) => (!currentLesson(s) && s.flights > 0 ? TIPS.find((t) => !s.tips.includes(t.id) && t.when(s)) : null);
  function tipHTML(t) {
    return `<div class="row"><span class="tut-step">Tip</span></div>
      <div class="tut-title">${esc(t.title)}</div><div>${esc(t.text)}</div>
      <div class="tut-actions">${t.go ? `<button class="btn ghost small" data-act="tip-go" data-arg="${t.id}">Show me</button>` : '<span></span>'}
        <button class="btn small" data-act="tip-ok" data-arg="${t.id}">Got it</button></div>`;
  }
  function coachText(s) {
    const hub = game.activeHub;
    const routes = game.routesAt(hub.id), planes = game.planesAt(hub.id);
    if (!routes.length) return `Click an airport near ${hub.id} on the map to open a route.`;
    if (!planes.length) return 'Routes need aircraft. Press “+ aircraft” on a route, or open Fleet and choose “Buy or lease aircraft”.';
    const empty = routes.find((r) => !game.planesOn(r.id).length);
    if (empty && planes.some((p) => p.routeId == null)) return `An aircraft is parked. Inspect it, choose “Move / assign”, then review a move to ${empty.dest}.`;
    if (empty && planes.length < 3) return `Your route to ${empty.dest} has no aircraft flying it.`;
    return '';
  }

  // ---------- cards ----------
  function head(code, title, sub, backAct = 'detail-back', fallback = 'map', tabs = '') {
    return `<header class="card-heading"><div class="card-nav">${backStack.length || backAct !== 'detail-back' ? `<button class="detail-back" data-act="${backAct}">← Back to ${esc(backLabel(fallback))}</button>` : '<span class="sub">Airport details</span>'}
      <button class="x" data-act="close-card" aria-label="Close details">×</button></div><div class="card-head"><span class="code">${code}</span>
      <div><h3>${esc(title)}</h3><div class="sub">${sub}</div></div></div>${tabs}</header>`;
  }
  function airportMarketHTML(a, expanded = false, context = 'airport') {
    const m = a.market;
    const strength = (value) => value >= 1.1 ? 'Strong' : value < .9 ? 'Limited' : 'Typical';
    return `<details class="airport-market route-section" data-section="market-${context}-${a.id}" ${expanded ? 'open' : ''}>
      <summary>${a.id} market · ${m.name}</summary><p class="note">${m.summary}</p>
      <div class="market-traits">${[['Leisure', m.leisure], ['Business', m.business], ['Freight', m.freight]].map(([label, value]) => `<div><span>${label}</span><b>${strength(value)}</b></div>`).join('')}</div>
      ${kv('Airport upkeep & handling', pct(m.operating), 'mono')}
      ${kv('Construction & new hub cost', pct(m.expansion), 'mono')}
      ${kv('Freight yield', pct(m.freight), 'mono')}
      ${kv('Connecting potential', pct(m.connections), 'mono')}
      <p class="note">${m.constrained ? 'Limited building space raises construction costs. ' : ''}Costs apply when based here, before hub-role modifiers. Construction covers runway, terminal, gates and cargo upgrades. Freight and passenger markets combine both endpoints. Connecting demand needs active feeder routes.</p>
    </details>`;
  }
  function passengerMix(f, route = null, context = 'route') {
    const rows = PASSENGER_KEYS.filter((id) => id !== 'charter' || f.segments.charter > .5);
    const regular = f.total - f.segments.charter;
    const lead = Object.keys(PASSENGERS).reduce((best, id) => f.segments[id] > f.segments[best] ? id : best, 'leisure');
    const why = lead === 'business' ? 'Business demand favors frequent service and a dependable fleet.' : lead === 'connecting' ? 'Connecting demand depends on your active network and service frequency.' : 'Leisure demand is most sensitive to fares and the season.';
    const flown = route?.yesterday?.passengers;
    const unclassified = route?.yesterday ? Math.max(0, route.yesterday.pax - passengerTotal(flown)) : 0;
    return `<div class="passenger-market item"><div class="row"><b>Passenger mix</b><span class="sub">Demand / day · both ways</span></div>
      <div class="passenger-bar" aria-hidden="true">${rows.map((id) => `<i class="segment-${id}" style="width:${f.total ? f.segments[id] / f.total * 100 : 0}%"></i>`).join('')}</div>
      <div class="passenger-rows">${rows.map((id) => `<div><span><i class="segment-dot segment-${id}" aria-hidden="true"></i>${PASSENGERS[id]?.name || 'Contract'}</span><b class="mono">${Math.round(f.segments[id] * 2).toLocaleString()}</b><span class="sub mono">${f.total ? Math.round(f.segments[id] / f.total * 100) : 0}%</span></div>`).join('')}</div>
      <p class="note">${regular > 0 ? why : 'No regular passenger demand right now.'}</p>
      <details class="passenger-details" data-section="passengers-${context}-${route?.id || 'preview'}"><summary>What these travelers value</summary>
      ${Object.entries(PASSENGERS).map(([id, type]) => `<div class="passenger-preference"><b>${type.name}</b><span>${type.preference}.</span><small>Fare ${pct(f.segmentFactors[id].fare)} · service ${pct(f.segmentFactors[id].frequency)} · confidence ${pct(f.segmentFactors[id].confidence)}${Math.abs(f.segmentFactors[id].seasonal - 1) > .02 ? ` · season ${pct(f.segmentFactors[id].seasonal)}` : ''}</small></div>`).join('')}
      <p class="note">Confidence combines company reputation and assigned aircraft condition and availability. ${route && !game.planesOn(route.id).length ? 'This preview assumes a ready aircraft. ' : ''}Business travel is a passenger type, not a cabin: business travelers can also use economy. Only business travelers buy business seats; contract demand is separate.</p>
      ${!f.segments.connecting ? '<p class="note">No connecting demand yet. Staff both legs through a hub, keep the routing practical, and provide frequent enough departures.</p>' : ''}
      ${route?.yesterday ? `<div class="section-label">Carried yesterday · both ways</div>${PASSENGER_KEYS.filter((id) => id !== 'charter' || flown?.charter > 0).map((id) => kv(PASSENGERS[id]?.name || 'Contract', Math.round(flown?.[id] || 0).toLocaleString(), 'mono')).join('')}${unclassified ? kv('Before passenger tracking', Math.round(unclassified).toLocaleString(), 'mono') : ''}` : ''}
      </details></div>`;
  }
  function passengerComparison(before, after) {
    return `<div class="item"><div class="section-label">Passenger demand / day · both ways</div>${PASSENGER_KEYS.filter((id) => id !== 'charter' || before[id] || after[id]).map((id) => kv(PASSENGERS[id]?.name || 'Contract', `${Math.round(before[id] * 2)} → ${Math.round(after[id] * 2)}`, 'mono')).join('')}</div>`;
  }
  function connectionCard(route) {
    const status=game.connectionStatus(route),pairs=status.pairs,volume=pairs.reduce((n,p)=>n+p.rate*2,0);
    const journeys=status.atRisk?status.waitingJourneys:pairs;
    const summary=status.atRisk ? `${Math.floor(status.atRisk)} at risk` : status.waiting ? `${Math.floor(status.waiting)} waiting` : `${Math.round(volume)} / day`;
    return `<details class="route-section connection-details" data-section="connections-${route.id}" ${status.atRisk?'open':''}><summary>Connecting journeys · ${summary}</summary>
      <p class="note">Travelers fly both legs through your hubs or a shared transfer airport and occupy an economy seat on each. Forecasts share available capacity across all connecting markets.</p>
      <div class="route-metrics"><div><span>Waiting for this leg</span><b>${Math.floor(status.waiting)}</b></div><div><span>Journeys completed today</span><b>${status.today.completed}</b></div><div><span>Missed today</span><b class="${status.today.missed?'bad':''}">${status.today.missed}</b></div><div><span>Compensation today</span><b>${fmtMoney(status.today.compensation)}</b></div></div>
      ${status.waiting ? `<p class="note ${status.atRisk?'amber':''}">Earliest connection expires in ${responseHours(Math.max(0,status.nextDeadline-game.state.minute))}. ${status.blocked?'Flights are blocked. Restore aircraft or airport operations to clear the queue.':status.atRisk?'Review onward capacity and service frequency before more connections expire.':'Passengers board after their transfer time has elapsed.'}</p>`:''}
      ${status.yesterday ? `<p class="note">Yesterday: ${status.yesterday.completed} journeys completed here · ${status.yesterday.missed} missed.</p>`:''}
      ${status.atRisk ? status.blocked ? liveIncidents(game).some(i=>i.routeIds.includes(route.id)) ? `<button class="btn ghost wide" data-act="response-open" data-arg="route:${route.id}">Review connection recovery</button>` : `<button class="btn ghost wide" data-act="ops-add" data-arg="${route.id}">Assign an aircraft</button>` : route.service!=='frequent' ? `<button class="btn ghost wide" data-act="service-review" data-arg="${route.id}:frequent">Review Frequent service</button>` : '<button class="btn ghost wide" data-act="route-pane" data-arg="aircraft">Review onward aircraft</button>' : ''}
      ${journeys.length?`<div class="section-label">${status.atRisk?'Waiting journeys':'Journeys using this route'}</div>${journeys.slice().sort((a,b)=>(b.waiting || b.rate)-(a.waiting || a.rate)).slice(0,5).map(p=>{
        const other=game.journeyRoute(p.firstRouteId===route.id?p.secondRouteId:p.firstRouteId),limiting=game.journeyRoute(p.bottleneck);
        return `<div class="connection-journey"><b class="mono">${p.from} → ${p.via} → ${p.to}</b><span class="sub">${p.waiting!=null?`${Math.floor(p.waiting)} waiting`:`${Math.round(p.rate*2)} travelers / day · both ways`} · ${p.transferMinutes} min transfer</span>${p.limited && limiting?`<span class="sub amber">Shared seats limited by ${limiting.hub} ⇄ ${limiting.dest}</span>`:''}${p.agreementId?`<button class="btn ghost small" data-act="partnership-open" data-arg="${p.agreementId}">${esc(p.partnerName || 'Partner')} · ${other?`${other.hub} ⇄ ${other.dest}`:'Review onward leg'}</button>`:other?`<button class="btn ghost small" data-act="ops-route" data-arg="${other.id}">View other leg · ${other.hub} ⇄ ${other.dest}</button>`:'<span class="sub">The other route has closed.</span>'}</div>`;
      }).join('')}${journeys.length>5?`<p class="note">Plus ${journeys.length-5} other connecting markets.</p>`:''}`:'<p class="note">No viable connecting journeys right now. Both legs need available aircraft, practical routing and frequent enough departures.</p>'}
      <p class="note">Passengers wait up to 12 hours after arrival. The onward operator pays missed-connection compensation of 25% of the first-leg fare ($25–$120 per traveler). Each flown leg earns its own fare; a journey is completed only after the second landing. Arriving travelers board ahead of new economy bookings. Aircraft carrying them finish the flight before assignment changes.</p>
    </details>`;
  }
  function demandNotes(f) {
    const parts = [];
    if (Math.abs(f.season - 1) > 0.02) parts.push(`leisure ${term('season', 'season')} ${pct(f.season)}`);
    if (f.event !== 1) parts.push(`events ${pct(f.event)}`);
    if (f.share < 1) parts.push(`${term('rivals', 'competition')} ${pct(f.share)}`);
    if (f.segments.connecting > .5) parts.push(`${Math.round(f.segments.connecting * 2)} connecting travelers / day, both ways`);
    if (f.trunk > 1.005) parts.push(`${term('hub link', 'hubLink')} ${pct(f.trunk)}`);
    if (Math.abs(f.rep - 1) > 0.005) parts.push('reputation affects each passenger group differently');
    if (f.specialization && f.specialization !== 1) parts.push(`hub role ${pct(f.specialization)} regular demand`);
    if (f.charter > 0.5) parts.push(`contract +${Math.round(f.charter)} a day`);
    if (f.world > 1.001) parts.push(`${term('world coverage', 'coverage')} ${pct(f.world)}`);
    return parts.length ? `<div class="note">${parts.join(' · ')}</div>` : '';
  }
  const rivalLine = (f) => (f.rivals.length
    ? kv(term('Competition', 'competition'), f.rivals.map((r) => `<span class="dot" style="background:${r.color}"></span>${r.name}${r.base ? ` (base${r.price < 1 ? `, ${Math.round(r.price * 100)}%` : ''})` : ` ${Math.round(r.price * 100)}%`}${r.war != null ? ` <span class="bad">price war, ${plural(Math.max(1, r.war - game.state.day), 'day')} left</span>` : ''}`).join('<br>'))
    : '');
  function eventLines(airportId, hubId = null) {
    const s = game.state;
    return game.contractsFor(airportId, hubId).map(contractItem).join('') + s.events.filter((e) => e.airport === airportId && e.start + e.days > s.day).map(eventItem).join('');
  }

  // Routes to this airport flown from hubs other than the active one.
  function otherRoutes(airportId) {
    const s = game.state;
    const list = s.routes.filter((r) => r.hub !== s.active && r.dest === airportId);
    if (!list.length) return '';
    return `<div class="note" style="margin-top:10px">Also served from another hub:</div><div class="btn-row">${list
      .map((r) => `<button class="btn ghost small" data-act="select-route" data-arg="${r.id}">View ${r.hub} ⇄ ${r.dest}</button>`).join('')}</div>`;
  }

  function planeCard(p) {
    const s = game.state;
    const t = AIRCRAFT[p.type];
    const r = game.route(p.routeId);
    const status = {
      idle: 'Parked, no route', home: `At the gate in ${p.hub}`, turn: r ? `Turning around in ${r.dest}` : '',
      out: r ? `Flying to ${r.dest}` : '', back: `Flying home to ${p.hub}`, repair: 'In the hangar for repairs', conversion: `Converting to ${AIRCRAFT[p.conversion?.type]?.name || 'freighter'}`,
    }[p.phase];
    const flying = p.phase === 'out' || p.phase === 'back';
    const left = flying ? Math.max(0, p.dur - p.t) : 0;
    const flightProgress = flying && p.dur > 0 ? Math.max(0, Math.min(100, p.t / p.dur * 100)) : 0;
    return `${head(p.hub, p.name, `${t.name} · ${planeRegistration(p)} · based at ${p.hub}`, 'aircraft-back', aircraftBack === 'ops' ? 'Operations' : aircraftBack === 'log' ? 'News' : aircraftBack === 'routes' ? 'routes' : 'fleet')}<div id="card-body" data-scroll>
      <button class="btn ghost small wide" data-act="aircraft-name" data-arg="${p.id}">Rename aircraft</button>
      ${kv('Status', status)}
      ${p.conversion ? `<div class="item">${kv('Ready in', responseHours(p.conversion.until-s.minute),'mono')}<p class="note">The aircraft keeps its age, name and route. ${p.routeId!=null?'Flights resume as freight service once conversion finishes.':'Assign it to a route after conversion finishes.'}</p></div>` : ''}
      ${t.freighter ? kv('Usable hold',freightHold(t,game.hub(p.hub)).toFixed(1)+' t','mono') : ''}
      ${p.phase === 'repair' && r ? `<div class="recovery-inline"><div class="sub">About ${responseHours(720-p.t)} of repairs remaining.</div><button class="btn ghost wide" data-act="response-open" data-arg="route:${r.id}">Review repair response</button></div>` : ''}
      ${p.recoveryAssignment ? `<div class="item recovery-inline"><b>Temporary assignment</b><p class="note">${esc(p.recoveryAssignment.pending || `Planned return to ${p.recoveryAssignment.originalHub}${game.route(p.recoveryAssignment.originalRoute) ? ' ⇄ '+game.route(p.recoveryAssignment.originalRoute).dest : ' parking'}`)}</p><button class="btn ghost wide" data-act="response-open" data-arg="return:${p.id}">Review temporary assignment</button></div>` : ''}
      ${kv('Assignment', r ? `${r.hub} ⇄ ${r.dest}` : `Parked at ${p.hub}`, 'mono')}
      <div class="plane-flight-details">
        <div class="meter" ${flying ? `role="progressbar" aria-label="Flight progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(flightProgress)}"` : 'aria-hidden="true"'}><i style="width:${flightProgress}%"></i></div>
        <div class="kv plane-flight-load"><span>On board</span><span>${flying ? t.freighter ? `${(p.freightManifest || []).reduce((n,q)=>n+q.tonnes,0).toFixed(1)} t freight` : `${p.pax + p.biz} passengers${p.biz ? ` (${p.biz} business)` : ''}` : '—'}</span></div>
        ${kv('Lands in', flying ? `${Math.floor(left / 60)}h ${String(Math.floor(left % 60)).padStart(2, '0')}m` : '—', 'mono')}
      </div>
      ${kv(term('Age', 'age'), `${plural(Math.floor(p.age), 'day')}`)}
      ${kv(term('Breakdown risk', 'risk'), `${(game.breakdownRisk(p) * 100).toFixed(1)}% per flight`, game.breakdownRisk(p) > 0.03 ? 'bad' : '')}
      ${kv(term('Upkeep', 'planeUpkeep'), `${fmtMoney(game.planeUpkeep(p))} / day`, 'mono')}
      ${p.lease ? `<div class="item">${kv('Leased · rent / day', fmtMoney(p.lease.daily), 'mono')}${kv('Lease ends', `${fmtDate(Math.floor(p.lease.end / 1440))} · ${leaseDaysLeft(s, p)} days left`)}<div class="note">Returns automatically at expiry after any current flight lands. Returning early settles all remaining rent.</div></div>` : ''}
      ${p.yday != null ? kv(term('Yesterday', 'planeYesterday'), `${fmtSigned(p.yday)} after upkeep`, `mono ${signCls(p.yday)}`) : ''}
      ${kv(term('Lifetime', 'lifetime'), `${fmtSigned(p.profit)} over ${plural(p.flights, 'flight')}`, 'mono')}
      <div class="card-actions">
        ${!p.lease && !p.conversion && AIRCRAFT_LIST.some(t=>t.convertFrom===p.type) ? `<button class="btn ghost wide" data-act="cargo-convert" data-arg="${p.id}">Review freighter conversion</button>` : ''}
        <div class="btn-row plane-primary-actions"><button class="btn" data-act="aircraft-picker" data-arg="move:${p.id}" ${p.conversion?'disabled':''}>Move / assign</button><button class="btn ghost" data-act="aircraft-picker" data-arg="swap:${p.id}" ${p.conversion?'disabled':''}>Swap</button></div>
        ${p.lease ? `<button class="btn ghost wide" data-act="lease-action" data-arg="extend:${p.id}" ${p.lease.returning ? 'disabled' : ''}>Extend lease</button>` : `<button class="btn ghost wide" data-act="aircraft-picker" data-arg="replace:${p.id}" ${p.conversion?'disabled':''}>Replace aircraft</button>`}
        <button class="btn ghost wide" data-act="overhaul" data-arg="${p.id}" ${p.conversion || s.money < game.overhaulCost(p) || p.age < 20 ? 'disabled' : ''} ${tipAttr('overhaul')}>Maintain · ${fmtMoney(game.overhaulCost(p))}</button>
        <div class="why">An overhaul takes 60% off the aircraft’s age.</div>
        ${r ? `<button class="btn ghost wide" data-act="aircraft-park" data-arg="${p.id}" ${p.conversion?'disabled':''}>Park aircraft</button>` : ''}
        ${p.lease ? `<button class="btn danger wide" data-act="lease-action" data-arg="return:${p.id}">Review return</button>` : `<button class="btn danger wide" data-act="sell" data-arg="${p.id}" ${p.conversion?'disabled':''}>Sell · ${fmtMoney(game.planeValue(p))}</button>`}
        <div class="note">Every change opens a preview before it is applied.</div></div>${recentResult('plane', p.id)}</div>
      <footer class="route-mobile-actions"><button class="btn" data-act="aircraft-picker" data-arg="move:${p.id}" ${p.conversion?'disabled':''}>Move / assign</button><button class="btn ghost" data-act="aircraft-picker" data-arg="swap:${p.id}" ${p.conversion?'disabled':''}>Swap</button></footer>`;
  }

  function freightCard(r, controls=false) {
    const planes=game.freightPlanes(r), status=game.freightStatus(r), policy=freightService(r), hub=game.hub(r.hub);
    if(!planes.length && !status.waiting && !controls)return '';
    const stats=status.yesterday, forecast=game.freightServiceQuote(r.id,r.cargoService || 'bulk');
    return `<section class="item freight-card" aria-label="Freight service">
      <div class="row"><b>${policy.name} freight</b><span class="tag">${plural(planes.length,'freighter')}</span></div>
      ${controls ? `<div class="seg service-options">${Object.entries(FREIGHT_SERVICES).map(([id,v])=>`<button data-act="cargo-service" data-arg="${r.id}:${id}" class="${(r.cargoService || 'bulk')===id?'on':''}" aria-pressed="${(r.cargoService || 'bulk')===id}">${v.name}</button>`).join('')}</div><p class="note">${policy.description} Select a service to compare income and review booking changes.</p>` : ''}
      ${kv('Waiting for departure',status.waiting.toFixed(1)+' t','mono')}
      ${status.deadline!=null ? kv('Earliest delivery due',`in ${responseHours(status.deadline-game.state.minute)}`,'mono') : ''}
      ${status.atRisk>.01 ? `<p class="why bad">${status.atRisk.toFixed(1)} t at risk. ${status.blocked?'Flights are unavailable. Review closures, repairs or aircraft assignments.':'Delivery is due within 6 hours. Check aircraft capacity and arrival times.'}</p>` : ''}
      ${stats ? kv('Delivered yesterday',`${stats.delivered.toFixed(1)} t${stats.late ? ' · '+stats.late.toFixed(1)+' t late' : ''}`,'mono')+kv('Freighter revenue',fmtMoney(stats.revenue),'mono')+(stats.penalties?kv('Booking claims',fmtMoney(stats.penalties),'mono bad'):'') : '<p class="note">Delivery results appear after the first day closes.</p>'}
      ${controls ? kv('Estimated freight profit / day',fmtSigned(forecast.after),`mono ${signCls(forecast.after)}`)+`<p class="note">Includes freighter upkeep and rent, before airport overhead. Late deliveries earn 25% of their booked rate. Expired or canceled waiting bookings cost 10% compensation. Cargo contracts credit on-time outward tonnes; each tonne counts once.</p>` : `<button class="btn ghost wide" data-act="cargo-pane">Review freight service</button>`}
      ${!planes.length ? `<p class="note">${hub.levels.cargo?'Assign a freighter to start accepting bookings.':'Build a cargo terminal at the home hub first.'}</p>` : ''}
    </section>`;
  }

  function cargoModal() {
    const review=cargoReview;if(!review)return;
    let q,title,content,confirm;
    if(review.action==='service') {
      q=game.freightServiceQuote(review.id,review.kind);if(!q.route){closeModal();return;}
      title=`${q.route.hub} ⇄ ${q.route.dest} · ${FREIGHT_SERVICES[review.kind].name} freight`;
      content=`<p>${FREIGHT_SERVICES[review.kind].description}</p><div class="item">
        ${kv('Freight profit / day',`${fmtSigned(q.before)} → ${fmtSigned(q.after)}`,'mono')}
        ${kv('Demand / day · both ways',q.demand.toFixed(1)+' t','mono')}
        ${kv('Estimated delivered / day',q.delivered.toFixed(1)+' t','mono')}
        ${kv('Estimated on time',q.delivered ? Math.round(q.onTime/q.delivered*100)+'%' : '—','mono')}
        ${q.expired>.01 ? kv('Bookings likely to expire / day',q.expired.toFixed(1)+' t','mono amber') : ''}
        ${kv('Waiting bookings canceled',q.cancelled.toFixed(1)+' t','mono')}
        ${kv('Compensation now',fmtMoney(q.cost),'mono amber')}
        ${kv('Cash remaining',fmtMoney(game.state.money-q.cost),'mono')}</div>
        <p class="note">Changing service cancels waiting bookings and pays 10% of their booked value. Freight already airborne keeps its original rate and deadline. Passenger service stays as configured. Forecasts include freighter upkeep, rent and estimated deadline penalties; demand, breakdowns and late deliveries affect actual results.</p>`;
      confirm='Apply freight service';
    } else if(review.action==='convert') {
      q=game.conversionQuote(review.id);if(!q.plane){closeModal();return;}
      title=`${q.plane.name} · convert to ${q.type.name}`;
      content=`<p>Replace the passenger cabin with a dedicated freight hold. The aircraft keeps its name, age and route.</p><div class="item">
        ${kv('Conversion cost',fmtMoney(q.cost),'mono amber')}${kv('Out of service','2 days')}
        ${kv('Upkeep during conversion',fmtMoney(game.planeUpkeep(q.plane)*2),'mono')}
        ${kv('Usable freight hold',freightHold(q.type,game.hub(q.plane.hub)).toFixed(1)+' t','mono')}
        ${kv('Age retained',`${Math.floor(q.plane.age)} days`,'mono')}
        ${q.after!=null ? kv('Aircraft profit / day after conversion',fmtSigned(q.after),`mono ${signCls(q.after)}`) : ''}
        ${kv('Cash after conversion fee',fmtMoney(q.remaining),'mono')}</div>
        <p class="why amber">This aircraft will no longer carry passengers or connecting travelers. Check passenger contracts and connections on its route before converting. It cannot move, fly or be sold until conversion finishes.</p><p class="note">The conversion cannot be reversed. You can trade the finished freighter for a passenger aircraft later. Normal upkeep continues during conversion; it is separate from the fee above. The profit estimate is for this aircraft after conversion, before airport overhead.</p>`;
      confirm='Start conversion';
    } else {
      const r=game.route(review.id);if(!r){closeModal();return;}
      const queues=Object.values(r.freightPools || {}).flat(), cost=queues.reduce((n,q)=>n+q.tonnes*q.price*.1,0);
      q={why:game.planesOn(r.id).map(p=>game.connectionFlightWhy(p)).find(Boolean)};
      title=`Close ${r.hub} ⇄ ${r.dest}`;confirm='Close route';
      content=`<p>Aircraft will park at their home hub and keep costing upkeep. The route opening fee is not refunded.</p><div class="item">${kv('Waiting freight canceled',queues.reduce((n,q)=>n+q.tonnes,0).toFixed(1)+' t','mono')}${kv('Freight compensation now',fmtMoney(cost),'mono amber')}${kv('Cash after closing',fmtMoney(game.state.money-cost),'mono')}</div><p class="note">Review signed contracts and connecting journeys that rely on this route before closing it.</p>`;
    }
    showModal(`<div class="row"><div class="eyebrow">Review before applying</div><button class="x" data-act="close-modal" aria-label="Cancel freight change">×</button></div><h2>${title}</h2>${content}${q.why?`<p class="why bad" role="alert">${esc(q.why)}</p>`:''}<div class="btn-row"><button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn" data-act="cargo-apply" ${q.why?'disabled':''}>${confirm}</button></div>`);
  }

  function routeCard(a, route, tier) {
    const s = game.state;
    const f = game.routeFactors(route);
    const planes = game.planesOn(route.id);
    const y = route.yesterday;
    const profit = game.routeProfit(route);
    const cargoOnly = game.cargoOnly(route), freight = game.freightStatus(route);
    const load = cargoOnly ? y?.freight?.capacity ? Math.round(y.freight.delivered/y.freight.capacity*100) : null : y?.seats ? Math.round(y.pax/y.seats*100) : null;
    const metric = (label, value, cls = '') => `<div><span>${label}</span><b class="${cls}">${value}</b></div>`;
    const shut = game.closed(route.dest) || game.closed(route.hub);
    const other = a.id === route.dest ? route.hub : route.dest;
    const diag = planes.length ? game.diagnose(route) : [];
    const baseOf = game.rivalAt(route.dest);
    const fixes = addFor === route.id ? [] : game.suggest(route);
    // A destination you already fly to can still become a hub; the route then turns into a hub link.
    const whyHub = game.isHub(route.dest) || game.rivalAt(route.dest) ? null : game.whyNotHub(route.dest);
    const hubHere = game.isHub(route.dest) || game.rivalAt(route.dest) ? '' : `<button class="btn ghost wide" data-act="buy-hub" data-arg="${route.dest}" ${whyHub ? 'disabled' : ''}>Open a hub here · ${fmtMoney(game.hubCost(AIRPORT_BY_ID[route.dest]))}</button>
        ${whyHub ? `<div class="why">${whyHub}</div>` : '<div class="why">This route stays and becomes a link between your two hubs.</div>'}`;
    const sectionTabs = `<nav class="route-tabs" aria-label="Route sections">${[['overview', 'Overview'], ['aircraft', `Aircraft · ${planes.length}`], ['fare', cargoOnly ? 'Freight service' : game.freightPlanes(route).length ? 'Service' : 'Fare & cabin']].map(([id, label]) => `<button data-act="route-pane" data-arg="${id}" aria-pressed="${routePane === id}" class="${routePane === id ? 'on' : ''}">${label}</button>`).join('')}</nav>`;
    return `${head(a.id, `${route.hub} ⇄ ${a.city}`, `${tier} · ${km(route.km)} from ${other}`, 'back-routes', routeBack === 'log' ? 'News' : routeBack ? 'Operations' : 'routes', sectionTabs)}
      <div id="card-body" data-scroll><div class="route-pane" data-pane="overview">
      ${shut ? `<div class="why bad" style="margin:0 0 6px">Closed today: ${esc(describe(shut).title)}. Flights are holding.</div>` : ''}
      ${[route.hub,route.dest].filter(id=>constructionDelay(game.hub(id))).map(id=>`<div class="why amber">Construction at ${id}: ${Math.round(constructionDelay(game.hub(id))*100)}% longer turnarounds.<button class="btn ghost wide" data-act="projects-open" data-arg="${id}">Review airport project</button></div>`).join('')}
      ${liveIncidents(game).some((i)=>i.routeIds.includes(route.id)) ? `<button class="btn ghost wide recovery-inline" data-act="response-open" data-arg="route:${route.id}">Review disruption responses</button>` : ''}
      <div class="route-metrics">
        ${metric('Profit yesterday', profit == null ? '—' : fmtSigned(profit), profit == null ? '' : signCls(profit))}
        ${metric(cargoOnly ? 'Hold filled yesterday' : 'Seats filled yesterday', load == null ? '—' : `${load}%`)}
        ${metric('Demand / day · both ways', cargoOnly ? (game.cargoMarket(route)[route.cargoService || 'bulk']*2).toFixed(1)+' t' : Math.round(f.total * 2).toLocaleString())}
        ${metric(cargoOnly ? 'Hold capacity / day' : 'Seats / day · both ways', cargoOnly ? game.freightCapacity(route).toFixed(1)+' t' : Math.round(game.seatsPerDay(route)).toLocaleString())}
      </div>
      ${!y ? '<div class="note">Actual results appear after the first day closes.</div>' : ''}
      <button class="btn ghost wide passenger-overview-link" data-act="route-pane" data-arg="fare">${cargoOnly ? 'Bulk & express service' : 'Passenger mix & service'} →</button>
      <div class="route-status ${!planes.length || shut ? 'bad' : ''}">${!planes.length ? 'No aircraft assigned · this route is not flying' : shut ? `${plural(planes.length, 'aircraft')} assigned · flights on hold` : `${plural(planes.length, 'aircraft')} assigned${planes.some((p) => p.phase === 'repair') ? ' · repairs in progress' : planes.some(p=>p.conversion) ? ' · conversion in progress' : ' · ready to fly'}`}</div>
      ${cargoOnly ? '' : connectionCard(route)}
      ${freightCard(route)}
      </div><div class="route-pane" data-pane="aircraft">
      <div class="section-label">Aircraft and assignment</div>
      <div class="ops-planes route-plane-list" data-drop-route="${route.id}">${planes.map((p) => `<div class="route-aircraft-row">${planeChip(p)}<span class="sub">${p.conversion ? 'In conversion' : p.phase === 'repair' ? 'In repair' : ['out', 'back'].includes(p.phase) ? 'Flying' : 'On the ground'}${p.yday != null ? ` · ${fmtSigned(p.yday)} yesterday` : ''}</span></div>`).join('') || '<div class="empty">No aircraft assigned yet.<br>Choose a parked aircraft or buy one for this route.</div>'}${moveBtn(route)}</div>
      ${planes.length ? '<p class="note">Tap an aircraft to inspect it, move it, or review a swap.</p>' : ''}
      <button class="btn ${planes.length ? 'ghost' : ''} wide route-aircraft-add" data-act="ops-add" data-arg="${route.id}">${addFor === route.id ? 'Hide aircraft choices' : planes.length ? 'Add aircraft' : 'Assign aircraft'}</button>
      ${addFor === route.id ? addPanelHTML(route) : ''}
      </div><div class="route-pane" data-pane="overview">
      ${fitOf(route).issues.filter((i) => ['spare', 'demand', 'freight'].includes(i.id)).map((i) => `<div class="route-advice ${i.tone}"><b>${i.label}</b><p>${esc(i.text)}</p></div>`).join('')}
      ${diag.length ? `<div class="diag box"><b>Why it is losing money</b>${diag.map((d) => `<div>${esc(d)}</div>`).join('')}</div>` : ''}
      ${fixes.length ? `<div class="fixes"><div class="sub">Suggested, with the estimated gain per day:</div>${fixes.map((f) => `<button class="btn ghost small wide fix" data-act="${f.kind === 'add' ? 'ops-add' : 'suggest'}" data-arg="${f.kind === 'add' ? f.arg : `${f.kind}:${f.arg}`}"><span>${esc(f.text)}</span><span class="mono good">${fmtSigned(f.gain)}</span></button>`).join('')}</div>` : ''}
      </div><div class="route-pane" data-pane="fare">
      ${game.hub(route.hub).specialization && game.hub(route.hub).specialization !== 'general' ? `<div class="item"><div class="row"><b>${specializationOf(game.hub(route.hub)).name} hub</b><button class="btn ghost small" data-act="specialization-review" data-arg="${route.hub}:${game.hub(route.hub).specialization}">View hub role</button></div><p class="note">${game.hub(route.hub).specialization === 'budget' ? 'All-economy cabins at 90% fare or less get the demand bonus. Other routes attract 15% less regular demand.' : game.hub(route.hub).specialization === 'premium' ? 'Mixed or Premium cabins with Balanced or Frequent service get the demand bonus. Other routes attract 12% less regular demand.' : game.hub(route.hub).specialization === 'transfer' ? 'The transfer hub attracts more connecting journeys and cuts transfer time by 20 minutes. Both legs still share finite seats. The hub keeps its 5% regular-demand penalty and extra upkeep.' : 'Freight loading and rates are higher; regular passenger demand is 10% lower.'}</p></div>` : ''}
      ${cargoOnly ? freightCard(route,true) : `
      <div class="section-label">Service frequency</div>
      <div class="seg service-options">${Object.entries(SERVICES).map(([id, policy]) => `<button class="${(route.service || 'balanced') === id ? 'on' : ''}" aria-pressed="${(route.service || 'balanced') === id}" data-act="service-review" data-arg="${route.id}:${id}">${policy.name}</button>`).join('')}</div>
      <p class="note">${serviceOf(route).description} Select a policy to preview its effect on demand, departures and profit.</p>
      <div class="section-label">Fare and cabin</div>
      <div class="kv fare-control"><span>${term('Ticket price', 'fare')}</span>
        <span class="stepper"><button data-act="price" data-arg="${route.id}:-0.1" aria-label="Lower price" ${route.price <= .6 ? 'disabled' : ''}>−</button>
        <span class="mono">${fmtMoney(game.ticket(route))} <span class="sub">(${Math.round(route.price * 100)}%)</span></span>
        <button data-act="price" data-arg="${route.id}:0.1" aria-label="Raise price" ${route.price >= 1.6 ? 'disabled' : ''}>+</button></span></div>
      <div class="kv cabin-control"><span>${term('Cabin', 'cabin')}</span><span class="seg">${CABINS.map((c, i) => `<button class="${route.cabin === i ? 'on' : ''}" aria-pressed="${route.cabin === i}" data-act="cabin" data-arg="${route.id}:${i}">${c.name}</button>`).join('')}</span></div>
      <div class="route-metrics route-fare-summary">${metric('Demand / day · both ways', cargoOnly ? (game.cargoMarket(route)[route.cargoService || 'bulk']*2).toFixed(1)+' t' : Math.round(f.total * 2).toLocaleString())}${metric(cargoOnly ? 'Hold capacity / day' : 'Seats / day · both ways', cargoOnly ? game.freightCapacity(route).toFixed(1)+' t' : Math.round(game.seatsPerDay(route)).toLocaleString())}</div>
      <p class="note">Fare and cabin changes apply immediately. Lower fares can attract more passengers; business seats take double the room and pay ${game.businessMultiplier(game.hub(route.hub)).toFixed(1)}× the economy fare.</p>
      ${passengerMix(f, route)}
      ${game.freightPlanes(route).length ? freightCard(route,true) : ''}`}
      ${recentResult('route', route.id)}
      </div><div class="route-pane" data-pane="overview">
      ${cargoOnly ? '' : `<details class="route-section" data-section="demand-${route.id}"><summary>Demand and competition</summary>
      ${kv(term('Demand each way', 'demand'), `${Math.round(f.total)} / day`, 'mono')}
      ${demandNotes(f)}
      ${kv(term('Waiting now', 'waiting'), `${Math.floor(route.poolOut / 10) * 10}+ out · ${Math.floor(route.poolIn / 10) * 10}+ back`, 'mono')}
      <div class="note">${Math.round(f.segments.business * 2)} business travelers / day, both ways. Around ${Math.round(f.businessPreference * 100)}% will consider a business seat. Unsold business capacity cannot take economy passengers.</div>
      ${rivalLine(f)}
      </details>`}
      ${airportMarketHTML(AIRPORT_BY_ID[route.dest], false, 'route')}
      ${eventLines(route.dest, route.hub)}
      <details class="route-section" data-section="manage-${route.id}"><summary>Expansion and route management</summary><div class="card-actions">
        ${baseOf ? `<div class="item" style="margin:0 0 4px"><div class="name"><span class="dot" style="background:${baseOf.color}"></span>Hub of ${baseOf.name}</div>${strengthHTML(baseOf)}</div>` : ''}
        ${hubHere}
        <button class="btn danger wide" data-act="close-route" data-arg="${route.id}">Close route</button>
      </div>${otherRoutes(a.id)}</details></div></div>
      <footer class="route-mobile-actions">${routePane === 'aircraft' || (routePane === 'overview' && !planes.length) ? `<button class="btn wide" data-act="ops-add" data-arg="${route.id}">${addFor === route.id ? 'Hide aircraft choices' : planes.length ? 'Add aircraft' : 'Assign aircraft'}</button>` : `<button class="btn wide" data-act="route-pane" data-arg="${routePane === 'fare' ? 'overview' : 'aircraft'}">${routePane === 'fare' ? 'Back to overview' : 'Manage aircraft'}</button>`}</footer>`;
  }

  function cardHTML() {
    const s = game.state;
    if (!sel) return '';
    if (sel.kind === 'plane') {
      const p = s && game.plane(sel.id);
      return p ? planeCard(p) : '';
    }
    if (sel.kind === 'route') { // one specific route, whichever hub flies it
      const r = s && game.route(sel.id);
      if (!r) return '';
      const d = AIRPORT_BY_ID[r.dest];
      return routeCard(d, r, `${TIER_NAMES[d.size]}${d.leisure ? ' holiday' : ''} destination · ${d.country}`);
    }
    const a = AIRPORT_BY_ID[sel.id];
    if (!a) return '';
    const tier = `${TIER_NAMES[a.size]}${a.leisure ? ' holiday' : ''} destination · ${a.country}`;

    if (!s) {
      if (!pendingMode) return '';
      const reach = game.starterReach(a);
      return `${head(a.id, a.city, tier)}
        ${airportMarketHTML(a, true, 'start')}
        ${kv(term('Airports within starter range', 'starter'), reach, 'mono')}
        <div class="sub" style="margin-top:6px">${reach ? 'Your first aircraft can fly 1,500 km. More neighbours means an easier start.' : 'Nothing is within 1,500 km of here, so a starter aircraft would have nowhere to go.'}</div>
        <div class="card-actions"><button class="btn wide" data-act="found" data-arg="${a.id}" ${reach ? '' : 'disabled'}>Start here</button></div>`;
    }

    const hub = game.activeHub;
    if (game.isHub(a.id)) { // selecting one of your hubs makes it the active one
      const h = game.hub(a.id);
      return `${head(a.id, a.city, `Your ${rankFor(h.levels).name.toLowerCase()}`)}
        ${kv(term('Routes', 'routesUsed'), `${game.routesAt(a.id).length} / ${game.routeCap(h)}`, 'mono')}
        ${kv(term('Aircraft', 'gatesUsed'), `${game.planesAt(a.id).length} / ${game.planeCap(h)}`, 'mono')}
        ${kv(term('Longest reach', 'reach'), km(game.maxRange(h)), 'mono')}
        ${specializationCard(h)}
        ${projectSummary(h)}
        ${airportMarketHTML(a)}
        ${game.closed(a.id) ? `<div class="why bad">Closed today: ${esc(describe(game.closed(a.id)).title)}</div>` : ''}
        ${eventLines(a.id)}
        <div class="card-actions">
        ${s.hubs.filter((o) => o.id !== a.id).map((o) => {
          const link = game.routeTo(a.id, o.id) || game.routeTo(o.id, a.id);
          if (link) return `<button class="btn ghost wide" data-act="select-route" data-arg="${link.id}">View hub link ${link.hub} ⇄ ${link.dest}</button>`;
          const whyLink = game.whyNotOpen(o.id);
          return `<button class="btn wide" data-act="open-route" data-arg="${o.id}" ${whyLink ? 'disabled' : ''}>Plan link to ${o.id}</button>${whyLink ? `<div class="why">${whyLink}</div>` : ''}`;
        }).join('')}</div>`;
    }

    // Only the active hub's own route counts here. A route another hub flies to this airport
    // must not hide the option to open one from this hub; it is offered as a link instead.
    const route = game.routeTo(hub.id, a.id);
    if (route) return routeCard(a, route, tier);

    const f = game.factors(hub.id, a.id, 1);
    const why = game.whyNotOpen(a.id);
    const whyHub = game.whyNotHub(a.id);
    const rival = game.rivalAt(a.id);
    const flyable = AIRCRAFT_LIST.find((t) => t.range >= f.km);
    const est = game.estimate(hub.id, a.id).best;
    return `${head(a.id, a.city, tier)}
      ${rival ? `<div class="item" style="margin:0 0 8px"><div class="name"><span class="dot" style="background:${rival.color}"></span>Hub of ${rival.name}</div>${strengthHTML(rival)}</div>` : ''}
      ${kv(`Distance from ${hub.id}`, km(f.km), 'mono')}
      ${kv(term('Demand each way', 'demand'), `${Math.round(f.total)} / day`, 'mono')}
      ${demandNotes(f)}
      ${passengerMix(f, null, a.id)}
      ${airportMarketHTML(a)}
      ${kv('Ticket price', fmtMoney(game.baseTicket(f.km)), 'mono')}
      ${rivalLine(f)}
      ${kv(term('Smallest aircraft that reaches', 'smallest'), flyable ? flyable.name : 'None')}
      ${est ? kv(term('Estimated profit', 'estimate'), `<span class="${signCls(est.profit)}">${fmtSigned(est.profit)} / day</span> <span class="sub">${est.type.name}, ${Math.round(est.load * 100)}% full</span>`, 'mono') : ''}
      ${eventLines(a.id)}
      <div class="card-actions">
        <button class="btn wide" data-act="open-route" data-arg="${a.id}" ${why ? 'disabled' : ''}>Plan route from ${hub.id}</button>
        <div class="note">Route fee ${fmtMoney(game.openCost(f.km))} + aircraft. Review the full cost before launching.</div>
        ${why ? `<div class="why">${why}</div>` : ''}
        ${rival ? '' : `<button class="btn ghost wide" data-act="buy-hub" data-arg="${a.id}" ${whyHub ? 'disabled' : ''}>Open a hub here · ${fmtMoney(game.hubCost(a))}</button>
        ${whyHub ? `<div class="why">${whyHub}</div>` : ''}`}
      </div>${otherRoutes(a.id)}`;
  }

  // ---------- hub switcher (dropdown under the airport name) ----------
  function hubMenuHTML(s) {
    const totals = { profit: 0 };
    const rows = s.hubs.map((h) => {
      const a = AIRPORT_BY_ID[h.id];
      const routes = game.routesAt(h.id), planes = game.planesAt(h.id);
      const flown = routes.filter((r) => r.yesterday);
      const profit = flown.reduce((n, r) => n + r.yesterday.rev - r.yesterday.cost, 0);
      const pax = flown.reduce((n, r) => n + r.yesterday.pax, 0);
      totals.profit += profit;
      const idle = planes.filter((p) => p.routeId == null).length;
      const shut = game.closed(h.id);
      return `<div class="hub-row ${h.id === s.active ? 'on' : ''}">
        <button class="hub-pick" data-act="hub" data-arg="${h.id}" aria-label="Switch to ${esc(a.city)}">
          <span class="code">${h.id}</span>
          <span style="min-width:0">
            <span class="row"><span class="name">${esc(a.city)}</span><span class="mono ${flown.length ? signCls(profit) : ''}">${flown.length ? fmtSigned(profit) : '—'}</span></span>
            <span class="hub-stats"><span>${rankFor(h.levels).name} · ${specializationOf(h).name}</span>
              <span>${routes.length}/${game.routeCap(h)} routes</span><span>${planes.length}/${game.planeCap(h)} aircraft</span>
              ${flown.length ? `<span>${pax.toLocaleString()} pax</span>` : ''}
              ${idle ? `<span class="bad">${idle} idle</span>` : ''}${shut ? '<span class="bad">closed today</span>' : ''}</span>
          </span>
        </button>
        <button class="btn ghost small" data-act="view" data-arg="${h.id}">View</button>
      </div>`;
    }).join('');
    return `<div class="hub-menu-head"><span>Your hubs · ${s.hubs.length}</span><span>routes’ profit yesterday</span></div>${rows}
      <div class="note" style="padding:6px 8px 2px">${s.hubs.length > 1
        ? `All hubs together: ${fmtSigned(totals.profit)} before upkeep, maintenance and interest.`
        : 'You have one hub. Click another airport on the map to open a second once this one is a Regional Airport.'}</div>`;
  }

  // ---------- start screen ----------
  function introHTML() {
    if (pendingMode) {
      const sc = SCENARIOS.find((x) => x.id === pendingMode);
      return `<div class="eyebrow">${sc.name}</div><h1>Pick an airport to call home.</h1>
        <p>${sc.desc} Click any airport on the map.</p><p style="margin-top:-8px">Difficulty: ${DIFFICULTY[diff].name}.</p>
        <div class="btn-row"><button class="btn ghost small" data-act="mode-back">Back</button><button class="btn ghost small" data-act="guide-library">Tutorials</button></div>`;
    }
    const medals = game.medals();
    const today = new Date().toISOString().slice(0, 10);
    const list = SCENARIOS.map((sc) => {
      let desc = sc.desc.replace('$1M', fmtMoney(1e6 * DIFFICULTY[diff].cash)), medal = medals.won.includes(sc.id) ? 'Completed' : '';
      if (sc.id === 'daily') {
        const home = game.dailyHome();
        desc = `Today everyone starts in ${home.city} with the same events. Highest net worth after 30 days.`;
        if (medals.daily[today]) medal = `Best ${fmtMoney(medals.daily[today])}`;
      }
      return `<button class="item clickable scenario" data-act="mode" data-arg="${sc.id}">
        <div class="row"><span class="name">${sc.name}</span><span class="medal">${medal}</span></div>
        <div class="sub">${desc}</div></button>`;
    }).join('');
    return `<div class="eyebrow">Airport Manager</div><h1>Build an airport the world flies through.</h1>
      <button class="item clickable intro-tutorial" data-act="guide-library"><span class="intro-tutorial-icon" aria-hidden="true">${icon('learn')}</span><span><strong>Tutorials</strong><span class="sub">New here? Start with a guided first flight, or explore the other lessons.</span></span><span class="intro-tutorial-arrow" aria-hidden="true">›</span></button>
      <button class="btn ghost wide" data-act="pwa-open">${pwa.getState().installed ? 'App & offline play' : 'Install on your phone'}${pwa.getState().updateReady ? ' · Update available' : ''}</button>
      <div class="section-label" style="margin-top:12px">Difficulty</div>
      <div class="seg wide">${Object.entries(DIFFICULTY).map(([id, d]) => `<button class="${diff === id ? 'on' : ''}" data-act="diff" data-arg="${id}">${d.name}</button>`).join('')}</div>
      <div class="note" style="margin-bottom:12px">${DIFFICULTY[diff].desc} Scenarios with their own budget keep it, and the daily challenge is always played on normal.</div>
      <div class="section-label">Choose how to start</div>${list}`;
  }

  const responseDate = (minute) => `${fmtDate(Math.floor(minute / 1440))} · ${String(Math.floor(minute % 1440 / 60)).padStart(2, '0')}:${String(Math.floor(minute % 60)).padStart(2, '0')}`;
  const responseHours = (minutes) => `${Math.max(1, Math.ceil(minutes / 60))}h`;
  function responseContractHTML(outlook, after = null) {
    const c = outlook.contract, unit = c.kind === 'cargo' ? 't' : 'passengers';
    return `<div class="item recovery-contract"><div class="row"><b>${esc(clientOf(c)?.name || 'Contract')} · ${c.dest}</b><span class="tag ${((after || outlook).shortfall > .5) ? 'amber' : ''}">${(after || outlook).shortfall > .5 ? 'At risk' : 'Target in reach'}</span></div>
      ${kv('Still needed', `${Math.ceil(outlook.remaining).toLocaleString()} ${unit}`, 'mono')}
      ${kv('Estimated before deadline', `${Math.floor(outlook.projected).toLocaleString()}${after ? ` → ${Math.floor(after.projected).toLocaleString()}` : ''} ${unit}`, 'mono')}
      <p class="note">Due ${fmtDate(c.due)} · ${c.series ? '00:00' : 'end of day'}. Reward ${fmtMoney(c.reward)}. Actual flights must reach the target; no deadline extension or guaranteed payout.</p></div>`;
  }
  function disruptionModal() {
    const review = disruptionReview; if (!review) return;
    const s = game.state, cases = responseCases(game, review.hub || 'all');
    const header = (title, label = 'Operations · disruption response') => `<div class="row"><div class="eyebrow">${label}</div><button class="x" data-act="close-modal" aria-label="Close disruption response">×</button></div><h2>${esc(title)}</h2>`;
    if (!review.target) {
      showModal(`${header('Keep the network moving')}
        <p class="note">Review the effects before moving aircraft or spending cash. Resolved incidents disappear automatically.</p>
        <div class="section-label">Disrupted routes · ${cases.routes.length}</div>${cases.routes.map((r) => {
          const ctx = responseContext(game, {kind:'route',id:r.id});
          return `<button class="launch-option" data-act="response-open" data-arg="route:${r.id}"><b>${r.hub} ⇄ ${r.dest}</b><span class="sub">${ctx.incidents.map((i) => esc(i.title)).join(' · ')} · about ${responseHours(ctx.until-s.minute)} left</span></button>`;
        }).join('') || '<p class="note">No active closures or repairs on operating routes.</p>'}
        <div class="section-label">Contracts due soon · ${cases.contracts.length}</div>${cases.contracts.map((c) => `<button class="launch-option" data-act="response-open" data-arg="contract:${c.id}"><b>${esc(clientOf(c)?.name || 'Contract')} · ${c.dest}</b><span class="sub">${Math.ceil(c.amount-c.done).toLocaleString()} ${c.kind === 'cargo' ? 't' : 'passengers'} needed · due ${fmtDate(c.due)}${c.series ? ' at 00:00' : ' by end of day'}</span></button>`).join('') || '<p class="note">No signed targets due within three days.</p>'}
        <div class="section-label">Temporary assignments · ${cases.returns.length}</div>${cases.returns.map((p) => `<button class="launch-option" data-act="response-open" data-arg="return:${p.id}"><b>${p.name}</b><span class="sub">${p.recoveryAssignment.pending || `Returns after its incident or contract target ends · ${responseDate(p.recoveryAssignment.until)} expected`}</span></button>`).join('') || '<p class="note">No aircraft waiting to return from temporary cover.</p>'}
        <div class="btn-row"><button class="btn wide" data-act="close-modal">Back to game</button></div>`); return;
    }
    const ctx = responseContext(game, review.target);
    if (!ctx) {
      const kept = review.target.kind === 'return' && review.notice;
      showModal(`${header(kept ? 'Assignment kept' : 'Problem resolved')}<p>${kept ? 'Automatic return canceled. The aircraft stays on its current assignment.' : 'This incident, contract or temporary assignment is no longer active. The response list has been refreshed.'}</p><div class="btn-row"><button class="btn ghost" data-act="response-list">Other responses</button><button class="btn" data-act="close-modal">Back to game</button></div>`); return;
    }
    if (review.stage === 'review') {
      const q = responseQuote(game, review.target, review.action); review.snapshot = q.snapshot;
      showModal(`${header(q.title || 'Response unavailable', 'Review before applying')}
        ${q.action?.routeId && game.route(q.action.routeId) ? `<p class="recovery-destination">${q.action.kind === 'move' ? `${esc(game.plane(q.action.planeId).name)} → ` : ''}<b>${game.route(q.action.routeId).hub} ⇄ ${game.route(q.action.routeId).dest}</b></p>` : ''}
        ${q.before ? `<div class="recovery-preview item"><div class="section-label">Next ${responseHours(q.minutes)} · estimated</div>
          ${kv('Passengers carried', `${Math.floor(q.before.passengers).toLocaleString()} → ${Math.floor(q.after.passengers).toLocaleString()}`, 'mono')}
          ${kv('Operating result · combined', `${fmtSigned(q.before.profit)} → ${fmtSigned(q.after.profit)}`, 'mono')}
          ${kv('Response cost now', fmtMoney(q.cost), 'mono amber')}
          ${kv('Cash after response', fmtMoney(q.remaining), 'mono')}
          ${kv('Net change after response cost', fmtSigned(q.gain), `mono ${signCls(q.gain)}`)}</div>` : q.cost != null ? kv('Response cost',fmtMoney(q.cost),'mono') : ''}
        ${q.routes?.length > 1 ? `<details class="route-section"><summary>Impact on ${q.routes.length} affected routes</summary>${q.routes.map((row)=>`<div class="recovery-route"><b>${row.route.hub} ⇄ ${row.route.dest}</b>${kv('Assigned aircraft',`${row.countBefore} → ${row.countAfter}`,'mono')}${kv('Operating result',`${fmtSigned(row.before.profit)} → ${fmtSigned(row.after.profit)}`,'mono')}</div>`).join('')}</details>` : ''}
        ${q.lease?.type ? `<div class="item">${kv('Minimum commitment · fee + rent',fmtMoney(q.lease.commitment),'mono amber')}${kv('Daily rent',fmtMoney(q.lease.daily),'mono')}${kv('Maintenance / day · starts at',fmtMoney(q.lease.type.price*.008),'mono')}</div>` : ''}
        ${q.repRestore ? `<p class="good">Recovers up to ${q.repRestore.toFixed(2)} reputation points from this breakdown.</p>` : ''}
        ${q.repSavedDaily ? `<p class="good">Currently avoids ${q.repSavedDaily.toFixed(2)} reputation points of damage per full day of this closure.</p>` : ''}
        ${(q.notes || []).map((text) => `<p class="note">${esc(text)}</p>`).join('')}
        ${q.contracts?.length ? '<div class="section-label">Contract consequences</div>' + q.contracts.map((row) => responseContractHTML(row.before,row.after)).join('') : ''}
        <p class="note">Combined estimates include every affected route, plus upkeep and rent for aircraft involved, including parked reserves. Airport overhead, interest and contract rewards are excluded. Existing flights, demand and new incidents can change results. Returns are estimated at the incident end; actual returns wait between trips.</p>
        ${q.why ? `<div class="why bad" role="alert">${esc(q.why)}</div>` : ''}
        <div class="btn-row"><button class="btn ghost" data-act="response-back">Back</button><button class="btn" data-act="response-apply" ${q.why ? 'disabled' : ''}>Apply response${q.cost ? ` · ${fmtMoney(q.cost)}` : ''}</button></div>`); return;
    }
    if (review.stage === 'choose') {
      const targets = responseTargets(game, ctx);
      if (!targets.some((r) => r.id === review.routeId)) review.routeId = targets[0]?.id;
      const route = game.route(review.routeId), planes = responseAircraft(game, ctx, review.routeId);
      if (!planes.some((p) => p.id === review.planeId)) review.planeId = planes[0]?.id;
      const types = route ? AIRCRAFT_LIST.filter((t) => t.range >= route.km && t.cls <= game.hub(route.hub).levels.runway) : [];
      if (!types.some((t) => t.id === review.typeId)) review.typeId = types[0]?.id;
      const lease = review.mode === 'lease' && route && review.typeId ? game.leaseQuote(review.typeId,route.hub,7,route.id) : null;
      const available = !!route && (review.mode === 'lease' ? !!lease?.type : !!review.planeId);
      showModal(`${header(review.mode === 'lease' ? 'Arrange temporary lease cover' : ctx.closed ? 'Redeploy held aircraft' : 'Choose temporary cover')}
        <label class="recovery-field">Destination route<select data-act="response-route" aria-label="Destination route">${targets.map((r) => `<option value="${r.id}" ${r.id === review.routeId ? 'selected' : ''}>${r.hub} ⇄ ${r.dest}</option>`).join('') || '<option>No open routes available</option>'}</select></label>
        ${review.mode === 'lease' ? `<label class="recovery-field">Aircraft type<select data-act="response-type" aria-label="Aircraft type">${types.map((t) => `<option value="${t.id}" ${t.id === review.typeId ? 'selected' : ''}>${t.name} · ${t.seats} seats</option>`).join('')}</select></label>
          ${lease?.type ? `<div class="item">${kv('Setup fee',fmtMoney(lease.fee),'mono')}${kv('Daily rent',fmtMoney(lease.daily),'mono')}${kv('7-day minimum · fee + rent',fmtMoney(lease.commitment),'mono amber')}</div>` : ''}
          <p class="note">A 7-day commitment, plus maintenance. The repairing aircraft keeps its gate, so the lease needs a spare gate.</p>${lease?.why ? `<p class="why bad">${esc(lease.why)}</p>` : ''}`
          : `<label class="recovery-field">Available aircraft<select data-act="response-plane" aria-label="Available aircraft">${planes.map((p) => `<option value="${p.id}" ${p.id === review.planeId ? 'selected' : ''}>${p.name} · ${AIRCRAFT[p.type].name} · ${p.routeId == null ? 'parked' : `from ${p.hub}–${game.route(p.routeId).dest}`}</option>`).join('') || '<option>No compatible aircraft ready</option>'}</select></label>
          <p class="note">Only aircraft parked or waiting at an open home airport are available. Current flights and repairs are never interrupted. Review the source route’s lost capacity before confirming.</p>`}
        ${!available ? '<div class="why amber">Wait for an aircraft to return home, open another compatible route, or review the available lease options. Aircraft cannot leave a closed home airport.</div>' : ''}
        <div class="btn-row"><button class="btn ghost" data-act="response-back">Back</button><button class="btn" data-act="response-preview-choice" ${!available ? 'disabled' : ''}>Preview response</button></div>`); return;
    }
    const minutes = Math.max(1,Math.min(1440,ctx.until-s.minute)), affected = disruptionForecast(game,ctx.routeIds,minutes), normal = disruptionForecast(game,ctx.routeIds,minutes,{ignore:true});
    const choices = review.choices = [];
    const button = (label,action,extra='') => { const id=choices.push(action)-1; return `<button class="btn ghost wide" data-act="response-preview" data-arg="${id}">${label}</button>${extra}`; };
    if (ctx.plane) {
      const p=ctx.plane,c=p.recoveryAssignment;
      showModal(`${header(ctx.title)}<p>${esc(c.pending || 'This aircraft is providing temporary cover. It will return automatically once the incident or contract target ends.')}</p>
        ${kv('Current assignment',aircraftPlace(p))}${kv('Return to',game.route(c.originalRoute) ? `${c.originalHub} ⇄ ${game.route(c.originalRoute).dest}` : `Parking at ${c.originalHub}`)}
        <p class="note">A current flight is allowed to finish. Closed airports, incompatible routes or full gates can delay the return.</p>
        ${button('Preview keeping this assignment',{kind:'keep',planeId:p.id})}
        <div class="btn-row"><button class="btn ghost" data-act="response-list">All responses</button><button class="btn" data-act="close-modal">Back to game</button></div>`);return;
    }
    const targets=responseTargets(game,ctx);
    showModal(`${header(ctx.title)}${review.notice ? `<p class="why good" role="status">${esc(review.notice)}</p>` : ''}
      ${ctx.incidents.map((i) => `<div class="recovery-incident"><b>${esc(i.title)}</b><span>${responseHours(i.until-s.minute)} left · ${responseDate(i.until)} expected</span>${i.compensated ? '<small class="good">Passenger compensation paid</small>' : ''}</div>`).join('')}
      <div class="recovery-preview item"><div class="section-label">If you keep waiting · next ${responseHours(minutes)}</div>
        ${kv('Flight income at risk',fmtMoney(Math.max(0,normal.revenue-affected.revenue)),'mono amber')}
        ${kv('Passengers at risk',Math.round(Math.max(0,normal.passengers-affected.passengers)).toLocaleString(),'mono')}
        ${kv('Operating result · affected routes',fmtSigned(affected.profit),`mono ${signCls(affected.profit)}`)}
        <p class="note">No response fee. Aircraft upkeep and rent continue. Figures compare the affected routes with the same fleet free of closures and repairs.</p></div>
      ${ctx.contract ? responseContractHTML(ctx.outlook) : s.contracts.filter((c) => c.due != null && !c.paid && c.done<c.amount && ctx.routeIds.some((id)=>game.route(id)?.dest===c.dest && (!c.series || game.route(id)?.hub===c.hub))).map((c)=>responseContractHTML(contractOutlook(game,c))).join('')}
      <div class="section-label">Choose a response</div>
      ${ctx.closed ? '<p class="note">Extra aircraft cannot reopen this route. Aircraft waiting at an open home airport can work elsewhere until the closure ends.</p>' : '<p class="note">Cover adds capacity while the original aircraft completes its repair. Contract targets and deadlines stay as signed.</p>'}
      <div class="recovery-options"><button class="btn ghost wide" data-act="response-choose" data-arg="move" ${!targets.length ? 'disabled' : ''}>${ctx.closed ? 'Redeploy held aircraft' : 'Use available aircraft'}</button>
        ${!ctx.closed ? `<button class="btn ghost wide" data-act="response-choose" data-arg="lease" ${!targets.length ? 'disabled' : ''}>Compare 7-day lease cover</button>` : ''}
        ${!ctx.closed ? targets.filter((r)=>r.service!=='frequent').map((r)=>button(`Preview Frequent service · ${r.hub} ⇄ ${r.dest}`,{kind:'service',routeId:r.id})).join('') : ''}
        ${ctx.incidents.filter((i)=>i.kind==='strike').map((i)=>button(`Preview strike settlement · ${fmtMoney(game.settleCost(i.event))}`,{kind:'settle',incidentKey:i.key})).join('')}
        ${ctx.incidents.filter((i)=>!i.compensated && (i.kind!=='repair' || i.plane.breakdown?.repLoss>0)).map((i)=>button(`Review compensation · ${i.kind==='repair'?i.plane.name:i.event.airport}`,{kind:'compensate',incidentKey:i.key})).join('')}
        ${ctx.contract && !ctx.routeIds.length ? '<button class="btn ghost wide" data-act="response-plan-route">Plan the missing route</button>' : ''}</div>
      <p class="note">Estimates include aircraft maintenance and rent, before airport overhead, interest and contract rewards. Compensation helps reputation; it does not restore capacity. A temporary assignment may need to wait for a free gate before returning.</p>
      <div class="btn-row"><button class="btn ghost" data-act="response-list">All responses</button><button class="btn" data-act="close-modal">Keep waiting</button></div>`);
  }

  // ---------- dialogs ----------
  function showModal(html, pause = true) {
    const s = game.state;
    if (!modal) modalFocus = document.activeElement;
    if (mobileMedia.matches) mobileGuideExpanded = false;
    modal = { resume: pause && s ? (modal?.resume ?? s.speed) : null }; // a dialog opened over another keeps the original speed
    if (pause && s) s.speed = 0;
    $('#modal-box').innerHTML = html;
    $('#modal-box').classList.toggle('launch-box', !!launch);
    $('#modal-box').classList.toggle('aircraft-box', !!aircraftReview || !!aircraftPicker);
    $('#modal-box').classList.toggle('search-box', searchOpen);
    $('#modal-box').classList.toggle('specialization-box', commercialReview?.kind?.startsWith('specialization') || false);
    $('#modal-box').classList.toggle('recovery-box', !!disruptionReview);
    $('#modal-box').classList.toggle('partnership-box', !!partnershipReview);
    $('#modal-box').classList.toggle('cargo-box', !!cargoReview);
    $('#modal-box').classList.toggle('project-box', !!projectReview);
    $('#modal-box').classList.toggle('campaign-box', !!campaignReview);
    $('#modal-box').classList.toggle('company-box', !!companyReview);
    $('#modal-box').classList.toggle('tutorial-box', tutorialBrowse);
    $('#modal-box').classList.toggle('project-catalog', projectReview?.mode==='list');
    const box = $('#modal-box');
    const actionRow = (box.querySelector('[data-pwa-panel]') || aircraftReview || aircraftPicker || launch || commercialReview || disruptionReview || partnershipReview || cargoReview || projectReview || campaignReview || companyReview || tutorialBrowse) && [...box.children].reverse().find((el) => el.matches('.btn-row, .card-actions, button.btn'));
    box.classList.toggle('has-scroll', !!actionRow);
    if (actionRow) {
      const body = document.createElement('div'), footer = document.createElement('div');
      body.className = 'dialog-scroll'; footer.className = 'dialog-footer';
      while (box.firstChild && box.firstChild !== actionRow) body.append(box.firstChild);
      while (box.firstChild) footer.append(box.firstChild);
      box.append(body, footer);
    }
    $('#modal').hidden = false;
    if (mobileMedia.matches) { $('#mobile-nav').inert = true; $('#hud').inert = true; }
    renderGuide(s);
    $('#modal-box').querySelector('button:not(:disabled)')?.focus();
  }
  function closeModal() {
    if (!modal) return;
    if (modal.resume != null && game.state && !game.state.over) game.state.speed = modal.resume; // a paused game stays paused
    modal = null;
    launch = null;
    aircraftReview = null; aircraftPicker = null; commercialReview = null; disruptionReview = null; partnershipReview = null; cargoReview = null; projectReview = null;
    campaignReview = null;
    companyReview = null;
    tutorialBrowse = false;
    searchOpen = false;
    $('#modal').hidden = true;
    if (mobileMedia.matches) { $('#mobile-nav').inert = false; $('#hud').inert = false; }
    renderGuide(game.state);
    if (modalFocus?.isConnected) modalFocus.focus();
  }

  function networkResultsHTML() {
    if (!networkQuery.trim()) return '<div class="empty">Find an airport, an existing route or an aircraft.<br>Try a city, airport code or aircraft name.</div>';
    const found = searchNetwork(game, networkQuery);
    const sections = [
      ['Your routes', found.routes.map((r) => ({ kind: 'route', id: r.id, title: `${r.hub} ⇄ ${r.dest}`, sub: `${AIRPORT_BY_ID[r.hub].city} ⇄ ${AIRPORT_BY_ID[r.dest].city}` }))],
      ['Your aircraft', found.planes.map((p) => ({ kind: 'plane', id: p.id, title: p.name, sub: `${planeRegistration(p)} · ${AIRCRAFT[p.type].name} · ${aircraftPlace(p)}` }))],
      ['Airports', found.airports.map((a) => ({ kind: 'airport', id: a.id, title: `${a.id} · ${a.city}`, sub: `${a.country}${game.isHub(a.id) ? ' · your hub' : ''}` }))],
    ];
    const total = sections.reduce((n, [, rows]) => n + rows.length, 0);
    if (!total) return '<div class="empty" role="status">No matches. Try another city, airport code or aircraft name.</div>';
    return `<div class="sub" role="status">${total} matches across your network and airports</div>${sections.filter(([, rows]) => rows.length).map(([name, rows]) =>
      `<div class="section-label">${name}<span>${rows.length}</span></div>${rows.slice(0, 12).map((r) => `<button class="launch-option search-result" data-act="search-go" data-arg="${r.kind}:${r.id}"><b>${esc(r.title)}</b><span class="sub">${esc(r.sub)}</span></button>`).join('')}${rows.length > 12 ? '<p class="note">Showing the first 12. Add more detail to narrow your search.</p>' : ''}`).join('')}`;
  }
  function openNetworkSearch() {
    if (!game.state) return;
    navOpen = false; hubMenu = false; delete cache['network-results'];
    searchOpen = true;
    showModal(`<div class="row"><h2>Search your network</h2><button class="x" data-act="close-modal" aria-label="Close search">×</button></div>
      ${searchField('network', networkQuery, 'Search cities, routes or aircraft')}<div class="network-results" id="network-results">${networkResultsHTML()}</div>`);
    $('#modal-box input').focus();
  }

  const aircraftPlace = (p) => { const r = p && game.route(p.routeId); return !p ? 'Sold' : r ? `${r.hub} ⇄ ${r.dest}` : `Parked at ${p.hub}`; };
  const aircraftTitles = { move: 'Move aircraft', swap: 'Swap aircraft', park: 'Park aircraft', replace: 'Replace with new', type: 'Change aircraft type', overhaul: 'Maintain aircraft', sell: 'Sell aircraft' };

  function showAircraftPicker(kind, id) {
    const p = game.plane(id);
    if (!p) return 'This aircraft is no longer available';
    aircraftReview = null; aircraftPicker = { kind, id };
    const options = kind === 'move' ? game.state.routes.filter((r) => r.id !== p.routeId).map((r) => ({ action: { kind, id, target: r.id }, title: `${r.hub} ⇄ ${r.dest}`, sub: `${AIRPORT_BY_ID[r.dest].city} · ${km(r.km)}` }))
      : kind === 'swap' ? game.state.planes.filter((q) => q.id !== id).map((q) => ({ action: { kind, id, target: q.id }, title: `${q.name} · ${AIRCRAFT[q.type].name}`, sub: aircraftPlace(q) }))
      : AIRCRAFT_LIST.map((t) => ({ action: { kind: t.id === p.type ? 'replace' : 'type', id, target: t.id }, title: `New ${t.name}`, sub: `${t.seats} seats · ${km(t.range)} range${t.id === p.type ? ' · same type' : ''}` }));
    showModal(`<div class="row"><div class="eyebrow">${p.name}</div><button class="x" data-act="close-modal" aria-label="Cancel aircraft change">×</button></div>
      <h2>${kind === 'move' ? 'Choose a route' : kind === 'swap' ? 'Choose an aircraft to swap' : 'Choose a replacement'}</h2><p>Currently: ${aircraftPlace(p)}. Nothing changes until you review and apply.</p>
      <div class="aircraft-options">${options.map(({ action, title, sub }) => {
        const plan = aircraftPlan(game, action);
        return `<button class="launch-option" data-act="aircraft-choice" data-arg="${action.kind}:${action.target}" ${plan.why ? 'disabled' : ''}>
          <b>${esc(title)}</b><span class="sub">${esc(sub)}</span>${plan.why ? `<span class="why bad">${esc(plan.why)}</span>` : `<span class="sub">${plan.cost < 0 ? `${fmtMoney(-plan.cost)} back` : `${fmtMoney(plan.cost)} cost`} · estimated change <span class="${signCls(plan.gain)}">${fmtSigned(plan.gain)}/day</span></span>`}</button>`;
      }).join('') || `<div class="empty">${kind === 'swap' ? 'No other aircraft to swap with.' : 'No other routes yet. Plan another route first.'}</div>`}</div>
      <button class="btn ghost wide" data-act="close-modal">Cancel</button>`);
  }

  function previewAircraft(action, fromPicker = false, message = '') {
    if (!fromPicker) aircraftPicker = null;
    const plan = aircraftPlan(game, action);
    if (plan.why) return plan.why;
    aircraftReview = { action, revision: plan.revision };
    showModal(`<div class="row"><div class="eyebrow">Review aircraft change</div><button class="x" data-act="close-modal" aria-label="Cancel aircraft change">×</button></div>
      <h2>${aircraftTitles[action.kind]}</h2>${message ? `<p class="amber" role="alert">${esc(message)}</p>` : ''}
      ${plan.changes.map((c) => `<div class="item"><div class="name">${c.before.name} · ${AIRCRAFT[c.before.type].name}</div>
        ${kv('Assignment', `${aircraftPlace(c.before)} → ${aircraftPlace(c.after)}`)}
        ${c.after && c.before.type !== c.after.type ? kv('Aircraft', `${AIRCRAFT[c.before.type].name} → ${AIRCRAFT[c.after.type].name}`) : ''}
        ${c.after && c.before.age !== c.after.age ? kv('Age', `${Math.floor(c.before.age)} → ${Math.floor(c.after.age)} days`) : ''}
        ${c.after && game.planeUpkeep(c.before) !== game.planeUpkeep(c.after) ? kv('Daily upkeep', `${fmtMoney(game.planeUpkeep(c.before))} → ${fmtMoney(game.planeUpkeep(c.after))}`, 'mono') : ''}</div>`).join('')}
      ${plan.routes.length ? '<div class="section-label">Affected routes · estimated profit / day</div>' : ''}
      ${plan.routes.map((x) => `<div class="item">${kv(`${x.route.hub} ⇄ ${x.route.dest}`, `${fmtSigned(x.before)} → ${fmtSigned(x.after)}`, 'mono')}
        <div class="sub">${x.countBefore} → ${x.countAfter} aircraft${!x.countAfter ? ' · no flights after this change' : ''}</div></div>`).join('')}
      <div class="item">${kv(plan.cost < 0 ? 'Cash received' : 'Cost now', fmtMoney(Math.abs(plan.cost)), 'mono')}
        ${kv('Cash remaining', fmtMoney(plan.remaining), 'mono')}${kv('Estimated total change / day', fmtSigned(plan.gain), `mono ${signCls(plan.gain)}`)}</div>
      <p class="note">Estimates use current demand and fares, including aircraft upkeep and any parked-aircraft costs. They exclude temporary downtime, airport overhead and interest.</p>
      ${plan.warning ? `<p class="bad">${plan.warning}</p>` : ''}${plan.repairNote ? `<p>${plan.repairNote}</p>` : ''}
      <div class="btn-row">${aircraftPicker ? '<button class="btn ghost" data-act="aircraft-choice-back">Back</button>' : '<button class="btn ghost" data-act="close-modal">Cancel</button>'}<button class="btn" data-act="aircraft-apply">Apply ${{ overhaul: 'maintenance', type: 'replacement', replace: 'replacement', park: 'parking', sell: 'sale' }[action.kind] || action.kind}</button></div>`);
  }

  function previewFleetBatch(kind, hub) {
    const plan = fleetBatchPlan(game, kind, hub);
    if (plan.why) return plan.why;
    aircraftPicker = null; aircraftReview = { batch: { kind, hub }, revision: plan.revision };
    showModal(`<div class="row"><div class="eyebrow">${hub === 'all' ? 'All hubs' : hub}</div><button class="x" data-act="close-modal" aria-label="Cancel fleet changes">×</button></div>
      <h2>${kind === 'assign' ? 'Assign parked aircraft' : 'Maintain worn aircraft'}</h2>
      <p>${plan.actions.length} aircraft. ${kind === 'assign' ? 'Empty routes first, then routes with the most waiting passengers.' : 'Aircraft aged 150+ days or with breakdown risk above 3%. Each overhaul reduces age by 60%.'}</p>
      <div class="aircraft-options">${plan.changes.map((c) => `<div class="item"><b>${c.before.name}</b>${kv('Assignment', `${aircraftPlace(c.before)} → ${aircraftPlace(c.after)}`)}${kind !== 'assign' ? kv('Age', `${Math.floor(c.before.age)} → ${Math.floor(c.after.age)} days`) : ''}</div>`).join('')}
      ${plan.routes.map((r) => `<div class="item">${kv(`${r.route.hub} ⇄ ${r.route.dest}`, `${fmtSigned(r.before)} → ${fmtSigned(r.after)}/day`, 'mono')}</div>`).join('')}</div>
      ${kv('Total cost', fmtMoney(plan.cost), 'mono')}${kv('Cash remaining', fmtMoney(game.state.money - plan.cost), 'mono')}${kv('Estimated total change / day', fmtSigned(plan.gain), `mono ${signCls(plan.gain)}`)}
      <p class="note">Estimates include aircraft upkeep and parked costs, excluding temporary downtime and company overhead. Current repairs still need to finish.</p>
      <div class="btn-row"><button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn" data-act="aircraft-apply">Apply ${plural(plan.actions.length, 'change')}</button></div>`);
  }

  function startLaunch(dest) {
    const hub = game.state.active;
    const kind=page==='finder'?finderKind:'passenger';
    const best = game.estimate(hub, dest,null,null,kind).best;
    const idle = game.planesAt(hub).find((p) => !!AIRCRAFT[p.type].freighter===(kind==='cargo') && !game.launchQuote(hub, dest, { mode: 'parked', planeId: p.id }).why);
    const choice = idle ? { mode: 'parked', planeId: idle.id } : { mode: 'new', typeId: best?.type.id };
    if (!idle && game.launchQuote(hub, dest, choice).why && !game.launchQuote(hub, dest, { ...choice, mode: 'used' }).why) choice.mode = 'used';
    launch = { hub, dest, choice, kind: AIRCRAFT[idle?.type || choice.typeId]?.freighter ? 'cargo' : 'passenger', step: 'aircraft' };
    launchModal();
  }

  function commercialModal() {
    const review = commercialReview;
    if (!review) return;
    let q, title, content, confirm;
    if (review.kind === 'lease') {
      q = game.leaseQuote(review.typeId, review.hubId, review.days, review.routeId);
      title = `Lease ${q.type?.name || 'aircraft'}`;
      confirm = 'Start lease';
      content = `<p>${review.hubId} · ${q.route ? `assign to ${q.route.hub} ⇄ ${q.route.dest}` : 'park at this hub'}</p>
        <div class="seg service-options">${LEASE_TERMS.map((t) => `<button data-act="lease-term" data-arg="${t.days}" class="${review.days === t.days ? 'on' : ''}" aria-pressed="${review.days === t.days}">${t.days} days</button>`).join('')}</div>
        ${kv('Setup fee · paid now', fmtMoney(q.fee || 0), 'mono amber')}
        ${kv('Rent / day', fmtMoney(q.daily || 0), 'mono')}
        ${kv('Maintenance / day · starts at', fmtMoney((q.type?.price || 0) * .008), 'mono')}
        ${kv('Total fee + committed rent', fmtMoney(q.commitment || 0), 'mono')}
        ${kv('Cash after setup', fmtMoney(q.remaining ?? game.state.money), 'mono')}
        ${q.route ? kv('Estimated profit / day · this aircraft', fmtSigned(game.typeProfit(q.route, q.type, game.planesOn(q.route.id).length + 1).profit - q.daily), 'mono') : '<div class="why amber">A parked aircraft earns nothing but still pays rent and maintenance.</div>'}
        <p class="note">Rent accrues throughout the ${review.days}-day term. Maintenance is extra and grows with age. The aircraft returns automatically at expiry, after its current flight lands. Early return settles all remaining rent. You can extend before expiry. A leased aircraft cannot be sold or traded in.</p>`;
    } else if (review.kind === 'service') {
      q = game.serviceQuote(review.routeId, review.service);
      title = `${SERVICES[review.service]?.name || ''} service`;
      confirm = 'Apply service policy';
      content = q.why ? '' : `<p>${q.route.hub} ⇄ ${q.route.dest} · ${serviceOf(q.route).name} → ${SERVICES[review.service].name}</p>
        <div class="item">${kv('Demand / day · both ways', `${Math.round(q.before.demand)} → ${Math.round(q.after.demand)}`, 'mono')}
        ${kv('Departures / day · estimated', `${q.before.flights.toFixed(1)} → ${q.after.flights.toFixed(1)}`, 'mono')}
        ${kv('Route profit / day · estimated', `${fmtSigned(q.before.profit)} → ${fmtSigned(q.after.profit)}`, 'mono')}</div>
        ${passengerComparison(q.before.segments, q.after.segments)}
        <p>${SERVICES[review.service].description}</p><p class="note">Applies to the next departure without interrupting flights. Departures are estimates, not a timetable; actual loads, closures and available aircraft affect results. Profit includes aircraft maintenance and rent, before airport overhead and interest.</p>`;
    } else if (review.kind === 'repeat') {
      q = game.repeatQuote(review.clientId); title = q.client?.name || 'Repeat work'; confirm = 'Sign three-week agreement';
      content = !q.client ? '' : `<p>Three weekly targets · ${q.hub} ⇄ ${q.dest}</p>
        <div class="item">${kv('Each week', `${q.amount.toLocaleString()} ${q.kind === 'cargo' ? 't' : 'passengers'}`)}
        ${kv('Payout for each target', fmtMoney(q.reward), 'mono good')}${kv('Three-week total', fmtMoney(q.total), 'mono good')}
        ${kv('First deadline', `${fmtDate(game.state.day + 7)} · 00:00`, 'mono')}</div>
        <p class="note">Only this route counts. Each weekly target must be reached before its deadline; extra traffic does not carry over. Completing early pays that week immediately, then the next target starts at the weekly boundary. Missing any target ends the agreement and lowers reputation and client trust. Uses one of your three contract slots. No automatic renewal.</p>`;
    } else {
      q = game.leaseActionQuote(review.id, review.action); title = review.action === 'extend' ? 'Extend lease' : 'Return leased aircraft';
      confirm = review.action === 'extend' ? 'Confirm extension' : 'Settle rent and return';
      const p = q.plane, r = p && game.route(p.routeId);
      content = !p ? '' : `<p>${p.name} · ${AIRCRAFT[p.type].name}</p>
        ${review.action === 'extend' ? `${kv('Extra term', `${p.lease.days} days`)}${kv('Rent / day · unchanged', fmtMoney(p.lease.daily), 'mono')}${kv('Additional committed rent', fmtMoney(q.extraRent), 'mono')}${kv('New expiry', fmtDate(Math.floor(q.end / 1440)))}<p class="note">No setup fee. Rent continues at the existing rate. Maintenance remains extra.</p>` : `${kv('Remaining rent · paid now', fmtMoney(q.cost), 'mono amber')}${kv('Cash after return', fmtMoney(q.remaining), 'mono')}<p>${r ? `${r.hub} ⇄ ${r.dest} will have ${game.planesOn(r.id).length - 1} aircraft remaining.` : `Frees a gate at ${p.hub}.`}</p><p class="note">The aircraft leaves your fleet immediately.${['out', 'back'].includes(p.phase) ? ' Its current flight is cancelled with no flight income.' : ''} Waiting until expiry avoids an upfront settlement, but the same remaining rent will still be paid over time.</p>`}`;
    }
    showModal(`<div class="row"><div class="eyebrow">Review before applying</div><button class="x" data-act="close-modal" aria-label="Cancel">×</button></div><h2>${title}</h2>${content}${q.why ? `<div class="why bad" role="alert">${esc(q.why)}</div>` : ''}<div class="btn-row"><button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn" data-act="commercial-apply" ${q.why ? 'disabled' : ''}>${confirm}</button></div>`);
  }

  function launchModal() {
    if (!launch) return;
    const { hub, dest, choice, step } = launch;
    const q = game.launchQuote(hub, dest, choice);
    const airport = AIRPORT_BY_ID[dest];
    const header = `<div class="row"><div class="eyebrow">New route · ${hub} → ${dest}</div><button class="x" data-act="close-modal" aria-label="Cancel route launch">×</button></div>
      <h2>${step === 'review' ? 'Review and launch' : 'Choose your aircraft'}</h2>
      <p>${AIRPORT_BY_ID[hub].city} ⇄ ${airport.city}</p>
      <ol class="launch-steps"><li>✓ Destination</li><li class="${step === 'aircraft' ? 'on' : ''}">2 Aircraft</li><li class="${step === 'review' ? 'on' : ''}">3 Launch</li></ol>`;
    const summary = `<div class="item launch-summary">
      ${kv('Route opening fee', fmtMoney(q.routeCost), 'mono')}
      ${kv(choice.mode === 'parked' ? 'Use parked aircraft' : choice.mode === 'none' ? 'Aircraft · not assigned' : `${choice.mode === 'lease' ? 'Lease setup ·' : choice.mode === 'used' ? 'Used' : 'New'} ${q.type?.name || 'aircraft'}`, fmtMoney(q.aircraftCost), 'mono')}
      ${q.lease ? kv('Rent / day', fmtMoney(q.lease.daily), 'mono') + kv(`${q.lease.days}-day lease · fee + rent`, fmtMoney(q.lease.commitment), 'mono') + '<div class="note">Maintenance is extra. Returns at expiry; early return settles remaining rent.</div>' : ''}
      <div class="launch-total">${kv('Total starting cost', fmtMoney(q.total), 'mono amber')}</div>
      ${kv('Cash after starting cost', fmtMoney(q.remaining), `mono ${q.remaining < 0 ? 'bad' : ''}`)}
      <div class="note">Before any goal rewards. No money is spent until you confirm.</div></div>`;
    if (step === 'review') {
      showModal(`${header}<div class="item"><div class="name">${q.plane ? `${q.plane.name} · ${q.type.name}` : q.type?.name || 'No aircraft assigned'}</div>
        <div class="sub">${choice.mode === 'none' ? 'This route will stay idle until you assign an aircraft.' : `${choice.mode === 'used' ? `Used · ${USED.age} days old · higher maintenance and breakdown risk` : choice.mode === 'parked' ? `From your fleet at ${hub} · ${Math.floor(q.plane?.age || 0)} days old` : choice.mode === 'lease' ? `Leased for ${q.lease.days} days · factory new` : 'Factory new'} · assigned automatically`}</div>
        ${q.profit != null ? kv('Estimated profit / day', fmtSigned(q.profit), `mono ${signCls(q.profit)}`) + kv(q.type?.freighter ? 'Expected hold filled' : 'Expected seats filled', `${Math.round(q.load * 100)}%`, 'mono') : ''}
        <div class="note">${q.profit != null ? 'Estimate includes maintenance and any lease rent, at current demand and the initial service policy. Airport overhead and loan interest are extra.' : 'No flights or flight income until an aircraft is assigned.'}</div></div>
        <details class="route-section" data-section="launch-market"><summary>Route market · ${airport.market.name}</summary>${q.type?.freighter ? '<p class="note">Bulk freight departs at 70% full or after 6 hours and must arrive within 72 hours of booking. Revenue is earned on delivery; contracts reward actual outward tonnes.</p>' : passengerMix(q.market, null, 'launch')}${airportMarketHTML(airport, false, 'launch')}</details>
        ${summary}${q.why ? `<div class="why bad" role="alert">${esc(q.why)}</div>` : ''}
        <div class="btn-row"><button class="btn ghost" data-act="launch-back">Back</button><button class="btn" data-act="launch-confirm" ${q.why ? 'disabled' : ''}>${choice.mode === 'none' ? 'Open without aircraft' : 'Launch route'} · ${fmtMoney(q.total)}</button></div>`);
      return;
    }
    const option = (candidate, title, description) => {
      const quote = game.launchQuote(hub, dest, candidate);
      const selected = choice.mode === candidate.mode && choice.typeId === candidate.typeId && choice.planeId === candidate.planeId;
      return `<button class="launch-option ${selected ? 'on' : ''}" data-act="launch-choice" data-arg="${candidate.mode}:${candidate.planeId ?? candidate.typeId ?? ''}" aria-pressed="${selected}">
        <span class="row"><b>${title}</b><span class="mono">${fmtMoney(quote.aircraftCost)}</span></span>
        <span class="sub">${description}</span>${quote.profit != null ? `<span class="sub"><span class="${signCls(quote.profit)}">${fmtSigned(quote.profit)}/day est.</span> · ${Math.round(quote.load * 100)}% ${quote.type?.freighter ? 'hold' : 'seats'} filled</span>` : ''}
        ${quote.why ? `<span class="why bad">${esc(quote.why)}</span>` : ''}</button>`;
    };
    const parked = game.planesAt(hub).filter((p) => p.routeId == null && p.phase === 'idle' && !!AIRCRAFT[p.type].freighter === (launch.kind==='cargo'));
    const types = AIRCRAFT_LIST.filter((t) => !!t.freighter === (launch.kind==='cargo') && t.cls <= game.hub(hub).levels.runway && t.range >= distKm(AIRPORT_BY_ID[hub], airport));
    showModal(`${header}<div class="seg service-options" aria-label="Aircraft role">${[["passenger","Passenger"],["cargo","Freighter"]].map(([id,label])=>`<button data-act="launch-kind" data-arg="${id}" class="${launch.kind===id?'on':''}" aria-pressed="${launch.kind===id}">${label}</button>`).join('')}</div>${launch.kind==='cargo'?'<p class="note">Freighters start with Bulk service. Review Express in route details after launch. A cargo terminal is required at the home hub.</p>':''}${choice.mode === 'lease' ? `<div class="section-label">Lease term</div><div class="seg service-options">${LEASE_TERMS.map((t) => `<button data-act="launch-lease-term" data-arg="${t.days}" class="${choice.days === t.days ? 'on' : ''}" aria-pressed="${choice.days === t.days}">${t.days} days</button>`).join('')}</div>` : ''}<div class="launch-options">
      ${parked.length ? '<div class="section-label">Parked at this hub</div>' + parked.map((p) => option({ mode: 'parked', planeId: p.id }, `${p.name} · ${AIRCRAFT[p.type].name}`, `${Math.floor(p.age)} days old · no purchase needed`)).join('') : ''}
      <div class="section-label">Buy and assign</div>${types.map((t) => option({ mode: 'new', typeId: t.id }, `New ${t.name}`, `${t.freighter ? t.cargo+' t hold' : t.seats+' seats'} · ${km(t.range)} range`) + option({ mode: 'used', typeId: t.id }, `Used ${t.name}`, `${USED.age} days old · higher upkeep and breakdown risk`)).join('')}
      <div class="section-label">Lease and assign</div>${types.map((t) => option({ mode: 'lease', typeId: t.id, days: choice.days || 14 }, `Lease ${t.name} · ${choice.days || 14} days`, `${fmtMoney(game.leaseQuote(t.id, hub, choice.days || 14).daily)}/day rent + maintenance · setup fee shown`)).join('')}
      ${option({ mode: 'none' }, 'Open without aircraft', 'Route fee only. Assign an aircraft later to start flying.')}
      </div>${summary}<button class="btn wide" data-act="launch-review" ${q.why ? 'disabled' : ''}>Review launch →</button>
      ${q.why ? `<div class="why bad" role="alert">${esc(q.why)}</div>` : ''}`);
  }
  function strikeModal(e) {
    const incident=liveIncidents(game).find((i)=>i.event===e);
    if (incident) { disruptionReview={target:{kind:'route',id:incident.routeIds[0]}}; disruptionModal(); return; }
    const a = AIRPORT_BY_ID[e.airport];
    const cost = game.settleCost(e);
    showModal(`<div class="eyebrow">Strike</div><h2>Ground crews at ${esc(a.city)} have walked out.</h2>
      <p>Departures are held at ${a.id} until ${fmtDate(e.start+e.days)}, unless you settle. Flights already in the air can still land.</p>
      <div class="card-actions">
        <button class="btn wide" data-act="settle-now" data-arg="${e.id}" ${game.state.money < cost ? 'disabled' : ''}>Settle · ${fmtMoney(cost)}</button>
        <button class="btn ghost wide" data-act="close-modal">Wait it out</button></div>`);
  }
  function overModal(over) {
    const s = game.state, sc = game.scenario();
    const again = '<button class="btn ghost wide" data-act="restart">Back to the start screen</button>';
    const keep = '<button class="btn wide" data-act="keep-playing">Keep playing in free play</button>';
    let html;
    if (over.type === 'bankrupt') {
      html = `<div class="eyebrow">Day ${s.day + 1}</div><h2>The bank has closed your airport.</h2>
        <p>Cash was below zero for five days running.</p><div class="card-actions">
        ${s.equity <= 0.3 ? '<button class="btn wide" data-act="bailout">Take a bailout: $750k for a 20% stake</button>' : ''}${again}</div>`;
    } else if (over.type === 'won') {
      html = `<div class="eyebrow">${sc.name}</div><h2>You did it, on day ${over.day}.</h2>
        <p>${sc.goal}. It is marked as completed on the start screen.</p><div class="card-actions">${keep}${again}</div>`;
    } else if (over.type === 'failed') {
      html = `<div class="eyebrow">${sc.name}</div><h2>Out of time.</h2>
        <p>Day ${sc.deadline} came and the goal wasn’t met: ${sc.goal.toLowerCase()}.</p><div class="card-actions">${keep}${again}</div>`;
    } else {
      html = `<div class="eyebrow">Daily challenge · ${s.mode.date}</div><h2>Thirty days are up.</h2>
        <div class="big">${fmtMoney(over.score)}</div>
        <p>Net worth. ${over.score >= over.best ? 'That is your best today.' : `Your best today is ${fmtMoney(over.best)}.`}</p>
        <div class="card-actions">${keep}${again}</div>`;
    }
    showModal(html, false);
  }
  function offlineModal(r) {
    const mins = Math.round(r.seconds / 60);
    const away = mins >= 120 ? `${Math.round(mins / 60)} hours` : `${mins} minutes`;
    showModal(`<div class="eyebrow">Welcome back</div><h2>Your aircraft kept flying.</h2>
      <div class="big ${signCls(r.earned)}">${fmtSigned(r.earned)}</div>
      <p>You were away ${away}${r.capped ? ' (earnings stop after four hours)' : ''}. ${plural(r.days, 'day')} passed and ${r.pax.toLocaleString()} passengers flew.</p>
      <div class="card-actions"><button class="btn wide" data-act="close-modal">Carry on</button></div>`);
  }

  function openView(id) {
    view.open(id);
    const h = game.hub(id);
    $('#view-title').textContent = `${AIRPORT_BY_ID[id].city} ${rankFor(h.levels).name}`;
    setHTML($('#view-legend'), viewLegend(id));
    $('#view').hidden = false;
  }

  function share() {
    const s = game.state;
    const src = map.canvas;
    const c = document.createElement('canvas');
    const scale = src.width / src.clientWidth;
    const bar = 64 * scale;
    c.width = src.width; c.height = src.height + bar;
    const g = c.getContext('2d');
    g.fillStyle = '#060b12'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, 0, 0);
    g.fillStyle = '#0c1420'; g.fillRect(0, src.height, c.width, bar);
    g.fillStyle = companyColor(s); g.font = `600 ${20 * scale}px "Avenir Next", system-ui, sans-serif`;
    g.fillText(s.company.name, 20 * scale, src.height + 28 * scale, c.width-40*scale);
    g.fillStyle = '#8296aa'; g.font = `${13 * scale}px "SF Mono", ui-monospace, monospace`;
    g.fillText(`Day ${s.day + 1} · ${plural(s.routes.length, 'route')} · ${plural(s.planes.length, 'aircraft').replace('aircrafts', 'aircraft')} · ${s.totalPax.toLocaleString()} passengers · net worth ${fmtMoney(game.netWorth())}`, 20 * scale, src.height + 50 * scale);
    g.textAlign = 'right'; g.fillText('AIRPORT MANAGER', c.width - 20 * scale, src.height + 38 * scale);
    c.toBlob((blob) => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `airport-manager-day-${s.day + 1}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    });
  }

  // ---------- render ----------
  const TAB_HTML = { company: companyTab, airport: airportTab, routes: routesTab, market: fleetTab, finder: finderTab, log: logTab, contracts: contractsTab, finance: financeTab, calendar: calendarTab, rivals: rivalsTab, goals: goalsTab, more: moreTab, learn: lessonsTab, 'mobile-menu': mobileMenuHTML };

  function render() {
    const s = game.state;
    if (!mobileMedia.matches && page === 'mobile-menu') page = null;
    document.body.classList.toggle('mobile-game', mobileMedia.matches && !!s);
    if (s && sel?.kind === 'plane' && !game.plane(sel.id)) { sel = null; tab = 'market'; map.setSelected(null); }
    if (dragging != null) { hud(); return; } // redrawing would pull the aircraft out from under the pointer
    $('#hud').hidden = !s;
    $('#panel').hidden = !s || opsOpen;
    $('#panel').classList.toggle('route-list-mode', tab === 'routes');
    $('#board').hidden = !s || !board.length;
    $('#intro').hidden = !!s;
    if (!s) setHTML($('#intro'), introHTML());
    map.setShowRivals(!!s && page === 'rivals');
    $('#mode-toggle').textContent = map.getMode() === 'globe' ? 'Map view' : 'Earth view';
    $('#world-toggle').hidden = !s;
    $('#world-toggle').classList.toggle('on', coverView);
    setHTML($('#world-toggle'), coverView && s
      ? `Coverage · ${game.worldProgress().served} of ${game.worldProgress().total} <span class="legend"><i style="background:#8fd3ff"></i>not served yet <i style="background:${companyColor(s)}"></i>served</span>`
      : 'Coverage view');
    $('#profit-toggle').hidden = !s;
    $('#profit-toggle').classList.toggle('on', profitView);
    setHTML($('#profit-toggle'), profitView
      ? 'Profit view <span class="legend"><i style="background:var(--good)"></i>earning <i style="background:var(--bad)"></i>losing <i style="background:#aab9c8"></i>no data</span>'
      : 'Profit view');

    if (!s) { hubMenu = false; page = null; navOpen = false; opsOpen = false; $('#page').hidden = true; $('#nav-menu').hidden = true; }
    $('#operations-btn').classList.toggle('on', opsOpen);
    $('#operations-btn').setAttribute('aria-pressed', String(opsOpen));
    $('#ops').hidden = !opsOpen;
    const opsBackLabel = `Back to ${backStack.length ? backLabel('map') : 'map'}`;
    $('#ops-back').setAttribute('aria-label', opsBackLabel);
    setHTML($('#ops-back'), `<span class="desktop-back-label">${esc(opsBackLabel)}</span><span class="mobile-back-label" aria-hidden="true">Back</span>`);
    if (opsOpen && s) setHTML($('#ops-body'), opsHTML(s));
    $('#hub-menu').hidden = !hubMenu;
    $('.hud-airport').setAttribute('aria-expanded', hubMenu);
    if (hubMenu) setHTML($('#hub-menu'), hubMenuHTML(s));

    const card = cardHTML();
    $('#card').hidden = !card || !!page || opsOpen;
    $('#panel').hidden = !s || opsOpen || (mobileMedia.matches && (!!page || !!card || mobileTab === 'map' || mobileTab === 'more' && tab !== 'airport'));
    setHTML($('#card'), card);
    $('#card').classList.toggle('has-body', !!$('#card-body'));
    $('#card').classList.toggle('route-detail', !!$('#card .route-tabs'));
    $('#card').dataset.routePane = routePane;
    $('#hud').inert = mobileMedia.matches && (!!modal || !$('#view').hidden);
    if (!s) { renderGuide(s); renderMobile(s); map.setFree(freeRect()); return; }
    document.documentElement.style.setProperty('--brand', companyColor(s));
    document.title = `${s.company.name} · Airport Manager`;

    if (s.over && !overShown) { overShown = true; overModal(s.over); }
    if (!s.over) overShown = false;
    if (view.hubId && game.hub(view.hubId)) setHTML($('#view-legend'), viewLegend(view.hubId));

    if (observeTutorial(s, {launch: launch?.step, routeId: launch && game.routeTo(launch.hub, launch.dest)?.id, launchStaffed: launch?.choice.mode !== 'none', at: guideAt})) game.save();
    renderGuide(s);
    const hintTab = currentLesson(s)?.step.go;
    const tabBtn = ([id, name]) => `<button data-act="tab" data-arg="${id}" class="${tab === id ? 'on' : ''} ${hintTab === id && tab !== id ? 'hint' : ''}">${name}</button>`;
    setHTML($('#tabs'), TABS.map(tabBtn).join(''));
    const panelExpanded = $('#panel').classList.contains('expanded');
    setHTML($('#panel-tools'), `<button class="btn ghost small" data-act="sheet-expand" aria-expanded="${panelExpanded}">${panelExpanded ? 'Split view' : 'Expand panel'}</button><button class="btn ghost small" data-act="sheet">Show map</button>`);
    const offers = s.contracts.filter((c) => c.due == null).length;
    const newsCount = () => (page === 'log' ? 0 : Math.min(s.logN - s.logSeen, s.log.length));
    const pageBtn = ([id, name], menu = false) => {
      const count = id === 'contracts' ? offers : id === 'log' ? newsCount() : 0;
      const label = `${name}${count ? ` · ${count} ${id === 'contracts' ? (count === 1 ? 'offer' : 'offers') : 'unread'}` : ''}`;
      return `<button data-act="page" data-arg="${id}" class="${menu ? 'menu-action' : 'header-action'} ${page === id ? 'on' : ''} ${hintTab === id && page !== id ? 'hint' : ''}" aria-label="${label}" aria-pressed="${page === id}" ${PAGE_KEYS[id] ? `aria-keyshortcuts="${PAGE_KEYS[id]}"` : ''} data-tip="${label}${PAGE_KEYS[id] ? ` · Key: ${PAGE_KEYS[id]}` : ''}">${icon(id)}<span class="nav-label">${name}</span>${count ? `<b class="badge" aria-hidden="true">${count > 99 ? '99+' : count}</b>` : ''}</button>`;
    };
    setHTML($('#nav'), NAV.map((p) => pageBtn(p)).join(''));
    if (page === 'log') s.logSeen = s.logN;
    const unread = Math.min(s.logN - s.logSeen, s.log.length);
    $('#news-btn').classList.toggle('on', page === 'log');
    $('#news-btn').setAttribute('aria-pressed', page === 'log');
    $('#news-btn').setAttribute('aria-label', `News${unread ? ` · ${unread} unread` : ''}`);
    $('#news-btn').dataset.tip = `News${unread ? ` · ${unread} unread` : ''} · Key: N`;
    $('#news-badge').hidden = !unread;
    $('#news-badge').textContent = unread > 9 ? '9+' : unread;
    const nextGoal = GOALS.find((g) => !s.goalsDone.includes(g.id));
    const nextAch = ACHIEVEMENTS.find((a) => !s.achDone.includes(a.id));
    const activeCampaign=game.campaignRun(),campaignProfile=CAMPAIGNS[s.campaigns?.active];
    $('#hud-goal-label').textContent = activeCampaign ? `${campaignProfile.name} · ${activeCampaign.chapter+1}/3` : nextGoal ? `Next goal · ${s.goalsDone.length} of ${GOALS.length}` : `Achievements · ${s.achDone.length} of ${ACHIEVEMENTS.length}`;
    $('#hud-goal').textContent = activeCampaign ? activeCampaign.phase==='ready'?'Chapter complete · review reward':campaignProfile.chapters[activeCampaign.chapter].name : nextGoal ? `${nextGoal.title} · ${fmtMoney(nextGoal.reward)}` : nextAch ? nextAch.desc : 'Explore campaigns';
    document.querySelector('.hud-goal').classList.toggle('on', page === 'goals');
    const hintInMenu = PAGES.some(([id]) => id === hintTab) && page !== hintTab;
    $('#nav-toggle').classList.toggle('hint', hintInMenu && !navOpen);
    $('#nav-toggle').setAttribute('aria-expanded', navOpen);
    $('#nav-toggle').classList.toggle('has-updates', offers > 0 || unread > 0);
    $('#nav-menu').hidden = !navOpen;
    setHTML($('#nav-menu'), `<div class="menu-heading company-menu-name">${esc(s.company.name)}</div><button class="menu-action" data-act="ops" data-arg="">${icon('operations')}<span class="nav-label">Operations</span><span class="sub">O</span></button><button class="menu-action" data-act="search">${icon('search')}<span class="nav-label">Search network</span><span class="sub">/</span></button>` + PAGES.map((p) => pageBtn(p, true)).join(''));
    $('#page').hidden = !page;
    if (page) {
      $('#page-title').textContent = PAGE_TITLES[page];
      setHTML($('#page-body'), (page === 'market' ? marketTab : TAB_HTML[page])(s));
    }
    const tip = currentTip(s);
    const coach = currentLesson(s) ? '' : tip ? tipHTML(tip) : esc(coachText(s));
    // Don't rebuild the panel under an open dropdown.
    if (document.activeElement?.tagName !== 'SELECT') {
      const mobile = mobileMedia.matches;
      const content = mobile && tab === 'routes' ? mobileRoutesHTML(s) : mobile && tab === 'market' ? mobileFleetHTML(s) : TAB_HTML[tab](s);
      const advice = coach ? `<div id="coach" class="${tip ? 'tutorial' : ''}">${coach}</div>` : '';
      setHTML($('#panel-body'), mobile ? content + advice : advice + content);
    }

    if (s.speed) resumeSpeed = s.speed;
    setHTML($('#speeds'), `<div class="speed-presets">${SPEEDS.map((v) => `<button data-act="speed" data-arg="${v}" class="${s.speed === v ? 'on' : ''}" aria-pressed="${s.speed === v}" aria-label="${v ? `Speed ${v}x` : 'Pause'}" data-tip="${v ? `Run at ${v}× speed` : 'Pause the game · Space'}">${v ? `${v}×` : icon('pause')}</button>`).join('')}</div>
      <div class="speed-compact"><button data-act="toggle-pause" class="${s.speed ? '' : 'on'}" aria-label="${s.speed ? 'Pause game' : 'Resume game'}" data-tip="${s.speed ? 'Pause the game' : `Resume at ${resumeSpeed}× speed`} · Space">${icon(s.speed ? 'pause' : 'play')}</button>
        <select data-act="compact-speed" aria-label="Game speed" data-tip="Game speed · changing this keeps a paused game paused">${SPEEDS.filter(Boolean).map((v) => `<option value="${v}" ${resumeSpeed === v ? 'selected' : ''}>${v}×</option>`).join('')}</select></div>`);
    const hub = game.activeHub;
    $('#hud-code').textContent = hub.id;
    $('#hud-name').textContent = AIRPORT_BY_ID[hub.id].city;
    $('#hud-rank').textContent = rankFor(hub.levels).name;
    setHTML($('#hud-events'), activeEvents(s).filter((e) => !(e.type === 'strike' && e.settled))
      .map((e) => `<span style="color:${EVENT_TYPES[e.type].color}" data-tip="${esc(describe(e).title)}">${EVENT_TYPES[e.type].icon}</span>`).join(''));
    hud();
    renderMobile(s);
    map.setFree(freeRect());
    refreshTip();
  }

  function hud() {
    const s = game.state;
    if (!s) return;
    const money = $('#hud-money');
    money.textContent = fmtMoney(s.money);
    money.classList.toggle('bad', s.money < 0);
    const net = s.today.rev - s.today.cost;
    const today = $('#hud-today');
    today.textContent = fmtSigned(net);
    today.className = `hud-value small ${signCls(net)}`;
    $('#hud-today-compact').textContent = fmtSigned(net);
    $('#hud-today-compact').className = signCls(net);
    const m = Math.floor(s.minute) % 1440;
    $('#hud-day').textContent = `Day ${s.day + 1} · ${fmtDate(s.day)}`;
    $('#hud-time').textContent = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  function toast({ text, kind = '', sound, target, at }) {
    if (sound) audio.play(sound);
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.setAttribute('role', 'status');
    const link = game.state && resolveAlertTarget(game, { target, at });
    el.innerHTML = `<span>${esc(text)}</span>${link ? `<button class="toast-action" data-act="alert-open" data-arg="${link.kind}:${link.id}">${alertTargetLabel(link)}</button>` : ''}`;
    const box = $('#toasts');
    box.prepend(el);
    while (box.children.length > 4) box.lastChild.remove();
    const dismiss = () => {
      if (!el.isConnected) return;
      if (el.matches(':hover') || el.contains(document.activeElement)) { setTimeout(dismiss, 1000); return; }
      el.classList.add('out'); setTimeout(() => el.remove(), 400);
    };
    setTimeout(dismiss, link ? 8000 : 3800);
  }

  // ---------- events ----------
  function startGame(homeId, modeId, {tutorial = false} = {}) {
    companyPane='profile';historyFilter='all';historyLimit=25;
    backStack.length = 0; routeQuery = ''; fleetQuery = ''; finderQuery = ''; finderMarket = 'all'; finderKind = 'passenger'; networkQuery = '';
    game.newGame(homeId, modeId, tutorial ? 'easy' : diff);
    pendingMode = null; tab = 'routes'; page = null; pick = null; addFor = null; opsOpen = false; contractReview = null; board.length = 0; profitView = false; map.setProfitView(false); coverView = false; map.setCoverView(false); overShown = false; guideFinished = null;
    mobileTab = 'map'; mobilePreview = null; mobileTools = false; mobileFleetHub = 'all'; mobileGuideExpanded = false;
    if (tutorial || !tutorialSeen()) startLesson(game.state, 'first-flight');
    if (tutorial) game.state.speed = 0;
    game.save();
    select(null);
    map.focus(homeId, 4.5);
    toast({ text: tutorial ? 'Welcome to London. Follow the guide to launch your first flight.' : `Welcome to ${AIRPORT_BY_ID[homeId].city}. Open a route to get started.`, kind: 'goal' });
    if (tutorial) $('#guide .guide-toggle')?.focus({preventScroll:true});
  }
  const pair = (arg) => arg.split(':');

  const actions = {
    'pwa-open': () => appModal(),
    'pwa-install': () => { void pwa.install(); },
    'pwa-check': () => { void pwa.check(); },
    'pwa-update': () => { closeModal(); void pwa.applyUpdate().then(ok => { if (!ok) appModal(); }); },
    'company-event': key => {const entry=game.state.company.timeline.find(e=>e.key===key),target=entry && companyEventTarget(game,entry);if(target)return actions['alert-open'](`${target.kind}:${target.id}`);},
    'company-pane': id => {companyPane=id;},
    'company-filter': id => {historyFilter=id;historyLimit=25;},
    'company-more': () => {historyLimit+=25;},
    'company-edit': () => {companyReview={kind:'brand',name:game.state.company.name,color:game.state.company.color};companyModal();$('#company-name').focus();},
    'aircraft-name': id => {const p=game.plane(+id);if(!p)return;companyReview={kind:'plane',id:p.id,name:p.name,color:game.state.company.color};companyModal();$('#company-name').focus();},
    'company-color': id => {companyReview.color=id;companyModal();$(`[data-act="company-color"][data-arg="${id}"]`).focus();},
    'company-registration': () => {companyReview.name=planeRegistration(game.plane(companyReview.id));companyModal();$('#company-name').focus();},
    'company-save': () => {
      const d=companyReview;if(!d)return;
      const why=d.kind==='plane'?game.renameAircraft(d.id,d.name):game.setCompanyIdentity(d.name,d.color);
      if(why){$('#company-error').textContent=why;$('#company-name').setAttribute('aria-invalid','true');$('#company-name').focus();return;}
      closeModal();$(d.kind==='plane'?'[data-act="aircraft-name"]':'[data-act="company-edit"]')?.focus();toast({text:d.kind==='plane'?'Aircraft name saved.':'Airline identity saved.',kind:'good'});
    },
    'projects-open': hubId => {projectReview={mode:'list',hubId:hubId==='all'?null:hubId};projectModal();},
    'campaign-open': id => {campaignReview=id;campaignModal();},
    'campaign-start': id => {const why=game.startCampaign(id);if(why)return why;campaignReview=id;campaignModal();},
    'campaign-pause': id => {const st=game.campaignStatus(id);if(!st?.active)return;showModal(`<div class="eyebrow">Pause campaign</div><h2>${st.profile.name}</h2><p>Delivery totals and collected chapter rewards will be kept. Activity while paused will not count.</p><p class="note">${st.run.progress.profitDays?`Your ${st.run.progress.profitDays}-day profitable streak will reset. `:''}Resuming starts a new profitable-day streak from the next full day.</p><div class="btn-row"><button class="btn ghost" data-act="campaign-open" data-arg="${id}">Keep working</button><button class="btn" data-act="campaign-pause-confirm" data-arg="${id}">Pause campaign</button></div>`);},
    'campaign-pause-confirm': id => {const why=game.pauseCampaign(id);if(why)return why;campaignModal();},
    'campaign-claim': arg => {const [id,chapter]=pair(arg),why=game.claimCampaign(id,+chapter);if(why){campaignModal();return why;}campaignModal();},
    'campaign-route': id => {closeModal();select({kind:'route',id:+id},true);},
    'campaign-help': kind => {
      closeModal();navOpen=false;hubMenu=false;
      if(kind==='projects'){projectReview={mode:'list',hubId:null};projectModal();}
      else if(kind==='finance'){rememberView();page='finance';opsOpen=false;}
      else {rememberView();page=null;opsOpen=true;opsHub='all';opsView='routes';routeFilter='all';routeQuery='';}
    },
    'project-detail': arg => {const [hubId,id]=pair(arg);projectReview={mode:'detail',hubId,id:+id};projectModal();},
    'project-review': arg => {const [hubId,value,action]=pair(arg);projectReview={mode:'review',hubId,action,...(action==='start'?{kind:value}:{id:+value})};projectModal();},
    'project-apply': () => {const r=projectReview;if(!r || r.mode!=='review')return;const why=game.applyProject(r.hubId,r.action==='start'?r.kind:r.id,r.action,r.revision);if(why){projectModal();return why;}projectReview={mode:'detail',hubId:r.hubId,id:r.action==='start'?game.hub(r.hubId).projects.at(-1).id:r.id};projectModal();},
    'shop-kind': id => {shopKind=id;},
    'cargo-service': arg => {const [id,kind]=pair(arg);cargoReview={action:'service',id:+id,kind};cargoModal();},
    'cargo-convert': id => {cargoReview={action:'convert',id:+id};cargoModal();},
    'cargo-apply': () => {const q=cargoReview;if(!q)return;const why=q.action==='service'?game.setFreightService(q.id,q.kind):q.action==='close'?game.closeRoute(q.id):game.convertFreighter(q.id);if(why){cargoModal();return why;}closeModal();if(q.action==='close')select(null);},
    'launch-kind': kind => {if(!launch)return;launch.kind=kind;const t=AIRCRAFT_LIST.filter(t=>!!t.freighter===(kind==='cargo')).find(t=>!game.launchQuote(launch.hub,launch.dest,{mode:'new',typeId:t.id}).why);launch.choice=t?{mode:'new',typeId:t.id}:{mode:'none'};launchModal();},
    'partnership-offer': (id) => {partnershipReview={rivalId:+id,terms:'reciprocal',action:'sign'};partnershipModal();},
    'partnership-open': (id) => {partnershipReview={agreementId:+id,action:'view'};partnershipModal();},
    'partnership-terms': (id) => {partnershipReview.terms=id;partnershipModal();},
    'partnership-action': (action) => {partnershipReview.action=action;partnershipModal();},
    'partnership-apply': () => {
      const review=partnershipReview;if(!review)return;
      const a=game.agreement(review.agreementId),id=a?.rivalId || review.rivalId;
      const why=game.applyPartnership(id,review.terms || a?.terms || 'reciprocal',review.action);
      if(why) {partnershipModal();return why;}
      partnershipReview={agreementId:game.agreementFor(id).id,action:'view'};partnershipModal();
    },
    'partnership-route': (id) => {closeModal();select({kind:'route',id:+id},true);},
    'response-list': () => { disruptionReview = {hub: disruptionReview?.hub || (opsOpen ? opsHub : 'all')}; disruptionModal(); },
    'response-open': (arg) => { const [kind,id] = pair(arg); disruptionReview = {hub: disruptionReview?.hub || 'all', target: {kind,id:+id}}; disruptionModal(); },
    'response-choose': (mode) => { if (disruptionReview) { disruptionReview.mode=mode; disruptionReview.stage='choose'; disruptionModal(); } },
    'response-route': (id) => { disruptionReview.routeId=+id; disruptionModal(); },
    'response-plane': (id) => { disruptionReview.planeId=+id; disruptionModal(); },
    'response-type': (id) => { disruptionReview.typeId=id; disruptionModal(); },
    'response-back': () => { const r=disruptionReview; if (r) { r.stage=r.stage==='review' && ['move','lease'].includes(r.action?.kind) ? 'choose' : null; disruptionModal(); } },
    'response-preview': (id) => { if (disruptionReview?.choices[+id]) { disruptionReview.action=disruptionReview.choices[+id]; disruptionReview.stage='review'; disruptionModal(); } },
    'response-preview-choice': () => {
      const r=disruptionReview; if (!r) return;
      r.action={kind:r.mode,routeId:r.routeId,...(r.mode==='lease'?{typeId:r.typeId}:{planeId:r.planeId})}; r.stage='review'; disruptionModal();
    },
    'response-apply': () => {
      const r=disruptionReview; if (!r) return;
      const why=game.applyResponse(r.target,r.action,r.snapshot);
      if (why) { disruptionModal(); return why; }
      r.stage=null; r.notice='Response applied. The situation below reflects your change.'; disruptionModal();
    },
    'response-plan-route': () => {
      const c=disruptionReview && responseContext(game,disruptionReview.target)?.contract; if (!c) return;
      closeModal(); game.setActive(c.hub); startLaunch(c.dest);
    },
    'mobile-tab': mobileNavigate,
    'mobile-tools': () => { mobileTools = !mobileTools; hubMenu = false; },
    'mobile-filters': key => { if (key in mobileFilters) mobileFilters[key] = !mobileFilters[key]; },
    'mobile-fleet-hub': id => { if (id === 'all' || game.isHub(id)) { mobileFleetHub = id; $('#panel-body').scrollTop = 0; } },
    'mobile-preview-close': () => { mobilePreview = null; map.setSelected(null); },
    'mobile-inspect': () => { if (mobilePreview) select({ ...mobilePreview }); },
    'mobile-upgrades': () => { rememberView(); mobileTab = 'more'; mobilePreview = null; page = null; sel = null; opsOpen = false; tab = 'airport'; map.setSelected(null); },
    'mobile-upgrades-back': () => { if (!returnToView()) mobileNavigate('more'); },
    'mobile-hub-manage': id => { rememberView(); game.setActive(id); mobileTab = 'more'; mobilePreview = null; page = null; sel = null; opsOpen = false; tab = 'airport'; map.setSelected(null); },
    tab: (arg) => { backStack.length = 0; tab = arg; mobileTab = arg === 'routes' ? 'routes' : arg === 'market' ? 'fleet' : 'more'; mobilePreview = null; page = null; sel = null; opsOpen = false; map.setSelected(null); $('#panel').classList.remove('collapsed'); },
    page: (arg) => { if (page === arg) { if (!returnToView()) page = null; return; } rememberView(); page = arg; contractReview = null; navOpen = false; opsOpen = false; calDay = null; calMonth = null; $('#page-body').scrollTop = 0; },
    'close-page': () => { if (returnToView()) return; if (contractReview && page === 'contracts') actions['contract-review-back'](); else page = null; },
    'detail-back': () => { if (!returnToView()) select(null); },
    search: openNetworkSearch,
    'search-go': (arg) => { const [kind, id] = pair(arg); closeModal(); select({ kind, id: kind === 'airport' ? id : +id }, true); },
    'clear-search': (key) => {
      if (key === 'routes') routeQuery = ''; else if (key === 'fleet') fleetQuery = ''; else if (key === 'finder') finderQuery = '';
      else { networkQuery = ''; $('#modal-box input').value = ''; setHTML($('#network-results'), networkResultsHTML()); $('#modal-box input').focus(); }
    },
    'reset-routes': () => { routeFilter = 'all'; routeQuery = ''; },
    'reset-fleet': () => { fleetFilter = 'all'; fleetQuery = ''; },
    'reset-finder': () => { finderQuery = ''; finderClear = false; finderNew = false; finderMarket = 'all'; },
    'finder-kind': kind => {finderKind=kind;},
    'finder-market': (id) => { finderMarket = MARKET_PROFILES[id] ? id : 'all'; },
    'show-results': () => { rememberView(); opsOpen = true; opsView = 'results'; opsHub = game.state.active; page = null; sel = null; map.setSelected(null); $('#ops-body').scrollTop = 0; },
    nav: () => { navOpen = !navOpen; hubMenu = false; render(); if (navOpen) $('#nav-menu button')?.focus(); else $('#nav-toggle').focus(); },
    'guide-library': () => { if (!game.state) {tutorialMenu();return;} closeModal(); actions['close-view'](); rememberView(); page = 'learn'; navOpen = false; opsOpen = false; guideFinished = null; $('#page-body').scrollTop = 0; },
    'tutorial-begin': () => { if (game.state) {actions['guide-start']('first-flight');return;} closeModal(); startGame('LHR', 'free', {tutorial:true}); },
    'guide-start': id => {
      const t = ensureTutorial(game.state);
      if (!startLesson(game.state, id, t.completed.includes(id) && !t.progress[id])) return;
      closeModal(); actions['close-view'](); guideFinished = null; page = null; sel = null; opsOpen = false; tab = 'routes'; map.setSelected(null); $('#panel').classList.remove('collapsed');
      mobileTab = 'routes'; mobilePreview = null; mobileGuideExpanded = true;
      if (id !== 'first-flight') guideGo();
      game.save();
    },
    'guide-restart': id => { if (startLesson(game.state, id, true)) actions['guide-start'](id); },
    'guide-go': () => { guideGo(); if (mobileMedia.matches) mobileGuideExpanded = false; },
    'guide-speed': () => { if (!modal) game.setSpeed(game.state.speed === 10 ? 0 : game.state.speed ? 10 : 1); },
    'guide-next': () => {
      const id = ensureTutorial(game.state).active;
      if (!nextLessonStep(game.state)) return;
      if (!game.state.tutorial.active) { guideFinished = id; try { localStorage.setItem(TUTORIAL_KEY, '1'); } catch {} }
      game.save();
    },
    'guide-collapse': () => { if (mobileMedia.matches) { mobileGuideExpanded = !mobileGuideExpanded; return; } const t = ensureTutorial(game.state); t.collapsed = !t.collapsed; game.save(); },
    'guide-pause': () => { ensureTutorial(game.state).active = null; game.save(); try { localStorage.setItem(TUTORIAL_KEY, '1'); } catch {} toast({text: `Lesson paused. Resume from ${mobileMedia.matches ? 'More' : 'Menu'} → Tutorials.`, kind: 'good'}); },
    'guide-dismiss': () => { guideFinished = null; },
    help: () => helpModal(),
    sheet: () => { $('#panel').classList.toggle('collapsed'); },
    'sheet-expand': () => { $('#panel').classList.remove('collapsed'); $('#panel').classList.toggle('expanded'); },
    'cargo-pane': () => {routePane='fare';render();$('#card-body .route-pane[data-pane="fare"] .freight-card')?.scrollIntoView({block:'start'});},
    'route-pane': (arg) => { routePane = arg; render(); if ($('#card-body')) $('#card-body').scrollTop = 0; },
    hub: (arg) => { hubMenu = false; game.setActive(arg); map.focus(arg, 3); },
    'hub-quiet': (arg) => game.setActive(arg), // switch hub without moving the map
    'finder-sort': (arg) => { finderSort = arg; },
    'finder-clear': () => { finderClear = !finderClear; },
    'finder-new': () => { finderNew = !finderNew; },
    'world-view': () => { coverView = !coverView; map.setCoverView(coverView); },
    // Jump to a contract's airport, with the hub it was offered to as the active one.
    'contract-show': (arg) => {
      const c = game.state.contracts.find((x) => x.id === +arg);
      if (!c) return;
      if (game.isHub(c.hub) && (c.series || !game.state.routes.some((r) => r.dest === c.dest))) game.state.active = c.hub;
      selectAirport(c.dest, true);
    },
    'specialization-route': (arg) => { if (game.route(+arg)) { select({kind: 'route', id: +arg}, true); routePane = 'fare'; } },
    'specialization-open': (hubId) => specializationsModal(hubId),
    'specialization-review': (arg) => { const [hubId, id] = pair(arg); commercialReview = { kind: 'specialization', hubId, id }; specializationModal(); },
    'specialization-apply': () => {
      if (commercialReview?.kind !== 'specialization') return;
      const { hubId, id, revision } = commercialReview;
      const why = game.setSpecialization(hubId, id, revision);
      if (why) { specializationModal(); return why; }
      closeModal();
    },
    'specialization-upgrades': (hubId) => { closeModal(); select(null); game.setActive(hubId); page = null; opsOpen = false; tab = 'airport'; mobileTab = 'more'; $('#panel').classList.remove('collapsed'); },
    'lease-review': (arg) => { const [hubId, typeId, route] = pair(arg); commercialReview = { kind: 'lease', hubId, typeId, routeId: route ? +route : null, days: 14 }; commercialModal(); },
    'lease-term': (arg) => { if (commercialReview?.kind === 'lease') { commercialReview.days = +arg; commercialModal(); } },
    'lease-action': (arg) => { const [action, id] = pair(arg); commercialReview = { kind: 'leaseAction', action, id: +id }; commercialModal(); },
    'service-review': (arg) => { const [routeId, service] = pair(arg); commercialReview = { kind: 'service', routeId: +routeId, service }; commercialModal(); },
    'client-repeat': (clientId) => { commercialReview = { kind: 'repeat', clientId }; commercialModal(); },
    'commercial-apply': () => {
      const r = commercialReview; if (!r) return;
      const why = r.kind === 'lease' ? game.leasePlane(r.typeId, r.hubId, r.days, r.routeId)
        : r.kind === 'service' ? game.setService(r.routeId, r.service)
        : r.kind === 'repeat' ? game.acceptRepeat(r.clientId) : game.leaseAction(r.id, r.action);
      if (why) { commercialModal(); return why; }
      closeModal(); addFor = null;
      if (r.kind === 'lease') select({ kind: 'plane', id: game.state.planes.at(-1).id }, true);
    },
    'contract-yes': (arg) => game.acceptContract(+arg),
    'contract-no': (arg) => game.declineContract(+arg),
    'contract-review-back': () => { if (returnToView()) return; const back = contractReview?.back; contractReview = null; page = back === 'log' ? 'log' : null; if (back === 'ops') opsOpen = true; },
    'contract-review-all': () => { contractReview = null; },
    'attention-filter': (arg) => {
      const group = ATTENTION_GROUPS.find((g) => g.id === arg);
      if (!group) return;
      if(group.view==='campaigns'){if(game.state.campaigns?.active){campaignReview=game.state.campaigns.active;campaignModal();}else {page='goals';opsOpen=false;}}
      else if(group.view==='projects'){projectReview={mode:'list',hubId:opsHub==='all'?null:opsHub,pendingOnly:true};projectModal();}
      else if(group.view==='partnerships') {rememberView();page='rivals';opsOpen=false;}
      else if (group.view === 'contracts') { rememberView(); contractReview = { hub: opsHub, back: 'ops' }; page = 'contracts'; opsOpen = false; }
      else { opsView = group.view; if (opsView === 'routes') { routeFilter = group.filter; routeQuery = ''; } else { fleetFilter = group.filter; fleetQuery = ''; } $('#ops-body').scrollTop = 0; }
    },
    'alert-open': (arg) => {
      const [kind, raw] = pair(arg);
      const target = resolveAlertTarget(game, { target: { kind, id: ['route', 'plane', 'contract', 'partnership'].includes(kind) ? +raw : raw } });
      if (!target) return 'This item is no longer available. Active problems have been refreshed.';
      const fromOps = opsOpen, fromNews = page === 'log';
      navOpen = false; hubMenu = false;
      if (kind === 'route' || kind === 'plane') {
        select({ kind, id: target.id }, true, fromOps);
        if (fromNews) { if (kind === 'route') routeBack = 'log'; else aircraftBack = 'log'; }
      } else if(kind==='campaign'){campaignReview=target.id;campaignModal();}
      else if(kind==='project'){const [hubId,id]=String(target.id).split('/');projectReview={mode:'detail',hubId,id:+id};projectModal();}
      else if(kind==='partnership') {partnershipReview={agreementId:+target.id,action:'view'};partnershipModal();}
      else if (kind === 'contract') {
        rememberView();
        contractReview = { id: target.id, back: fromOps ? 'ops' : 'log' };
        page = 'contracts'; opsOpen = false; $('#page-body').scrollTop = 0;
      } else if (kind === 'airport') selectAirport(target.id, true);
      else { rememberView(); page = target.id; contractReview = null; opsOpen = false; }
    },
    'fleet-sort': (arg) => { fleetSort = arg; },
    'fleet-filter': (arg) => { fleetFilter = arg; },
    'fleet-batch': (arg) => previewFleetBatch(arg, opsHub),
    'aircraft-back': () => { if (returnToView()) return; const back = aircraftBack; select(null); if (back === 'ops') opsOpen = true; else if (back === 'log') page = 'log'; else { tab = back; $('#panel').classList.remove('collapsed'); } },
    'aircraft-picker': (arg) => { const [kind, id] = pair(arg); return showAircraftPicker(kind, +id); },
    'aircraft-choice': (arg) => { const [kind, target] = pair(arg); return previewAircraft({ kind, id: aircraftPicker.id, target: ['type', 'replace'].includes(kind) ? target : +target }, true); },
    'aircraft-choice-back': () => { if (aircraftPicker) showAircraftPicker(aircraftPicker.kind, aircraftPicker.id); },
    'aircraft-park': (arg) => previewAircraft({ kind: 'park', id: +arg }),
    'aircraft-apply': () => {
      if (!aircraftReview) return;
      if (aircraftReview.batch) {
        const { batch, revision } = aircraftReview;
        const why = applyFleetBatch(game, batch.kind, batch.hub, revision);
        if (why) { closeModal(); return why; }
        closeModal(); toast({ text: 'Fleet changes applied', kind: 'good' }); return;
      }
      const { action, revision } = aircraftReview;
      const why = applyAircraftPlan(game, action, revision);
      if (why) {
        const invalid = aircraftPlan(game, action).why;
        if (invalid) { aircraftReview = null; showModal(`<h2>Change unavailable</h2><p>${esc(invalid)}</p><button class="btn wide" data-act="close-modal">Back to game</button>`); }
        else previewAircraft(action, !!aircraftPicker, why);
        return;
      }
      closeModal(); pick = null; addFor = null;
      if (sel?.kind === 'plane' && !game.plane(sel.id)) select(null);
      // These actions already emit their own linked announcement from the game.
      if (!['overhaul', 'replace', 'type'].includes(action.kind)) toast({ text: `${aircraftTitles[action.kind]} applied`, kind: 'good', target: action.kind === 'sell' ? null : { kind: 'plane', id: action.id } });
    },
    ops: (arg) => { backStack.length = 0; navOpen = false; hubMenu = false; opsOpen = true; opsView = 'overview'; opsHub = game.state.hubs.length > 1 && !arg ? 'all' : arg || game.state.active; addFor = null; page = null; sel = null; contractReview = null; map.setSelected(null); $('#ops-body').scrollTop = 0; },
    'ops-close': () => { if (!returnToView()) { opsOpen = false; addFor = null; if (mobileMedia.matches) mobileNavigate('map'); } },
    'ops-view': (arg) => { opsView = arg; $('#ops-body').scrollTop = 0; },
    autofit: (arg) => autoFitModal(arg),
    'autofit-apply': (arg) => { const why = game.applyAutoFit(arg); closeModal(); pick = null; return why; },
    // One-click fixes offered on a route's card.
    suggest: (arg) => { const [kind, a, b] = pair(arg); return previewAircraft({ kind, id: +a, target: kind === 'type' ? b : +b }); },
    // From an aircraft's card: pick it up and show its hub's routes so it can be moved or swapped.
    'plane-pick': (arg) => showAircraftPicker('move', +arg),
    'ops-hub': (arg) => { opsHub = arg; },
    'ops-sort': (arg) => { opsSort = arg; },
    'route-filter': (arg) => { routeFilter = arg; },
    'ops-add': (arg) => {
      addFor = addFor === +arg ? null : +arg;
      if (cardRouteId() === +arg) { routePane = 'aircraft'; render(); $('#card-body')?.querySelector('.ops-add')?.scrollIntoView({ block: 'nearest' }); }
    },
    // Legacy action aliases also inspect or preview; none apply a change directly.
    'ops-pick': (arg) => select({ kind: 'plane', id: +arg }),
    'ops-move': (arg) => previewAircraft({ kind: 'move', id: pick, target: +arg }),
    'ops-park': () => previewAircraft({ kind: 'park', id: pick }),
    'ops-sell': () => previewAircraft({ kind: 'sell', id: pick }),
    'ops-type': (arg) => previewAircraft({ kind: 'type', id: pick, target: arg }),
    'ops-assign': (arg) => { const [p, r] = pair(arg); return previewAircraft({ kind: 'move', id: +p, target: +r }); },
    'ops-buy': (arg) => { const [r, t, used] = pair(arg); const why = game.buyFor(+r, t, used === '1'); if (!why) addFor = null; return why; },
    'ops-route': (arg) => { if (game.route(+arg)) select({ kind: 'route', id: +arg }, true, true); },
    takeover: (arg) => {
      const rv = game.rival(+arg); if (!rv?.hub) return 'That airline is gone';
      const why = game.whyNotTakeover(rv.id), cost = game.takeoverCost(rv), leased=rv.routes.filter((r)=>r.lease).length;
      showModal(`<div class="eyebrow">Review takeover</div><h2>${esc(rv.name)}</h2><p>Acquire hubs at <strong>${rivalHubIds(rv).join(', ')}</strong>, with ${plural(rv.routes.length, 'route')}, ${rv.routes.length-leased} owned and ${leased} leased aircraft. Hub roles, facilities, service policies and lease terms carry over. Existing links keep your settings; aircraft that need a different base stay parked for assignment.</p>${kv('Purchase price', fmtMoney(cost))}${leased ? kv('Lease rent still committed',fmtMoney(rivalLeaseCommitment(rv,game.state.minute)),'mono amber') : ''}${kv('Cash remaining', fmtMoney(game.state.money - cost))}<div class="note">${why || 'Before goal rewards. The price settles the old airline’s debt and accrued lease rent. Future lease rent remains payable; its cash reserves do not transfer separately.'}</div><div class="card-actions"><button class="btn ghost" data-act="close-modal">Cancel</button><button class="btn" data-act="takeover-confirm" data-arg="${rv.id}" ${why ? 'disabled' : ''}>Buy airline</button></div>`);
    },
    'takeover-confirm': (arg) => { const rv = game.rival(+arg), base = rv?.hub; const why = game.takeover(+arg); if (!why) { closeModal(); page = null; selectAirport(base, true); } return why; },
    'tip-ok': (arg) => { game.state.tips.push(arg); },
    'tip-go': (arg) => {
      const t = TIPS.find((x) => x.id === arg);
      game.state.tips.push(arg);
      if (t.go === 'aircraft') { actions.ops(''); opsView = 'aircraft'; } else if (TABS.some(([id]) => id === t.go)) actions.tab(t.go); else actions.page(t.go);
    },
    diff: (arg) => { diff = arg; try { localStorage.setItem(DIFF_KEY, arg); } catch { /* ignore */ } },
    replace: (arg) => previewAircraft({ kind: 'replace', id: +arg }),
    'lock-fuel': () => game.lockFuel(),
    list: () => game.listCompany(),
    report: () => { if (game.state.report) reportModal(game.state.report); },
    'report-route': (arg) => { closeModal(); if (game.route(+arg)) select({ kind: 'route', id: +arg }, true); },
    'weekly-toggle': () => {
      weeklyOff = !weeklyOff;
      try { localStorage.setItem(WEEKLY_KEY, weeklyOff ? '1' : '0'); } catch { /* ignore */ }
      closeModal();
    },
    'profit-view': () => { profitView = !profitView; map.setProfitView(profitView); },
    'hub-menu': () => { hubMenu = !hubMenu; navOpen = false; },
    upgrade: (arg) => game.upgrade(arg),
    buy: (arg) => game.buyPlane(arg),
    'buy-used': (arg) => game.buyPlane(arg, true),
    sell: (arg) => previewAircraft({ kind: 'sell', id: +arg }),
    overhaul: (arg) => previewAircraft({ kind: 'overhaul', id: +arg }),
    'open-route': (arg) => startLaunch(arg),
    'launch-choice': (arg) => {
      if (!launch) return;
      const [mode, value] = pair(arg);
      launch.choice = mode === 'none' ? { mode } : mode === 'parked' ? { mode, planeId: +value } : { mode, typeId: value, ...(mode === 'lease' ? { days: launch.choice.days || 14 } : {}) };
      launchModal();
    },
    'launch-lease-term': (arg) => { if (launch?.choice.mode === 'lease') { launch.choice.days = +arg; launchModal(); } },
    'launch-review': () => { if (launch) { launch.step = 'review'; launchModal(); } },
    'launch-back': () => { if (launch) { launch.step = 'aircraft'; launchModal(); } },
    'launch-confirm': () => {
      if (!launch) return;
      const { hub, dest, choice } = launch;
      const why = game.launchRoute(hub, dest, choice);
      if (why) { launchModal(); return why; }
      closeModal(); tab = 'routes'; routeFilter = 'all'; addFor = null; routeBack = false;
      select({ kind: 'route', id: game.routeTo(hub, dest).id }, true);
    },
    'back-routes': () => { if (returnToView()) return; const back = routeBack; select(null); tab = 'routes'; $('#panel').classList.remove('collapsed'); if (back === 'log') page = 'log'; else if (back) opsOpen = true; },
    'close-route': id => {cargoReview={action:'close',id:+id};cargoModal();},
    'buy-hub': (arg) => {
      const why = game.buyHub(arg);
      if (!why) selectAirport(arg);
      return why;
    },
    'assign-idle': (arg) => {
      const r = game.route(+arg);
      const p = game.state.planes.find((x) => x.hub === r.hub && x.routeId == null && AIRCRAFT[x.type].range >= r.km);
      if (p) return previewAircraft({ kind: 'move', id: p.id, target: r.id });
    },
    price: (arg) => { const [id, d] = pair(arg); game.setPrice(+id, +d); },
    cabin: (arg) => { const [id, c] = pair(arg); game.setCabin(+id, +c); },
    borrow: (arg) => game.borrow(+arg),
    repay: (arg) => game.repay(+arg),
    stake: () => game.sellStake(),
    hedge: (arg) => game.hedge(+arg),
    settle: (arg) => game.settle(+arg),
    'settle-now': (arg) => { const why = game.settle(+arg); if (!why) closeModal(); return why; },
    'cal-day': (arg) => { calDay = arg === '' ? null : +arg; },
    'cal-month': (arg) => { calMonth = (calMonth ?? Math.floor(game.state.day / 30)) + +arg; calDay = null; },
    select: (arg) => selectAirport(arg, true),
    'select-route': (arg) => { if (game.route(+arg)) select({ kind: 'route', id: +arg }, true, opsOpen); },
    'select-plane': (arg) => select({ kind: 'plane', id: +arg }),
    'close-card': () => { if (!returnToView()) select(null); },
    'close-modal': () => closeModal(),
    view: (arg) => { hubMenu = false; openView(arg); },
    'close-view': () => { view.close(); $('#view').hidden = true; },
    speed: (arg) => game.setSpeed(+arg),
    'toggle-pause': () => game.setSpeed(game.state.speed ? 0 : resumeSpeed),
    'compact-speed': (arg) => { resumeSpeed = +arg; if (game.state.speed) game.setSpeed(resumeSpeed); },
    zoom: (arg) => (arg === 'fit' ? map.fit() : map.zoomBy(arg === 'in' ? 1.6 : 1 / 1.6)),
    mute: () => { audio.toggle(); },
    'map-mode': () => { map.setMode(map.getMode() === 'globe' ? 'flat' : 'globe'); mobileTools = false; },
    share: () => share(),
    mode: (arg) => {
      const sc = SCENARIOS.find((x) => x.id === arg);
      const home = arg === 'daily' ? game.dailyHome().id : sc.home;
      if (home) startGame(home, arg);
      else pendingMode = arg;
    },
    'mode-back': () => { pendingMode = null; select(null); },
    found: (arg) => startGame(arg, pendingMode || 'free'),
    bailout: () => { const why = game.bailout(); if (!why) { closeModal(); game.setSpeed(1); } return why; },
    'keep-playing': () => { game.keepPlaying(); closeModal(); game.setSpeed(1); },
    restart: () => { closeModal(); backStack.length = 0; game.reset(); select(null); map.fit(); },
    'new-game': () => {
      if (!confirm('Start over? Your current airports will be erased.')) return;
      game.reset(); select(null); map.fit();
    },
  };

  document.addEventListener('click', (e) => {
    if (e.target.id === 'view') { actions['close-view'](); return; }
    const el = e.target.closest('[data-act]');
    if (hubMenu && !e.target.closest('#hub-menu') && el?.dataset.act !== 'hub-menu') { hubMenu = false; if (!el) render(); }
    if (navOpen && !e.target.closest('#nav-menu') && el?.dataset.act !== 'nav') { navOpen = false; if (!el) render(); }
    if (!el || el.tagName === 'SELECT' || el.disabled) return;
    audio.play('click');
    const why = actions[el.dataset.act]?.(el.dataset.arg);
    if (typeof why === 'string') toast({ text: why, kind: 'bad' });
    render();
  });
  document.addEventListener('change', (e) => {
    const control = e.target.closest('select[data-act="route-filter"], select[data-act="ops-sort"], select[data-act="fleet-sort"], select[data-act="mobile-fleet-hub"], select[data-act="fleet-filter"], select[data-act="compact-speed"], select[data-act="finder-market"], select[data-act="response-route"], select[data-act="response-plane"], select[data-act="response-type"]');
    if (control) { actions[control.dataset.act](control.value); control.blur(); render(); return; }
    const el = e.target.closest('select[data-act="assign"]');
    if (!el) return;
    const why = previewAircraft({ kind: el.value ? 'move' : 'park', id: +el.dataset.arg, target: el.value ? +el.value : null });
    if (why) toast({ text: why, kind: 'bad' });
    el.blur();
    render();
  });
  document.addEventListener('input', (e) => {
    if(e.target.matches('[data-company-name]') && companyReview){companyReview.name=e.target.value;$('#company-preview-name').textContent=e.target.value || 'Your airline';$('#company-error').textContent='';e.target.removeAttribute('aria-invalid');return;}
    const key = e.target.dataset.search;
    if (!key) return;
    if (key === 'network') { networkQuery = e.target.value; setHTML($('#network-results'), networkResultsHTML()); return; }
    if (key === 'routes') routeQuery = e.target.value;
    if (key === 'fleet') fleetQuery = e.target.value;
    if (key === 'finder') finderQuery = e.target.value;
    render();
  });
  document.addEventListener('keydown', (e) => {
    if (companyReview && e.key==='Enter' && e.target.matches('[data-company-name]') && !e.isComposing) { e.preventDefault(); actions['company-save'](); render(); return; }
    if (e.key === 'Escape') hideTip();
    if (!modal && (navOpen || hubMenu) && e.key === 'Escape') {
      e.preventDefault(); const trigger = navOpen ? $('#nav-toggle') : $('.hud-airport');
      navOpen = false; hubMenu = false; render(); trigger.focus(); return;
    }
    if (navOpen && e.target.closest('#nav-menu') && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); const buttons = [...$('#nav-menu').querySelectorAll('button')], i = buttons.indexOf(document.activeElement);
      buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); return;
    }
    if (searchOpen && ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
      const results = [...$('#network-results').querySelectorAll('button')];
      if (e.target.tagName === 'INPUT' && e.key === 'Enter') { e.preventDefault(); results[0]?.click(); return; }
      if (e.key !== 'Enter') {
        e.preventDefault(); const index = results.indexOf(document.activeElement);
        if (e.key === 'ArrowUp' && index <= 0) $('#modal-box input').focus();
        else results[Math.max(0, Math.min(results.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
        return;
      }
    }
    if (modal && e.key === 'Tab') {
      const buttons = [...$('#modal').querySelectorAll('button:not(:disabled), select, input, [tabindex="0"]')].filter((el) => el.getClientRects().length);
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (e.shiftKey && (document.activeElement === first || !$('#modal').contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !$('#modal').contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
      return;
    }
    if (e.key === 'Escape' && modal && !game.state?.over) { closeModal(); render(); return; }
    if (!game.state || modal || e.target.closest('input, textarea, select, [contenteditable="true"]') || e.metaKey || e.ctrlKey) return;
    if ([' ', 'Enter'].includes(e.key) && e.target.closest('button, summary, a')) return;
    if (e.key === '/') { e.preventDefault(); openNetworkSearch(); return; }
    if (e.code === 'Space') { e.preventDefault(); actions['toggle-pause'](); }
    else if (e.key >= '1' && e.key <= '3') game.setSpeed(SPEEDS[+e.key]);
    else if (KEY_PAGES[e.key.toLowerCase()] && !e.altKey) { actions.page(KEY_PAGES[e.key.toLowerCase()]); render(); }
    else if (e.key.toLowerCase() === 'o') { if (opsOpen) actions['ops-close'](); else actions.ops(''); render(); }
    else if (e.key === 'Escape' && (opsOpen || pick != null)) { if (pick != null) pick = null; else actions['ops-close'](); render(); }
    else if (e.key.toLowerCase() === 'a') { actions.ops(''); opsView = 'aircraft'; render(); }
    else if (e.key.toLowerCase() === 'p') { actions['profit-view'](); render(); }
    else if (e.key.toLowerCase() === 'w') { actions['world-view'](); render(); }
    else if (e.key.toLowerCase() === 'e') { actions['map-mode'](); render(); }
    else if (e.key.toLowerCase() === 's') { toast({ text: audio.toggle() ? 'Sound off' : 'Sound on' }); render(); }
    else if (e.key.toLowerCase() === 'h' || e.key === '?') helpModal();
    else if (e.key === 'Escape' && page) { actions['close-page'](); render(); }
    else if (e.key === 'Escape') { if (!$('#view').hidden) actions['close-view'](); else actions['close-card'](); render(); }
  });

  window.addEventListener('resize', render);
  pwa.subscribe(() => {
    render();
    if (modal && $('#modal-box [data-pwa-panel]')) appModal();
  });
  mobileMedia.addEventListener('change', e => {
    if (!e.matches && mobilePreview) { sel = mobilePreview; mobilePreview = null; map.setSelected(sel); }
    render();
    if (e.matches && game.state && !page && !sel && !opsOpen && mobileTab === 'map') map.focus(game.state.active, 3);
  });
  game.on('toast', toast);
  game.on('change', render);
  game.on('choice', strikeModal);
  game.on('over', () => render());
  game.on('listed', (l) => { listedModal(l); render(); });
  game.on('report', (r) => {
    if (weeklyOff || modal || game.state.over) { toast({ text: `Week closed · ${fmtSigned(r.profit)}. The report is in News`, kind: r.profit >= 0 ? 'good' : 'bad' }); return; }
    audio.play('report');
    reportModal(r);
  });
  game.on('depart', ({ at, plane }) => view.notify('depart', at, plane));
  game.on('land', ({ at, from, net, pax, plane }) => {
    map.addFloat(at, fmtSigned(net), net >= 0);
    view.notify('land', at, plane);
    audio.play('land');
    board.unshift(`<div class="line"><span>${from} ▸ ${at}</span><span>${pax} pax</span><span class="${signCls(net)}">${fmtSigned(net)}</span></div>`);
    if (board.length > 4) board.pop();
    $('#board').hidden = false;
    setHTML($('#board'), `<div class="hd">Latest arrivals</div>${board.join('')}`);
  });

  // Drag an aircraft chip onto a route to move it there, onto another chip to swap, onto Parked to park it.
  let dropEl = null;
  const dropTarget = (e) => e.target.closest?.('[data-plane], [data-drop-route], [data-drop-park]');
  const clearDrop = () => { dropEl?.classList.remove('drop-ok'); dropEl = null; };
  document.addEventListener('dragstart', (e) => {
    const el = e.target.closest?.('[data-plane]');
    if (!el) return;
    dragging = +el.dataset.plane;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragging));
    hideTip();
    document.body.classList.add('dragging-plane');
  });
  document.addEventListener('dragover', (e) => {
    if (dragging == null) return;
    const el = dropTarget(e);
    if (el === dropEl) { if (el) e.preventDefault(); return; }
    clearDrop();
    if (!el || +el.dataset.plane === dragging) return;
    e.preventDefault();
    dropEl = el; el.classList.add('drop-ok');
  });
  document.addEventListener('drop', (e) => {
    if (dragging == null) return;
    const el = dropTarget(e);
    const id = dragging;
    e.preventDefault();
    let why = null;
    if (el?.dataset.plane != null) { if (+el.dataset.plane !== id) why = previewAircraft({ kind: 'swap', id, target: +el.dataset.plane }); }
    else if (el?.dataset.dropRoute != null) { if (game.plane(id)?.routeId !== +el.dataset.dropRoute) why = previewAircraft({ kind: 'move', id, target: +el.dataset.dropRoute }); }
    else if (el?.dataset.dropPark != null) why = game.plane(id)?.hub === el.dataset.dropPark ? previewAircraft({ kind: 'park', id }) : 'It can only be parked at its own hub';
    if (typeof why === 'string') toast({ text: why, kind: 'bad' });
    else if (el) { audio.play('click'); pick = null; }
  });
  document.addEventListener('dragend', () => {
    dragging = null; clearDrop();
    document.body.classList.remove('dragging-plane');
    render();
  });

  // Icons have accessible names; extra explanations appear on hover and keyboard focus.
  const tipBox = $('#tip');
  let tipFor = null;
  const mouse = { x: -1, y: -1 };
  function showTip(el) {
    if (!el.getClientRects().length) return;
    if (tipFor && tipFor !== el) tipFor.removeAttribute('aria-describedby');
    tipFor = el;
    el.setAttribute('aria-describedby', 'tip');
    tipBox.textContent = el.dataset.tip;
    tipBox.hidden = false;
    const r = el.getBoundingClientRect(), w = tipBox.offsetWidth, h = tipBox.offsetHeight;
    const x = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
    const y = r.bottom + 8 + h > window.innerHeight - 8 ? r.top - h - 8 : r.bottom + 8;
    tipBox.style.left = `${x}px`;
    tipBox.style.top = `${Math.max(8, y)}px`;
  }
  function hideTip() { tipFor?.removeAttribute('aria-describedby'); tipFor = null; tipBox.hidden = true; }
  // The panels are redrawn about once a second; keep the tip up if the pointer is still on something that has one.
  function refreshTip() {
    if (!tipFor || tipFor.isConnected) return;
    const focused = document.activeElement?.matches(':focus-visible') && document.activeElement.closest('[data-tip]');
    const el = focused || (mouse.x >= 0 ? document.elementFromPoint(mouse.x, mouse.y)?.closest('[data-tip]') : null);
    if (el) showTip(el); else hideTip();
  }
  document.addEventListener('mouseover', (e) => {
    if (e.sourceCapabilities?.firesTouchEvents) return;
    mouse.x = e.clientX; mouse.y = e.clientY;
    const el = e.target.closest?.('[data-tip]');
    if (el) { if (el !== tipFor) showTip(el); } else if (tipFor) hideTip();
  });
  document.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (el && e.target.matches(':focus-visible')) showTip(el);
  });
  document.addEventListener('focusout', (e) => { if (tipFor?.contains(e.target)) hideTip(); });
  document.addEventListener('pointerdown', hideTip, { passive: true });
  document.addEventListener('scroll', hideTip, { capture: true, passive: true });
  document.addEventListener('touchstart', (e) => { if (!e.target.closest?.('[data-tip]')) hideTip(); }, { passive: true });

  const tip = $('#tooltip');
  function hover(a, x, y) {
    if (!a) { tip.hidden = true; return; }
    const s = game.state;
    let extra = '';
    if (s) {
      const rival = game.rivalAt(a.id);
      extra = game.isHub(a.id) ? ' · your hub' : ` · ${km(distKm(AIRPORT_BY_ID[s.active], a))}${rival ? ` · ${rival.name}` : ''}`;
    }
    tip.innerHTML = `<b>${a.id}</b>${esc(a.city)}${extra}`;
    tip.hidden = false;
    tip.style.left = `${Math.min(x + 14, window.innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${y + 16}px`;
  }

  let lastSlow = 0;
  return {
    select: selectFromMap, hover, render, offlineModal,
    // Called every frame: cheap HUD refresh often, full panel refresh about once a second.
    frame(now) {
      if (now - lastSlow > 1000) { lastSlow = now; render(); } else hud();
    },
  };
}
