# contents controller

Damtix의 SNS 콘텐츠(인스타그램 3개 계정 + 자사몰)를 브랜드 기준에 맞게 만들고 검수하는 **내 Mac용 프로그램**이에요.
Claude 데스크톱 앱과 연결해서, Claude가 항상 같은 브랜드·제품 기준으로 작업하게 해요.

지금은 **1단계**예요: 브랜드 기준 관리, 문구 검사, Claude 연결. 캘린더·레퍼런스·이미지·영상·HTML은 다음 단계에서 열려요.

## 처음 설치 (한 번만)

1. **Node.js 설치**: https://nodejs.org/ko/download 에서 LTS 버전을 내려받아 설치해요.
2. **프로그램 내려받기**: GitHub에서 이 저장소를 내려받아요. (GitHub Desktop 앱으로 Clone 하면 나중에 업데이트가 쉬워요.)
3. **실행**: 폴더 안의 `start.command`를 더블클릭해요.
   - 처음에 "확인되지 않은 개발자" 경고가 나오면: 파일을 **오른쪽 클릭 → 열기 → 열기**.
   - 처음 실행 때 필요한 파일을 1분 정도 내려받아요.
   - 브라우저에 http://localhost:4321 이 열리면 성공이에요.
4. **Claude 연결**: `connect-claude.command`를 더블클릭한 뒤, Claude 앱을 **완전히 종료(⌘Q)했다가 다시 열어요**.
   Claude에게 "contents controller 브랜드 기준 보여줘"라고 말해 보세요.

## 매일 쓰는 법

- `start.command`를 더블클릭하면 켜져요. 터미널 창을 닫으면 꺼져요.
- **폰에서 열기**: Mac과 같은 Wi-Fi에서, 홈 화면에 나오는 주소를 폰 브라우저로 열고 6자리 접속 코드를 넣어요.
- Mac이 꺼져 있거나 잠자기 상태면 폰에서도 열리지 않아요.

## 브랜드 기준

- **브랜드 전체**: 슬로건·포지셔닝, 계정별 톤, 금지 표현, 비주얼 기준
- **제품별(SKU)**: 시장별 제품명, 판매 시장, 핵심 성분·사용법·제품별 규칙, 기준 이미지, 등록 정보·전성분
- 고칠 때는 [수정] → 바뀐 내용 확인 → 이유 적고 저장. 저장할 때마다 버전이 오르고 **변경 이력**에 남아요. 언제든 이전 상태로 되돌릴 수 있어요.
- Claude가 기준을 바꾸자고 하면 **업데이트 제안**에 올라와요. 직접 [반영]해야 적용돼요.
- 처음 기준은 「DAMTIX B2B Product Introduction (Final v2) – 2026.10」 매뉴얼로 만들었어요.

## 기준 이미지 폴더

바탕화면의 `이미지정리` 폴더를 써요 (홈 화면에서 경로를 바꿀 수 있어요). 제품 기준 이미지는 이렇게 넣어요:

```text
이미지정리/
└─ 01_제품/
   ├─ GTCP_PDRN세럼/
   │   ├─ packshot/   정면·측면·뚜껑 연 컷
   │   ├─ texture/    제형 클로즈업
   │   └─ usage/      사용 장면
   └─ ... (DSS, GTCN, GTCR, P7XL, VLE, VLER, HGB)
```

폴더 이름은 **제품 코드로 시작**해야 해요. Claude는 제품 이미지를 만들 때 이 사진들을 항상 참조해요.

## Claude가 쓰는 기능 (MCP)

| 기능 | 하는 일 |
|---|---|
| `get_brand_guide` | 브랜드 기준 읽기 (계정별 톤·금지 표현) |
| `list_products`, `get_product` | 제품 기준과 기준 이미지 경로 읽기 |
| `check_text` | 문구 검사: 금지 표현, 판매하지 않는 시장, 일본 판매명 누락 |
| `propose_brand_update` | 기준 변경 제안 (승인해야 반영) |
| `get_change_history` | 변경 이력 보기 |

## 데이터와 백업

- 모든 데이터는 프로그램 폴더 안의 `data/`에 저장돼요. 이 폴더만 백업하면 돼요.
- `data/`는 GitHub에 올라가지 않아요. 프로그램을 업데이트해도 데이터는 그대로예요.

## 업데이트

GitHub Desktop에서 **Fetch → Pull** 하고 `start.command`를 다시 실행해요.

## 개발자용

```bash
npm install
npm start        # 화면 서버 (http://localhost:4321)
npm run mcp      # Claude 연결 창구 (보통 Claude 앱이 직접 실행)
npm test         # 기준 규칙 테스트
```

화면 디자인 기준은 [DESIGN.md](DESIGN.md)를 따라요.
