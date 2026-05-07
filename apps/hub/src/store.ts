import { sanitizeJournalEntries, type JournalEntry, type Photo } from "@exem/shared";

const PIN_TTL_MS = 60 * 60 * 1000; // 1h
const SLOT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const PER_USER_BYTE_LIMIT = 30 * 1024 * 1024; // 30MB
const GLOBAL_BYTE_LIMIT = 1024 * 1024 * 1024; // 1GB

export type PhotoBlob = Photo & { bytes: Uint8Array };

export type Slot = {
  key: string;
  pin: string;
  pinExpiresAt: number;
  pullToken: string | null;
  pullTokenExpiresAt: number;
  entries: JournalEntry[];
  photos: Map<string, PhotoBlob>;
  uploadedAt: number;
  expiresAt: number;
  bytes: number;
};

export class Store {
  private slots = new Map<string, Slot>();
  private gcInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.gcInterval = setInterval(() => this.gc(), 60_000);
  }

  destroy() {
    if (this.gcInterval) clearInterval(this.gcInterval);
    this.slots.clear();
  }

  /** 사용자 슬롯 키 (부서+이름). */
  static keyFor(dept: string, name: string) {
    return `${dept.trim()}::${name.trim()}`;
  }

  /** 4자리 PIN 발급 (1234~9999). */
  static issuePin() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  static issueToken() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return Math.random().toString(36).slice(2);
  }

  /** TTL 만료 슬롯 정리 + 전역 메모리 한계 보호. */
  gc() {
    const now = Date.now();
    for (const [key, slot] of this.slots) {
      if (slot.expiresAt < now) this.slots.delete(key);
    }
    let totalBytes = this.totalBytes();
    if (totalBytes <= GLOBAL_BYTE_LIMIT) return;
    // 가장 오래된 슬롯부터 정리
    const sorted = [...this.slots.entries()].sort(
      ([, a], [, b]) => a.uploadedAt - b.uploadedAt,
    );
    for (const [key, slot] of sorted) {
      if (totalBytes <= GLOBAL_BYTE_LIMIT) break;
      this.slots.delete(key);
      totalBytes -= slot.bytes;
    }
  }

  totalBytes() {
    let total = 0;
    for (const slot of this.slots.values()) total += slot.bytes;
    return total;
  }

  /** 모바일이 push할 때 호출. 기존 슬롯이 있으면 덮어쓰기 + 새 PIN 발급. */
  upsert({
    dept,
    name,
    entriesRaw,
    photos,
  }: {
    dept: string;
    name: string;
    entriesRaw: unknown;
    photos: PhotoBlob[];
  }) {
    const entries = sanitizeJournalEntries(entriesRaw);
    const photoMap = new Map<string, PhotoBlob>();
    let bytes = 0;
    for (const photo of photos) {
      photoMap.set(photo.id, photo);
      bytes += photo.bytes.byteLength;
    }
    if (bytes > PER_USER_BYTE_LIMIT) {
      throw Object.assign(new Error("payload too large"), { status: 413 });
    }

    const now = Date.now();
    const key = Store.keyFor(dept, name);
    const slot: Slot = {
      key,
      pin: Store.issuePin(),
      pinExpiresAt: now + PIN_TTL_MS,
      pullToken: null,
      pullTokenExpiresAt: 0,
      entries,
      photos: photoMap,
      uploadedAt: now,
      expiresAt: now + SLOT_TTL_MS,
      bytes,
    };
    this.slots.set(key, slot);

    // 전역 메모리 보호
    if (this.totalBytes() > GLOBAL_BYTE_LIMIT) this.gc();

    return slot;
  }

  /** PC가 PIN으로 pull. 성공 시 PIN 폐기 + pullToken 발급. */
  consumePin({
    dept,
    name,
    pin,
  }: {
    dept: string;
    name: string;
    pin: string;
  }): Slot {
    const key = Store.keyFor(dept, name);
    const slot = this.slots.get(key);
    if (!slot) throw Object.assign(new Error("slot not found"), { status: 404 });
    const now = Date.now();
    if (slot.expiresAt < now) {
      this.slots.delete(key);
      throw Object.assign(new Error("slot expired"), { status: 404 });
    }
    if (!slot.pin || slot.pinExpiresAt < now) {
      throw Object.assign(new Error("pin expired"), { status: 401 });
    }
    if (slot.pin !== pin) {
      throw Object.assign(new Error("pin mismatch"), { status: 401 });
    }

    slot.pin = "";
    slot.pinExpiresAt = 0;
    slot.pullToken = Store.issueToken();
    slot.pullTokenExpiresAt = slot.expiresAt;
    return slot;
  }

  /** pullToken으로 사진 1장 가져오기 (lazy). */
  getPhoto({
    dept,
    name,
    photoId,
    token,
  }: {
    dept: string;
    name: string;
    photoId: string;
    token: string;
  }): PhotoBlob {
    const slot = this.requireValidToken({ dept, name, token });
    const photo = slot.photos.get(photoId);
    if (!photo) throw Object.assign(new Error("photo not found"), { status: 404 });
    return photo;
  }

  /** 사용자 슬롯 즉시 삭제 (다운로드 완료 후). */
  deleteSlot({
    dept,
    name,
    token,
  }: {
    dept: string;
    name: string;
    token: string;
  }) {
    this.requireValidToken({ dept, name, token });
    const key = Store.keyFor(dept, name);
    this.slots.delete(key);
  }

  private requireValidToken({
    dept,
    name,
    token,
  }: {
    dept: string;
    name: string;
    token: string;
  }): Slot {
    const key = Store.keyFor(dept, name);
    const slot = this.slots.get(key);
    if (!slot) throw Object.assign(new Error("slot not found"), { status: 404 });
    const now = Date.now();
    if (slot.expiresAt < now) {
      this.slots.delete(key);
      throw Object.assign(new Error("slot expired"), { status: 404 });
    }
    if (!slot.pullToken || slot.pullTokenExpiresAt < now || slot.pullToken !== token) {
      throw Object.assign(new Error("token invalid"), { status: 401 });
    }
    return slot;
  }
}
