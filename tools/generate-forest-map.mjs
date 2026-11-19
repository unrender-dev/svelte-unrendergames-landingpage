#!/usr/bin/env node
/**
 * Unrender Games – gerador do mapa low poly "unrender_forest.glb"
 *
 * Gera um mapa no mesmo estilo/escala do antigo low_poly_forest_1.glb
 * (grama amarelada, trilha de terra, pinheiros em camadas, árvores secas e
 * pedras facetadas), mas já CERCADO NATURALMENTE por falésias de pedra com
 * floresta em cima. Assim o jogo não precisa mais gerar paredes em runtime.
 *
 * Saída: um único GLB com estas malhas (nomes usados pelo JogosPage.svelte):
 *   terrain      chão da clareira + falésias + borda do planalto  (colisão)
 *   rocks        pedras/rochedos                                  (colisão)
 *   paths        trilhas de terra (fita fina sobre o chão)
 *   trees        árvores dentro da área jogável
 *   trees_rim    floresta em cima das falésias
 *   trees_far    floresta distante (low detail, sem sombra)
 *   terrain_far  colinas/montanhas do horizonte
 *   decor        pedrinhas rasteiras, arbustos, terra do spawn do zumbi
 *   colliders    SÓ colisão (troncos, troncos caídos e uma cerca invisível
 *                no topo das falésias). Não é renderizado.
 *
 * Sem dependências: `node tools/generate-forest-map.mjs`
 *   --seed=20261027   muda a distribuição aleatória (determinística)
 *   --out=caminho.glb
 */
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const SEED = Number(args.seed ?? 20261027);
const OUT = args.out ?? "static/models/map/unrender_forest.glb";

const GROUND_Y = -0.02; // mesma altura do chão do mapa antigo

// Área jogável (mesma proporção do mapa antigo ~29 x 30 unidades)
const AREA = { xmin: -12.5, xmax: 16.5, zmin: -14, zmax: 16, corner: 7 };

// Pontos de interesse – MANTER EM SINCRONIA com JogosPage.svelte (MAP_POI)
const POIS = {
  spawn: { x: -0.65, z: 3.62, clear: 2.8 },
  contato: { x: -1.4, z: -0.4, clear: 2.1 },
  portfolio: { x: 3.0, z: 0.9, clear: 2.1 },
  clown: { x: -5.2, z: 2.6, clear: 2.4 },
  miku: { x: 1.4, z: 7.3, clear: 2.9 },
  welcome: { x: 3.0, z: 4.4, clear: 2.0 },
  zombie: { x: 6.2, z: -2.8, clear: 2.4 },
};
const SPAWN_ROCK_FREE_RADIUS = 7.5; // nenhuma pedra com colisão perto do spawn
const HUB_RADIUS = 6.5; // árvores mais esparsas em volta do spawn

// Trilhas (mesmo desenho do mapa antigo). Pontas saem da área e somem na falésia.
const PATH_WIDTH = 1.15;
const PATHS = [
  [[-14.5, -2], [-6, -2], [-1, 3], [1.5, 5.9], [9, 5.9]],
  [[5.6, -16.5], [6.5, -12], [8, -5], [8, 2.5], [9, 5.9]],
  [[18.5, 1], [13, 1], [9, 5.9]],
];

// Paleta (sRGB) tirada do atlas do mapa antigo
const SRGB = {
  grass: [178, 182, 78],
  foliage: [176, 182, 76],
  dirt: [181, 155, 77],
  trunk: [136, 119, 84],
  rock: [148, 148, 148],
  bush: [150, 162, 66],
};

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const rand = (a = 0, b = 1) => a + (b - a) * rng();
const randInt = (a, b) => Math.floor(rand(a, b + 1));

const srgbToLinear = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
function color(name, vary = 0.05, tint = 0) {
  const base = SRGB[name];
  const k = 1 + rand(-vary, vary);
  const t = rand(-tint, tint);
  return [
    srgbToLinear(Math.min(255, base[0] * k * (1 + t))),
    srgbToLinear(Math.min(255, base[1] * k)),
    srgbToLinear(Math.min(255, base[2] * k * (1 - t))),
  ];
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => t * t * (3 - 2 * t);

// Value noise 2D (determinístico)
const PERM = Array.from({ length: 512 }, () => rng());
function hash2(ix, iz) {
  const h = ((ix * 374761393) ^ (iz * 668265263)) >>> 0;
  return PERM[h % 512];
}
function noise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix), fz = smooth(z - iz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fz) * 2 - 1;
}
const fbm = (x, z) =>
  noise2(x, z) * 0.6 + noise2(x * 2.1 + 7, z * 2.1 - 3) * 0.3 + noise2(x * 4.3, z * 4.3) * 0.1;

// Ruído periódico 1D (para o contorno fechado)
const PERIODIC = Array.from({ length: 8 }, (_, i) => ({
  k: i + 2,
  a: rand(0.4, 1) / (i + 2) ** 0.8,
  p: rand(0, Math.PI * 2),
}));
const PERIODIC_NORM = PERIODIC.reduce((s, o) => s + o.a, 0);
const periodicNoise = (t) =>
  PERIODIC.reduce((s, o) => s + o.a * Math.sin(Math.PI * 2 * o.k * t + o.p), 0) / PERIODIC_NORM;

// ---------------------------------------------------------------------------
// Mesh builder (indexado; vértices compartilhados ou faces com cor própria)
// ---------------------------------------------------------------------------
class MeshBuilder {
  constructor(name) {
    this.name = name;
    this.pos = [];
    this.col = [];
    this.idx = [];
  }
  get vertCount() {
    return this.pos.length / 3;
  }
  get triCount() {
    return this.idx.length / 3;
  }
  v(p, c) {
    this.pos.push(p[0], p[1], p[2]);
    this.col.push(c[0], c[1], c[2]);
    return this.vertCount - 1;
  }
  p(i) {
    return [this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]];
  }
  /** triângulo por índices, orientado para `towards` (direção ou fn(centro,normal)) */
  tri(a, b, c, towards) {
    if (towards) {
      const pa = this.p(a), pb = this.p(b), pc = this.p(c);
      const n = cross(sub(pb, pa), sub(pc, pa));
      const dir = typeof towards === "function" ? towards(mul(add(add(pa, pb), pc), 1 / 3)) : towards;
      if (dot(n, dir) < 0) [b, c] = [c, b];
    }
    this.idx.push(a, b, c);
  }
  /** face com vértices próprios (cor chapada por face) */
  face(p0, p1, p2, c, towards) {
    this.tri(this.v(p0, c), this.v(p1, c), this.v(p2, c), towards);
  }
  quad(p0, p1, p2, p3, c, towards, flip = false) {
    if (flip) {
      this.face(p0, p1, p3, c, towards);
      this.face(p1, p2, p3, c, towards);
    } else {
      this.face(p0, p1, p2, c, towards);
      this.face(p0, p2, p3, c, towards);
    }
  }
  /** faces chapadas com cor escolhida pela inclinação (pedra x grama) */
  slopeQuad(p0, p1, p2, p3, towards, flip, rockBelow = 0.72, forceRock = false) {
    const tris = flip ? [[p0, p1, p3], [p1, p2, p3]] : [[p0, p1, p2], [p0, p2, p3]];
    for (const [a, b, c] of tris) {
      let n = norm(cross(sub(b, a), sub(c, a)));
      const center = mul(add(add(a, b), c), 1 / 3);
      const dir = typeof towards === "function" ? towards(center) : towards;
      if (dot(n, dir) < 0) n = mul(n, -1);
      const rock = forceRock || n[1] < rockBelow;
      this.face(a, b, c, rock ? color("rock", 0.06) : color("grass", 0.035), towards);
    }
  }
}

// ---------------------------------------------------------------------------
// Contorno da clareira (retângulo arredondado + ruído para dentro)
// ---------------------------------------------------------------------------
function roundedRectSample(t) {
  // t em [0,1) ao longo do perímetro; sentido horário visto de cima (x leste, z sul)
  const { xmin, xmax, zmin, zmax, corner: r } = AREA;
  const w = xmax - xmin - 2 * r, h = zmax - zmin - 2 * r;
  const arc = (Math.PI / 2) * r;
  const segs = [w, arc, h, arc, w, arc, h, arc];
  const total = segs.reduce((a, b) => a + b, 0);
  let d = (((t % 1) + 1) % 1) * total;
  let i = 0;
  while (d > segs[i]) d -= segs[i++];
  const cx = [xmin + r, xmax - r], cz = [zmin + r, zmax - r];
  const corner = (ccx, ccz, a0) => {
    const a = a0 + d / r;
    return { p: [ccx + Math.cos(a) * r, ccz + Math.sin(a) * r], n: [Math.cos(a), Math.sin(a)] };
  };
  switch (i) {
    case 0: return { p: [cx[0] + d, zmin], n: [0, -1] }; // norte
    case 1: return corner(cx[1], cz[0], -Math.PI / 2);
    case 2: return { p: [xmax, cz[0] + d], n: [1, 0] }; // leste
    case 3: return corner(cx[1], cz[1], 0);
    case 4: return { p: [cx[1] - d, zmax], n: [0, 1] }; // sul
    case 5: return corner(cx[0], cz[1], Math.PI / 2);
    case 6: return { p: [xmin, cz[1] - d], n: [-1, 0] }; // oeste
    default: return corner(cx[0], cz[0], Math.PI);
  }
}

const CONTOUR_N = 128;
const contour = [];
for (let i = 0; i < CONTOUR_N; i++) {
  const t = i / CONTOUR_N;
  const s = roundedRectSample(t);
  const inset = 0.8 + 0.8 * periodicNoise(t); // 0..1.6 para dentro
  const Q = [s.p[0], s.p[1]];
  const m = s.n; // normal "limpa" do retângulo arredondado (convexo)
  const P = [Q[0] - m[0] * inset, Q[1] - m[1] * inset];
  // quanto esta borda é "norte" (1) ou "sul" (-1). A câmera fica ao sul do player.
  const northness = -m[1];
  // falésias altas ao norte, baixas ao sul (pra câmera nunca entrar no morro)
  const hBase = lerp(2.4, 6.2, smooth((northness + 1) / 2));
  const h = hBase + 0.9 * fbm(Q[0] * 0.15, Q[1] * 0.15);
  contour.push({ t, Q, m, P, northness, h: Math.max(2.3, h) });
}
// normal suavizada do contorno ruidoso
for (let i = 0; i < CONTOUR_N; i++) {
  const a = contour[(i - 2 + CONTOUR_N) % CONTOUR_N].P;
  const b = contour[(i + 2) % CONTOUR_N].P;
  const tx = b[0] - a[0], tz = b[1] - a[1];
  let n = [tz, -tx]; // perpendicular
  const l = Math.hypot(n[0], n[1]);
  n = [n[0] / l, n[1] / l];
  if (n[0] * contour[i].m[0] + n[1] * contour[i].m[1] < 0) n = [-n[0], -n[1]];
  contour[i].n = n;
}

const contourPoly = contour.map((c) => c.P);
function pointInPoly(x, z, poly = contourPoly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function distToSeg(px, pz, a, b) {
  const vx = b[0] - a[0], vz = b[1] - a[1];
  const t = clamp(((px - a[0]) * vx + (pz - a[1]) * vz) / (vx * vx + vz * vz || 1), 0, 1);
  return Math.hypot(px - (a[0] + vx * t), pz - (a[1] + vz * t));
}
function distToPolyline(x, z, pts, closed = false) {
  let d = Infinity;
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) d = Math.min(d, distToSeg(x, z, pts[i], pts[(i + 1) % n]));
  return d;
}
/** distância com sinal até o contorno: negativa dentro da clareira */
const signedContourDist = (x, z) => (pointInPoly(x, z) ? -1 : 1) * distToPolyline(x, z, contourPoly, true);
const distToPaths = (x, z) => Math.min(...PATHS.map((p) => distToPolyline(x, z, p)));
// a câmera do jogo fica 5u ao sul (+z) e 5u acima do player: nada alto logo "atrás" dos POIs
const inCameraShadow = (x, z) =>
  Object.values(POIS).some((p) => Math.abs(x - p.x) < 1.7 && z > p.z && z < p.z + 4.2) ||
  // visão inicial: câmera atrás do spawn livre
  (Math.abs(x - POIS.spawn.x) < 4.8 && z > POIS.spawn.z - 0.5 && z < POIS.spawn.z + 6);
const poiDist = (x, z, key) => Math.hypot(x - POIS[key].x, z - POIS[key].z);
function clearOfPois(x, z, extra = 0) {
  for (const k in POIS) if (poiDist(x, z, k) < POIS[k].clear + extra) return false;
  return true;
}
function nearestContour(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < CONTOUR_N; i++) {
    const d = Math.hypot(x - contour[i].P[0], z - contour[i].P[1]);
    if (d < bd) (bd = d), (best = i);
  }
  return contour[best];
}

// ---------------------------------------------------------------------------
// Meshes
// ---------------------------------------------------------------------------
const M = {
  terrain: new MeshBuilder("terrain"),
  terrain_far: new MeshBuilder("terrain_far"),
  paths: new MeshBuilder("paths"),
  rocks: new MeshBuilder("rocks"),
  trees: new MeshBuilder("trees"),
  trees_rim: new MeshBuilder("trees_rim"),
  trees_far: new MeshBuilder("trees_far"),
  decor: new MeshBuilder("decor"),
  colliders: new MeshBuilder("colliders"),
};
const UP = [0, 1, 0];

// --- 1. Chão da clareira (grade 2x2, só onde precisa) ----------------------
{
  const cell = 2;
  const grass = color("grass", 0);
  for (let x = AREA.xmin - 4; x < AREA.xmax + 4; x += cell) {
    for (let z = AREA.zmin - 4; z < AREA.zmax + 4; z += cell) {
      const corners = [[x, z], [x + cell, z], [x + cell, z + cell], [x, z + cell]];
      if (!corners.every(([cx, cz]) => signedContourDist(cx, cz) < 2.2)) continue;
      const v = corners.map(([cx, cz]) => M.terrain.v([cx, GROUND_Y, cz], grass));
      M.terrain.tri(v[0], v[1], v[2], UP);
      M.terrain.tri(v[0], v[2], v[3], UP);
    }
  }
}

// --- 2. Falésias + planalto + horizonte ------------------------------------
// Anéis ao redor do contorno (de dentro pra fora)
const rings = [];
{
  const ring = (fn) => contour.map((c, i) => fn(c, i));
  const off = (c, d, y, j = 0) => [c.P[0] + c.n[0] * (d + j), y, c.P[1] + c.n[1] * (d + j)];
  const offQ = (c, d, y) => [c.Q[0] + c.m[0] * d, y, c.Q[1] + c.m[1] * d];

  const jit = contour.map(() => [rand(-0.18, 0.22), rand(-0.18, 0.22), rand(-0.15, 0.25), rand(-0.2, 0.2)]);
  rings.push(ring((c) => off(c, -0.18, GROUND_Y - 0.45))); // r0 base
  rings.push(ring((c, i) => off(c, 0.12, c.h * 0.42 + jit[i][3] * 0.6, jit[i][0]))); // r1
  rings.push(ring((c, i) => off(c, 0.32, c.h * 0.82, jit[i][1]))); // r2
  rings.push(ring((c, i) => off(c, 0.75, c.h, jit[i][2]))); // r3 topo
  rings.push(
    ring((c) => {
      // ao sul a borda já começa a descer (câmera fica ao sul do player)
      const southDrop = c.northness < -0.3 ? 1.2 * smooth(clamp(-c.northness, 0, 1)) : 0;
      return off(c, 2.4, c.h + 0.25 - southDrop + 0.25 * fbm(c.P[0] * 0.4, c.P[1] * 0.4));
    }),
  ); // r4 borda
  // r5 planalto: sobe ao norte, desce ao sul (câmera fica ao sul do player)
  rings.push(
    ring((c) => {
      const y = c.northness < -0.3 ? c.h - 1.2 - 4.2 * smooth(clamp(-c.northness, 0, 1)) : c.h + 0.6 + 1.4 * fbm(c.Q[0] * 0.2 + 3, c.Q[1] * 0.2);
      return offQ(c, 9, y);
    }),
  );
  rings.push(
    ring((c) => {
      const north = smooth((c.northness + 1) / 2);
      return offQ(c, 24, lerp(0.2, 6.5, north) + 3.5 * fbm(c.Q[0] * 0.08 - 5, c.Q[1] * 0.08));
    }),
  );
  rings.push(ring((c) => offQ(c, 55, 9 + 10 * Math.abs(fbm(c.Q[0] * 0.05 + 11, c.Q[1] * 0.05 + 2)) + 4 * smooth((c.northness + 1) / 2)))); // montanhas
  rings.push(ring((c) => offQ(c, 95, -6))); // borda do mundo (fica abaixo do horizonte)

  const inwardUp = (c) => (center) => norm([-c.n[0], 1.15, -c.n[1]]);
  for (let r = 0; r < rings.length - 1; r++) {
    const target = r < 4 ? M.terrain : M.terrain_far;
    for (let i = 0; i < CONTOUR_N; i++) {
      const j = (i + 1) % CONTOUR_N;
      const a = rings[r][i], b = rings[r][j], c2 = rings[r + 1][j], d = rings[r + 1][i];
      const towards = inwardUp(contour[i]);
      const flip = (i + r) % 2 === 0;
      if (r <= 2) target.slopeQuad(a, b, c2, d, towards, flip, 0.72, true);
      else target.slopeQuad(a, b, c2, d, towards, flip, r >= 5 ? 0.62 : 0.7);
    }
  }
}

// Altura do terreno em (x,z) – busca no próprio mesh (grade espacial)
const heightIndex = new Map();
const HCELL = 3;
const terrainMeshesForHeight = [M.terrain, M.terrain_far];
for (const mb of terrainMeshesForHeight) {
  for (let t = 0; t < mb.triCount; t++) {
    const tri = [mb.p(mb.idx[t * 3]), mb.p(mb.idx[t * 3 + 1]), mb.p(mb.idx[t * 3 + 2])];
    const xs = tri.map((p) => p[0]), zs = tri.map((p) => p[2]);
    for (let gx = Math.floor(Math.min(...xs) / HCELL); gx <= Math.floor(Math.max(...xs) / HCELL); gx++)
      for (let gz = Math.floor(Math.min(...zs) / HCELL); gz <= Math.floor(Math.max(...zs) / HCELL); gz++) {
        const k = gx + "," + gz;
        if (!heightIndex.has(k)) heightIndex.set(k, []);
        heightIndex.get(k).push(tri);
      }
  }
}
function terrainAt(x, z) {
  const tris = heightIndex.get(Math.floor(x / HCELL) + "," + Math.floor(z / HCELL)) || [];
  let best = null;
  for (const [a, b, c] of tris) {
    const v0x = c[0] - a[0], v0z = c[2] - a[2], v1x = b[0] - a[0], v1z = b[2] - a[2];
    const v2x = x - a[0], v2z = z - a[2];
    const d00 = v0x * v0x + v0z * v0z, d01 = v0x * v1x + v0z * v1z, d11 = v1x * v1x + v1z * v1z;
    const d20 = v2x * v0x + v2z * v0z, d21 = v2x * v1x + v2z * v1z;
    const den = d00 * d11 - d01 * d01;
    if (Math.abs(den) < 1e-9) continue;
    const u = (d11 * d20 - d01 * d21) / den, v = (d00 * d21 - d01 * d20) / den;
    if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
    const y = a[1] + u * (c[1] - a[1]) + v * (b[1] - a[1]);
    const n = norm(cross(sub(b, a), sub(c, a)));
    if (!best || y > best.y) best = { y, ny: Math.abs(n[1]) };
  }
  return best;
}

// --- 3. Trilhas --------------------------------------------------------------
function ribbon(mb, pts, width, y, col) {
  const hw = width / 2;
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
    let dir;
    if (i === 0) dir = [next[0] - pts[i][0], next[1] - pts[i][1]];
    else if (i === pts.length - 1) dir = [pts[i][0] - prev[0], pts[i][1] - prev[1]];
    else {
      const d1 = norm([pts[i][0] - prev[0], 0, pts[i][1] - prev[1]]);
      const d2 = norm([next[0] - pts[i][0], 0, next[1] - pts[i][1]]);
      dir = [d1[0] + d2[0], d1[2] + d2[2]];
    }
    const l = Math.hypot(dir[0], dir[1]);
    const nrm = [-dir[1] / l, dir[0] / l];
    let miter = 1;
    if (i > 0 && i < pts.length - 1) {
      const d1 = norm([pts[i][0] - prev[0], 0, pts[i][1] - prev[1]]);
      miter = 1 / Math.max(0.6, Math.abs(nrm[0] * -d1[2] + nrm[1] * d1[0]));
    }
    left.push(mb.v([pts[i][0] + nrm[0] * hw * miter, y, pts[i][1] + nrm[1] * hw * miter], col));
    right.push(mb.v([pts[i][0] - nrm[0] * hw * miter, y, pts[i][1] - nrm[1] * hw * miter], col));
  }
  for (let i = 0; i < pts.length - 1; i++) {
    mb.tri(left[i], right[i], right[i + 1], UP);
    mb.tri(left[i], right[i + 1], left[i + 1], UP);
  }
  // juntas arredondadas (octógono) nos vértices internos
  for (let i = 1; i < pts.length; i++) disc(mb, pts[i][0], pts[i][1], hw * 1.02, y, col, 8);
}
function disc(mb, x, z, r, y, col, seg = 8, jitter = 0) {
  const c = mb.v([x, y, z], col);
  const ring = [];
  for (let k = 0; k < seg; k++) {
    const a = (k / seg) * Math.PI * 2 + Math.PI / seg;
    const rr = r * (1 + rand(-jitter, jitter));
    ring.push(mb.v([x + Math.cos(a) * rr, y, z + Math.sin(a) * rr], col));
  }
  for (let k = 0; k < seg; k++) mb.tri(c, ring[k], ring[(k + 1) % seg], UP);
}
{
  const dirt = color("dirt", 0);
  for (const p of PATHS) ribbon(M.paths, p, PATH_WIDTH, GROUND_Y + 0.012, dirt);
  // terra remexida onde o zumbi levanta
  disc(M.decor, POIS.zombie.x, POIS.zombie.z, 0.8, GROUND_Y + 0.016, color("dirt", 0.02), 9, 0.2);
}

// --- 4. Primitivas -----------------------------------------------------------
function prism(mb, base, top, r0, r1, sides, col, rot = 0, collide = null) {
  const b = [], t = [];
  for (let k = 0; k < sides; k++) {
    const a = rot + (k / sides) * Math.PI * 2;
    b.push(mb.v([base[0] + Math.cos(a) * r0, base[1], base[2] + Math.sin(a) * r0], col));
    t.push(mb.v([top[0] + Math.cos(a) * r1, top[1], top[2] + Math.sin(a) * r1], col));
  }
  const axis = (p) => {
    // ponto mais próximo no eixo
    const ab = sub(top, base);
    const tt = clamp(dot(sub(p, base), ab) / dot(ab, ab), 0, 1);
    return sub(p, add(base, mul(ab, tt)));
  };
  for (let k = 0; k < sides; k++) {
    const k2 = (k + 1) % sides;
    mb.tri(b[k], b[k2], t[k2], axis);
    mb.tri(b[k], t[k2], t[k], axis);
  }
  return { b, t };
}
function capFan(mb, ring, dir) {
  for (let k = 1; k < ring.length - 1; k++) mb.tri(ring[0], ring[k], ring[k + 1], dir);
}

/** Pinheiro em camadas quadradas (igual ao estilo do mapa antigo) */
function pine(mb, x, y, z, H, { tiers = 6, trunkSides = 6, lod = false } = {}) {
  const rot = rand(0, Math.PI / 2);
  const trunkCol = color("trunk", 0.06);
  const leafCol = color("foliage", 0.07, 0.03);
  const rTrunk = 0.06 + H * 0.017;
  prism(mb, [x, y - 0.2, z], [x, y + H * 0.72, z], rTrunk, rTrunk * 0.65, trunkSides, trunkCol, rot);

  const y0 = y + H * rand(0.2, 0.27);
  const F = y + H - y0;
  const s = F / (tiers + 0.55);
  const Rb = H * rand(0.23, 0.27);
  for (let k = 0; k < tiers; k++) {
    const t = tiers === 1 ? 0 : k / (tiers - 1);
    const rb = Rb * (1 - 0.7 * t);
    const yb = y0 + k * s;
    const last = k === tiers - 1;
    const yt = last ? y + H : yb + s * 1.45;
    const rt = last ? 0 : rb * 0.42;
    const tw = rot + rand(-0.12, 0.12);
    const ring = (r, yy) =>
      Array.from({ length: 4 }, (_, j) => {
        const a = tw + Math.PI / 4 + (j * Math.PI) / 2;
        return mb.v([x + Math.cos(a) * r, yy, z + Math.sin(a) * r], leafCol);
      });
    const B = ring(rb, yb);
    const axisOut = (p) => [p[0] - x, 0.4, p[2] - z];
    if (last) {
      const apex = mb.v([x, yt, z], leafCol);
      for (let j = 0; j < 4; j++) mb.tri(B[j], B[(j + 1) % 4], apex, axisOut);
    } else {
      const T = ring(rt, yt);
      for (let j = 0; j < 4; j++) {
        const j2 = (j + 1) % 4;
        mb.tri(B[j], B[j2], T[j2], axisOut);
        mb.tri(B[j], T[j2], T[j], axisOut);
      }
    }
    if (!lod || k === 0) capFan(mb, B, [0, -1, 0]);
  }
}

/** Árvore seca com galhos */
function deadTree(mb, x, y, z, H) {
  const col = color("trunk", 0.08);
  const lean = [rand(-0.15, 0.15), 0, rand(-0.15, 0.15)];
  const r0 = 0.09 + H * 0.012;
  const mid = [x + lean[0] * H * 0.5, y + H * 0.55, z + lean[2] * H * 0.5];
  const top = [x + lean[0] * H, y + H, z + lean[2] * H];
  const rot = rand(0, 6);
  prism(mb, [x, y - 0.2, z], mid, r0, r0 * 0.65, 5, col, rot);
  const seg2 = prism(mb, mid, top, r0 * 0.65, r0 * 0.15, 5, col, rot);
  const apex = mb.v(add(top, [lean[0] * 0.4, 0.35, lean[2] * 0.4]), col);
  for (let k = 0; k < 5; k++) mb.tri(seg2.t[k], seg2.t[(k + 1) % 5], apex, (p) => sub(p, top));
  const branches = randInt(7, 12);
  for (let i = 0; i < branches; i++) {
    const hb = rand(0.32, 0.93);
    const base = [x + lean[0] * H * hb, y + H * hb, z + lean[2] * H * hb];
    const az = rand(0, Math.PI * 2);
    const el = rand(-0.55, 0.65);
    const L = H * rand(0.12, 0.26) * (1.15 - hb * 0.6);
    const dir = [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)];
    const tip = add(base, mul(dir, L));
    const br = 0.035;
    const side = norm(cross(dir, UP));
    const up2 = norm(cross(side, dir));
    const tri = [0, 1, 2].map((k) => {
      const a = (k / 3) * Math.PI * 2;
      return mb.v(add(base, add(mul(side, Math.cos(a) * br), mul(up2, Math.sin(a) * br))), col);
    });
    const tipI = mb.v(tip, col);
    for (let k = 0; k < 3; k++) mb.tri(tri[k], tri[(k + 1) % 3], tipI, (p) => sub(p, base));
  }
}

/** Tronco caído */
function fallenLog(mb, x, z, L, r) {
  const col = color("trunk", 0.08);
  const a = rand(0, Math.PI);
  const d = [Math.cos(a) * L * 0.5, 0, Math.sin(a) * L * 0.5];
  const y = GROUND_Y + r * 0.75;
  const p0 = sub([x, y, z], d), p1 = add([x, y, z], d);
  // prisma deitado: monta em espaço local
  const sides = 6;
  const axis = norm(sub(p1, p0));
  const side = norm(cross(axis, UP));
  const up = cross(side, axis);
  const ringAt = (c, rr) =>
    Array.from({ length: sides }, (_, k) => {
      const ang = (k / sides) * Math.PI * 2;
      return mb.v(add(c, add(mul(side, Math.cos(ang) * rr), mul(up, Math.sin(ang) * rr))), col);
    });
  const A = ringAt(p0, r), B = ringAt(p1, r * 0.9);
  const out = (p) => {
    const t = dot(sub(p, p0), axis);
    return sub(p, add(p0, mul(axis, t)));
  };
  for (let k = 0; k < sides; k++) {
    const k2 = (k + 1) % sides;
    mb.tri(A[k], A[k2], B[k2], out);
    mb.tri(A[k], B[k2], B[k], out);
  }
  capFan(mb, A, mul(axis, -1));
  capFan(mb, B, axis);
  // galhos quebrados
  for (let i = 0; i < 3; i++) {
    const t = rand(0.2, 0.8);
    const base = add(p0, mul(sub(p1, p0), t));
    const dir = norm([rand(-1, 1), rand(0.3, 1), rand(-1, 1)]);
    const tip = mb.v(add(base, mul(dir, rand(0.3, 0.6))), col);
    const s2 = norm(cross(dir, UP)), u2 = norm(cross(s2, dir));
    const tri = [0, 1, 2].map((k) => {
      const ang = (k / 3) * Math.PI * 2;
      return mb.v(add(base, add(mul(s2, Math.cos(ang) * 0.04), mul(u2, Math.sin(ang) * 0.04))), col);
    });
    for (let k = 0; k < 3; k++) mb.tri(tri[k], tri[(k + 1) % 3], tip, (p) => sub(p, base));
  }
  // colisor: caixa simples ao redor do tronco
  const c = M.colliders;
  const corners = [];
  for (const s of [-1, 1]) for (const e of [p0, p1]) for (const hgt of [GROUND_Y - 0.1, y + r]) corners.push([e[0] + side[0] * s * r, hgt, e[2] + side[2] * s * r]);
  boxFromCorners(c, corners, [x, y, z]);
  return { p0, p1 };
}
function boxFromCorners(mb, pts, center) {
  // pts: 8 pontos (2 lados × 2 pontas × 2 alturas) – gera casca convexa simples
  const col = [1, 0, 0];
  const v = pts.map((p) => mb.v(p, col));
  const faces = [
    [0, 1, 3, 2], [4, 5, 7, 6], // lados
    [0, 1, 5, 4], [2, 3, 7, 6], // pontas
    [1, 3, 7, 5], // topo
  ];
  for (const f of faces) {
    mb.tri(v[f[0]], v[f[1]], v[f[2]], (p) => sub(p, center));
    mb.tri(v[f[0]], v[f[2]], v[f[3]], (p) => sub(p, center));
  }
}

// Icosaedro base
const ICO = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
  const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  return { v, f };
})();
function icoDetail1() {
  const v = ICO.v.slice(), f = [];
  const cache = new Map();
  const mid = (a, b) => {
    const k = a < b ? a + "_" + b : b + "_" + a;
    if (!cache.has(k)) {
      v.push(norm(mul(add(v[a], v[b]), 0.5)));
      cache.set(k, v.length - 1);
    }
    return cache.get(k);
  };
  for (const [a, b, c] of ICO.f) {
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    f.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
  }
  return { v, f };
}
const ICO1 = icoDetail1();

/** Rochedo facetado. Retorna raio aproximado no chão. */
function boulder(mb, x, z, { rx, ry, rz, detail = 0, bury = 0.4, baseY = GROUND_Y, col = null, jitter = 0.2 }) {
  const shape = detail ? ICO1 : ICO;
  const rot = rand(0, Math.PI * 2);
  const c = col ?? color("rock", 0.07);
  const cy = baseY + ry * (1 - bury);
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const verts = shape.v.map((p) => {
    const k = 1 + rand(-jitter, jitter);
    let lx = p[0] * rx * k, ly = p[1] * ry * k, lz = p[2] * rz * k;
    const minLy = -ry * (1 - bury) - 0.08; // base achatada logo abaixo do chão
    if (ly < minLy) ly = minLy;
    return mb.v([x + lx * cr - lz * sr, cy + ly, z + lx * sr + lz * cr], c);
  });
  const center = [x, cy, z];
  for (const [a, b, d] of shape.f) mb.tri(verts[a], verts[b], verts[d], (p) => sub(p, center));
  return { top: cy + ry, r: Math.max(rx, rz) };
}

// --- 5. Rochedos na base das falésias (quebra a linha da parede) ------------
const placedRocks = []; // {x,z,r}
{
  let i = randInt(0, 3);
  while (i < CONTOUR_N) {
    const c = contour[i];
    const south = c.northness < -0.4;
    const size = rand(0.9, south ? 1.4 : 2.1);
    const into = rand(0.1, 0.5) * size;
    const x = c.P[0] + c.n[0] * into + rand(-0.3, 0.3);
    const z = c.P[1] + c.n[1] * into + rand(-0.3, 0.3);
    // sempre bem mais baixo que a falésia: pulo (0.42) + degrau da cápsula (0.35)
    // nunca alcança o topo, então a pedra não vira escada pra fora do mapa
    const maxTop = c.h - 1.8;
    const ry = Math.min(size * rand(0.75, 1.25), maxTop / ((2 - 0.35) * 1.16));
    if (clearOfPois(x, z, 1.0)) {
      boulder(M.rocks, x, z, { rx: size * rand(0.9, 1.4), ry, rz: size * rand(0.8, 1.2), detail: 1, bury: 0.35, jitter: 0.16 });
      placedRocks.push({ x, z, r: size * 1.2 });
    }
    i += randInt(2, 5);
  }
  // pilhas de pedra onde as trilhas encontram a falésia
  for (const p of PATHS) {
    for (const end of [p[0], p[p.length - 1]]) {
      if (signedContourDist(end[0], end[1]) < 0) continue; // ponta interna (junção)
      // acha o ponto onde a trilha cruza o contorno
      const next = end === p[0] ? p[1] : p[p.length - 2];
      let cx = end[0], cz = end[1];
      for (let t = 0; t <= 1; t += 0.02) {
        const x = lerp(end[0], next[0], t), z = lerp(end[1], next[1], t);
        if (signedContourDist(x, z) < 0) {
          cx = x;
          cz = z;
          break;
        }
      }
      const c = nearestContour(cx, cz);
      for (let k = 0; k < 3; k++) {
        const s = rand(0.7, 1.3);
        const x = cx + c.n[0] * rand(0, 0.6) + c.n[1] * rand(-1.4, 1.4);
        const z = cz + c.n[1] * rand(0, 0.6) - c.n[0] * rand(-1.4, 1.4);
        boulder(M.rocks, x, z, { rx: s * 1.1, ry: Math.min(s, (c.h - 1.8) / (1.7 * 1.2)), rz: s, detail: 1, bury: 0.3 });
        placedRocks.push({ x, z, r: s * 1.1 });
      }
    }
  }
}

// --- 6. Árvores e pedras da clareira ----------------------------------------
const placedTrees = []; // {x,z,r}
function farFromAll(x, z, list, minD) {
  for (const o of list) if (Math.hypot(x - o.x, z - o.z) < minD + (o.r ?? 0)) return false;
  return true;
}
{
  // pedras soltas na clareira (bem menos que antes e nenhuma perto do spawn)
  let tries = 0, count = 0;
  while (count < 16 && tries++ < 4000) {
    const x = rand(AREA.xmin, AREA.xmax), z = rand(AREA.zmin, AREA.zmax);
    if (signedContourDist(x, z) > -2.2) continue;
    if (poiDist(x, z, "spawn") < SPAWN_ROCK_FREE_RADIUS) continue;
    if (!clearOfPois(x, z, 1.2) || distToPaths(x, z) < PATH_WIDTH / 2 + 1.0) continue;
    if (!farFromAll(x, z, placedRocks, 2.5)) continue;
    const big = rng() < 0.3;
    const s = big ? rand(0.7, 1.1) : rand(0.3, 0.6);
    boulder(M.rocks, x, z, { rx: s * rand(0.9, 1.4), ry: s * rand(0.6, 1.0), rz: s * rand(0.8, 1.2), detail: big ? 1 : 0, bury: 0.35 });
    placedRocks.push({ x, z, r: s * 1.3 });
    count++;
  }
  // pedrinhas rasteiras (só visual, não atrapalham andar)
  tries = 0;
  count = 0;
  while (count < 26 && tries++ < 4000) {
    const x = rand(AREA.xmin, AREA.xmax), z = rand(AREA.zmin, AREA.zmax);
    if (signedContourDist(x, z) > -1) continue;
    if (!clearOfPois(x, z, 0.3)) continue;
    const s = rand(0.12, 0.26);
    boulder(M.decor, x, z, { rx: s * 1.3, ry: s * 0.45, rz: s, bury: 0.45 });
    count++;
  }

  // troncos caídos
  tries = 0;
  count = 0;
  while (count < 6 && tries++ < 3000) {
    const x = rand(AREA.xmin, AREA.xmax), z = rand(AREA.zmin, AREA.zmax);
    if (signedContourDist(x, z) > -2.5 || poiDist(x, z, "spawn") < 8) continue;
    if (!clearOfPois(x, z, 2) || distToPaths(x, z) < 2.4) continue;
    if (!farFromAll(x, z, placedRocks, 2.2)) continue;
    const L = rand(2.0, 3.2);
    fallenLog(M.trees, x, z, L, rand(0.15, 0.22));
    placedRocks.push({ x, z, r: L * 0.5 });
    count++;
  }

  // árvores (poisson simples)
  tries = 0;
  while (tries++ < 30000) {
    const x = rand(AREA.xmin - 1, AREA.xmax + 1), z = rand(AREA.zmin - 1, AREA.zmax + 1);
    const sd = signedContourDist(x, z);
    if (sd > -0.9) continue;
    if (!clearOfPois(x, z)) continue;
    if (distToPaths(x, z) < PATH_WIDTH / 2 + 0.55) continue;
    const dSpawn = poiDist(x, z, "spawn");
    if (dSpawn < HUB_RADIUS && rng() < 0.7) continue; // hub mais aberto
    if (inCameraShadow(x, z)) continue; // não tapar NPCs/itens na visão da câmera
    const minD = 1.4;
    if (!farFromAll(x, z, placedTrees, minD)) continue;
    if (!farFromAll(x, z, placedRocks, 0.5)) continue;
    const dead = rng() < 0.2;
    // mesma escala das árvores do mapa antigo (~2.5 a 4 unidades)
    const H = dead ? rand(2.5, 3.9) : rand(2.6, 4.1);
    if (dead) deadTree(M.trees, x, GROUND_Y, z, H);
    else pine(M.trees, x, GROUND_Y, z, H, { tiers: H > 3.4 ? 6 : 5 });
    placedTrees.push({ x, z, r: 0 });
    // colisor do tronco (octógono). Pinheiro um pouco mais largo = galhos de baixo
    const cr = dead ? 0.22 : 0.42;
    const pr = prism(M.colliders, [x, GROUND_Y - 0.2, z], [x, GROUND_Y + 2.6, z], cr, cr, 8, [1, 0, 0]);
    capFan(M.colliders, pr.t, UP);
  }
}

// --- 7. Floresta em cima das falésias e no horizonte -------------------------
{
  const placed = [];
  let tries = 0;
  while (tries++ < 60000) {
    const i = randInt(0, CONTOUR_N - 1);
    const c = contour[i];
    const along = rand(-0.5, 0.5);
    const c2 = contour[(i + 1) % CONTOUR_N];
    const bx = lerp(c.P[0], c2.P[0], along + 0.5), bz = lerp(c.P[1], c2.P[1], along + 0.5);
    const south = c.northness < -0.35;
    const dMin = south ? 11 : 1.3;
    const d = rand(dMin, 30);
    const x = bx + c.n[0] * d, z = bz + c.n[1] * d;
    if (signedContourDist(x, z) < dMin * 0.9) continue;
    const near = d < 10;
    const minD = near ? 1.35 : d < 18 ? 2.3 : 3.6;
    if (!farFromAll(x, z, placed, minD)) continue;
    const g = terrainAt(x, z);
    if (!g || g.ny < 0.8) continue;
    const dead = rng() < (near ? 0.12 : 0.05);
    const H = rand(3.6, 6.4) * (near ? 1 : 1.1);
    const mb = near ? M.trees_rim : M.trees_far;
    if (dead && near) deadTree(mb, x, g.y, z, H * 0.85);
    else if (near) pine(mb, x, g.y, z, H, { tiers: 5, trunkSides: 5 });
    else pine(mb, x, g.y, z, H, { tiers: 3, trunkSides: 4, lod: true });
    placed.push({ x, z, r: 0 });
  }
  // arbustos baixos na borda sul (não tapam a câmera)
  for (let i = 0; i < CONTOUR_N; i += 2) {
    const c = contour[i];
    if (c.northness > -0.3) continue;
    for (let k = 0; k < 1; k++) {
      const d = rand(5, 10);
      const x = c.P[0] + c.n[0] * d + rand(-0.5, 0.5), z = c.P[1] + c.n[1] * d + rand(-0.5, 0.5);
      const g = terrainAt(x, z);
      if (!g) continue;
      const s = rand(0.3, 0.55);
      boulder(M.decor, x, z, { rx: s * 1.3, ry: s * 0.7, rz: s * 1.1, bury: 0.3, baseY: g.y, col: color("bush", 0.08), jitter: 0.25 });
    }
  }
}

// --- 8. Cerca invisível no topo das falésias (rede de segurança) ------------
{
  const col = [1, 0, 0];
  const top = rings[3];
  for (let i = 0; i < CONTOUR_N; i++) {
    const j = (i + 1) % CONTOUR_N;
    const a = [top[i][0], contour[i].h - 1.2, top[i][2]];
    const b = [top[j][0], contour[j].h - 1.2, top[j][2]];
    const cc = [top[j][0], contour[j].h + 10, top[j][2]];
    const d = [top[i][0], contour[i].h + 10, top[i][2]];
    const inward = [-contour[i].n[0], 0, -contour[i].n[1]];
    M.colliders.quad(a, b, cc, d, col, inward);
  }
}

// ---------------------------------------------------------------------------
// GLB writer (sem dependências). Atributos: POSITION float32, COLOR_0 u8 norm.
// Sem NORMAL: o spec manda o cliente usar normais chapadas (flat) – perfeito
// pro visual low poly. No jogo usamos MeshLambertMaterial({ flatShading }).
// ---------------------------------------------------------------------------
function writeGLB(meshes, outPath) {
  const chunks = [];
  let byteOffset = 0;
  const bufferViews = [], accessors = [], gltfMeshes = [], nodes = [];
  const pushView = (typed, target) => {
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (buf.length % 4)) % 4;
    chunks.push(buf, Buffer.alloc(pad));
    bufferViews.push({ buffer: 0, byteOffset, byteLength: buf.length, target });
    byteOffset += buf.length + pad;
    return bufferViews.length - 1;
  };
  for (const mb of meshes) {
    if (!mb.triCount) continue;
    const pos = new Float32Array(mb.pos);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3)
      for (let k = 0; k < 3; k++) (min[k] = Math.min(min[k], pos[i + k])), (max[k] = Math.max(max[k], pos[i + k]));
    const col = new Uint8Array((mb.col.length / 3) * 4);
    for (let i = 0, j = 0; i < mb.col.length; i += 3, j += 4) {
      col[j] = Math.round(clamp(mb.col[i], 0, 1) * 255);
      col[j + 1] = Math.round(clamp(mb.col[i + 1], 0, 1) * 255);
      col[j + 2] = Math.round(clamp(mb.col[i + 2], 0, 1) * 255);
      col[j + 3] = 255;
    }
    const big = mb.vertCount > 65535;
    const idx = big ? new Uint32Array(mb.idx) : new Uint16Array(mb.idx);
    const vPos = pushView(pos, 34962), vCol = pushView(col, 34962), vIdx = pushView(idx, 34963);
    accessors.push({ bufferView: vPos, componentType: 5126, count: mb.vertCount, type: "VEC3", min, max });
    const aPos = accessors.length - 1;
    accessors.push({ bufferView: vCol, componentType: 5121, normalized: true, count: mb.vertCount, type: "VEC4" });
    const aCol = accessors.length - 1;
    accessors.push({ bufferView: vIdx, componentType: big ? 5125 : 5123, count: mb.idx.length, type: "SCALAR" });
    const aIdx = accessors.length - 1;
    const prim = { attributes: { POSITION: aPos, COLOR_0: aCol }, indices: aIdx, mode: 4 };
    if (mb.name !== "colliders") prim.material = 0;
    gltfMeshes.push({ name: mb.name, primitives: [prim] });
    nodes.push({ name: mb.name, mesh: gltfMeshes.length - 1 });
  }
  const json = {
    asset: { version: "2.0", generator: "unrender tools/generate-forest-map.mjs" },
    scene: 0,
    // playArea: contorno da clareira (x,z) – o jogo usa como trava de segurança
    scenes: [{ name: "unrender_forest", nodes: [nodes.length], extras: { playArea: contour.map((c) => [+c.P[0].toFixed(3), +c.P[1].toFixed(3)]) } }],
    nodes: [...nodes, { name: "unrender_forest", children: nodes.map((_, i) => i), extras: { seed: SEED, groundY: GROUND_Y, pois: POIS } }],
    meshes: gltfMeshes,
    materials: [{ name: "unrender_forest_vertex_color", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: byteOffset }],
  };
  let jsonBuf = Buffer.from(JSON.stringify(json));
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.concat([header, jh, jsonBuf, bh, bin]));
  return 12 + 16 + jsonBuf.length + bin.length;
}

const order = ["terrain", "paths", "rocks", "trees", "trees_rim", "trees_far", "terrain_far", "decor", "colliders"];
const size = writeGLB(order.map((k) => M[k]), OUT);
let total = 0;
for (const k of order) {
  console.log(`${k.padEnd(12)} ${String(M[k].triCount).padStart(7)} tris  ${String(M[k].vertCount).padStart(7)} verts`);
  if (k !== "colliders") total += M[k].triCount;
}
console.log(`render total ${total} tris | trees in clearing: ${placedTrees.length} | ${(size / 1024).toFixed(0)} KB -> ${OUT}`);
