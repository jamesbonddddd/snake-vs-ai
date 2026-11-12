// Snake skill-transfer trainer — zero backpropagation.
// Teacher v2: rule-based reflex expert, pure function of 12 sensor bits:
//   danger(3: S,L,R) | roomy(3: candidate cell has >=2 free neighbors)
//   | foodSector(3: 8 heading-relative bearings) | tailQuadrant(2: F/R/B/L)
//   | grown(1: length >= 15)
// Student: policy table over 4096 buckets x 3 relative actions (int8 -> ~12 KB).
// The BFS oracle is evaluation-only — it never teaches and never ships.
'use strict';

const GRID = 30;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // → ← ↓ ↑
const key = (x, y) => y * GRID + x;
const STALL_CAP = 600, MOVE_CAP = 2000;
const GROWN_AT = 45; // area-scaled for 30x30 (was 20 on 20x20)

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------- game sim ----------------
class Sim {
  constructor(rng) { this.rng = rng; this.reset(); }
  reset() {
    this.snake = [{ x: 10, y: 10 }, { x: 9, y: 10}, { x: 8, y: 10 }];
    this.dir = 0;
    this.score = 0;
    this.noFood = 0;
    this.moves = 0;
    this.spawnFood();
  }
  occupied() { return new Set(this.snake.map(c => key(c.x, c.y))); }
  spawnFood() {
    const occ = this.occupied();
    const free = [];
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++)
      if (!occ.has(key(x, y))) free.push({ x, y });
    this.food = free.length ? free[Math.floor(this.rng() * free.length)] : null;
  }
  step(dirIdx) {
    this.dir = dirIdx;
    const [dx, dy] = DIRS[dirIdx];
    const head = this.snake[0];
    const nx = head.x + dx, ny = head.y + dy;
    const eating = this.food && nx === this.food.x && ny === this.food.y;
    const blocked = new Set(this.snake.slice(0, eating ? undefined : -1).map(c => key(c.x, c.y)));
    if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID || blocked.has(key(nx, ny))) return 'dead';
    this.snake.unshift({ x: nx, y: ny });
    this.moves++;
    if (eating) { this.score++; this.noFood = 0; this.spawnFood(); return 'ate'; }
    this.snake.pop();
    this.noFood++;
    return this.noFood >= STALL_CAP || this.moves >= MOVE_CAP ? 'stalled' : 'ok';
  }
  bfs(start, goal, blocked) {
    const prev = new Map();
    const seen = new Set([key(start.x, start.y)]);
    const q = [start];
    while (q.length) {
      const c = q.shift();
      if (c.x === goal.x && c.y === goal.y) {
        const path = []; let cur = c;
        while (cur) { path.unshift(cur); cur = prev.get(key(cur.x, cur.y)); }
        return path;
      }
      for (const [dx, dy] of DIRS) {
        const nx = c.x + dx, ny = c.y + dy, k = key(nx, ny);
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID || seen.has(k)) continue;
        if (blocked.has(k) && !(nx === goal.x && ny === goal.y)) continue;
        seen.add(k); prev.set(k, c); q.push({ x: nx, y: ny });
      }
    }
    return null;
  }
  nextBody(next) {
    const eating = this.food && next.x === this.food.x && next.y === this.food.y;
    const body = [next, ...this.snake];
    if (!eating) body.pop();
    return body;
  }
  canReachTail(body) {
    const head = body[0], tail = body[body.length - 1];
    const blocked = new Set(body.slice(0, -1).map(c => key(c.x, c.y)));
    blocked.delete(key(head.x, head.y));
    return !!this.bfs(head, tail, blocked);
  }
  oracleDir() { // BFS pathfinder — evaluation reference only
    const head = this.snake[0], tail = this.snake[this.snake.length - 1];
    const bodyBlocked = new Set(this.snake.slice(0, -1).map(c => key(c.x, c.y)));
    if (this.food) {
      const toFood = this.bfs(head, this.food, bodyBlocked);
      if (toFood && toFood.length > 1 && this.canReachTail(this.nextBody(toFood[1]))) {
        return dirIndex(toFood[1].x - head.x, toFood[1].y - head.y);
      }
    }
    const toTail = this.bfs(head, tail, new Set(this.snake.slice(0, -1).map(c => key(c.x, c.y))));
    if (toTail && toTail.length > 1) return dirIndex(toTail[1].x - head.x, toTail[1].y - head.y);
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = DIRS[d];
      const nx = head.x + dx, ny = head.y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID || bodyBlocked.has(key(nx, ny))) continue;
      return d;
    }
    return this.dir;
  }
}
function dirIndex(dx, dy) { return DIRS.findIndex(([a, b]) => a === dx && b === dy); }

// ---------------- sensors: 12 bits ----------------
const N_BUCKETS = 4096;
const N_PARAMS = N_BUCKETS * 3; // relative actions: 0=S, 1=R, 2=L

function sensorBits(sim) {
  const head = sim.snake[0];
  const tail = sim.snake[sim.snake.length - 1];
  const d = sim.dir;
  const [hdx, hdy] = DIRS[d];
  const rel = [d, dirIndex(-hdy, hdx), dirIndex(hdy, -hdx)]; // S, R, L
  const eating = sim.food && DIRS.some(([ax, ay]) =>
    head.x + ax === sim.food.x && head.y + ay === sim.food.y);
  const body = new Set(sim.snake.slice(0, eating ? undefined : -1).map(c => key(c.x, c.y)));
  const blocked = (x, y) => x < 0 || y < 0 || x >= GRID || y >= GRID || body.has(key(x, y));
  const freeNof = (x, y) => {
    let n = 0;
    for (let k = 0; k < 4; k++) if (!blocked(x + DIRS[k][0], y + DIRS[k][1])) n++;
    return n;
  };
  let danger = 0, roomy = 0;
  const roomyList = [];
  for (let i = 0; i < 3; i++) {
    const [dx, dy] = DIRS[rel[i]];
    const nx = head.x + dx, ny = head.y + dy;
    if (blocked(nx, ny)) { danger |= 4 >> i; roomyList.push(0); }
    else { const r = freeNof(nx, ny) >= 2 ? 1 : 0; roomy |= r << (2 - i); roomyList.push(r); }
  }
  const bearing = (tx, ty) => {
    const fdx = tx - head.x, fdy = ty - head.y;
    const rx = fdx * hdx + fdy * hdy;
    const ry = -fdx * hdy + fdy * hdx;
    return Math.atan2(ry, rx);
  };
  const sector8 = (ang) => ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
  let foodSec = 0;
  if (sim.food) foodSec = sector8(bearing(sim.food.x, sim.food.y));
  const t8 = sector8(bearing(tail.x, tail.y));
  const tailQuad = (t8 === 0 || t8 === 1 || t8 === 7) ? 0 : (t8 === 2 || t8 === 3) ? 1 : t8 === 4 ? 2 : 3; // F,R,B,L
  const grown = sim.snake.length >= GROWN_AT ? 1 : 0;
  const bucket = (danger << 9) | (roomy << 6) | (foodSec << 3) | (tailQuad << 1) | grown;
  return { bucket, rel, danger, roomyList, foodSec, tailQuad, grown };
}

function bucketOf(sim) { return sensorBits(sim).bucket; }

// ---------------- teacher v2: pure reflex over the 12 bits ----------------
const FOOD_PREF = [
  [0],      // 0 ahead
  [1, 0],   // 1 ahead-right — turn INTO the target (straight is a tangent here)
  [1],      // 2 right
  [1],      // 3 right-behind
  [1, 2],   // 4 behind
  [2],      // 5 left-behind
  [2],      // 6 left
  [2, 0],   // 7 ahead-left — turn INTO the target
];
const TAIL_PREF = [0, 1, 2, 2]; // F→straight, R→right, B→left, L→left

function teacherDir(sim) {
  const { rel, danger, roomyList, foodSec, tailQuad, grown } = sensorBits(sim);
  const safe = [], roomySafe = [];
  for (let i = 0; i < 3; i++) {
    if ((danger >> (2 - i)) & 1) continue;
    safe.push(i);
    if (roomyList[i]) roomySafe.push(i);
  }
  if (!safe.length) return sim.dir; // trapped
  const pool = roomySafe.length ? roomySafe : safe;
  const greedy = FOOD_PREF[foodSec].find(p => safe.includes(p));

  if (grown) {
    // survival mode: chase the tail (it always moves), but fetch food whenever the
    // food cell is roomy (cheap "not a trap" proxy). Behind-sector food is ignored —
    // the tail-chase brings the bearing around.
    const aheadish = foodSec === 0 || foodSec === 1 || foodSec === 7;
    const sideway = (foodSec === 2 || foodSec === 6) && roomySafe.length >= 2;
    if (greedy !== undefined && roomyList[greedy] && (aheadish || sideway)) {
      return rel[greedy];
    }
    const want = TAIL_PREF[tailQuad];
    if (pool.includes(want)) return rel[want];
    return rel[pool[0]];
  }
  // small snake: pure greedy for food (proven rule), roomy fallback
  if (greedy !== undefined) return rel[greedy];
  return rel[pool[0]];
}

// ---------------- dataset: teacher-visited states ----------------
function collectDataset(nEpisodes) {
  const data = [];
  const seen = new Set();
  for (let e = 0; e < nEpisodes; e++) {
    const sim = new Sim(mulberry32(1000 + e * 7919));
    let state = 'ok', guard = 0;
    while (state === 'ok' && guard++ < MOVE_CAP) {
      const { rel } = sensorBits(sim);
      const action = teacherDir(sim);
      const relIdx = rel.indexOf(action);
      if (relIdx < 0) throw new Error('teacher action outside S/R/L');
      const b = bucketOf(sim);
      data.push(b * 4 + relIdx);
      seen.add(b);
      state = sim.step(action);
      if (state === 'ate') state = 'ok';
    }
  }
  return { data, seen };
}

// ---------------- table policy ----------------
function tableAction(prefs, bucket) {
  const base = bucket * 3;
  let best = 0, bestV = -Infinity;
  for (let k = 0; k < 3; k++) {
    const v = prefs[base + k];
    if (v > bestV) { bestV = v; best = k; }
  }
  return best;
}
function relToAbsolute(relIdx, curDir) {
  const [hdx, hdy] = DIRS[curDir];
  if (relIdx === 0) return curDir;
  if (relIdx === 1) return dirIndex(-hdy, hdx);
  return dirIndex(hdy, -hdx);
}

// ---------------- CEM imitation ----------------
function trainImitation(dataset) {
  const POP = 300, ELITE = 60, GENS = 150;
  let mu = new Float64Array(N_PARAMS);
  let sigma = new Float64Array(N_PARAMS).fill(0.5);
  const rng = mulberry32(42);
  const gauss = () => {
    const u = Math.max(rng(), 1e-12), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  let bestFit = -Infinity, bestTheta = null;
  for (let g = 0; g < GENS; g++) {
    const scored = [];
    for (let p = 0; p < POP; p++) {
      const th = new Float64Array(N_PARAMS);
      for (let i = 0; i < N_PARAMS; i++) th[i] = mu[i] + gauss() * sigma[i];
      let match = 0;
      for (const entry of dataset) {
        if (tableAction(th, entry >> 2) === (entry & 3)) match++;
      }
      const fit = match / dataset.length;
      scored.push({ th, fit });
      if (fit > bestFit) { bestFit = fit; bestTheta = Float64Array.from(th); }
    }
    scored.sort((a, b) => b.fit - a.fit);
    const elites = scored.slice(0, ELITE);
    for (let i = 0; i < N_PARAMS; i++) {
      let m = 0; for (const e of elites) m += e.th[i];
      m /= ELITE;
      let v = 0; for (const e of elites) v += (e.th[i] - m) ** 2;
      mu[i] = m;
      sigma[i] = Math.max(0.01, Math.sqrt(v / ELITE));
    }
    if (g % 25 === 0 || g === GENS - 1) console.log(`gen ${String(g).padStart(3)}  imitation ${elites[0].fit.toFixed(4)}`);
  }
  return bestTheta;
}

// ---------------- rollouts ----------------
function rollout(prefs, seed) {
  const sim = new Sim(mulberry32(seed));
  let state = 'ok', guard = 0;
  while (state === 'ok' && guard++ < MOVE_CAP) {
    const a = relToAbsolute(tableAction(prefs, bucketOf(sim)), sim.dir);
    state = sim.step(a);
    if (state === 'ate') state = 'ok';
  }
  return { score: sim.score, moves: sim.moves, died: state === 'dead' };
}
function rolloutWith(fn, seed) {
  const sim = new Sim(mulberry32(seed));
  let state = 'ok', guard = 0;
  while (state === 'ok' && guard++ < MOVE_CAP) {
    state = sim.step(fn(sim));
    if (state === 'ate') state = 'ok';
  }
  return { score: sim.score, moves: sim.moves, died: state === 'dead' };
}

// ---------------- int8 export ----------------
function exportPrefs(theta) {
  let maxAbs = 0;
  for (const v of theta) maxAbs = Math.max(maxAbs, Math.abs(v));
  const scale = maxAbs / 127;
  const i8 = new Int8Array(N_PARAMS);
  for (let i = 0; i < N_PARAMS; i++) i8[i] = Math.max(-127, Math.min(127, Math.round(theta[i] / scale)));
  const deq = new Float64Array(N_PARAMS);
  for (let i = 0; i < N_PARAMS; i++) deq[i] = i8[i] * scale;
  const bytes = new Uint8Array(N_PARAMS + 4);
  bytes.set(new Uint8Array(i8.buffer), 0);
  new DataView(bytes.buffer).setFloat32(N_PARAMS, scale, true);
  return { b64: Buffer.from(bytes).toString('base64'), scale, bytes: bytes.length, deq };
}

// ---------------- run ----------------
const t0 = Date.now();
const { data: dataset, seen } = collectDataset(160);
console.log(`dataset: ${dataset.length} states, buckets covered: ${seen.size}/${N_BUCKETS} (${(seen.size / N_BUCKETS * 100).toFixed(1)}%)`);

const trainSet = dataset.slice(0, Math.floor(dataset.length * 0.9));
const heldout = dataset.slice(Math.floor(dataset.length * 0.9));
const theta = trainImitation(trainSet);
let hm = 0;
for (const entry of heldout) {
  if (tableAction(theta, entry >> 2) === (entry & 3)) hm++;
}
console.log(`held-out imitation: ${(hm / heldout.length * 100).toFixed(1)}%`);

const evalSeeds = [1234, 99991, 4242, 777, 31337];
const avg = rs => (rs.reduce((s, r) => s + r.score, 0) / rs.length).toFixed(1);
const oracleR = evalSeeds.map(s => rolloutWith(sim => sim.oracleDir(), s));
const teacherR = evalSeeds.map(s => rolloutWith(teacherDir, s));
console.log('oracle  :', JSON.stringify(oracleR), 'avg', avg(oracleR));
console.log('teacher :', JSON.stringify(teacherR), 'avg', avg(teacherR));
const studentF = evalSeeds.map(s => rollout(theta, s));
console.log('student (float):', JSON.stringify(studentF), 'avg', avg(studentF));
const exp = exportPrefs(theta);
const studentI = evalSeeds.map(s => rollout(exp.deq, s));
console.log('student (int8) :', JSON.stringify(studentI), 'avg', avg(studentI));
console.log(`shipped size: ${exp.bytes} bytes`);
console.log(`train time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
require('fs').writeFileSync(__dirname + '/weights.json', JSON.stringify({
  kind: 'table', buckets: N_BUCKETS, params: N_PARAMS, grownAt: GROWN_AT,
  scale: exp.scale, b64: exp.b64, bytes: exp.bytes,
  heldOutImitation: +(hm / heldout.length * 100).toFixed(1),
  teacherAvg: +avg(teacherR), studentAvg: +avg(studentI), oracleAvg: +avg(oracleR),
}, null, 2));
console.log('wrote weights.json');

// ---------------- debug: why does the grown teacher stall? ----------------
if (process.env.DEBUG_TEACHER) {
  const sim = new Sim(mulberry32(1234));
  let state = 'ok', guard = 0, printed = 0;
  while (state === 'ok' && guard++ < MOVE_CAP && printed < 15) {
    if (sim.snake.length >= GROWN_AT && sim.noFood > 60 && printed < 15) {
      const s = sensorBits(sim);
      const safe = [0,1,2].filter(i => !((s.danger >> (2-i)) & 1));
      const greedy = FOOD_PREF[s.foodSec].find(p => safe.includes(p));
      console.log(`noFood=${sim.noFood} len=${sim.snake.length} foodSec=${s.foodSec} tailQuad=${s.tailQuad} danger=${s.danger.toString(2).padStart(3,'0')} roomy=${s.roomyList.join('')} safe=[${safe}] greedy=${greedy} roomyGreedy=${greedy !== undefined ? s.roomyList[greedy] : '-'} teacher=${teacherDir(sim)} dir=${sim.dir}`);
      printed++;
    }
    state = sim.step(teacherDir(sim));
    if (state === 'ate') state = 'ok';
  }
  console.log('final:', JSON.stringify({ score: sim.score, moves: sim.moves, len: sim.snake.length }));
}
