import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEAL_LIMITS,
  QUICK_ADD_OPTIONS,
  computeAutoDescription,
  computeRequestedAmount,
  entrySheetFieldVisibility,
  isAutoDescription,
  quickAddPrefill,
} from "../quickAdd";

describe("quickAddPrefill", () => {
  it("야근 식대: 복리후생비, 본인 1명, food intent 표시", () => {
    const prefill = quickAddPrefill("late_meal", "최기환");
    expect(prefill.category).toBe("복리후생비");
    expect(prefill.description).toBe("야근 식대");
    expect(prefill.participants).toEqual(["최기환"]);
    expect(prefill.hideFoodIntent).toBe(false);
    expect(prefill.preset).toBe("late_meal");
  });

  it("휴일 식대: 복리후생비, 본인 1명", () => {
    const prefill = quickAddPrefill("holiday_meal", "강지명");
    expect(prefill.category).toBe("복리후생비");
    expect(prefill.description).toBe("휴일 식대");
    expect(prefill.participants).toEqual(["강지명"]);
    expect(prefill.hideFoodIntent).toBe(false);
  });

  it("택시비: 여비교통비, 본인만, food intent 숨김", () => {
    const prefill = quickAddPrefill("taxi", "최기환");
    expect(prefill.category).toBe("여비교통비");
    expect(prefill.description).toBe("야근 택시비");
    expect(prefill.participants).toEqual(["최기환"]);
    expect(prefill.hideFoodIntent).toBe(true);
  });

  it("직접 입력: category/description 비움, 본인만 자동선택", () => {
    const prefill = quickAddPrefill("manual", "최기환");
    expect(prefill.category).toBeUndefined();
    expect(prefill.description).toBeUndefined();
    expect(prefill.participants).toEqual(["최기환"]);
    expect(prefill.hideFoodIntent).toBe(false);
  });

  it("팀 명단에 없는 이름은 자동 참석자 비움", () => {
    const prefill = quickAddPrefill("late_meal", "외부인");
    expect(prefill.participants).toEqual([]);
    // 카테고리·내용 프리필은 그대로 유지되어야 한다
    expect(prefill.category).toBe("복리후생비");
    expect(prefill.description).toBe("야근 식대");
  });

  it("호출마다 새 객체를 반환해 mutation이 다른 호출에 새지 않는다", () => {
    const a = quickAddPrefill("late_meal", "최기환");
    const b = quickAddPrefill("late_meal", "최기환");
    expect(a).not.toBe(b);
    expect(a.participants).not.toBe(b.participants);
    a.participants.push("강지명");
    expect(b.participants).toEqual(["최기환"]);
  });

  it("택시비만이 참석자 UI를 숨기는 유일한 프리셋이다", () => {
    expect(quickAddPrefill("late_meal", "최기환").hideFoodIntent).toBe(false);
    expect(quickAddPrefill("holiday_meal", "최기환").hideFoodIntent).toBe(false);
    expect(quickAddPrefill("manual", "최기환").hideFoodIntent).toBe(false);
    expect(quickAddPrefill("taxi", "최기환").hideFoodIntent).toBe(true);
  });
});

describe("computeRequestedAmount", () => {
  const limits = DEFAULT_MEAL_LIMITS; // { lateMeal: 12000, holidayMeal: 15000 }

  it("야근식대: 한도(참석자 × 12,000) 이내면 결제 금액 그대로", () => {
    // 3명 × 12000 = 36000원 한도, 결제 30000원 → 30000
    expect(computeRequestedAmount("late_meal", 30000, 3, limits)).toBe(30000);
  });

  it("야근식대: 한도 초과 시 한도까지만 신청", () => {
    // 3명 × 12000 = 36000원 한도, 결제 50000원 → 36000
    expect(computeRequestedAmount("late_meal", 50000, 3, limits)).toBe(36000);
  });

  it("휴일식대: 2명 × 15,000 = 30,000원 한도", () => {
    expect(computeRequestedAmount("holiday_meal", 25000, 2, limits)).toBe(25000);
    expect(computeRequestedAmount("holiday_meal", 50000, 2, limits)).toBe(30000);
  });

  it("택시비: 한도 없이 결제 금액 그대로", () => {
    expect(computeRequestedAmount("taxi", 24500, 1, limits)).toBe(24500);
    expect(computeRequestedAmount("taxi", 100000, 0, limits)).toBe(100000);
  });

  it("직접 입력/preset 없음: 결제 금액 그대로", () => {
    expect(computeRequestedAmount("manual", 12345, 0, limits)).toBe(12345);
    expect(computeRequestedAmount(null, 8000, 5, limits)).toBe(8000);
  });

  it("결제 금액이 0 이하면 0", () => {
    expect(computeRequestedAmount("late_meal", 0, 3, limits)).toBe(0);
    expect(computeRequestedAmount("late_meal", -500, 3, limits)).toBe(0);
  });

  it("참석자 0명이어도 1인분 한도까지 적용해 최소 금액을 보장", () => {
    // 식대인데 참석자 0명이면 최소 1인 한도로 클램프
    expect(computeRequestedAmount("late_meal", 50000, 0, limits)).toBe(12000);
  });

  it("기본 한도(12,000 / 15,000)를 사용", () => {
    expect(computeRequestedAmount("late_meal", 50000, 1)).toBe(12000);
    expect(computeRequestedAmount("holiday_meal", 50000, 1)).toBe(15000);
  });
});

describe("computeAutoDescription", () => {
  it("야근식대 + N명 → '야근 식대 N인'", () => {
    expect(computeAutoDescription("late_meal", 3)).toBe("야근 식대 3인");
    expect(computeAutoDescription("late_meal", 1)).toBe("야근 식대 1인");
  });

  it("휴일식대 + N명 → '휴일 식대 N인'", () => {
    expect(computeAutoDescription("holiday_meal", 2)).toBe("휴일 식대 2인");
  });

  it("참석자 0명이어도 1인으로 표기", () => {
    expect(computeAutoDescription("late_meal", 0)).toBe("야근 식대 1인");
  });

  it("택시는 인원과 무관하게 '야근 택시비'", () => {
    expect(computeAutoDescription("taxi", 0)).toBe("야근 택시비");
    expect(computeAutoDescription("taxi", 4)).toBe("야근 택시비");
  });

  it("직접 입력·preset 없음은 자동 채우지 않음", () => {
    expect(computeAutoDescription("manual", 3)).toBeNull();
    expect(computeAutoDescription(null, 3)).toBeNull();
  });
});

describe("isAutoDescription", () => {
  it("자동 패턴은 자동으로 인식", () => {
    expect(isAutoDescription("")).toBe(true);
    expect(isAutoDescription("야근 식대")).toBe(true);
    expect(isAutoDescription("휴일 식대")).toBe(true);
    expect(isAutoDescription("야근 식대 4인")).toBe(true);
    expect(isAutoDescription("휴일 식대 2인")).toBe(true);
    expect(isAutoDescription("야근 택시비")).toBe(true);
  });

  it("사용자가 직접 작성한 텍스트는 자동이 아님", () => {
    expect(isAutoDescription("팀 회식 - 4분기 마감")).toBe(false);
    expect(isAutoDescription("고객 미팅")).toBe(false);
    expect(isAutoDescription("야근 식대 4인 + 음료")).toBe(false);
  });
});

describe("entrySheetFieldVisibility", () => {
  it("택시: 가게·계정·참석자·food intent 모두 숨김, 참석자 필수 아님", () => {
    const v = entrySheetFieldVisibility("taxi");
    expect(v.vendor).toBe(false);
    expect(v.category).toBe(false);
    expect(v.participants).toBe(false);
    expect(v.foodIntent).toBe(false);
    expect(v.requiresParticipants).toBe(false);
  });

  it("야근식대: 참석자 칩만 노출, 가게·계정·food intent 숨김", () => {
    const v = entrySheetFieldVisibility("late_meal");
    expect(v.vendor).toBe(false);
    expect(v.category).toBe(false);
    expect(v.participants).toBe(true);
    expect(v.foodIntent).toBe(false);
    expect(v.requiresParticipants).toBe(true);
  });

  it("휴일식대: 야근식대와 동일한 노출 규칙", () => {
    expect(entrySheetFieldVisibility("holiday_meal")).toEqual(
      entrySheetFieldVisibility("late_meal"),
    );
  });

  it("직접 입력: 모든 필드 노출", () => {
    const v = entrySheetFieldVisibility("manual");
    expect(v.vendor).toBe(true);
    expect(v.category).toBe(true);
    expect(v.participants).toBe(true);
    expect(v.foodIntent).toBe(true);
    expect(v.requiresParticipants).toBe(true);
  });

  it("preset 없음(편집 모드): 모든 필드 노출 (사용자 자유)", () => {
    expect(entrySheetFieldVisibility(null)).toEqual(
      entrySheetFieldVisibility("manual"),
    );
  });
});

describe("QUICK_ADD_OPTIONS", () => {
  it("4개 옵션이 정해진 순서로 노출된다", () => {
    expect(QUICK_ADD_OPTIONS.map((option) => option.preset)).toEqual([
      "late_meal",
      "holiday_meal",
      "taxi",
      "manual",
    ]);
  });

  it("각 옵션은 사용자 친화적인 한국어 라벨과 힌트를 가진다", () => {
    for (const option of QUICK_ADD_OPTIONS) {
      expect(option.title.length).toBeGreaterThan(0);
      expect(option.hint.length).toBeGreaterThan(0);
    }
  });

  it("힌트와 라벨에 회계 용어(계정과목)가 노출되지 않는다", () => {
    // UX 라이팅 원칙: 사용자 입장 언어 사용. 계정과목 같은 기술 용어는 숨긴다.
    const accountingTerms = /복리후생비|여비교통비|회식비|회의비|접대비|사무용품비/;
    for (const option of QUICK_ADD_OPTIONS) {
      expect(option.title).not.toMatch(accountingTerms);
      expect(option.hint).not.toMatch(accountingTerms);
    }
  });

  it("옵션 순서는 가장 자주 쓰는 항목(야근 식대)을 맨 위에 둔다", () => {
    expect(QUICK_ADD_OPTIONS[0].preset).toBe("late_meal");
    expect(QUICK_ADD_OPTIONS[QUICK_ADD_OPTIONS.length - 1].preset).toBe("manual");
  });
});
