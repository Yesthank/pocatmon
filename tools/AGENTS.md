# tools/ — 검증·확인 도구

## 범위
로컬 서버(`serve.js`), 헤드리스 브라우저 런처(`browser.js`), 흐름 스모크(`smoke.js`), 밸런스 시뮬레이션(`sim.js`), 연출·그림 확인 페이지와 스크립트(`stage-test.html`, `stage-shot.js`, `gallery.html`, `gallery-shot.js`)를 둔다.
게임 런타임 코드는 이 모듈의 범위가 아니다. 도구가 실패했다고 `js/`의 게임 동작을 도구에 맞춰 바꾸지 않는다. 먼저 도구가 맞는지 확인한다.

## 경계
- 결과물(스크린샷)은 `tools/out/`에만 쓴다. 이 폴더는 커밋하지 않는다.
- 도구는 실행 중에 외부 네트워크를 쓰지 않는다. 브라우저는 설치된 Playwright Chromium을 `playwright-core`로 띄우며 새로 받지 않는다.
- `sim.js`는 `docs/balance.md`를 덮어쓴다. 그 파일을 손으로 고치지 않는다.

## 불변식
- 각 스크립트는 판정이 실제로 평가된 경우에만 종료 코드 0을 낸다. 페이지가 안 뜨거나 기다리던 화면에 도달하지 못하면 1이다.
- 스모크는 휴대폰 크기(390×844, 터치)에서 3D 경로와 `?2d` 경로를 모두 돌린다. 화면 전환은 `document.body.dataset.screen` 값(`title | select | preview | battle | cutscene | result | ending | gameover`)으로 감지한다.
- 시뮬레이션은 고정 시드를 써서 결과가 매번 같다.

## 사용 패턴
- 3D 확인이 필요한 페이지는 반드시 `serve.js`의 http 주소로 연다. `file://`에서는 WebGL 텍스처가 막혀 2D로 바뀐다.
- 헤드리스 WebGL은 `browser.js`의 SwiftShader 플래그로만 켜진다. 다른 런처를 쓰면 3D 경로가 조용히 2D로 바뀌어 검증이 빈다.
