import { game, MIN_PER_SEC } from './game.js';
import { createMap } from './map.js';
import { createAirportView } from './airportView.js';
import { createUI } from './ui.js';

let ui;
const map = createMap(document.getElementById('map'), {
  onPick: (sel) => ui.select(sel),
  onHover: (a, x, y) => ui.hover(a, x, y),
});
const view = createAirportView(document.getElementById('view-canvas'));
ui = createUI(map, view);

if (game.load()) {
  const away = game.catchUp();
  map.focus(game.state.active, 3.5);
  ui.render();
  if (away && !game.state.over) ui.offlineModal(away);
} else {
  ui.render();
}

if (import.meta.env.DEV) window.game = game; // handy in the browser console while developing

let last = performance.now();
let lastSave = last;
function frame(now) {
  const real = Math.min(0.1, (now - last) / 1000); // clamp so a background tab doesn't fast-forward
  last = now;
  const speed = game.state ? game.state.speed : 1;
  const dt = real * MIN_PER_SEC * speed;
  game.tick(dt);
  map.update(dt, real);
  map.draw();
  if (view.hubId) view.draw(real);
  ui.frame(now);
  if (now - lastSave > 15000) { lastSave = now; game.save(); } // keeps the "time away" clock honest
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('beforeunload', () => game.save());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { game.save(); return; }
  // Coming back to a tab that was left in the background counts as time away too.
  const away = game.state && game.catchUp();
  last = performance.now();
  if (away && !game.state.over) { ui.render(); ui.offlineModal(away); }
});
