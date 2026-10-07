// 스모크 테스트 — 로컬 서버 + 390×844 헤드리스 Chromium으로 화면 흐름을 끝까지 확인한다.
//   사용: node tools/smoke.js   (npm run smoke)
//   1) 3D 실행: 타이틀 → 스타터 → 필드(시작 마을 대화 → 라이벌 배틀 → 선물) → 걷기 → 풀숲 수풀 조우(약하게 만든 뒤 포획 시도)
//              → 센터 회복 → 상점 구매 → 메뉴(가방·파티·도감·지도) → (Lv.60 파티 저장) 정상 수호자 → 흑화 컷신 → 엔딩
//              → 새로고침 후 이어하기로 필드 복귀
//   2) ?2d 실행: 타이틀 → 스타터 → 필드 → 라이벌 배틀의 기술 패널·가방 패널
//   모든 화면에서 콘솔/페이지 오류 0, 가로 넘침 없음(scrollWidth <= clientWidth)을 확인한다.
'use strict';
const path = require('path');
const fs = require('fs');
const { start } = require('./serve');
const { launch, phonePage } = require('./browser');

const OUT = path.join(__dirname, 'out');
const BATTLE_TIMEOUT = 150000;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function screenOf(page) { return page.evaluate(() => document.body.dataset.screen || ''); }
async function waitScreen(page, names, timeout) {
  const list = [].concat(names);
  await page.waitForFunction((l) => l.indexOf(document.body.dataset.screen) >= 0, list, { timeout: timeout || 20000 });
  return screenOf(page);
}
async function overflow(page) { return page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })); }
// 필드가 조용해질 때까지(이동·대화 끝) 또는 다른 화면으로 넘어갈 때까지 기다린다
async function settle(page, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 15000)) {
    const st = await page.evaluate(() => ({ s: document.body.dataset.screen, busy: window.__pocatmon.state.ow.busy, msg: document.getElementById('fmsg').classList.contains('on') }));
    if (st.s !== 'field' || st.msg || !st.busy) return st.s;
    await sleep(60);
  }
  return screenOf(page);
}
async function msgOn(page) { return page.evaluate(() => document.getElementById('fmsg').classList.contains('on')); }

// 필드 대화를 모두 넘긴다. 선택지가 나오면 첫 번째(예)를 고른다. 배틀이 열리면 멈춘다.
async function talkThrough(page, maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (maxMs || 20000)) {
    const s = await screenOf(page);
    if (s !== 'field') return s;
    if (await page.locator('#fchoice .fopt').count()) { await page.locator('#fchoice .fopt').first().click(); await sleep(150); continue; }
    if (await msgOn(page)) { await page.locator('#fmsg').click().catch(() => {}); await sleep(120); continue; }
    const busy = await page.evaluate(() => window.__pocatmon.state.ow.busy);
    if (!busy) return 'field';
    await sleep(120);
  }
  return screenOf(page);
}

// 배틀을 끝까지 자동 진행한다. catchMode면 상대 체력이 절반 아래일 때 가방에서 볼을 던진다.
async function autoBattle(page, res, catchMode) {
  const t0 = Date.now();
  let s = await screenOf(page);
  while (s === 'battle' || s === 'cutscene') {
    if (Date.now() - t0 > BATTLE_TIMEOUT) throw new Error('battle did not finish (screen ' + s + ')');
    if (s === 'cutscene') { res.sawCutscene = true; await sleep(200); s = await screenOf(page); continue; }
    const st = await page.evaluate(() => {
      const S = window.__pocatmon.state, b = S.b;
      if (!b) return null;
      const e = b.e.party[b.e.active];
      return { mode: S.mode, locked: S.locked, eRatio: e.hp / window.PEngine.maxHp(e), wild: b.kind === 'wild' };
    });
    if (st && !st.locked) {
      if (st.mode === 'root') {
        const useBall = catchMode && st.wild && st.eRatio < 0.5;
        await page.locator('[data-cmd="' + (useBall ? 'bag' : 'fight') + '"]').first().tap().catch(() => {});
      } else if (st.mode === 'bag') {
        const ball = page.locator('.moves [data-item$="ball"]:not([disabled])').first();
        if (await ball.count()) { await ball.tap().catch(() => {}); res.balls++; } else await page.locator('#cmd-back').tap().catch(() => {});
      } else if (st.mode === 'fight') {
        await page.locator('.moves [data-slot]:not([disabled])').first().tap().catch(() => {});
        res.turns++;
      } else if (st.mode === 'forced' || st.mode === 'party' || st.mode === 'itemTarget') {
        await page.locator('.pick-row:not([disabled])').first().tap().catch(() => {});
      }
    } else {
      await page.locator('#msgbox').tap({ timeout: 2000 }).catch(() => {});
    }
    await sleep(120);
    s = await screenOf(page);
  }
  return s;
}
// 결과 카드(·진화)를 닫고 필드로 돌아올 때까지
async function closeResult(page, res) {
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > 30000) throw new Error('result did not close (screen ' + await screenOf(page) + ')');
    const s = await screenOf(page);
    if (s === 'field') return s;
    if (s === 'result') { await page.locator('.overlay [data-act="continue"]').click().catch(() => {}); }
    else if (s === 'evolve') {
      res.evolved = true;
      await page.waitForSelector('#evo-ok:not([disabled])', { timeout: 15000 });
      await page.locator('#evo-ok').click();
    } else if (s === 'ending') { await page.locator('[data-act="end-continue"]').click().catch(() => {}); }
    await sleep(200);
  }
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
  const api = async (fn, ...args) => { await page.evaluate(([f, a]) => window.__pocatmon[f](...a), [fn, args]); await sleep(30); return settle(page); };
  try {
    await page.goto(base + '/index.html?' + opt.qs);
    await waitScreen(page, 'title');
    await sleep(600);
    await visit('title', 'smoke_title' + tag);
    await page.locator('button', { hasText: '새로 시작' }).first().tap();
    await waitScreen(page, 'starter');
    await page.locator('[data-pick="' + (opt.pick || 'naru') + '"]').first().tap();
    await sleep(300);
    await page.locator('button', { hasText: '이 친구와 출발' }).first().tap();
    await waitScreen(page, 'field');
    await page.waitForFunction(() => document.getElementById('fmsg').classList.contains('on'), null, { timeout: 15000 });
    await sleep(300);
    res.fieldMode = await page.evaluate(() => document.body.dataset.fieldMode || null);
    await visit('field', 'smoke_field_intro' + tag);
    // 인트로 대화 → 라이벌 배틀
    let s = await talkThrough(page);
    if (s !== 'battle') throw new Error('rival battle did not start (screen ' + s + ')');
    await page.waitForSelector('.moves [data-cmd]:not([disabled])', { timeout: 60000 });
    res.mode = await page.evaluate(() => document.body.dataset.stageMode || null);
    await visit('battle', 'smoke_battle' + tag);

    if (!opt.full) {
      await page.locator('[data-cmd="fight"]').first().tap();
      await page.waitForSelector('.moves [data-slot]:not([disabled])', { timeout: 10000 });
      await visit('battle', 'smoke_moves' + tag);
      await page.locator('#cmd-back').tap();
      await page.waitForSelector('.moves [data-cmd]:not([disabled])', { timeout: 10000 });
      await page.locator('[data-cmd="bag"]').first().tap();
      await page.waitForSelector('.moves .bag-list', { timeout: 10000 });
      await sleep(250);
      await visit('battle', 'smoke_bag' + tag);
      res.ok = true;
    } else {
      s = await autoBattle(page, res, false);
      res.outcomes.push(await page.evaluate(() => window.__pocatmon.state.b && window.__pocatmon.state.b.result));
      await closeResult(page, res);
      s = await talkThrough(page);
      if (s !== 'field') throw new Error('after intro expected field, got ' + s);
      const ballsAfterIntro = await page.evaluate(() => window.__pocatmon.state.save.bag.ball || 0);
      if (ballsAfterIntro < 10) throw new Error('professor gift missing (balls ' + ballsAfterIntro + ')');
      // 걷기 (십자 패드 대신 자동화 창구)
      for (const d of ['up', 'up', 'right', 'right']) await api('walk', d);
      await sleep(200);
      await visit('field', 'smoke_field_home' + tag);
      // 풀숲 수풀에서 조우 → 포획 시도
      await api('enterMap', 'forest', 4, 26, 'right');
      await sleep(400);
      await visit('field', 'smoke_field_forest' + tag);
      let enc = false;
      for (let i = 0; i < 120 && !enc; i++) {
        await api('walk', i % 2 ? 'left' : 'right');
        enc = (await screenOf(page)) === 'battle';
      }
      if (!enc) throw new Error('no wild encounter in 120 grass steps');
      s = await autoBattle(page, res, true);
      res.outcomes.push(await page.evaluate(() => window.__pocatmon.state.b && window.__pocatmon.state.b.result));
      await closeResult(page, res);
      await talkThrough(page);
      // 센터 (풀숲 센터 문 앞에서 위를 보고 A)
      await api('enterMap', 'forest', 6, 12, 'up');
      await api('pressA');
      await talkThrough(page);
      const healed = await page.evaluate(() => window.__pocatmon.state.save.party.every((m) => m.hp === window.PEngine.maxHp(m)));
      if (!healed) throw new Error('center did not heal');
      // 상점 (문 앞에서 A → 대화 → 시트에서 1개 구매 → 나가기)
      await api('enterMap', 'forest', 17, 6, 'up');
      const money0 = await page.evaluate(() => window.__pocatmon.state.save.money);
      await api('pressA');
      await page.waitForFunction(() => document.getElementById('fmsg').classList.contains('on'), null, { timeout: 10000 });
      await page.locator('#fmsg').click();
      await page.waitForSelector('#sheet.on [data-buy="ball"][data-n="1"]', { timeout: 10000 });
      await sleep(250);
      await visit('field', 'smoke_shop' + tag);
      await page.locator('#sheet [data-buy="ball"][data-n="1"]').click();
      await page.locator('#sheet [data-close]').click();
      await talkThrough(page);
      const money1 = await page.evaluate(() => window.__pocatmon.state.save.money);
      if (money1 !== money0 - 200) throw new Error('shop purchase failed ' + money0 + '→' + money1);
      // 메뉴 → 가방·파티·도감·지도
      await page.locator('#btn-menu').click();
      await page.locator('[data-act="m-bag"]').click();
      await waitScreen(page, 'bag'); await sleep(300);
      await visit('bag', 'smoke_bag_screen' + tag);
      await page.locator('[data-act="tab-party"]').first().click();
      await waitScreen(page, 'party'); await sleep(300);
      await visit('party', 'smoke_party' + tag);
      await page.locator('[data-act="tab-dex"]').first().click();
      await waitScreen(page, 'dex'); await sleep(300);
      await visit('dex', 'smoke_dex' + tag);
      await page.locator('[data-act="tab-map"]').first().click();
      await waitScreen(page, 'map'); await sleep(300);
      await visit('map', 'smoke_map' + tag);
      await page.locator('[data-act="tab-field"]').first().click();
      await waitScreen(page, 'field');

      // 최종전: Lv.60 파티와 배지 6개를 심고 정상 수호자에게
      await page.evaluate(() => {
        const E = window.PEngine, D = window.PData, S = window.__pocatmon.state;
        S.save.party = [];
        ['punch2', 'sand2', 'flare2'].forEach((id) => E.addCaught(S.save, E.createMon(id, 60, Math.random, { iv: 31, shiny: false })));
        S.save.badges = D.AREAS.filter((a) => a.gym && !a.final).map((a) => a.id);
        window.__pocatmon.store.save(S.save);
      });
      await api('enterMap', 'summit', 10, 3, 'up');
      await sleep(300);
      await visit('field', 'smoke_field_summit' + tag);
      await api('pressA');
      s = await talkThrough(page, 30000);
      if (s !== 'battle') throw new Error('final battle did not start (' + s + ')');
      page.waitForFunction(() => document.body.dataset.screen === 'cutscene', null, { timeout: BATTLE_TIMEOUT })
        .then(async () => { await sleep(1200); await page.screenshot({ path: path.join(OUT, 'smoke_cutscene.png') }).catch(() => {}); }).catch(() => {});
      s = await autoBattle(page, res, false);
      res.outcomes.push(await page.evaluate(() => window.__pocatmon.state.b && window.__pocatmon.state.b.result));
      if (!res.sawCutscene) throw new Error('final battle did not show the cutscene');
      await waitScreen(page, 'ending', 15000);
      await sleep(500);
      await visit('ending', 'smoke_ending' + tag);
      await closeResult(page, res);
      await talkThrough(page);
      const cleared = await page.evaluate(() => window.__pocatmon.store.load().cleared);
      if (!cleared) throw new Error('not cleared after final win');
      // 새로고침 → 이어하기 → 필드
      await page.reload();
      await waitScreen(page, 'title');
      await page.locator('button', { hasText: '이어하기' }).first().tap();
      await waitScreen(page, 'field');
      await sleep(500);
      await visit('field', 'smoke_field_continue' + tag);
      res.ok = true;
    }
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
