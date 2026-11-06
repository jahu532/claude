import * as THREE from 'three';
import { createWorld, WORLD_TOP_Y } from './world.js';
import { texturedBox, platformMaterials } from './textures.js';

// =====================================================================
//  Renderer / scene
// =====================================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02030a);
scene.fog = new THREE.Fog(0x0a2a6b, 90, 300);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 500);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0x7fb0ff, 0x0b1430, 1.0));
const sun = new THREE.DirectionalLight(0xb7d3ff, 1.5); // moonlight
sun.castShadow = true;
sun.shadow.camera.left = sun.shadow.camera.bottom = -45;
sun.shadow.camera.right = sun.shadow.camera.top = 45;
sun.shadow.camera.far = 150;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun, sun.target);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Night sky: black at the top fading to deep blue at the horizon, plus stars (both follow the camera)
const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 24, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color(0x01020a) }, mid: { value: new THREE.Color(0x0a2a6b) } },
  vertexShader: 'varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 top; uniform vec3 mid; varying float vY; void main(){ float t = clamp(vY, 0.0, 1.0); gl_FragColor = vec4(mix(mid, top, pow(t, 0.55)), 1.0); }',
}));
sky.renderOrder = -2;
const stars = (() => {
  const pts = [];
  for (let i = 0; i < 700; i++) {
    const a = Math.random() * Math.PI * 2, y = Math.random() * 0.95 - 0.05, r = Math.sqrt(1 - y * y) * 420;
    pts.push(Math.cos(a) * r, y * 420, Math.sin(a) * r);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfe3ff, size: 1.8, sizeAttenuation: false, fog: false, depthWrite: false }));
})();
scene.add(sky, stars);

// Random Minecraft-style world far below the course (decorative)
const world = createWorld(scene, 4);

// Blocky clouds between the course and the sky
const clouds = new THREE.Group();
{
  const mat = new THREE.MeshBasicMaterial({ color: 0x1b3d8f, transparent: true, opacity: 0.4, fog: false, depthWrite: false });
  for (let i = 0; i < 36; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(14 + Math.random() * 20, 3, 8 + Math.random() * 14), mat);
    c.position.set((Math.random() - 0.5) * 500, 55 + Math.random() * 25, (Math.random() - 0.5) * 500);
    clouds.add(c);
  }
  scene.add(clouds);
}

// =====================================================================
//  Constants
// =====================================================================
const PLAYER = { w: 0.8, h: 1.6 };
const SPEED = 7, SPRINT = 11, JUMP = 9.5, DOUBLE_JUMP = 8.5, GRAVITY = 24, CLIMB_SPEED = 4;
const DASH_SPEED = 22, DASH_TIME = 0.16, DASH_COOLDOWN = 0.7;
const WALL_SLIDE = 3, WALL_PUSH = 9;
const START_LIVES = 5;
const KILL_Y = WORLD_TOP_Y + 4; // feet below this = fell into the world below

const POWERUPS = {
  speed:  { color: 0x00e5ff, label: 'SPEED',       time: 10 },
  jump:   { color: 0x76ff03, label: 'SUPER JUMP',  time: 10 },
  extra:  { color: 0xd500f9, label: 'TRIPLE JUMP', time: 15 },
  shield: { color: 0x448aff, label: 'SHIELD',      time: 20 },
};


// =====================================================================
//  Storage helpers
// =====================================================================
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

// =====================================================================
//  Level objects (rebuilt on every level load)
// =====================================================================
let levelGroup = null;
let platforms = [], ladders = [], coins = [], enemies = [], spikes = [], powerups = [];
let goal = null;
let startPos = new THREE.Vector3(0, 0.81, 3);
let cpCounter = 0;

function clearLevel() {
  if (levelGroup) {
    scene.remove(levelGroup);
    levelGroup.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
  }
  levelGroup = new THREE.Group();
  scene.add(levelGroup);
  platforms = []; ladders = []; coins = []; enemies = []; spikes = []; powerups = [];
  goal = null;
  cpCounter = 0;
}
const add = o => { levelGroup.add(o); return o; };

const PLATFORM_COLORS = { ice: 0x9be7ff, bouncy: 0x00e5ff, crumble: 0x5c7aa8, spin: 0x3949ab };
// Blue/black theme: every normal platform gets one of these (picked from its original colour); the goal platform glows cyan.
const THEME = [0x0b1224, 0x13204a, 0x1a3a8f, 0x2457d6, 0x3d8bff];
const themeColor = c => (c === 0xffd700 ? 0x00e5ff : THEME[c % THEME.length]);

// opts: { kind: 'ice'|'bouncy'|'crumble'|'spin', move:{axis,range,speed,phase}, spin:radiansPerSec, checkpoint:true }
function addPlatform(x, y, z, w, h, d, color, opts = {}) {
  const kind = opts.kind || 'normal';
  const mesh = new THREE.Mesh(texturedBox(w, h, d), platformMaterials(kind, PLATFORM_COLORS[kind] ?? themeColor(color)));
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),   // neon outline
    new THREE.LineBasicMaterial({ color: color === 0xffd700 ? 0xe0ffff : (kind === 'normal' ? 0x4aa3ff : 0xbfe3ff) })));
  add(mesh);
  const p = {
    mesh, w, h, d, kind,
    move: opts.move || null,
    spin: opts.spin || 0, angle: 0, dAngle: 0,
    origin: new THREE.Vector3(x, y, z), delta: new THREE.Vector3(),
    solid: true, crumbleState: 0, crumbleT: 0,
    checkpoint: !!opts.checkpoint, cpIndex: 0, reached: false, flagMat: null,
  };
  if (p.checkpoint) {
    p.cpIndex = ++cpCounter;
    const fx = x - w / 2 + 0.4, fz = z - d / 2 + 0.4, top = y + h / 2;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
    pole.position.set(fx, top + 1.2, fz);
    p.flagMat = new THREE.MeshStandardMaterial({ color: 0x5c7aa8 });
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.05), p.flagMat);
    flag.position.set(fx + 0.5, top + 2.1, fz);
    add(pole); add(flag);
  }
  platforms.push(p);
  return p;
}

function addLadder(x, y, z, w, h, d) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x78909c });
  for (const dz of [-d / 2 + 0.1, d / 2 - 0.1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.15), wood);
    rail.position.set(0, 0, dz);
    g.add(rail);
  }
  for (let ry = -h / 2 + 0.25; ry < h / 2; ry += 0.5) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.1, d), wood);
    rung.position.set(0, ry, 0);
    g.add(rung);
  }
  g.position.set(x, y, z);
  g.traverse(o => { o.castShadow = true; });
  add(g);
  ladders.push({
    min: new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
    max: new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
  });
}

function addCoin(x, y, z) {
  const c = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.4, 0.1, 20),
    new THREE.MeshStandardMaterial({ color: 0xffd54f, emissive: 0x7a5c00 })
  );
  c.rotation.x = Math.PI / 2;
  c.position.set(x, y, z);
  c.castShadow = true;
  add(c);
  coins.push({ mesh: c, taken: false });
}

function addGoal(x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.8),
    new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x0097a7 })
  );
  mesh.position.set(x, y, z);
  add(mesh);
  goal = { mesh, base: new THREE.Vector3(x, y, z) };
}

// topY = surface the enemy walks on. Patrols +-range along `axis` ('x' or 'z').
function addEnemy(x, topY, z, axis, range, speed = 2) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xc62828 }));
  body.castShadow = true;
  g.add(body);
  for (const ex of [-0.23, 0.23]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.05), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    eye.position.set(ex, 0.15, 0.51);
    const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.05), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    pupil.position.set(ex, 0.15, 0.54);
    g.add(eye, pupil);
  }
  g.position.set(x, topY + 0.5, z);
  add(g);
  enemies.push({ mesh: g, origin: g.position.clone(), axis, range, omega: speed / range, phase: Math.random() * 6.28, alive: true });
}

// A patch of spikes covering w x d, standing on a surface at topY.
function addSpikes(x, topY, z, w, d) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xb0bec5 });
  const step = 0.5;
  for (let sx = -w / 2 + step / 2; sx < w / 2; sx += step) {
    for (let sz = -d / 2 + step / 2; sz < d / 2; sz += step) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.7, 6), mat);
      cone.position.set(sx, 0.35, sz);
      cone.castShadow = true;
      g.add(cone);
    }
  }
  g.position.set(x, topY, z);
  add(g);
  spikes.push({
    min: new THREE.Vector3(x - w / 2, topY, z - d / 2),
    max: new THREE.Vector3(x + w / 2, topY + 0.6, z + d / 2),
  });
}

function addPowerup(type, x, y, z) {
  const def = POWERUPS[type];
  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.5, 0),
    new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.6 })
  );
  mesh.position.set(x, y, z);
  add(mesh);
  powerups.push({ mesh, type, taken: false, baseY: y });
}

// =====================================================================
//  Levels  (two hand-made test levels - the random levels come later)
// =====================================================================
const levels = [
  {
    name: 'The Basics',
    desc: 'Jumps, ladder, first hazards',
    build() {
      startPos.set(0, 0.81, 3);
      addPlatform(0, -0.5, 0, 12, 1, 12, 0x4caf50);                                    // start
      addEnemy(0, 0, -3, 'x', 3.5, 2);
      addPlatform(0, -0.5, -12, 4, 1, 4, 0x8bc34a);
      addSpikes(1.25, 0, -12, 1.5, 4);
      addPlatform(6, 0.5, -17, 4, 1, 4, 0x8bc34a);
      addPowerup('shield', 6, 2.2, -17);
      addPlatform(12, 1.5, -22, 3.4, 1, 3.4, 0xffc107, { checkpoint: true });
      addPlatform(12, 2.5, -30, 4, 1, 4, 0x03a9f4, { move: { axis: 'z', range: 5, speed: 0.8 } });
      addPlatform(4, 3.5, -36, 3, 1, 3, 0xff7043);
      addPlatform(-4, 4.5, -36, 3, 1, 3, 0xff7043);
      addPlatform(-10, 5.5, -32, 3, 1, 3, 0x9c27b0, { move: { axis: 'y', range: 2, speed: 1.2 } });
      addPlatform(-10, 7.5, -24, 3.4, 1, 3.4, 0xe91e63, { checkpoint: true });
      // hard section: double jump only, then a ladder
      addPlatform(-10, 10.3, -19.5, 3, 1, 3, 0xff5722);
      addPlatform(-4.5, 10.3, -19.5, 3, 1, 3, 0xff5722);
      addPlatform(0.5, 10.3, -19.5, 3, 1, 3, 0xff5722);
      addPlatform(4.1, 12.4, -19.5, 3, 8.8, 3, 0x795548);
      addPlatform(9.6, 16.3, -19.5, 6, 1, 6, 0xffd700);
      addLadder(2.3, 14.0, -19.5, 0.6, 8.8, 1.6);
      addGoal(9.6, 18.3, -19.5);
      [[0, 1, -12], [6, 2, -17], [12, 3, -22], [12, 4, -30], [4, 5, -36], [-4, 6, -36],
       [-10, 7.5, -32], [-10, 9, -24], [-10, 12, -19.5], [-4.5, 12, -19.5], [2.0, 13, -19.5]]
        .forEach(c => addCoin(...c));
    },
  },
  {
    name: 'Feature Park',
    desc: 'Ice, bounce, crumble, spin, enemies, dash, wall jump',
    build() {
      startPos.set(0, 0.81, 3);
      addPlatform(0, -0.5, 0, 10, 1, 10, 0x4caf50, { checkpoint: true });
      // 1. ice runway
      addPlatform(0, -0.5, -14, 5, 1, 12, 0, { kind: 'ice' });
      addCoin(0, 1, -10); addCoin(0, 1, -14); addCoin(0, 1, -18);
      // 2. bounce pad up to a high platform
      addPlatform(0, -0.5, -26, 4, 1, 4, 0, { kind: 'bouncy' });
      addPlatform(0, 4, -37, 5, 1, 5, 0xffb74d, { checkpoint: true });
      addCoin(0, 8, -31);
      // 3. crumbling bridge
      [-43, -48.5, -54, -59.5, -65].forEach(z => addPlatform(0, 4, z, 3, 1, 3, 0, { kind: 'crumble' }));
      addPowerup('extra', 0, 5.8, -54);
      // 4. rotating bar
      addPlatform(0, 4, -72, 7, 1, 2.2, 0, { kind: 'spin', spin: 0.9 });
      addPlatform(0, 4, -80, 4, 1, 4, 0x8bc34a);
      addPowerup('shield', 0, 5.8, -80);
      // 5. enemy corridor
      addPlatform(0, 4, -92, 5, 1, 18, 0x607d8b);
      addEnemy(0, 4.5, -88, 'x', 1.8, 2.5);
      addEnemy(0, 4.5, -93, 'x', 1.8, 3);
      addSpikes(-1.25, 4.5, -98, 2.5, 2);
      addCoin(0, 6, -90); addCoin(0, 6, -96);
      addPlatform(0, 4, -107, 5, 1, 5, 0xffca28, { checkpoint: true });
      addPowerup('speed', 0, 5.8, -107);
      // 6. big gap: sprint + double jump + dash
      addPlatform(0, 4, -118, 5, 1, 5, 0xffa726);
      addPowerup('jump', 0, 5.8, -118);
      // 7. wall-jump shaft: bounce between the two walls to climb
      addPlatform(0, 4, -124, 5, 1, 8, 0x8d6e63);
      addPlatform(-3, 11.5, -130, 1, 14, 4, 0x6d4c41);
      addPlatform(3, 11.5, -130, 1, 14, 4, 0x6d4c41);
      addPlatform(0, 4, -130, 5, 1, 4, 0x8d6e63);
      addCoin(0, 9, -130); addCoin(0, 14, -130);
      addPlatform(0, 18, -139, 7, 1, 7, 0xffd700, { checkpoint: true });
      addGoal(0, 20.3, -139);
    },
  },
];

// =====================================================================
//  Player
// =====================================================================
// Player: a small blocky robot built from pivoted parts so it can be animated.
// `player` origin = centre of the collision box (feet at y = -0.8), model faces +z.
const player = new THREE.Group();
scene.add(player);

const suitMat = new THREE.MeshStandardMaterial({ color: 0x1f4fd8, emissive: 0x1a3a8f, emissiveIntensity: 0.5 });
const shellMat = new THREE.MeshStandardMaterial({ color: 0xe3f2fd, emissive: 0x2a6df5, emissiveIntensity: 0.3 });
const visorMat = new THREE.MeshBasicMaterial({ color: 0x7fe3ff });
function part(w, h, d, mat, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
}
const rig = new THREE.Group();            // pivot at the feet (squash & stretch)
rig.position.y = -PLAYER.h / 2;
player.add(rig);
const torsoPivot = new THREE.Group();     // pivot at the hips (lean)
torsoPivot.position.y = 0.6;
rig.add(torsoPivot);
part(0.6, 0.6, 0.36, shellMat, 0, 0.28, 0, torsoPivot);
part(0.62, 0.16, 0.38, suitMat, 0, 0.06, 0, torsoPivot);               // belt
const headPivot = new THREE.Group();
headPivot.position.y = 0.58; torsoPivot.add(headPivot);
part(0.44, 0.4, 0.42, shellMat, 0, 0.2, 0, headPivot);
part(0.34, 0.14, 0.04, visorMat, 0, 0.22, 0.22, headPivot);            // visor
function limb(x, y, w, len, mat, parent) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0); parent.add(pivot);
  part(w, len, w, mat, 0, -len / 2 + 0.04, 0, pivot);
  return pivot;
}
const armL = limb(-0.4, 0.5, 0.2, 0.56, suitMat, torsoPivot);
const armR = limb(0.4, 0.5, 0.2, 0.56, suitMat, torsoPivot);
const legL = limb(-0.15, 0.6, 0.24, 0.64, suitMat, rig);
const legR = limb(0.15, 0.6, 0.24, 0.64, suitMat, rig);

const shieldBubble = new THREE.Mesh(
  new THREE.SphereGeometry(1.3, 20, 14),
  new THREE.MeshBasicMaterial({ color: 0x448aff, transparent: true, opacity: 0.25 })
);
shieldBubble.visible = false;
player.add(shieldBubble);



const vel = new THREE.Vector3();
const hv = new THREE.Vector3();          // horizontal velocity (x, z) with acceleration
let onGround = false, standing = null, groundKind = null;
let jumpsLeft = 2, jumpWasDown = false, dashWasDown = false;
let climbing = false, climbLock = 0;
let dashT = 0, dashCd = 0, airDashed = false;
const dashDir = new THREE.Vector3();
let wallTimer = 0, wallLock = 0;
const wallN = new THREE.Vector3();
const fx = { speed: 0, jump: 0, extra: 0, shield: 0 };

// run state
let state = 'menu';           // menu | playing | paused | won | gameover
let levelIndex = 0;
let lives = START_LIVES, deaths = 0, coinCount = 0, time = 0, invuln = 0;
const checkpointPos = new THREE.Vector3();
let checkpointIdx = 0;

const getMaxJumps = () => 2 + (fx.extra > 0 ? 1 : 0);

// =====================================================================
//  HUD / overlay
// =====================================================================
const hud = document.getElementById('hud');
const fxhud = document.getElementById('fxhud');
const toastEl = document.getElementById('toast');
const overlay = document.getElementById('overlay');
let toastT = 0;
function toast(text) { toastEl.textContent = text; toastEl.style.opacity = 1; toastT = 2; }
function showOverlay(html) { overlay.innerHTML = html; overlay.style.display = 'grid'; }
function hideOverlay() { overlay.style.display = 'none'; }

const HELP = `
  <div class="help">
    <b>WASD</b> move · <b>Mouse</b> look · <b>Space</b> jump (press again in the air) · <b>Shift</b> sprint ·
    <b>E</b> dash · push into a wall in the air + <b>Space</b> = wall jump ·
    <b>W/S</b> climb ladders · <b>R</b> restart · <b>M</b> menu · <b>Esc</b> pause
  </div>`;

function fmt(t) { return t.toFixed(1) + 's'; }

function showMenu() {
  state = 'menu';
  if (document.pointerLockElement) document.exitPointerLock();
  const best = store.get('cg-best', {});
  const unlocked = store.get('cg-unlocked', 1);
  const cards = levels.map((l, i) => `
    <button class="card" data-act="play" data-i="${i}" ${i >= unlocked ? 'disabled' : ''}>
      <b>${i + 1}. ${l.name}</b>
      <small>${i >= unlocked ? 'Locked - finish the previous level' : l.desc + (best[i] ? ' · best ' + fmt(best[i]) : '')}</small>
    </button>`).join('');
  showOverlay(`<div class="panel">
    <h1>Claude Game</h1><h2>Select a level</h2>
    <div class="levels">${cards}</div>
    <div class="row"><button data-act="newworld">New random world below</button></div>
    <p class="help">World seed ${world.seed} · press U to unlock every level</p>
    ${HELP}
  </div>`);
}

function showPause() {
  state = 'paused';
  showOverlay(`<div class="panel"><h1>Paused</h1>
    <div class="row">
      <button data-act="resume">Resume</button>
      <button data-act="restart">Restart level</button>
      <button data-act="menu">Level select</button>
    </div>${HELP}</div>`);
}

function showWon() {
  state = 'won';
  if (document.pointerLockElement) document.exitPointerLock();
  const best = store.get('cg-best', {});
  const isBest = !best[levelIndex] || time < best[levelIndex];
  if (isBest) { best[levelIndex] = time; store.set('cg-best', best); }
  if (store.get('cg-unlocked', 1) < levelIndex + 2) store.set('cg-unlocked', Math.min(levels.length, levelIndex + 2));
  const hasNext = levelIndex + 1 < levels.length;
  showOverlay(`<div class="panel"><h1>Level complete!</h1>
    <h2>${levels[levelIndex].name}</h2>
    <p>Time ${fmt(time)}${isBest ? ' - new best!' : ' (best ' + fmt(best[levelIndex]) + ')'}</p>
    <p>Coins ${coinCount}/${coins.length} · Deaths ${deaths} · Lives left ${lives}</p>
    <div class="row">
      ${hasNext ? '<button data-act="next">Next level (Enter)</button>' : ''}
      <button data-act="restart">Replay (R)</button>
      <button data-act="menu">Level select (M)</button>
    </div></div>`);
}

function showGameOver() {
  state = 'gameover';
  if (document.pointerLockElement) document.exitPointerLock();
  showOverlay(`<div class="panel"><h1>Out of lives</h1>
    <p>${coinCount}/${coins.length} coins · ${fmt(time)}</p>
    <div class="row">
      <button data-act="restart">Try again (R)</button>
      <button data-act="menu">Level select (M)</button>
    </div></div>`);
}

function lockMouse() {
  try {
    const r = renderer.domElement.requestPointerLock();
    if (r && r.catch) r.catch(() => {});
  } catch { /* ignore */ }
}

function startLevel(i) {
  levelIndex = i;
  clearLevel();
  levels[i].build();
  lives = START_LIVES; deaths = 0; coinCount = 0; time = 0; invuln = 0.5;
  for (const k in fx) fx[k] = 0;
  checkpointPos.copy(startPos);
  checkpointIdx = 0;
  respawnPlayer();
  yaw = 0; pitch = 0.2;
  world.update(player.position.x, player.position.z, 400); // build the terrain below before playing
  state = 'playing';
  hideOverlay();
  lockMouse();
}

overlay.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const a = b.dataset.act;
  if (a === 'play') startLevel(+b.dataset.i);
  else if (a === 'restart') startLevel(levelIndex);
  else if (a === 'menu') showMenu();
  else if (a === 'next') startLevel(levelIndex + 1);
  else if (a === 'resume') { state = 'playing'; hideOverlay(); lockMouse(); }
  else if (a === 'newworld') { world.regenerate(); world.update(0, 0, 400); showMenu(); }
});

// =====================================================================
//  Input
// =====================================================================
const keys = {};
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyR' && state !== 'menu') startLevel(levelIndex);
  if (e.code === 'KeyM') showMenu();
  if (e.code === 'Enter' && state === 'won' && levelIndex + 1 < levels.length) startLevel(levelIndex + 1);
  if (e.code === 'KeyU' && state === 'menu') { store.set('cg-unlocked', levels.length); showMenu(); }
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

let yaw = 0, pitch = 0.2;
renderer.domElement.addEventListener('click', () => { if (state === 'playing' && !document.pointerLockElement) lockMouse(); });
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'playing') showPause();
});
addEventListener('mousemove', e => {
  if (!document.pointerLockElement) return;
  yaw -= e.movementX * 0.0025;
  pitch = Math.max(-0.6, Math.min(1.2, pitch + e.movementY * 0.0025));
});

// =====================================================================
//  Physics
// =====================================================================
function updatePlatforms(dt) {
  for (const p of platforms) {
    if (p.move) {
      const prev = p.mesh.position.clone();
      const off = Math.sin(time * p.move.speed + (p.move.phase || 0)) * p.move.range;
      p.mesh.position.copy(p.origin);
      p.mesh.position[p.move.axis] += off;
      p.delta.subVectors(p.mesh.position, prev);
    }
    if (p.spin) {
      p.dAngle = p.spin * dt;
      p.angle += p.dAngle;
      p.mesh.rotation.y = p.angle;
    }
    if (p.kind === 'crumble') {
      if (p.crumbleState === 0 && standing === p) { p.crumbleState = 1; p.crumbleT = 0.7; }
      else if (p.crumbleState === 1) {
        p.crumbleT -= dt;
        p.mesh.position.set(p.origin.x + (Math.random() - 0.5) * 0.12, p.origin.y, p.origin.z + (Math.random() - 0.5) * 0.12);
        if (p.crumbleT <= 0) { p.crumbleState = 2; p.crumbleT = 3.5; p.solid = false; p.mesh.visible = false; }
      } else if (p.crumbleState === 2) {
        p.crumbleT -= dt;
        if (p.crumbleT <= 0) { p.crumbleState = 0; p.solid = true; p.mesh.visible = true; p.mesh.position.copy(p.origin); }
      }
    }
  }
}

function reachCheckpoint(p) {
  if (p.cpIndex <= checkpointIdx) return;
  checkpointIdx = p.cpIndex;
  p.reached = true;
  p.flagMat.color.set(0x00e5ff);
  checkpointPos.set(p.mesh.position.x, p.mesh.position.y + p.h / 2 + PLAYER.h / 2 + 0.05, p.mesh.position.z);
  toast('Checkpoint!');
}

function collide(axis) {
  const half = PLAYER.w / 2, hh = PLAYER.h / 2;
  for (const p of platforms) {
    if (!p.solid || p.spin) continue;
    const pp = p.mesh.position;
    const dx = Math.abs(player.position.x - pp.x) - (half + p.w / 2);
    const dy = Math.abs(player.position.y - pp.y) - (hh + p.h / 2);
    const dz = Math.abs(player.position.z - pp.z) - (half + p.d / 2);
    if (dx >= 0 || dy >= 0 || dz >= 0) continue;
    if (axis === 'y') {
      if (vel.y <= 0 && player.position.y > pp.y) {
        player.position.y = pp.y + p.h / 2 + hh;
        player.position.add(p.delta); // ride moving platforms
        standing = p;
        if (p.kind === 'bouncy') {
          vel.y = keys.Space ? 24 : 17;
          jumpsLeft = getMaxJumps();
        } else {
          vel.y = 0;
          onGround = true;
        }
        if (p.checkpoint) reachCheckpoint(p);
      } else {
        player.position.y = pp.y - p.h / 2 - hh;
        vel.y = 0;
      }
    } else if (axis === 'x') {
      const s = Math.sign(player.position.x - pp.x) || 1;
      player.position.x = pp.x + s * (half + p.w / 2);
      wallN.set(s, 0, 0); wallTimer = 0.12;
    } else {
      const s = Math.sign(player.position.z - pp.z) || 1;
      player.position.z = pp.z + s * (half + p.d / 2);
      wallN.set(0, 0, s); wallTimer = 0.12;
    }
  }
}

// Rotating platforms: collide in the platform's local (rotated) frame.
function collideSpin(p) {
  const pp = p.mesh.position, hh = PLAYER.h / 2, r = PLAYER.w / 2;
  const cosA = Math.cos(p.angle), sinA = Math.sin(p.angle);
  const wx = player.position.x - pp.x, wz = player.position.z - pp.z;
  let lx = wx * cosA - wz * sinA, lz = wx * sinA + wz * cosA;
  const dy = player.position.y - pp.y;
  const px = p.w / 2 + r - Math.abs(lx), pz = p.d / 2 + r - Math.abs(lz), py = p.h / 2 + hh - Math.abs(dy);
  if (px <= 0 || pz <= 0 || py <= 0) return;
  if (py <= px && py <= pz) {
    if (dy > 0 && vel.y <= 0) {
      player.position.y = pp.y + p.h / 2 + hh;
      vel.y = 0; onGround = true; standing = p;
    } else if (dy <= 0) {
      player.position.y = pp.y - p.h / 2 - hh;
      if (vel.y > 0) vel.y = 0;
    }
  } else {
    if (px < pz) lx = (lx < 0 ? -1 : 1) * (p.w / 2 + r);
    else lz = (lz < 0 ? -1 : 1) * (p.d / 2 + r);
    player.position.x = pp.x + lx * cosA + lz * sinA;
    player.position.z = pp.z - lx * sinA + lz * cosA;
  }
}

function overlapsLadder(l) {
  const hw = PLAYER.w / 2, hh = PLAYER.h / 2, p = player.position;
  return p.x + hw > l.min.x && p.x - hw < l.max.x &&
         p.y + hh > l.min.y && p.y - hh < l.max.y &&
         p.z + hw > l.min.z && p.z - hw < l.max.z;
}

function respawnPlayer() {
  player.position.copy(checkpointPos);
  vel.set(0, 0, 0); hv.set(0, 0, 0);
  climbing = false; dashT = 0; wallTimer = 0; wallLock = 0; airDashed = false;
  standing = null; onGround = false;
  jumpsLeft = getMaxJumps();
}

// ignoreShield: lava/falling kills even with a shield
function hurt(ignoreShield = false) {
  if (state !== 'playing') return;
  if (!ignoreShield) {
    if (invuln > 0) return;
    if (fx.shield > 0) {
      fx.shield = 0; invuln = 1.5; vel.y = 9;
      toast('Shield broke!');
      return;
    }
  }
  lives--; deaths++;
  if (lives <= 0) { showGameOver(); return; }
  respawnPlayer();
  invuln = 1.5;
  toast(`Lives left: ${lives}`);
}

function step(dt) {
  time += dt;
  invuln = Math.max(0, invuln - dt);
  for (const k in fx) fx[k] = Math.max(0, fx[k] - dt);
  dashCd = Math.max(0, dashCd - dt);
  wallLock = Math.max(0, wallLock - dt);
  wallTimer = Math.max(0, wallTimer - dt);

  updatePlatforms(dt);

  // ride a rotating platform
  if (standing && standing.spin) {
    const pp = standing.mesh.position, c = Math.cos(standing.dAngle), s = Math.sin(standing.dAngle);
    const ox = player.position.x - pp.x, oz = player.position.z - pp.z;
    player.position.x = pp.x + ox * c + oz * s;
    player.position.z = pp.z - ox * s + oz * c;
  }

  // enemies move
  for (const e of enemies) {
    if (!e.alive) continue;
    e.mesh.position.copy(e.origin);
    e.mesh.position[e.axis] += Math.sin(time * e.omega + e.phase) * e.range;
  }

  // ---- input -> desired movement (relative to camera yaw)
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const dir = new THREE.Vector3();
  if (keys.KeyW) dir.add(fwd);
  if (keys.KeyS) dir.sub(fwd);
  if (keys.KeyD) dir.add(right);
  if (keys.KeyA) dir.sub(right);
  let moving = dir.lengthSq() > 0;
  if (moving) dir.normalize();
  const sprinting = keys.ShiftLeft || keys.ShiftRight;
  const topSpeed = (sprinting ? SPRINT : SPEED) * (fx.speed > 0 ? 1.4 : 1);

  // ---- ladders
  climbLock = Math.max(0, climbLock - dt);
  const climbIn = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const onLadder = ladders.some(overlapsLadder);
  if (!onLadder) climbing = false;
  else if (climbIn !== 0 && climbLock === 0) climbing = true;
  if (climbing && onGround && climbIn < 0) climbing = false;
  if (climbing) { dir.set(0, 0, 0); moving = false; }

  // ---- dash
  const dashPressed = keys.KeyE && !dashWasDown;
  dashWasDown = !!keys.KeyE;
  if (onGround) airDashed = false;
  if (dashPressed && dashCd <= 0 && !climbing && (onGround || !airDashed)) {
    dashT = DASH_TIME; dashCd = DASH_COOLDOWN;
    if (!onGround) airDashed = true;
    if (moving) dashDir.copy(dir);
    else dashDir.set(Math.sin(player.rotation.y), 0, Math.cos(player.rotation.y));
  }

  // ---- horizontal velocity with acceleration (ice is slippery, wall jumps lock air control briefly)
  if (dashT > 0) {
    dashT -= dt;
    hv.set(dashDir.x * DASH_SPEED, 0, dashDir.z * DASH_SPEED);
    player.rotation.y = Math.atan2(dashDir.x, dashDir.z);
  } else {
    const accel = onGround ? (groundKind === 'ice' ? 5 : 70) : (wallLock > 0 ? 3 : 35);
    const tx = dir.x * topSpeed, tz = dir.z * topSpeed;
    const dx = tx - hv.x, dz = tz - hv.z, len = Math.hypot(dx, dz), stepLen = accel * dt;
    if (len <= stepLen) { hv.x = tx; hv.z = tz; }
    else { hv.x += dx / len * stepLen; hv.z += dz / len * stepLen; }
    if (moving) player.rotation.y = Math.atan2(dir.x, dir.z);
  }
  vel.x = hv.x; vel.z = hv.z;

  // ---- jumping
  const maxJumps = getMaxJumps();
  const jp = fx.jump > 0 ? 1.35 : 1;
  if (onGround) jumpsLeft = maxJumps;
  else if (jumpsLeft === maxJumps) jumpsLeft = maxJumps - 1; // walked off a ledge: first jump is gone
  const jumpPressed = keys.Space && !jumpWasDown;
  jumpWasDown = !!keys.Space;
  if (jumpPressed && climbing) {                       // hop off a ladder
    climbing = false; climbLock = 0.3;
    vel.y = JUMP * jp; jumpsLeft = Math.min(1, maxJumps);
  } else if (jumpPressed && !onGround && wallTimer > 0) { // wall jump
    vel.y = JUMP * jp;
    hv.set(wallN.x * WALL_PUSH, 0, wallN.z * WALL_PUSH);
    vel.x = hv.x; vel.z = hv.z;
    wallLock = 0.25; wallTimer = 0;
    jumpsLeft = Math.max(jumpsLeft, 1);
  } else if (jumpPressed && jumpsLeft > 0) {
    vel.y = (onGround ? JUMP : DOUBLE_JUMP) * jp;
    jumpsLeft--;
  }

  // ---- vertical
  if (climbing) vel.y = climbIn * CLIMB_SPEED;
  else if (dashT > 0) vel.y = 0;
  else {
    vel.y = Math.max(vel.y - GRAVITY * dt, -45);
    if (!onGround && wallTimer > 0 && vel.y < -WALL_SLIDE) vel.y = -WALL_SLIDE; // wall slide
  }

  // ---- move + collide
  onGround = false; standing = null;
  player.position.x += vel.x * dt; collide('x');
  player.position.z += vel.z * dt; collide('z');
  player.position.y += vel.y * dt; collide('y');
  for (const p of platforms) if (p.spin) collideSpin(p);
  groundKind = standing ? standing.kind : null;

  // ---- hazards
  const hw = PLAYER.w / 2, hh = PLAYER.h / 2, pp = player.position;
  if (pp.y - hh < KILL_Y) { hurt(true); if (state !== 'playing') return; }

  for (const s of spikes) {
    if (pp.x + hw - 0.1 > s.min.x && pp.x - hw + 0.1 < s.max.x &&
        pp.y + hh > s.min.y && pp.y - hh < s.max.y &&
        pp.z + hw - 0.1 > s.min.z && pp.z - hw + 0.1 < s.max.z) { hurt(); if (state !== 'playing') return; }
  }

  for (const e of enemies) {
    if (!e.alive) continue;
    const ep = e.mesh.position;
    if (Math.abs(pp.x - ep.x) < hw + 0.5 && Math.abs(pp.z - ep.z) < hw + 0.5 && Math.abs(pp.y - ep.y) < hh + 0.5) {
      const stomp = vel.y < 0 && (pp.y - hh) > ep.y;
      if (stomp || dashT > 0) {
        e.alive = false; e.mesh.visible = false;
        if (stomp) { vel.y = keys.Space ? 13 : 9; jumpsLeft = Math.max(jumpsLeft, 1); }
        toast('Squashed!');
      } else { hurt(); if (state !== 'playing') return; }
    }
  }

  // ---- pickups
  for (const c of coins) {
    if (!c.taken && c.mesh.position.distanceTo(pp) < 1.1) {
      c.taken = true; c.mesh.visible = false;
      coinCount++;
      if (coinCount % 10 === 0) { lives++; toast('+1 life!'); }
    }
  }
  for (const u of powerups) {
    if (!u.taken && u.mesh.position.distanceTo(pp) < 1.2) {
      u.taken = true; u.mesh.visible = false;
      fx[u.type] = POWERUPS[u.type].time;
      toast(POWERUPS[u.type].label + '!');
    }
  }
  if (goal && goal.mesh.position.distanceTo(pp) < 1.5) showWon();
}


// ---- character animation (purely visual; reads the physics state)
const pose = { phase: 0, sy: 0, lean: 0, twist: 0, wasGround: true, airVy: 0, aL: 0, aR: 0, lL: 0, lR: 0, aLz: 0, aRz: 0, head: 0 };
function animatePlayer(dt, now) {
  const playing = state === 'playing';
  const speed = playing ? Math.hypot(hv.x, hv.z) : 0;
  const t = now / 1000;
  const k = 1 - Math.exp(-18 * dt);
  const lerp = (a, b) => a + (b - a) * k;
  let aL = 0, aR = 0, lL = 0, lR = 0, aLz = 0.08, aRz = -0.08, lean = 0, bob = 0, sy = 0, head = 0;

  if (playing && climbing) {
    pose.phase += Math.abs(vel.y) * dt * 2.2;
    const c = Math.sin(pose.phase);
    aL = -2.5 + c * 0.7; aR = -2.5 - c * 0.7;
    lL = -0.5 - c * 0.6; lR = -0.5 + c * 0.6;
    aLz = 0.25; aRz = -0.25;
  } else if (playing && dashT > 0) {
    lean = 0.75; aL = aR = 1.1; lL = -1.0; lR = 0.9; head = -0.3;
  } else if (playing && !onGround && wallTimer > 0 && vel.y < 0) {
    // wall slide: hands up on the wall, knees bent
    aL = aR = -2.6; aLz = 0.5; aRz = -0.5; lL = -0.3; lR = 0.2; lean = -0.15;
  } else if (!onGround && playing) {
    const rising = vel.y > 0;
    if (rising) { aL = aR = -2.6; aLz = 0.45; aRz = -0.45; lL = -0.7; lR = 0.35; lean = 0.1; }
    else { aL = aR = -1.2; aLz = 0.9; aRz = -0.9; lL = -0.25; lR = 0.25; lean = 0.05; }
    sy = Math.max(-0.1, Math.min(0.12, vel.y * 0.01));
    pose.airVy = vel.y;
  } else if (speed > 0.4) {
    const sprint = speed > SPEED * 1.2;
    pose.phase += dt * speed * 1.5;
    const swing = Math.min(1.1, 0.5 + speed * 0.05);
    const s = Math.sin(pose.phase);
    lL = s * swing; lR = -s * swing;
    aL = -s * swing * 0.9; aR = s * swing * 0.9;
    if (sprint) { aL += 0.4; aR += 0.4; }
    lean = Math.min(0.45, speed * 0.035);
    bob = Math.abs(Math.cos(pose.phase)) * 0.06;
  } else {
    // idle: breathing + gentle arm sway
    const b = Math.sin(t * 2);
    aL = 0.05 + b * 0.04; aR = 0.05 - b * 0.04;
    aLz = 0.1 + b * 0.02; aRz = -0.1 - b * 0.02;
    bob = b * 0.012;
    head = Math.sin(t * 0.7) * 0.12;
  }

  // landing squash
  if (playing) {
    if (onGround && !pose.wasGround) pose.sy = -Math.min(0.28, Math.max(0, -pose.airVy) * 0.014);
    pose.wasGround = onGround;
  }
  pose.sy = lerp(pose.sy, sy);
  pose.lean = lerp(pose.lean, lean);
  pose.aL = lerp(pose.aL, aL); pose.aR = lerp(pose.aR, aR);
  pose.lL = lerp(pose.lL, lL); pose.lR = lerp(pose.lR, lR);
  pose.aLz = lerp(pose.aLz, aLz); pose.aRz = lerp(pose.aRz, aRz);
  pose.head = lerp(pose.head, head);

  armL.rotation.x = pose.aL; armR.rotation.x = pose.aR;
  armL.rotation.z = pose.aLz; armR.rotation.z = pose.aRz;
  legL.rotation.x = pose.lL; legR.rotation.x = pose.lR;
  torsoPivot.rotation.x = pose.lean;
  headPivot.rotation.y = pose.head;
  headPivot.rotation.x = -pose.lean * 0.6;
  torsoPivot.position.y = 0.6 + bob;
  rig.scale.set(1 - pose.sy * 0.6, 1 + pose.sy, 1 - pose.sy * 0.6);
}

// =====================================================================
//  Main loop
// =====================================================================
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (state === 'playing') step(dt);

  // animations
  for (const c of coins) c.mesh.rotation.z += dt * 3;
  for (const u of powerups) { u.mesh.rotation.y += dt * 2; u.mesh.position.y = u.baseY + Math.sin(now / 350) * 0.2; }
  if (goal) { goal.mesh.rotation.y += dt * 2; goal.mesh.position.y = goal.base.y + Math.sin(now / 400) * 0.2; }
  animatePlayer(dt, now);
  shieldBubble.visible = fx.shield > 0;
  player.visible = invuln > 0 ? Math.floor(now / 90) % 2 === 0 : true;
  for (const c of clouds.children) {
    c.position.x += dt * 2;
    if (c.position.x - player.position.x > 250) c.position.x -= 500;
    if (c.position.z - player.position.z > 250) c.position.z -= 500;
    if (c.position.z - player.position.z < -250) c.position.z += 500;
  }

  // terrain streams in around the player; sun + shadows follow
  world.update(player.position.x, player.position.z, 2);
  sky.position.copy(camera.position); stars.position.copy(camera.position);
  sun.target.position.copy(player.position);
  sun.position.set(player.position.x + 20, player.position.y + 40, player.position.z + 10);

  // third-person camera
  const dist = 9;
  camera.position.set(
    player.position.x + Math.sin(yaw) * Math.cos(pitch) * dist,
    player.position.y + Math.sin(pitch) * dist + 1,
    player.position.z + Math.cos(yaw) * Math.cos(pitch) * dist
  );
  camera.lookAt(player.position.x, player.position.y + 0.5, player.position.z);

  // HUD
  if (state === 'playing' || state === 'paused') {
    hud.innerHTML = `<b>${levelIndex + 1}. ${levels[levelIndex].name}</b><br>` +
      `Lives ${'♥'.repeat(Math.min(lives, 10))}${lives > 10 ? ' x' + lives : ''}<br>` +
      `Coins ${coinCount}/${coins.length} · ${time.toFixed(1)}s · Deaths ${deaths}<br>` +
      `Dash ${dashCd <= 0 ? 'ready' : '...'}`;
    fxhud.innerHTML = Object.keys(fx).filter(k => fx[k] > 0)
      .map(k => `${POWERUPS[k].label} ${fx[k].toFixed(0)}s`).join('<br>');
  } else { hud.textContent = ''; fxhud.textContent = ''; }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.style.opacity = 0; }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// boot: show the menu over a level preview
clearLevel();
levels[0].build();
checkpointPos.copy(startPos);
respawnPlayer();
world.update(0, 0, 400);
showMenu();
requestAnimationFrame(frame);
