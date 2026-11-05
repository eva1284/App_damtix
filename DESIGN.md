---
version: alpha
name: contents-controller-design
description: syncshot DESIGN.md(Apple 디자인 언어 번역본)의 규칙을 그대로 따르고, 포인트 색만 담틱스 브랜드에 맞춰 무채색으로 바꾼 Damtix의 contents controller 화면 기준.

colors:
  # 포인트 색은 하나. syncshot의 주황을 없애고 잉크(무채색)로 교체.
  primary: "#1d1d1f"          # 채운 버튼, 선택 표시, 포커스 링 (라이트)
  primary-on-dark: "#ffffff"  # 다크 모드의 포인트
  ink: "#1d1d1f"
  body-muted: "#5f5f66"
  ink-muted-48: "#8e8e93"     # 힌트, 비활성
  canvas: "#ffffff"           # 카드
  canvas-parchment: "#f5f5f7" # 페이지 배경
  fill: "#f2f2f4"             # 카드 안의 채움 영역
  surface-dark-1: "#1c1c1e"   # 다크 모드 카드
  surface-dark-2: "#2c2c2e"
  surface-black: "#000000"    # 다크 모드 페이지 배경
  hairline: "rgba(0, 0, 0, .08)"
  hairline-on-dark: "rgba(255, 255, 255, .14)"
  # 의미 색 (포인트 색과 별개, 장식 금지)
  green: "#1F7A36 / 다크 #30D158"   # 완료·성공
  red: "#D70015 / 다크 #FF6961"     # 규칙 위반·판매 불가·삭제 (막힘)
  yellow: "#8F5F00 글자 + rgba(255,204,0,.20) 바탕 / 다크 #FFD60A"  # 주의·승인 필요 (막히지는 않음)

typography:
  font: "system-ui, -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Pretendard', 'Noto Sans KR', sans-serif"
  mono: "ui-monospace, 'SF Mono', Menlo (작업물 번호, 시간, 파일 경로에만)"
  large-title: { size: 34px, weight: 600, line-height: 1.15, letter-spacing: -0.374px }  # 화면 제목 (폰 28px)
  headline: { size: 21px, weight: 600 }                                                   # 작업 상세 제목
  body-strong: { size: 17px, weight: 600 }                                                # 카드 제목
  body: { size: 17px, weight: 400, line-height: 1.47, letter-spacing: -0.374px }
  caption: { size: 14px, weight: 400, line-height: 1.43, letter-spacing: -0.224px }      # 목록, 표, 보조 설명
  fine-print: { size: 12px }                                                              # 칩, 번호. 12px 미만 금지

rounded: { sm: 8px, md: 11px, lg: 18px, sheet: 20px, pill: 9999px }
spacing: { unit: 8px, tokens: "4 · 8 · 12 · 16 · 24 · 32 · 48", card-padding: "24px (폰 16px)" }
elevation: "그림자·그라디언트 없음. 구분은 배경색 차이와 1px 헤어라인. 폰 상단 막대만 반투명 흐림."
---

# contents controller 디자인 기준

담틱스는 **무채색이 매력인 브랜드**다. 화면도 블랙·화이트·그레이로만 만들고, 색은 꼭 필요한 의미(완료=초록, 위반=빨강, 주의=노랑)에만 쓴다. 규칙은 syncshot `DESIGN.md`를 그대로 따르고, 아래 번역 표만 다르다.

## 번역 표 (syncshot → Damtix)
| syncshot | Damtix |
|---|---|
| 브랜드 주황 포인트 `#D93F00` / `#FF4C00` | **잉크** `#1d1d1f` (다크 `#ffffff`). 주황·초록 강조색은 모두 제거 |
| 주황 알약 주요 버튼 | **검정 알약**(흰 글자): 승인, 최종 컨펌, Claude에게 맡기기 |
| 주황 테두리 보조 알약 | **검정 1px 테두리 알약**: 수정 요청 등 보조 행동 |
| 보조 중립 버튼 (8px) | `fill` 배경 8px 버튼: 삭제, 이동, 복사, 해제 |
| 선택 칩 2px 주황 테두리 | **2px 잉크 테두리** (필터, 선택된 시안, 선택된 작업물) |
| 명함 썸네일 | 작업물 썸네일(이미지·영상·HTML), 8px 모서리 |

## 상태 표시 (색 대신 모양)
| 상태 | 표시 |
|---|---|
| 내 차례 (컨펌·검수) | 검정 채운 칩, 흰 글자. 가장 눈에 띄게 |
| Claude 차례 | 회색 1px 테두리 칩 |
| 기획 | 점선 테두리 칩 |
| 완료 | 초록 옅은 바탕 칩 (의미 색) |
| 규칙 위반·판매 불가 | 빨강 옅은 바탕 칩, 빨간 경고 상자 (의미 색) |
| 주의·승인 필요 | 노랑 옅은 바탕 칩, 노란 주의 상자 (의미 색). 예: 브랜드 기준 업데이트 제안, 저장하면 작업물이 막히는 변경 |

진행 단계 표시줄: 지난 단계는 초록 글자, 지금 내 차례는 검정 채움, 지금 Claude 차례는 점선 테두리.

## 규칙 (syncshot 그대로)
1. 포인트 색은 하나(잉크). 장식에 쓰지 않는다. 두 번째 포인트 색 금지.
2. 본문 17px/400, 제목 600. 굵기는 300/400/600만. 12px 미만 글자 금지.
3. 그림자와 그라디언트를 쓰지 않는다. (작업물 미리보기 그림 자체는 콘텐츠라 예외)
4. 모서리는 8 / 11 / 18 / 20 / 알약만.
5. 모든 버튼은 누르는 순간 `transform: scale(.95)`(120ms). hover 전용 효과 없음.
6. 여백은 8px 배수. 카드 사이 16px, 섹션 사이 24~32px.
7. 터치 영역 44×44px 이상, 글자 대비 4.5:1 이상, 포커스 링 2px 잉크.
8. 폰 상단 막대는 반투명 흐림(`parchment 80%` + `blur(20px) saturate(180%)`), 메뉴는 햄버거 버튼으로 펼침.
9. 다크 모드: 배경 `#000`, 카드 `#1c1c1e`/`#2c2c2e`, 글자 흰색, 헤어라인 `rgba(255,255,255,.14)`, 포인트 흰색.
10. 폰(375px)에서도 모든 화면이 가로 스크롤 없이 보여야 한다. 넓은 표·캘린더만 자체 가로 스크롤 허용.

## 앱 이름과 로고
- 앱 이름은 **contents controller** (소문자 그대로). 브라우저 탭 제목, 메뉴 상단, Claude에게 하는 말("contents controller 대기 작업 처리해줘")에 모두 같은 이름을 쓴다.
- 로고 파일: `assets/damtix-logo.svg` (담틱스 워드마크, 단색 `#1e1c1b`, 비율 약 4.95:1). 원본 그대로 쓰고 수정·재작성하지 않는다.
- 넣는 방식: `<img src="assets/damtix-logo.svg" alt="DAMTIX" class="brand-logo">`. 높이만 지정하고 너비는 자동. 늘이기·그림자·테두리 금지.
- 자리: 메뉴 상단에 로고(높이 20px), 바로 아래 앱 이름 "contents controller"(12px, 보조 글자색). 로고 둘레에는 로고 높이의 절반 이상 여백.
- 다크 모드: 검정 로고가 보이지 않으므로 지금은 CSS `filter: invert(1)`로 흰색으로 보여 준다. 흰색 로고 파일(`damtix-logo-white.svg`)을 받으면 그 파일로 바꾼다.

## 하지 말 것
- 포인트 색 추가(주황·파랑 등), 의미 색(초록·빨강·노랑)을 장식으로 쓰기, 카드·버튼 그림자, 굵기 500/700.
- 12px 미만 글자, 44px 미만 터치 영역, 대비 부족.
