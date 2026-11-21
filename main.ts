// Push-optimal Sokoban solver for make.fun sokoban-solver-01-run-20261121.
//
// Strategy (written from scratch):
// - The generator lays one hallway row (where the player starts) with 1-4 rooms
//   off it, each room opening through a single door, and boxes never leave their
//   room. So each level splits into independent rooms.
// - Each room is solved push-optimally with A* over push states: a state is the
//   room's boxes plus the player's reachable-region representative (the player
//   can only stand where the boxes let him). Cost = pushes. The heuristic is the
//   Hungarian assignment of boxes to goals over BFS distances inside the room
//   (admissible: one push moves one box one square). Deadlock pruning: reverse
//   pull analysis marks squares from which no goal is reachable, plus 2x2
//   freeze blocks. A* with an admissible, consistent heuristic and safe pruning
//   returns the push-optimal room solution, so the sum over rooms is the level's
//   push optimum P*.
// - Room solutions are stitched with shortest player walks through the hallway
//   (walks cost no pushes). If decomposition fails, a whole-level push A* is
//   tried for small levels; otherwise the instance is answered empty (never a
//   crash, always a solution.txt for every instance).
// - Budgets are node counts, never the wall clock: two runs write identical
//   bytes. Node 22, TypeScript erasable syntax only, stdlib only, no network.
//
// Local run: MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=/tmp/sok-out node main.ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const DX = [0, 0, -1, 1];
const DY = [-1, 1, 0, 0];
const CH = ['u', 'd', 'l', 'r'];
const INF = 1e9;

/** Node budgets (deterministic): per-room A* expansions, whole-level fallback,
 *  and a global cap over the whole run so the 60 s wall can never be hit. */
const ROOM_EXPANSIONS = 1_500_000;
const FALLBACK_EXPANSIONS = 300_000;
const GLOBAL_EXPANSIONS = 3_000_000;

interface Level {
  w: number;
  h: number;
  wall: boolean[];
  goals: Set<number>;
  boxes: number[];
  player: number;
}

function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall: boolean[] = new Array<boolean>(w * h).fill(true);
  const goals = new Set<number>();
  const boxes: number[] = [];
  let player = 0;
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const ch = row[x] ?? '#';
      const i = y * w + x;
      wall[i] = ch === '#';
      if (ch === '.' || ch === '*' || ch === '+') goals.add(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  boxes.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}

/** A board for push A*: a set of floor cells with adjacency, distances, dead squares. */
interface Board {
  n: number;
  global: number[];
  nb: number[][];
  goals: number[];
  isGoal: boolean[];
  dist: number[][];
  dead: boolean[];
  blocks: number[][];
}

function buildBoard(L: Level, cells: number[], goalsGlobal: number[]): Board {
  const n = cells.length;
  const local = new Map<number, number>();
  cells.forEach((g, i) => local.set(g, i));
  const nb: number[][] = [];
  for (let i = 0; i < n; i++) {
    const g = cells[i];
    const x = g % L.w;
    const y = Math.floor(g / L.w);
    const row: number[] = [];
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx < 0 || nx >= L.w || ny < 0 || ny >= L.h) row.push(-1);
      else {
        const m = ny * L.w + nx;
        row.push(L.wall[m] ? -1 : (local.get(m) ?? -1));
      }
    }
    nb.push(row);
  }
  const goals = goalsGlobal.map((g) => local.get(g)!).sort((a, b) => a - b);
  const isGoal = new Array<boolean>(n).fill(false);
  for (const g of goals) isGoal[g] = true;
  // BFS distances between all cells, ignoring boxes.
  const dist: number[][] = [];
  for (let s = 0; s < n; s++) {
    const d = new Array<number>(n).fill(INF);
    d[s] = 0;
    const q = [s];
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      for (let dir = 0; dir < 4; dir++) {
        const m = nb[c][dir];
        if (m >= 0 && d[m] === INF) {
          d[m] = d[c] + 1;
          q.push(m);
        }
      }
    }
    dist.push(d);
  }
  // Dead squares: reverse-pull reachability from the goals, ignoring other
  // boxes. A box on a cell no goal can be pulled from is lost for good.
  // A forward push moves a box Y -> X = Y+d with the player standing at
  // 2Y-X, so in reverse, Y is a predecessor of X exactly when 2Y-X is floor.
  const live = new Array<boolean>(n).fill(false);
  const q: number[] = [];
  for (const g of goals) {
    live[g] = true;
    q.push(g);
  }
  for (let qi = 0; qi < q.length; qi++) {
    const b = q[qi];
    for (let dir = 0; dir < 4; dir++) {
      const m = nb[b][dir];
      if (m >= 0 && nb[m][dir] >= 0 && !live[m]) {
        live[m] = true;
        q.push(m);
      }
    }
  }
  const dead = live.map((v) => !v);
  // 2x2 freeze blocks: four cells each wall or box, holding a box off-goal.
  const blocks: number[][] = [];
  for (let y = 0; y < L.h - 1; y++) {
    for (let x = 0; x < L.w - 1; x++) {
      const cs = [y * L.w + x, y * L.w + x + 1, (y + 1) * L.w + x, (y + 1) * L.w + x + 1];
      const locs: number[] = [];
      let ok = true;
      for (const c of cs) {
        if (L.wall[c]) locs.push(-1);
        else if (local.has(c)) locs.push(local.get(c)!);
        else {
          ok = false;
          break;
        }
      }
      if (ok) blocks.push(locs);
    }
  }
  return { n, global: cells, nb, goals, isGoal, dist, dead, blocks };
}

function permsOf(n: number): number[][] {
  const out: number[][] = [];
  const a = Array.from({ length: n }, (_, i) => i);
  const gen = (k: number): void => {
    if (k === n) {
      out.push(a.slice());
      return;
    }
    for (let i = k; i < n; i++) {
      const t = a[k];
      a[k] = a[i];
      a[i] = t;
      gen(k + 1);
      const t2 = a[k];
      a[k] = a[i];
      a[i] = t2;
    }
  };
  gen(0);
  return out;
}

interface Push {
  box: number;
  dir: number;
}

/**
 * Push-optimal A* over one board. State = sorted boxes + player-region
 * representative (min cell of the region the player can reach). Returns the
 * push list (local box index, direction) or null when the node budget runs out.
 */
function solveBoard(
  bd: Board,
  boxes0: number[],
  start: number,
  needExit: number,
  maxExp: number,
  hungarian: boolean,
): { pushes: Push[]; expanded: number } | null {
  const n = bd.n;
  const nb = bd.nb;
  const nbBoxes = boxes0.length;
  const POW64 = [1, 64, 4096, 262144, 16777216];
  const PERMS = hungarian ? permsOf(nbBoxes) : [];
  const pack = (bs: number[]): number => {
    let k = 0;
    for (let i = 0; i < nbBoxes; i++) k += bs[i] * POW64[i];
    return k;
  };
  const unpack = (k: number, out: number[]): void => {
    for (let i = 0; i < nbBoxes; i++) {
      out[i] = k % 64;
      k = Math.floor(k / 64);
    }
  };
  const boxMask = (bs: number[]): Uint8Array => {
    const m = new Uint8Array(n);
    for (const b of bs) m[b] = 1;
    return m;
  };
  // Flood fill of the player's reachable region from a cell, avoiding boxes.
  const region = (from: number, mask: Uint8Array): { min: number; set: Uint8Array } => {
    const set = new Uint8Array(n);
    set[from] = 1;
    const q = [from];
    let min = from;
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      if (c < min) min = c;
      for (let d = 0; d < 4; d++) {
        const m = nb[c][d];
        if (m >= 0 && !set[m] && !mask[m]) {
          set[m] = 1;
          q.push(m);
        }
      }
    }
    return { min, set };
  };
  const heuristic = (bs: number[]): number => {
    if (hungarian) {
      let best = INF;
      for (const p of PERMS) {
        let s = 0;
        for (let i = 0; i < nbBoxes; i++) {
          const d = bd.dist[bs[i]][bd.goals[p[i]]];
          if (d >= INF) {
            s = INF;
            break;
          }
          s += d;
        }
        if (s < best) best = s;
      }
      return best;
    }
    let s = 0;
    for (const b of bs) {
      let m = INF;
      for (const g of bd.goals) {
        const d = bd.dist[b][g];
        if (d < m) m = d;
      }
      s += m;
    }
    return s;
  };
  const isDead = (bs: number[], mask: Uint8Array): boolean => {
    for (const b of bs) if (bd.dead[b]) return true;
    for (const blk of bd.blocks) {
      let boxes = 0;
      let blocked = 0;
      let onGoal = 0;
      for (const c of blk) {
        if (c < 0) {
          blocked++;
          continue;
        }
        if (mask[c]) {
          blocked++;
          boxes++;
          if (bd.isGoal[c]) onGoal++;
        }
      }
      if (boxes > 0 && blocked === 4 && onGoal < boxes) return true;
    }
    return false;
  };

  const sBox: number[] = [];
  const sRep: number[] = [];
  const sG: number[] = [];
  const sPar: number[] = [];
  const sPB: number[] = [];
  const sPD: number[] = [];
  const sF: number[] = [];
  const sH: number[] = [];
  const best = new Map<number, number>();
  const heap: number[] = [];
  const cmp = (a: number, b: number): boolean =>
    sF[a] !== sF[b] ? sF[a] < sF[b] : sH[a] !== sH[b] ? sH[a] < sH[b] : a < b;
  const heapPush = (x: number): void => {
    heap.push(x);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!cmp(heap[i], heap[p])) break;
      const t = heap[i];
      heap[i] = heap[p];
      heap[p] = t;
      i = p;
    }
  };
  const heapPop = (): number => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && cmp(heap[c + 1], heap[c])) c++;
        if (!cmp(heap[c], heap[i])) break;
        const t = heap[i];
        heap[i] = heap[c];
        heap[c] = t;
        i = c;
      }
    }
    return top;
  };

  const init = boxes0.slice().sort((a, b) => a - b);
  const initMask = boxMask(init);
  const rep0 = region(start, initMask).min;
  const h0 = heuristic(init);
  if (h0 >= INF || isDead(init, initMask)) return null;
  sBox.push(pack(init));
  sRep.push(rep0);
  sG.push(0);
  sPar.push(-1);
  sPB.push(-1);
  sPD.push(-1);
  sF.push(h0);
  sH.push(h0);
  best.set(pack(init) + rep0 * POW64[nbBoxes], 0);
  heapPush(0);

  const cur = new Array<number>(nbBoxes);
  const nxt = new Array<number>(nbBoxes);
  let expanded = 0;
  while (heap.length > 0) {
    const s = heapPop();
    const key = sBox[s] + sRep[s] * POW64[nbBoxes];
    if (best.get(key) !== s) continue;
    unpack(sBox[s], cur);
    const mask = boxMask(cur);
    const reg = region(sRep[s], mask);
    let solved = true;
    for (const b of cur) {
      if (!bd.isGoal[b]) {
        solved = false;
        break;
      }
    }
    if (solved && (needExit < 0 || reg.set[needExit])) {
      const pushes: Push[] = [];
      for (let t = s; t > 0; t = sPar[t]) pushes.push({ box: sPB[t], dir: sPD[t] });
      pushes.reverse();
      return { pushes, expanded };
    }
    if (expanded >= maxExp) return null;
    expanded++;
    for (let bi = 0; bi < nbBoxes; bi++) {
      const b = cur[bi];
      for (let d = 0; d < 4; d++) {
        const dest = nb[b][d];
        if (dest < 0 || mask[dest]) continue;
        const from = nb[b][d ^ 1];
        if (from < 0 || !reg.set[from]) continue;
        for (let i = 0; i < nbBoxes; i++) nxt[i] = cur[i];
        nxt[bi] = dest;
        nxt.sort((a, b2) => a - b2);
        const nmask = boxMask(nxt);
        if (isDead(nxt, nmask)) continue;
        const rep = region(b, nmask).min;
        const h = heuristic(nxt);
        if (h >= INF) continue;
        const g = sG[s] + 1;
        const nk = pack(nxt) + rep * POW64[nbBoxes];
        const prev = best.get(nk);
        if (prev !== undefined && sG[prev] <= g) continue;
        const t = sBox.length;
        sBox.push(pack(nxt));
        sRep.push(rep);
        sG.push(g);
        sPar.push(s);
        sPB.push(b);
        sPD.push(d);
        sF.push(g + h);
        sH.push(h);
        best.set(nk, t);
        heapPush(t);
      }
    }
  }
  return null;
}

/** Shortest player walk (u/d/l/r) from `from` to `to` over floor cells in `cellSet`, avoiding `boxes`. */
function walkMoves(
  L: Level,
  cellSet: Set<number>,
  boxes: Set<number>,
  from: number,
  to: number,
): string | null {
  if (from === to) return '';
  const prev = new Map<number, number>();
  const prevCh = new Map<number, string>();
  const q = [from];
  prev.set(from, -1);
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    const x = c % L.w;
    const y = Math.floor(c / L.w);
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx < 0 || nx >= L.w || ny < 0 || ny >= L.h) continue;
      const m = ny * L.w + nx;
      if (!cellSet.has(m) || boxes.has(m) || prev.has(m)) continue;
      prev.set(m, c);
      prevCh.set(m, CH[d]);
      if (m === to) {
        let s = '';
        for (let t = m; t !== from; t = prev.get(t)!) s = prevCh.get(t)! + s;
        return s;
      }
      q.push(m);
    }
  }
  return null;
}

/** Turn a push list into player moves, simulating walks between pushes. */
function realizePushes(
  L: Level,
  cells: Set<number>,
  start: number,
  boxes0: number[],
  pushes: Push[],
  end: number,
): string | null {
  const boxes = new Set<number>(boxes0);
  let player = start;
  let moves = '';
  for (const p of pushes) {
    const box = p.box;
    const from = box - DY[p.dir] * L.w - DX[p.dir];
    const w = walkMoves(L, cells, boxes, player, from);
    if (w === null) return null;
    moves += w + CH[p.dir];
    player = box;
    boxes.delete(box);
    boxes.add(box + DY[p.dir] * L.w + DX[p.dir]);
  }
  const tail = walkMoves(L, cells, boxes, player, end);
  if (tail === null) return null;
  return moves + tail;
}

interface RoomInfo {
  entry: number;
  door: number;
  cells: number[];
  boxes: number[];
  goals: number[];
}

function detectRooms(L: Level): RoomInfo[] | null {
  const hallRow = Math.floor(L.player / L.w);
  const assigned = new Set<number>();
  const rooms: RoomInfo[] = [];
  for (let x = 0; x < L.w; x++) {
    const c = hallRow * L.w + x;
    if (L.wall[c]) continue;
    for (const dy of [-1, 1]) {
      const y = hallRow + dy;
      if (y < 0 || y >= L.h) continue;
      const n = y * L.w + x;
      if (L.wall[n] || assigned.has(n)) continue;
      const fill: number[] = [];
      const q = [n];
      assigned.add(n);
      for (let qi = 0; qi < q.length; qi++) {
        const cell = q[qi];
        fill.push(cell);
        const cx = cell % L.w;
        const cy = Math.floor(cell / L.w);
        for (let d = 0; d < 4; d++) {
          const nx = cx + DX[d];
          const ny = cy + DY[d];
          if (nx < 0 || nx >= L.w || ny < 0 || ny >= L.h || ny === hallRow) continue;
          const m = ny * L.w + nx;
          if (L.wall[m] || assigned.has(m)) continue;
          assigned.add(m);
          q.push(m);
        }
      }
      const cellSet = new Set<number>(fill);
      cellSet.add(c);
      const boxes = L.boxes.filter((b) => cellSet.has(b));
      const goals = [...L.goals].filter((g) => cellSet.has(g));
      rooms.push({ entry: c, door: n, cells: [...fill, c], boxes, goals });
    }
  }
  if (rooms.length === 0) return null;
  const seenBoxes = new Set<number>();
  const seenGoals = new Set<number>();
  for (const r of rooms) {
    if (r.boxes.length === 0 || r.boxes.length !== r.goals.length) return null;
    for (const b of r.boxes) seenBoxes.add(b);
    for (const g of r.goals) seenGoals.add(g);
  }
  if (seenBoxes.size !== L.boxes.length || seenGoals.size !== L.goals.size) return null;
  return rooms;
}

/** Whole-level push A* fallback for small levels (sum-of-min-distances heuristic). */
function solveWholeLevel(L: Level): string | null {
  const allFloor: number[] = [];
  for (let i = 0; i < L.w * L.h; i++) if (!L.wall[i]) allFloor.push(i);
  const bd = buildBoard(L, allFloor, [...L.goals]);
  const local = new Map<number, number>();
  allFloor.forEach((g, i) => local.set(g, i));
  const boxes0 = L.boxes.map((b) => local.get(b)!);
  const res = solveBoard(bd, boxes0, local.get(L.player)!, -1, FALLBACK_EXPANSIONS, false);
  if (!res) return null;
  const cells = new Set<number>(allFloor);
  const pushes = res.pushes.map((p) => ({ box: bd.global[p.box], dir: p.dir }));
  return realizePushes(L, cells, L.player, L.boxes, pushes, L.player);
}

function countPushes(L: Level, moves: string): number {
  let player = L.player;
  const boxes = new Set<number>(L.boxes);
  let pushes = 0;
  for (const ch of moves) {
    const d = CH.indexOf(ch.toLowerCase());
    if (d < 0) continue;
    const q = player + DY[d] * L.w + DX[d];
    if (L.wall[q]) return -1;
    if (boxes.has(q)) {
      const dest = q + DY[d] * L.w + DX[d];
      if (L.wall[dest] || boxes.has(dest)) return -1;
      boxes.delete(q);
      boxes.add(dest);
      pushes++;
    }
    player = q;
  }
  return pushes;
}

function solveLevel(text: string): { moves: string; expansions: number; pushes: number } {
  const L = parseLevel(text);
  let expansions = 0;
  const rooms = detectRooms(L);
  if (rooms) {
    rooms.sort((a, b) => a.entry - b.entry);
    let moves = '';
    let player = L.player;
    const boxes = L.boxes.slice();
    const allFloor = new Set<number>();
    for (let i = 0; i < L.w * L.h; i++) if (!L.wall[i]) allFloor.add(i);
    let ok = true;
    for (const room of rooms) {
      console.error(`  room entry=${room.entry} door=${room.door} cells=${room.cells.length} boxes=${room.boxes} goals=${room.goals}`);
      const w1 = walkMoves(L, allFloor, new Set<number>(boxes), player, room.entry);
      if (w1 === null) {
        ok = false;
        break;
      }
      moves += w1;
      player = room.entry;
      const bd = buildBoard(L, room.cells, room.goals);
      const local = new Map<number, number>();
      room.cells.forEach((g, i) => local.set(g, i));
      const boxes0 = room.boxes.map((b) => local.get(b)!);
      const cap = Math.min(ROOM_EXPANSIONS, Math.max(0, GLOBAL_EXPANSIONS - expansions));
      const res =
        cap > 0
          ? solveBoard(bd, boxes0, local.get(room.entry)!, local.get(room.entry)!, cap, true)
          : null;
      console.error(`  room entry=${room.entry}: solveBoard ${res ? `pushes=${res.pushes.length} expanded=${res.expanded}` : 'NULL'}`);
      if (!res) {
        ok = false;
        break;
      }
      expansions += res.expanded;
      const cellSet = new Set<number>(room.cells);
      const pushes = res.pushes.map((p) => ({ box: bd.global[p.box], dir: p.dir }));
      const rm = realizePushes(L, cellSet, room.entry, room.boxes, pushes, room.entry);
      if (rm === null) {
        ok = false;
        break;
      }
      moves += rm;
      player = room.entry;
      const done = new Set<number>(room.boxes);
      const nextBoxes = boxes.filter((b) => !done.has(b));
      for (const g of room.goals) nextBoxes.push(g);
      nextBoxes.sort((a, b) => a - b);
      boxes.splice(0, boxes.length, ...nextBoxes);
    }
    if (ok) {
      const solved = boxes.every((b) => L.goals.has(b));
      if (solved) return { moves, expansions, pushes: countPushes(L, moves) };
    }
  }
  if (L.boxes.length <= 8) {
    const fb = solveWholeLevel(L);
    if (fb !== null) return { moves: fb, expansions, pushes: countPushes(L, fb) };
  }
  return { moves: '', expansions, pushes: 0 };
}

for (const id of readdirSync(I).sort()) {
  const level = readFileSync(join(I, id, 'level.txt'), 'utf8');
  let out = '';
  let info = '';
  try {
    const r = solveLevel(level);
    out = r.moves;
    info = `pushes=${r.pushes} expansions=${r.expansions}`;
  } catch (e) {
    console.error(`${id}: ERROR ${e instanceof Error ? e.message : String(e)}`);
  }
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${out}\n`);
  console.error(`${id}: wrote ${out.length} moves ${info}`);
}
