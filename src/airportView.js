import { companyInk } from './company.js';
// Close-up of one hub, drawn from its upgrade levels: what you've built is what you see.
import { AIRPORT_BY_ID } from './data/airports.js';
import { projectEffects, AIRPORT_PROJECTS } from './projects.js';
import { AIRCRAFT, PLANE_CAP, rankFor } from './data/catalog.js';
import { game } from './game.js';

const W = 760, H = 440;
const PLANE = new Path2D('M6 0L1 1.2L-1 5L-2.4 5L-1.2 1.2L-4.5 1L-5.6 2.6L-6.4 2.6L-5.8 0L-6.4-2.6L-5.6-2.6L-4.5-1L-1.2-1.2L-2.4-5L-1-5L1-1.2Z');
const MONO = '"SF Mono", ui-monospace, Menlo, monospace';

export function createAirportView(canvas) {
  const ctx = canvas.getContext('2d');
  let hubId = null;
  let clock = 0;
  const moves = []; // aircraft currently using the runway

  function plane(x, y, angle, scale, fill, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y); ctx.rotate(angle); ctx.scale(scale, scale);
    ctx.fillStyle = fill; ctx.fill(PLANE);
    ctx.restore();
  }
  function tag(text, x, y, color = 'rgba(201,216,230,.55)') {
    ctx.font = `10px ${MONO}`; ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  function runway(x, y, len, name) {
    ctx.fillStyle = '#1b2530'; ctx.fillRect(x, y - 13, len, 26);
    ctx.strokeStyle = 'rgba(230,238,245,.55)'; ctx.lineWidth = 1.5; ctx.setLineDash([16, 14]);
    ctx.beginPath(); ctx.moveTo(x + 34, y); ctx.lineTo(x + len - 34, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(230,238,245,.6)';
    for (let i = 0; i < 4; i++) { ctx.fillRect(x + 8, y - 10 + i * 6, 14, 2.5); ctx.fillRect(x + len - 22, y - 10 + i * 6, 14, 2.5); }
    const lights = Math.floor(len / 26);
    for (let i = 0; i <= lights; i++) { // chasing edge lights
      const on = (Math.floor(clock * 6) - i) % 6 === 0;
      ctx.fillStyle = on ? '#ffe2ac' : 'rgba(255,180,84,.35)';
      ctx.fillRect(x + i * 26, y - 17, 2, 2); ctx.fillRect(x + i * 26, y + 15, 2, 2);
    }
    tag(name, x + len + 8, y + 3);
  }

  function draw(real) {
    const s = game.state;
    const hub = s && hubId && game.hub(hubId);
    if (!hub) return;
    clock += real;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== W * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const L = hub.levels;

    // ground
    ctx.fillStyle = '#0d1a1c'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(120,180,170,.05)'; ctx.lineWidth = 1;
    for (let gx = 0; gx < W; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
    for (let gy = 0; gy < H; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

    // runways and taxiway
    const len1 = 290 + 78 * L.runway;
    const rwY = 352;
    ctx.fillStyle = '#17212a'; ctx.fillRect(60, 268, len1, 12); // taxiway
    for (const tx of [90, 60 + len1 - 50]) ctx.fillRect(tx, 268, 16, rwY - 268);
    runway(40, rwY, len1, '09L');
    if (L.runway >= 3) runway(120, 408, len1 - 150, '09R');

    // apron and stands
    const stands = PLANE_CAP[L.gates]+projectEffects(hub).gates;
    const perRow = 12;
    const rows = Math.ceil(stands / perRow);
    const termW = Math.min(560, 150 + L.terminal * 68);
    const termX = 70, termY = 46;
    ctx.fillStyle = '#141d26'; ctx.fillRect(termX - 14, termY + 40, Math.max(termW, Math.min(stands, perRow) * 44) + 28, 46 + rows * 52);

    // terminal with lit shop windows
    ctx.fillStyle = '#243444'; ctx.fillRect(termX, termY, termW, 42);
    ctx.fillStyle = '#2e4257'; ctx.fillRect(termX, termY, termW, 9);
    const windows = Math.floor((termW - 16) / 14);
    for (let i = 0; i < windows; i++) {
      const lit = i < L.amenities * Math.ceil(windows / 5);
      ctx.fillStyle = lit ? `rgba(255,196,110,${0.6 + 0.3 * Math.sin(clock * 2 + i)})` : 'rgba(140,175,205,.14)';
      ctx.fillRect(termX + 10 + i * 14, termY + 18, 8, 12);
    }
    tag(`TERMINAL ${L.terminal}`, termX, termY - 8);

    // one stand per aircraft based here: the aircraft itself when it is on the ground, its destination when it is away
    const based = s.planes.filter((p) => p.hub === hubId);
    for (let i = 0; i < stands; i++) {
      const gx = termX + 22 + (i % perRow) * 44;
      const gy = termY + 74 + Math.floor(i / perRow) * 52;
      ctx.strokeStyle = 'rgba(255,180,84,.3)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(gx, gy - 20); ctx.lineTo(gx, gy + 16); ctx.stroke();
      ctx.strokeRect(gx - 16, gy - 20, 32, 40);
      const p = based[i];
      if (!p) continue;
      const here = ['home', 'idle', 'repair', 'conversion'].includes(p.phase);
      const cls = AIRCRAFT[p.type].cls;
      const dest = game.route(p.routeId)?.dest;
      if (here) plane(gx, gy, -Math.PI / 2, 1.3 + cls * 0.22, p.phase === 'repair' ? '#ff7b6b' : p.phase === 'idle' ? '#8296aa' : companyInk(game.state));
      ctx.textAlign = 'center';
      tag(here ? (p.conversion ? 'CONVERT' : p.phase === 'repair' ? 'REPAIR' : dest || 'IDLE') : `▸${dest || ''}`, gx, gy + 30,
        p.phase === 'repair' || !dest ? '#ff7b6b' : here ? 'rgba(255,244,224,.8)' : 'rgba(201,216,230,.4)');
      ctx.textAlign = 'left';
    }

    // support buildings down the right-hand side
    const bx = 640;
    ctx.fillStyle = '#2e4257'; ctx.fillRect(bx + 36, 30, 8, 46); // control tower
    ctx.fillStyle = '#ffb454'; ctx.fillRect(bx + 30, 22, 20, 10);
    ctx.fillStyle = (Math.floor(clock * 1.5) % 2) ? '#ff7b6b' : '#5a2a26'; ctx.fillRect(bx + 39, 16, 2, 5);
    tag('TOWER', bx + 22, 92);
    for (let i = 0; i < L.fuel; i++) {
      ctx.beginPath(); ctx.arc(bx + 12 + i * 22, 130, 9, 0, 7); ctx.fillStyle = '#3a4c5e'; ctx.fill();
      ctx.beginPath(); ctx.arc(bx + 12 + i * 22, 130, 4, 0, 7); ctx.fillStyle = '#56708a'; ctx.fill();
    }
    if (L.fuel) tag('FUEL', bx + 4, 156);
    for (let i = 0; i < L.cargo; i++) {
      ctx.fillStyle = '#2b3a34'; ctx.fillRect(bx + 2 + i * 24, 176, 20, 30);
      ctx.fillStyle = '#5fd69a'; ctx.fillRect(bx + 2 + i * 24, 176, 20, 4);
    }
    if (L.cargo) tag('CARGO', bx + 4, 222);
    for (let i = 0; i < L.marketing; i++) {
      ctx.fillStyle = ['#ffb454', '#7cc4e8', '#e86fa6', '#5fd69a', '#b79cff'][i];
      ctx.fillRect(bx + 4 + i * 16, 240 + Math.sin(clock * 3 + i) * 1.5, 10, 7);
      ctx.fillStyle = '#56708a'; ctx.fillRect(bx + 3 + i * 16, 240, 1.5, 22);
    }

    // Two development sites, separate from the terminal upgrade buildings.
    (hub.projects || []).filter(p=>!['cancelled','removed'].includes(p.status)).slice(0,2).forEach((p,i)=>{
      const x=50+i*280,ready=p.status==='complete';
      ctx.fillStyle=ready?'#1c302d':'#30291e';ctx.fillRect(x,294,260,32);
      ctx.strokeStyle=ready?'#5fd69a':'#ffb454';ctx.strokeRect(x,294,260,32);
      tag(AIRPORT_PROJECTS[p.kind].name.toUpperCase(),x+8,307,ready?'#5fd69a':'#ffb454');
      tag(ready?'OPERATING':p.status==='awaiting'?'AWAITING FUNDING':'WORK IN PROGRESS',x+8,320);
    });

    // runway traffic
    for (let i = moves.length - 1; i >= 0; i--) {
      const m = moves[i];
      m.t += real / 3.2;
      if (m.t >= 1) { moves.splice(i, 1); continue; }
      const ease = m.kind === 'depart' ? m.t * m.t : 1 - (1 - m.t) * (1 - m.t);
      const px = m.kind === 'depart' ? 60 + ease * (len1 + 80) : 40 + len1 + 60 - ease * (len1 - 60);
      const lift = m.kind === 'depart' ? Math.max(0, m.t - 0.6) / 0.4 : Math.max(0, 0.3 - m.t) / 0.3;
      plane(px, rwY - lift * 16, m.kind === 'depart' ? 0 : Math.PI, m.scale * (1 + lift * 0.5), companyInk(game.state), 1 - lift * 0.5);
    }

    // caption
    const a = AIRPORT_BY_ID[hubId];
    ctx.font = `600 13px ${MONO}`; ctx.fillStyle = '#ffb454';
    ctx.fillText(`${a.id} · ${a.city.toUpperCase()} ${rankFor(L).name.toUpperCase()}`, 16, 22);
  }

  return {
    get hubId() { return hubId; },
    open(id) { hubId = id; moves.length = 0; },
    close() { hubId = null; },
    draw,
    // Show a take-off or landing if it happens at the hub being viewed.
    notify(kind, at, p) {
      if (at === hubId && moves.length < 4) moves.push({ kind, t: 0, scale: 1.3 + AIRCRAFT[p.type].cls * 0.22 });
    },
  };
}
