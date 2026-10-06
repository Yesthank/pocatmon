'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../js/data.js');
const E = require('../js/engine.js');

// 결정적 난수
function seq(values) { let i = 0; return () => values[Math.min(i++, values.length - 1)]; }
function constant(v) { return () => v; }
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function battle(pid, eid, opt = {}) {
  const p = E.makeFighter(pid, { side: 'player', level: opt.level || 5 });
  const e = E.makeFighter(eid, { side: 'enemy' });
  return { p, e, turn: 0, over: false, winner: null };
}

test('상성 배율표 전체', () => {
  const exp = {
    water: { water: 0.5, ice: 1, steel: 2, dark: 1, normal: 1 },
    ice: { water: 2, ice: 0.5, steel: 1, dark: 1, normal: 1 },
    steel: { water: 1, ice: 2, steel: 0.5, dark: 2, normal: 1 },
    dark: { water: 1, ice: 2, steel: 1, dark: 0.5, normal: 1 },
    normal: { water: 1, ice: 1, steel: 1, dark: 1, normal: 1 }
  };
  for (const a of Object.keys(exp)) for (const d of Object.keys(exp[a])) {
    assert.equal(E.effectiveness(a, [d]), exp[a][d], a + '→' + d);
  }
  // 이중 타입은 곱한다
  assert.equal(E.effectiveness('water', ['dark', 'steel']), 2);
  assert.equal(E.effectiveness('steel', ['dark', 'steel']), 1);
  assert.equal(E.effectiveness('steel', ['dark', 'normal']), 2);
  assert.equal(E.effectiveness('dark', ['dark', 'steel']), 0.5);
  assert.equal(E.effectiveness('ice', ['dark', 'steel']), 1);
});

test('자속 보정 ×1.5', () => {
  const b = battle('naru', 'ssaga');
  const r = () => 0.99; // 급소 없음, 난수 최대
  const water = E.calcDamage(b.p, b.e, D.MOVES.watergun, r).dmg;
  const fake = Object.assign({}, D.MOVES.watergun, { type: 'normal' }); // 노말→악·노말 = ×1
  const plain = E.calcDamage(b.p, b.e, fake, r).dmg;
  // 물→(악·노말)=×1 이므로 차이는 자속뿐
  assert.ok(Math.abs(water / plain - 1.5) < 0.05, water + ' / ' + plain);
});

test('행동 순서: 먼저 공격 > 스피드 > 무작위', () => {
  const b = battle('metal', 'naru'); // 나루냥이 더 빠름
  assert.deepEqual(E.turnOrder(b, 'metalimpact', 'splash', constant(0.1)), ['e', 'p']);
  assert.deepEqual(E.turnOrder(b, 'speedattack', 'splash', constant(0.1)), ['p', 'e']); // 선공기
  assert.deepEqual(E.turnOrder(b, 'speedattack', 'watergun', constant(0.1)), ['e', 'p']); // 둘 다 선공 → 스피드
  b.p.spd = b.e.spd;
  assert.deepEqual(E.turnOrder(b, 'metalimpact', 'splash', constant(0.1)), ['p', 'e']);
  assert.deepEqual(E.turnOrder(b, 'metalimpact', 'splash', constant(0.9)), ['e', 'p']);
});

test('명중 실패 시 빗나감', () => {
  const b = battle('naru', 'metal');
  const ev = E.resolveTurn(b, 'hydropump', 'guardianshield', constant(0.95)); // 0.95*100 >= 80 → 빗나감
  assert.ok(ev.some((x) => x.t === 'miss'));
  assert.equal(b.e.hp, b.e.maxHp);
});

test('얼림: 아직 행동 전이면 그 턴 행동 취소, 한 번 쉬고 풀림, 중복 없음', () => {
  const b = battle('seol', 'metal'); // 설냥이가 더 빠름
  b.e.hp = b.e.maxHp = 9999;
  const ev = E.resolveTurn(b, 'freezebeam', 'metalimpact', constant(0.01)); // 명중·얼림 확정
  assert.ok(ev.some((x) => x.t === 'freeze'));
  assert.ok(ev.some((x) => x.t === 'thaw'), '같은 턴 행동이 취소되고 녹아야 함');
  assert.ok(!ev.some((x) => x.t === 'use' && x.side === 'enemy'));
  assert.equal(b.e.frozen, false);
  // 이미 얼어 있으면 중복 메시지 없음
  b.e.frozen = true;
  const ev2 = [];
  const r = constant(0.01);
  const before = b.e.frozen;
  E.resolveTurn(b, 'blizzard', 'metalimpact', r).forEach((x) => ev2.push(x));
  assert.equal(before, true);
  assert.equal(ev2.filter((x) => x.t === 'freeze').length, 0);
});

test('풀죽음: 먼저 행동해 맞혔을 때만', () => {
  const b = battle('ssaga', 'metal'); // 싸가지냥이 더 빠름
  b.e.hp = b.e.maxHp = 9999;
  const ev = E.resolveTurn(b, 'nyanpunch', 'metalimpact', constant(0.01));
  assert.ok(ev.some((x) => x.t === 'flinch' && x.side === 'enemy'));
  // 늦게 행동하면 풀죽음 없음
  const b2 = battle('ssaga', 'naru');
  b2.p.spd = 1; b2.e.hp = b2.e.maxHp = 9999; b2.p.hp = b2.p.maxHp = 9999;
  const ev2 = E.resolveTurn(b2, 'nyanpunch', 'splash', constant(0.01));
  assert.ok(!ev2.some((x) => x.t === 'flinch'));
  assert.equal(b2.p.flinch, false);
  assert.equal(b2.e.flinch, false);
});

test('보호막: 사용 턴 포함 2턴, 피해 절반', () => {
  const b = battle('metal', 'naru');
  b.p.hp = b.p.maxHp = 9999;
  const r = () => 0.5;
  E.resolveTurn(b, 'guardianshield', 'splash', r); // 나루냥이 먼저 → 보호막 전 피해
  assert.equal(b.p.shield, 1);
  const shielded = E.calcDamage(b.e, b.p, D.MOVES.hydropump, constant(0.5)).dmg;
  b.p.shield = 0;
  const base = E.calcDamage(b.e, b.p, D.MOVES.hydropump, constant(0.5)).dmg;
  b.p.shield = 1;
  assert.ok(Math.abs(shielded - base * 0.5) <= 1, base + ' → ' + shielded);
  const ev = E.resolveTurn(b, 'metalimpact', 'watergun', r);
  assert.equal(b.p.shield, 0);
  assert.ok(ev.some((x) => x.t === 'shield' && x.on === false));
});

test('능력 단계 −3~+3 범위', () => {
  const b = battle('naru', 'metal');
  b.e.hp = b.e.maxHp = 99999; b.p.hp = b.p.maxHp = 99999;
  for (let i = 0; i < 5; i++) E.resolveTurn(b, 'splash', 'guardianshield', constant(0.5));
  assert.equal(b.e.stages.def, -3);
  const s = battle('ssaga', 'metal');
  s.p.hp = s.p.maxHp = 99999; s.e.hp = s.e.maxHp = 99999;
  for (let i = 0; i < 5; i++) E.resolveTurn(s, 'trashdig', 'guardianshield', constant(0.5));
  assert.equal(s.p.stages.atk, 3);
  // 다정한 수호자는 하락만 해제
  const m = battle('metal', 'ssaga');
  m.p.stages.atk = -2; m.p.stages.def = 1; m.p.hp = 10;
  E.resolveTurn(m, 'kindguard', 'trashdig', constant(0.5));
  assert.equal(m.p.stages.atk, 0);
  assert.equal(m.p.stages.def, 1);
});

test('회복은 최대 HP를 넘지 않는다', () => {
  const b = battle('naru', 'metal');
  b.p.hp = b.p.maxHp - 3;
  E.resolveTurn(b, 'bubbleheal', 'guardianshield', constant(0.5));
  assert.equal(b.p.hp, b.p.maxHp);
  const ev = E.resolveTurn(b, 'bubbleheal', 'guardianshield', constant(0.5));
  assert.ok(ev.some((x) => x.t === 'msg' && /이미 가득/.test(x.text)));
});

test('반동 동시 쓰러짐: 먼저 쓰러진 쪽이 진다', () => {
  // 플레이어 블랙이 데스 임팩트로 상대를 쓰러뜨리고 반동으로 쓰러짐 → 플레이어 승
  const b = battle('black', 'naru');
  b.p.spd = 999; b.e.hp = 5; b.p.hp = 1;
  const ev = E.resolveTurn(b, 'deathimpact', 'watergun', constant(0.01));
  // watergun 은 선공이므로 먼저 맞을 수 있음 → 플레이어 hp 1이면 먼저 쓰러질 수 있으니 상대 기술을 비선공으로
  const b2 = battle('black', 'naru');
  b2.p.spd = 999; b2.e.hp = 5; b2.p.hp = 1;
  const ev2 = E.resolveTurn(b2, 'deathimpact', 'splash', constant(0.01));
  assert.equal(b2.winner, 'player');
  assert.ok(ev2.filter((x) => x.t === 'faint').length === 2);
  assert.ok(ev.length > 0);
  // 상대 블랙이 플레이어를 쓰러뜨리고 반동으로 쓰러짐 → 상대 승
  const c = battle('naru', 'black');
  c.p.spd = 1; c.e.spd = 999; c.p.hp = 5; c.e.hp = 1;
  E.resolveTurn(c, 'splash', 'deathimpact', constant(0.01));
  assert.equal(c.winner, 'enemy');
});

test('다단 기술: 2~3회, 맞은 횟수 메시지', () => {
  const b = battle('metal', 'seol');
  b.e.hp = b.e.maxHp = 9999;
  const ev = E.resolveTurn(b, 'speedattack', 'iceshield', seq([0.5, 0.99, 0.99, 0.9, 0.99, 0.9, 0.99, 0.9, 0.5]));
  const hits = ev.filter((x) => x.t === 'hit' && x.side === 'enemy').length;
  assert.ok(hits >= 2 && hits <= 3);
  assert.ok(ev.some((x) => x.t === 'msg' && /번 맞았다/.test(x.text)));
});

test('상대 순서 규칙 3종', () => {
  for (let s = 1; s <= 50; s++) {
    const rng = mulberry32(s);
    for (const cat of D.CATS) {
      const r = E.createRun(cat, rng);
      assert.equal(r.order.length, 4);
      assert.deepEqual(r.order.slice(2), ['metal', 'black']);
      assert.deepEqual(r.order.slice(0, 2).sort(), D.CATS.filter((c) => c !== cat).sort());
      assert.equal(r.cutscene, 'corrupt');
    }
    const m = E.createRun('metal', rng);
    assert.deepEqual(m.order.slice(0, 3).sort(), D.CATS.slice().sort());
    assert.equal(m.order[3], 'black'); assert.equal(m.cutscene, 'shadow');
    const k = E.createRun('black', rng);
    assert.deepEqual(k.order.slice(0, 3).sort(), D.CATS.slice().sort());
    assert.equal(k.order[3], 'metal'); assert.equal(k.cutscene, 'face');
  }
});

test('이로치는 고양이 상대에게만, 약 10%', () => {
  let cats = 0, shinyCats = 0;
  const rng = mulberry32(7);
  for (let i = 0; i < 4000; i++) {
    const r = E.createRun(['naru', 'seol', 'ssaga', 'metal', 'black'][i % 5], rng);
    r.order.forEach((id, k) => {
      if (D.MONSTERS[id].cat) { cats++; if (r.shiny[k]) shinyCats++; } else assert.equal(r.shiny[k], false, id);
    });
  }
  const rate = shinyCats / cats;
  assert.ok(rate > 0.08 && rate < 0.12, 'rate ' + rate);
});

test('런 진행: 승리 시 레벨업, 4판 후 클리어, 보스 판 앞 컷신', () => {
  const r = E.createRun('naru', mulberry32(1));
  assert.equal(E.cutsceneBefore(r), null);
  assert.equal(E.winBattle(r), 'next'); assert.equal(r.level, 6);
  E.winBattle(r); E.winBattle(r);
  assert.equal(r.stage, 3);
  assert.equal(E.cutsceneBefore(r), 'corrupt');
  const b = E.createBattle(r);
  assert.equal(b.e.id, 'black');
  assert.equal(b.e.displayLevel, 10);
  assert.equal(b.p.level, 8);
  assert.ok(Math.abs(b.p.maxHp - Math.round(95 * Math.pow(1.08, 3))) <= 1);
  assert.ok(Math.abs(b.e.maxHp - Math.round(128 * 1.2)) <= 1);
  assert.equal(E.winBattle(r), 'cleared');
});

test('이어하기 저장·복원·삭제, 해금', () => {
  const mem = new Map();
  const ls = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const st = E.createStore(ls);
  assert.equal(st.loadRun(), null);
  const r = E.createRun('seol', mulberry32(3));
  E.winBattle(r);
  st.saveRun(r);
  const back = E.createStore(ls).loadRun();
  assert.deepEqual(back, r); // 이로치 포함 그대로
  st.clearRun();
  assert.equal(st.loadRun(), null);
  // 깨진 기록은 무시
  mem.set(E.KEYS.run, '{"v":1,"starter":"zzz"}');
  assert.equal(st.loadRun(), null);
  mem.set(E.KEYS.run, 'not json');
  assert.equal(st.loadRun(), null);
  assert.equal(st.isUnlocked(), false);
  st.unlock();
  assert.equal(E.createStore(ls).isUnlocked(), true);
});

test('저장소를 쓸 수 없어도 오류 없이 이번 방문 동안 유지', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  for (const s of [broken, null, undefined]) {
    const st = E.createStore(s);
    assert.doesNotThrow(() => { st.unlock(); st.saveRun(E.createRun('naru', mulberry32(2))); });
    assert.equal(st.isUnlocked(), true);
    assert.ok(st.loadRun());
    st.clearRun();
    assert.equal(st.loadRun(), null);
  }
});

test('읽기는 되고 쓰기·삭제만 실패하는 저장소에서도 지운 런이 되살아나지 않음', () => {
  const stale = JSON.stringify(E.createRun('naru', mulberry32(5)));
  const ro = { getItem: (k) => (k === E.KEYS.run ? stale : null), setItem() { throw new Error('quota'); }, removeItem() { throw new Error('denied'); } };
  const st = E.createStore(ro);
  assert.ok(st.loadRun());
  st.clearRun();
  assert.equal(st.loadRun(), null);
  const r = E.createRun('seol', mulberry32(6));
  st.saveRun(r);
  assert.deepEqual(st.loadRun(), r);
});

test('조사 처리', () => {
  assert.equal(E.josa('나루냥', '은/는'), '나루냥은');
  assert.equal(E.josa('설냥이', '은/는'), '설냥이는');
  assert.equal(E.josa('블랙 메탈가디언몬', '은/는'), '블랙 메탈가디언몬은');
  assert.equal(E.josa('방어', '이/가'), '방어가');
});

test('상대 AI는 항상 자기 기술 중 하나를 고르고, 효과 좋은 기술을 선호', () => {
  const b = battle('seol', 'metal'); // 강철→얼음 ×2
  const rng = mulberry32(11);
  const counts = {};
  for (let i = 0; i < 2000; i++) {
    const m = E.chooseEnemyMove(b, rng);
    assert.ok(b.e.moves.includes(m));
    counts[m] = (counts[m] || 0) + 1;
  }
  assert.ok(counts.metalimpact > counts.guardianshield);
});

test('랜덤 배틀 1000판: 항상 끝나고 HP는 0~최대', () => {
  const ids = Object.keys(D.MONSTERS);
  const rng = mulberry32(99);
  for (let i = 0; i < 1000; i++) {
    const b = battle(ids[i % 5], ids[(i * 3 + 1) % 5]);
    let n = 0;
    while (!b.over && n < 200) {
      const pm = b.p.moves[Math.floor(rng() * 4)];
      E.resolveTurn(b, pm, E.chooseEnemyMove(b, rng), rng);
      for (const f of [b.p, b.e]) assert.ok(f.hp >= 0 && f.hp <= f.maxHp);
      n++;
    }
    assert.ok(b.over, 'battle did not end');
    assert.ok(b.winner === 'player' || b.winner === 'enemy');
  }
});
