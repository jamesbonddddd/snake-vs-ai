// Headless verification harness for the Qwen4-generated brain (run: node verify.js)
// Seeds the RNG, plays full games calling ONLY the generated expertMove(), and reports scores.
// Results (also in RESULTS.md):
//   3,000-move cap: [110, 120, 117, 119, 128] avg 118.8 — zero deaths
//   2,000-move cap: [85, 83, 87, 88, 96]    avg 87.8  — zero deaths (hand-written version: 86.0)


const fs = require('fs');
eval(fs.readFileSync(require('path').join(__dirname, 'generated-brain.js'), 'utf8'));
const GRID = 30;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function mulberry32(seed) { let a = seed >>> 0; return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function run(seed) {
  const rng = mulberry32(seed);
  let snake = [{x:10,y:10},{x:9,y:10},{x:8,y:10}], dir = 0, score = 0, noFood = 0, moves = 0;
  const spawn = () => { const occ = new Set(snake.map(c => c.y*GRID+c.x)); const free = []; for (let y=0;y<GRID;y++) for (let x=0;x<GRID;x++) if (!occ.has(y*GRID+x)) free.push({x,y}); food = free[Math.floor(rng()*free.length)]; };
  let food; spawn();
  while (moves < 3000) {
    const r = expertMove({ snake, dir, food, grid: GRID, noFoodMoves: noFood });
    if (![0,1,2,3].includes(r.dir)) { console.log('BAD dir', r); process.exit(1); }
    if (r.dir === [1,0,3,2][dir]) { console.log('REVERSE move at', moves); return { score, moves, dead: 'reverse' }; }
    dir = r.dir;
    const nx = snake[0].x + DIRS[dir][0], ny = snake[0].y + DIRS[dir][1];
    const eats = food && nx === food.x && ny === food.y;
    const blocked = new Set(snake.slice(0, eats ? undefined : -1).map(c => c.y*GRID+c.x));
    if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID || blocked.has(ny*GRID+nx)) return { score, moves, dead: true };
    snake.unshift({x: nx, y: ny});
    if (eats) { score++; noFood = 0; spawn(); } else { snake.pop(); noFood++; }
    moves++;
    if (noFood > 800) return { score, moves, dead: 'stalled' };
  }
  return { score, moves, dead: false };
}
const seeds = [1234, 99991, 4242, 777, 31337];
const rs = seeds.map(run);
console.log(JSON.stringify(rs));
console.log('avg:', (rs.reduce((s, r) => s + r.score, 0) / rs.length).toFixed(1));
