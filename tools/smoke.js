// 스모크 테스트 — 로컬 서버 + 390×844 헤드리스 Chromium으로 화면 흐름을 끝까지 확인한다.
//   사용: node tools/smoke.js   (npm run smoke)
//   1) 3D 실행: 타이틀 → 스타터 → 지역 → 야생 배틀(자동 진행) → 결과 → 계속 탐색(약하게 만든 뒤 포획 시도) → 결과
//              → 파티 → 도감 → 지도 → 새로고침 후 이어하기 → (Lv.60 파티 저장) 정상 최종전 → 흑화 컷신 → 엔딩
//   2) ?2d 실행: 타이틀 → 스타터 → 지역 → 야생 배틀 → 싸운다(기술 패널) → 포캣몬(교체 목록) 화면
//   모든 화면에서 콘솔/페이지 오류 0, 가로 넘침 없음(scrollWidth <= clientWidth)을 확인한다.
'use strict';
const path = require('path');
const fs = require('fs');
const { start } = require('./serve');
const { launch, phonePage } = require('./browser');

const OUT = path.join(__dirname, 'out');
const BATTLE_TIMEOUT = 150000;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function screenOf(page) {
  return page.evaluate(() => document.body.dataset.screen || '');
}
async function waitScreen(page, names, timeout) {
  const list = [].concat(names);
  await page.waitForFunction((l) => l.indexOf(document.body.dataset.screen) >= 0, list, { timeout: timeout || 20000 });
  return screenOf(page);
}
async function overflow(page) {
  return page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
}

// 배틀을 끝까지 자동 진행한다. catchMode면 상대 체력이 절반 아래일 때 포캣볼을 던진다.
async function autoBattle(page, res, catchMode) {
  const t0 = Date.now();
  let s = await screenOf(page);
  while (s !== 'result' && s !== 'ending') {
    if (Date.now() - t0 > BATTLE_TIMEOUT) throw new Error('battle did not finish in ' + BATTLE_TIMEOUT + 'ms (screen ' + s + ')');
    if (s === 'cutscene') { await sleep(200); s = await screenOf(page); continue; }   // 컷신은 건너뛰지 않고 끝까지 본다
    const st = await page.evaluate(() => {
      const S = window.__pocatmon.state, b = S.b;
      if (!b) return null;
      const e = b.e.party[b.e.active];
      return { mode: S.mode, locked: S.locked, eRatio: e.hp / window.PEngine.maxHp(e) };
    });
    if (st && !st.locked) {
      if (st.mode === 'root') {
        const useBall = catchMode && st.eRatio < 0.5;
        await page.locator('[data-cmd="' + (useBall ? 'ball' : 'fight') + '"]').first().tap().catch(() => {});
        if (useBall) res.balls++;
      } else if (st.mode === 'fight') {
        // 포획 모드에서는 가장 약한 기술(첫 칸)로 깎는다
        await page.locator('.moves [data-slot]:not([disabled])').first().tap().catch(() => {});
        res.turns++;
      } else if (st.mode === 'forced' || st.mode === 'party') {
        await page.locator('.pick-row:not([disabled])').first().tap().catch(() => {});
      }
    } else {
      await page.locator('#msgbox').tap({ timeout: 2000 }).catch(() => {});
    }
    await sleep(120);
    s = await screenOf(page);
  }
  await sleep(700);
  return s;
}

async function run(browser, base, opt) {
  const { ctx, page, errors } = await phonePage(browser);
  const tag = opt.force2d ? '_2d' : '';
  const res = { qs: opt.qs, screens: [], shots: [], overflow: [], mode: null, outcomes: [], turns: 0, balls: 0, ok: false };
  async function visit(name, shotName) {
    const s = await screenOf(page);
    const o = await overflow(page);
    res.screens.push(s);
    if (o.sw > o.cw) res.overflow.push(s + ' ' + o.sw + '>' + o.cw);
    if (shotName) {
      const file = path.join(OUT, shotName + '.png');
      await page.screenshot({ path: file });
      res.shots.push(path.basename(file));
    }
    if (s !== name) throw new Error('expected screen ' + name + ' but got ' + s);
  }
  try {
    await page.goto(base + '/index.html?' + opt.qs);
    await waitScreen(page, 'title');
    await sleep(700);
    await visit('title', 'smoke_title' + tag);

    await page.locator('button', { hasText: '새로 시작' }).first().tap();
    await waitScreen(page, 'starter');
    await sleep(500);
    await page.locator('[data-pick="' + (opt.pick || 'naru') + '"]').first().tap();
    await sleep(300);
    await visit('starter', 'smoke_starter' + tag);
    await page.locator('button', { hasText: '이 친구와 출발' }).first().tap();
    await waitScreen(page, 'area');
    await sleep(600);
    await visit('area', 'smoke_area' + tag);

    await page.locator('[data-act="explore"]').first().tap();
    await waitScreen(page, 'battle');
    await page.waitForSelector('.moves [data-cmd]:not([disabled])', { timeout: 60000 });
    await sleep(400);
    res.mode = await page.evaluate(() => document.body.dataset.stageMode || null);
    await visit('battle', 'smoke_battle' + tag);

    if (opt.full) {
      let s = await autoBattle(page, res, false);
      res.outcomes.push(await page.evaluate(() => window.__pocatmon.state.b && window.__pocatmon.state.b.result));
      await visit(s, 'smoke_result' + tag);
      // 계속 탐색 → 포획 시도
      await page.locator('[data-act="again"]').first().tap();
      await waitScreen(page, 'battle');
      s = await autoBattle(page, res, true);
      res.outcomes.push(await page.evaluate(() => window.__pocatmon.state.b && window.__pocatmon.state.b.result));
      await visit(s, 'smoke_result2' + tag);
      await page.locator('.overlay [data-act]').last().tap();
      await waitScreen(page, ['area', 'party']);
      await page.locator('[data-act="tab-party"]').first().tap();
      await waitScreen(page, 'party');
      await sleep(500);
      await visit('party', 'smoke_party' + tag);
      await page.locator('[data-act="tab-dex"]').first().tap();
      await waitScreen(page, 'dex');
      await sleep(400);
      await visit('dex', 'smoke_dex' + tag);
      await page.locator('[data-act="tab-map"]').first().tap();
      await waitScreen(page, 'map');
      await sleep(500);
      await visit('map', 'smoke_map' + tag);
      // 저장이 남아 있어 새로고침 후 이어하기가 보인다
      await page.reload();
      await waitScreen(page, 'title');
      const cont = await page.locator('button', { hasText: '이어하기' }).count();
      if (!cont) throw new Error('continue button missing after reload');

      // 최종전 경로: 배지 6개 + Lv.60 파티 저장을 심고 정상 → 흑화 컷신 → 엔딩까지
      await page.evaluate(() => {
        const E = window.PEngine, D = window.PData;
        const save = E.newGame('naru', Math.random);
        save.party = [];
        ['punch', 'sand', 'flare'].forEach((id) => E.addCaught(save, E.createMon(id, 60, Math.random, { iv: 31, shiny: false })));
        save.badges = D.AREAS.filter((a) => a.gym && !a.final).map((a) => a.id);
        window.__pocatmon.store.save(save);
      });
      await page.reload();
      await waitScreen(page, 'title');
      await page.locator('button', { hasText: '이어하기' }).first().tap();
      await waitScreen(page, 'map');
      await page.locator('[data-area="summit"]').first().tap();
      await waitScreen(page, 'area');
      await page.locator('[data-act="gym"]').first().tap();
      await waitScreen(page, 'battle');
      let sawCut = false;
      page.waitForFunction(() => document.body.dataset.screen === 'cutscene', null, { timeout: BATTLE_TIMEOUT })
        .then(async () => { sawCut = true; await sleep(1200); await page.screenshot({ path: path.join(OUT, 'smoke_cutscene.png') }).catch(() => {}); }).catch(() => {});
      s = await autoBattle(page, res, false);
      res.outcomes.push(await page.evaluate(() => window.__pocatmon.state.b && window.__pocatmon.state.b.result));
      if (!sawCut) throw new Error('final battle did not show the cutscene');
      await visit('ending', 'smoke_ending' + tag);
      const opened = await page.evaluate(() => window.PEngine.areaOpen(window.__pocatmon.store.load(), 'ruins'));
      if (!opened) throw new Error('ruins not opened after final win');
    } else {
      await page.locator('[data-cmd="fight"]').first().tap();
      await page.waitForSelector('.moves [data-slot]:not([disabled])', { timeout: 10000 });
      await sleep(300);
      await visit('battle', 'smoke_moves' + tag);
      await page.locator('#cmd-back').tap();
      await page.waitForSelector('.moves [data-cmd]:not([disabled])', { timeout: 10000 });
      await page.locator('[data-cmd="party"]').first().tap();
      await page.waitForSelector('.pick-list', { timeout: 10000 });
      await sleep(300);
      await visit('battle', 'smoke_switch' + tag);
    }
    res.ok = true;
  } catch (e) {
    res.error = String(e && e.message || e).split('\n')[0];
    await page.screenshot({ path: path.join(OUT, 'smoke_fail' + tag + '.png') }).catch(() => {});
  }
  res.errors = errors.slice();
  await ctx.close();
  return res;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await start(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await launch();
  let r3, r2;
  try {
    r3 = await run(browser, base, { qs: 'fast&seed=1', full: true, pick: 'seol' });
    r2 = await run(browser, base, { qs: '2d&fast&seed=2', force2d: true, pick: 'ssaga' });
  } finally {
    await browser.close();
    server.close();
  }
  const fails = [];
  [['3d', r3], ['2d', r2]].forEach(([k, r]) => {
    if (!r.ok) fails.push(k + ': ' + (r.error || 'flow failed'));
    if (r.errors.length) fails.push(k + ': ' + r.errors.length + ' console/page errors');
    if (r.overflow.length) fails.push(k + ': horizontal overflow on ' + r.overflow.join(', '));
  });
  if (r3.ok && r3.outcomes.length !== 3) fails.push('3d: battles did not all finish');
  if (r2.ok && r2.mode !== '2d') fails.push('2d: stage mode is ' + r2.mode + ' (expected 2d)');
  const summary = { pass: fails.length === 0, fails, run3d: r3, run2d: r2 };
  console.log(JSON.stringify(summary, null, 2));
  if (r3.mode && r3.mode !== '3d') console.log('NOTE: 기본 실행이 3d 모드가 아님 (WebGL 사용 불가로 2D 대체되었을 수 있음)');
  process.exit(summary.pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
