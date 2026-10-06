# 아키텍처

## 구성
빌드 단계가 없는 정적 웹 게임이다. `index.html`이 일반 `<script>` 7개를 아래 순서로 읽고, 각 스크립트는 전역 객체 하나를 노출한다. 순서가 곧 의존 방향이며, 뒤 스크립트만 앞 스크립트를 참조한다.

| 순서 | 파일 | 전역 | 역할 | 의존 |
|---|---|---|---|---|
| 1 | `vendor/three.min.js` | `THREE` | 3D 렌더링(r128 UMD) | 없음 |
| 2 | `js/data.js` | `PData` | 몬스터·기술·상성·대사·컷신 대본·조정값 | 없음 |
| 3 | `js/engine.js` | `PEngine` | 배틀·런·저장 순수 로직(DOM 없음) | PData |
| 4 | `js/sprites.js` | `Sprites` | 캐릭터 그림 경로(`assets/mon/*.webp`) | 없음 |
| 5 | `js/sfx.js` | `Sfx` | Web Audio 합성 효과음 | 없음 |
| 6 | `js/stage3d.js` | `Stage` | 경기장 연출(3D, 실패 시 2D DOM) | THREE, PData, Sprites |
| 7 | `js/main.js` | 없음 | 화면 전환·UI·이벤트 재생·컷신·저장 연결 | 위 전부 |

`data.js`와 `engine.js`는 UMD 형식이므로 Node에서도 `require`로 불러올 수 있다. 테스트와 밸런스 시뮬레이션은 이 두 파일만 쓴다.

## 대표 흐름: 기술 버튼 한 번
1. `main.js`가 버튼 탭을 받으면 입력을 잠그고 `PEngine.chooseEnemyMove(battle)`로 상대 기술을 고른다.
2. `PEngine.resolveTurn(battle, 내 기술, 상대 기술, rng)`가 배틀 상태를 바꾸고 **이벤트 목록**(`use / hit / miss / heal / stat / shield / freeze / thaw / flinch / faint / line / msg / end`)을 돌려준다.
3. `main.js`가 이벤트를 순서대로 재생한다. 메시지는 타자기 효과로 출력하고, 연출은 `Stage`가 제공하는 Promise 메서드(`attack → hit → faint` 등)로 재생한다. HP 바는 이벤트에 담긴 `hp` 값에 맞추고, 효과음은 `Sfx.play`로 낸다. 대사는 `stage.screenPos(side)` 위치에 말풍선으로 띄운다.
4. `end` 이벤트가 나오면 승패를 판정한다. 승리하면 `PEngine.winBattle(run)`을 거쳐 결과 카드나 엔딩으로 넘어가고, 패배하면 저장된 런을 지우고 게임 오버 화면으로 간다. 그 밖의 경우에는 입력 잠금을 푼다.

엔진은 화면을 모른다. 화면은 엔진 상태를 직접 바꾸지 않고 이벤트만 재생한다.

## 경기장(Stage) 경계
- `Stage.create(el, {force2d})`는 WebGL 컨텍스트 생성이 실패하거나 `THREE`가 없으면 같은 메서드를 가진 2D(DOM/CSS) 구현을 돌려준다. `?2d` URL 플래그는 2D를 강제한다.
- 모든 연출 메서드는 Promise를 돌려주고 절대 reject하지 않는다. 일시정지 중이거나 대상이 없어도 resolve한다.
- 배경은 `assets/bg/{sea,ice,alley,metal,dark}.jpg`를 원통 안쪽에 입힌다. 캐릭터는 세워 놓은 판이며, webp를 1024px 캔버스로 옮겨 만든 텍스처를 입힌다. 플레이어는 카메라 쪽 왼쪽 아래에서 좌우 반전되어 서고, 상대는 오른쪽 위 뒤쪽에 선다.

## 외부 의존
외부 의존은 없다. 실행 중 네트워크 요청은 같은 출처의 정적 파일뿐이다(CDN·웹폰트·API 없음). 배포는 GitHub Pages(`main` 브랜치 루트, 하위 경로 `/pocatmon/`)이므로 모든 경로는 상대 경로다.
