// 헤드리스 Chromium 런처 — 이미 설치된 Playwright Chromium을 재사용(추가 다운로드 없음)
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const cands = [];
  if (fs.existsSync(base)) {
    for (const d of fs.readdirSync(base).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
      cands.push(path.join(base, d, 'chrome-win64', 'chrome.exe'), path.join(base, d, 'chrome-win', 'chrome.exe'),
        path.join(base, d, 'chrome-linux', 'chrome'));
    }
  }
  const hit = cands.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('Chromium을 찾지 못했습니다. CHROME_PATH 환경변수로 지정하세요.');
  return hit;
}

async function launch() {
  return chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  });
}

// 휴대폰 세로 컨텍스트(390×844, 터치)
async function phonePage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, page, errors };
}

module.exports = { launch, phonePage, findChrome };
