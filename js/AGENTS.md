# js/ — 게임 런타임

## 범위
이 모듈은 게임이 브라우저에서 돌아가는 데 필요한 코드 전부를 맡는다. 데이터(`data.js`), 순수 로직(`engine.js`), 그림 경로(`sprites.js`), 효과음(`sfx.js`), 경기장 연출(`stage3d.js`), 화면 흐름(`main.js`)이다.
그림·배경 원본 파일(`assets/`), 검증 도구(`tools/`), 테스트(`test/`), 서드파티 라이브러리(`vendor/`)는 이 모듈의 범위가 아니다. `vendor/three.min.js`는 수정하지 않는다.

## 경계
- `engine.js`·`data.js`는 DOM, `window`, `document`, `localStorage`를 참조하지 않는다. Node `require`로도 돌아야 한다(파일 끝의 UMD 래퍼 유지).
- `engine.js`는 `stage3d.js`·`main.js`·`sfx.js`를 알지 못한다. 의존은 `main → stage3d / engine / data / sfx / sprites`, `stage3d → THREE / PData / Sprites`, `engine → PData` 방향뿐이다.
- `main.js`는 배틀 객체(`battle.p`, `battle.e`)의 HP·상태를 직접 바꾸지 않는다. `resolveTurn` 이벤트를 재생해 화면만 갱신한다. 예외는 하나다. 배틀·컷신을 시작할 때 Stage 연출 상태(보호막·얼음·오라)를 초기화하는 일이다.

## 불변식
- `resolveTurn`은 배틀이 끝난 뒤(`b.over`)에는 빈 목록을 돌려주고 상태를 바꾸지 않는다.
- 한 행동의 이벤트 순서: `use` → (필살기면 `line`) → `hit`×N 또는 `miss`/`heal`/`shield` → 상대가 쓰러졌으면 `faint`, 아니면 부가효과(`stat`/`freeze`) → 반동 `hit`(→ 반동 `faint`). 턴 끝에는 보호막 해제 `shield(on:false)`, 승패가 났으면 쓰러진 쪽 대사 `line` → `end`가 온다. `end`는 언제나 턴의 마지막 이벤트다.
- 반동 동시 쓰러짐은 먼저 쓰러진 쪽이 진다. `act()`는 상대 기절을 반동보다 먼저 확인한다.
- `createStore`는 이번 방문에서 쓰거나 지운 값을 저장소 값보다 우선한다. 지운 값은 `mem[k] = null` 표식으로 남긴다.
- `Stage`의 모든 연출 메서드는 resolve만 하고 reject하지 않는다. 3D와 2D 구현은 같은 메서드 이름과 같은 Promise 의미를 가져야 한다.
- 모든 자산 경로는 상대 경로다. `sprites.js`는 자기 `<script src>`를 기준으로 `assets/mon/` 경로를 정하므로, `tools/` 하위 페이지에서도 같은 함수가 동작한다.

## 구현 패턴
- 한국어 조사는 `PEngine.josa(word, '은/는' | '이/가' | '을/를')`로 붙인다. 이름 끝 받침에 따라 바뀌므로("나루냥은" / "설냥이는") 문자열에 조사를 직접 쓰지 않는다.
- 난수는 `rng` 인자로 받는다. 화면은 `?seed=N`이면 mulberry32를 쓴다.
- 새 기술 효과 종류를 추가할 때는 `act()`에 이벤트를 하나 추가하고, `main.js` 재생 분기와 Stage 연출을 함께 넣는다.

## 테스트 지침
- 엔진 변경 → `test/engine.test.js`에 결정적 rng(`constant`, `seq`, `mulberry32`)로 경계 사례를 추가한다. 얼림 중복 금지, 늦게 행동한 쪽의 풀죽음 무효, 단계 ±3 한계, 회복 상한, 반동 동시 기절, 쓰기 실패 저장소는 반드시 깨지지 않아야 한다.
- 수치(`data.js`) 변경 → `npm run sim`으로 클리어율 35~95%를 다시 확인한다.
- 화면·연출 변경 → `npm run smoke`로 콘솔 오류 0과 가로 넘침 0을 확인하고, `tools/out/smoke_*.png`를 눈으로 본다.
