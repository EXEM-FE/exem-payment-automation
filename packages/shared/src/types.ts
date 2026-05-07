export type Category =
  | "복리후생비"
  | "회식비"
  | "회의비"
  | "접대비"
  | "여비교통비"
  | "사무용품비"
  | "도서인쇄비"
  | "통신비"
  | "소모품비"
  | "운반비"
  | "지급수수료"
  | "광고선전비"
  | "교육훈련비"
  | "잡비";

export const ALL_CATEGORIES: Category[] = [
  "복리후생비",
  "회식비",
  "회의비",
  "접대비",
  "여비교통비",
  "사무용품비",
  "통신비",
  "도서인쇄비",
  "소모품비",
  "운반비",
  "지급수수료",
  "광고선전비",
  "교육훈련비",
  "잡비",
];

export type Profile = {
  dept: string;
  name: string;
};

export type MemberGroup = {
  id: string;
  label: string;
  members: string[];
};

/**
 * 모바일 저널에 저장되는 항목 (서버에 push되는 데이터의 본체).
 * 카드번호·사업자번호·승인번호는 절대 포함되지 않는다.
 */
export type JournalEntry = {
  id: string;
  occurredAt: string; // YYYY-MM-DD
  vendorHint: string; // 사용자가 적은 가게 메모
  expectedAmount?: number;
  category: Category;
  participants: string[];
  description: string;
  draft: boolean;
  photoIds: string[]; // photos 별도 저장
  createdAt: string;
  updatedAt: string;
};

export type Photo = {
  id: string;
  mime: "image/jpeg" | "image/png" | "image/webp";
  size: number;
};

/** 명세서 1행. 카드번호·사업자번호 등은 PC 브라우저 메모리에서만 다룬다. */
export type StatementRow = {
  id: string;
  usedAt: string; // YYYY.MM.DD
  cardNumber: string;
  userName: string;
  employeeNo: string;
  dept: string;
  usedAmount: number;
  chargedAmount: number;
  foreignAmount: number;
  currency: string;
  merchant: string;
  businessNo: string;
  approvalNo: string;
  installmentMonths: number;
  billingRound: number;
};

export type MatchStatus = "exact" | "review" | "missing";

export type MatchResult = {
  id: string;
  status: MatchStatus;
  statement: StatementRow;
  entry?: JournalEntry;
  reason: string;
};

export type FoodIntent =
  | "야근식대"
  | "휴일식대"
  | "회식"
  | "회의-주간"
  | "접대";

/* ===================== Rule engine ===================== */

export type RulesConfig = {
  version: string;
  deadlines: {
    card_expense: { day: number; businessDay: boolean; month: "current" | "next" };
    cash_expense: { day: number; businessDay: boolean; month: "current" | "next" };
  };
  limits: Record<string, number>;
  rates: Record<string, number>;
  merchant_rules: { pattern: string; account: Category }[];
  food_merchant_patterns: string[];
  receipt_required_patterns: string[];
};

/* ===================== Wire types (between mobile and server) ===================== */

export type PushMeta = {
  dept: string;
  name: string;
  entries: JournalEntry[];
  uploadedAt: string;
};

export type PushResponse = {
  pin: string;
  pinExpiresAt: string;
  slotExpiresAt: string;
  uploaded: { entries: number; photos: number; bytes: number };
};

export type PullRequest = {
  dept: string;
  name: string;
  pin: string;
};

export type PullResponse = {
  entries: JournalEntry[];
  photoMeta: Photo[];
  pullToken: string;
  uploadedAt: string;
};

export type DeleteRequest = {
  dept: string;
  name: string;
  pullToken: string;
};
