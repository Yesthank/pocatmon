/* 포캣몬 필드 규칙 — 이동·충돌·수풀 조우·트레이너 시야·조사·이벤트 조건 (DOM 없음, 난수 주입식)
   맵 데이터는 PMaps, 몬스터·트레이너·도구는 PData, 저장 데이터 조작은 PEngine 을 쓴다.
   스크립트 실행(대화창·배틀·상점처럼 화면이 필요한 일)은 main.js 가 하고, 이 모듈은 판정과 순수 상태 변경만 한다. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./data.js'), require('./maps.js'), require('./engine.js'));
  else root.PWorld = factory(root.PData, root.PMaps, root.PEngine);
})(typeof window !== 'undefined' ? window : globalThis, function (D, PM, E) {
  'use strict';
  var T = D.TUNING;
  var DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  var OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };

  /* ── 조건 ──
     cond: 객체 하나 또는 배열(모두 참이어야 함). 키: flag, notFlag, badge, badges, caught, dexCaught,
           item(+n), beaten, notBeaten, cleared, starter */
  function evalCond(save, c) {
    if (!c) return true;
    if (Array.isArray(c)) return c.every(function (x) { return evalCond(save, x); });
    if (!save) return !!c.noSave;
    if (c.flag && !save.flags[c.flag]) return false;
    if (c.notFlag && save.flags[c.notFlag]) return false;
    if (c.badge && save.badges.indexOf(c.badge) < 0) return false;
    if (c.notBadge && save.badges.indexOf(c.notBadge) >= 0) return false;
    if (c.badges != null && save.badges.length < c.badges) return false;
    if (c.caught && !save.dex.caught[c.caught]) return false;
    if (c.dexCaught != null && dexCaught(save) < c.dexCaught) return false;
    if (c.item && !((save.bag[c.item] || 0) >= (c.n || 1))) return false;
    if (c.beaten && !save.beaten[c.beaten]) return false;
    if (c.notBeaten && save.beaten[c.notBeaten]) return false;
    if (c.cleared != null && !!save.cleared !== !!c.cleared) return false;
    if (c.starter && save.starter !== c.starter) return false;
    return true;
  }
  function dexCaught(save) { return D.DEX.filter(function (id) { return save.dex.caught[id]; }).length; }

  // 화면이 필요 없는 행동을 저장 데이터에 적용한다. 반환: 보여 줄 문장(없으면 '')
  function applyAction(save, a) {
    if (a.flag) { save.flags[a.flag] = 1; return ''; }
    if (a.unflag) { delete save.flags[a.unflag]; return ''; }
    if (a.give) {
      var n = a.n || 1;
      E.giveItem(save.bag, a.give, n);
      var nm = D.ITEMS[a.give].name;
      return (n > 1 ? nm + ' ' + n + '개를' : josa(nm, '을/를')) + ' 받았다!';
    }
    if (a.take) { for (var i = 0; i < (a.n || 1); i++) E.takeItem(save.bag, a.take); return ''; }
    if (a.money) { save.money = Math.max(0, Math.min(T.moneyMax, save.money + a.money)); return a.money > 0 ? a.money + '원을 받았다!' : ''; }
    if (a.heal) { E.healParty(save); return ''; }
    return '';
  }
  function hasBatchim(w) { var c = w.charCodeAt(w.length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0; }

  /* ── 맵 ── */
  function loadMap(id) {
    var def = PM.MAPS[id];
    if (!def) throw new Error('unknown map ' + id);
    var h = def.tiles.length, w = def.tiles[0].length;
    var solid = [];
    for (var y = 0; y < h; y++) {
      solid.push([]);
      for (var x = 0; x < w; x++) {
        var L = PM.LEGEND[def.tiles[y][x]];
        solid[y].push(!L || !L.walk);
      }
    }
    var doors = (def.buildings || []).map(function (b) { var d = PM.doorOf(b); return { x: d.x, y: d.y, building: b }; });
    // NPC 는 맵을 불러올 때마다 복사한다 — 다가온 트레이너의 위치는 이번 방문 동안만 바뀐다
    var npcs = (def.npcs || []).map(function (n) { var c = {}; for (var k in n) c[k] = n[k]; return c; });
    return { id: id, def: def, w: w, h: h, solid: solid, doors: doors, npcs: npcs };
  }
  function tileAt(W, x, y) { return x < 0 || y < 0 || x >= W.w || y >= W.h ? null : W.def.tiles[y][x]; }
  function isGrass(W, x, y) { var L = PM.LEGEND[tileAt(W, x, y)]; return !!(L && L.grass); }
  function inMap(W, x, y) { return x >= 0 && y >= 0 && x < W.w && y < W.h; }

  // 지금 보이는 NPC (showIf/hideIf 조건 반영)
  function npcsOf(W, save) {
    return (W.npcs || W.def.npcs || []).filter(function (n) { return evalCond(save, n.showIf) && !(n.hideIf && evalCond(save, n.hideIf)); });
  }
  function itemsOf(W, save) {
    return (W.def.items || []).filter(function (it) { return !(save && save.flags['item:' + it.id]); });
  }
  function occupant(W, save, x, y) {
    var n = npcsOf(W, save).filter(function (q) { return q.x === x && q.y === y; })[0];
    if (n) return { kind: 'npc', npc: n };
    var it = itemsOf(W, save).filter(function (q) { return q.x === x && q.y === y; })[0];
    if (it) return { kind: 'item', item: it };
    return null;
  }
  function walkable(W, save, x, y) {
    return inMap(W, x, y) && !W.solid[y][x] && !occupant(W, save, x, y);
  }
  function warpAt(W, x, y) { return (W.def.warps || []).filter(function (q) { return q.x === x && q.y === y; })[0] || null; }
  function doorAt(W, x, y) { return W.doors.filter(function (d) { return d.x === x && d.y === y; })[0] || null; }
  function signAt(W, x, y) { return (W.def.signs || []).filter(function (q) { return q.x === x && q.y === y; })[0] || null; }

  /* ── 한 걸음 ──
     st = { x, y, dir, grass }  (grass: 수풀에서 걸은 걸음 수, 유예 계산용)
     반환: { kind: 'turn' | 'move' | 'bump' | 'door' | 'warp' | 'deny', ... }
       move 이면 encounter(야생 조우 지역 id), spotted(트레이너 발견), trigger(밟으면 실행할 스크립트)를 함께 판정한다. */
  function step(W, save, st, dir, rng) {
    rng = rng || Math.random;
    var d = DIRS[dir];
    if (st.dir !== dir && !st.keepFacing) { st.dir = dir; }
    var nx = st.x + d[0], ny = st.y + d[1];
    var door = doorAt(W, nx, ny);
    if (door) return { kind: 'door', door: door };
    var wp = warpAt(W, nx, ny);
    if (!inMap(W, nx, ny)) {
      // 맵 가장자리 밖: 현재 칸의 출구 워프
      var here = warpAt(W, st.x, st.y);
      if (here && here.edge === dir) return warpResult(save, here);
      return { kind: 'bump' };
    }
    if (!walkable(W, save, nx, ny)) return { kind: 'bump', occupant: occupant(W, save, nx, ny) };
    st.x = nx; st.y = ny;
    if (wp && !wp.edge) {
      var r = warpResult(save, wp);
      if (r.kind === 'deny') { st.x -= d[0]; st.y -= d[1]; }
      return r;
    }
    var out = { kind: 'move', x: nx, y: ny, encounter: null, spotted: null, trigger: null };
    if (save && save.repel > 0) { save.repel--; if (!save.repel) out.repelEnded = true; }
    // 밟으면 실행되는 칸
    var tr = (W.def.triggers || []).filter(function (t) { return t.x === nx && t.y === ny && evalCond(save, t.if); })[0];
    if (tr) { out.trigger = tr.script; return out; }
    // 트레이너 시야
    var sp = spotted(W, save, nx, ny);
    if (sp) { out.spotted = sp; return out; }
    // 수풀 조우
    if (isGrass(W, nx, ny) && W.def.area) {
      st.grass = (st.grass || 0) + 1;
      if (st.grass > T.encounterGrace && rng() < T.encounterRate) out.encounter = W.def.area;
    } else st.grass = 0;
    return out;
  }
  function warpResult(save, wp) {
    if (wp.if && !evalCond(save, wp.if)) return { kind: 'deny', text: wp.deny || '지금은 갈 수 없다.' };
    return { kind: 'warp', to: wp.to, x: wp.tx, y: wp.ty, dir: wp.dir || 'down' };
  }

  // 스프레이: 선두보다 레벨이 낮은 야생은 나오지 않는다
  function repelBlocks(save, wildLv) {
    if (!save || !(save.repel > 0)) return false;
    var lead = save.party.filter(function (m) { return m.hp > 0; })[0];
    return !!lead && wildLv < lead.lv;
  }

  /* ── 트레이너 시야 ── 아직 이기지 않은 트레이너가 바라보는 방향 sight 칸 안(막힘 없이)에 플레이어가 있으면 발견 */
  function spotted(W, save, px, py) {
    var list = npcsOf(W, save);
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (!n.trainer || !n.sight || (save && save.beaten[n.trainer])) continue;
      if (n.if && !evalCond(save, n.if)) continue;
      var d = DIRS[n.dir], path = [];
      for (var k = 1; k <= n.sight; k++) {
        var x = n.x + d[0] * k, y = n.y + d[1] * k;
        if (x === px && y === py) return { npc: n, steps: path.length, dir: n.dir, face: OPP[n.dir] };
        if (!inMap(W, x, y) || W.solid[y][x] || occupant(W, save, x, y)) break;
        path.push(n.dir);
      }
    }
    return null;
  }

  /* ── 조사(A 버튼) ── 바라보는 칸의 NPC·표지판·도구·문 */
  function interact(W, save, st) {
    var d = DIRS[st.dir], x = st.x + d[0], y = st.y + d[1];
    var occ = occupant(W, save, x, y);
    if (occ) return occ;
    var sg = signAt(W, x, y);
    if (sg) return { kind: 'sign', sign: sg };
    var dr = doorAt(W, x, y);
    if (dr) return { kind: 'door', door: dr };
    return null;
  }
  function pickItem(save, it) {
    save.flags['item:' + it.id] = 1;
    E.giveItem(save.bag, it.item, it.n || 1);
    var nm = D.ITEMS[it.item].name;
    return josa(nm, '을/를') + ((it.n || 1) > 1 ? ' ' + it.n + '개' : '') + ' 주웠다!';
  }
  function josa(w, pair) { var p = pair.split('/'); return w + (hasBatchim(w) ? p[0] : p[1]); }

  /* ── 경로 찾기 (탭으로 이동) ── 걸을 수 있는 칸만 지나는 최단 경로의 방향 목록. 목표 칸이 막혀 있으면 그 옆까지 */
  function findPath(W, save, sx, sy, tx, ty, maxLen) {
    maxLen = maxLen || 60;
    var goalBlocked = !walkable(W, save, tx, ty) || !!doorAt(W, tx, ty) || !!warpAt(W, tx, ty);
    var prev = {}, q = [[sx, sy]], key = function (x, y) { return x + ',' + y; };
    prev[key(sx, sy)] = null;
    while (q.length) {
      var c = q.shift();
      var near = Math.abs(c[0] - tx) + Math.abs(c[1] - ty);
      if ((c[0] === tx && c[1] === ty) || (goalBlocked && near === 1)) {
        var out = [], k = key(c[0], c[1]);
        while (prev[k]) { out.unshift(prev[k].dir); k = prev[k].from; }
        return out.length <= maxLen ? out : null;
      }
      for (var dir in DIRS) {
        var nx = c[0] + DIRS[dir][0], ny = c[1] + DIRS[dir][1], nk = key(nx, ny);
        if (prev.hasOwnProperty(nk)) continue;
        if (!walkable(W, save, nx, ny) || doorAt(W, nx, ny)) continue;
        if (warpAt(W, nx, ny) && !(nx === tx && ny === ty)) continue;
        prev[nk] = { from: key(c[0], c[1]), dir: dir };
        q.push([nx, ny]);
      }
    }
    return null;
  }

  // 트레이너가 플레이어 앞까지 걸어오는 방향 목록
  function approachPath(npc, sp) { var out = []; for (var i = 0; i < sp.steps; i++) out.push(npc.dir); return out; }

  // 센터 앞(회복·전멸 후 돌아오는 자리)
  function centerFront(mapId) {
    var def = PM.MAPS[mapId];
    var c = def && (def.buildings || []).filter(function (b) { return b.kind === 'center'; })[0];
    if (!c) return null;
    var d = PM.doorOf(c);
    return { map: mapId, x: d.x, y: d.y + 1, dir: 'down' };
  }
  // 날아가기 목록: 들른 적 있는 센터가 있는 맵
  function flyTargets(save) {
    return Object.keys(PM.MAPS).filter(function (id) { return save.visited[id] && centerFront(id); });
  }

  return {
    DIRS: DIRS, OPP: OPP, evalCond: evalCond, applyAction: applyAction, dexCaught: dexCaught,
    loadMap: loadMap, tileAt: tileAt, isGrass: isGrass, npcsOf: npcsOf, itemsOf: itemsOf, occupant: occupant,
    walkable: walkable, warpAt: warpAt, doorAt: doorAt, signAt: signAt, step: step, spotted: spotted,
    repelBlocks: repelBlocks, interact: interact, pickItem: pickItem, findPath: findPath, approachPath: approachPath,
    centerFront: centerFront, flyTargets: flyTargets
  };
});
