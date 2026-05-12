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

export type ExpensePreset = "late_meal" | "holiday_meal" | "taxi" | "manual";

export const EXPENSE_PRESETS: ExpensePreset[] = [
  "late_meal",
  "holiday_meal",
  "taxi",
  "manual",
];

export const EXPENSE_PRESET_LABELS: Record<ExpensePreset, string> = {
  late_meal: "야근 식대",
  holiday_meal: "휴일 식대",
  taxi: "택시비",
  manual: "직접 입력",
};

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
  expectedAmount?: number; // 실제 결제 금액
  requestedAmount?: number; // 회사에 신청할 금액 (식대 한도 적용 후)
  matchedStatementId?: string; // PC 검토 단계에서 명세서 행과 명시 연결
  category: Category;
  preset?: ExpensePreset;
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
  usedAt: string; // YYYY.MM.DD or YYYY-MM-DD
  cardNumber: string;
  userName: string;
  employeeNo: string;
  dept: string;
  usedAmount: number;
  chargedAmount: number;
  foreignAmount: string;
  currency: string;
  merchant: string;
  businessNo: string;
  approvalNo: string;
  installmentMonths: string;
  billingRound: string;
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
  /** 사용자가 직접 입력으로 선택할 수 있는 계정과목 목록. 회사 정책 변경 시 rules.json만 수정하면 된다. */
  categories?: Category[];
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
