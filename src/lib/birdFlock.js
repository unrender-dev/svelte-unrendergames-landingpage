/**
 * birdFlock.js — bando de pássaros low poly, instanciado e barato.
 *
 * - 5 draw calls para o bando inteiro (corpo + asa interna/externa de cada lado),
 *   funciona igual em WebGPU e WebGL (só InstancedMesh + material padrão).
 * - Asas articuladas em dois segmentos (ombro + ponta com atraso de fase),
 *   batida/planeio, inclinação nas curvas (bank), arfagem pela velocidade
 *   vertical e leve "quique" do corpo a cada batida.
 * - Boids com grade espacial (O(n)), integração por delta-time (mesma
 *   velocidade a 30 ou 144 FPS) e zero alocação por frame.
 * - Limites vêm do nosso mapa: passe `bounds` (ou use `boundsFromPlayArea`
 *   com o extras.playArea do unrender_forest.glb).
 *
 * Uso:
 *   const flock = createBirdFlock(THREE, { count: 80, bounds, minY, maxY, scale });
 *   scene.add(flock.object);
 *   // no loop: flock.update(delta, elapsed);
 */

const HASH_SIZE = 2048;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bounding box XZ de um polígono [[x,z],…] (extras.playArea do mapa), com escala e margem. */
export function boundsFromPlayArea(polygon, { scale = 1, offset = { x: 0, z: 0 }, margin = 0 } = {}) {
  let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
  for (const [x, z] of polygon) {
    xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
    zmin = Math.min(zmin, z); zmax = Math.max(zmax, z);
  }
  return {
    xmin: xmin * scale + offset.x - margin,
    xmax: xmax * scale + offset.x + margin,
    zmin: zmin * scale + offset.z - margin,
    zmax: zmax * scale + offset.z + margin,
  };
}

// ---------------------------------------------------------------------------
// Geometria (frente = +Z, cima = +Y, asa esquerda = +X), comprimento ~1
// ---------------------------------------------------------------------------
function colorize(THREE, geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), c);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function polyGeometry(THREE, pts, thickness = 0.02) {
  // Placa fina com tampa de cima e de baixo (sem DoubleSide), pts em XZ
  const n = pts.length;
  const verts = [];
  const half = thickness / 2;
  for (let i = 1; i < n - 1; i++) {
    // topo
    verts.push(pts[0][0], half, pts[0][1], pts[i + 1][0], half, pts[i + 1][1], pts[i][0], half, pts[i][1]);
    // baixo
    verts.push(pts[0][0], -half, pts[0][1], pts[i][0], -half, pts[i][1], pts[i + 1][0], -half, pts[i + 1][1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.computeVertexNormals();
  return g;
}

function mergeNonIndexed(THREE, geos) {
  let total = 0;
  const parts = geos.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    total += ng.attributes.position.count;
    return ng;
  });
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geos.forEach((g) => g.dispose());
  parts.forEach((g) => g.dispose());
  return out;
}

function buildGeometries(THREE, palette) {
  const back = new THREE.Color(palette.back);
  const belly = new THREE.Color(palette.belly);
  const beakC = new THREE.Color(palette.beak);
  const wingC = new THREE.Color(palette.wing);
  const tipC = new THREE.Color(palette.tip);

  // Corpo fusiforme
  const body = new THREE.SphereGeometry(0.5, 7, 5);
  body.scale(0.26, 0.24, 0.62);
  colorize(THREE, body, (x, y, z, c) => c.copy(belly).lerp(back, Math.min(1, Math.max(0, y * 4 + 0.55))));

  const head = new THREE.SphereGeometry(0.16, 6, 4);
  head.translate(0, 0.07, 0.36);
  colorize(THREE, head, (x, y, z, c) => c.copy(back));

  const beak = new THREE.ConeGeometry(0.05, 0.16, 4);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, 0.05, 0.56);
  colorize(THREE, beak, (x, y, z, c) => c.copy(beakC));

  // Cauda em leque
  const tail = polyGeometry(THREE, [[0, -0.22], [0.13, -0.58], [0.04, -0.52], [0, -0.6], [-0.04, -0.52], [-0.13, -0.58]], 0.015);
  tail.translate(0, 0.02, 0);
  colorize(THREE, tail, (x, y, z, c) => c.copy(back));

  const bodyGeo = mergeNonIndexed(THREE, [body, head, beak, tail]);

  // Asa interna (ombro em x=0, vai até x=0.48)
  const wingIn = polyGeometry(THREE, [[0, 0.16], [0.48, 0.1], [0.48, -0.16], [0, -0.14]], 0.02);
  colorize(THREE, wingIn, (x, y, z, c) => c.copy(wingC).lerp(back, 0.35 - x * 0.5));

  // Ponta da asa (primárias com bordo de fuga serrilhado), varrida pra trás
  const wingOut = polyGeometry(
    THREE,
    [[0, 0.1], [0.3, 0.02], [0.52, -0.12], [0.4, -0.15], [0.42, -0.2], [0.26, -0.18], [0.25, -0.22], [0.1, -0.18], [0, -0.16]],
    0.015,
  );
  colorize(THREE, wingOut, (x, y, z, c) => c.copy(wingC).lerp(tipC, Math.min(1, x * 2)));

  // Lado direito = espelho em X (inverte o winding para manter as normais certas)
  const mirror = (g) => {
    const m = g.clone();
    m.scale(-1, 1, 1);
    const p = m.attributes.position.array;
    const cArr = m.attributes.color.array;
    for (let i = 0; i < p.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t;
        const tc = cArr[i + 3 + k]; cArr[i + 3 + k] = cArr[i + 6 + k]; cArr[i + 6 + k] = tc;
      }
    }
    m.computeVertexNormals();
    return m;
  };
  const toNI = (g) => {
    const n = g.index ? g.toNonIndexed() : g;
    return n;
  };
  const wingInL = toNI(wingIn);
  const wingOutL = toNI(wingOut);
  return {
    body: bodyGeo,
    wingInL,
    wingInR: mirror(wingInL),
    wingOutL,
    wingOutR: mirror(wingOutL),
  };
}

// ---------------------------------------------------------------------------
// Bando
// ---------------------------------------------------------------------------
export const BIRD_PALETTES = {
  // Silhuetas escuras contra o pôr do sol (Home)
  sunset: { back: 0x2a2233, belly: 0x5a4a5e, beak: 0xf99126, wing: 0x3b3046, tip: 0x15111b, tints: [0xffffff, 0xe8d8ff, 0xffe2c8, 0xd0c4d8] },
  // Gaivotas/garças claras no céu azul (Jogos)
  day: { back: 0x8a94a6, belly: 0xf4f4f0, beak: 0xf2a33a, wing: 0xe9ecef, tip: 0x3a3f4a, tints: [0xffffff, 0xf3efe6, 0xe6eef7, 0xfff7e8] },
};

/**
 * @param {any} THREE  namespace do three (three ou three/webgpu)
 * @param {Object} o
 * @param {number} [o.count=60]
 * @param {{xmin:number,xmax:number,zmin:number,zmax:number}} o.bounds  área XZ (do mapa)
 * @param {number} o.minY
 * @param {number} o.maxY
 * @param {number} [o.scale=1]      comprimento do pássaro em unidades do mundo
 * @param {number} [o.speed]        velocidade de cruzeiro (padrão: 9*scale)
 * @param {keyof BIRD_PALETTES | object} [o.palette='day']
 * @param {boolean} [o.castShadow=false]
 * @param {number} [o.seed=1]
 */
export function createBirdFlock(THREE, o) {
  const maxCount = Math.max(1, o.count ?? 60);
  let count = maxCount;
  const scale = o.scale ?? 1;
  const bounds = { ...o.bounds };
  let minY = o.minY;
  let maxY = o.maxY;
  const cruise = o.speed ?? 9 * scale;
  const minSpeed = cruise * 0.6;
  const maxSpeed = cruise * 1.35;
  const maxForce = cruise * 1.6; // aceleração máx (unid/s²)
  const neighborR = 6 * scale;
  const sepR = 2.2 * scale;
  const rand = mulberry32(o.seed ?? 1);
  const palette = typeof o.palette === 'object' ? o.palette : BIRD_PALETTES[o.palette || 'day'];

  // ---- dados SoA ----
  const px = new Float32Array(maxCount), py = new Float32Array(maxCount), pz = new Float32Array(maxCount);
  const vx = new Float32Array(maxCount), vy = new Float32Array(maxCount), vz = new Float32Array(maxCount);
  const ax = new Float32Array(maxCount), ay = new Float32Array(maxCount), az = new Float32Array(maxCount);
  const phase = new Float32Array(maxCount);
  const flapHz = new Float32Array(maxCount);
  const glide = new Float32Array(maxCount); // 0 = batendo, 1 = planando (suavizado)
  const glideTimer = new Float32Array(maxCount);
  const roll = new Float32Array(maxCount);
  const yawPrev = new Float32Array(maxCount);
  const size = new Float32Array(maxCount);

  let cx = 0, cz = 0, ex = 1, ez = 1;
  const recenter = () => {
    cx = (bounds.xmin + bounds.xmax) / 2;
    cz = (bounds.zmin + bounds.zmax) / 2;
    ex = Math.max(1, (bounds.xmax - bounds.xmin) / 2);
    ez = Math.max(1, (bounds.zmax - bounds.zmin) / 2);
  };
  recenter();

  for (let i = 0; i < maxCount; i++) {
    // nascem em 2–3 grupinhos para o bando já parecer bando
    const g = i % 3;
    const gx = cx + (g - 1) * ex * 0.35, gz = cz + (g === 1 ? -0.3 : 0.25) * ez;
    px[i] = gx + (rand() - 0.5) * ex * 0.4;
    pz[i] = gz + (rand() - 0.5) * ez * 0.4;
    py[i] = minY + rand() * (maxY - minY);
    const a = rand() * Math.PI * 2;
    vx[i] = Math.sin(a) * cruise; vz[i] = Math.cos(a) * cruise; vy[i] = 0;
    phase[i] = rand() * Math.PI * 2;
    flapHz[i] = 2.6 + rand() * 1.4;
    glideTimer[i] = rand() * 4;
    size[i] = scale * (0.82 + rand() * 0.36);
    yawPrev[i] = a;
  }

  // ---- malhas ----
  const geos = buildGeometries(THREE, palette);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const object = new THREE.Group();
  object.name = 'bird_flock';
  const mk = (geo) => {
    const m = new THREE.InstancedMesh(geo, material, maxCount);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; // posições mudam todo frame; o bounding do instancing ficaria velho
    m.castShadow = Boolean(o.castShadow);
    m.receiveShadow = false;
    m.count = count;
    object.add(m);
    return m;
  };
  const body = mk(geos.body);
  const wInL = mk(geos.wingInL), wInR = mk(geos.wingInR);
  const wOutL = mk(geos.wingOutL), wOutR = mk(geos.wingOutR);
  const meshes = [body, wInL, wInR, wOutL, wOutR];

  // cor por pássaro (variação sutil)
  const tint = new THREE.Color();
  for (let i = 0; i < maxCount; i++) {
    tint.set(palette.tints[Math.floor(rand() * palette.tints.length)]);
    tint.multiplyScalar(0.88 + rand() * 0.24);
    for (const m of meshes) m.setColorAt(i, tint);
  }
  meshes.forEach((m) => { if (m.instanceColor) m.instanceColor.needsUpdate = true; });

  // ---- temporários (zero alocação no loop) ----
  const mBody = new THREE.Matrix4();
  const mTmp = new THREE.Matrix4();
  const mWing = new THREE.Matrix4();
  const mLocal = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const vPos = new THREE.Vector3();
  const vScale = new THREE.Vector3();
  const SHOULDER_L = new THREE.Vector3(0.1, 0.07, 0.06);
  const SHOULDER_R = new THREE.Vector3(-0.1, 0.07, 0.06);
  const INNER_LEN = 0.47;

  // grade espacial
  const cellOf = new Int32Array(maxCount);
  const cellCount = new Int32Array(HASH_SIZE);
  const cellStart = new Int32Array(HASH_SIZE + 1);
  const sorted = new Int32Array(maxCount);
  const inv = 1 / neighborR;
  const hash = (ix, iy, iz) => (((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) >>> 0) % HASH_SIZE;

  // alvo que passeia pelo mapa (faz o bando "desenhar" no céu)
  let tx = cx, ty = (minY + maxY) / 2, tz = cz;

  function buildGrid() {
    cellCount.fill(0);
    for (let i = 0; i < count; i++) {
      const h = hash(Math.floor(px[i] * inv), Math.floor(py[i] * inv), Math.floor(pz[i] * inv));
      cellOf[i] = h;
      cellCount[h]++;
    }
    let s = 0;
    for (let h = 0; h < HASH_SIZE; h++) { cellStart[h] = s; s += cellCount[h]; }
    cellStart[HASH_SIZE] = s;
    cellCount.fill(0);
    for (let i = 0; i < count; i++) {
      const h = cellOf[i];
      sorted[cellStart[h] + cellCount[h]++] = i;
    }
  }

  function steer(i) {
    const x = px[i], y = py[i], z = pz[i];
    let sx = 0, sy = 0, sz = 0, sn = 0;
    let alx = 0, aly = 0, alz = 0, coxs = 0, coys = 0, cozs = 0, nn = 0;
    const ix = Math.floor(x * inv), iy = Math.floor(y * inv), iz = Math.floor(z * inv);
    const r2 = neighborR * neighborR, s2 = sepR * sepR;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const h = hash(ix + dx, iy + dy, iz + dz);
      const end = cellStart[h] + cellCount[h];
      for (let k = cellStart[h]; k < end; k++) {
        const j = sorted[k];
        if (j === i) continue;
        const ddx = x - px[j], ddy = y - py[j], ddz = z - pz[j];
        const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
        if (d2 > r2) continue;
        if (d2 < s2 && d2 > 1e-6) {
          const w = 1 / d2;
          sx += ddx * w; sy += ddy * w; sz += ddz * w; sn++;
        }
        alx += vx[j]; aly += vy[j]; alz += vz[j];
        coxs += px[j]; coys += py[j]; cozs += pz[j]; nn++;
        if (nn > 9) break; // 10 vizinhos bastam (estilo estorninho)
      }
    }
    let fx = 0, fy = 0, fz = 0;
    if (sn) { fx += sx * sepR * 3.2 * cruise; fy += sy * sepR * 3.2 * cruise; fz += sz * sepR * 3.2 * cruise; }
    if (nn) {
      fx += (alx / nn - vx[i]) * 1.1; fy += (aly / nn - vy[i]) * 1.1; fz += (alz / nn - vz[i]) * 1.1;
      fx += (coxs / nn - x) * 0.55; fy += (coys / nn - y) * 0.55; fz += (cozs / nn - z) * 0.55;
    }
    // alvo passeando
    fx += (tx - x) * 0.06 * cruise / Math.max(ex, 1);
    fy += (ty - y) * 0.25;
    fz += (tz - z) * 0.06 * cruise / Math.max(ez, 1);
    // limites macios do mapa
    const margin = Math.min(ex, ez) * 0.15;
    if (x < bounds.xmin + margin) fx += (bounds.xmin + margin - x) * 2.5;
    else if (x > bounds.xmax - margin) fx -= (x - bounds.xmax + margin) * 2.5;
    if (z < bounds.zmin + margin) fz += (bounds.zmin + margin - z) * 2.5;
    else if (z > bounds.zmax - margin) fz -= (z - bounds.zmax + margin) * 2.5;
    if (y < minY) fy += (minY - y) * 6;
    else if (y > maxY) fy -= (y - maxY) * 4;
    // limita a força
    const f = Math.hypot(fx, fy, fz);
    if (f > maxForce) { const k = maxForce / f; fx *= k; fy *= k; fz *= k; }
    ax[i] = fx; ay[i] = fy; az[i] = fz;
  }

  let frame = 0;
  function update(delta, time) {
    const dt = Math.min(Math.max(delta, 0), 0.05);
    if (dt === 0) return;
    frame++;

    tx = cx + Math.sin(time * 0.071) * ex * 0.55 + Math.sin(time * 0.23) * ex * 0.15;
    tz = cz + Math.cos(time * 0.053) * ez * 0.55;
    ty = minY + (maxY - minY) * (0.5 + 0.35 * Math.sin(time * 0.11));

    buildGrid();
    // bandos grandes: metade recalcula forças por frame
    const stride = count > 90 ? 2 : 1;
    for (let i = frame % stride; i < count; i += stride) steer(i);

    for (let i = 0; i < count; i++) {
      vx[i] += ax[i] * dt; vy[i] += ay[i] * dt * 0.6; vz[i] += az[i] * dt;
      let sp = Math.hypot(vx[i], vy[i], vz[i]);
      // não deixa subir/descer íngreme demais
      const maxVy = sp * 0.45;
      if (vy[i] > maxVy) vy[i] = maxVy; else if (vy[i] < -maxVy) vy[i] = -maxVy;
      sp = Math.hypot(vx[i], vy[i], vz[i]);
      const clamp = sp > maxSpeed ? maxSpeed / sp : sp < minSpeed ? minSpeed / Math.max(sp, 1e-4) : 1;
      vx[i] *= clamp; vy[i] *= clamp; vz[i] *= clamp;
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;

      // --- comportamento de voo ---
      const hs = Math.hypot(vx[i], vz[i]);
      const climb = vy[i] / Math.max(sp, 1e-4);
      glideTimer[i] -= dt;
      let wantGlide = climb < -0.12 ? 1 : 0;
      if (glideTimer[i] < 0) {
        // alterna rajadas de batida com planeios curtos
        glideTimer[i] = 1.5 + rand() * 3.5;
        glide[i] = glide[i] > 0.5 ? 0 : (rand() < 0.45 ? 1 : 0);
      }
      const targetGlide = Math.max(wantGlide, glide[i] > 0.5 ? 1 : 0) * (climb > 0.12 ? 0 : 1);
      glide[i] += (targetGlide - glide[i]) * Math.min(1, dt * 3);
      const flapping = 1 - glide[i];
      phase[i] += dt * flapHz[i] * Math.PI * 2 * (0.35 + 0.65 * flapping) * (1 + Math.max(0, climb) * 0.8);

      const yaw = Math.atan2(vx[i], vz[i]);
      let dYaw = yaw - yawPrev[i];
      if (dYaw > Math.PI) dYaw -= Math.PI * 2; else if (dYaw < -Math.PI) dYaw += Math.PI * 2;
      yawPrev[i] = yaw;
      const turnRate = dYaw / dt;
      const targetRoll = Math.max(-0.95, Math.min(0.95, -turnRate * 0.55));
      roll[i] += (targetRoll - roll[i]) * Math.min(1, dt * 4);
      const pitch = -Math.atan2(vy[i], hs);

      const s = phase[i];
      const flapIn = Math.sin(s) * 0.85 * flapping + glide[i] * (0.1 + Math.sin(s * 0.5) * 0.03);
      const flapOut = Math.sin(s - 0.85) * 0.75 * flapping + glide[i] * 0.06 - 0.08 * flapping;
      const bob = -Math.sin(s) * 0.05 * flapping;

      // corpo
      e.set(pitch, yaw, roll[i]);
      q.setFromEuler(e);
      vPos.set(px[i], py[i] + bob * size[i], pz[i]);
      const sz = size[i];
      vScale.set(sz, sz, sz);
      mBody.compose(vPos, q, vScale);
      mBody.toArray(body.instanceMatrix.array, i * 16);

      // asa esquerda: ombro → rotação em Z (+ = sobe)
      mLocal.makeRotationZ(flapIn).setPosition(SHOULDER_L);
      mWing.multiplyMatrices(mBody, mLocal);
      mWing.toArray(wInL.instanceMatrix.array, i * 16);
      mLocal.makeRotationZ(flapOut).setPosition(INNER_LEN, 0, 0);
      mTmp.multiplyMatrices(mWing, mLocal);
      mTmp.toArray(wOutL.instanceMatrix.array, i * 16);

      // asa direita (espelho)
      mLocal.makeRotationZ(-flapIn).setPosition(SHOULDER_R);
      mWing.multiplyMatrices(mBody, mLocal);
      mWing.toArray(wInR.instanceMatrix.array, i * 16);
      mLocal.makeRotationZ(-flapOut).setPosition(-INNER_LEN, 0, 0);
      mTmp.multiplyMatrices(mWing, mLocal);
      mTmp.toArray(wOutR.instanceMatrix.array, i * 16);
    }

    for (const m of meshes) m.instanceMatrix.needsUpdate = true;
  }

  function setCount(n) {
    count = Math.max(0, Math.min(maxCount, Math.floor(n)));
    for (const m of meshes) m.count = count;
  }

  function setHeightRange(a, b) {
    minY = a;
    maxY = b;
  }

  function setBounds(b) {
    Object.assign(bounds, b);
    recenter();
  }

  function dispose() {
    object.removeFromParent();
    meshes.forEach((m) => {
      m.geometry.dispose();
      m.dispose?.();
    });
    material.dispose();
  }

  return { object, update, setCount, setHeightRange, setBounds, dispose, get count() { return count; } };
}
