// 캐릭터 갤러리 스크린샷 + 로드 검증. 사용: node tools/gallery-shot.js
'use strict';
const path = require('path');
const fs = require('fs');
const { start } = require('./serve');
const { launch } = require('./browser');

const EXPECTED = 38;

(async () => {
  const server = await start(0);
  const url = 'http://127.0.0.1:' + server.address().port + '/tools/gallery.html';
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1352, height: 690 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  // 기본 20장 + 이로치 18장(고양이 18종) = 38장
  await page.waitForFunction((n) => window.loaded + window.failed.length >= n, EXPECTED, { timeout: 20000 });
  const res = await page.evaluate(() => ({
    loaded: window.loaded, failed: window.failed, expected: window.expected,
    widths: Array.from(document.images).map((i) => i.naturalWidth)
  }));
  const out = path.join(__dirname, 'out');
  fs.mkdirSync(out, { recursive: true });
  await page.screenshot({ path: path.join(out, 'gallery.png'), fullPage: true });
  await browser.close();
  server.close();
  console.log(JSON.stringify({ ...res, errors }));
  const ok = res.loaded === EXPECTED && res.expected === EXPECTED && res.widths.length === EXPECTED && res.failed.length === 0 && res.widths.every((w) => w === 768) && errors.length === 0;
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
