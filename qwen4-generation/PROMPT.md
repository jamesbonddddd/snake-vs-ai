# The spec (exact prompt sent to Qwen4)

Sent via the chat completions API, `reasoning_effort: high`, thinking enabled, streaming
(the non-streaming call times out when thinking is on — a known gateway behavior).

---

Write a complete, self-contained JavaScript function that plays Snake perfectly-ish. It will be the brain of the AI opponent in a browser game, so it must be a pure function with no external state and no imports.

SPEC:
- Function name: expertMove(state)
- state = {
    snake: [{x,y}, ...]   // head FIRST, tail LAST,
    dir: 0|1|2|3,          // current heading; DIRS = [[1,0],[-1,0],[0,1],[0,-1]] = right,left,down,up
    food: {x,y},
    grid: 30,              // board is grid x grid, cells 0..grid-1
    noFoodMoves: number    // moves since last food eaten
  }
- Return { dir: 0..3, why: 'hunt food' | 'follow tail' | 'survive' | 'gamble' }
- NEVER return the reverse of the current dir (instant death).

STRATEGY (implement exactly):
1. Hunt: BFS shortest path from head to food over free cells. Blocked cells = walls + snake body, EXCEPT the tail cell, which vacates on the next move — unless the head is adjacent to food (then the tail stays, because eating grows the snake).
2. Safety check before taking the food path's first step: simulate the snake after that move (tail vacates unless the move eats) and BFS from the new head to the new tail. If the tail is unreachable, the move could trap the snake -> do not take it (unless rule 4 says gamble).
3. Fallback: BFS from head to own tail (tail cell is the goal, treat body-minus-tail as blocked) and take its first step. If that fails, any non-colliding direction (fixed preference order). If everything collides, return current dir.
4. Stall breaker: if noFoodMoves >= 120, skip the safety check in rule 2 and take the food path anyway ('gamble').

Output ONLY the JavaScript function in a single code block, ES2020, with brief comments. No test code, no explanation outside the block.
