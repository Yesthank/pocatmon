// 필드(오버월드) 렌더러 스크린샷 + 오류 게이트. 사용: node tools/field-shot.js [추가쿼리]
//   예) node tools/field-shot.js "theme=volcano"
// tools/field-test.html 을 휴대폰 크기(390×844)로 열어 데모를 끝까지 돌리고,
// 페이지가 내건 이름(window.__shot)마다 화면을 찍어 tools/out/field_<이름>.png 로 저장한 뒤 __ack 로 답한다.
// 테스트 페이지는 모든 Promise 가 제한 시간 안에 resolve 되는지 직접 검사해 어기면 console.error 를 남기므로,
// 콘솔 오류 0이 곧 "멈춤·reject 없음"을 뜻한다.
'use strict';
const path = require('path');
const fs = require('fs');
const { start } = require('./serve');
const { launch, phonePage } = require('./browser');

const extra = process.argv[2] || '';
const OUT = path.join(__dirname, 'out');
const THEMES = ['town', 'forest', 'coast', 'volcano', 'glacier', 'alley', 'temple', 'summit', 'ruins'];
const REQUIRED = extra ? [] : ['home', 'transition_mid'].concat(THEMES.map((t) => 'theme_' + t));
const T_DONE = 120000;
// 일부러 넣은 없는 그림(실루엣 대체 확인)의 404 는 허용한다
const OPTIONAL_404 = /\/assets\/mon\/__missing__\.webp$/;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await start(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await launch();
  const { ctx, page, errors } = await phonePage(browser);
  const missing = [];
  page.on('response', (r) => { if (r.status() === 404) missing.push(r.url().split('?')[0]); });
  const shots = [];
  let done = false;
  try {
    await page.goto(base + '/tools/field-test.html' + (extra ? '?' + extra : ''));
    const box = await page.evaluate(() => { const r = document.getElementById('field').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
    const t0 = Date.now();
    for (;;) {
      if (Date.now() - t0 > T_DONE) throw new Error('timeout waiting for __done');
      const st = await page.waitForFunction(() => {
        if (window.__shot && window.__shot !== window.__ack) return { shot: window.__shot };
        if (window.__done) return { done: true };
        return false;
      }, null, { timeout: T_DONE, polling: 30 }).then((h) => h.jsonValue());
      if (st.done) { done = true; break; }
      const name = st.shot;
      await page.screenshot({ path: path.join(OUT, 'field_' + name + '.png'), clip: box });
      shots.push(name);
      await page.evaluate((n) => { window.__ack = n; }, name);
    }
  } catch (e) {
    errors.push('runner: ' + String(e && e.message || e).split('\n')[0]);
    await page.screenshot({ path: path.join(OUT, 'field_fail.png') }).catch(() => {});
  }
  const failed = await page.evaluate(() => window.__failed || null).catch(() => null);
  const log = await page.evaluate(() => document.getElementById('log').textContent.trim()).catch(() => '');
  await ctx.close();
  await browser.close();
  server.close();
  const bad404 = missing.filter((u) => !OPTIONAL_404.test(u));
  const errs = errors.filter((e) => !/Failed to load resource: the server responded with a status of 404/.test(e))
    .concat(bad404.map((u) => 'missing asset: ' + u));
  const lacking = REQUIRED.filter((n) => shots.indexOf(n) < 0);
  const summary = { done, shots: shots.map((n) => 'tools/out/field_' + n + '.png'), lacking, failedPromises: failed, log, errors: errs };
  console.log(JSON.stringify(summary, null, 2));
  const ok = done && errs.length === 0 && lacking.length === 0 && Array.isArray(failed) && failed.length === 0;
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
