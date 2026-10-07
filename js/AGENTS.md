# js/: 게임 런타임

## 범위
이 모듈은 게임이 브라우저에서 실행되는 데 필요한 코드 전부를 맡는다. 구체적으로는 데이터(`data.js`), 순수 로직(`engine.js`), 맵·이벤트 데이터(`maps.js`), 필드 판정(`world.js`), 그림 경로(`sprites.js`), 효과음(`sfx.js`), 경기장 연출(`stage3d.js`), 필드 렌더러(`field.js`), 화면 흐름(`main.js`)을 다룬다.
그림·배경 원본 파일(`assets/`), 검증 도구(`tools/`), 테스트(`test/`), 서드파티 라이브러리(`vendor/`)는 이 모듈의 범위가 아니다. `vendor/three.min.js`는 수정하지 않는다.

## 경계
- `engine.js`·`data.js`·`maps.js`·`world.js`는 DOM, `window`, `document`, `localStorage`를 참조하지 않는다. Node `require`로도 돌아야 한다(파일 끝의 UMD 래퍼 유지).
- `engine.js`는 `stage3d.js`·`main.js`·`sfx.js`를 알지 못한다. 의존은 `main → stage3d / engine / data / sfx / sprites`, `stage3d → THREE / PData / Sprites`, `engine → PData` 방향뿐이다.
- `main.js`는 배틀 객체와 파티 몬스터의 HP·상태를 직접 바꾸지 않는다. `resolveTurn`/`forceSwitch`/`beginBattle` 이벤트를 재생해 화면만 갱신한다. 저장 데이터는 엔진 함수(`finishBattle`·`healParty`·`moveToBox` 등)로만 바꾼다. 예외는 배틀·컷신을 시작할 때 Stage 연출 상태(보호막·상태 색·공·오라)를 초기화하는 일 하나뿐이다.

## 불변식
- `resolveTurn`은 배틀이 끝났거나(`b.over`) 교체 대기 중(`b.needSwitch`)이면 빈 목록을 돌려주고 상태를 바꾸지 않는다. 할 수 없는 행동은 턴을 쓰지 않고 `msg` 하나만 돌려준다.
- 한 행동의 이벤트 순서: (행동 불가면 `status`(tick)/`flinch`로 끝) → `use` → (필살기면 `line`) → `hit`×N 또는 `miss`/`heal`/`screen`/`status` → 상대가 쓰러졌으면 `faint`, 아니면 부가효과(`status`/`stat`) → 자기 랭크 `stat` → 흡수 `heal` / 반동 `hit`(→ `faint`). 턴 끝에는 `residual`, 보호막 해제 `screen(on:false)`가 온다. 그다음 쓰러짐 처리로 `exp`/`levelUp`/`learn` → (최종전이면 `cutscene`) → 상대 `switchIn` → `needSwitch` 또는 `end`가 온다. `end`는 언제나 마지막 이벤트다.
- 교체·포캣볼·도망은 기술보다 먼저 처리한다. 경험치는 쓰러뜨린 그 상대와 마주한 몬스터(`participants`)에게 전부, 나머지 살아 있는 파티원에게 절반을 준다.
- `createStore`는 이번 방문에서 쓰거나 지운 값을 저장소 값보다 우선한다. 지운 값은 `mem[k] = null` 표식으로 남긴다.
- `Stage`의 모든 연출 메서드는 resolve만 하고 reject하지 않는다. 3D와 2D 구현은 같은 메서드 이름과 같은 Promise 의미를 가져야 한다. `main.js`는 새 메서드를 `stc(name, …)`로 부르므로, 메서드가 없는 무대에서도 멈추지 않는다.
- 모든 자산 경로는 상대 경로다. `sprites.js`는 자기 `<script src>`를 기준으로 `assets/mon/` 경로를 정하므로, `tools/` 하위 페이지에서도 같은 함수가 동작한다.

## 구현 패턴
- 한국어 조사는 `PEngine.josa(word, '은/는' | '이/가' | '을/를')`로 붙인다. 이름 끝 받침에 따라 바뀌므로("나루냥은" / "설냥이는") 문자열에 조사를 직접 쓰지 않는다.
- 난수는 `rng` 인자로 받는다. 화면은 URL에 `?seed=N`이 있으면 mulberry32를 쓴다.
- 새 기술 효과 종류를 추가할 때는 `useMove()`에 이벤트를 하나 추가하고, `main.js` 재생 분기와 Stage 연출을 함께 넣는다. 새 몬스터는 `MONSTERS`·`DEX`·`AREAS`·그림(`assets/mon/`)·`Sprites` 이로치 표를 함께 고친다.

## 테스트 지침
- 엔진 변경 → `test/engine.test.js`에 결정적 rng(`constant`, `seq`, `mulberry32`)로 경계 사례를 추가한다. 상태이상 면역·중복 금지, 늦게 행동한 쪽의 풀죽음 무효, 랭크 ±6 한계, 회복 상한, 교체 후 상대 공격 대상, 강제 교체의 턴 미소비, 쓰기 실패 저장소를 확인하는 사례는 반드시 계속 통과해야 한다.
- 수치(`data.js`) 변경 → `npm run sim`으로 관장별 승률·클리어율 게이트를 다시 확인한다.
- 화면·연출 변경 → `npm run smoke`로 콘솔 오류 0과 가로 넘침 0을 확인하고, `tools/out/smoke_*.png`를 눈으로 본다.

## 필드 불변식
- `PWorld.step`은 막힌 칸·문·거절된 워프에서 위치를 바꾸지 않는다. 수풀 조우는 들어선 뒤 `encounterGrace` 걸음 동안 없다.
- 트레이너 시야는 아직 이기지 않은 트레이너에게만 있고, 시야 사이에 막힌 칸·NPC가 있으면 끊긴다.
- `runScript`는 배틀에서 지거나(`canLose` 아님) 배틀을 그만두면 `'abort'`로 나머지 명령을 건너뛴다. 스크립트가 끝나면 엔티티(플래그로 숨는 NPC)와 HUD를 다시 그린다.
- 필드 입력은 `S.ow.busy`가 거짓이고 대화창이 닫혀 있을 때만 받는다. 모든 흐름은 `finally`에서 busy를 푼다.
