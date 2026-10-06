# 외부 계약

외부 API는 없다. 외부에 대해 지켜야 하는 약속은 **이미 플레이한 사람의 브라우저에 남아 있는 저장값**과 **공개 주소** 두 가지다.

## 브라우저 저장소 키 (localStorage)
| 키 | 값 | 쓰는 때 | 지우는 때 |
|---|---|---|---|
| `pocatmon.unlocked.black` | `"1"` | 최종 보스 첫 클리어 | 지우지 않음 |
| `pocatmon.run` | JSON 런 기록(아래) | 각 배틀 시작(최종 판은 컷신 전) | 새로 시작 · 패배 · 클리어 |
| `pocatmon.muted` | `"1"` / `"0"` | 음소거 토글 | 지우지 않음 |

런 기록 형식(`v: 1`):
```json
{ "v": 1, "starter": "naru", "order": ["ssaga", "seol", "metal", "black"],
  "shiny": [false, true, false, false], "stage": 2, "level": 7, "cutscene": "corrupt" }
```
- `starter`·`order`의 원소는 `naru | seol | ssaga | metal | black` 중 하나다. `order`와 `shiny`는 길이가 4다. `stage`는 0~3, `cutscene`은 `corrupt | shadow | face` 중 하나다.
- 형식을 바꾸면 `v`를 올린다. 올리지 않은 채 필드 의미를 바꾸면, 기존 플레이어의 이어하기가 잘못된 판을 불러온다. 검증에 실패한 기록은 오류 없이 무시된다.

## 공개 주소
- `https://yesthank.github.io/pocatmon/`: `index.html` 하나가 진입점이다. `?2d`는 2D 화면을 강제하고, `?fast`는 UI 지연을 줄이며(자동 점검용), `?seed=N`은 난수를 고정한다.
