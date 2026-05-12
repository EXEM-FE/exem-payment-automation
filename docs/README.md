# Exem 경비 자동화 — 설계·구현 문서

엑셈 FE1팀이 매월 작성하는 법인카드 경비 신청서를 자동화하는 PWA 웹앱.
1차 MVP가 동작하는 상태이고, 본 문서는 그 설계와 구현 사실을 함께 기록한다.

## 한 줄 요약

> **그때그때 모바일에서 입력 → 월말 PC에서 명세서와 매칭 → 완성된 .xlsx 다운로드**.
> 백엔드는 둘을 잇는 메모리 우체국. 카드 정보는 절대 서버를 거치지 않는다.

## 진행 상태

✅ 1차 MVP 동작 (저널, PIN 발급, 명세서 매칭, ExcelJS 다운로드, PWA, 룰 엔진, 검증 게이트).
오프라인 시작·다른 디바이스 동기화·.xlsx 사진 anchor·식음료 4지선다·이름 토글 칩까지 포함.

## 문서 구성

| 문서 | 내용 |
|---|---|
| [01-vision.md](./01-vision.md) | 해결할 문제, 페르소나, 가치 제안, 비목표 |
| [02-flow.md](./02-flow.md) | 사용자 흐름 다이어그램, 시나리오 |
| [03-architecture.md](./03-architecture.md) | 데이터 분리 원칙, 컴포넌트 구조, 기술 스택 |
| [04-screens.md](./04-screens.md) | 화면별 와이어프레임 (모바일/PC) |
| [05-backend-api.md](./05-backend-api.md) | API 명세, 서버 메모리 모델 |
| [06-security.md](./06-security.md) | 보안·프라이버시 가드레일 |
| [07-excel-mapping.md](./07-excel-mapping.md) | 엑셀 템플릿 셀 매핑 명세 |
| [08-rule-engine.md](./08-rule-engine.md) | 룰 엔진 JSON 구조, 계정 추천·검증 룰 |
| [09-roadmap.md](./09-roadmap.md) | 1차 MVP 결과, 2·3차 확장 |
| [10-references.md](./10-references.md) | 참고 문서·실 데이터 카탈로그 |
| [11-document-based-improvements.md](./11-document-based-improvements.md) | 공식 PDF와 현재 앱의 개선 후보 대조 |

## 한눈에 보는 핵심 결정

- **출력 포맷**: `.xlsx` (ExcelJS로 4 시트 + 8 슬롯 사진 anchor)
- **인증**: 부서 + 이름 + 일회용 4자리 PIN (1h TTL)
- **백엔드**: Bun + Hono, 메모리 `Map<userKey, Slot>` 단 하나, ~200줄
- **데이터 수명**: 서버 24h TTL + pull 즉시 PIN 폐기 + 다운로드 후 즉시 삭제
- **민감 데이터**: 카드번호·사업자번호·승인번호는 **서버 경유 X**. PC 브라우저 메모리에서만 명세서를 다룸
- **트리거**: 자동 동기화 X. 모바일 사용자가 "PC로 보내기" 1회 명시적 누름
- **디바이스 분기**: `pointer: coarse` 또는 폭 < 920px이면 모바일 저널, 그 외엔 PC 정산 (수동 토글 없음)
- **멤버 입력**: FE1팀 9명을 코드 상수(`TEAM_MEMBERS`)로 두고 토글 칩으로 선택. 자주 쓰는 묶음/자동완성/빈도 누적은 1차에서 미사용
- **인프라**: Vercel 공개 배포 + HTTPS

## 모노레포 구조

```
exem-payment-automation/
├── apps/
│   ├── web/        # PWA (저널 + PC 정산 콘솔)
│   └── hub/        # Bun + Hono 백엔드
├── packages/
│   └── shared/     # 공통 타입 + sanitizer + 룰 헬퍼 + rules.json
├── api/            # Vercel Hono API 엔트리
├── rules/
│   └── 2026-current.json  # 룰 엔진 원본 (PR 단위 갱신)
├── docs/
└── vercel.json
```

## 실행

### 로컬 운영 (단일 프로세스)
```sh
pnpm build       # apps/web/dist + manifest + sw 생성
pnpm start       # Bun 서버가 정적 + /api 모두 :4174로 서빙
```

### 개발 (두 프로세스)
```sh
pnpm dev:hub     # 터미널 A — Bun 백엔드 :4174
pnpm dev:web     # 터미널 B — Vite :5173 (/api → :4174 프록시)
```

### Vercel 배포
```sh
pnpm build
vercel build --prod
vercel deploy --prebuilt --prod
```

## 시연 시나리오 (5분)

1. 모바일에서 접속 → 온보딩에서 부서·이름 입력
2. ＋ FAB → 사진 추가(여러 장) → 가게 입력하면 식음료 4지선다 노출
3. 9명 토글 칩에서 함께한 사람 선택
4. 카드 탭하면 편집 모달 그대로
5. "PC로 보내기" → PIN 4자리 발급
6. 데스크톱 접속 → PIN 입력 → 명세서 .xls 업로드 → 매칭 검토
7. 다운로드 → `(카드)제경비신청서_M월_부서_이름.xlsx`
8. 다운로드 후 서버 데이터 자동 삭제 → 완료 화면
