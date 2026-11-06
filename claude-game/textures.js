// Procedural pixel-art textures for platforms (no image files).
// Textures are near-white/grey so the platform's colour tints them.
import * as THREE from 'three';

const PX = 16; // pixels per tile

function rng(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// fn(x, y, rnd) -> grey level 0..255, or [r, g, b]
function makeTexture(seed, fn) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PX;
  const g = canvas.getContext('2d');
  const rnd = rng(seed);
  for (let y = 0; y < PX; y++) {
    for (let x = 0; x < PX; x++) {
      let c = fn(x, y, rnd);
      if (!Array.isArray(c)) c = [c, c, c];
      g.fillStyle = `rgb(${c.map(v => Math.max(0, Math.min(255, v)) | 0).join(',')})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const noise = (rnd, amt) => (rnd() - 0.5) * amt;

const generators = {
  // stone bricks, rows offset by half a brick
  brick: () => makeTexture(1, (x, y, rnd) => {
    const row = Math.floor(y / 4);
    const xo = (x + (row % 2) * 4) % 8;
    if (y % 4 === 0 || xo === 0) return 150 + noise(rnd, 14);
    return 222 + noise(rnd, 26);
  }),
  // flat paving stones for tops
  paving: () => makeTexture(2, (x, y, rnd) => {
    if (x % 8 === 0 || y % 8 === 0) return 160 + noise(rnd, 12);
    const hi = (x % 8 === 1 || y % 8 === 1) ? 12 : 0;
    return 228 + hi + noise(rnd, 24);
  }),
  ice: () => makeTexture(3, (x, y, rnd) => {
    const crack = (x + y * 2) % 13 === 0 || (x * 2 - y) % 11 === 0;
    if (crack) return [170, 205, 235];
    if (rnd() < 0.05) return [255, 255, 255];
    return [225 + noise(rnd, 14), 240 + noise(rnd, 10), 255];
  }),
  slime: () => makeTexture(4, (x, y, rnd) => {
    const edge = x === 0 || y === 0 || x === PX - 1 || y === PX - 1;
    if (edge) return 190;
    const shine = (x >= 3 && x <= 5 && y >= 3 && y <= 4) ? 40 : 0;
    return 235 + shine + noise(rnd, 14);
  }),
  // cracked sandstone
  crumble: () => makeTexture(5, (x, y, rnd) => {
    const crack = (x * 3 + y * 5) % 17 === 0 || (x + y * 7) % 19 === 0;
    if (crack) return 120 + noise(rnd, 20);
    return 215 + noise(rnd, 36);
  }),
  // riveted metal with hazard stripes
  metal: () => makeTexture(6, (x, y, rnd) => {
    const rivet = (x % 8 === 2 || x % 8 === 5) && (y % 8 === 2 || y % 8 === 5);
    if (rivet) return 120;
    const stripe = ((x + y) % 8) < 4;
    return (stripe ? 235 : 190) + noise(rnd, 10);
  }),
  wood: () => makeTexture(7, (x, y, rnd) => {
    if (y % 8 === 0) return 140;
    const grain = (x * 3 + Math.floor(y / 8) * 5) % 7 === 0 ? -16 : 0;
    return 215 + grain + noise(rnd, 18);
  }),
};

const cache = {};
const tex = name => (cache[name] ??= generators[name]());

// which texture each platform kind uses: [top, side]
const KIND_TEXTURES = {
  normal:  ['paving', 'brick'],
  ice:     ['ice', 'ice'],
  bouncy:  ['slime', 'slime'],
  crumble: ['crumble', 'crumble'],
  spin:    ['metal', 'metal'],
};

const TILE_WORLD = 2; // world units covered by one texture tile

// Box geometry whose UVs repeat the texture every TILE_WORLD units (no stretching).
export function texturedBox(w, h, d) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const faceDims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // +x -x +y -y +z -z
  for (let f = 0; f < 6; f++) {
    const su = Math.max(1, Math.round(faceDims[f][0] / TILE_WORLD));
    const sv = Math.max(1, Math.round(faceDims[f][1] / TILE_WORLD));
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * su, uv.getY(k) * sv);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

// Six materials in BoxGeometry face order: +x, -x, +y (top), -y, +z, -z
export function platformMaterials(kind, color) {
  const [topName, sideName] = KIND_TEXTURES[kind] || KIND_TEXTURES.normal;
  const side = new THREE.MeshStandardMaterial({ map: tex(sideName), color, roughness: 0.9 });
  const top = new THREE.MeshStandardMaterial({ map: tex(topName), color, roughness: 0.9 });
  const sideDark = new THREE.MeshStandardMaterial({ map: tex(sideName), color, roughness: 0.9 });
  return [side, side, top, sideDark, side, side];
}

