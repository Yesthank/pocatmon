#!/usr/bin/env node
/* 포캣몬 밸런스 시뮬레이션 — `npm run sim`
   스타터 3종마다 N번, 게임 한 판 전체(지역 6곳 수련·포획 → 관장 도전 → 정상 최종전)를 결정적 난수로 흉내 낸다.
   관장별 첫 도전 승률, 재도전 횟수, 수련 배틀 수, 클리어율을 출력하고 docs/balance.md 에 남긴다.
   합격 기준(아래 GATE)을 모두 만족하면 종료 코드 0, 아니면 1. */
'use strict';
const fs = require('fs');
const path = require('path');
const D = require('../js/data.js');
const E = require('../js/engine.js');
const T = D.TUNING;
const PM = require('../js/maps.js');

const N = Number(process.env.SIM_RUNS) || 80;
const SEED = 20261006;
const MAX_TURNS = 150;          // 안전 장치(넘으면 패배로 집계)
const GRIND_GAP = 2;            // 파티 최저 레벨이 '관장 최고 레벨 − GRIND_GAP'이 될 때까지 수련
const GRIND_CAP = 90;           // 지역당 수련 배틀 상한
const RETRY_GRIND = 8;          // 관장에게 지면 이만큼 더 수련하고 재도전
const MAX_ATTEMPTS = 8;
const GATE = { gymFirstTry: [0.30, 0.97], clear: 0.90, maxWildBattles: 260 };
const WRITE_DOC = !process.argv.includes('--no-write');

function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/* ── 무난한 플레이어 정책 ── */
function bestScore(b, idx) {
  const keep = b.p.active, vol = b.p.vol;
  b.p.active = idx; b.p.vol = { stages: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 }, cnf: 0, flinch: false, toxN: 0 };
  const mon = b.p.party[idx];
  let best = 0;
  mon.moves.forEach((m, i) => { if (m.pp > 0 && D.MOVES[m.id].cat !== 'status') best = Math.max(best, E.estimate(b, 'p', i)); });
  b.p.active = keep; b.p.vol = vol;
  return best;
}
function pickReplacement(b) {
  let best = -1, bi = E.firstAlive(b.p.party);
  b.p.party.forEach((m, i) => { if (E.isAlive(m)) { const s = bestScore(b, i) * (0.5 + m.hp / E.maxHp(m)); if (s > best) { best = s; bi = i; } } });
  return bi;
}
function playerAction(b, rng, wantCatch) {
  const me = E.active(b, 'p'), foe = E.active(b, 'e');
  if (wantCatch && b.kind === 'wild' && foe.hp / E.maxHp(foe) < 0.5) return { t: 'ball', item: 'silverball' };
  const ratio = me.hp / E.maxHp(me);
  // 상성이 나쁘면(최선 점수가 낮고 더 나은 동료가 건강하면) 교체 — 한 상대에게 한 번만
  if (b._switchedFor !== foe.uid + ':' + b.e.active) {
    const mine = bestScore(b, b.p.active);
    let alt = -1, altScore = mine * 2.2;
    b.p.party.forEach((m, i) => { if (i !== b.p.active && E.isAlive(m) && m.hp / E.maxHp(m) > 0.5) { const s = bestScore(b, i); if (s > altScore) { altScore = s; alt = i; } } });
    if (alt >= 0 && mine < 35) { b._switchedFor = foe.uid + ':' + b.e.active; return { t: 'switch', to: alt }; }
  }
  const slots = me.moves.map((m, i) => i).filter((i) => me.moves[i].pp > 0);
  if (!slots.length) return { t: 'move', slot: 0 };
  const heal = slots.find((i) => D.MOVES[me.moves[i].id].heal);
  if (heal != null && ratio < 0.35) return { t: 'move', slot: heal };
  const scored = slots.map((i) => ({ i, s: E.estimate(b, 'p', i) })).sort((a, c) => c.s - a.s);
  // 사람처럼 가끔(15%) 두 번째로 좋은 기술을 고른다
  const pick = scored.length > 1 && rng() < 0.15 ? scored[1] : scored[0];
  return { t: 'move', slot: pick.i };
}

function fight(b, rng, wantCatch) {
  let turns = 0;
  E.beginBattle(b);
  while (!b.over && turns < MAX_TURNS) {
    if (b.needSwitch) { E.forceSwitch(b, pickReplacement(b)); continue; }
    E.resolveTurn(b, playerAction(b, rng, wantCatch), E.chooseEnemyAction(b, rng), rng);
    turns++;
  }
  if (!b.over) { b.over = true; b.result = 'lose'; b.timeout = true; }
  return turns;
}

// 새로 잡은 몬스터가 파티 최저 레벨보다 높거나 같으면 그 자리에 넣는다(스타터는 빼지 않는다)
function arrangeParty(save) {
  save.box.sort((a, c) => c.lv - a.lv);
  for (let k = 0; k < save.box.length; k++) {
    const cand = save.box[k];
    let low = -1;
    save.party.forEach((m, i) => { if (i > 0 && (low < 0 || m.lv < save.party[low].lv)) low = i; });
    if (save.party.length < T.partyMax) { E.moveToParty(save, k); k--; continue; }
    if (low > 0 && cand.lv > save.party[low].lv + 1 && !save.party.some((m) => m.id === cand.id)) E.swapPartyBox(save, low, k);
  }
}

// 상대 팀에 대한 상성 점수: 내 타입으로 찌르는 배율 − 상대 타입에 찔리는 배율의 절반
function matchup(mon, team) {
  const mt = D.MONSTERS[mon.id].types;
  return team.reduce((acc, [id]) => {
    const tt = D.MONSTERS[id].types;
    const atk = Math.max.apply(null, mt.map((t) => E.effectiveness(t, tt)));
    const def = Math.max.apply(null, tt.map((t) => E.effectiveness(t, mt)));
    return acc + atk - def * 0.5;
  }, 0);
}
// 관장에게 지면: 보관함에서 상성이 더 좋은 몬스터를 꺼내 상성이 가장 나쁜 파티원(스타터 포함)과 바꾼다
function counterPick(save, team) {
  if (!save.box.length) return;
  let worst = 0;
  save.party.forEach((m, i) => { if (matchup(m, team) < matchup(save.party[worst], team)) worst = i; });
  let best = -1;
  save.box.forEach((m, k) => { if (matchup(m, team) > matchup(save.party[worst], team) + 1 && (best < 0 || matchup(m, team) > matchup(save.box[best], team))) best = k; });
  if (best >= 0) { E.swapPartyBox(save, worst, best); E.makeLead(save, worst); }
}

function playthrough(starter, rng) {
  const save = E.newGame(starter, rng);
  save.bag = null; // 시뮬레이션은 가방 개수를 세지 않는다(실버볼 무제한)
  const evolveAll = () => E.pendingEvolutions(save).forEach((i) => E.evolveMon(save, save.party[i]));
  const stat = { gyms: [], wild: 0, turns: 0, cleared: false, timeouts: 0, caught: 0 };
  for (const area of D.AREAS) {
    if (area.post) continue;
    const gymTeam = D.TRAINERS[area.gym.trainer].team;
    const ace = Math.max.apply(null, gymTeam.map((t) => t[1]));
    const target = ace - GRIND_GAP;
    const g = { id: area.id, attempts: 0, firstWin: false, won: false, lvAtFirst: 0, wildHere: 0 };
    const grind = (limit) => {
      for (let k = 0; k < limit; k++) {
        if (area.wild == null) return;
        if (Math.min.apply(null, save.party.map((m) => m.lv)) >= target && limit === GRIND_CAP) return;
        E.healParty(save);
        const b = E.createWildBattle(save, area.id, rng);
        const sp = b.e.party[0].id;
        const wantCatch = !save.dex.caught[sp];
        stat.turns += fight(b, rng, wantCatch);
        if (b.timeout) stat.timeouts++;
        const out = E.finishBattle(save, b);
        evolveAll();
        if (out.caughtTo) { stat.caught++; arrangeParty(save); }
        stat.wild++; g.wildHere++;
      }
    };
    // 정상(최종전)에는 야생이 없으므로 직전 지역에서 수련한다
    const grindArea = area.wild ? area : D.AREAS[D.AREAS.indexOf(area) - 1];
    const grindIn = (limit) => {
      const saved = area.wild;
      if (!saved) { area.wild = grindArea.wild; area.lv = grindArea.lv; }
      grind(limit);
      if (!saved) { delete area.wild; delete area.lv; }
    };
    // 길목 트레이너·라이벌과 먼저 한 번씩 싸운다 (지면 센터에서 회복하고 넘어간다)
    if (PM.MAPS[area.id]) PM.MAPS[area.id].npcs.filter((n) => n.trainer).forEach((n) => {
      E.healParty(save);
      const tb = E.createTrainerBattle(save, n.trainer, rng);
      stat.turns += fight(tb, rng, false);
      E.finishBattle(save, tb);
      evolveAll();
      stat.trainers = (stat.trainers || 0) + 1;
    });
    grindIn(GRIND_CAP);
    while (g.attempts < MAX_ATTEMPTS && !g.won) {
      if (g.attempts > 0) {
        if (g.attempts === 1) counterPick(save, gymTeam);
        grindIn(RETRY_GRIND);
      }
      E.healParty(save);
      if (g.attempts === 0) g.lvAtFirst = save.party.reduce((a, m) => a + m.lv, 0) / save.party.length;
      const b = E.createGymBattle(save, area.id, rng);
      stat.turns += fight(b, rng, false);
      if (b.timeout) stat.timeouts++;
      E.finishBattle(save, b);
      evolveAll();
      g.attempts++;
      if (b.result === 'win') { g.won = true; if (g.attempts === 1) g.firstWin = true; }
    }
    stat.gyms.push(g);
    if (!g.won) return stat;
  }
  stat.cleared = true;
  stat.finalLv = save.party.map((m) => m.lv);
  return stat;
}

/* ── 실행 ── */
const t0 = Date.now();
const results = D.STARTERS.map((starter, si) => {
  const rng = mulberry32(SEED + si * 7919);
  const runs = [];
  for (let n = 0; n < N; n++) runs.push(playthrough(starter, rng));
  return { starter, runs };
});
const gymIds = D.AREAS.filter((a) => !a.post).map((a) => a.id);
const pct = (x) => (x * 100).toFixed(1) + '%';
const avg = (arr) => arr.length ? arr.reduce((a, c) => a + c, 0) / arr.length : 0;

const gymTable = gymIds.map((id) => {
  const row = { id, perStarter: {} };
  let firstAll = [], attemptsAll = [];
  results.forEach((r) => {
    const gs = r.runs.map((s) => s.gyms.find((g) => g.id === id)).filter(Boolean);
    const first = gs.length ? gs.filter((g) => g.firstWin).length / gs.length : 0;
    row.perStarter[r.starter] = { first, n: gs.length, lv: avg(gs.map((g) => g.lvAtFirst)), attempts: avg(gs.map((g) => g.attempts)) };
    firstAll = firstAll.concat(gs.map((g) => (g.firstWin ? 1 : 0)));
    attemptsAll = attemptsAll.concat(gs.map((g) => g.attempts));
  });
  row.first = avg(firstAll); row.attempts = avg(attemptsAll);
  row.ok = row.first >= GATE.gymFirstTry[0] && row.first <= GATE.gymFirstTry[1];
  return row;
});
const starterTable = results.map((r) => {
  const clear = r.runs.filter((s) => s.cleared).length / r.runs.length;
  const wild = avg(r.runs.map((s) => s.wild));
  return {
    starter: r.starter, clear, wild, turns: avg(r.runs.map((s) => s.turns)), caught: avg(r.runs.map((s) => s.caught)),
    timeouts: r.runs.reduce((a, s) => a + s.timeouts, 0),
    ok: clear >= GATE.clear && wild <= GATE.maxWildBattles
  };
});
const allOk = gymTable.every((g) => g.ok) && starterTable.every((s) => s.ok);

console.log(`포캣몬 밸런스 시뮬레이션 — 스타터별 ${N}회, seed ${SEED} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
console.log('관장별 첫 도전 승률 (스타터별) / 평균 시도 / 첫 도전 때 파티 평균 레벨');
gymTable.forEach((g) => {
  console.log(`  ${g.id.padEnd(8)} ${pct(g.first).padStart(6)}  ` + D.STARTERS.map((s) => `${s}:${pct(g.perStarter[s].first)} Lv${g.perStarter[s].lv.toFixed(1)}`).join('  ') + `  시도 ${g.attempts.toFixed(2)} ${g.ok ? 'OK' : 'NG'}`);
});
starterTable.forEach((s) => {
  console.log(`  ${s.starter.padEnd(6)} 클리어 ${pct(s.clear)}  수련 배틀 ${s.wild.toFixed(0)}  포획 ${s.caught.toFixed(1)}  총 턴 ${s.turns.toFixed(0)}  시간초과 ${s.timeouts} ${s.ok ? 'OK' : 'NG'}`);
});
console.log(allOk ? 'PASS' : 'FAIL');

if (WRITE_DOC) {
  const name = (id) => D.MONSTERS[id].name;
  const L = [];
  L.push('# 포캣몬 배틀 밸런스 시뮬레이션');
  L.push('');
  L.push('`npm run sim` (tools/sim.js)이 이 문서를 다시 만든다. 수치는 결정적 난수(seed 고정)로 재현된다.');
  L.push('');
  L.push('## 방법');
  L.push('');
  L.push(`- 스타터 3종마다 게임 한 판 전체를 ${N}번 흉내 낸다. 난수는 mulberry32, seed ${SEED}(스타터별 오프셋 고정)이다.`);
  L.push(`- 지역마다 파티 최저 레벨이 '관장 최고 레벨 − ${GRIND_GAP}'이 될 때까지 야생 배틀로 수련한다(지역당 최대 ${GRIND_CAP}번). 배틀마다 센터에서 회복한다.`);
  L.push('- 처음 보는 종이면 상대 체력이 절반 아래로 떨어진 뒤 포캣볼을 던진다. 잡은 몬스터가 파티 최저 레벨보다 2 이상 높고 새 종이면 파티에 넣는다(스타터는 빼지 않는다).');
  L.push(`- 관장에게 지면 ${RETRY_GRIND}번 더 수련하고 재도전한다(최대 ${MAX_ATTEMPTS}번). 정상 최종전 수련은 별빛 신전에서 한다.`);
  L.push('- 엔진은 게임과 같은 `js/engine.js`를 그대로 쓰고, 상대는 `chooseEnemyAction`(야생은 무작위, 관장은 점수 제곱 가중 무작위)을 쓴다.');
  L.push('');
  L.push('## 플레이어 정책 ("무난한 플레이")');
  L.push('');
  L.push('1. 체력이 35% 미만이고 회복기가 있으면 회복한다.');
  L.push('2. 지금 몬스터의 최선 기대 피해가 낮고(35점 미만), 체력이 절반 넘게 남은 동료가 2.2배 이상 유리하면 교체한다(상대 하나에 한 번).');
  L.push('3. 그 밖에는 `PEngine.estimate` 점수가 가장 높은 기술을 쓰고, 15% 확률로 두 번째 기술을 쓴다(사람의 실수).');
  L.push('4. 쓰러지면 상대에게 가장 유리한 동료를 내보낸다.');
  L.push('5. 관장에게 처음 지면, 보관함에서 그 관장 팀에 상성이 더 좋은 몬스터를 꺼내 상성이 가장 나쁜 파티원(스타터 포함)과 바꾸고, 그 몬스터를 앞세워 수련한다.');
  L.push('');
  L.push('## 관장별 첫 도전 승률');
  L.push('');
  L.push('| 관장 | 전체 | ' + D.STARTERS.map(name).join(' | ') + ' | 평균 시도 | 판정 |');
  L.push('|---|---:|' + D.STARTERS.map(() => '---:').join('|') + '|---:|---|');
  gymTable.forEach((g) => {
    const a = D.AREAS.find((x) => x.id === g.id);
    L.push(`| ${D.TRAINERS[a.gym.trainer].cls} ${D.TRAINERS[a.gym.trainer].name} (${a.name}) | ${pct(g.first)} | ` + D.STARTERS.map((s) => `${pct(g.perStarter[s].first)} (Lv${g.perStarter[s].lv.toFixed(1)})`).join(' | ') + ` | ${g.attempts.toFixed(2)} | ${g.ok ? '통과' : '실패'} |`);
  });
  L.push('');
  L.push('괄호 안은 첫 도전 때 파티 평균 레벨이다.');
  L.push('');
  L.push('## 스타터별 한 판');
  L.push('');
  L.push('| 스타터 | 클리어율 | 수련 배틀(평균) | 포획(평균) | 총 턴(평균) | 시간 초과 | 판정 |');
  L.push('|---|---:|---:|---:|---:|---:|---|');
  starterTable.forEach((s) => L.push(`| ${name(s.starter)} | ${pct(s.clear)} | ${s.wild.toFixed(0)} | ${s.caught.toFixed(1)} | ${s.turns.toFixed(0)} | ${s.timeouts} | ${s.ok ? '통과' : '실패'} |`));
  L.push('');
  L.push(`합격 기준: 관장마다 첫 도전 승률 ${pct(GATE.gymFirstTry[0])}~${pct(GATE.gymFirstTry[1])}, 스타터마다 클리어율 ${pct(GATE.clear)} 이상, 수련 배틀 평균 ${GATE.maxWildBattles}번 이하.`);
  L.push('');
  L.push(`종합: ${allOk ? '**통과**' : '**실패**'}`);
  L.push('');
  L.push('## 현재 조정값 (js/data.js TUNING)');
  L.push('');
  L.push(`- 경험치 배율 ${T.expMult}, 대기 몬스터 경험치 ${T.expShare}, 트레이너 ×${T.trainerExp}, 포캣볼 보정 ×${T.ballBonus}`);
  L.push(`- 급소 ${(T.critRate * 100).toFixed(2)}% / 고급소 ${(T.highCritRate * 100).toFixed(1)}% × ${T.critMult}, 보호막 ${T.screenTurns}턴 × ${T.screenMult}, 이로치 ${(T.shinyRate * 100).toFixed(0)}%`);
  L.push('');
  const out = path.join(__dirname, '..', 'docs', 'balance.md');
  fs.writeFileSync(out, L.join('\n'), 'utf8');
  console.log('wrote ' + path.relative(process.cwd(), out));
}

process.exitCode = allOk ? 0 : 1;
