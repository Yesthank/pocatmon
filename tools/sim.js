#!/usr/bin/env node
/* 포캣몬 밸런스 시뮬레이션 — `npm run sim`
   시작 몬스터별로 N판의 런(4연전, 한 번 지면 끝)을 결정적 난수로 돌려
   클리어율·판별 패배 분포·평균 턴 수를 출력하고 docs/balance.md 에 남긴다.
   모든 시작 몬스터의 클리어율이 [35%, 95%] 안이면 종료 코드 0, 아니면 1. */
'use strict';
const fs = require('fs');
const path = require('path');
const D = require('../js/data.js');
const E = require('../js/engine.js');
const T = D.TUNING;

const N = Number(process.env.SIM_RUNS) || 1000;
const SEED = 20261006;
const BAND = [0.35, 0.95];
const STARTERS = ['naru', 'seol', 'ssaga', 'metal', 'black'];
const MAX_TURNS = 100; // 안전 장치(넘으면 패배로 집계)
const HEAL_BELOW = 0.35;
const SHIELD_BELOW = 0.5;
const SHIELD_CHANCE = 0.5;
const WRITE_DOC = !process.argv.includes('--no-write');

function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/* ── 무난한 플레이어 정책 ── */
// 1타 기대 피해(엔진 공식, 난수 평균 0.925, 급소 무시)
function estHit(me, foe, mv) {
  const A = me.atk * E.stageMult(me.stages.atk);
  const Dd = foe.def * E.stageMult(foe.stages.def);
  const eff = E.effectiveness(mv.type, foe.types);
  const stab = me.types.indexOf(mv.type) >= 0 ? T.stab : 1;
  let dmg = (mv.power * (A / Dd) * T.dmgScale + 2) * eff * stab * 0.925;
  if (foe.shield > 0) dmg *= T.shieldMult;
  return dmg;
}
function playerMove(b, rng) {
  const me = b.p, foe = b.e;
  const ratio = me.hp / me.maxHp;
  const moves = me.moves.map((id) => ({ id, mv: D.MOVES[id] }));
  const attacks = moves.filter((m) => m.mv.kind === 'atk');
  // 기대 피해 점수 = 위력 × 타수 × 명중 × 상성 × 자속 (실제 공식 기반)
  attacks.forEach((m) => {
    const hits = m.mv.hits ? (m.mv.hits[0] + m.mv.hits[1]) / 2 : 1;
    m.dmg = estHit(me, foe, m.mv) * hits;
    m.score = m.dmg * (m.mv.acc / 100);
    if (m.mv.recoil && ratio < 0.3) m.score *= 0.5;
  });
  // 1) 쓰러뜨릴 수 있으면 선공기 우선, 아니면 확실한(명중 높은) 막타
  const kos = attacks.filter((m) => m.dmg >= foe.hp);
  if (kos.length) {
    const pri = kos.filter((m) => m.mv.priority);
    const pool = pri.length ? pri : kos;
    pool.sort((a, b2) => b2.mv.acc - a.mv.acc || b2.score - a.score);
    return pool[0].id;
  }
  // 2) HP 낮으면 회복
  const heal = moves.find((m) => m.mv.kind === 'heal');
  if (heal && ratio < HEAL_BELOW) return heal.id;
  // 3) HP 절반 아래이고 보호막이 없으면 가끔 보호막
  const shield = moves.find((m) => m.mv.kind === 'shield');
  if (shield && ratio < SHIELD_BELOW && me.shield === 0 && rng() < SHIELD_CHANCE) return shield.id;
  // 4) 기대 피해가 가장 큰 공격
  attacks.sort((a, b2) => b2.score - a.score);
  return attacks[0].id;
}

/* ── 런 시뮬레이션 ── */
function simRun(starter, rng) {
  const run = E.createRun(starter, rng);
  const turns = [];
  for (;;) {
    const b = E.createBattle(run);
    while (!b.over && b.turn < MAX_TURNS) {
      const pm = playerMove(b, rng);
      const em = E.chooseEnemyMove(b, rng);
      E.resolveTurn(b, pm, em, rng);
    }
    turns.push(b.turn);
    if (b.winner !== 'player') return { cleared: false, lostAt: run.stage, turns, timeout: !b.over };
    if (E.winBattle(run) === 'cleared') return { cleared: true, lostAt: -1, turns, timeout: false };
  }
}

function simStarter(starter, idx) {
  const rng = mulberry32(SEED + idx * 7919);
  const r = { starter, clears: 0, lost: [0, 0, 0, 0], turnSum: 0, battles: 0, timeouts: 0 };
  for (let i = 0; i < N; i++) {
    const o = simRun(starter, rng);
    if (o.cleared) r.clears++; else r.lost[o.lostAt]++;
    if (o.timeout) r.timeouts++;
    o.turns.forEach((t) => { r.turnSum += t; r.battles++; });
  }
  r.rate = r.clears / N;
  r.avgTurns = r.turnSum / r.battles;
  r.ok = r.rate >= BAND[0] && r.rate <= BAND[1];
  return r;
}

const pct = (x) => (x * 100).toFixed(1) + '%';
if (require.main !== module) {
  module.exports = { simStarter, simRun, playerMove, STARTERS };
  return;
}
const results = STARTERS.map(simStarter);

/* ── 콘솔 표 ── */
const pad = (s, n) => String(s).padEnd(n);
console.log(`포캣몬 밸런스 시뮬레이션 (시작 몬스터별 ${N}런, seed ${SEED})`);
console.log(pad('starter', 9) + pad('clear', 9) + pad('lost@1', 8) + pad('lost@2', 8) + pad('lost@3', 8) + pad('lost@4', 8) + pad('turns', 7) + 'band');
results.forEach((r) => {
  console.log(pad(r.starter, 9) + pad(pct(r.rate), 9) + r.lost.map((x) => pad(x, 8)).join('') + pad(r.avgTurns.toFixed(2), 7) + (r.ok ? 'OK' : 'FAIL') + (r.timeouts ? ` (timeout ${r.timeouts})` : ''));
});
const allOk = results.every((r) => r.ok);
console.log(allOk ? 'RESULT: GREEN — 모든 시작 몬스터가 35~95% 안' : 'RESULT: RED — 범위를 벗어난 시작 몬스터가 있음');

/* ── docs/balance.md ── */
// 조정 기록(사람이 관리). 수치를 다시 바꾸면 여기에 이유와 함께 덧붙인다.
const TUNING_LOG = `## 조정 기록 (T5, 2026-10-06)

조정 전 결과(같은 정책·seed, ${'`'}--no-write${'`'}): 나루냥 12.6% · 설냥이 0.0% · 싸가지냥 0.0% · 메탈가디언몬 60.9% · 블랙 메탈가디언몬 85.5%, 평균 1.7~2.0턴/배틀 → 실패.

원인:
- 피해가 너무 커서(초기 dmgScale 0.42) 자속·약점이 겹치면 한두 방에 끝났다. 회복·보호막을 쓸 틈이 없고, 상성이 곧 승패였다.
- 고양이 셋은 기본 능력치 합이 메탈·블랙보다 낮은데, 고양이로 시작하면 3·4판에서 반드시 두 강철 몬스터를 만난다. 강철은 얼음·악(싸가지냥)에 약점을 찌르므로 설냥이·싸가지냥은 3판에서 거의 다 졌다.
- 상대 강화(enemyMult)가 레벨업(×1.08)과 비슷하게 올라서 연승해도 유리해지지 않았다.

조정 방향: 배틀을 3~5턴으로 늘려 판단(회복·보호막·선공 막타)이 의미 있게 하고, 승리할수록 확실히 강해지게(레벨업 ×1.15) 했다. 상성 표·기술 종류·효과 종류·런 구조·패배 시 처음부터 규칙은 바꾸지 않았다. 고양이는 체력·방어를 올리고, 메탈·블랙은 공격을 내려 "단단하지만 한 방이 덜 아픈" 보스로 바꿨다.

| 항목 | 전 | 후 | 이유 |
|---|---|---|---|
| TUNING.dmgScale | 0.42 | 0.30 | 배틀 길이 1.9턴 → 3.4~4.6턴 |
| TUNING.levelGrowth | 1.08 | 1.15 | 승리 보상을 체감되게, 후반 강철 보스를 넘을 힘 |
| TUNING.enemyMult | [1.0, 1.05, 1.10, 1.20] | [0.90, 0.95, 0.95, 1.15] | 첫 판 상성 불리(나루냥→설냥이, 설냥이→싸가지냥)도 해볼 만하게, 보스 판만 확실히 강하게 |
| 나루냥 HP/공/방/스 | 95/58/55/88 | 118/60/72/88 | 첫 판 설냥이(얼음 약점)에 지나치게 약함 |
| 설냥이 HP/공/방/스 | 92/60/60/78 | 115/60/72/84 | 싸가지냥·메탈·블랙 모두에게 약점을 찔림 |
| 싸가지냥 HP/공/방/스 | 86/68/48/98 | 100/52/58/90 | 고양이 상대로는 너무 세고(첫 두 판 ~95% 승), 강철 상대로는 종이 → 공격을 낮추고 내구를 올림 |
| 메탈가디언몬 HP/공/방/스 | 118/72/80/62 | 146/58/78/64 | 단단한 수호자로, 고양이 런의 3판 벽을 낮춤 |
| 블랙 메탈가디언몬 HP/공/방/스 | 128/84/74/72 | 116/64/84/74 | 플레이어로 쓰면 85%+로 너무 쉬웠고 보스로는 너무 셈 |
| 얼음뭉치 위력 | 50 | 55 | 설냥이 기본 화력 보강 |
| 눈보라 위력 | 70 | 65 | 얼림 20% 기술의 기대값 정리 |
| 프리즈빔 얼림 확률 | 30% | 35% | 설냥이가 강철 보스를 넘는 수단(설명 문구도 35%로 수정) |
| 냥펀치 위력 | 60 | 55 | 싸가지냥 고양이전 과강 완화 |
| 메탈 임팩트 위력 | 85 | 70 | 강철 약점(얼음·악)에게 한 방이 너무 큼 |
| 다크 메탈 슬래시 위력 | 75 | 60 | 고급소와 겹쳐 과한 폭딜 |
| 데스 임팩트 위력 | 110 | 100 | 보스 블랙의 한 방 완화 |

조정은 별도 seed의 시뮬레이션으로 수치를 탐색한 뒤, 보기 좋은 값으로 반올림하고 이 문서의 seed로 다시 검증했다. 다른 seed 두 개(각 5000런)로 교차 확인해도 모든 몬스터가 46~73% 안에 있었다.`;

if (WRITE_DOC) {
  const name = (id) => D.MONSTERS[id].name;
  const lines = [];
  lines.push('# 포캣몬 배틀 밸런스 시뮬레이션');
  lines.push('');
  lines.push('`npm run sim` (tools/sim.js)이 이 문서를 다시 만든다. 수치는 결정적 난수(seed 고정)로 재현된다.');
  lines.push('');
  lines.push('## 방법');
  lines.push('');
  lines.push(`- 시작 몬스터 5종마다 런 ${N}판을 돌린다. 난수는 mulberry32, seed ${SEED} (몬스터별 오프셋 고정).`);
  lines.push('- 런 = 4연전(고양이 2~3마리 → 최종 보스). 승리하면 체력 전부 회복 + 레벨업(능력치 ×levelGrowth), **한 번 지면 런 종료**(처음부터 다시).');
  lines.push('- 엔진은 게임과 같은 `js/engine.js`(createRun · createBattle · resolveTurn · chooseEnemyMove · winBattle)를 그대로 쓴다.');
  lines.push(`- 한 배틀이 ${MAX_TURNS}턴을 넘으면 패배로 집계한다(안전 장치, 이번 실행에서 ${results.reduce((a, r) => a + r.timeouts, 0)}건).`);
  lines.push('- 합격 기준: 모든 시작 몬스터의 클리어율이 35% 이상 95% 이하.');
  lines.push('');
  lines.push('## 플레이어 정책 ("무난한 플레이")');
  lines.push('');
  lines.push('1. 이번 턴에 상대를 쓰러뜨릴 수 있는 공격이 있으면 그것을 쓴다. 선공기가 있으면 선공기를 우선한다.');
  lines.push(`2. 체력이 ${HEAL_BELOW * 100}% 미만이고 회복기가 있으면 회복한다.`);
  lines.push(`3. 체력이 ${SHIELD_BELOW * 100}% 미만이고 보호막이 없으면 ${SHIELD_CHANCE * 100}% 확률로 보호막을 친다.`);
  lines.push('4. 그 밖에는 기대 피해(위력 × 타수 × 명중 × 상성 × 자속, 실제 피해 공식과 능력 단계 반영)가 가장 큰 공격을 쓴다. 체력 30% 미만이면 반동기 점수를 절반으로 낮춘다.');
  lines.push('');
  lines.push('상대는 게임과 같은 `PEngine.chooseEnemyMove`(점수 제곱 가중 무작위)를 쓴다.');
  lines.push('');
  lines.push('## 결과');
  lines.push('');
  lines.push('| 시작 몬스터 | 클리어율 | 1판 패배 | 2판 패배 | 3판 패배 | 4판(보스) 패배 | 평균 턴/배틀 | 판정 |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---|');
  results.forEach((r) => {
    lines.push(`| ${name(r.starter)} (${r.starter}) | ${pct(r.rate)} | ${r.lost[0]} | ${r.lost[1]} | ${r.lost[2]} | ${r.lost[3]} | ${r.avgTurns.toFixed(2)} | ${r.ok ? '통과' : '실패'} |`);
  });
  lines.push('');
  lines.push(`패배 수는 ${N}런 중 해당 판에서 진 런의 수다. 고양이 시작은 3판=메탈가디언몬, 4판=블랙 메탈가디언몬; 메탈 시작은 4판=블랙; 블랙 시작은 4판=메탈가디언몬.`);
  lines.push('');
  lines.push(`종합: ${allOk ? '**통과** — 모든 시작 몬스터가 35~95% 범위 안이다.' : '**실패** — 범위를 벗어난 시작 몬스터가 있다.'}`);
  lines.push('');
  lines.push('## 현재 조정값 (js/data.js TUNING)');
  lines.push('');
  lines.push(`- dmgScale ${T.dmgScale}, stab ${T.stab}, levelGrowth ${T.levelGrowth}, enemyMult [${T.enemyMult.join(', ')}]`);
  lines.push(`- 보호막 ${T.shieldTurns}턴 × 피해 ${T.shieldMult}, 급소 ${(T.crit * 100).toFixed(2)}% / 고급소 ${T.highCrit * 100}% × ${T.critMult}`);
  lines.push('- 기본 능력치: ' + STARTERS.map((id) => { const s = D.MONSTERS[id].base; return `${name(id)} HP${s.hp}/공${s.atk}/방${s.def}/스${s.spd}`; }).join(', '));
  lines.push('');
  if (TUNING_LOG) { lines.push(TUNING_LOG); lines.push(''); }
  const out = path.join(__dirname, '..', 'docs', 'balance.md');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, lines.join('\n'), 'utf8');
  console.log('wrote ' + path.relative(process.cwd(), out));
}

process.exitCode = allOk ? 0 : 1;
