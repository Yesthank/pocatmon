/* 포캣몬 엔진 — 배틀·런·저장 순수 로직 (DOM 없음, 난수 주입식) */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./data.js'));
  else root.PEngine = factory(root.PData);
})(typeof window !== 'undefined' ? window : globalThis, function (D) {
  'use strict';
  var T = D.TUNING;

  /* ── 한국어 조사 ── */
  function hasBatchim(word) {
    var c = word.charCodeAt(word.length - 1);
    if (c < 0xac00 || c > 0xd7a3) return false;
    return (c - 0xac00) % 28 !== 0;
  }
  function josa(word, pair) { // pair: '은/는' | '이/가' | '을/를' | '과/와'
    var p = pair.split('/');
    return word + (hasBatchim(word) ? p[0] : p[1]);
  }

  /* ── 상성 ── */
  function effectiveness(moveType, defTypes) {
    var row = D.CHART[moveType] || {};
    return defTypes.reduce(function (m, t) { return m * (row[t] == null ? 1 : row[t]); }, 1);
  }

  function stageMult(s) { return Math.pow(1.5, s); }

  /* ── 몬스터 생성 ── */
  function makeFighter(id, opt) {
    opt = opt || {};
    var m = D.MONSTERS[id];
    var level = opt.level || T.startLevel;
    var g = Math.pow(T.levelGrowth, level - T.startLevel) * (opt.mult || 1);
    var hp = Math.round(m.base.hp * g);
    return {
      id: id, name: m.name, types: m.types.slice(), moves: m.moves.slice(), level: level,
      displayLevel: opt.displayLevel || level, shiny: !!opt.shiny, side: opt.side || 'player',
      maxHp: hp, hp: hp,
      atk: m.base.atk * g, def: m.base.def * g, spd: m.base.spd * g,
      stages: { atk: 0, def: 0 }, shield: 0, frozen: false, flinch: false
    };
  }

  function createBattle(run) {
    var oppId = run.order[run.stage];
    var p = makeFighter(run.starter, { level: run.level, side: 'player' });
    // 상대 강화는 배율로만 반영하고, 표시 레벨은 5 + 판 번호(보스 +2)
    var e = makeFighter(oppId, {
      level: T.startLevel, mult: T.enemyMult[run.stage], side: 'enemy',
      shiny: !!run.shiny[run.stage], displayLevel: T.startLevel + run.stage + (run.stage === 3 ? 2 : 0)
    });
    return { p: p, e: e, turn: 0, over: false, winner: null };
  }

  /* ── 피해 계산 ── */
  function calcDamage(att, def, move, rng, opts) {
    var A = att.atk * stageMult(att.stages.atk);
    var Dd = def.def * stageMult(def.stages.def);
    var eff = effectiveness(move.type, def.types);
    var stab = att.types.indexOf(move.type) >= 0 ? T.stab : 1;
    var crit = rng() < (move.highCrit ? T.highCrit : T.crit);
    var rand = 0.85 + 0.15 * rng();
    var dmg = (move.power * (A / Dd) * T.dmgScale + 2) * eff * stab * (crit ? T.critMult : 1) * rand;
    if (def.shield > 0) dmg *= T.shieldMult;
    dmg = Math.max(1, Math.floor(dmg));
    if (eff === 0) dmg = 0;
    return { dmg: dmg, eff: eff, crit: crit };
  }

  /* ── 턴 해석: 이벤트 목록 반환 ──
     이벤트: msg | use | hit | miss | heal | stat | shield | freeze | thaw | flinch | faint | line | end */
  function turnOrder(b, pMove, eMove, rng) {
    var pp = D.MOVES[pMove].priority || 0, ep = D.MOVES[eMove].priority || 0;
    if (pp !== ep) return pp > ep ? ['p', 'e'] : ['e', 'p'];
    if (b.p.spd !== b.e.spd) return b.p.spd > b.e.spd ? ['p', 'e'] : ['e', 'p'];
    return rng() < 0.5 ? ['p', 'e'] : ['e', 'p'];
  }

  function changeStage(f, stat, delta, ev) {
    var before = f.stages[stat];
    var after = Math.max(-T.stageMax, Math.min(T.stageMax, before + delta));
    var label = stat === 'atk' ? '공격' : '방어';
    if (after === before) {
      ev.push({ t: 'msg', text: f.name + '의 ' + josa(label, '은/는') + (delta > 0 ? ' 더 이상 오르지 않는다!' : ' 더 이상 떨어지지 않는다!') });
      return;
    }
    f.stages[stat] = after;
    ev.push({ t: 'stat', side: f.side, stat: stat, delta: delta, text: f.name + '의 ' + josa(label, '이/가') + (delta > 0 ? ' 올랐다!' : ' 떨어졌다!') });
  }

  function act(b, who, moveId, firstThisTurn, ev, rng) {
    var me = who === 'p' ? b.p : b.e, foe = who === 'p' ? b.e : b.p;
    var move = D.MOVES[moveId];
    if (me.frozen) {
      me.frozen = false;
      ev.push({ t: 'msg', side: me.side, text: josa(me.name, '은/는') + ' 얼어서 움직일 수 없다!' });
      ev.push({ t: 'thaw', side: me.side, text: me.name + '의 얼음이 녹았다!' });
      return null;
    }
    if (me.flinch) {
      me.flinch = false;
      ev.push({ t: 'flinch', side: me.side, text: josa(me.name, '은/는') + ' 풀이 죽어 움직일 수 없다!' });
      return null;
    }
    ev.push({ t: 'use', side: me.side, move: moveId, fx: move.fx, text: me.name + '의 ' + move.name + '!' });
    if (move.special) {
      var lines = D.MONSTERS[me.id].lines.special;
      ev.push({ t: 'line', side: me.side, text: lines[Math.floor(rng() * lines.length)] });
    }

    if (move.kind === 'heal') {
      if (me.hp >= me.maxHp) {
        ev.push({ t: 'msg', text: me.name + '의 체력은 이미 가득하다!' });
      } else {
        var amt = Math.min(me.maxHp - me.hp, Math.round(me.maxHp * move.heal));
        me.hp += amt;
        ev.push({ t: 'heal', side: me.side, amount: amt, hp: me.hp, text: josa(me.name, '은/는') + ' 체력을 회복했다!' });
      }
      if (move.cure && (me.stages.atk < 0 || me.stages.def < 0)) {
        if (me.stages.atk < 0) me.stages.atk = 0;
        if (me.stages.def < 0) me.stages.def = 0;
        ev.push({ t: 'stat', side: me.side, stat: 'cure', delta: 0, text: me.name + '의 떨어진 능력이 원래대로 돌아왔다!' });
      }
      if (move.atkUp) changeStage(me, 'atk', move.atkUp, ev);
      return null;
    }
    if (move.kind === 'shield') {
      me.shield = T.shieldTurns;
      ev.push({ t: 'shield', side: me.side, on: true, text: josa(me.name, '은/는') + ' 보호막을 펼쳤다!' });
      return null;
    }

    // 공격
    if (rng() * 100 >= move.acc) {
      ev.push({ t: 'miss', side: foe.side, text: me.name + '의 공격이 빗나갔다!' });
      return null;
    }
    var hits = 1;
    if (move.hits) hits = move.hits[0] + Math.floor(rng() * (move.hits[1] - move.hits[0] + 1));
    var total = 0, landed = 0, eff = 1, fainted = null;
    for (var i = 0; i < hits; i++) {
      var r = calcDamage(me, foe, move, rng);
      eff = r.eff;
      var dealt = Math.min(foe.hp, r.dmg);
      foe.hp -= dealt; total += dealt; landed++;
      ev.push({ t: 'hit', side: foe.side, dmg: dealt, eff: r.eff, crit: r.crit, hp: foe.hp, fx: move.fx, hitIndex: i });
      if (r.crit) ev.push({ t: 'msg', text: '급소에 맞았다!' });
      if (foe.hp <= 0) { fainted = foe; break; }
    }
    if (eff > 1) ev.push({ t: 'msg', text: '효과가 굉장했다!' });
    else if (eff < 1) ev.push({ t: 'msg', text: '효과가 별로인 듯하다…' });
    if (hits > 1) ev.push({ t: 'msg', text: landed + '번 맞았다!' });

    if (fainted) {
      ev.push({ t: 'faint', side: foe.side, text: josa(foe.name, '은/는') + ' 쓰러졌다!' });
    } else {
      if (move.defDown) changeStage(foe, 'def', -move.defDown, ev);
      if (move.atkDown) changeStage(foe, 'atk', -move.atkDown, ev);
      if (move.freeze && !foe.frozen && rng() < move.freeze) {
        foe.frozen = true;
        ev.push({ t: 'freeze', side: foe.side, text: josa(foe.name, '은/는') + ' 얼어붙었다!' });
      }
      if (move.flinch && firstThisTurn && rng() < move.flinch) foe.flinch = true;
    }
    if (move.recoil && total > 0) {
      var rec = Math.min(me.hp, Math.max(1, Math.floor(total * move.recoil)));
      me.hp -= rec;
      ev.push({ t: 'hit', side: me.side, dmg: rec, eff: 1, crit: false, hp: me.hp, fx: 'recoil', recoil: true, text: josa(me.name, '은/는') + ' 반동으로 피해를 입었다!' });
      if (me.hp <= 0) ev.push({ t: 'faint', side: me.side, text: josa(me.name, '은/는') + ' 쓰러졌다!' });
    }
    // 먼저 쓰러진 쪽이 패배
    if (fainted) return foe.side === 'enemy' ? 'player' : 'enemy';
    if (me.hp <= 0) return me.side === 'enemy' ? 'player' : 'enemy';
    return null;
  }

  function resolveTurn(b, pMove, eMove, rng) {
    rng = rng || Math.random;
    var ev = [];
    if (b.over) return ev;
    b.turn++;
    var order = turnOrder(b, pMove, eMove, rng);
    var winner = null;
    for (var i = 0; i < 2 && !winner; i++) {
      var who = order[i];
      winner = act(b, who, who === 'p' ? pMove : eMove, i === 0, ev, rng);
    }
    // 턴 종료 처리
    [b.p, b.e].forEach(function (f) {
      f.flinch = false;
      if (f.shield > 0) {
        f.shield--;
        if (f.shield === 0 && f.hp > 0 && !winner) ev.push({ t: 'shield', side: f.side, on: false, text: f.name + '의 보호막이 사라졌다.' });
      }
    });
    if (winner) {
      b.over = true; b.winner = winner;
      var loser = winner === 'player' ? b.e : b.p, champ = winner === 'player' ? b.p : b.e;
      var fl = D.MONSTERS[loser.id].lines.faint;
      ev.push({ t: 'line', side: loser.side, text: fl[0] });
      ev.push({ t: 'end', winner: winner, champ: champ.side });
    }
    return ev;
  }

  /* ── 상대 AI ── */
  function scoreMove(me, foe, moveId) {
    var mv = D.MOVES[moveId];
    if (mv.kind === 'atk') {
      var eff = effectiveness(mv.type, foe.types);
      var stab = me.types.indexOf(mv.type) >= 0 ? T.stab : 1;
      var hits = mv.hits ? (mv.hits[0] + mv.hits[1]) / 2 : 1;
      var s = mv.power * hits * (mv.acc / 100) * eff * stab;
      if (mv.priority && foe.hp < foe.maxHp * 0.25) s *= 1.6;
      if (mv.recoil && me.hp < me.maxHp * 0.3) s *= 0.5;
      return Math.max(4, s);
    }
    var ratio = me.hp / me.maxHp;
    if (mv.kind === 'heal') return ratio < 0.35 ? 140 : ratio < 0.6 ? 55 : ratio < 0.9 ? 12 : 1;
    if (mv.kind === 'shield') return me.shield > 0 ? 2 : ratio < 0.6 ? 55 : 22;
    return 10;
  }
  function chooseEnemyMove(b, rng) {
    rng = rng || Math.random;
    var me = b.e, foe = b.p;
    var w = me.moves.map(function (id) { var s = scoreMove(me, foe, id); return s * s; });
    var sum = w.reduce(function (a, c) { return a + c; }, 0);
    var r = rng() * sum;
    for (var i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return me.moves[i]; }
    return me.moves[me.moves.length - 1];
  }

  /* ── 런 ── */
  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function createRun(starter, rng) {
    rng = rng || Math.random;
    var cats = D.CATS;
    var order, cutscene;
    if (cats.indexOf(starter) >= 0) {
      order = shuffle(cats.filter(function (c) { return c !== starter; }), rng).concat(['metal', 'black']);
      cutscene = 'corrupt';
    } else if (starter === 'metal') {
      order = shuffle(cats, rng).concat(['black']); cutscene = 'shadow';
    } else if (starter === 'black') {
      order = shuffle(cats, rng).concat(['metal']); cutscene = 'face';
    } else throw new Error('unknown starter ' + starter);
    var shiny = order.map(function (id) { return D.MONSTERS[id].cat ? rng() < T.shinyRate : false; });
    return { v: 1, starter: starter, order: order, shiny: shiny, stage: 0, level: T.startLevel, cutscene: cutscene };
  }
  function cutsceneBefore(run) { return run.stage === 3 ? run.cutscene : null; }
  function winBattle(run) {
    run.stage++; run.level++;
    return run.stage >= run.order.length ? 'cleared' : 'next';
  }
  function isValidRun(r) {
    if (!r || typeof r !== 'object' || r.v !== 1) return false;
    if (!D.MONSTERS[r.starter] || !Array.isArray(r.order) || r.order.length !== 4) return false;
    if (!r.order.every(function (id) { return !!D.MONSTERS[id]; })) return false;
    if (!Array.isArray(r.shiny) || r.shiny.length !== 4) return false;
    if (!Number.isInteger(r.stage) || r.stage < 0 || r.stage > 3) return false;
    if (!Number.isInteger(r.level) || r.level < 1 || r.level > 99) return false;
    return ['corrupt', 'shadow', 'face'].indexOf(r.cutscene) >= 0;
  }

  /* ── 저장 (어댑터 주입식, 실패 시 메모리 대체) ── */
  var KEY_UNLOCK = 'pocatmon.unlocked.black', KEY_RUN = 'pocatmon.run';
  function createStore(storage) {
    // 이번 방문에서 쓴 값(삭제 포함)이 저장소보다 우선한다 — 쓰기만 실패하는 저장소에서도 옛 값이 되살아나지 않게
    var mem = {};
    function get(k) {
      if (Object.prototype.hasOwnProperty.call(mem, k)) return mem[k];
      try { if (storage) { var v = storage.getItem(k); if (v !== null && v !== undefined) return v; } } catch (e) { /* 메모리 대체 */ }
      return null;
    }
    function set(k, v) {
      mem[k] = v;
      try { if (storage) storage.setItem(k, v); } catch (e) { /* 메모리 대체 */ }
    }
    function del(k) {
      mem[k] = null;
      try { if (storage) storage.removeItem(k); } catch (e) { /* 메모리 대체 */ }
    }
    return {
      isUnlocked: function () { return get(KEY_UNLOCK) === '1'; },
      unlock: function () { set(KEY_UNLOCK, '1'); },
      saveRun: function (run) { set(KEY_RUN, JSON.stringify(run)); },
      loadRun: function () {
        var raw = get(KEY_RUN);
        if (!raw) return null;
        try { var r = JSON.parse(raw); return isValidRun(r) ? r : null; } catch (e) { return null; }
      },
      clearRun: function () { del(KEY_RUN); }
    };
  }

  return {
    josa: josa, effectiveness: effectiveness, stageMult: stageMult, makeFighter: makeFighter,
    createBattle: createBattle, calcDamage: calcDamage, resolveTurn: resolveTurn, turnOrder: turnOrder,
    chooseEnemyMove: chooseEnemyMove, scoreMove: scoreMove,
    createRun: createRun, cutsceneBefore: cutsceneBefore, winBattle: winBattle, isValidRun: isValidRun,
    createStore: createStore, KEYS: { unlock: KEY_UNLOCK, run: KEY_RUN }
  };
});
