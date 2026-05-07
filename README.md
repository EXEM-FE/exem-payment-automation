# Exem Payment Automation

FE1팀 법인카드 경비 신청을 빠르게 정리하기 위한 PWA입니다.
모바일에서는 영수증과 사용 메모를 저널처럼 모으고, PC에서는 카드 명세서와 매칭해 다우오피스 제출용 `.xlsx` 파일을 만듭니다.

## 핵심 흐름

1. 모바일 PWA에서 부서와 이름을 등록합니다.
2. 결제 직후 영수증 사진, 금액, 가게, 참가자, 업무 내용을 저장합니다.
3. 월말에 모바일에서 `PC로 보내기`를 눌러 4자리 PIN을 발급받습니다.
4. PC에서 같은 앱에 접속해 PIN으로 저널을 가져옵니다.
5. 현대카드 명세서 `.xls`를 브라우저에 업로드하고 자동 매칭 결과를 검토합니다.
6. 최종 `.xlsx`를 다운로드하면 서버에 임시 보관된 저널 데이터가 삭제됩니다.

## 데이터 원칙

- 카드번호, 사업자번호, 승인번호, 최종 엑셀 파일은 서버로 보내지 않습니다.
- 서버는 모바일 저널과 영수증 사진만 임시 보관합니다.
- PIN은 1회용이며 1시간 뒤 만료됩니다.
- 서버 슬롯은 24시간 뒤 만료되고, PC 다운로드 완료 시 즉시 삭제됩니다.
- 모바일 IndexedDB 데이터는 사용자가 직접 초기화하기 전까지 남습니다.

## 프로젝트 구조

```text
exem-payment-automation/
├── apps/
│   ├── web/        # Vite + React PWA
│   └── hub/        # Hono API + 로컬 Bun 정적 서버
├── packages/
│   └── shared/     # 공통 타입, sanitizer, 룰 엔진
├── rules/          # 회계 룰 원본 JSON
├── docs/           # 상세 설계 문서
├── api/            # Vercel Hono API 엔트리
└── vercel.json     # Vercel 배포 설정
```

## 개발

```sh
pnpm install --frozen-lockfile
pnpm dev:hub
pnpm dev:web
```

개발 중에는 Vite가 `/api` 요청을 `http://localhost:4174`로 프록시합니다.
웹 화면은 `http://localhost:5173`, 로컬 허브는 `http://localhost:4174`에서 실행됩니다.

## 로컬 운영 모드

```sh
pnpm build
pnpm start
```

`pnpm start`는 Bun 기반 허브가 `apps/web/dist` 정적 파일과 `/api/*`를 한 포트에서 함께 서빙합니다.

## Vercel 배포

이 저장소는 루트 디렉터리 기준으로 배포합니다.

- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm build`
- Output Directory: `apps/web/dist`
- API Entry: `api/index.ts`
- Function Region: `icn1`

배포 전 검증:

```sh
pnpm build
vercel build --prod
```

프로덕션 배포:

```sh
vercel deploy --prebuilt --prod
```

## 문서

상세 배경과 설계는 [docs/README.md](./docs/README.md)에서 시작합니다.
