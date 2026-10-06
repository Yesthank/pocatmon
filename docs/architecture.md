# 아키텍처

## 구성
빌드 단계가 없는 정적 웹 게임이다. `index.html`이 일반 `<script>` 7개를 아래 순서로 읽고, 각 스크립트는 전역 객체 하나를 노출한다. 순서가 곧 의존 방향이며, 뒤 스크립트만 앞 스크립트를 참조한다.

| 순서 | 파일 | 전역 | 역할 | 의존 |
|---|---|---|---|---|
| 1 | `vendor/three.min.js` | `THREE` | 3D 렌더링(r128 UMD) | 없음 |
| 2 | `js/data.js` | `PData` | 18타입 상성·상태이상·기술·몬스터 20종·지역·컷신 대본·조정값 | 없음 |
| 3 | `js/engine.js` | `PEngine` | 배틀·포획·성장·진행·저장 순수 로직(DOM 없음) | PData |
| 4 | `js/sprites.js` | `Sprites` | 캐릭터 그림 경로(`assets/mon/*.webp`) | 없음 |
| 5 | `js/sfx.js` | `Sfx` | Web Audio 합성 효과음 | 없음 |
| 6 | `js/stage3d.js` | `Stage` | 경기장 연출(3D, 실패 시 2D DOM) | THREE, PData, Sprites |
| 7 | `js/main.js` | 없음 | 화면 전환·UI·이벤트 재생·컷신·저장 연결 | 위 전부 |

`data.js`와 `engine.js`는 UMD 형식이므로 Node에서도 `require`로 불러올 수 있다. 테스트와 밸런스 시뮬레이션은 이 두 파일만 쓴다.

## 화면 흐름
타이틀 → (새로 시작) 스타터 선택 → 지역 화면 ⇄ 지도 · 파티/보관함 · 도감(아래 탭 바) → 배틀(야생 또는 관장) → 결과 카드 → 지역/지도. 최종전에서 이기면 엔딩으로 간다. `document.body.dataset.screen`은 `title | starter | map | area | party | dex | battle | cutscene | result | ending` 중 하나다.

저장 데이터(`S.save`)는 화면이 들고 있다. 새 게임, 배틀 종료, 센터 회복, 파티 정리 때마다 `store.save`로 기록한다. 배틀 중에는 엔진이 파티 몬스터 객체(HP·PP·경험치)를 직접 바꾸므로, '배틀 그만두기'를 누르면 `store.load()`로 마지막 저장을 다시 읽어 되돌린다.

## 대표 흐름: 행동 한 번
1. 명령 패널(싸운다 · 포캣몬 · 포캣볼 · 도망)에서 행동을 고르면 `main.js`가 입력을 잠그고 `PEngine.chooseEnemyAction(battle, rng)`로 상대 행동을 고른다.
2. `PEngine.resolveTurn(battle, 내 행동, 상대 행동, rng)`가 배틀 상태를 바꾸고 **이벤트 목록**을 돌려준다. 이벤트 종류는 `switchIn / switchOut / use / line / hit / miss / heal / stat / status / cure / flinch / screen / residual / faint / ball / run / exp / levelUp / learn / cutscene / needSwitch / msg / end`이다. 할 수 없는 행동(트레이너전 도망, PP 0 기술 등)은 턴을 쓰지 않고 `msg` 하나만 돌려준다.
3. `main.js`가 이벤트를 순서대로 재생한다. 메시지는 타자기 효과로 출력하고, 연출은 `Stage`의 Promise 메서드로 재생한다. HP·EXP 바와 상태 표시는 이벤트 값(`hp`, `maxHp`, `amount`, `kind` …)에 맞춰 갱신한다.
4. 재생이 끝나면 다음 셋 중 하나로 간다. `battle.over`면 `PEngine.finishBattle(save, battle)`로 배지·포획·전멸 회복을 반영하고 저장한 뒤 결과 카드를 띄운다. `battle.needSwitch`면 교체 목록을 띄우고, 고르면 `PEngine.forceSwitch`의 이벤트를 재생한다(턴 미소비). 그 밖에는 다시 명령 패널을 연다.
5. 배틀 시작 연출은 `PEngine.beginBattle(battle)`이 돌려주는 이벤트(관장 대사 → 상대 등장 → 내 몬스터 등장)를 같은 방식으로 재생한다. 최종전에서 메탈가디언몬이 쓰러지면 엔진이 `cutscene` 이벤트를 내고, 화면은 흑화 컷신(`transform`)을 재생한 뒤 블랙의 `switchIn`을 이어서 재생한다.

엔진은 화면을 모른다. 화면은 엔진 상태를 직접 바꾸지 않고 이벤트만 재생한다.

## 경기장(Stage) 경계
- `Stage.create(el, {force2d})`는 WebGL 컨텍스트 생성이 실패하거나 `THREE`가 없으면 같은 메서드를 가진 2D(DOM/CSS) 구현을 돌려준다. `?2d` URL 플래그는 2D를 강제한다.
- 모든 연출 메서드는 Promise를 돌려주고 절대 reject하지 않는다. 일시정지 중이거나 대상이 없어도 resolve한다.
- 연출 메서드: `setBackground · setFighter · clearFighter · enter · attack(side, 타입) · hit(side, {crit, eff, fx}) · miss · heal · shield · freeze · statFx · faint · aura · transform · shadowRise · focus · flash · recall · throwBall(흔들림 0~3, 잡힘) · clearBall · status(side, brn|psn|tox|par|slp|frz|thaw|cnf) · statusTint(side, 상태|null)`. 18타입 id 목록은 `Stage.FX_TYPES`다.
- `setFighter`·`recall`은 얼음·오라·보호막·상태 색을 지운다. 그래서 화면은 교체로 새 몬스터가 나오면 `statusTint`와(보호막이 남아 있으면) `shield`를 다시 건다. `setFighter('enemy')`·`clearFighter('enemy')`는 남은 포캣볼도 치운다. 그림이 없는 id에는 회색 '?' 실루엣이 선다.
- 배경은 `assets/bg/{forest,sea,volcano,ice,alley,temple,metal,dark}.jpg`를 원통 안쪽에 입힌다. 캐릭터는 세워 놓은 판이며, webp를 1024px 캔버스로 옮겨 만든 텍스처를 입힌다. 플레이어는 카메라 쪽 왼쪽 아래에서 좌우 반전되어 서고, 상대는 오른쪽 위 뒤쪽에 선다.

## 외부 의존
외부 의존은 없다. 실행 중 네트워크 요청은 같은 출처의 정적 파일뿐이다(CDN·웹폰트·API 없음). 배포는 GitHub Pages(`main` 브랜치 루트, 하위 경로 `/pocatmon/`)이므로 모든 경로는 상대 경로다.
