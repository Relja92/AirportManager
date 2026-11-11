import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createPwa } from '../src/pwa.js';

class Events {
  handlers = new Map();
  addEventListener(type, listener) { const list = this.handlers.get(type) || []; list.push(listener); this.handlers.set(type, list); }
  fire(type, data = {}) { for (const listener of this.handlers.get(type) || []) listener(data); }
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function app() {
  const win = new Events(), serviceWorker = new Events(), registration = new Events();
  let saved = 0, reloaded = 0, prompted = 0;
  win.matchMedia = () => Object.assign(new Events(), { matches: false });
  win.isSecureContext = true;
  win.location = { reload() { reloaded++; } };
  win.document = Object.assign(new Events(), { readyState: 'complete', hidden: false });
  registration.active = {}; registration.waiting = null; registration.update = async () => {};
  serviceWorker.ready = Promise.resolve(registration);
  serviceWorker.register = async () => registration;
  const nav = { serviceWorker, onLine: true };
  const pwa = createPwa({ win, nav, production: true });
  pwa.init({ save: () => { saved++; return true; } });
  return { pwa, win, nav, registration, serviceWorker,
    counts: () => ({ saved, reloaded, prompted }),
    offerInstall(outcome = 'accepted') { win.fire('beforeinstallprompt', { preventDefault() {}, prompt: async () => { prompted++; }, userChoice: Promise.resolve({ outcome }) }); },
  };
}

test('installation is requested only by the player and a dismissed prompt can be offered again', async () => {
  const a = app(); await settle(); a.offerInstall('dismissed');
  assert.equal(a.pwa.getState().canInstall, true);
  assert.equal(a.counts().prompted, 0);
  await a.pwa.install(); await a.pwa.install();
  assert.equal(a.counts().prompted, 1);
  assert.equal(a.pwa.getState().installed, false);
  a.offerInstall(); await a.pwa.install(); a.win.fire('appinstalled');
  assert.equal(a.pwa.getState().installed, true);
  assert.equal(a.pwa.getState().canInstall, false);
});

test('a waiting update saves first and only reloads the tab that chose to update', async () => {
  const a = app(); await settle();
  a.serviceWorker.fire('controllerchange');
  assert.equal(a.counts().reloaded, 0);
  a.registration.waiting = { postMessage(message) { assert.equal(message.type, 'SKIP_WAITING'); assert.equal(a.counts().saved, 1); } };
  await a.pwa.check();
  assert.equal(a.pwa.getState().updateReady, true);
  assert.equal(a.counts().saved, 0);
  assert.equal(await a.pwa.applyUpdate(), true);
  assert.equal(a.counts().reloaded, 0);
  a.serviceWorker.fire('controllerchange');
  assert.equal(a.counts().reloaded, 1);
});

test('a failed save prevents applying an update', async () => {
  const a = app();
  const pwa = createPwa({ win: a.win, nav: a.nav, production: true });
  let applied = false;
  a.registration.waiting = { postMessage() { applied = true; } };
  pwa.init({ save: () => false }); await settle();
  assert.equal(await pwa.applyUpdate(), false);
  assert.equal(applied, false);
  assert.match(pwa.getState().message, /Could not save/);
});

test('offline update checks leave the cached game ready to play', async () => {
  const a = app(); await settle(); a.nav.onLine = false;
  a.registration.update = () => { throw new Error('Should not request an offline update'); };
  await a.pwa.check();
  assert.equal(a.pwa.getState().offlineReady, true);
  assert.match(a.pwa.getState().message, /Go online/);
});

const workerSource = await readFile(new URL('../src/service-worker.js', import.meta.url), 'utf8');
const origin = 'https://airport.example';
const pathOf = value => new URL(typeof value === 'string' ? value : value.url, origin).pathname;
function worker() {
  const shell = ['/index.html', '/assets/game.js', '/assets/game.css', '/textures/earth-day-mobile.jpg', '/textures/earth-night-mobile.jpg'];
  const cachesByName = new Map(), events = new Events();
  let online = true, skip = 0, missing = null, calls = 0;
  const fetch = async request => {
    calls++;
    if (!online) throw new Error('Offline');
    const path = pathOf(request);
    return new Response(path, { status: path === missing ? 404 : 200, headers: { 'content-type': path.endsWith('.jpg') ? 'image/jpeg' : 'text/plain' } });
  };
  const storage = {
    async open(name) {
      if (!cachesByName.has(name)) cachesByName.set(name, new Map());
      const data = cachesByName.get(name);
      return {
        match: async request => data.get(pathOf(request))?.clone(),
        put: async (request, response) => { data.set(pathOf(request), response.clone()); },
        keys: async () => [...data.keys()].map(path => ({ url: origin + path })),
        delete: async request => data.delete(pathOf(request)),
        async addAll(requests) {
          const responses = await Promise.all(requests.map(fetch));
          if (responses.some(response => !response.ok)) throw new Error('Incomplete shell');
          requests.forEach((request, i) => data.set(pathOf(request), responses[i]));
        },
      };
    },
    keys: async () => [...cachesByName.keys()],
    delete: async name => cachesByName.delete(name),
    async match(request) { for (const data of cachesByName.values()) { const response = data.get(pathOf(request)); if (response) return response.clone(); } },
  };
  const self = { addEventListener: events.addEventListener.bind(events), location: { origin }, clients: { claim: async () => {} }, skipWaiting: async () => { skip++; } };
  vm.runInNewContext(workerSource.replace('__PWA_VERSION__', '"test"').replace('__PWA_SHELL__', JSON.stringify(shell)), {
    self, caches: storage, fetch, URL, Response, Request: class { constructor(path) { this.url = new URL(path, origin).href; this.method = 'GET'; } },
  });
  async function dispatch(type, data = {}) {
    const pending = []; let response;
    events.fire(type, { ...data, waitUntil: promise => pending.push(promise), respondWith: promise => { response = promise; } });
    const result = await response;
    await Promise.all(pending);
    return result;
  }
  return { shell, storage, dispatch, cachesByName, offline: () => { online = false; }, fail: path => { missing = path; }, calls: () => calls, skip: () => skip,
    request: (path, mode = 'cors', method = 'GET') => dispatch('fetch', { request: { url: new URL(path, origin).href, method, mode } }),
  };
}

test('the installed app reopens offline with matching code and base imagery', async () => {
  const w = worker(); await w.dispatch('install'); await w.dispatch('activate'); w.offline();
  const calls = w.calls();
  assert.equal(await (await w.request('/?launch=home', 'navigate')).text(), '/index.html');
  assert.equal(await (await w.request('/assets/game.js')).text(), '/assets/game.js');
  assert.equal(await (await w.request('/textures/earth-night-mobile.jpg')).text(), '/textures/earth-night-mobile.jpg');
  assert.equal(w.calls(), calls);
  assert.equal(await (await w.request('/textures/earth-day.jpg')).text(), '/textures/earth-day-mobile.jpg');
});

test('a missing app file rejects installation without activating a broken update', async () => {
  const w = worker(); w.fail('/assets/game.js');
  await assert.rejects(w.dispatch('install'), /Incomplete shell/);
  assert.equal(w.skip(), 0);
  assert.equal((await (await w.storage.open('airport-manager-app-test')).keys()).length, 0);
});

test('only an explicit update request skips waiting', async () => {
  const w = worker(); await w.dispatch('install');
  assert.equal(w.skip(), 0);
  await w.dispatch('message', { data: { type: 'SKIP_WAITING' } });
  assert.equal(w.skip(), 1);
});

test('satellite detail is cached on demand and its cache stays bounded', async () => {
  const w = worker(); await w.dispatch('install');
  assert.ok(!(await w.storage.keys()).some(key => key.includes('images')));
  for (let i = 0; i < 100; i++) await w.request(`/textures/terrain-tiles/2/${i}-0.jpg`);
  const images = await w.storage.open('airport-manager-images-test');
  assert.equal((await images.keys()).length, 96);
  w.offline();
  assert.equal(await (await w.request('/textures/terrain-tiles/2/99-0.jpg')).text(), '/textures/terrain-tiles/2/99-0.jpg');
  assert.equal((await w.request('/textures/terrain-tiles/2/0-0.jpg')).type, 'error');
});

test('activation retains the previous shell and never clears unrelated storage', async () => {
  const w = worker();
  await w.storage.open('other-app');
  await w.storage.open('airport-manager-app-older');
  await (await w.storage.open('airport-manager-app-previous')).put('/index.html', new Response('previous'));
  await w.storage.open('airport-manager-app-incomplete');
  await w.storage.open('airport-manager-images-previous');
  await w.dispatch('install'); await w.dispatch('activate');
  assert.deepEqual(await w.storage.keys(), ['other-app', 'airport-manager-app-previous', 'airport-manager-app-test']);
  assert.equal(await w.request('https://other.example/script.js'), undefined);
  assert.equal(await w.request('/api/save', 'cors', 'POST'), undefined);
  assert.equal(await w.request('/missing', 'navigate'), undefined);
});
