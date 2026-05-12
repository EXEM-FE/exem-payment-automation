import {
  ALL_CATEGORIES,
  EXPENSE_PRESETS,
  type Category,
  type ExpensePreset,
  type JournalEntry,
} from "./types.js";

const ALLOWED_KEYS: (keyof JournalEntry)[] = [
  "id",
  "occurredAt",
  "vendorHint",
  "expectedAmount",
  "requestedAmount",
  "matchedStatementId",
  "category",
  "preset",
  "participants",
  "description",
  "draft",
  "photoIds",
  "createdAt",
  "updatedAt",
];

/**
 * 모바일이 서버로 보내기 전에 저널 항목에서 알려진 키만 남기고,
 * 형식이 잘못된 데이터(특히 카드정보가 끼어들 여지)를 잘라낸다.
 * 클라이언트와 서버 양쪽 모두에서 호출한다.
 */
export function sanitizeJournalEntry(input: unknown): JournalEntry | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;

  const id = typeof raw.id === "string" ? raw.id : "";
  const occurredAt = typeof raw.occurredAt === "string" ? raw.occurredAt : "";
  if (!id || !occurredAt) return null;

  const category: Category = ALL_CATEGORIES.includes(raw.category as Category)
    ? (raw.category as Category)
    : "복리후생비";
  const preset: ExpensePreset | undefined = EXPENSE_PRESETS.includes(raw.preset as ExpensePreset)
    ? (raw.preset as ExpensePreset)
    : undefined;

  const participants = Array.isArray(raw.participants)
    ? raw.participants.filter((value): value is string => typeof value === "string").slice(0, 30)
    : [];
  const photoIds = Array.isArray(raw.photoIds)
    ? raw.photoIds.filter((value): value is string => typeof value === "string").slice(0, 12)
    : [];

  const cleaned: JournalEntry = {
    id,
    occurredAt,
    vendorHint: typeof raw.vendorHint === "string" ? raw.vendorHint.slice(0, 80) : "",
    expectedAmount:
      typeof raw.expectedAmount === "number" && Number.isFinite(raw.expectedAmount)
        ? Math.max(0, Math.round(raw.expectedAmount))
        : undefined,
    requestedAmount:
      typeof raw.requestedAmount === "number" && Number.isFinite(raw.requestedAmount)
        ? Math.max(0, Math.round(raw.requestedAmount))
        : undefined,
    matchedStatementId:
      typeof raw.matchedStatementId === "string" ? raw.matchedStatementId.slice(0, 80) : undefined,
    category,
    preset,
    participants,
    description: typeof raw.description === "string" ? raw.description.slice(0, 200) : "",
    draft: Boolean(raw.draft),
    photoIds,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
  };

  // 화이트리스트 외 키가 우연히 남아 있어도 위 객체에는 포함되지 않는다.
  void ALLOWED_KEYS;
  return cleaned;
}

export function sanitizeJournalEntries(input: unknown): JournalEntry[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => sanitizeJournalEntry(entry))
    .filter((entry): entry is JournalEntry => entry !== null);
}
