// Decorative Minecraft-style voxel world that sits far below the floating course.
// Textures are drawn in code (no image files). Chunks stream in around the player.
import * as THREE from 'three';

const B = 2;               // world units per block
const CH = 16;             // columns per chunk side
const CHUNK_SIZE = CH * B; // world units per chunk side
const BASE_Y = -62;        // world y of the bottom of block level 0
const SEA = 5;             // water surface is the top of this block level
const MAX_H = 13;          // tallest terrain column (block levels 0..13)
export const WORLD_TOP_Y = BASE_Y + (MAX_H + 4) * B; // highest thing in the world (trees included)

// tile indices in the 4x4 atlas
const T = { GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, SAND: 4, WATER: 5, LOG_SIDE: 6, LOG_TOP: 7, LEAVES: 8 };

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- texture atlas ----------
function makeAtlas() {
  const px = 16, cols = 4;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px * cols;
  const g = canvas.getContext('2d');
  const rnd = mulberry32(1234);

  // paint a tile pixel by pixel: fn(x, y) returns [r, g, b]
  function tile(index, fn) {
    const ox = (index % cols) * px, oy = Math.floor(index / cols) * px;
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const [r, gg, b] = fn(x, y);
        g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
        g.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
  const jit = (base, amt) => base.map(c => c + (rnd() - 0.5) * amt);

  tile(T.GRASS_TOP, () => jit([88, 150, 60], 40));
  tile(T.DIRT, () => (rnd() < 0.12 ? jit([100, 70, 45], 30) : jit([134, 96, 67], 30)));
  tile(T.GRASS_SIDE, (x, y) => {
    const edge = 3 + Math.floor(rnd() * 3);
    return y < edge ? jit([88, 150, 60], 40) : (rnd() < 0.12 ? jit([100, 70, 45], 30) : jit([134, 96, 67], 30));
  });
  tile(T.STONE, () => (rnd() < 0.18 ? jit([105, 105, 105], 30) : jit([128, 128, 128], 24)));
  tile(T.SAND, () => jit([219, 207, 150], 22));
  tile(T.WATER, (x, y) => {
    const streak = (Math.sin(x * 0.9 + y * 0.4) + 1) * 8;
    return jit([40 + streak, 90 + streak, 200 + streak], 14);
  });
  tile(T.LOG_SIDE, x => (x % 4 === 0 ? jit([70, 50, 30], 14) : jit([105, 80, 50], 16)));
  tile(T.LOG_TOP, (x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    return Math.floor(d) % 3 === 0 ? jit([120, 95, 60], 12) : jit([160, 130, 85], 14);
  });
  tile(T.LEAVES, () => (rnd() < 0.2 ? jit([30, 80, 30], 20) : jit([55, 125, 45], 40)));

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- terrain noise ----------
function makeNoise(seed) {
  const hash = (ix, iz) => {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const smooth = t => t * t * (3 - 2 * t);
  const value = (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    const u = smooth(x - ix), v = smooth(z - iz);
    const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
  };
  const height = (bx, bz) => {
    const n = value(bx / 38, bz / 38) * 0.62 + value(bx / 17, bz / 17) * 0.28 + value(bx / 7, bz / 7) * 0.1;
    return Math.max(0, Math.min(MAX_H, Math.floor(n * (MAX_H + 4) - 1.5)));
  };
  return { hash, height };
}

// ---------- chunk mesher ----------
function buildChunk(cx, cz, noise, material) {
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const e = 0.002; // uv inset so nearest filtering never bleeds into the next tile

  function quad(c, n, tile, shade) {
    const base = pos.length / 3;
    const u0 = (tile % 4) / 4 + e, u1 = (tile % 4 + 1) / 4 - e;
    const v0 = 1 - (Math.floor(tile / 4) + 1) / 4 + e, v1 = 1 - Math.floor(tile / 4) / 4 - e;
    const uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    for (let i = 0; i < 4; i++) {
      pos.push(c[i][0], c[i][1], c[i][2]);
      nor.push(n[0], n[1], n[2]);
      uv.push(uvs[i][0], uvs[i][1]);
      col.push(shade, shade, shade);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const levelY = k => BASE_Y + k * B;
  // vertical band of a face on block (bx, bz) between block levels [k0, k1] inclusive
  function top(bx, bz, k, tile) {
    const x0 = bx * B, x1 = x0 + B, z0 = bz * B, z1 = z0 + B, y = levelY(k + 1);
    quad([[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]], [0, 1, 0], tile, 1.0);
  }
  function side(bx, bz, k, dir, tile) {
    const x0 = bx * B, x1 = x0 + B, z0 = bz * B, z1 = z0 + B, y0 = levelY(k), y1 = y0 + B;
    if (dir === 0) quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], tile, 0.8);
    if (dir === 1) quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], tile, 0.8);
    if (dir === 2) quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], tile, 0.9);
    if (dir === 3) quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], tile, 0.7);
  }
  function cube(bx, bz, k, topTile, sideTile) {
    top(bx, bz, k, topTile);
    for (let d = 0; d < 4; d++) side(bx, bz, k, d, sideTile);
    const x0 = bx * B, x1 = x0 + B, z0 = bz * B, z1 = z0 + B, y = levelY(k);
    quad([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], [0, -1, 0], sideTile, 0.5);
  }

  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let lx = 0; lx < CH; lx++) {
    for (let lz = 0; lz < CH; lz++) {
      const bx = cx * CH + lx, bz = cz * CH + lz;
      const h = noise.height(bx, bz);
      const sandy = h <= SEA;
      const topTile = sandy ? T.SAND : (h > 10 ? T.STONE : T.GRASS_TOP);
      top(bx, bz, h, topTile);
      if (h < SEA) top(bx, bz, SEA, T.WATER); // water surface over low columns

      for (let d = 0; d < 4; d++) {
        const nh = noise.height(bx + dirs[d][0], bz + dirs[d][1]);
        for (let k = Math.max(nh + 1, 0); k <= h; k++) {
          const depth = h - k;
          let tile;
          if (sandy) tile = T.SAND;
          else if (h > 10) tile = T.STONE;
          else tile = depth === 0 ? T.GRASS_SIDE : (depth < 3 ? T.DIRT : T.STONE);
          side(bx, bz, k, d, tile);
        }
      }
      // outside edge of the world: keep going down a bit so it isn't paper thin
      // (the course is high above, so nobody sees this up close)

      // trees on grassy columns
      if (!sandy && h <= 10 && noise.hash(bx * 7 + 11, bz * 13 + 5) > 0.985) {
        for (let t = 1; t <= 4; t++) cube(bx, bz, h + t, T.LOG_TOP, T.LOG_SIDE);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            cube(bx + dx, bz + dz, h + 4, T.LEAVES, T.LEAVES);
            if (dx !== 0 || dz !== 0) cube(bx + dx, bz + dz, h + 3, T.LEAVES, T.LEAVES);
          }
        }
        cube(bx, bz, h + 5, T.LEAVES, T.LEAVES);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return new THREE.Mesh(geo, material);
}

// ---------- public API ----------
export function createWorld(scene, radius = 4) {
  const group = new THREE.Group();
  scene.add(group);
  const material = new THREE.MeshLambertMaterial({ map: makeAtlas(), vertexColors: true, color: 0x7f9fe0 }) // blue-tinted;
  const chunks = new Map();
  let noise = makeNoise(1);
  let seed = 1;

  function clear() {
    for (const m of chunks.values()) { group.remove(m); m.geometry.dispose(); }
    chunks.clear();
  }

  // Build missing chunks around (x, z). `budget` caps how many are built per call.
  function update(x, z, budget = 3) {
    const pcx = Math.floor(x / CHUNK_SIZE), pcz = Math.floor(z / CHUNK_SIZE);
    for (const [key, m] of chunks) {
      if (Math.abs(m.userData.cx - pcx) > radius + 1 || Math.abs(m.userData.cz - pcz) > radius + 1) {
        group.remove(m); m.geometry.dispose(); chunks.delete(key);
      }
    }
    // nearest chunks first
    const wanted = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const key = `${pcx + dx},${pcz + dz}`;
        if (!chunks.has(key)) wanted.push([dx * dx + dz * dz, pcx + dx, pcz + dz, key]);
      }
    }
    wanted.sort((a, b) => a[0] - b[0]);
    for (const [, cx, cz, key] of wanted.slice(0, budget)) {
      const m = buildChunk(cx, cz, noise, material);
      m.userData.cx = cx; m.userData.cz = cz;
      group.add(m);
      chunks.set(key, m);
    }
    return wanted.length > budget ? wanted.length - budget : 0;
  }

  function regenerate(newSeed = Math.floor(Math.random() * 1e6) + 1) {
    clear();
    seed = newSeed;
    noise = makeNoise(seed);
  }

  regenerate();
  return { update, regenerate, get seed() { return seed; } };
}
