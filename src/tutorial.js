// Save-backed guidance. Lessons observe play; they never buy, assign or change policy.
const step = (title, text, go, label) => ({ title, text, go, label });
export const LESSONS = [
  { id: 'first-flight', title: 'Your first flight', summary: 'Choose a destination, review the cost, launch and see your first result.', steps: [
    step('Build your first connection', 'We’ll launch one staffed route together. You choose every purchase. The guide stays with you on each screen; collapse it whenever you need more room.'),
    step('Choose a nearby destination', 'Open Route finder and compare demand, distance and estimated profit. Choose Plan route on an affordable nearby city. You can also select an airport on the map.', 'finder', 'Find a destination'),
    step('Choose an aircraft', 'Compare a new aircraft, a cheaper used one, a lease or a parked aircraft. Check range, daily costs and the cash left after launch. Choose Review launch when ready.', 'aircraft-choice', 'Continue planning'),
    step('Review, then launch', 'Check the full starting cost and daily estimate. Estimates exclude airport overhead and interest. Launch route confirms your purchase and assigns the aircraft.', 'launch', 'Review your route'),
    step('Let your aircraft land', 'Aircraft board passengers, fly and earn revenue on landing. Run time to see it happen. If service is held up, inspect the aircraft or check Operations.', 'watch', 'Watch the route'),
    step('Read your first results', 'Your first landing earned revenue. Open the route overview to see capacity and service. Profit and load figures appear after the first full day closes; Operations → Results compares later changes.', 'route-overview', 'Open route results'),
  ] },
  { id: 'service', title: 'Passengers, fares & service', requires: 'route', summary: 'Match the offer to the people who want to fly.', steps: [
    step('Read the passenger mix', 'Business, leisure, connecting and charter travelers respond differently to price and frequency. In Fare & cabin, compare your mix with the destination’s airport characteristics.', 'route-fare', 'Open passenger mix'),
    step('Balance price and capacity', 'Lower fares attract more passengers; business seats use the space of two economy seats. Frequent service shortens waits. Change one thing at a time, then allow full days for a useful comparison.', 'route-fare', 'Open fare & service'),
    step('Compare the outcome', 'Results compares three full days before and after a management change. A fresh change needs time; no data yet is different from a loss.', 'results', 'Open Results'),
  ] },
  { id: 'operations', title: 'Operations & attention', summary: 'Find problems, understand warnings and follow them to a fix.', steps: [
    step('Start with needs attention', 'Operations groups route, fleet, contract and network problems. Open an alert to inspect the affected item. Resolved issues leave this list automatically.', 'operations', 'Open Operations'),
    step('Read the route warning', 'Route filters narrow the list to problems. “Too many seats” means capacity exceeds demand: inspect the suggested smaller aircraft, move or fare change before acting.', 'ops-routes', 'Open route filters'),
  ] },
  { id: 'fleet', title: 'Aircraft & fleet management', requires: 'plane', summary: 'Inspect, move, swap and maintain aircraft with previews.', steps: [
    step('Inspect an aircraft', 'An aircraft’s card shows its assignment, age, upkeep and repair risk. Move, swap, park, overhaul and replacement actions show a review before you apply them.', 'plane', 'Inspect an aircraft'),
    step('Find aircraft needing attention', 'Use fleet filters for parked, losing or worn aircraft. A move must fit the destination route’s range and the hub’s runway and gates. Review both routes when swapping.', 'ops-fleet', 'Open fleet filters'),
  ] },
  { id: 'finance', title: 'Cash, fuel & financing', summary: 'Understand daily bills and the costs of borrowing.', steps: [
    step('Read a settled day', 'Today’s running income excludes bills charged at midnight. Finance separates airport upkeep, aircraft maintenance, rent and interest. Keep a cash reserve for these bills.', 'finance', 'Open Finance'),
    step('Choose financing carefully', 'Loans charge daily interest. Investors take a permanent share of profitable days. A fuel lock fixes fuel prices for 30 days for a fee. Review the terms before committing.', 'finance', 'Review financing'),
  ] },
  { id: 'airports', title: 'Hubs, upgrades & roles', summary: 'Grow capacity and choose a purpose for each hub.', steps: [
    step('Upgrade the limiting facility', 'Runways unlock aircraft; terminals add route capacity; gates add aircraft capacity. Facilities also add daily upkeep. Regional Airport rank unlocks expansion to another hub.', 'upgrades', 'Open Upgrades'),
    step('Choose a hub role', 'Budget, Premium, Transfer and Cargo roles reward different networks. Review requirements, fees, tradeoffs and the 14-day commitment before adopting a specialization.', 'roles', 'Review hub roles'),
  ] },
  { id: 'projects', title: 'Airport construction', summary: 'Plan larger improvements and budget for each stage.', steps: [
    step('Compare projects', 'Concourse, turnaround, freight and solar projects improve different parts of a hub. Each hub has two project sites and can build one project at a time.', 'projects', 'Open airport projects'),
    step('Plan the stage payments', 'Payments are split 25%, 50% and 25%. Work pauses until you fund the next stage. Operations flags pending payments; completed projects may add running costs.', 'projects', 'Review project stages'),
  ] },
  { id: 'disruptions', title: 'Disruption management', summary: 'Respond to closures, repairs and threatened deadlines.', steps: [
    step('See what is affected', 'Review responses groups disruptions and threatened contracts with their affected routes. During a quiet period this list can be empty; Calendar helps you prepare for known events.', 'responses', 'Review responses'),
    step('Choose the right response', 'When an incident is active, compare waiting, temporary aircraft moves, short leases or service changes. Compensation helps reputation but does not restore capacity. Preview costs and the return plan before applying.', 'responses', 'Open response plans'),
    step('Prepare before the event', 'Check upcoming storms, strikes, festivals and fuel spikes. Capacity, deadlines and cash reserves matter more than reacting to every alert immediately.', 'calendar', 'Open Calendar'),
  ] },
  { id: 'connections', title: 'Connecting journeys', requires: 'route', summary: 'Build useful two-leg journeys with seats on both flights.', steps: [
    step('Read your connection traffic', 'The route overview shows connecting journeys. A useful connection needs two staffed legs, available seats and open airports. A route on the map alone supplies no capacity.', 'route-overview', 'Open connections'),
    step('Design a useful network', 'Connect complementary destinations through a hub. Transfer time and frequency affect whether people reach the onward flight; long waits can miss the deadline. Connections share seats with local passengers.', 'finder', 'Explore another destination'),
  ] },
  { id: 'partnerships', title: 'Rivals & partnerships', summary: 'Understand competition and shared connecting traffic.', steps: [
    step('Know the competing airline', 'Rivals manage their own cash, aircraft and hubs. Compare their footprint, fares and financial health before entering a crowded market or considering a takeover.', 'rivals', 'Open Rivals'),
    step('Review an agreement', 'Partnerships last 28 days and share connecting traffic and revenue. You can hold two at once. Compare agreement terms and capacity before signing; renewals and problems appear in Operations.', 'rivals', 'Review partnerships'),
  ] },
  { id: 'freight', title: 'Freight & delivery deadlines', summary: 'Use belly cargo or dedicated freighters on suitable markets.', steps: [
    step('Prepare the hub', 'A cargo terminal supports freight. Passenger aircraft can carry belly cargo; dedicated freighters use their holds for freight. Airport characteristics affect the available market.', 'upgrades', 'Find cargo upgrades'),
    step('Plan a freight route', 'Switch Route finder to Freight to compare markets. Bulk waits for a fuller hold and has a longer delivery window; Express trades speed for stricter deadlines. Freight earns revenue on actual delivery.', 'freight-finder', 'Explore freight markets'),
    step('Review the fleet choices', 'The freighter shop shows prices, range and capacity. Eligible passenger aircraft can also be converted from their aircraft card, taking two days out of service. Check a route’s queues before changing service.', 'freighter-shop', 'View freighters'),
  ] },
  { id: 'contracts', title: 'Contracts & repeat clients', summary: 'Accept commitments your network can actually deliver.', steps: [
    step('Check the job before signing', 'Contracts specify an airport, volume, deadline and reward. Check aircraft capacity and disruptions first. Missing the target costs reputation, even if the route itself is profitable.', 'contracts', 'Open Contracts'),
    step('Protect the deadline', 'Progress counts actual deliveries. Repeat-client agreements have separate weekly targets across three weeks. Operations flags deadlines that need attention and links to responses.', 'operations', 'Check deadline alerts'),
  ] },
  { id: 'campaigns', title: 'Goals & optional campaigns', summary: 'Work toward rewards and longer network challenges.', steps: [
    step('Use goals to guide growth', 'Goals pay cash for milestones. Optional campaigns in free play offer three chapters each: regional service, freight or worldwide connections. Scenario games keep their own objectives.', 'goals', 'Open Goals & campaigns'),
    step('Read the chapter conditions', 'Only one campaign is active at a time. Existing network assets can count; delivery totals start fresh for each chapter. Claim ready rewards here or from Operations. Pausing preserves rewards but resets a profitable-day streak.', 'goals', 'Explore campaign chapters'),
  ] },
  { id: 'company', title: 'Your airline & history', summary: 'Name the company, track records and revisit milestones.', steps: [
    step('Make the airline yours', 'Company lets you set an airline name and color. Individual aircraft can be renamed from their inspection card while keeping a stable registration for search.', 'company', 'Open Company'),
    step('Follow your history', 'History records major milestones and records. Links open the relevant route, hub, project or campaign when it is still available. Back returns to your place in the history list.', 'history', 'Open company history'),
  ] },
];
export const LESSON_BY_ID = Object.fromEntries(LESSONS.map(lesson => [lesson.id, lesson]));

export function ensureTutorial(s) {
  if (s.tutorial?.version === 2) return s.tutorial;
  const legacy = Number.isInteger(s.tut) && s.tut >= 0;
  s.tutorial = { version: 2, active: legacy ? 'first-flight' : null, progress: {}, completed: [], collapsed: false };
  if (legacy) s.tutorial.progress['first-flight'] = { step: s.tut >= 5 && s.flights > 0 ? 5 : 0 };
  s.tut = null;
  return s.tutorial;
}

export function lessonWhy(s, lesson) {
  if (lesson.requires === 'route' && !s.routes.length) return 'Open a route first. The first-flight walkthrough will help.';
  if (lesson.requires === 'plane' && !s.planes.length) return 'Add an aircraft first. The first-flight walkthrough will help.';
  return null;
}

export function startLesson(s, id, replay = false) {
  const lesson = LESSON_BY_ID[id];
  if (!lesson || lessonWhy(s, lesson)) return false;
  const t = ensureTutorial(s);
  if (replay || !t.progress[id]) t.progress[id] = { step: 0 };
  t.active = id; t.collapsed = false;
  return true;
}

export function tutorialRoute(s) {
  const run = ensureTutorial(s).progress['first-flight'];
  return s.routes.find(r => r.id === run?.routeId) || s.routes.find(r => r.hub === s.active) || s.routes[0];
}

export function currentLesson(s) {
  const t = ensureTutorial(s), lesson = LESSON_BY_ID[t.active];
  if (!lesson) { t.active = null; return null; }
  const run = t.progress[lesson.id] ||= { step: 0 };
  run.step = Math.max(0, Math.min(lesson.steps.length - 1, Math.trunc(run.step) || 0));
  return { lesson, run, step: lesson.steps[run.step] };
}

// Return true only on a progress transition, so the UI saves without writing every frame.
export function observeTutorial(s, context = {}) {
  const current = currentLesson(s);
  if (!current) return false;
  const { lesson, run } = current;
  const before = JSON.stringify(run);
  if (lesson.id === 'first-flight') {
    const route = s.routes.find(r => r.id === context.routeId) || tutorialRoute(s);
    if (route && run.routeId !== route.id) {
      run.routeId = route.id; run.landed = false;
      if (run.step >= 4) { run.step = 4; run.seen = false; }
    }
    if (route && (route.today?.flights > 0 || route.yesterday?.flights > 0 || s.company?.timeline?.some(e => e.key === 'first-flight' && e.target?.id === route.id))) run.landed = true;
    const staffed = route && s.planes.some(p => p.routeId === route.id);
    // Recover if a route or its only aircraft was removed while the guide was paused.
    if (run.step > 1 && !route && !context.launch) run.step = 1;
    if (run.step > 2 && route && !staffed && !run.landed) run.step = 2;
    while (run.step > 0 && run.step < 5) {
      const done = [false, !!context.launch || !!route, staffed || context.launch === 'review' && context.launchStaffed, staffed, !!run.landed][run.step];
      if (!done) break;
      run.step++; run.seen = false;
    }
  }
  if (lesson.steps[run.step].go && context.at?.(lesson.steps[run.step].go)) run.seen = true;
  return before !== JSON.stringify(run);
}

export function canAdvanceLesson(s) {
  const current = currentLesson(s);
  if (!current) return false;
  return current.lesson.id === 'first-flight' ? current.run.step === 0 || current.run.step === 5 && !!current.run.seen : !!current.run.seen;
}

export function nextLessonStep(s) {
  if (!canAdvanceLesson(s)) return false;
  const t = ensureTutorial(s), { lesson, run } = currentLesson(s);
  if (run.step === lesson.steps.length - 1) {
    if (!t.completed.includes(lesson.id)) t.completed.push(lesson.id);
    t.active = null;
    delete t.progress[lesson.id];
  } else { run.step++; run.seen = false; }
  return true;
}
