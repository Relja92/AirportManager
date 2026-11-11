// NASA Black Marble 2016, lights only. Both projections sample the same geographic
// raster; no airport sizes, invented settlements or city-to-city corridors are used.
import { geoNaturalEarth1Raw } from 'd3-geo';
import { createNightTileAtlas, NIGHT_TILE_LEVELS, NIGHT_TILE_SIZE, NIGHT_TILE_STRIDE } from './nightTileAtlas.js';

const PI = Math.PI, RAD = PI / 180;
export const NIGHT_TEXTURE = '/textures/earth-night.jpg';
export const NIGHT_TEXTURE_MOBILE = '/textures/earth-night-mobile.jpg';
export const spherePoint = (lon, lat) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
export function nightOpacity(sunDot) {
  const t = Math.min(1, Math.max(0, -sunDot / 0.26));
  return t * t * (3 - 2 * t);
}
export function globeNightShade(sunDot) {
  const t = Math.min(1, Math.max(0, (0.26 - sunDot) / 0.52));
  return 0.94 * t * t * (3 - 2 * t);
}
export function nightRenderScale(width, height, dpr = 1) {
  // Match the map's device pixels, with a bounded buffer on very large displays.
  return Math.min(dpr, 2, 4096 / width, 4096 / height, Math.sqrt(8388608 / (width * height)));
}
export function nightUV(lon, lat) {
  return [((lon + 180) / 360 % 1 + 1) % 1, Math.max(0, Math.min(1, (90 - lat) / 180))];
}

// Kept independently testable against d3's projection, including its curved boundary.
export function flatNightPoint(x, y, translate, scale) {
  const raw = geoNaturalEarth1Raw.invert((x - translate[0]) / scale, (translate[1] - y) / scale);
  if (!raw || !raw.every(Number.isFinite) || Math.abs(raw[0]) > PI || Math.abs(raw[1]) > PI / 2) return null;
  return [raw[0] / RAD, raw[1] / RAD];
}
export function globeNightPoint(x, y, g) {
  const dx = (x - g.cx) / g.R, dy = (g.cy - y) / g.R, rr = dx * dx + dy * dy;
  if (rr > 1) return null;
  const z = Math.sqrt(1 - rr);
  const v = g.c.map((c, i) => c * z + g.e[i] * dx + g.n[i] * dy);
  return [Math.atan2(v[1], v[0]) / RAD, Math.asin(Math.max(-1, Math.min(1, v[2]))) / RAD];
}

// Choose a complete visible region at the finest resolution that fits the atlas.
// Coarser pyramid levels cover wider views without leaving blurry gaps between tiles.
export function visibleNightTiles(o, sourceWidth, capacity=36) {
  const scale = o.mode === 'globe' ? o.frame.R : o.projectionScale * o.view.k;
  if (2 * PI * scale * nightRenderScale(o.width, o.height, o.dpr) < sourceWidth * 0.75) return [];
  const points = [];
  for (let y = 0; y <= 16; y++) for (let x = 0; x <= 24; x++) {
    const sx = o.width * x / 24, sy = o.height * y / 16;
    const ll = o.mode === 'globe' ? globeNightPoint(sx, sy, o.frame)
      : flatNightPoint((sx - o.view.x) / o.view.k, (sy - o.view.y) / o.view.k, o.translate, o.projectionScale);
    if (!ll) continue;
    const v = spherePoint(...ll), darkness = nightOpacity(v.reduce((s, n, i) => s + n * o.sun[i], 0));
    if (!darkness) continue;
    points.push(nightUV(...ll));
  }
  if (!points.length) return [];
  // Find the smallest longitude interval, including views crossing the dateline.
  const us = points.map(p=>p[0]).sort((a,b)=>a-b);
  let gap=-1, start=0, end=1;
  for (let i=0;i<us.length;i++) {
    const next=i+1<us.length?us[i+1]:us[0]+1;
    if (next-us[i]>gap) {gap=next-us[i];start=next%1;end=us[i]+(us[i]<start?1:0);}
  }
  const minV=Math.min(...points.map(p=>p[1])), maxV=Math.max(...points.map(p=>p[1]));
  for (let level=NIGHT_TILE_LEVELS.length-1;level>=0;level--) {
    const {columns,rows,available}=NIGHT_TILE_LEVELS[level], tiles=[];
    const firstRow=Math.min(rows-1,Math.floor(minV*rows)), lastRow=Math.min(rows-1,Math.floor(maxV*rows));
    let occupied=0;
    for (let y=firstRow;y<=lastRow;y++) for (let x=Math.floor(start*columns);x<=Math.floor(end*columns);x++) {
      const col=x%columns;
      if (available[y*columns+col]==='1') occupied++;
      tiles.push({id:`${level}/${col}-${y}`,distance:Math.abs(x/columns-(start+end)/2)+Math.abs(y/rows-(minV+maxV)/2)});
    }
    if (occupied<=capacity) return tiles.sort((a,b)=>a.distance-b.distance).map(t=>t.id);
  }
  return [];
}

const FRAGMENT = `
precision highp float;
uniform vec2 uRes, uSize, uOffset, uTranslate;
uniform float uMode, uScale, uProjectionScale, uR;
uniform vec2 uCentre;
uniform vec3 uC, uE, uN, uSun;
uniform sampler2D uLights;
uniform sampler2D uAtlas, uPageIndex;
uniform vec2 uTileGrid;
uniform float uAtlasSize, uDetailEnabled;
const float PI = 3.141592653589793;
float detailLight(vec2 uv, float base) {
  if (uDetailEnabled < 0.5) return base;
  vec2 cell = uv * uTileGrid;
  vec4 page = texture2D(uPageIndex, (floor(cell) + 0.5) / vec2(64.0,32.0));
  if (page.a < 0.5) return base;
  if (page.r > 0.99) return 0.0; // A measured empty tile needs no image download.
  vec2 slot = floor(page.rg * 255.0 + 0.5);
  vec2 tileUV = (slot * ${NIGHT_TILE_STRIDE}.0 + 1.0 + fract(cell) * ${NIGHT_TILE_SIZE}.0) / uAtlasSize;
  return mix(base, texture2D(uAtlas, tileUV).r, page.b);
}
void main() {
  vec2 screen = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) * uSize / uRes;
  vec3 v;
  vec2 uv;
  float edge = 1.0;
  if (uMode < 0.5) {
    vec2 world = (screen - uOffset) / uScale;
    vec2 raw = vec2(world.x - uTranslate.x, uTranslate.y - world.y) / uProjectionScale;
    if (abs(raw.y) > 1.4224 || abs(raw.x) > 2.736) discard;
    // Natural Earth I inverse, using the same polynomial as d3-geo.
    float phi = clamp(raw.y, -PI * 0.5, PI * 0.5);
    for (int i = 0; i < 8; i++) {
      float p2 = phi * phi, p4 = p2 * p2;
      float fy = phi * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874*p2 - 0.005916*p4)));
      float dy = 1.007226 + p2 * (0.045255 + p4 * (-0.311325 + 0.259866*p2 - 0.065076*p4));
      phi -= (fy - raw.y) / dy;
    }
    float p2 = phi * phi, p4 = p2 * p2;
    float lon = raw.x / (0.8707 - 0.131979*p2 + p4 * (-0.013791 + p4 * (0.003971*p2 - 0.001529*p4)));
    if (abs(phi) > PI * 0.5 || abs(lon) > PI || abs(raw.y) > 1.4224) discard;
    v = vec3(cos(phi)*cos(lon), cos(phi)*sin(lon), sin(phi));
    uv = vec2(lon / (2.0*PI) + 0.5, 0.5 - phi / PI);
  } else {
    vec2 d = vec2(screen.x - uCentre.x, uCentre.y - screen.y) / uR;
    float rr = dot(d, d);
    if (rr >= 1.0) discard;
    v = d.x*uE + d.y*uN + sqrt(1.0-rr)*uC;
    uv = vec2(atan(v.y,v.x) / (2.0*PI) + 0.5, 0.5 - asin(clamp(v.z,-1.0,1.0)) / PI);
    edge = 1.0 - smoothstep(1.0 - 1.5/uR, 1.0, sqrt(rr));
  }
  float sunDot = dot(v, uSun);
  float night = smoothstep(0.0, 0.26, -sunDot);
  float shade = uMode > 0.5 ? 0.94 * smoothstep(-0.26, 0.26, -sunDot) : 0.0;
  if (night <= 0.0 && shade <= 0.0) discard;
  uv = vec2(fract(uv.x), clamp(uv.y, 0.0, 0.9999999));
  float light = texture2D(uLights, uv).r;
  light = detailLight(uv, light);
  // Drop JPEG's near-black noise, preserve measured intensity, and tint the light.
  float brightness = pow(max(0.0, (light - 0.008) / 0.992), 0.75);
  float alpha = brightness * night * 0.95;
  vec3 warm = mix(vec3(1.0,0.66,0.28), vec3(1.0,0.87,0.63), sqrt(light));
  // Composite the warm emissions over a continuous, deep-blue night mask.
  // Keeping both in one pass avoids twilight bands at close zoom.
  float shadow = shade * (1.0 - alpha);
  gl_FragColor = vec4((warm * alpha + vec3(1.0,3.0,9.0)/255.0 * shadow) * edge, (alpha + shadow) * edge);
}`;

function createGPU(cv, image, allowDetail) {
  const gl = cv.getContext('webgl', {alpha:true, premultipliedAlpha:true, antialias:false, preserveDrawingBuffer:true});
  if (!gl) return null;
  const compile = (type, source) => {
    const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); return null; }
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){gl_Position=vec4(p,0.0,1.0);}');
  const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  gl.deleteShader(vertex); gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); return null; }
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
  const p = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
  const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  let source = image;
  if (image.width > max) {
    source = document.createElement('canvas'); source.width = max; source.height = max / 2;
    source.getContext('2d').drawImage(image,0,0,source.width,source.height);
  }
  const overview = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, overview);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE,gl.LUMINANCE,gl.UNSIGNED_BYTE,source);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
  if (gl.getError() !== gl.NO_ERROR) return null;
  const u = Object.fromEntries(['uRes','uSize','uMode','uOffset','uScale','uTranslate','uProjectionScale','uCentre','uR','uC','uE','uN','uSun',
    'uLights','uAtlas','uPageIndex','uTileGrid','uAtlasSize','uDetailEnabled'].map(n=>[n,gl.getUniformLocation(program,n)]));
  gl.uniform1i(u.uLights,0); gl.uniform1i(u.uAtlas,1); gl.uniform1i(u.uPageIndex,2);
  const atlas=allowDetail?createNightTileAtlas(gl):null;
  let selectionKey='';
  const state = {
    get revision(){return atlas?.revision || 0;},
    get animating(){return atlas?.animating || false;},
    prepare(o, geometryKey) {
      if (!atlas) return;
      const key=geometryKey+'|'+o.sun.map(n=>n.toFixed(2)).join(',');
      if (key===selectionKey) return;
      selectionKey=key;
      atlas.prepare(visibleNightTiles(o,source.width,atlas.capacity));
    },
    dispose(){atlas?.dispose();},
    render(o) {
      gl.viewport(0,0,cv.width,cv.height); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,overview);
      if (atlas) {
        const grid=atlas.bind();
        gl.uniform2f(u.uTileGrid,grid.columns,grid.rows);
        gl.uniform1f(u.uAtlasSize,atlas.size); gl.uniform1f(u.uDetailEnabled,1);
      } else {
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,overview);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D,overview);
        gl.uniform1f(u.uDetailEnabled,0);
      }
      gl.uniform2f(u.uRes,cv.width,cv.height); gl.uniform2f(u.uSize,o.width,o.height);
      gl.uniform1f(u.uMode,o.mode==='globe'?1:0); gl.uniform3fv(u.uSun,o.sun);
      if (o.mode === 'globe') {
        const g=o.frame;
        gl.uniform2f(u.uCentre,g.cx,g.cy); gl.uniform1f(u.uR,g.R);
        gl.uniform3fv(u.uC,g.c); gl.uniform3fv(u.uE,g.e); gl.uniform3fv(u.uN,g.n);
      } else {
        gl.uniform2f(u.uOffset,o.view.x,o.view.y); gl.uniform1f(u.uScale,o.view.k);
        gl.uniform2fv(u.uTranslate,o.translate); gl.uniform1f(u.uProjectionScale,o.projectionScale);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    },
  };
  return state;
}

// A bounded, cached raster fallback uses the same satellite data when WebGL is absent.
// Projection work only repeats after a camera change; the clock recolors cached pixels.
function createCPU(image) {
  const source = document.createElement('canvas'); source.width=2048; source.height=1024;
  const sctx=source.getContext('2d',{willReadFrequently:true}); sctx.drawImage(image,0,0,2048,1024);
  const pixels=sctx.getImageData(0,0,2048,1024).data;
  const cv=document.createElement('canvas'), ctx=cv.getContext('2d');
  let key='', points=[], output;
  return {cv, render(o, geometryKey) {
    const ratio=Math.min(1,640/o.width,480/o.height);
    const width=Math.max(1,Math.round(o.width*ratio)), height=Math.max(1,Math.round(o.height*ratio));
    if (geometryKey!==key) {
      key=geometryKey; cv.width=width; cv.height=height; output=ctx.createImageData(width,height); points=[];
      for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
        const sx=(x+0.5)*o.width/width, sy=(y+0.5)*o.height/height;
        const ll=o.mode==='globe'?globeNightPoint(sx,sy,o.frame):flatNightPoint((sx-o.view.x)/o.view.k,(sy-o.view.y)/o.view.k,o.translate,o.projectionScale);
        if (!ll) continue;
        const [u,v]=nightUV(...ll), value=pixels[(Math.min(1023,Math.floor(v*1024))*2048+Math.floor(u*2048))*4]/255;
        if (value<=0.008 && o.mode!=='globe') continue;
        const p=(y*width+x)*4, warm=Math.sqrt(value);
        const edge=o.mode==='globe'?Math.min(1,Math.max(0,(o.frame.R-Math.hypot(sx-o.frame.cx,sy-o.frame.cy))/1.5)):1;
        points.push([p,spherePoint(...ll),Math.pow(Math.max(0,(value-0.008)/0.992),0.75)*0.95,0.66+0.21*warm,0.28+0.35*warm,edge]);
      }
    }
    for (const [p,v,intensity,green,blue,edge] of points) {
      const sunDot=v[0]*o.sun[0]+v[1]*o.sun[1]+v[2]*o.sun[2];
      const light=intensity*nightOpacity(sunDot), shade=o.mode==='globe'?globeNightShade(sunDot)*(1-light):0;
      const alpha=light+shade;
      output.data[p]=alpha?(light*255+shade)/alpha:0;
      output.data[p+1]=alpha?(green*light*255+3*shade)/alpha:0;
      output.data[p+2]=alpha?(blue*light*255+9*shade)/alpha:0;
      output.data[p+3]=alpha*edge*255;
    }
    ctx.putImageData(output,0,0);
  }};
}

export function createNightLights({projection, forceCanvas=false, textureUrl} = {}) {
  const cv=document.createElement('canvas');
  const img=new Image();
  let gpu=null, cpu=null, ready=false, lastKey='', lastDraw=0, lost=false;
  const whenReady=new Promise(resolve=>{
    img.onload=()=>{
      try { gpu=forceCanvas?null:createGPU(cv,img,!textureUrl); } catch { gpu=null; }
      if (!gpu) cpu=createCPU(img);
      ready=true; lastKey=''; resolve(true);
    };
    img.onerror=()=>resolve(false);
  });
  cv.addEventListener('webglcontextlost',event=>{
    event.preventDefault();lost=true;gpu?.dispose();gpu=null;
    if (ready) cpu ||= createCPU(img);
    lastKey='';
  });
  cv.addEventListener('webglcontextrestored',()=>{
    lost=false;
    if (ready) {try {gpu=createGPU(cv,img,!textureUrl);} catch {gpu=null;}}
    if (gpu) cpu=null;
    lastKey='';
  });
  img.src=textureUrl || (window.innerWidth<=760?NIGHT_TEXTURE_MOBILE:NIGHT_TEXTURE);
  function draw(ctx,o) {
    if (!ready) return false;
    const geometryKey=JSON.stringify([o.mode,o.width,o.height,o.dpr,o.view,o.frame]);
    gpu?.prepare(o,geometryKey);
    const key=geometryKey+'|'+o.sun.join(',')+'|'+(gpu?.revision || 0);
    if (key!==lastKey) {
      const now=performance.now();
      if (gpu && !lost) {
        const ratio=nightRenderScale(o.width,o.height,o.dpr);
        const width=Math.max(1,Math.round(o.width*ratio)), height=Math.max(1,Math.round(o.height*ratio));
        if (cv.width!==width || cv.height!==height) {cv.width=width;cv.height=height;}
        gpu.render(o); lastKey=gpu.animating?'':key; lastDraw=now;
      } else if (now-lastDraw>=100 || !lastKey) {
        cpu ||= createCPU(img); cpu.render(o,geometryKey); lastKey=key; lastDraw=now;
      }
    }
    ctx.drawImage(gpu&&!lost?cv:cpu.cv,0,0,o.width,o.height);
    return true;
  }
  return {
    whenReady, get ready(){return ready;}, get renderer(){return gpu&&!lost?'webgl':'canvas';},
    drawFlat(ctx,o){return draw(ctx,{...o,mode:'flat',translate:projection.translate(),projectionScale:projection.scale()});},
    drawGlobe(ctx,o){return draw(ctx,{...o,mode:'globe'});},
  };
}
