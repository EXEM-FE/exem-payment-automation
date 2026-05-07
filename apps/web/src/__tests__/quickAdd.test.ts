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
