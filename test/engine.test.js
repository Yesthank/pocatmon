'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../js/data.js');
const E = require('../js/engine.js');

// 결정적 난수
function seq(values, rest = 0.5) { let i = 0; return () => (i < values.length ? values[i++] : rest); }
function constant(v) { return () => v; }
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

let uid = 1;
function mon(id, lv = 20, opt = {}) { return E.createMon(id, lv, constant(0.5), Object.assign({ iv: 31, shiny: false, uid: uid++ }, opt)); }
function wild(p, e) { return E.makeBattle('wild', Array.isArray(p) ? p : [p], Array.isArray(e) ? e : [e]); }
function slotOf(m, id) { return m.moves.findIndex((x) => x.id === id); }
function teach(m, ids) { m.moves = ids.map((id) => ({ id, pp: D.MOVES[id].pp })); return m; }
const types = (ev) => ev.map((x) => x.t);

/* ── 데이터 무결성 ── */
test('데이터: 18타입 상성표와 몬스터·기술 참조가 모두 유효하다', () => {
  const T = Object.keys(D.TYPES);
  assert.equal(T.length, 18);
  for (const a of Object.keys(D.CHART)) {
    assert.ok(T.includes(a), a);
    for (const d of Object.keys(D.CHART[a])) assert.ok(T.includes(d), a + '→' + d);
  }
  const catTypes = new Set();
  for (const [id, m] of Object.entries(D.MONSTERS)) {
    m.types.forEach((t) => assert.ok(T.includes(t), id));
    if (m.cat) m.types.forEach((t) => catTypes.add(t));
    assert.ok(m.learn.length >= 1 && m.learn.length <= 4, id);
    m.learn.forEach(([mv]) => assert.ok(D.MOVES[mv], id + ':' + mv));
    for (const k of ['hp', 'atk', 'def', 'spa', 'spd', 'spe']) assert.ok(m.base[k] > 0, id + k);
    assert.ok(D.DEX.includes(id), 'dex ' + id);
  }
  // 모든 타입에 고양이가 한 마리 이상 있다
  for (const t of T) assert.ok(catTypes.has(t), '고양이 없는 타입: ' + t);
  // 트레이너 팀·도구·상점·진화 참조
  for (const [tid, t] of Object.entries(D.TRAINERS)) {
    t.team.forEach(([id, lv]) => { assert.ok(D.MONSTERS[E.resolveSpecies(id, { starter: 'seol' })], tid + ':' + id); assert.ok(lv >= 1 && lv <= 60, tid); });
    assert.ok(t.lines && t.lines.intro && t.lines.lose, tid);
  }
  D.SHOP.forEach((tier) => tier.items.forEach((id) => assert.ok(D.ITEMS[id] && D.ITEMS[id].price > 0, id)));
  for (const [id, m] of Object.entries(D.MONSTERS)) if (m.evolve) { assert.ok(D.MONSTERS[m.evolve.to], id); assert.equal(D.MONSTERS[m.evolve.to].from, id); }
  assert.equal(D.DEX.length, Object.keys(D.MONSTERS).length);
  for (const a of D.AREAS) {
    (a.wild || []).forEach(([id]) => assert.ok(D.MONSTERS[id], a.id));
    if (a.gym) {
      assert.ok(D.TRAINERS[a.gym.trainer], a.id);
      D.TRAINERS[a.gym.trainer].team.forEach(([id]) => assert.ok(D.MONSTERS[E.resolveSpecies(id, { starter: 'naru' })], a.id));
    }
  }
});

test('상성: 6세대 표 주요 칸, 무효, 이중 타입 곱', () => {
  assert.equal(E.effectiveness('fire', ['grass']), 2);
  assert.equal(E.effectiveness('water', ['fire']), 2);
  assert.equal(E.effectiveness('electric', ['ground']), 0);
  assert.equal(E.effectiveness('normal', ['ghost']), 0);
  assert.equal(E.effectiveness('ghost', ['normal']), 0);
  assert.equal(E.effectiveness('ground', ['flying']), 0);
  assert.equal(E.effectiveness('psychic', ['dark']), 0);
  assert.equal(E.effectiveness('dragon', ['fairy']), 0);
  assert.equal(E.effectiveness('poison', ['steel']), 0);
  assert.equal(E.effectiveness('fighting', ['ghost']), 0);
  assert.equal(E.effectiveness('ghost', ['psychic']), 2); // 1세대 버그가 아닌 현재 값
  assert.equal(E.effectiveness('steel', ['fairy']), 2);
  assert.equal(E.effectiveness('fighting', ['dark', 'normal']), 4);
  assert.equal(E.effectiveness('fighting', ['dark', 'steel']), 4);
  assert.equal(E.effectiveness('fire', ['dark', 'steel']), 2);
  assert.equal(E.effectiveness('ghost', ['dark', 'normal']), 0);
  assert.equal(E.effectiveness('none', ['ghost']), 1);
});

/* ── 능력치·데미지 ── */
test('능력치 공식: 3세대 이후 (개체값 31, 노력치 없음)', () => {
  const m = mon('metal', 50); // hp 100, atk 95
  const s = E.calcStats(m);
  assert.equal(s.hp, Math.floor((200 + 31) * 50 / 100) + 50 + 10); // 175
  assert.equal(s.atk, Math.floor((190 + 31) * 50 / 100) + 5); // 115
  assert.equal(E.expForLevel(10), 1000);
});

test('데미지 공식: 5세대 이후 순서대로 내림 (자속·상성·난수)', () => {
  const a = mon('flare', 30), d = mon('leaf', 30);
  const b = wild(a, d);
  const mv = D.MOVES.flamethrower;
  const as = E.calcStats(a), ds = E.calcStats(d);
  let base = Math.floor(Math.floor(Math.floor(2 * 30 / 5 + 2) * 90 * as.spa / ds.spd) / 50) + 2;
  base = Math.floor(base * 100 / 100);
  base = Math.floor(base * 1.5);
  base = Math.floor(base * 2);
  const r = E.calcDamage(a, b.p, d, b.e, mv, constant(0.5), { noCrit: true, roll: 100 });
  assert.equal(r.dmg, base);
  assert.equal(r.eff, 2);
});

test('물리/특수 분리: 물리는 공격·방어, 특수는 특수공격·특수방어를 쓴다', () => {
  const a = mon('cheese', 30), d = mon('rock', 30); // 바위냥: 방어 110, 특방 60
  const b = wild(a, d);
  const phys = Object.assign({}, D.MOVES.tackle, { type: 'none' });
  const spec = Object.assign({}, phys, { cat: 'spec' });
  const p = E.calcDamage(a, b.p, d, b.e, phys, constant(0.5), { noCrit: true, roll: 100 }).dmg;
  const s = E.calcDamage(a, b.p, d, b.e, spec, constant(0.5), { noCrit: true, roll: 100 }).dmg;
  assert.ok(p !== s);
});

test('화상은 물리 데미지 절반, 보호막은 절반, 급소는 보호막과 내 능력 하락을 무시', () => {
  const a = mon('punch', 30), d = mon('cheese', 30);
  const b = wild(a, d);
  const mv = D.MOVES.brickbreak;
  const opt = { noCrit: true, roll: 100 };
  const n = E.calcDamage(a, b.p, d, b.e, mv, constant(0.5), opt).dmg;
  a.status = 'brn';
  assert.equal(E.calcDamage(a, b.p, d, b.e, mv, constant(0.5), opt).dmg, Math.floor(n / 2));
  a.status = null;
  b.e.screen = 3;
  assert.equal(E.calcDamage(a, b.p, d, b.e, mv, constant(0.5), opt).dmg, Math.floor(n * 0.5));
  b.p.vol.stages.atk = -2;
  const crit = E.calcDamage(a, b.p, d, b.e, mv, constant(0), { roll: 100 }); // rng 0 → 급소
  assert.ok(crit.crit);
  b.p.vol.stages.atk = 0; b.e.screen = 0;
  assert.equal(crit.dmg, E.calcDamage(a, b.p, d, b.e, mv, constant(0), { roll: 100 }).dmg);
  assert.ok(crit.dmg > n);
});

test('랭크 배율: ±6 한계, 명중·회피는 3단 공식', () => {
  assert.equal(E.stageMult(6), 4);
  assert.equal(E.stageMult(-6), 0.25);
  assert.equal(E.stageMult(1), 1.5);
  assert.equal(E.accMult(-1), 0.75);
  assert.equal(E.accMult(3), 2);
  const a = teach(mon('punch'), ['bulkup']), d = mon('cheese');
  const b = wild(a, d);
  b.p.vol.stages.atk = 6;
  const ev = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: slotOf(d, 'tackle') }, constant(0.5));
  assert.equal(b.p.vol.stages.atk, 6);
  assert.ok(ev.some((x) => x.t === 'msg' && /더 이상 오르지 않는다/.test(x.text)));
  assert.equal(b.p.vol.stages.def, 1);
});

/* ── 행동 순서 ── */
test('행동 순서: 우선도 > 스피드(마비는 절반) > 무작위', () => {
  const fast = teach(mon('zap'), ['thundershock']), slow = teach(mon('rock'), ['rockthrow', 'machpunch']);
  slow.moves[1] = { id: 'machpunch', pp: 30 };
  let b = wild(fast, slow);
  let ev = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.5));
  assert.equal(ev.find((x) => x.t === 'use').side, 'player');
  fast.hp = E.maxHp(fast); slow.hp = E.maxHp(slow);
  b = wild(fast, slow);
  ev = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 1 }, constant(0.5)); // 마하펀치 선공
  assert.equal(ev.find((x) => x.t === 'use').side, 'enemy');
  const s1 = E.effSpeed(b.p);
  fast.status = 'par';
  assert.equal(E.effSpeed(b.p), s1 * 0.5);
});

/* ── 상태이상 ── */
test('잠듦: 정해진 턴 수만큼 못 움직이고 깨어난 턴에는 행동한다', () => {
  const a = teach(mon('leaf'), ['sleeppowder']), d = teach(mon('cheese'), ['tackle']);
  const b = wild(a, d);
  // 수면가루 명중(0.1) → 잠듦 턴 수 randInt(1,3) with 0.5 → 2
  const ev = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, seq([0.9, 0.9, 0.9, 0.1, 0.5], 0.9));
  assert.ok(ev.some((x) => x.t === 'status' && x.kind === 'slp' && !x.tick));
  assert.equal(d.status, 'slp');
  assert.equal(d.slp, 2);
  let ev2 = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.9));
  assert.ok(ev2.some((x) => x.t === 'status' && x.kind === 'slp' && x.tick));
  ev2 = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.9));
  ev2 = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.9));
  assert.ok(ev2.some((x) => x.t === 'cure' && x.kind === 'slp'));
  assert.ok(ev2.some((x) => x.t === 'use' && x.side === 'enemy'));
});

test('상태이상 면역: 불꽃-화상, 전기-마비, 독·강철-독, 얼음-얼음, 풀-가루, 땅-전기자석파', () => {
  assert.ok(E.statusImmune(mon('flare'), 'brn'));
  assert.ok(E.statusImmune(mon('zap'), 'par'));
  assert.ok(E.statusImmune(mon('venom'), 'tox'));
  assert.ok(E.statusImmune(mon('iron'), 'psn'));
  assert.ok(E.statusImmune(mon('seol'), 'frz'));
  assert.ok(!E.statusImmune(mon('cheese'), 'brn'));
  const g = teach(mon('leaf'), ['sleeppowder']), g2 = teach(mon('leaf'), ['vinewhip']);
  let b = wild(g, g2);
  let ev = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.01));
  assert.equal(g2.status, null);
  assert.ok(ev.some((x) => /효과가 없는/.test(x.text || '')));
  const z = teach(mon('zap'), ['thunderwave']), s = teach(mon('sand'), ['sandattack']);
  b = wild(z, s);
  ev = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.01));
  assert.equal(s.status, null);
});

test('마비: 25% 확률로 행동 불가', () => {
  const a = teach(mon('cheese'), ['tackle']), d = teach(mon('rock'), ['rockpolish']);
  a.status = 'par';
  const b = wild(a, d);
  const ev = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.1));
  assert.ok(ev.some((x) => x.t === 'status' && x.kind === 'par' && x.tick));
  assert.ok(!ev.some((x) => x.t === 'use' && x.side === 'player'));
});

test('얼음: 20% 확률로 녹고, 불꽃 기술에 맞으면 녹는다', () => {
  const a = teach(mon('flare'), ['ember']), d = teach(mon('cheese', 20), ['tackle']);
  d.status = 'frz';
  const b = wild(a, d);
  // 상대가 먼저? 화르냥이 더 빠름 → 불꽃세례 명중 후 녹음
  const ev = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.95));
  assert.ok(ev.some((x) => x.t === 'cure' && x.kind === 'frz'));
  assert.equal(d.status, null);
});

test('맹독: 턴마다 1/16씩 커지고, 화상은 1/16, 독은 1/8', () => {
  const a = teach(mon('rock', 30), ['rockpolish']), d = teach(mon('cheese', 30), ['catnap']);
  d.status = 'tox';
  const b = wild(a, d);
  const mx = E.maxHp(d);
  const r1 = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.9)).find((x) => x.t === 'residual');
  const r2 = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.9)).find((x) => x.t === 'residual');
  assert.equal(r1.dmg, Math.floor(mx / 16));
  assert.equal(r2.dmg, Math.floor(mx * 2 / 16));
});

test('혼란: 1/3 확률로 자신을 공격, 정해진 턴 뒤에 풀린다', () => {
  const a = teach(mon('cheese'), ['tackle']), d = teach(mon('rock'), ['rockpolish']);
  const b = wild(a, d);
  b.p.vol.cnf = 3;
  const ev = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.1));
  assert.ok(ev.some((x) => x.t === 'hit' && x.selfHit && x.side === 'player'));
  assert.equal(b.p.vol.cnf, 2);
});

test('풀죽음은 먼저 행동해서 맞혔을 때만 걸린다', () => {
  const fast = teach(mon('iron', 30), ['ironhead']), slow = teach(mon('rock', 30), ['rockthrow']);
  fast.lv = 30; slow.lv = 30;
  // 철갑냥(55) vs 바위냥(50): 철갑냥이 먼저 → 풀죽음 가능
  let b = wild(fast, slow);
  let ev = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.05));
  assert.ok(ev.some((x) => x.t === 'flinch' && x.side === 'enemy'));
  // 늦게 행동한 쪽의 풀죽음은 무효
  const b2 = wild(teach(mon('rock', 30), ['rockslide']), teach(mon('zap', 30), ['thundershock']));
  ev = E.resolveTurn(b2, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.05));
  assert.ok(!ev.some((x) => x.t === 'flinch'));
});

/* ── 기술 효과 ── */
test('회복은 최대 HP를 넘지 않고, 흡수·반동이 적용된다', () => {
  const a = teach(mon('naru'), ['bubbleheal']), d = teach(mon('rock'), ['rockpolish']);
  const b = wild(a, d);
  const mx = E.maxHp(a);
  a.hp = mx - 3;
  const ev = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.9));
  assert.equal(a.hp, mx);
  assert.equal(ev.find((x) => x.t === 'heal').amount, 3);

  const l = teach(mon('leaf'), ['gigadrain']), c = teach(mon('naru'), ['bubbleheal']);
  l.hp = 10;
  const b2 = wild(l, c);
  const ev2 = E.resolveTurn(b2, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.9));
  const hit = ev2.find((x) => x.t === 'hit' && x.side === 'enemy');
  assert.equal(ev2.find((x) => x.t === 'heal' && x.side === 'player').amount, Math.floor(hit.dmg / 2));

  const w = teach(mon('wing'), ['bravebird']), t = teach(mon('cheese'), ['catnap']);
  const b3 = wild(w, t);
  const ev3 = E.resolveTurn(b3, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.9));
  const dealt = ev3.find((x) => x.t === 'hit' && x.side === 'enemy').dmg;
  assert.equal(ev3.find((x) => x.t === 'hit' && x.recoil).dmg, Math.floor(dealt / 3));
});

test('보호막: 5턴 동안 피해 절반, 깨트리기로 깨진다', () => {
  const s = teach(mon('seol'), ['iceshield']), p = teach(mon('punch'), ['brickbreak']);
  const b = wild(s, p);
  E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.9));
  // 주먹냥이 먼저(85>80) 깨트리기 → 아직 보호막 없음 → 설냥이 보호막
  assert.equal(b.p.screen, D.TUNING.screenTurns - 1);
  const ev = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.9));
  assert.ok(ev.some((x) => x.t === 'screen' && x.on === false && x.side === 'player'));
});

test('다단 기술: 2~5회 분포, 명중 판정은 한 번', () => {
  const m = teach(mon('metal', 40), ['speedattack']), d = teach(mon('rock', 60), ['rockpolish']);
  const b = wild(m, d);
  const ev = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, seq([0.5, 0.95], 0.9)); // 0.95 → 5회
  assert.equal(ev.filter((x) => x.t === 'hit' && x.side === 'enemy').length, 5);
});

test('PP: 쓰면 줄고, 0이면 그 기술을 고를 수 없고, 모두 0이면 발버둥', () => {
  const a = teach(mon('cheese'), ['tackle', 'catnap']), d = teach(mon('rock'), ['rockpolish']);
  const b = wild(a, d);
  E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.9));
  assert.equal(a.moves[0].pp, D.MOVES.tackle.pp - 1);
  a.moves[0].pp = 0;
  const rej = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.9));
  assert.equal(b.turn, 1);
  assert.ok(/PP/.test(rej[0].text));
  a.moves[1].pp = 0;
  const ev = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.9));
  assert.ok(ev.some((x) => x.t === 'use' && x.move === 'struggle'));
  assert.ok(ev.some((x) => x.t === 'hit' && x.recoil));
});

test('명중: 실패하면 빗나가고, 명중률 하락이 반영된다', () => {
  const a = teach(mon('naru'), ['hydropump']), d = teach(mon('rock'), ['rockpolish']);
  const b = wild(a, d);
  let ev = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.85)); // 85 >= 80
  assert.ok(ev.some((x) => x.t === 'miss'));
  b.p.vol.stages.acc = 1; // 80 × 4/3 = 106 → 반드시 맞음
  ev = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.99));
  assert.ok(!ev.some((x) => x.t === 'miss'));
});

/* ── 교체 ── */
test('교체: 기술보다 먼저 일어나고, 상대 공격은 새 몬스터가 받으며, 랭크는 초기화된다', () => {
  const a = teach(mon('cheese'), ['tackle']), c = teach(mon('rock'), ['rockpolish']);
  const d = teach(mon('punch'), ['brickbreak']);
  const b = wild([a, c], d);
  b.p.vol.stages.atk = 2;
  const ev = E.resolveTurn(b, { t: 'switch', to: 1 }, { t: 'move', slot: 0 }, constant(0.9));
  assert.deepEqual(types(ev).slice(0, 3), ['switchOut', 'switchIn', 'use']);
  assert.equal(b.p.active, 1);
  assert.equal(b.p.vol.stages.atk, 0);
  assert.ok(c.hp < E.maxHp(c));
  assert.equal(a.hp, E.maxHp(a));
  // 쓰러진 몬스터·자기 자신으로는 교체 불가
  assert.ok(!E.canSwitchTo(b, 1));
  a.hp = 0;
  assert.ok(!E.canSwitchTo(b, 0));
});

test('내 몬스터가 쓰러지면 교체 요청 → forceSwitch는 턴을 쓰지 않는다', () => {
  const a = teach(mon('cheese', 10), ['tackle']), c = teach(mon('rock', 30), ['rockthrow']);
  const d = teach(mon('punch', 40), ['closecombat']);
  const b = wild([a, c], d);
  const ev = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.9));
  assert.ok(ev.some((x) => x.t === 'faint' && x.side === 'player'));
  assert.equal(ev[ev.length - 1].t, 'needSwitch');
  assert.ok(b.needSwitch && !b.over);
  assert.deepEqual(E.resolveTurn(b, { t: 'move', slot: 0 }, null, constant(0.9)), []);
  const ev2 = E.forceSwitch(b, 1);
  assert.equal(ev2[0].t, 'switchIn');
  assert.equal(b.p.active, 1);
  assert.equal(b.turn, 1);
});

test('트레이너: 다음 몬스터를 내보내고, 경험치는 쓰러뜨릴 때 받는다 (트레이너 ×1.5)', () => {
  const a = teach(mon('punch', 40), ['closecombat']);
  const team = [teach(mon('cheese', 5), ['tackle']), teach(mon('cheese', 5), ['tackle'])];
  const b = E.makeBattle('trainer', [a], team, { trainer: E.trainerInfo('gym_forest'), areaId: 'forest' });
  const exp0 = a.exp;
  const ev = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.9));
  const order = types(ev);
  assert.ok(order.indexOf('faint') < order.indexOf('exp'));
  assert.ok(order.indexOf('exp') < order.lastIndexOf('switchIn'));
  assert.equal(b.e.active, 1);
  const gain = Math.floor(D.MONSTERS.cheese.xp * 5 / 7 * 1.5 * D.TUNING.expMult);
  assert.equal(a.exp - exp0, gain);
  assert.equal(E.resolveTurn(b, { t: 'run' }, null, constant(0.9))[0].t, 'msg'); // 도망 불가
  assert.equal(E.resolveTurn(b, { t: 'ball' }, null, constant(0.9))[0].t, 'msg'); // 포획 불가
});

test('최종전: 메탈가디언몬이 쓰러지면 흑화 컷신 뒤 블랙이 나온다', () => {
  const a = teach(mon('punch', 60), ['closecombat']);
  const b = E.createGymBattle({ party: [a] }, 'summit', constant(0.5));
  b.e.party[0].hp = 1;
  const ev = E.resolveTurn(b, { t: 'move', slot: 0 }, null, constant(0.9));
  const i = types(ev).indexOf('cutscene');
  assert.ok(i >= 0);
  assert.equal(ev[i + 1].t, 'switchIn');
  assert.equal(ev[i + 1].id, 'black');
});

/* ── 포획·도망 ── */
test('포획: a ≥ 255면 확정, 체력이 낮고 상태이상이면 더 잘 잡힌다', () => {
  const easy = mon('cheese', 5); easy.hp = 1; easy.status = 'par';
  assert.ok(E.catchRoll(easy, constant(0.99), 1.5).caught);
  // 볼이 좋을수록 a가 크다
  const mid = mon('cheese', 20); mid.hp = Math.floor(E.maxHp(mid) / 2);
  assert.ok(E.catchRoll(mid, constant(0.5), 2).a > E.catchRoll(mid, constant(0.5), 1).a);
  const hard = mon('black', 45);
  const full = E.catchRoll(hard, constant(0.5));
  assert.ok(!full.caught);
  hard.hp = 1; hard.status = 'slp';
  const weak = E.catchRoll(hard, constant(0.5));
  assert.ok(weak.a > full.a);
});

test('포획 행동: 잡으면 배틀이 끝나고 파티(3마리 넘으면 보관함)에 들어간다', () => {
  const save = E.newGame('naru', constant(0.5));
  const target = mon('cheese', 5); target.hp = 1;
  const b = E.makeBattle('wild', save.party, [target]);
  const ev = E.resolveTurn(b, { t: 'ball' }, null, constant(0.1));
  assert.ok(ev.some((x) => x.t === 'ball' && x.caught));
  assert.equal(b.result, 'caught');
  const out = E.finishBattle(save, b);
  assert.equal(out.caughtTo, 'party');
  assert.equal(save.party.length, 2);
  assert.ok(save.dex.caught.cheese);
  E.addCaught(save, mon('leaf', 5));
  assert.equal(E.addCaught(save, mon('moth', 5)), 'box');
  assert.equal(save.party.length, D.TUNING.partyMax);
});

test('도망: 더 빠르면 성공, 느리면 시도할수록 쉬워진다', () => {
  const fast = teach(mon('zap'), ['thundershock']), slow = teach(mon('rock'), ['rockpolish']);
  let b = wild(fast, slow);
  let ev = E.resolveTurn(b, { t: 'run' }, null, constant(0.99));
  assert.equal(b.result, 'ran');
  b = wild(teach(mon('rock'), ['rockpolish']), teach(mon('zap'), ['thundershock']));
  ev = E.resolveTurn(b, { t: 'run' }, { t: 'move', slot: 0 }, constant(0.99));
  assert.ok(ev.some((x) => x.t === 'run' && !x.ok));
  assert.ok(!b.over);
});

/* ── 성장 ── */
test('경험치: 레벨업하면 최대 HP 증가분만큼 HP가 늘고, 정해진 레벨에서 기술을 배운다', () => {
  const m = E.createMon('naru', 7, constant(0.5), { iv: 31, uid: 99 });
  assert.deepEqual(m.moves.map((x) => x.id), ['watergun', 'splash']);
  const before = E.maxHp(m), hp0 = m.hp - 5;
  m.hp = hp0;
  const ev = [];
  E.gainExp(m, E.expForLevel(8) - m.exp, ev);
  assert.equal(m.lv, 8);
  assert.equal(m.hp, hp0 + E.maxHp(m) - before);
  assert.ok(ev.some((x) => x.t === 'learn' && x.move === 'bubbleheal'));
  assert.equal(m.moves.length, 3);
});

test('야생 배틀: 같이 싸운 몬스터는 경험치 전부, 대기한 몬스터는 절반', () => {
  const a = teach(mon('punch', 30), ['closecombat']), c = mon('rock', 30);
  const b = wild([a, c], teach(mon('cheese', 10), ['tackle']));
  const ea = a.exp, ec = c.exp;
  E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.9));
  assert.equal(b.result, 'win');
  const full = Math.floor(D.MONSTERS.cheese.xp * 10 / 7 * D.TUNING.expMult);
  assert.equal(a.exp - ea, full);
  assert.equal(c.exp - ec, Math.floor(full * D.TUNING.expShare));
});

/* ── 진행·저장 ── */
test('진행: 지역은 앞 지역 배지로 열리고, 최종전 승리로 클리어·폐허가 열린다. 전멸하면 회복된다', () => {
  const save = E.newGame('seol', constant(0.5));
  assert.ok(E.areaOpen(save, 'forest'));
  assert.ok(!E.areaOpen(save, 'coast'));
  assert.ok(!E.areaOpen(save, 'ruins'));
  const b = E.createGymBattle(save, 'forest', constant(0.5));
  b.over = true; b.result = 'win';
  assert.equal(E.finishBattle(save, b).badge, 'forest');
  assert.ok(E.areaOpen(save, 'coast'));
  const f = E.createGymBattle(save, 'summit', constant(0.5));
  f.over = true; f.result = 'win';
  assert.ok(E.finishBattle(save, f).cleared);
  assert.ok(E.areaOpen(save, 'ruins'));
  save.party[0].hp = 0;
  const l = E.createWildBattle(Object.assign({}, save, { party: [mon('cheese')] }), 'forest', constant(0.5));
  l.over = true; l.result = 'lose';
  assert.ok(E.finishBattle(save, l).whiteout);
  assert.equal(save.party[0].hp, E.maxHp(save.party[0]));
});

test('파티·보관함: 파티는 1~3마리, 맞바꾸기·선두 바꾸기', () => {
  const save = E.newGame('ssaga', constant(0.5));
  assert.ok(!E.moveToBox(save, 0)); // 마지막 한 마리는 못 맡긴다
  E.addCaught(save, mon('cheese')); E.addCaught(save, mon('leaf')); E.addCaught(save, mon('moth'));
  assert.equal(save.box.length, 1);
  assert.ok(!E.moveToParty(save, 0));
  assert.ok(E.swapPartyBox(save, 1, 0));
  assert.equal(save.party[1].id, 'moth');
  assert.ok(E.makeLead(save, 2));
  assert.equal(save.party[0].id, 'leaf');
  assert.ok(E.moveToBox(save, 0));
  assert.ok(E.moveToParty(save, 0));
});

test('저장: 저장·불러오기·검증 실패 무시·쓰기 실패 저장소', () => {
  const mem = {};
  const ls = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  const st = E.createStore(ls);
  assert.equal(st.load(), null);
  const save = E.newGame('naru', mulberry32(3));
  E.addCaught(save, mon('cheese'));
  st.save(save);
  assert.deepEqual(E.createStore(ls).load(), JSON.parse(JSON.stringify(save)));
  mem['pocatmon.save'] = '{"v":1}';
  assert.equal(E.createStore(ls).load(), null);
  mem['pocatmon.save'] = 'not json';
  assert.equal(E.createStore(ls).load(), null);
  const bad = JSON.parse(JSON.stringify(save)); bad.party[0].moves[0].id = 'nope';
  assert.ok(!E.isValidSave(bad));
  // 쓰기만 실패하는 저장소: 이번 방문 값이 우선
  const ro = { getItem: () => JSON.stringify(save), setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('ro'); } };
  const s2 = E.createStore(ro);
  s2.clear();
  assert.equal(s2.load(), null);
  // 저장소가 없어도 오류 없음
  const s3 = E.createStore(null);
  s3.save(save);
  assert.ok(s3.load());
});

test('마지막 상대를 쓰러뜨린 턴에는 독·화상 데미지가 없다 (이긴 배틀이 패배로 바뀌지 않음)', () => {
  const a = teach(mon('punch', 60), ['closecombat']);
  a.status = 'psn'; a.hp = 1;
  const b = wild(a, teach(mon('cheese', 5), ['tackle']));
  const ev = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.9));
  assert.ok(!ev.some((x) => x.t === 'residual'));
  assert.equal(b.result, 'win');
  assert.equal(a.hp, 1);
  // 관장전 마지막 몬스터도 같다 — 배지를 받는다
  const save = E.newGame('naru', constant(0.5));
  save.party = [teach(mon('punch', 60), ['closecombat'])];
  save.party[0].status = 'brn'; save.party[0].hp = 1;
  const g = E.createGymBattle(save, 'forest', constant(0.5));
  g.e.party.forEach((m, i) => { if (i < 2) m.hp = 0; });
  g.e.active = 2; g.e.party[2].hp = 1;
  E.resolveTurn(g, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.9));
  assert.equal(g.result, 'win');
  assert.equal(E.finishBattle(save, g).badge, 'forest');
});

test('반동으로 양쪽 마지막 몬스터가 함께 쓰러지면 기술을 쓴 쪽(나중에 쓰러진 쪽)이 이긴다', () => {
  const a = teach(mon('wing', 50), ['bravebird']);
  a.hp = 1;
  const b = wild(a, teach(mon('cheese', 5), ['tackle']));
  const ev = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.9));
  assert.equal(ev.filter((x) => x.t === 'faint').length, 2);
  assert.equal(b.result, 'win');
});

test('경험치는 쓰러뜨린 순간에 준다 — 그 뒤 독으로 쓰러져도 받는다', () => {
  const a = teach(mon('punch', 30), ['closecombat']), c = mon('rock', 30);
  a.status = 'psn'; a.hp = 1;
  const team = [teach(mon('cheese', 10), ['tackle']), teach(mon('cheese', 10), ['tackle'])];
  const b = E.makeBattle('trainer', [a, c], team, { trainer: E.trainerInfo('gym_forest'), areaId: 'forest' });
  const e0 = a.exp;
  const ev = E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.9));
  assert.ok(ev.some((x) => x.t === 'residual' && x.side === 'player'));
  assert.ok(a.exp > e0, 'attacker got exp before fainting to poison');
  assert.ok(b.needSwitch);
});

test('끝난 배틀은 더 진행되지 않는다', () => {
  const a = teach(mon('punch', 60), ['closecombat']), d = teach(mon('cheese', 3), ['tackle']);
  const b = wild(a, d);
  E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.9));
  assert.ok(b.over);
  assert.deepEqual(E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.9)), []);
});

test('난수 시드 고정 시 같은 결과 (긴 배틀 무작위 검사: 예외 없음, HP 범위 유지, end는 마지막)', () => {
  const rng = mulberry32(7);
  for (let n = 0; n < 300; n++) {
    const ids = D.DEX;
    const pick = () => ids[Math.floor(rng() * ids.length)];
    const p = [mon(pick(), 25), mon(pick(), 25), mon(pick(), 25)];
    const e = [mon(pick(), 25), mon(pick(), 25)];
    const b = E.makeBattle(rng() < 0.5 ? 'wild' : 'trainer', p, rng() < 0.5 ? e.slice(0, 1) : e, { trainer: E.trainerInfo('gym_coast') });
    for (let t = 0; t < 200 && !b.over; t++) {
      if (b.needSwitch) { E.forceSwitch(b, E.firstAlive(b.p.party)); continue; }
      const me = E.active(b, 'p');
      const slots = me.moves.map((m, i) => (m.pp > 0 ? i : -1)).filter((i) => i >= 0);
      const act = slots.length ? { t: 'move', slot: slots[Math.floor(rng() * slots.length)] } : { t: 'move', slot: 0 };
      const ev = E.resolveTurn(b, act, null, rng);
      for (const x of ev) if (x.hp != null) assert.ok(x.hp >= 0 && x.hp <= x.maxHp, JSON.stringify(x));
      if (b.over) assert.equal(ev[ev.length - 1].t, 'end');
    }
    assert.ok(b.over, 'battle did not finish');
  }
});

/* ── v3: 도구·상점·진화·트레이너·저장 이전 ── */
test('가방: 배틀 중 회복 도구는 턴을 쓰고 개수가 준다. 대상이 맞지 않으면 턴을 쓰지 않는다', () => {
  const save = E.newGame('naru', constant(0.5));
  const me = save.party[0]; me.hp = 3;
  const b = E.createWildBattle(save, 'forest', constant(0.5));
  const n0 = save.bag.snack;
  const ev = E.resolveTurn(b, { t: 'item', item: 'snack', target: 0 }, { t: 'move', slot: 0 }, constant(0.9));
  assert.equal(save.bag.snack, n0 - 1);
  assert.ok(ev.some((x) => x.t === 'heal' && x.side === 'player'));
  assert.equal(b.turn, 1);
  const rej = E.resolveTurn(b, { t: 'item', item: 'matatabi', target: 0 }, null, constant(0.9));
  assert.equal(b.turn, 1);
  assert.ok(/없다/.test(rej[0].text));
});

test('볼: 가방에서 줄고, 볼이 없으면 던질 수 없다', () => {
  const save = E.newGame('seol', constant(0.5));
  save.bag = { ball: 1 };
  const b = E.createWildBattle(save, 'forest', constant(0.5));
  E.resolveTurn(b, { t: 'ball', item: 'ball' }, { t: 'move', slot: 0 }, constant(0.999));
  assert.equal(save.bag.ball, undefined);
  if (!b.over) assert.ok(/없다/.test(E.resolveTurn(b, { t: 'ball', item: 'ball' }, null, constant(0.5))[0].text));
});

test('배틀 밖 도구: 회복·기절 회복·성장 사탕·스프레이', () => {
  const save = E.newGame('ssaga', constant(0.5));
  const m = save.party[0];
  save.bag = { tuna: 1, matatabi: 1, candy: 1, repel: 1 };
  m.hp = 0;
  assert.ok(!E.useItem(save, 'tuna', 0).ok);
  assert.ok(E.useItem(save, 'matatabi', 0).ok);
  assert.equal(m.hp, Math.floor(E.maxHp(m) / 2));
  const lv = m.lv;
  assert.ok(E.useItem(save, 'candy', 0).ok);
  assert.equal(m.lv, lv + 1);
  assert.ok(E.useItem(save, 'repel').ok);
  assert.equal(save.repel, 100);
  assert.deepEqual(save.bag, { tuna: 1 }); // 기절한 몬스터에게 쓰려던 참치는 남는다
});

test('상점: 배지 수에 따라 품목이 늘고, 돈이 모자라면 못 산다', () => {
  const save = E.newGame('naru', constant(0.5));
  assert.ok(E.shopItems(save).includes('ball'));
  assert.ok(!E.shopItems(save).includes('silverball'));
  assert.ok(!E.buy(save, 'silverball').ok);
  save.badges = ['forest'];
  assert.ok(E.shopItems(save).includes('silverball'));
  save.money = 1000;
  assert.ok(E.buy(save, 'silverball', 1).ok);
  assert.equal(save.money, 400);
  assert.ok(!E.buy(save, 'silverball', 1).ok);
  assert.ok(!E.buy(save, 'candy').ok); // 팔지 않는 도구
});

test('트레이너전: 상금 = 기본값 × 마지막 몬스터 레벨, 이긴 트레이너는 기록된다', () => {
  const save = E.newGame('naru', constant(0.5));
  save.party = [teach(mon('punch', 60), ['closecombat'])];
  const b = E.createTrainerBattle(save, 't_forest_2', constant(0.5));
  const m0 = save.money;
  const ev = E.resolveTurn(b, { t: 'move', slot: 0 }, null, constant(0.9));
  assert.equal(b.result, 'win');
  const money = ev.find((x) => x.t === 'money');
  assert.equal(money.amount, D.TRAINERS.t_forest_2.money * 6);
  const out = E.finishBattle(save, b);
  assert.equal(save.money, m0 + money.amount);
  assert.ok(save.beaten.t_forest_2);
  assert.equal(out.badge, null); // 길목 트레이너는 배지를 주지 않는다
});

test('라이벌: 플레이어 스타터에 따라 다른 스타터·진화형을 낸다', () => {
  for (const st of D.STARTERS) {
    const save = E.newGame(st, constant(0.5));
    const r1 = E.createTrainerBattle(save, 'rival_1', constant(0.5));
    assert.equal(r1.e.party[0].id, D.RIVAL_PICK[st]);
    assert.notEqual(r1.e.party[0].id, st);
    const r3 = E.createTrainerBattle(save, 'rival_3', constant(0.5));
    assert.equal(r3.e.party[2].id, D.MONSTERS[D.RIVAL_PICK[st]].evolve.to);
  }
});

test('진화: 진화 레벨에 이르면 배틀 뒤 진화 대상이 되고, 진화하면 종·HP·도감이 바뀐다', () => {
  const save = E.newGame('naru', constant(0.5));
  const m = save.party[0];
  const ev = [];
  E.gainExp(m, E.expForLevel(16) - m.exp, ev);
  assert.equal(m.lv, 16);
  assert.deepEqual(E.pendingEvolutions(save), [0]);
  const before = E.maxHp(m), hp = m.hp;
  const r = E.evolveMon(save, m);
  assert.deepEqual(r, { from: 'naru', to: 'naru2' });
  assert.equal(m.hp, hp + E.maxHp(m) - before);
  assert.ok(save.dex.caught.naru2);
  assert.deepEqual(E.pendingEvolutions(save), []);
  // 기절한 몬스터는 진화하지 않는다
  const c = mon('cheese', 20); c.hp = 0;
  assert.ok(!E.canEvolve(c));
});

test('저장 v3: 새 게임 기본값, v2 저장은 v3로 옮겨진다', () => {
  const save = E.newGame('naru', constant(0.5));
  assert.equal(save.v, 3);
  assert.equal(save.money, D.TUNING.startMoney);
  assert.ok(E.isValidSave(save));
  const v2 = JSON.parse(JSON.stringify(save));
  v2.v = 2; ['money', 'bag', 'flags', 'beaten', 'visited', 'repel', 'pos', 'respawn'].forEach((k) => delete v2[k]);
  v2.badges = ['forest', 'coast'];
  const mem = { 'pocatmon.save': JSON.stringify(v2) };
  const st = E.createStore({ getItem: (k) => mem[k] || null, setItem: (k, v) => { mem[k] = v; }, removeItem: (k) => { delete mem[k]; } });
  const got = st.load();
  assert.ok(got && got.v === 3);
  assert.ok(got.flags.got_starter && got.flags.intro);
  assert.ok(got.beaten.rival_1);
  assert.ok(got.beaten.gym_forest && got.beaten.gym_coast);
  assert.equal(got.money, D.TUNING.startMoney + 1200);
  assert.deepEqual(got.party, v2.party);
  const bad = JSON.parse(JSON.stringify(save)); bad.bag.nope = 1;
  assert.ok(!E.isValidSave(bad));
});

test('리뷰 회귀: 깨어 있는 마지막 몬스터는 맡길 수 없고, 반동 동시 쓰러짐 승리 뒤에는 센터로 회복된다', () => {
  const save = E.newGame('naru', constant(0.5));
  E.addCaught(save, mon('cheese', 5));
  save.party[1].hp = 0;
  assert.ok(!E.moveToBox(save, 0));
  E.addCaught(save, mon('leaf', 5)); // 파티 3마리째
  E.addCaught(save, mon('moth', 5)); save.box[0].hp = 0; // 보관함의 기절 몬스터
  save.party[2].hp = 0;
  assert.ok(!E.swapPartyBox(save, 0, 0));
  // 반동 동시 쓰러짐
  const s2 = E.newGame('seol', constant(0.5));
  s2.party = [teach(mon('wing', 50), ['bravebird'])]; s2.party[0].hp = 1;
  const b = E.makeBattle('wild', s2.party, [teach(mon('cheese', 5), ['tackle'])]);
  E.resolveTurn(b, { t: 'move', slot: 0 }, { t: 'move', slot: 0 }, constant(0.9));
  assert.equal(b.result, 'win');
  const out = E.finishBattle(s2, b);
  assert.ok(out.whiteout);
  assert.ok(E.canExplore(s2));
});

test('리뷰 회귀: 조사 한 글자 조사, 관장 재대결 상금은 절반', () => {
  assert.equal(E.josa('설냥이', '의'), '설냥이의');
  const save = E.newGame('naru', constant(0.5));
  save.party = [teach(mon('punch', 60), ['closecombat'])];
  save.badges = ['forest'];
  const b = E.createGymBattle(save, 'forest', constant(0.5));
  b.e.party.forEach((m) => { m.hp = 1; });
  for (let i = 0; i < 5 && !b.over; i++) E.resolveTurn(b, { t: 'move', slot: 0 }, null, constant(0.9));
  assert.equal(b.result, 'win');
  assert.equal(b.prize, Math.floor(D.TRAINERS.gym_forest.money * 11 * 0.5));
});
