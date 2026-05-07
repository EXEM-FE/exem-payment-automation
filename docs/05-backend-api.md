# 05. 백엔드 API / 메모리 모델

## 설계 철학

> **"잠깐 머무는 우체국"**.
> 사용자별 슬롯 1개, TTL 24h, PIN 1회용·1h.
> 재시작해도 OK. 영구 저장 X.

## 메모리 모델

```ts
// apps/hub/src/store.ts

type UserKey = string  // `${dept}::${name}`

type Photo = {
  id: string             // uuid
  mime: 'image/jpeg' | 'image/png'
  bytes: Uint8Array      // 1600px 압축 (모바일에서)
}

type JournalEntry = {
  id: string             // 클라이언트 생성 uuid
  occurredAt: string     // 'YYYY-MM-DD'
  vendorHint?: string    // 사용자가 적은 가게 이름 (라밥, 우아한형제들 등)
                         // ※ 명세서의 정식 가맹점명과 다름
  expectedAmount?: number
  category: Category     // '복리후생비' | '회식비' | ...
  participants: string[] // ['최기환', '문성우']
  description: string    // '야근 식대 4인'
  photoIds: string[]     // Photo[]에 대한 참조
  draft: boolean         // 임시저장(사진만) 여부
  createdAt: string      // ISO
  updatedAt: string      // ISO
}

type Slot = {
  key: UserKey
  pin: string            // '1234' (4자리)
  pinExpiresAt: number   // epoch ms, +1h
  entries: JournalEntry[]
  photos: Map<string, Photo>
  uploadedAt: number     // epoch ms
  expiresAt: number      // epoch ms, +24h
}

const store: Map<UserKey, Slot> = new Map()
```

## TTL 청소

```ts
// 1분마다 만료된 슬롯 청소
setInterval(() => {
  const now = Date.now()
  for (const [key, slot] of store) {
    if (slot.expiresAt < now) store.delete(key)
  }
}, 60_000)
```

## API 엔드포인트 (4개)

### 1. POST /api/push

모바일이 저널을 업로드하고 PIN을 받음.

**Request** (multipart/form-data)
```
Field "meta" (JSON):
{
  "dept": "FE1팀",
  "name": "최기환",
  "entries": [
    {
      "id": "uuid-1",
      "occurredAt": "2025-11-27",
      "vendorHint": "낮밤키친",
      "expectedAmount": 47000,
      "category": "복리후생비",
      "participants": ["최기환","문성우","김나연","배지훈"],
      "description": "야근 식대 4인",
      "photoIds": ["photo-1","photo-2"],
      "draft": false,
      "createdAt": "2025-11-27T19:30:00.000Z",
      "updatedAt": "2025-11-27T19:30:00.000Z"
    }
  ]
}

Field "photos" (multiple file parts):
  name="photo-1" → JPEG bytes
  name="photo-2" → JPEG bytes
  ...
```

**Response** (200)
```json
{
  "pin": "1234",
  "pinExpiresAt": "2025-11-27T20:30:00.000Z",
  "slotExpiresAt": "2025-11-28T19:30:00.000Z",
  "uploaded": { "entries": 13, "photos": 21, "bytes": 8388608 }
}
```

**Errors**
- `413` — 사용자당 30MB 초과
- `400` — meta 누락 / 형식 오류
- `503` — 메모리 한계 (전체 사용량 보호)

**동작**
- 같은 (dept, name) 슬롯이 이미 있으면 **덮어쓰기**, 새 PIN 발급, 이전 PIN 무효화
- 슬롯 TTL은 push 시점 기준 +24h로 갱신
- multipart 파일 명은 entries[].photoIds 와 매칭

---

### 2. POST /api/pull

PC가 저널을 가져옴.

**Request**
```json
{ "dept": "FE1팀", "name": "최기환", "pin": "1234" }
```

**Response** (200)
```json
{
  "entries": [ /* JournalEntry[] */ ],
  "photoMeta": [
    { "id": "photo-1", "mime": "image/jpeg", "size": 234567 }
  ],
  "uploadedAt": "2025-11-27T19:30:00.000Z"
}
```

**Errors**
- `404` — 슬롯 없음 / 만료
- `401` — PIN 불일치 / 만료

**동작**
- 성공 시 PIN 즉시 무효화 (다시 받으려면 모바일에서 새 PIN 발급)
- 데이터 자체는 24h TTL까지 유지 (사용자가 PC에서 다시 PIN 받아 같은 데이터 재 pull 가능)
- 사진 바이너리는 별도 엔드포인트로 lazy 다운로드 (메모리/대역폭 보호)

---

### 3. GET /api/photos/:photoId?dept=&name=&pullToken=

`/api/pull` 응답으로 받은 단기 토큰(pullToken)으로 사진 1장씩 다운로드.

**Response**
- `200` — `Content-Type: image/jpeg`, raw bytes
- `404` — 만료/없음
- `401` — pullToken 불일치

`pullToken`은 `/api/pull` 응답 시 함께 발급되는 짧은 임시 토큰(슬롯 TTL과 동일). PIN과 별개.

---

### 4. DELETE /api/me

PC 다운로드 완료 시, 또는 사용자가 명시적으로 삭제.

**Request**
```json
{ "dept": "FE1팀", "name": "최기환", "pullToken": "..." }
```

**Response** `{ "ok": true }`

---

## 보안 헤더 / 정책

- 모든 응답에 `Cache-Control: no-store`
- CORS: 같은 origin만 (정적 PWA + API 같은 호스트)
- Body 사이즈: 30MB / 요청
- Rate limit: 사용자당 push 분당 3회 (이상한 반복 방지)

## 동시성 / 충돌

- 동일 슬롯 동시 push 2건 → 마지막이 이김 (Last-Write-Wins). PIN도 마지막 것만 유효.
- 한 사용자가 모바일·PC 둘 다 동시에 입력 → 1차에서는 모바일이 SOR(System of Record). PC pull 후엔 PC IndexedDB로 옮김. 추가 입력은 PC에서.

## 메모리 한계

- 전역: 1GB까지 (사용자 ~50명 동시 가정)
- 사용자당: 30MB (사진 포함)
- 초과 시:
  - 사용자당 초과 → `413`
  - 전역 초과 → 가장 오래된 슬롯부터 강제 만료

## 로깅 (최소)

```
2025-11-27T19:30:00 push  FE1팀::최기환  entries=13 photos=21 bytes=8.4MB pin=****
2025-11-28T10:15:00 pull  FE1팀::최기환  ok
2025-11-28T10:18:00 photo FE1팀::최기환  photo-1 234KB
2025-11-28T10:25:00 delete FE1팀::최기환  by user
```

본문(개인정보·사진·이름)은 **절대 로깅 안 함**.

## 운영 미니멀리즘

- DB X, 마이그레이션 X, 백업 X
- "재시작 = 청소" → 가장 강력한 가드
- 모니터링: 단순 메모리 사용률 + 요청 카운트만

## 의사 코드 (참고)

```ts
// apps/hub/src/index.ts (Bun + Hono)

import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { store, gc } from './store'

const app = new Hono()

app.post('/api/push', async c => {
  const form = await c.req.formData()
  const meta = JSON.parse(form.get('meta') as string)
  const slot = upsertSlot(meta)  // 새 PIN 발급
  for (const [key, file] of form) {
    if (key === 'meta') continue
    const bytes = new Uint8Array(await (file as File).arrayBuffer())
    slot.photos.set(key, { id: key, mime: 'image/jpeg', bytes })
  }
  return c.json({
    pin: slot.pin,
    pinExpiresAt: new Date(slot.pinExpiresAt).toISOString(),
    slotExpiresAt: new Date(slot.expiresAt).toISOString(),
    uploaded: { entries: slot.entries.length, photos: slot.photos.size }
  })
})

app.post('/api/pull', async c => {
  const { dept, name, pin } = await c.req.json()
  const slot = store.get(`${dept}::${name}`)
  if (!slot) return c.json({ error: 'not found' }, 404)
  if (slot.pin !== pin || slot.pinExpiresAt < Date.now())
    return c.json({ error: 'pin' }, 401)

  slot.pin = ''  // PIN 즉시 폐기
  const pullToken = issuePullToken(slot)
  return c.json({
    entries: slot.entries,
    photoMeta: [...slot.photos.values()].map(p => ({ id: p.id, mime: p.mime, size: p.bytes.byteLength })),
    pullToken,
    uploadedAt: new Date(slot.uploadedAt).toISOString(),
  })
})

app.get('/api/photos/:id', c => { /* pullToken 검증 후 bytes 반환 */ })

app.delete('/api/me', async c => { /* pullToken 검증 후 store.delete */ })

// 정적 PWA
app.use('/*', serveStatic({ root: './web/out' }))

setInterval(gc, 60_000)
export default { port: 3000, fetch: app.fetch }
```

총 ~150줄 예상.
