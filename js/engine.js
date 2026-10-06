/* 포캣몬 엔진 — 배틀·포획·성장·저장 순수 로직 (DOM 없음, 난수 주입식)
   전투 규칙은 실제 포켓몬을 따른다: 5세대 이후 데미지 공식, 물리/특수 분리, PP, 상태이상, 랭크 ±6, 명중·회피,
   우선도, 교체, 3~4세대 포획 공식, 3세대 도망 공식, 중간 빠르기 경험치 곡선(레벨³). 특성·도구·날씨는 없다. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./data.js'));
  else root.PEngine = factory(root.PData);
})(typeof window !== 'undefined' ? window : globalThis, function (D) {
  'use strict';
  var T = D.TUNING;
  var STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  var STAGES = ['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva'];

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

  function randInt(rng, a, b) { return a + Math.floor(rng() * (b - a + 1)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ── 상성·능력치 ── */
  function effectiveness(moveType, defTypes) {
    var row = D.CHART[moveType];
    if (!row) return 1;
    return defTypes.reduce(function (m, t) { return m * (row[t] == null ? 1 : row[t]); }, 1);
  }
  function stageMult(s) { return s >= 0 ? (2 + s) / 2 : 2 / (2 - s); }
  function accMult(s) { return s >= 0 ? (3 + s) / 3 : 3 / (3 - s); }

  // 3세대 이후 능력치 공식 (노력치·성격 없음)
  function calcStats(mon) {
    var b = D.MONSTERS[mon.id].base, L = mon.lv, iv = mon.iv || {}, out = {};
    STATS.forEach(function (k) {
      var core = Math.floor((2 * b[k] + (iv[k] || 0)) * L / 100);
      out[k] = k === 'hp' ? core + L + 10 : core + 5;
    });
    return out;
  }
  function maxHp(mon) { return calcStats(mon).hp; }
  function expForLevel(lv) { return lv <= 1 ? 0 : lv * lv * lv; }

  function movesAt(id, lv) {
    return D.MONSTERS[id].learn.filter(function (l) { return l[1] <= lv; }).map(function (l) { return l[0]; }).slice(-4);
  }

  /* ── 몬스터 생성 ── */
  function createMon(id, lv, rng, opt) {
    rng = rng || Math.random; opt = opt || {};
    if (!D.MONSTERS[id]) throw new Error('unknown monster ' + id);
    var iv = {};
    STATS.forEach(function (k) { iv[k] = opt.iv != null ? opt.iv : randInt(rng, 0, 31); });
    var mon = {
      uid: opt.uid || 0, id: id, lv: lv, exp: expForLevel(lv), iv: iv, hp: 0, status: null, slp: 0,
      moves: movesAt(id, lv).map(function (m) { return { id: m, pp: D.MOVES[m].pp }; }),
      shiny: opt.shiny != null ? !!opt.shiny : (D.MONSTERS[id].cat ? rng() < T.shinyRate : false)
    };
    mon.hp = maxHp(mon);
    return mon;
  }
  function healMon(mon) {
    mon.hp = maxHp(mon); mon.status = null; mon.slp = 0;
    mon.moves.forEach(function (m) { m.pp = D.MOVES[m.id].pp; });
  }
  function isAlive(mon) { return mon && mon.hp > 0; }
  function firstAlive(party) {
    for (var i = 0; i < party.length; i++) if (isAlive(party[i])) return i;
    return -1;
  }
  function aliveCount(party) { return party.filter(isAlive).length; }
  function monName(mon) { return D.MONSTERS[mon.id].name; }
  function hasUsableMove(mon) { return mon.moves.some(function (m) { return m.pp > 0; }); }

  /* ── 배틀 생성 ── */
  function freshVol() { return { stages: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 }, cnf: 0, flinch: false, toxN: 0 }; }
  function makeSide(party, active) { return { party: party, active: active, screen: 0, vol: freshVol() }; }

  function makeBattle(kind, pParty, eParty, opt) {
    opt = opt || {};
    var pa = firstAlive(pParty);
    if (pa < 0) throw new Error('no usable monster');
    var b = {
      kind: kind, areaId: opt.areaId || null, trainer: opt.trainer || null, final: !!opt.final,
      p: makeSide(pParty, pa), e: makeSide(eParty, 0),
      turn: 0, over: false, winner: null, result: null, needSwitch: false, runTries: 0,
      participants: {}, caught: null, seen: [eParty[0].id], cutsceneDone: false
    };
    b.participants[pParty[pa].uid] = true;
    return b;
  }
  function active(b, who) { var s = b[who]; return s.party[s.active]; }

  function pickWeighted(list, rng) {
    var sum = list.reduce(function (a, w) { return a + w[1]; }, 0), r = rng() * sum;
    for (var i = 0; i < list.length; i++) { r -= list[i][1]; if (r < 0) return list[i][0]; }
    return list[list.length - 1][0];
  }
  function areaById(id) { return D.AREAS.filter(function (a) { return a.id === id; })[0] || null; }

  function createWildBattle(save, areaId, rng) {
    rng = rng || Math.random;
    var area = areaById(areaId);
    if (!area || !area.wild) throw new Error('no wild area ' + areaId);
    var id = pickWeighted(area.wild, rng);
    var wild = createMon(id, randInt(rng, area.lv[0], area.lv[1]), rng, { uid: -1 });
    return makeBattle('wild', save.party, [wild], { areaId: areaId });
  }
  function createGymBattle(save, areaId, rng) {
    rng = rng || Math.random;
    var area = areaById(areaId);
    if (!area || !area.gym) throw new Error('no gym ' + areaId);
    var team = area.gym.team.map(function (t, i) { return createMon(t[0], t[1], rng, { shiny: false, uid: -(i + 1) }); });
    return makeBattle('trainer', save.party, team, { areaId: areaId, trainer: area.gym, final: !!area.final });
  }

  // 배틀 시작 연출용 이벤트 (상대 등장 → 내 몬스터 등장)
  function beginBattle(b) {
    var ev = [], e = active(b, 'e'), p = active(b, 'p');
    if (b.kind === 'wild') {
      ev.push(switchInEv('enemy', e, (e.shiny ? '✦ ' : '') + '야생의 ' + josa(monName(e), '이/가') + ' 나타났다!'));
    } else {
      ev.push({ t: 'line', side: 'enemy', trainer: true, text: b.trainer.lines.intro });
      ev.push({ t: 'msg', text: josa(b.trainer.name, '이/가') + ' 승부를 걸어왔다!' });
      ev.push(switchInEv('enemy', e, josa(b.trainer.name, '은/는') + ' ' + josa(monName(e), '을/를') + ' 내보냈다!'));
    }
    ev.push(switchInEv('player', p, '가랏, ' + monName(p) + '!'));
    return ev;
  }
  function switchInEv(side, mon, text) {
    return { t: 'switchIn', side: side, id: mon.id, uid: mon.uid, shiny: !!mon.shiny, lv: mon.lv, exp: mon.exp, hp: mon.hp, maxHp: maxHp(mon), status: mon.status, text: text };
  }

  /* ── 데미지 ── */
  function effSpeed(side) {
    var mon = side.party[side.active];
    return calcStats(mon).spe * stageMult(side.vol.stages.spe) * (mon.status === 'par' ? T.parSpeed : 1);
  }

  function calcDamage(att, attSide, def, defSide, move, rng, opt) {
    opt = opt || {};
    var phys = move.cat === 'phys';
    var as = calcStats(att), ds = calcStats(def);
    var aStage = attSide.vol.stages[phys ? 'atk' : 'spa'], dStage = defSide.vol.stages[phys ? 'def' : 'spd'];
    var crit = opt.noCrit ? false : rng() < (move.highCrit ? T.highCritRate : T.critRate);
    if (crit) { aStage = Math.max(0, aStage); dStage = Math.min(0, dStage); }
    var A = Math.floor((phys ? as.atk : as.spa) * stageMult(aStage));
    var Dv = Math.floor((phys ? ds.def : ds.spd) * stageMult(dStage));
    var eff = move.type === 'none' ? 1 : effectiveness(move.type, D.MONSTERS[def.id].types);
    var dmg = Math.floor(Math.floor(Math.floor(2 * att.lv / 5 + 2) * move.power * A / Math.max(1, Dv)) / 50) + 2;
    if (crit) dmg = Math.floor(dmg * T.critMult);
    dmg = Math.floor(dmg * (opt.roll != null ? opt.roll : randInt(rng, 85, 100)) / 100);
    if (move.type !== 'none' && D.MONSTERS[att.id].types.indexOf(move.type) >= 0) dmg = Math.floor(dmg * T.stab);
    dmg = Math.floor(dmg * eff);
    if (phys && att.status === 'brn' && !move.selfHit) dmg = Math.floor(dmg / 2);
    if (defSide.screen > 0 && !crit && !move.selfHit) dmg = Math.floor(dmg * T.screenMult);
    if (eff > 0 && dmg < 1) dmg = 1;
    return { dmg: eff === 0 ? 0 : dmg, eff: eff, crit: crit };
  }

  /* ── 상태 변화 ── */
  var STATUS_TEXT = {
    brn: ' 화상을 입었다!', psn: ' 독에 걸렸다!', tox: ' 맹독에 걸렸다!',
    par: ' 마비되어 기술이 나오기 어려워졌다!', slp: ' 잠들어 버렸다!', frz: ' 얼어붙었다!'
  };
  function statusImmune(mon, kind) {
    var ty = D.MONSTERS[mon.id].types;
    if (kind === 'brn') return ty.indexOf('fire') >= 0;
    if (kind === 'par') return ty.indexOf('electric') >= 0;
    if (kind === 'psn' || kind === 'tox') return ty.indexOf('poison') >= 0 || ty.indexOf('steel') >= 0;
    if (kind === 'frz') return ty.indexOf('ice') >= 0;
    return false;
  }
  // 상태이상을 건다. 실패하면 false (loud면 실패 메시지)
  function inflict(side, sideName, kind, ev, rng, loud) {
    var mon = side.party[side.active];
    if (mon.status || statusImmune(mon, kind)) {
      if (loud) ev.push({ t: 'msg', text: monName(mon) + '에게는 효과가 없는 것 같다…' });
      return false;
    }
    mon.status = kind;
    if (kind === 'slp') mon.slp = randInt(rng, T.sleepTurns[0], T.sleepTurns[1]);
    if (kind === 'tox') side.vol.toxN = 0;
    ev.push({ t: 'status', side: sideName, kind: kind, text: josa(monName(mon), '은/는') + STATUS_TEXT[kind] });
    return true;
  }
  function confuse(side, sideName, ev, rng, loud) {
    var mon = side.party[side.active];
    if (side.vol.cnf > 0) {
      if (loud) ev.push({ t: 'msg', text: josa(monName(mon), '은/는') + ' 이미 혼란 상태다!' });
      return false;
    }
    side.vol.cnf = randInt(rng, T.confuseTurns[0], T.confuseTurns[1]);
    ev.push({ t: 'status', side: sideName, kind: 'cnf', text: josa(monName(mon), '은/는') + ' 혼란에 빠졌다!' });
    return true;
  }
  function changeStage(side, sideName, stat, delta, ev) {
    var mon = side.party[side.active];
    var before = side.vol.stages[stat], after = clamp(before + delta, -T.stageMax, T.stageMax);
    var label = D.STAT_NAMES[stat];
    if (after === before) {
      ev.push({ t: 'msg', text: monName(mon) + '의 ' + josa(label, '은/는') + (delta > 0 ? ' 더 이상 오르지 않는다!' : ' 더 이상 떨어지지 않는다!') });
      return;
    }
    side.vol.stages[stat] = after;
    var big = Math.abs(delta) >= 2 ? ' 크게' : '';
    ev.push({ t: 'stat', side: sideName, stat: stat, delta: delta, text: monName(mon) + '의 ' + josa(label, '이/가') + big + (delta > 0 ? ' 올랐다!' : ' 떨어졌다!') });
  }
  function applyStages(side, sideName, map, ev) {
    STAGES.forEach(function (k) { if (map[k]) changeStage(side, sideName, k, map[k], ev); });
  }

  function hpEv(side, mon, ev, extra) {
    var o = { side: side, hp: mon.hp, maxHp: maxHp(mon) };
    for (var k in extra) o[k] = extra[k];
    ev.push(o);
    return o;
  }

  /* ── 기술 실행 ── */
  function multiHits(move, rng) {
    if (!move.hits) return 1;
    if (typeof move.hits === 'number') return move.hits;
    if (move.hits[0] === 2 && move.hits[1] === 5) {
      var r = rng(), acc = 0;
      for (var i = 0; i < T.multiHit.length; i++) { acc += T.multiHit[i][1]; if (r < acc) return T.multiHit[i][0]; }
      return 5;
    }
    return randInt(rng, move.hits[0], move.hits[1]);
  }

  // who: 'p' | 'e'. slot: 기술 칸 번호(-1이면 발버둥). first: 이번 턴 상대보다 먼저 행동했는지
  function useMove(b, who, slot, first, ev, rng) {
    var S = b[who], F = b[who === 'p' ? 'e' : 'p'];
    var sn = who === 'p' ? 'player' : 'enemy', fn = who === 'p' ? 'enemy' : 'player';
    var me = S.party[S.active], foe = F.party[F.active];
    var name = monName(me);

    // 행동 전 확인: 잠듦 → 얼음 → 풀죽음 → 혼란 → 마비
    if (me.status === 'slp') {
      if (me.slp > 0) {
        me.slp--;
        ev.push({ t: 'status', side: sn, kind: 'slp', tick: true, text: josa(name, '은/는') + ' 쿨쿨 잠들어 있다.' });
        return;
      }
      me.status = null;
      ev.push({ t: 'cure', side: sn, kind: 'slp', text: josa(name, '은/는') + ' 눈을 떴다!' });
    }
    if (me.status === 'frz') {
      if (rng() < T.thawRate) {
        me.status = null;
        ev.push({ t: 'cure', side: sn, kind: 'frz', text: name + '의 얼음이 녹았다!' });
      } else {
        ev.push({ t: 'status', side: sn, kind: 'frz', tick: true, text: josa(name, '은/는') + ' 얼어붙어서 움직일 수 없다!' });
        return;
      }
    }
    if (S.vol.flinch) {
      S.vol.flinch = false;
      ev.push({ t: 'flinch', side: sn, text: josa(name, '은/는') + ' 풀이 죽어 움직일 수 없다!' });
      return;
    }
    if (S.vol.cnf > 0) {
      S.vol.cnf--;
      if (S.vol.cnf === 0) {
        ev.push({ t: 'cure', side: sn, kind: 'cnf', text: name + '의 혼란이 풀렸다!' });
      } else {
        ev.push({ t: 'status', side: sn, kind: 'cnf', tick: true, text: josa(name, '은/는') + ' 혼란에 빠져 있다!' });
        if (rng() < T.confuseHit) {
          var self = { type: 'none', cat: 'phys', power: 40, selfHit: true };
          var r0 = calcDamage(me, S, me, S, self, rng, { noCrit: true });
          var d0 = Math.min(me.hp, r0.dmg);
          me.hp -= d0;
          hpEv(sn, me, ev, { t: 'hit', dmg: d0, eff: 1, crit: false, fx: 'normal', selfHit: true, text: '영문도 모른 채 자신을 공격했다!' });
          if (me.hp <= 0) faintEv(b, sn, me, ev);
          return;
        }
      }
    }
    if (me.status === 'par' && rng() < T.parSkip) {
      ev.push({ t: 'status', side: sn, kind: 'par', tick: true, text: josa(name, '은/는') + ' 몸이 저려서 움직일 수 없다!' });
      return;
    }

    var moveId = slot >= 0 ? me.moves[slot].id : 'struggle';
    var move = D.MOVES[moveId];
    if (slot >= 0) me.moves[slot].pp = Math.max(0, me.moves[slot].pp - 1);
    ev.push({ t: 'use', side: sn, move: moveId, type: move.type, fx: move.type === 'none' ? 'normal' : move.type, cat: move.cat,
      text: (slot < 0 ? josa(name, '은/는') + ' 쓸 수 있는 기술이 없다! ' : '') + name + '의 ' + move.name + '!' });
    if (move.ult) {
      var sp = D.MONSTERS[me.id].lines.special;
      ev.push({ t: 'line', side: sn, text: sp[Math.floor(rng() * sp.length)] });
    }

    var targetsFoe = move.cat !== 'status' || !!(move.status || move.confuse || move.foe);
    // 명중 판정 (변화 기술 중 자신에게 쓰는 것은 생략)
    function hits() {
      if (move.acc == null || !targetsFoe) return true;
      var stage = clamp(S.vol.stages.acc - F.vol.stages.eva, -6, 6);
      return rng() * 100 < move.acc * accMult(stage);
    }

    /* 변화 기술 */
    if (move.cat === 'status') {
      if (targetsFoe) {
        if (!isAlive(foe)) { ev.push({ t: 'msg', text: '그러나 실패하고 말았다!' }); return; }
        if ((move.checkType && effectiveness(move.type, D.MONSTERS[foe.id].types) === 0) ||
            (move.powder && D.MONSTERS[foe.id].types.indexOf('grass') >= 0)) {
          ev.push({ t: 'msg', text: monName(foe) + '에게는 효과가 없는 것 같다…' });
          return;
        }
        if (!hits()) { ev.push({ t: 'miss', side: fn, text: name + '의 공격은 빗나갔다!' }); return; }
        if (move.status) inflict(F, fn, move.status, ev, rng, true);
        if (move.confuse) confuse(F, fn, ev, rng, true);
        if (move.foe) applyStages(F, fn, move.foe, ev);
      }
      if (move.screen) {
        if (S.screen > 0) ev.push({ t: 'msg', text: '그러나 실패하고 말았다!' });
        else { S.screen = T.screenTurns; ev.push({ t: 'screen', side: sn, on: true, text: josa(name, '은/는') + ' 보호막을 펼쳤다!' }); }
      }
      if (move.heal) {
        var mx = maxHp(me);
        if (me.hp >= mx) ev.push({ t: 'msg', text: name + '의 체력은 이미 가득하다!' });
        else {
          var amt = Math.min(mx - me.hp, Math.max(1, Math.floor(mx * move.heal)));
          me.hp += amt;
          hpEv(sn, me, ev, { t: 'heal', amount: amt, text: josa(name, '은/는') + ' 체력을 회복했다!' });
        }
      }
      if (move.cure) {
        var low = STAGES.filter(function (k) { return S.vol.stages[k] < 0; });
        if (low.length) {
          low.forEach(function (k) { S.vol.stages[k] = 0; });
          ev.push({ t: 'stat', side: sn, stat: 'cure', delta: 0, text: name + '의 떨어진 능력이 원래대로 돌아왔다!' });
        }
      }
      if (move.self) applyStages(S, sn, move.self, ev);
      return;
    }

    /* 공격 기술 */
    if (!isAlive(foe)) { ev.push({ t: 'msg', text: '그러나 상대가 없다!' }); return; }
    var eff = move.type === 'none' ? 1 : effectiveness(move.type, D.MONSTERS[foe.id].types);
    if (eff === 0) { ev.push({ t: 'msg', text: monName(foe) + '에게는 효과가 없는 것 같다…' }); return; }
    if (!hits()) { ev.push({ t: 'miss', side: fn, text: name + '의 공격은 빗나갔다!' }); return; }
    if (move.breakScreen && F.screen > 0) {
      F.screen = 0;
      ev.push({ t: 'screen', side: fn, on: false, text: monName(foe) + '의 보호막이 깨졌다!' });
    }
    var n = multiHits(move, rng), total = 0, landed = 0;
    for (var i = 0; i < n; i++) {
      var r = calcDamage(me, S, foe, F, move, rng);
      var dealt = Math.min(foe.hp, r.dmg);
      foe.hp -= dealt; total += dealt; landed++;
      hpEv(fn, foe, ev, { t: 'hit', dmg: dealt, eff: r.eff, crit: r.crit, fx: move.type === 'none' ? 'normal' : move.type, hitIndex: i });
      if (r.crit) ev.push({ t: 'msg', text: '급소에 맞았다!' });
      if (foe.hp <= 0) break;
    }
    if (eff > 1) ev.push({ t: 'msg', text: '효과가 굉장했다!' });
    else if (eff < 1) ev.push({ t: 'msg', text: '효과가 별로인 듯하다…' });
    if (n > 1) ev.push({ t: 'msg', text: landed + '번 맞았다!' });

    if (foe.hp <= 0) {
      faintEv(b, fn, foe, ev);
    } else {
      if (foe.status === 'frz' && move.type === 'fire') {
        foe.status = null;
        ev.push({ t: 'cure', side: fn, kind: 'frz', text: monName(foe) + '의 얼음이 녹았다!' });
      }
      if (move.status && rng() * 100 < move.statusChance) inflict(F, fn, move.status, ev, rng, false);
      if (move.confuse && rng() * 100 < move.confuse) confuse(F, fn, ev, rng, false);
      if (move.flinch && first && rng() * 100 < move.flinch) F.vol.flinch = true;
      if (move.foe && rng() * 100 < (move.foeChance || 100)) applyStages(F, fn, move.foe, ev);
    }
    if (move.self && isAlive(me) && rng() * 100 < (move.selfChance || 100)) applyStages(S, sn, move.self, ev);
    if (move.drain && total > 0 && isAlive(me)) {
      var mxd = maxHp(me), gain = Math.min(mxd - me.hp, Math.max(1, Math.floor(total * move.drain)));
      if (gain > 0) { me.hp += gain; hpEv(sn, me, ev, { t: 'heal', amount: gain, text: monName(foe) + '의 체력을 빨아들였다!' }); }
    }
    if ((move.recoil || move.struggle) && total > 0 && isAlive(me)) {
      var rec = move.struggle ? Math.floor(maxHp(me) * T.struggleRecoil) : Math.floor(total * move.recoil);
      rec = Math.min(me.hp, Math.max(1, rec));
      me.hp -= rec;
      hpEv(sn, me, ev, { t: 'hit', dmg: rec, eff: 1, crit: false, fx: 'recoil', recoil: true, text: josa(name, '은/는') + ' 반동으로 데미지를 입었다!' });
      if (me.hp <= 0) faintEv(b, sn, me, ev);
    }
  }

  /* ── 교체·포획·도망 ── */
  function doSwitch(b, who, idx, ev, quiet) {
    var S = b[who], sn = who === 'p' ? 'player' : 'enemy';
    var old = S.party[S.active], next = S.party[idx];
    if (!quiet && isAlive(old)) ev.push({ t: 'switchOut', side: sn, uid: old.uid, text: sn === 'player' ? '돌아와, ' + monName(old) + '!' : josa(monName(old), '을/를') + ' 불러들였다!' });
    S.active = idx;
    S.vol = freshVol();
    var text = sn === 'player' ? '가랏, ' + monName(next) + '!'
      : (b.trainer ? josa(b.trainer.name, '은/는') + ' ' + josa(monName(next), '을/를') + ' 내보냈다!' : '');
    ev.push(switchInEv(sn, next, text));
    if (who === 'p') b.participants[next.uid] = true;
    else if (b.seen.indexOf(next.id) < 0) b.seen.push(next.id);
  }
  function canSwitchTo(b, idx) {
    var S = b.p;
    return idx >= 0 && idx < S.party.length && idx !== S.active && isAlive(S.party[idx]);
  }

  // 3~4세대 포획 공식. 반환: { shakes: 0~3, caught }
  function catchRoll(mon, rng) {
    var M = maxHp(mon), H = mon.hp, rate = D.MONSTERS[mon.id].catchRate;
    var bonus = mon.status === 'slp' || mon.status === 'frz' ? 2 : mon.status ? 1.5 : 1;
    var a = Math.floor((3 * M - 2 * H) * rate * T.ballBonus / (3 * M)) * bonus;
    if (a >= 255) return { shakes: 3, caught: true, a: a };
    var bb = Math.floor(1048560 / Math.sqrt(Math.sqrt(16711680 / Math.max(1, a))));
    var ok = 0;
    for (var i = 0; i < 4; i++) { if (rng() * 65536 < bb) ok++; else break; }
    return { shakes: Math.min(3, ok), caught: ok === 4, a: a };
  }

  // 3세대 도망 공식
  function escapeRoll(b, rng) {
    var mine = calcStats(active(b, 'p')).spe, theirs = calcStats(active(b, 'e')).spe;
    b.runTries++;
    if (mine >= theirs) return true;
    var f = Math.floor(mine * 128 / Math.max(1, theirs)) + 30 * b.runTries;
    return f > 255 || rng() * 256 < f;
  }

  /* ── 경험치·성장 ── */
  function gainExp(mon, amount, ev) {
    if (mon.lv >= T.maxLevel || amount <= 0) return;
    mon.exp += amount;
    ev.push({ t: 'exp', side: 'player', uid: mon.uid, amount: amount, text: josa(monName(mon), '은/는') + ' 경험치를 ' + amount + ' 얻었다!' });
    while (mon.lv < T.maxLevel && mon.exp >= expForLevel(mon.lv + 1)) {
      var before = maxHp(mon);
      mon.lv++;
      var after = maxHp(mon);
      if (mon.hp > 0) mon.hp += after - before;
      ev.push({ t: 'levelUp', side: 'player', uid: mon.uid, lv: mon.lv, hp: mon.hp, maxHp: after, text: monName(mon) + '의 레벨이 ' + mon.lv + ([0, 3, 6].indexOf(mon.lv % 10) >= 0 ? '으로' : '로') + ' 올랐다!' });
      D.MONSTERS[mon.id].learn.forEach(function (l) {
        if (l[1] === mon.lv && mon.moves.length < 4 && !mon.moves.some(function (m) { return m.id === l[0]; })) {
          mon.moves.push({ id: l[0], pp: D.MOVES[l[0]].pp });
          ev.push({ t: 'learn', side: 'player', uid: mon.uid, move: l[0], text: josa(monName(mon), '은/는') + ' 새로 ' + josa(D.MOVES[l[0]].name, '을/를') + ' 배웠다!' });
        }
      });
    }
  }
  function expYield(b, foe, participant) {
    var base = D.MONSTERS[foe.id].xp * foe.lv / 7 * (b.kind === 'trainer' ? T.trainerExp : 1) * T.expMult;
    return Math.max(1, Math.floor(base * (participant ? 1 : T.expShare)));
  }
  // 쓰러짐: 이벤트를 내고, 상대 몬스터면 그 자리에서 경험치를 준다(원작처럼 턴 끝 독 데미지 전에)
  function faintEv(b, side, mon, ev) {
    ev.push({ t: 'faint', side: side, id: mon.id, text: josa(monName(mon), '은/는') + ' 쓰러졌다!' });
    b.lastFaint = side;
    if (side === 'enemy') awardExp(b, mon, ev);
  }
  function awardExp(b, foe, ev) {
    b.p.party.forEach(function (mon) {
      if (!isAlive(mon)) return;
      gainExp(mon, expYield(b, foe, !!b.participants[mon.uid]), ev);
    });
  }

  /* ── 상대 행동 ── */
  function estimate(b, who, slot) {
    var S = b[who], F = b[who === 'p' ? 'e' : 'p'];
    var me = S.party[S.active], foe = F.party[F.active];
    var mv = D.MOVES[me.moves[slot].id];
    var ratio = me.hp / maxHp(me), fv = F.vol;
    if (mv.cat !== 'status') {
      var r = calcDamage(me, S, foe, F, mv, Math.random, { noCrit: true, roll: 92 });
      var hitsAvg = mv.hits ? (typeof mv.hits === 'number' ? mv.hits : 3.1) : 1;
      var frac = r.dmg * hitsAvg * ((mv.acc || 100) / 100) / Math.max(1, foe.hp);
      var s = Math.min(1.2, frac) * 100;
      if (r.eff === 0) return 0.2;
      if (mv.priority && frac >= 1) s *= 1.4;
      if ((mv.recoil || mv.self) && ratio < 0.3) s *= 0.6;
      return Math.max(3, s);
    }
    var s2 = 0;
    if (mv.heal) s2 = Math.max(s2, ratio < 0.35 ? 110 : ratio < 0.6 ? 45 : ratio < 0.9 ? 8 : 0.5);
    if (mv.screen) s2 = Math.max(s2, S.screen > 0 ? 0.5 : ratio > 0.5 ? 38 : 20);
    if (mv.status) s2 = Math.max(s2, foe.status || statusImmune(foe, mv.status) || (mv.powder && D.MONSTERS[foe.id].types.indexOf('grass') >= 0) ||
      (mv.checkType && effectiveness(mv.type, D.MONSTERS[foe.id].types) === 0) ? 0.5 : (mv.status === 'slp' ? 50 : 40));
    if (mv.confuse) s2 = Math.max(s2, fv.cnf > 0 ? 0.5 : 30);
    if (mv.self && !mv.heal) {
      var maxed = Object.keys(mv.self).every(function (k) { return S.vol.stages[k] >= 2; });
      s2 = Math.max(s2, maxed ? 2 : ratio > 0.6 ? 36 : 8);
    }
    if (mv.foe) {
      var low = Object.keys(mv.foe).every(function (k) { return fv.stages[k] <= -2; });
      s2 = Math.max(s2, low ? 2 : 16);
    }
    return Math.max(0.5, s2);
  }
  function chooseEnemyAction(b, rng) {
    rng = rng || Math.random;
    var me = active(b, 'e');
    var slots = [];
    me.moves.forEach(function (m, i) { if (m.pp > 0) slots.push(i); });
    if (!slots.length) return { t: 'move', slot: -1 };
    if (b.kind === 'wild') return { t: 'move', slot: slots[Math.floor(rng() * slots.length)] };
    var w = slots.map(function (i) { var s = estimate(b, 'e', i); return s * s; });
    var sum = w.reduce(function (a, c) { return a + c; }, 0), r = rng() * sum;
    for (var k = 0; k < w.length; k++) { r -= w[k]; if (r <= 0) return { t: 'move', slot: slots[k] }; }
    return { t: 'move', slot: slots[slots.length - 1] };
  }

  /* ── 턴 해석 ──
     플레이어 행동: { t:'move', slot } | { t:'switch', to } | { t:'ball' } | { t:'run' }
     이벤트: msg | line | use | hit | miss | heal | stat | status | cure | flinch | screen | residual | faint
             | switchOut | switchIn | ball | run | exp | levelUp | learn | cutscene | needSwitch | end */
  function resolveTurn(b, pAct, eAct, rng) {
    rng = rng || Math.random;
    var ev = [];
    if (b.over || b.needSwitch) return ev;
    pAct = pAct || { t: 'move', slot: 0 };
    eAct = eAct || chooseEnemyAction(b, rng);

    // 행동 검증 — 할 수 없는 행동은 턴을 쓰지 않고 거절한다
    if (pAct.t === 'run' && b.kind !== 'wild') { ev.push({ t: 'msg', text: '승부 도중에 도망칠 수는 없다!' }); return ev; }
    if (pAct.t === 'ball' && b.kind !== 'wild') { ev.push({ t: 'msg', text: '남의 포캣몬은 잡을 수 없다!' }); return ev; }
    if (pAct.t === 'switch' && !canSwitchTo(b, pAct.to)) { ev.push({ t: 'msg', text: '그 포캣몬으로는 교체할 수 없다!' }); return ev; }
    if (pAct.t === 'move') {
      var pm = active(b, 'p');
      if (!hasUsableMove(pm)) pAct = { t: 'move', slot: -1 };
      else if (!pm.moves[pAct.slot] || pm.moves[pAct.slot].pp <= 0) { ev.push({ t: 'msg', text: '그 기술은 PP가 남아 있지 않다!' }); return ev; }
    }

    b.turn++;
    // 1) 이동·도구 행동은 기술보다 먼저
    if (pAct.t === 'run') {
      if (escapeRoll(b, rng)) {
        ev.push({ t: 'run', ok: true, text: '무사히 도망쳤다!' });
        b.over = true; b.result = 'ran'; b.winner = null;
        ev.push({ t: 'end', result: 'ran' });
        return ev;
      }
      ev.push({ t: 'run', ok: false, text: '도망칠 수 없었다!' });
    } else if (pAct.t === 'ball') {
      var wild = active(b, 'e'), roll = catchRoll(wild, rng);
      ev.push({ t: 'ball', shakes: roll.shakes, caught: roll.caught, text: '포캣볼을 던졌다!' });
      if (roll.caught) {
        ev.push({ t: 'msg', text: '신난다! ' + josa(monName(wild), '을/를') + ' 잡았다!' });
        b.over = true; b.result = 'caught'; b.winner = 'player'; b.caught = wild;
        ev.push({ t: 'end', result: 'caught' });
        return ev;
      }
      ev.push({ t: 'msg', text: ['안 돼! 포캣몬이 볼에서 나와 버렸다!', '아아! 잡았다고 생각했는데!', '아깝다! 조금만 더 하면 잡을 수 있었는데!', '으아! 거의 잡았었는데!'][roll.shakes] });
    } else if (pAct.t === 'switch') {
      doSwitch(b, 'p', pAct.to, ev);
    }

    // 2) 기술: 우선도 → 스피드 → 무작위
    var movers = [];
    if (pAct.t === 'move') movers.push({ who: 'p', slot: pAct.slot });
    if (eAct.t === 'move') movers.push({ who: 'e', slot: eAct.slot });
    function prio(m) { var mon = active(b, m.who); return m.slot < 0 ? 0 : (D.MOVES[mon.moves[m.slot].id].priority || 0); }
    if (movers.length === 2) {
      var a = movers[0], c = movers[1], pa = prio(a), pc = prio(c), sa = effSpeed(b[a.who]), sc = effSpeed(b[c.who]);
      if (pc > pa || (pc === pa && (sc > sa || (sc === sa && rng() < 0.5)))) movers = [c, a];
    }
    var acted = 0;
    movers.forEach(function (m) {
      if (!isAlive(active(b, 'p')) || !isAlive(active(b, 'e'))) return;
      useMove(b, m.who, m.slot, acted === 0 && movers.length === 2, ev, rng);
      acted++;
    });

    // 3) 턴 끝: 독·화상 → 보호막 시간 감소 (한쪽이 전멸했으면 승부가 이미 났으므로 건너뛴다)
    var decided = aliveCount(b.p.party) === 0 || aliveCount(b.e.party) === 0;
    ['p', 'e'].forEach(function (who) {
      var S = b[who], mon = S.party[S.active], sn = who === 'p' ? 'player' : 'enemy';
      if (decided || !isAlive(mon)) return;
      var mx = maxHp(mon), d = 0, label = '';
      if (mon.status === 'brn') { d = Math.floor(mx * T.burnFrac); label = ' 화상 데미지를 입었다!'; }
      else if (mon.status === 'psn') { d = Math.floor(mx * T.poisonFrac); label = ' 독 데미지를 입었다!'; }
      else if (mon.status === 'tox') { S.vol.toxN = Math.min(15, S.vol.toxN + 1); d = Math.floor(mx * T.toxicStep * S.vol.toxN); label = ' 독 데미지를 입었다!'; }
      if (label) {
        d = Math.min(mon.hp, Math.max(1, d));
        mon.hp -= d;
        hpEv(sn, mon, ev, { t: 'residual', kind: mon.status, dmg: d, text: josa(monName(mon), '은/는') + label });
        if (mon.hp <= 0) faintEv(b, sn, mon, ev);
      }
    });
    ['p', 'e'].forEach(function (who) {
      var S = b[who];
      S.vol.flinch = false;
      if (S.screen > 0 && !decided) {
        S.screen--;
        if (S.screen === 0) ev.push({ t: 'screen', side: who === 'p' ? 'player' : 'enemy', on: false, text: (who === 'p' ? '' : '상대 ') + monName(S.party[S.active]) + '의 보호막이 사라졌다.' });
      }
    });

    afterFaints(b, ev, rng);
    return ev;
  }

  // 쓰러짐 처리: 승패 → 상대 다음 몬스터 → 내 교체 요청 (경험치는 쓰러진 순간 faintEv가 준다)
  function afterFaints(b, ev) {
    var e = active(b, 'e'), p = active(b, 'p');
    var pLeft = aliveCount(b.p.party), eLeft = aliveCount(b.e.party);
    // 반동 등으로 양쪽 마지막 몬스터가 함께 쓰러지면 나중에 쓰러진 쪽(기술을 쓴 쪽)이 이긴다 (5세대 이후)
    if (pLeft === 0 && eLeft === 0) { if (b.lastFaint === 'player') pLeft = -1; else eLeft = -1; }
    if (pLeft === 0) {
      b.over = true; b.result = 'lose'; b.winner = 'enemy';
      if (b.trainer) ev.push({ t: 'line', side: 'enemy', trainer: true, text: '아직 멀었구나. 다시 도전해!' });
      ev.push({ t: 'msg', text: '눈앞이 캄캄해졌다…' });
      ev.push({ t: 'end', result: 'lose' });
      return;
    }
    if (eLeft <= 0) {
      b.over = true; b.result = 'win'; b.winner = 'player';
      if (b.trainer) {
        ev.push({ t: 'msg', text: josa(b.trainer.name, '과/와') + '의 승부에서 이겼다!' });
        ev.push({ t: 'line', side: 'enemy', trainer: true, text: b.trainer.lines.lose });
      }
      ev.push({ t: 'end', result: 'win' });
      return;
    }
    if (!isAlive(e)) {
      var next = firstAlive(b.e.party);
      if (b.final && !b.cutsceneDone && b.e.party[next].id === 'black') {
        b.cutsceneDone = true;
        ev.push({ t: 'cutscene', key: 'corrupt' });
      }
      doSwitch(b, 'e', next, ev, true);
      // 경험치는 새 상대와 마주한 몬스터부터 다시 센다
      b.participants = {};
      if (isAlive(p)) b.participants[p.uid] = true;
    }
    if (!isAlive(p)) {
      b.needSwitch = true;
      ev.push({ t: 'needSwitch', side: 'player' });
    }
  }

  // 내 몬스터가 쓰러진 뒤 다음 몬스터 고르기 (턴을 쓰지 않는다)
  function forceSwitch(b, idx) {
    var ev = [];
    if (!b.needSwitch || b.over) return ev;
    if (idx < 0 || idx >= b.p.party.length || !isAlive(b.p.party[idx])) return ev;
    b.needSwitch = false;
    doSwitch(b, 'p', idx, ev, true);
    return ev;
  }

  /* ── 게임 진행 (저장 데이터) ──
     save = { v:2, starter, party:[mon], box:[mon], dex:{seen:{}, caught:{}}, badges:[areaId], cleared, nextUid, area } */
  function newGame(starter, rng) {
    rng = rng || Math.random;
    if (D.STARTERS.indexOf(starter) < 0) throw new Error('unknown starter ' + starter);
    var mon = createMon(starter, T.startLevel, rng, { shiny: false, uid: 1 });
    var save = { v: 2, starter: starter, party: [mon], box: [], dex: { seen: {}, caught: {} }, badges: [], cleared: false, nextUid: 2, area: D.AREAS[0].id };
    save.dex.seen[starter] = 1; save.dex.caught[starter] = 1;
    return save;
  }
  function addCaught(save, mon) {
    mon.uid = save.nextUid++;
    save.dex.seen[mon.id] = 1; save.dex.caught[mon.id] = 1;
    if (save.party.length < T.partyMax) { save.party.push(mon); return 'party'; }
    save.box.push(mon); return 'box';
  }
  function markSeen(save, ids) { ids.forEach(function (id) { save.dex.seen[id] = 1; }); }
  function healParty(save) { save.party.forEach(healMon); }
  function canExplore(save) { return firstAlive(save.party) >= 0; }

  function areaIndex(id) { for (var i = 0; i < D.AREAS.length; i++) if (D.AREAS[i].id === id) return i; return -1; }
  function areaOpen(save, id) {
    var i = areaIndex(id), a = D.AREAS[i];
    if (i < 0) return false;
    if (a.post) return !!save.cleared;
    if (i === 0) return true;
    return save.badges.indexOf(D.AREAS[i - 1].id) >= 0;
  }
  function hasBadge(save, id) { return save.badges.indexOf(id) >= 0; }

  // 배틀이 끝난 뒤 저장 데이터에 반영한다. 반환: { badge, cleared, caughtTo, whiteout }
  function finishBattle(save, b) {
    var out = { badge: null, cleared: false, caughtTo: null, whiteout: false };
    markSeen(save, b.seen);
    if (b.result === 'caught' && b.caught) out.caughtTo = addCaught(save, b.caught);
    if (b.result === 'win' && b.kind === 'trainer' && b.areaId && !hasBadge(save, b.areaId)) {
      save.badges.push(b.areaId); out.badge = b.areaId;
      if (b.final) { save.cleared = true; out.cleared = true; }
    }
    if (b.result === 'lose') { healParty(save); out.whiteout = true; }
    return out;
  }

  // 파티 ↔ 보관함 정리
  function moveToBox(save, partyIdx) {
    if (save.party.length <= 1 || !save.party[partyIdx]) return false;
    save.box.push(save.party.splice(partyIdx, 1)[0]);
    return true;
  }
  function moveToParty(save, boxIdx) {
    if (save.party.length >= T.partyMax || !save.box[boxIdx]) return false;
    save.party.push(save.box.splice(boxIdx, 1)[0]);
    return true;
  }
  function swapPartyBox(save, partyIdx, boxIdx) {
    if (!save.party[partyIdx] || !save.box[boxIdx]) return false;
    var t = save.party[partyIdx]; save.party[partyIdx] = save.box[boxIdx]; save.box[boxIdx] = t;
    return true;
  }
  function makeLead(save, partyIdx) {
    if (!save.party[partyIdx] || partyIdx === 0) return false;
    var t = save.party[0]; save.party[0] = save.party[partyIdx]; save.party[partyIdx] = t;
    return true;
  }

  /* ── 저장 검증 ── */
  function isValidMon(m) {
    if (!m || typeof m !== 'object' || !D.MONSTERS[m.id]) return false;
    if (!Number.isInteger(m.lv) || m.lv < 1 || m.lv > 100 || !Number.isInteger(m.uid)) return false;
    if (!Number.isFinite(m.exp) || !m.iv || typeof m.iv !== 'object') return false;
    if (!STATS.every(function (k) { return Number.isInteger(m.iv[k]) && m.iv[k] >= 0 && m.iv[k] <= 31; })) return false;
    if (!Array.isArray(m.moves) || m.moves.length < 1 || m.moves.length > 4) return false;
    if (!m.moves.every(function (x) { return x && D.MOVES[x.id] && !D.MOVES[x.id].struggle && Number.isInteger(x.pp) && x.pp >= 0 && x.pp <= D.MOVES[x.id].pp; })) return false;
    if (m.status !== null && !D.STATUS[m.status]) return false;
    return Number.isInteger(m.hp) && m.hp >= 0 && m.hp <= maxHp(m);
  }
  function isValidSave(s) {
    if (!s || typeof s !== 'object' || s.v !== 2) return false;
    if (D.STARTERS.indexOf(s.starter) < 0) return false;
    if (!Array.isArray(s.party) || s.party.length < 1 || s.party.length > T.partyMax || !Array.isArray(s.box)) return false;
    if (!s.party.every(isValidMon) || !s.box.every(isValidMon)) return false;
    if (!s.dex || typeof s.dex.seen !== 'object' || typeof s.dex.caught !== 'object') return false;
    if (!Array.isArray(s.badges) || !s.badges.every(function (id) { return areaIndex(id) >= 0; })) return false;
    if (!Number.isInteger(s.nextUid)) return false;
    return areaIndex(s.area) >= 0;
  }

  /* ── 저장소 (어댑터 주입식, 실패 시 메모리 대체) ── */
  var KEY_SAVE = 'pocatmon.save', KEY_OLD_RUN = 'pocatmon.run';
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
      save: function (s) { set(KEY_SAVE, JSON.stringify(s)); del(KEY_OLD_RUN); },
      load: function () {
        var raw = get(KEY_SAVE);
        if (!raw) return null;
        try { var s = JSON.parse(raw); return isValidSave(s) ? s : null; } catch (e) { return null; }
      },
      clear: function () { del(KEY_SAVE); del(KEY_OLD_RUN); }
    };
  }

  return {
    josa: josa, effectiveness: effectiveness, stageMult: stageMult, accMult: accMult,
    calcStats: calcStats, maxHp: maxHp, expForLevel: expForLevel, movesAt: movesAt,
    createMon: createMon, healMon: healMon, isAlive: isAlive, firstAlive: firstAlive, aliveCount: aliveCount,
    monName: monName, hasUsableMove: hasUsableMove,
    makeBattle: makeBattle, createWildBattle: createWildBattle, createGymBattle: createGymBattle, beginBattle: beginBattle,
    active: active, calcDamage: calcDamage, effSpeed: effSpeed, catchRoll: catchRoll, escapeRoll: escapeRoll,
    gainExp: gainExp, expYield: expYield, chooseEnemyAction: chooseEnemyAction, estimate: estimate,
    resolveTurn: resolveTurn, forceSwitch: forceSwitch, canSwitchTo: canSwitchTo, statusImmune: statusImmune,
    newGame: newGame, addCaught: addCaught, markSeen: markSeen, healParty: healParty, canExplore: canExplore,
    areaById: areaById, areaIndex: areaIndex, areaOpen: areaOpen, hasBadge: hasBadge, finishBattle: finishBattle,
    moveToBox: moveToBox, moveToParty: moveToParty, swapPartyBox: swapPartyBox, makeLead: makeLead,
    isValidMon: isValidMon, isValidSave: isValidSave, createStore: createStore,
    KEYS: { save: KEY_SAVE, oldRun: KEY_OLD_RUN }
  };
});
