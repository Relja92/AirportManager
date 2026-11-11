export function createPwa({ win = window, nav = navigator, production = import.meta.env?.PROD ?? false } = {}) {
  const display = win.matchMedia('(display-mode: standalone)');
  const state = { installed: display.matches || !!nav.standalone, canInstall: false, installing: false,
    offlineReady: false, updateReady: false, updating: false, checking: false, message: '', production,
    supported: !!nav.serviceWorker && win.isSecureContext };
  const listeners = new Set();
  let prompt = null, registration = null, beforeUpdate = () => {}, lastCheck = 0, started = false;
  const emit = () => listeners.forEach(listener => listener());
  const waiting = () => { state.updateReady = !!registration?.waiting; if (state.updateReady) state.message = ''; emit(); };
  const markInstalled = () => { state.installed = true; state.canInstall = false; prompt = null; emit(); };
  display.addEventListener('change', () => { state.installed = display.matches || !!nav.standalone; emit(); });
  win.addEventListener('appinstalled', markInstalled);
  win.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); prompt = event; state.canInstall = true; emit();
  });
  async function check() {
    if (!registration || state.checking) return;
    if (nav.onLine === false) { state.message = 'Go online to check for updates.'; emit(); return; }
    lastCheck = Date.now(); state.checking = true; state.message = ''; emit();
    try { await registration.update(); waiting(); state.message = state.updateReady ? '' : 'Update check complete. New downloads will appear here when ready.'; }
    catch { state.message = 'Could not check for updates. Try again when you’re online.'; }
    finally { state.checking = false; emit(); }
  }
  async function register() {
    try {
      registration = await nav.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      state.offlineReady = !!registration.active; waiting();
      const watch = worker => {
        if (!worker) return;
        const changed = () => {
          if (worker.state === 'installed') waiting();
          if (worker.state === 'activated') { state.offlineReady = true; waiting(); }
          if (worker.state === 'redundant' && !state.offlineReady) { state.message = 'Offline download did not finish. Reopen the game online to try again.'; emit(); }
        };
        worker.addEventListener('statechange', changed); changed();
      };
      registration.addEventListener('updatefound', () => watch(registration.installing));
      watch(registration.installing);
      nav.serviceWorker.ready.then(() => { state.offlineReady = true; emit(); });
    } catch { state.message = 'Offline setup is unavailable right now. You can keep playing online.'; emit(); }
  }
  return {
    getState: () => ({ ...state }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    init({ save = () => {} } = {}) {
      if (started) return; started = true; beforeUpdate = save;
      if (!production || !state.supported) return;
      nav.serviceWorker.addEventListener('controllerchange', () => {
        state.offlineReady = true;
        if (state.updating) win.location.reload();
        else waiting();
      });
      win.addEventListener('online', () => { void check(); });
      win.document.addEventListener('visibilitychange', () => {
        if (!win.document.hidden && Date.now() - lastCheck > 60_000) void check();
      });
      if (win.document.readyState === 'complete') void register();
      else win.addEventListener('load', () => { void register(); }, { once: true });
    },
    async install() {
      if (!prompt || state.installing) return;
      const event = prompt; prompt = null; state.canInstall = false; state.installing = true; state.message = ''; emit();
      try {
        await event.prompt();
        const choice = await event.userChoice;
        state.message = choice.outcome === 'accepted' ? 'Installation requested. Open Airport Manager from your home screen when it appears.' : 'You can install later from your browser’s menu.';
      } catch { state.message = 'Use your browser’s menu to install or add the game to your home screen.'; }
      finally { state.installing = false; emit(); }
    },
    async applyUpdate() {
      if (!registration?.waiting || state.updating) return false;
      try {
        if (await beforeUpdate() === false) throw new Error('Save failed');
        state.updating = true; emit();
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        return true;
      } catch { state.updating = false; state.message = 'Could not save and update. Keep playing and try again later.'; emit(); return false; }
    },
    check,
  };
}

export const pwa = typeof window === 'undefined' ? null : createPwa();
