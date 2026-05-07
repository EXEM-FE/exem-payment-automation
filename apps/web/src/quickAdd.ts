import type { Category, ExpensePreset } from "@exem/shared";
import { TEAM_MEMBERS } from "./data";

export type QuickAddPreset = ExpensePreset;

export type QuickAddOption = {
  preset: QuickAddPreset;
  title: string;
  hint: string;
};

export const QUICK_ADD_OPTIONS: QuickAddOption[] = [
  { preset: "late_meal", title: "야근 식대 등록", hint: "사무실 야근 후 식사" },
  { preset: "holiday_meal", title: "휴일 식대 등록", hint: "주말·공휴일 출근 식사" },
  { preset: "taxi", title: "택시비 등록", hint: "야근 후 귀가 택시비" },
  { preset: "manual", title: "직접 입력", hint: "위에 해당하지 않는 경비" },
];

export type QuickAddPrefill = {
  category?: Category;
  description?: string;
  participants: string[];
  hideFoodIntent: boolean;
  preset: QuickAddPreset;
};

export function quickAddPrefill(
  preset: QuickAddPreset,
  profileName: string,
): QuickAddPrefill {
  const me = TEAM_MEMBERS.includes(profileName) ? [profileName] : [];

  switch (preset) {
    case "late_meal":
      return {
        preset,
        category: "복리후생비",
        description: "야근 식대",
        participants: me,
        hideFoodIntent: false,
      };
    case "holiday_meal":
      return {
        preset,
        category: "복리후생비",
        description: "휴일 식대",
        participants: me,
        hideFoodIntent: false,
      };
    case "taxi":
      return {
        preset,
        category: "여비교통비",
        description: "야근 택시비",
        participants: me,
        hideFoodIntent: true,
      };
    case "manual":
      return {
        preset,
        participants: me,
        hideFoodIntent: false,
      };
  }
}

/**
 * 식대 1인 한도. 호출부가 rules.json에서 직접 읽어 넘긴다.
 * 이 모듈에는 한도 숫자(12,000 / 15,000)를 박아 두지 않는다.
 */
export type MealLimits = {
  lateMeal: number;
  holidayMeal: number;
};

/**
 * 신청 금액 자동 계산.
 * - 야근/휴일 식대: min(실제금액, 참석자수 × 1인 한도)
 * - 택시·직접 입력: 실제 금액 그대로 (한도 없음)
 * - preset이 없으면 실제 금액 그대로 (편집 모드 fallback)
 *
 * 실제 금액이 비었거나 0 이하이면 0을 돌려준다.
 */
export function computeRequestedAmount(
  preset: QuickAddPreset | null,
  expectedAmount: number,
  participantCount: number,
  limits: MealLimits,
): number {
  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) return 0;
  const safeCount = Math.max(1, Math.floor(participantCount) || 0);
  switch (preset) {
    case "late_meal":
      return Math.min(expectedAmount, safeCount * limits.lateMeal);
    case "holiday_meal":
      return Math.min(expectedAmount, safeCount * limits.holidayMeal);
    case "taxi":
    case "manual":
    case null:
    default:
      return expectedAmount;
  }
}

/**
 * preset에 맞춰 자동으로 채우는 내용 텍스트.
 * - 야근/휴일 식대: "야근/휴일 식대 N인" (참석자 0명이면 1인으로 표기)
 * - 택시: "야근 택시비"
 * - 직접 입력 또는 preset 없음: null (자동 채우기 안 함)
 */
export function computeAutoDescription(
  preset: QuickAddPreset | null,
  participantCount: number,
): string | null {
  const safeCount = Math.max(1, Math.floor(participantCount) || 0);
  switch (preset) {
    case "late_meal":
      return `야근 식대 ${safeCount}인`;
    case "holiday_meal":
      return `휴일 식대 ${safeCount}인`;
    case "taxi":
      return "야근 택시비";
    case "manual":
    case null:
    default:
      return null;
  }
}

const AUTO_MEAL_DESCRIPTION_PATTERN = /^(야근|휴일) 식대 \d+인$/;
const AUTO_TAXI_DESCRIPTIONS = new Set(["야근 택시비"]);

/**
 * 사용자가 직접 수정한 description인지 판정.
 * 아래 중 하나면 자동 생성으로 간주해 재계산을 허용한다.
 * - 빈 문자열
 * - "야근 식대" / "휴일 식대" (프리셋 시드 텍스트)
 * - "야근 식대 N인" / "휴일 식대 N인"
 * - "야근 택시비"
 */
export function isAutoDescription(description: string): boolean {
  const trimmed = description.trim();
  if (!trimmed) return true;
  if (trimmed === "야근 식대" || trimmed === "휴일 식대") return true;
  if (AUTO_TAXI_DESCRIPTIONS.has(trimmed)) return true;
  return AUTO_MEAL_DESCRIPTION_PATTERN.test(trimmed);
}

/**
 * 모바일 입력 시트에서 어떤 필드를 노출할지 결정.
 * preset이 정해지면 그 preset에 꼭 필요한 필드만 보인다.
 * 편집 모드(preset === null)나 직접 입력은 모든 필드를 보여 사용자에게 자유를 준다.
 */
export type EntrySheetFieldVisibility = {
  vendor: boolean; // 가게 / 가맹점 입력
  category: boolean; // 계정과목 드롭다운
  participants: boolean; // 함께한 사람 칩
  foodIntent: boolean; // 식음료 4지선다 (가맹점 매칭과 별개로 preset 단계에서 막을지 여부)
  requestedAmount: boolean; // 신청 금액 입력 (택시는 실비 = 결제 금액이라 숨김)
  requiresParticipants: boolean; // 저장 시 참석자 1명 이상이 반드시 있어야 하는지
  taxiReceiptHint: boolean; // "탑승 시간이 보이는 영수증" 안내 노출 여부
};

export function entrySheetFieldVisibility(
  preset: QuickAddPreset | null,
): EntrySheetFieldVisibility {
  switch (preset) {
    case "taxi":
      return {
        vendor: false,
        category: false,
        participants: false,
        foodIntent: false,
        requestedAmount: false,
        requiresParticipants: false,
        taxiReceiptHint: true,
      };
    case "late_meal":
    case "holiday_meal":
      return {
        // 가맹점은 명세서 매칭과 식당 메모용으로 유지하되,
        // 입력 시트에서는 폼 맨 아래로 내려 우선순위가 낮음을 시각적으로 표현한다.
        vendor: true,
        category: false,
        participants: true,
        foodIntent: false,
        requestedAmount: true,
        requiresParticipants: true,
        taxiReceiptHint: false,
      };
    case "manual":
    case null:
    default:
      return {
        vendor: true,
        category: true,
        participants: true,
        foodIntent: true,
        requestedAmount: true,
        requiresParticipants: true,
        taxiReceiptHint: false,
      };
  }
}
