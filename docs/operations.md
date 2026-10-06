# 운영

## 준비 (처음 한 번)
전제: Node 22 이상, git, Playwright용 Chromium 설치본(`%LOCALAPPDATA%/ms-playwright/chromium-*`, 또는 `CHROME_PATH`).
```
cd files/games/pocatmon/battle
npm install            # playwright-core(브라우저 다운로드 없음)만 설치
```

## 실행
```
npm run serve          # http://127.0.0.1:8787/ — 3D는 반드시 http로 연다
```
URL 플래그: `?2d`(2D 강제), `?fast`(UI 지연 단축), `?seed=N`(난수 고정). 조합할 수 있다(`?2d&fast&seed=1`).

## 검증 (이 순서로, 셋 다 0이어야 배포한다)
```
npm test               # 엔진 테스트, 수 초
npm run sim            # 스타터 3종 × 80회 전체 진행 밸런스, 결과 문서 갱신(--no-write 로 생략, SIM_RUNS=N 으로 횟수 조정)
npm run smoke          # 헤드리스 3D + 2D 흐름, tools/out/*.png 스크린샷, 1~3분
```
보조 도구로는 `node tools/gallery-shot.js`와 `node tools/stage-shot.js`가 있다. `node tools/gallery-shot.js`는 캐릭터 그림 38장(일반 20장, 고양이 이로치 18장)을 로드해 확인하고, `node tools/stage-shot.js`는 경기장 3D/2D 연출을 확인한다.

## 배포
- 공개 저장소 `Yesthank/pocatmon`의 `main` 브랜치 루트를 GitHub Pages가 서빙한다(`https://yesthank.github.io/pocatmon/`).
- `git push origin main` 후 1~2분 안에 반영된다. 반영 여부는 주소가 HTTP 200을 돌려주고 `<title>`이 "포캣몬 배틀"인지 보고 확인한다.
- 루트에 있는 `.nojekyll` 파일 때문에 Pages 빌드는 Jekyll을 건너뛴다. 이 파일을 지우면 `_`로 시작하는 경로가 무시될 수 있다.
