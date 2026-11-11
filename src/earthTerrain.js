// NASA Blue Marble: a small overview plus locally bundled, on-demand 500 m detail.
import {createSatelliteTileAtlas} from './satelliteTileAtlas.js';
import {TERRAIN_LAYOUT, visibleTerrainTiles} from './terrainTiles.js';
import {nightRenderScale} from './nightLights.js';

const stride = TERRAIN_LAYOUT.tileSize + TERRAIN_LAYOUT.gutter * 2;
const fragment = `
precision highp float;
uniform vec2 uRes, uSize, uCentre, uTileGrid;
uniform float uR, uAtlasSize, uDetailEnabled;
uniform vec3 uC, uE, uN;
uniform sampler2D uTex, uAtlas, uPageIndex;
void main() {
  vec2 screen = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) * uSize / uRes;
  vec2 d = vec2(screen.x - uCentre.x, uCentre.y - screen.y) / uR;
  float r = length(d);
  if (r >= 1.0) discard;
  vec3 v = d.x * uE + d.y * uN + sqrt(1.0 - r * r) * uC;
  vec2 uv = vec2(fract(atan(v.y, v.x) / 6.28318530718 + 0.5),
    clamp(0.5 - asin(clamp(v.z, -1.0, 1.0)) / 3.14159265359, 0.0, 0.9999999));
  vec3 col = texture2D(uTex, uv).rgb;
  if (uDetailEnabled > 0.5) {
    vec2 cell = uv * uTileGrid;
    vec4 page = texture2D(uPageIndex, (floor(cell) + 0.5) / vec2(64.0, 32.0));
    if (page.a > 0.5) {
      vec2 slot = floor(page.rg * 255.0 + 0.5);
      vec2 tileUV = (slot * ${stride}.0 + ${TERRAIN_LAYOUT.gutter}.0 + fract(cell) * ${TERRAIN_LAYOUT.tileSize}.0) / uAtlasSize;
      col = mix(col, texture2D(uAtlas, tileUV).rgb, page.b);
    }
  }
  col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))), 0.12) * 1.08;
  float edge = 1.0 - smoothstep(1.0 - 1.5 / uR, 1.0, r);
  gl_FragColor = vec4(col * edge, edge);
}`;

function createGPU(cv, image) {
  const gl = cv.getContext('webgl', {premultipliedAlpha:true, antialias:false});
  if (!gl) return null;
  const compile = (type, source) => {
    const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {gl.deleteShader(shader); return null;}
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){gl_Position=vec4(p,0.0,1.0);}');
  const pixel = compile(gl.FRAGMENT_SHADER, fragment);
  if (!vertex || !pixel) {if (vertex) gl.deleteShader(vertex); if (pixel) gl.deleteShader(pixel); return null;}
  const program = gl.createProgram();
  gl.attachShader(program, vertex); gl.attachShader(program, pixel); gl.linkProgram(program);
  gl.deleteShader(vertex); gl.deleteShader(pixel);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {gl.deleteProgram(program); return null;}
  gl.useProgram(program);
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
  const p = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
  let source = image;
  const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if (image.width > max) {
    source = document.createElement('canvas'); source.width = max; source.height = max / 2;
    source.getContext('2d').drawImage(image,0,0,source.width,source.height);
  }
  const overview = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,overview);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,source);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
  if (gl.getError() !== gl.NO_ERROR) {gl.deleteTexture(overview); gl.deleteProgram(program); gl.deleteBuffer(buffer); return null;}
  const u = Object.fromEntries(['uRes','uSize','uCentre','uR','uC','uE','uN','uTex','uAtlas','uPageIndex','uTileGrid','uAtlasSize','uDetailEnabled']
    .map(n => [n,gl.getUniformLocation(program,n)]));
  gl.uniform1i(u.uTex,0); gl.uniform1i(u.uAtlas,1); gl.uniform1i(u.uPageIndex,2);
  let atlas = null, attemptedAtlas = false, selectionKey = '';
  return {
    get revision(){return atlas?.revision || 0;},
    get animating(){return atlas?.animating || false;},
    prepare(o, key) {
      if (key === selectionKey) return;
      selectionKey = key;
      if (!atlas && !attemptedAtlas && visibleTerrainTiles(o,source.width).length) {
        attemptedAtlas = true;
        atlas = createSatelliteTileAtlas(gl,{layout:TERRAIN_LAYOUT,path:'/textures/terrain-tiles',format:gl.RGB,maxAcross:o.width <= 760 ? 4 : 5});
      }
      atlas?.prepare(visibleTerrainTiles(o,source.width,atlas.capacity));
    },
    suspend(){selectionKey = ''; atlas?.prepare([]);},
    render(o) {
      gl.viewport(0,0,cv.width,cv.height); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,overview);
      if (atlas) {
        const grid = atlas.bind();
        gl.uniform2f(u.uTileGrid,grid.columns,grid.rows); gl.uniform1f(u.uAtlasSize,atlas.size); gl.uniform1f(u.uDetailEnabled,1);
      } else {
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,overview);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D,overview); gl.uniform1f(u.uDetailEnabled,0);
      }
      const g = o.frame;
      gl.uniform2f(u.uRes,cv.width,cv.height); gl.uniform2f(u.uSize,o.width,o.height);
      gl.uniform2f(u.uCentre,g.cx,g.cy); gl.uniform1f(u.uR,g.R);
      gl.uniform3fv(u.uC,g.c); gl.uniform3fv(u.uE,g.e); gl.uniform3fv(u.uN,g.n);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    },
    dispose(){atlas?.dispose(); gl.deleteTexture(overview); gl.deleteBuffer(buffer); gl.deleteProgram(program);},
  };
}

export function createEarthTerrain() {
  const cv = document.createElement('canvas'), image = new Image();
  let gpu = null, loaded = false, lost = false, revision = 0;
  const initialize = () => {
    try {gpu = createGPU(cv,image);} catch {gpu = null;}
    revision++;
  };
  image.onload = () => {loaded = true; if (!lost) initialize();};
  cv.addEventListener('webglcontextlost',event => {
    event.preventDefault(); lost = true; gpu?.dispose(); gpu = null; revision++;
  });
  cv.addEventListener('webglcontextrestored',() => {lost = false; if (loaded) initialize();});
  image.src = window.innerWidth <= 760 ? '/textures/earth-day-mobile.jpg' : '/textures/earth-day.jpg';
  return {
    cv,
    get ready(){return !!gpu && !lost;},
    get revision(){return `${revision}|${gpu?.revision || 0}|${gpu?.animating ? 'fading' : 'ready'}`;},
    get animating(){return gpu?.animating || false;},
    prepare(o, key){gpu?.prepare(o,key);},
    suspend(){gpu?.suspend();},
    render(o) {
      if (!gpu || lost || o.width <= 0 || o.height <= 0) return;
      const scale = nightRenderScale(o.width,o.height,o.dpr);
      const width = Math.round(o.width*scale), height = Math.round(o.height*scale);
      if (cv.width !== width || cv.height !== height) {cv.width = width; cv.height = height;}
      gpu.render(o);
    },
  };
}
