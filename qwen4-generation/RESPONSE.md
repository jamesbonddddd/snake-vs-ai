# Qwen4's generation (raw, unedited)

- Date: 2026-11-12
- Model: Qwen4 (invite preview, via API — model ID withheld pending content approval)
- Usage: 6,426 reasoning tokens + 1,191 output tokens (7,618 total completion)
- One shot: this is the model's first and only generation — no retries, no edits by us
- SHA-256 of the generated code: `d940a184b4dd8f724cd90ee6a6760abc8c7b3eec4711f1fdafaf50348c12844c`
  (matches the `expertMove` function shipped in `index.html` — compare with
  `new TextEncoder().encode(expertMove.toString())` in your console: 3,399 bytes)

---

```
```javascript
function expertMove(state) {
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // right, left, down, up
  const REV = [1, 0, 3, 2]; // opposite headings (instant death)
  const { snake, dir, food, grid, noFoodMoves } = state;
  const N = grid;
  const head = snake[0];
  const tail = snake[snake.length - 1];
  const key = (x, y) => y * N + x;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
  const same = (a, b) => a.x === b.x && a.y === b.y;

  // Blocked-cell mask from a body; optionally free the tail (it vacates).
  const bodyMask = (body, freeTail) => {
    const m = new Uint8Array(N * N);
    for (const c of body) m[key(c.x, c.y)] = 1;
    if (freeTail) {
      const t = body[body.length - 1];
      m[key(t.x, t.y)] = 0;
    }
    return m;
  };

  // BFS: direction of the first step from start to goal, or -1 if unreachable.
  // bannedDir is forbidden as the very first step (never reverse the head).
  const bfs = (start, goal, blocked, bannedDir) => {
    const sk = key(start.x, start.y), gk = key(goal.x, goal.y);
    if (sk === gk) return -1;
    const seen = new Uint8Array(N * N);
    const first = new Int8Array(N * N).fill(-1);
    const q = [sk];
    seen[sk] = 1;
    for (let qi = 0; qi < q.length; qi++) {
      const cur = q[qi];
      const cx = cur % N, cy = (cur - cx) / N;
      for (let d = 0; d < 4; d++) {
        if (cur === sk && d === bannedDir) continue;
        const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
        if (!inBounds(nx, ny)) continue;
        const nk = key(nx, ny);
        if (seen[nk] || blocked[nk]) continue;
        seen[nk] = 1;
        first[nk] = cur === sk ? d : first[cur];
        if (nk === gk) return first[nk];
        q.push(nk);
      }
    }
    return -1;
  };

  // 1) Hunt: shortest path to food. Tail vacates unless head is adjacent
  //    to food (eating grows the snake, so the tail stays put).
  const adjacent = Math.abs(head.x - food.x) + Math.abs(head.y - food.y) === 1;
  const foodDir = bfs(head, food, bodyMask(snake, !adjacent), REV[dir]);

  if (foodDir >= 0) {
    // 4) Stall breaker: take the food path unchecked.
    if (noFoodMoves >= 120) return { dir: foodDir, why: 'gamble' };

    // 2) Safety: simulate the move, then require new head -> new tail path.
    const nx = head.x + DIRS[foodDir][0], ny = head.y + DIRS[foodDir][1];
    const eats = nx === food.x && ny === food.y;
    const sim = [{ x: nx, y: ny }, ...snake];
    if (!eats) sim.pop(); // tail vacates unless we grew
    const simTail = sim[sim.length - 1];
    const reachable = same(sim[0], simTail) ||
      bfs(sim[0], simTail, bodyMask(sim, true), -1) >= 0;
    if (reachable) return { dir: foodDir, why: 'hunt food' };
    // Unsafe: fall through to the fallback.
  }

  // 3) Fallback: chase our own tail (body-minus-tail blocked).
  const tailDir = bfs(head, tail, bodyMask(snake, true), REV[dir]);
  if (tailDir >= 0) return { dir: tailDir, why: 'follow tail' };

  // Otherwise any non-colliding direction, fixed preference order.
  for (let d = 0; d < 4; d++) {
    if (d === REV[dir]) continue;
    const nx = head.x + DIRS[d][0], ny = head.y + DIRS[d][1];
    if (!inBounds(nx, ny)) continue;
    const eats = nx === food.x && ny === food.y;
    if (!bodyMask(snake, !eats)[key(nx, ny)]) return { dir: d, why: 'survive' };
  }

  // Everything collides: hold course.
  return { dir, why: 'survive' };
}
```
```
