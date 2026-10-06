// 스모크 테스트 — 로컬 서버 + 390×844 헤드리스 Chromium으로 화면 흐름을 끝까지 확인한다.
//   사용: node tools/smoke.js   (npm run smoke)
//   1) 3D 실행: 타이틀 → 선택 → 미리보기 → 배틀 → 자동 탭으로 1판 끝까지 → 결과/게임오버
//   2) ?2d 실행(메탈가디언몬): 타이틀 → 선택 → 미리보기 → 배틀
//   모든 화면에서 콘솔/페이지 오류 0, 가로 넘침 없음(scrollWidth <= clientWidth)을 확인한다.
'use strict';
const path = require('path');
const fs = require('fs');
const { start } = require('./serve');
const { launch, phonePage } = require('./browser');

const OUT = path.join(__dirname, 'out');
const BATTLE_TIMEOUT = 120000;

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

async function run(browser, base, opt) {
  const { ctx, page, errors } = await phonePage(browser);
  const tag = opt.force2d ? '_2d' : '';
  const res = { qs: opt.qs, screens: [], shots: [], overflow: [], mode: null, outcome: null, turns: 0, ok: false };
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
    await waitScreen(page, 'select');
    await sleep(500);
    await visit('select', 'smoke_select' + tag);

    await page.locator('[data-pick="' + (opt.pick || 'naru') + '"]').first().tap();
    await sleep(250);
    await page.locator('button', { hasText: '이 몬스터로 출발' }).first().tap();
    await waitScreen(page, 'preview');
    await sleep(600);
    await visit('preview', 'smoke_preview' + tag);

    await page.locator('button', { hasText: '배틀 시작' }).first().tap();
    await waitScreen(page, 'battle');
    await page.waitForSelector('.move-btn:not([disabled])', { timeout: 60000 });
    await sleep(400);
    res.mode = await page.evaluate(() => document.body.dataset.stageMode || null);
    await visit('battle', 'smoke_battle' + tag);

    if (opt.full) {
      const t0 = Date.now();
      let s = await screenOf(page);
      while (s !== 'result' && s !== 'gameover') {
        if (Date.now() - t0 > BATTLE_TIMEOUT) throw new Error('battle did not finish in ' + BATTLE_TIMEOUT + 'ms (screen ' + s + ')');
        const btn = page.locator('.move-btn:not([disabled])').first();
        if (await btn.count()) {
          await btn.tap().catch(() => {});
          res.turns++;
        } else {
          await page.locator('#msgbox').tap({ timeout: 2000 }).catch(() => {});
        }
        await sleep(150);
        s = await screenOf(page);
      }
      await sleep(900);
      res.outcome = s;
      await visit(s, 'smoke_' + s + tag);
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
    r3 = await run(browser, base, { qs: 'fast&seed=1', full: true });
    // 2D 경로는 메탈가디언몬으로 — 상성 표시(효과 굉장/별로)·선공·필살 표시까지 화면에 나오게
    r2 = await run(browser, base, { qs: '2d&fast&seed=1', force2d: true, pick: 'metal' });
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
  if (r3.ok && ['result', 'gameover'].indexOf(r3.outcome) < 0) fails.push('3d: battle outcome screen not reached');
  if (r2.ok && r2.mode !== '2d') fails.push('2d: stage mode is ' + r2.mode + ' (expected 2d)');
  const summary = { pass: fails.length === 0, fails, run3d: r3, run2d: r2 };
  console.log(JSON.stringify(summary, null, 2));
  if (r3.mode && r3.mode !== '3d') console.log('NOTE: 기본 실행이 3d 모드가 아님 (WebGL 사용 불가로 2D 대체되었을 수 있음)');
  process.exit(summary.pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
