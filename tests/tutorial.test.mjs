import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LESSONS, ensureTutorial, startLesson, currentLesson, observeTutorial, nextLessonStep, lessonWhy } from '../src/tutorial.js';
const store = new Map();
globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
const { game } = await import('../src/game.js');
game.silent = true;
let s;
beforeEach(() => { store.clear(); game.newGame('LHR'); s = game.state; s.events = []; s.eventsUntil = 1e9; s.rivals = []; s.rng = 12345; });
const run = () => currentLesson(s).run;
const begin = () => { startLesson(s, 'first-flight'); nextLessonStep(s); };
const route = () => game.addRoute('LHR', 'CDG');

test('first flight advances through review, staffed launch and a real landing', () => {
  begin(); assert.equal(run().step, 1);
  observeTutorial(s, {launch: 'aircraft'}); assert.equal(run().step, 2);
  observeTutorial(s, {launch: 'review', launchStaffed: true}); assert.equal(run().step, 3);
  assert.equal(game.launchRoute('LHR', 'CDG', {mode: 'new', typeId: 'sparrow'}), null);
  observeTutorial(s); assert.equal(run().step, 4);
  assert.equal(nextLessonStep(s), false);
  while (!s.flights && s.minute < 1440) game.tick(10);
  assert.ok(s.flights > 0);
  observeTutorial(s); assert.equal(run().step, 5);
  assert.equal(nextLessonStep(s), false);
  observeTutorial(s, {at: go => go === 'route-overview'});
  assert.equal(nextLessonStep(s), true);
  assert.equal(s.tutorial.active, null);
  assert.deepEqual(s.tutorial.completed, ['first-flight']);
});

test('an empty route and an unrelated parked aircraft do not count as staffed', () => {
  begin(); const r = route(); game.createPlane('sparrow', false, 'LHR');
  observeTutorial(s); assert.equal(run().step, 2);
  observeTutorial(s, {launch: 'review', launchStaffed: false}); assert.equal(run().step, 2);
  game.assign(s.planes[0].id, r.id, true);
  observeTutorial(s); assert.equal(run().step, 4);
});

test('another route landing does not finish the guided flight', () => {
  begin(); const r = route(); game.assign(game.createPlane('sparrow', false, 'LHR').id, r.id, true);
  observeTutorial(s);
  const other = game.addRoute('LHR', 'AMS'); other.today.flights = 1; s.flights = 1;
  observeTutorial(s); assert.equal(run().step, 4);
});

test('launching a different route follows that launch instead of an earlier empty route', () => {
  begin(); route(); observeTutorial(s);
  const chosen = game.addRoute('LHR', 'AMS'); game.assign(game.createPlane('sparrow', false, 'LHR').id, chosen.id, true);
  observeTutorial(s, {launch:'review', launchStaffed:true, routeId:chosen.id});
  assert.equal(run().routeId, chosen.id); assert.equal(run().step, 4);
});

test('replacing the finished route does not incorrectly count a new route as flown', () => {
  begin(); const old = route(); old.today.flights = 1; game.assign(game.createPlane('sparrow', false, 'LHR').id, old.id, true);
  observeTutorial(s); assert.equal(run().step, 5);
  game.closeRoute(old.id);
  const replacement = route(); game.assign(s.planes[0].id, replacement.id, true);
  observeTutorial(s, {at:()=>true}); assert.equal(run().step, 4); assert.equal(nextLessonStep(s), false);
});

test('removing the route or its aircraft recovers a usable step', () => {
  begin(); const r = route(); const p = game.createPlane('sparrow', false, 'LHR'); game.assign(p.id, r.id, true);
  observeTutorial(s); assert.equal(run().step, 4);
  p.routeId = null; observeTutorial(s); assert.equal(run().step, 2);
  s.routes = []; observeTutorial(s); assert.equal(run().step, 1);
});

test('an optional lesson requires opening its relevant screen and explicit continuation', () => {
  startLesson(s, 'finance'); assert.equal(nextLessonStep(s), false);
  observeTutorial(s, {at: go => go === 'rivals'}); assert.equal(nextLessonStep(s), false);
  observeTutorial(s, {at: go => go === 'finance'}); assert.equal(run().step, 0);
  assert.equal(nextLessonStep(s), true); assert.equal(run().step, 1);
  assert.equal(nextLessonStep(s), false);
});

test('pausing and switching lessons preserve separate progress across a save and load', () => {
  startLesson(s, 'finance'); observeTutorial(s, {at: () => true}); nextLessonStep(s);
  startLesson(s, 'projects'); s.tutorial.collapsed = true; game.save();
  assert.ok(game.load()); s = game.state;
  assert.equal(s.tutorial.active, 'projects'); assert.equal(s.tutorial.collapsed, true);
  startLesson(s, 'finance'); assert.equal(run().step, 1); assert.equal(s.tutorial.collapsed, false);
  s.tutorial.active = null; game.save(); game.load();
  assert.equal(game.state.tutorial.active, null); assert.equal(game.state.tutorial.progress.finance.step, 1);
});

test('replaying a completed lesson resets progress without removing the completion record', () => {
  startLesson(s, 'finance');
  for (let i = 0; i < 2; i++) { observeTutorial(s, {at: () => true}); nextLessonStep(s); }
  startLesson(s, 'finance', true); assert.equal(run().step, 0);
  for (let i = 0; i < 2; i++) { observeTutorial(s, {at: () => true}); nextLessonStep(s); }
  assert.deepEqual(s.tutorial.completed, ['finance']);
});

test('existing saves stay quiet; unfinished legacy tutorials migrate without changing the economy', () => {
  delete s.tutorial; s.tut = null; const money = s.money;
  assert.equal(ensureTutorial(s).active, null);
  delete s.tutorial; s.tut = 3;
  assert.equal(ensureTutorial(s).active, 'first-flight'); assert.equal(run().step, 0);
  assert.equal(s.money, money); assert.equal(s.tut, null);
  delete s.tutorial; s.tut = 7; s.flights = 2; route();
  ensureTutorial(s); assert.equal(run().step, 5);
});

test('lessons requiring missing assets are unavailable and do not replace the current lesson', () => {
  startLesson(s, 'finance');
  for (const id of ['service', 'fleet', 'connections']) {
    assert.ok(lessonWhy(s, LESSONS.find(l => l.id === id)));
    assert.equal(startLesson(s, id), false);
  }
  assert.equal(s.tutorial.active, 'finance'); assert.equal(startLesson(s, 'not-a-lesson'), false);
});

test('guidance does not alter simulation speed, cash, routes or aircraft', () => {
  const original = {money:s.money, speed:s.speed, routes:structuredClone(s.routes), planes:structuredClone(s.planes)};
  for (const lesson of LESSONS.filter(l => !l.requires && l.id !== 'first-flight')) {
    startLesson(s, lesson.id);
    for (const _ of lesson.steps) { observeTutorial(s, {at: () => true}); nextLessonStep(s); }
  }
  assert.deepEqual({money:s.money, speed:s.speed, routes:s.routes, planes:s.planes}, original);
});

test('unchanged observations do not request repeated saves', () => {
  begin(); assert.equal(observeTutorial(s), false);
  observeTutorial(s, {launch:'aircraft'});
  assert.equal(observeTutorial(s, {launch:'aircraft'}), false);
});
