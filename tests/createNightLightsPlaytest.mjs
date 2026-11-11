import {mkdir,readFile,writeFile} from 'node:fs/promises';
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
const {game}=await import('../src/game.js'); game.silent=true; game.newGame('LHR');
const s=game.state; s.speed=0;s.day=80;s.minute=80*1440;s.events=[];s.eventsUntil=1e9;s.rng=12345;s.money=4e6;
s.tutorial.active=null;s.tips=['contract','rep','rivalWeak','hub2','value','losing','worn','fuelHigh','fuelLow'];
game.launchRoute('LHR','CDG',{mode:'new',typeId:'sparrow'});
const dir=new URL('../reports/night-lights-pass/',import.meta.url);await mkdir(dir,{recursive:true});
await writeFile(new URL('night.json',dir),JSON.stringify(s));
const html=(await readFile(new URL('../index.html',import.meta.url),'utf8')).replace('<script type="module" src="/src/main.js"></script>',`<script type="module">const params=new URLSearchParams(location.search);const s=await(await fetch('./night.json')).json();s.savedAt=Date.now();s.minute+=params.get('time')==='day'?720:params.get('time')==='dawn'?360:0;localStorage.setItem('airport-manager-save-v2',JSON.stringify(s));localStorage.setItem('airport-manager-view',params.get('view')==='globe'?'globe':'flat');localStorage.setItem('airport-manager-tutorial-seen','1');localStorage.setItem('airport-manager-weekly-off','1');await import('/src/main.js');</script>`);
await writeFile(new URL('playtest.html',dir),html);
const harness=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#09131f;color:#dce8f0;font:14px system-ui}nav{padding:12px;display:flex;gap:8px;flex-wrap:wrap}button{min-height:44px;background:#192b3b;border:1px solid #587084;color:inherit;border-radius:6px;padding:8px 14px}canvas{width:100%;display:block}pre{white-space:pre-wrap;padding:12px}</style></head><body><nav><button id="checks">Run render checks</button><button id="flat">Flat map</button><button id="globe">Globe</button><button id="day">Day</button><button id="night">Night</button><button id="dusk">Dusk</button><button id="turn">Turn globe</button></nav><canvas id="canvas"></canvas><pre id="result">Loading satellite image…</pre><script type="module">
import {geoNaturalEarth1} from '/node_modules/d3-geo/dist/d3-geo.mjs';
import {createNightLights,spherePoint} from '/src/nightLights.js';
const projection=geoNaturalEarth1().fitExtent([[20,20],[1980,980]],{type:'Sphere'});
const forceCanvas=new URLSearchParams(location.search).get('renderer')==='canvas';
const lights=createNightLights({projection,forceCanvas}),canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true}),out=document.querySelector('#result');
await lights.whenReady;
let mode='flat',sun=spherePoint(180,0),lon=10,lat=45;
const frame=()=>{const l=lon*Math.PI/180,p=lat*Math.PI/180;return {cx:canvas.width/2,cy:canvas.height/2,R:Math.min(canvas.width,canvas.height)*0.47,c:spherePoint(lon,lat),e:[-Math.sin(l),Math.cos(l),0],n:[-Math.sin(p)*Math.cos(l),-Math.sin(p)*Math.sin(l),Math.cos(p)]};};
function options(){const xy=projection([lon,lat]);return {width:canvas.width,height:canvas.height,dpr:1,sun,view:{k:1.8,x:canvas.width/2-xy[0]*1.8,y:canvas.height/2-xy[1]*1.8},frame:frame()};}
function draw(){ctx.clearRect(0,0,canvas.width,canvas.height);const o=options();if(mode==='flat')lights.drawFlat(ctx,o);else lights.drawGlobe(ctx,o);}
function size(){canvas.width=innerWidth;canvas.height=Math.max(240,innerHeight-200);draw();}size();window.addEventListener('resize',size);
out.textContent='Ready · '+lights.renderer;
for(const id of ['flat','globe','day','night','dusk','turn'])document.querySelector('#'+id).onclick=()=>{if(id==='flat'||id==='globe')mode=id;else if(id==='turn')lon+=35;else sun=spherePoint(id==='day'?10:id==='night'?190:105,0);draw();out.textContent='Ready · '+lights.renderer+' · '+mode+' · '+id;};
const delay=()=>new Promise(r=>setTimeout(r,120));
document.querySelector('#checks').onclick=async()=>{
const report={renderer:lights.renderer,size:[canvas.width,canvas.height],checks:[],timings:{}};
function energy(){const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let sum=0,count=0,center=0;for(let i=3;i<data.length;i+=4){sum+=data[i];if(data[i])count++;const p=(i-3)/4,x=p%canvas.width,y=Math.floor(p/canvas.width);if(Math.abs(x-canvas.width/2)<25&&Math.abs(y-canvas.height/2)<25)center+=data[i];}return {sum,count,center};}
for(const m of ['flat','globe']){mode=m;lon=10;lat=45;const energies=[];for(const sunLon of [10,95,110,190]){sun=spherePoint(sunLon,0);await delay();draw();energies.push(energy());}report.checks.push({mode:m,energies,nightHasLights:energies[3].count>100,nightBrighterThanDay:energies[3].sum>energies[0].sum});
const times=[];for(let i=0;i<30;i++){lon+=0.3;await delay();const start=performance.now();draw();ctx.getImageData(0,0,1,1);times.push(performance.now()-start);}times.sort((a,b)=>a-b);report.timings[m]={median:times[15],p95:times[28],metric:'render plus synchronous pixel readback, milliseconds'};}
mode='globe';lon=10;lat=45;sun=spherePoint(190,0);await delay();draw();const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;let warm=true;for(let i=0;i<rgba.length;i+=4)if(rgba[i]>40 && rgba[i+3]>10 && (rgba[i]<rgba[i+1]||rgba[i+1]<rgba[i+2]))warm=false;report.warmColors=warm;report.outsideGlobeTransparent=rgba[3]===0;out.textContent=JSON.stringify(report,null,2);
};
</script></body></html>`;
await writeFile(new URL('render-check.html',dir),harness);
console.log('Night-light playtest and renderer checks created.');
