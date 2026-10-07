# 외부 계약

외부 API는 없다. 외부에 대해 지켜야 하는 약속은 **이미 플레이한 사람의 브라우저에 남아 있는 저장값**과 **공개 주소** 두 가지다.

## 브라우저 저장소 키 (localStorage)
| 키 | 값 | 쓰는 때 | 지우는 때 |
|---|---|---|---|
| `pocatmon.save` | JSON 저장 데이터(아래, `v: 3`) | 새 게임, 맵 이동, 배틀 종료, 대화 행동, 센터·상점·도구, 8걸음마다 | 새로 시작 |
| `pocatmon.muted` | `"1"` / `"0"` | 음소거 토글 | 지우지 않음 |
| `pocatmon.run`, `pocatmon.unlocked.black` | v1(4연전) 기록 | 더 이상 쓰지 않음 | 새 저장 시 `pocatmon.run`을 지움. 읽지 않으므로 남아 있어도 무해 |

저장 데이터 형식(`v: 3`):
```json
{ "v": 3, "starter": "naru", "nextUid": 4, "area": "forest", "badges": ["forest"], "cleared": false,
  "dex": { "seen": { "naru": 1, "cheese": 1 }, "caught": { "naru": 1, "cheese": 1 } },
  "party": [ { "uid": 1, "id": "naru2", "lv": 17, "exp": 4913, "iv": { "hp": 20, "atk": 3, "def": 31, "spa": 17, "spd": 9, "spe": 25 },
               "hp": 38, "status": null, "slp": 0, "moves": [ { "id": "watergun", "pp": 24 } ], "shiny": false } ],
  "box": [],
  "money": 2840, "bag": { "ball": 7, "snack": 2 }, "flags": { "intro": 1, "item:forest_snack": 1 }, "beaten": { "rival_1": 1 },
  "visited": { "home": 1, "forest": 1 }, "repel": 0,
  "pos": { "map": "forest", "x": 10, "y": 20, "dir": "up" }, "respawn": { "map": "forest", "x": 6, "y": 12, "dir": "down" } }
```
- `party`는 1~3마리, `box`는 개수 제한이 없다. 몬스터 `id`는 `PData.MONSTERS`의 키(진화형은 `<기본형>2`)이고, 기술 `id`는 `PData.MOVES`의 키다(발버둥 제외).
- `status`는 `null | brn | psn | tox | par | slp | frz` 중 하나다. `hp`는 0 이상 최대 HP 이하, `pp`는 0 이상 그 기술의 최대 PP 이하다.
- `bag`의 키는 `PData.ITEMS`의 키, 값은 0 이상 정수다. `flags`는 이벤트·부탁·주운 도구(`item:<id>`) 표식이고, `beaten`은 이긴 트레이너 id다. `visited`는 들른 맵(날아가기 목록)이다.
- `pos`·`respawn`은 `null` 또는 `{ map, x, y, dir }`이다. `map`은 `PMaps.MAPS`의 키다. 맵 글자를 고쳐 그 칸이 막히면, 화면은 그 칸이 아닌 센터 앞으로 보내야 한다(지금은 맵 id만 검사한다).
- `PEngine.isValidSave`가 위 조건을 모두 검사한다. 통과하지 못한 기록은 오류 없이 무시된다(새 게임처럼 보인다).
- **v2(메뉴형, 2026-10-06 배포) 저장은 불러올 때 v3로 옮긴다**(`PEngine.migrateSave`). 파티·보관함·도감·배지·클리어는 그대로 두고, 돈(1,000 + 배지당 600)·가방(시작 도구 2배)·플래그(`got_starter`, `intro` — 시작 마을 인트로를 다시 보지 않게)·이긴 관장과 첫 라이벌 기록을 채운다. 위치는 비워 두므로 시작 마을 센터 앞에서 다시 시작한다.
- 형식을 바꾸면 `v`를 올리고 `isValidSave`와 `migrateSave`를 함께 고친다. 몬스터·기술·도구·맵 id를 지우거나 이름을 바꾸면 기존 저장이 무효가 되므로, id는 바꾸지 않는다.

## 공개 주소
- `https://yesthank.github.io/pocatmon/`: `index.html` 하나가 진입점이다. `?2d`는 2D 화면을 강제하고, `?fast`는 UI 지연을 줄이며(자동 점검용), `?seed=N`은 난수를 고정한다.
- 자동 점검용으로 `window.__pocatmon`(화면 상태 `state`, 저장소 `store`, 필드 조작 `walk(dir) / pressA() / enterMap(id, x, y, dir)`)을 노출한다. 조작 함수는 실행만 시키고 바로 돌아온다. 게임 동작은 이 창구에 의존하지 않는다.
