import { describe, expect, it } from "vitest";
import { QUICK_ADD_OPTIONS, quickAddPrefill } from "../quickAdd";

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
});
