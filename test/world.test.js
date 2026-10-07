'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../js/data.js');
const PM = require('../js/maps.js');
const E = require('../js/engine.js');
const W = require('../js/world.js');

function constant(v) { return () => v; }
const DIRS = W.DIRS;

// 맵 하나를 BFS 로 훑어 플레이어가 닿을 수 있는 칸 집합 (NPC·도구는 장애물, 워프 칸은 밟을 수 있지만 너머로 가지 않는다)
function reach(Wm, save, sx, sy) {
  const seen = new Set([sx + ',' + sy]), q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    if (W.warpAt(Wm, x, y) && !(x === sx && y === sy)) continue;
    for (const d of Object.values(DIRS)) {
      const nx = x + d[0], ny = y + d[1], k = nx + ',' + ny;
      if (seen.has(k) || !W.walkable(Wm, save, nx, ny) || W.doorAt(Wm, nx, ny)) continue;
      seen.add(k); q.push([nx, ny]);
    }
  }
  return seen;
}
function adjacentReached(seen, x, y) { return Object.values(DIRS).some((d) => seen.has((x + d[0]) + ',' + (y + d[1]))); }
function entryPoints(id) {
  const pts = [];
  const m = PM.MAPS[id];
  if (m.start) pts.push([m.start.x, m.start.y]);
  for (const [oid, om] of Object.entries(PM.MAPS)) (om.warps || []).forEach((w) => { if (w.to === id) pts.push([w.tx, w.ty]); });
  return pts;
}
function freshSave() { const s = E.newGame('naru', constant(0.5)); s.flags.intro = 1; return s; }

test('맵 형식: 행 길이·범례·건물 자리·표지판·참조가 모두 맞다', () => {
  for (const [id, m] of Object.entries(PM.MAPS)) {
    const w = m.tiles[0].length;
    m.tiles.forEach((r, y) => {
      assert.equal(r.length, w, id + ' row ' + y);
      for (const ch of r) assert.ok(PM.LEGEND[ch], id + ' unknown tile ' + ch);
    });
    // 건물 자리는 '#'로 채워져 있고, '#'는 건물에만 있다
    const owned = new Set();
    (m.buildings || []).forEach((b) => {
      const B = PM.BUILDINGS[b.kind];
      assert.ok(B, id + ' building ' + b.kind);
      for (let y = b.y; y < b.y + B.h; y++) for (let x = b.x; x < b.x + B.w; x++) {
        assert.equal(m.tiles[y][x], '#', id + ' footprint ' + b.kind + ' ' + x + ',' + y);
        owned.add(x + ',' + y);
      }
      const d = PM.doorOf(b);
      assert.ok(PM.LEGEND[m.tiles[d.y + 1][d.x]].walk, id + ' door front blocked ' + b.kind);
      if (b.script) assert.ok(PM.SCRIPTS[b.script], id + ' script ' + b.script);
    });
    m.tiles.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '#') assert.ok(owned.has(x + ',' + y), id + ' stray # ' + x + ',' + y); }));
    // 표지판 칸과 글은 짝이 맞다
    const signs = new Set((m.signs || []).map((s) => s.x + ',' + s.y));
    m.tiles.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === 'S') assert.ok(signs.has(x + ',' + y), id + ' sign text missing ' + x + ',' + y); }));
    (m.signs || []).forEach((s) => assert.equal(m.tiles[s.y][s.x], 'S', id + ' sign not on S'));
    // 참조
    if (m.area) assert.ok(E.areaById(m.area), id + ' area');
    (m.npcs || []).forEach((n) => {
      assert.ok(PM.LEGEND[m.tiles[n.y][n.x]].walk, id + ' npc on solid ' + n.id);
      if (n.script) assert.ok(PM.SCRIPTS[n.script], id + ' script ' + n.script);
      if (n.trainer) assert.ok(D.TRAINERS[n.trainer], id + ' trainer ' + n.trainer);
      if (n.look) assert.ok(PM.LOOKS[n.look], id + ' look ' + n.look);
      if (n.kind === 'mon') assert.ok(D.MONSTERS[n.mon], id + ' mon ' + n.mon);
    });
    (m.items || []).forEach((it) => { assert.ok(D.ITEMS[it.item], id + ' item ' + it.item); assert.ok(PM.LEGEND[m.tiles[it.y][it.x]].walk, id + ' item on solid ' + it.id); });
    (m.warps || []).forEach((wp) => {
      const t = PM.MAPS[wp.to];
      assert.ok(t, id + ' warp to ' + wp.to);
      assert.ok(PM.LEGEND[t.tiles[wp.ty][wp.tx]].walk, id + ' warp lands on solid ' + wp.to + ' ' + wp.tx + ',' + wp.ty);
      assert.ok(!(t.warps || []).some((q) => q.x === wp.tx && q.y === wp.ty), id + ' warp lands on a warp');
    });
    (m.onEnter || []).forEach((o) => assert.ok(PM.SCRIPTS[o.script], id + ' onEnter'));
  }
  // 스크립트 안의 트레이너·도구 참조
  const walk = (cmds) => (cmds || []).forEach((c) => {
    if (c.battle) assert.ok(D.TRAINERS[c.battle], 'script battle ' + c.battle);
    if (c.give) assert.ok(D.ITEMS[c.give], 'script give ' + c.give);
    if (c.take) assert.ok(D.ITEMS[c.take], 'script take ' + c.take);
    walk(c.then); walk(c.else); walk(c.yes); walk(c.no);
  });
  Object.values(PM.SCRIPTS).forEach(walk);
  // 지역(야생 있는 곳)마다 맵이 하나씩 있고, 관장 트레이너는 맵의 관장 건물로 만난다
  D.AREAS.forEach((a) => assert.ok(Object.values(PM.MAPS).some((m) => m.area === a.id) || a.final, 'map for area ' + a.id));
});

test('맵 도달성: 모든 문·NPC·도구·출구에 입구에서 걸어서 닿을 수 있다', () => {
  const save = freshSave();
  for (const id of Object.keys(PM.MAPS)) {
    const Wm = W.loadMap(id);
    const pts = entryPoints(id);
    assert.ok(pts.length, id + ' has no entry');
    const seen = new Set();
    pts.forEach(([x, y]) => reach(Wm, save, x, y).forEach((k) => seen.add(k)));
    Wm.doors.forEach((d) => assert.ok(seen.has(d.x + ',' + (d.y + 1)), id + ' door unreachable ' + d.building.kind));
    (Wm.def.npcs || []).forEach((n) => assert.ok(adjacentReached(seen, n.x, n.y), id + ' npc unreachable ' + n.id));
    (Wm.def.items || []).forEach((it) => assert.ok(adjacentReached(seen, it.x, it.y), id + ' item unreachable ' + it.id));
    (Wm.def.signs || []).forEach((s) => assert.ok(adjacentReached(seen, s.x, s.y), id + ' sign unreachable'));
    (Wm.def.warps || []).forEach((wp) => assert.ok(seen.has(wp.x + ',' + wp.y), id + ' warp unreachable ' + wp.to));
  }
});

test('트레이너 시야: 시야 안에 걸을 수 있는 칸이 있고, 그 칸을 밟으면 발견된다', () => {
  const save = freshSave();
  for (const id of Object.keys(PM.MAPS)) {
    const Wm = W.loadMap(id);
    (Wm.def.npcs || []).filter((n) => n.trainer && n.sight).forEach((n) => {
      const d = DIRS[n.dir];
      const x = n.x + d[0] * n.sight, y = n.y + d[1] * n.sight;
      // 시야 끝까지 막힘 없이 걸을 수 있다
      for (let k = 1; k <= n.sight; k++) assert.ok(W.walkable(Wm, save, n.x + d[0] * k, n.y + d[1] * k), id + ' sight blocked ' + n.id + ' at ' + k);
      const sp = W.spotted(Wm, save, x, y);
      assert.ok(sp && sp.npc.id === n.id, id + ' not spotted ' + n.id);
      assert.equal(sp.steps, n.sight - 1);
      save.beaten[n.trainer] = 1;
      assert.equal(W.spotted(Wm, save, x, y), null, 'beaten trainer must not spot');
      delete save.beaten[n.trainer];
    });
  }
});

test('걸음: 벽에 부딪힘·문·워프·배지 없는 출구 거절·수풀 조우 유예', () => {
  const save = freshSave();
  const Wm = W.loadMap('forest');
  // 배지 없이 북쪽 출구
  let st = { x: 10, y: 1, dir: 'up' };
  let r = W.step(Wm, save, st, 'up', constant(0.5));
  assert.equal(r.kind, 'deny');
  assert.deepEqual([st.x, st.y], [10, 1]);
  save.badges.push('forest');
  r = W.step(Wm, save, st, 'up', constant(0.5));
  assert.equal(r.kind, 'warp');
  assert.equal(r.to, 'coast');
  // 문
  st = { x: 6, y: 12, dir: 'up' };
  assert.equal(W.step(Wm, save, st, 'up').kind, 'door');
  // 벽
  st = { x: 1, y: 2, dir: 'left' };
  assert.equal(W.step(Wm, save, st, 'left').kind, 'bump');
  // 수풀: 처음 encounterGrace 걸음은 조우 없음
  st = { x: 4, y: 25, dir: 'right', grass: 0 };
  const g = D.TUNING.encounterGrace;
  const seq = [];
  for (let i = 0; i < g + 1; i++) seq.push(W.step(Wm, save, st, i % 2 ? 'left' : 'right', constant(0)).encounter);
  assert.deepEqual(seq.slice(0, g), Array(g).fill(null));
  assert.equal(seq[g], 'forest');
});

test('조사·도구 줍기·조건', () => {
  const save = freshSave();
  const Wm = W.loadMap('forest');
  const it = Wm.def.items.find((q) => q.id === 'forest_snack');
  const st = { x: it.x + 1, y: it.y, dir: 'left' };
  const hit = W.interact(Wm, save, st);
  assert.equal(hit.kind, 'item');
  const n0 = save.bag.snack || 0;
  W.pickItem(save, hit.item);
  assert.equal(save.bag.snack, n0 + 2);
  assert.equal(W.interact(Wm, save, st), null); // 주운 도구는 사라진다
  assert.ok(W.evalCond(save, { item: 'snack', n: 2 }));
  assert.ok(!W.evalCond(save, { badge: 'forest' }));
  assert.ok(W.evalCond(save, [{ flag: 'intro' }, { notFlag: 'x' }]));
  assert.equal(W.applyAction(save, { flag: 'q' }), '');
  assert.ok(save.flags.q);
  assert.ok(/받았다/.test(W.applyAction(save, { give: 'tuna', n: 2 })));
  assert.equal(save.bag.tuna, 2);
});

test('스프레이: 선두보다 낮은 레벨의 야생을 막고, 걸을 때마다 줄어든다', () => {
  const save = freshSave();
  save.repel = 2;
  assert.ok(W.repelBlocks(save, save.party[0].lv - 1));
  assert.ok(!W.repelBlocks(save, save.party[0].lv + 1));
  const Wm = W.loadMap('home');
  const st = { x: 9, y: 9, dir: 'down' };
  W.step(Wm, save, st, 'left');
  const r = W.step(Wm, save, st, 'left');
  assert.equal(save.repel, 0);
  assert.ok(r.repelEnded);
});

test('경로 찾기: 막힌 칸은 피하고, 막힌 목표는 그 옆까지 간다', () => {
  const save = freshSave();
  const Wm = W.loadMap('home');
  const p = W.findPath(Wm, save, 9, 9, 16, 6);
  assert.ok(p && p.length > 0);
  const st = { x: 9, y: 9, dir: 'down' };
  p.forEach((d) => assert.equal(W.step(Wm, save, st, d).kind, 'move'));
  assert.deepEqual([st.x, st.y], [16, 6]);
  const toNpc = W.findPath(Wm, save, 9, 9, 11, 8); // 꼬마 NPC 칸
  assert.ok(toNpc);
});

test('날아가기·센터 앞: 들른 마을만 목록에 나온다', () => {
  const save = freshSave();
  assert.deepEqual(W.flyTargets(save), []);
  save.visited.home = 1; save.visited.forest = 1; save.visited.ruins = 1;
  assert.deepEqual(W.flyTargets(save).sort(), ['forest', 'home']);
  const c = W.centerFront('forest');
  assert.ok(W.walkable(W.loadMap('forest'), save, c.x, c.y));
});
