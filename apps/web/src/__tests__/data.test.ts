import { describe, expect, it } from "vitest";
import type { JournalEntry, Profile, StatementRow } from "@exem/shared";
import { buildMatches, buildSeedEntry, rules } from "../data";

const profile: Profile = { dept: "FE1팀", name: "최기환" };

function statement(overrides: Partial<StatementRow>): StatementRow {
  return {
    id: "row-1",
    usedAt: "2026.05.12",
    cardNumber: "****-0000",
    userName: "최*환",
    employeeNo: "A000",
    dept: "FE1팀",
    usedAmount: 12000,
    chargedAmount: 12000,
    foreignAmount: "0",
    currency: "-",
    merchant: "낮밤키친",
    businessNo: "",
    approvalNo: "",
    installmentMonths: "0",
    billingRound: "0",
    ...overrides,
  };
}

function entry(overrides: Partial<JournalEntry>): JournalEntry {
  return {
    id: "entry-1",
    occurredAt: "2026-05-12",
    vendorHint: "",
    category: "복리후생비",
    preset: "late_meal",
    participants: ["최기환"],
    description: "야근 식대 1인",
    draft: false,
    photoIds: [],
    createdAt: "2026-05-12T10:00:00.000Z",
    updatedAt: "2026-05-12T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildMatches", () => {
  it("명시 연결된 시드 entry는 자기 명세서 행에만 붙는다", () => {
    const rows = [
      statement({ id: "row-1", merchant: "식당 A", chargedAmount: 12000 }),
      statement({ id: "row-2", merchant: "식당 B", chargedAmount: 12000 }),
    ];
    const seedForSecond = buildSeedEntry(rows[1], profile, rules);
    const mobile = entry({ id: "mobile-1", expectedAmount: undefined });

    const matches = buildMatches([seedForSecond, mobile], rows);

    expect(matches[0].entry?.id).toBe("mobile-1");
    expect(matches[0].status).toBe("review");
    expect(matches[1].entry?.id).toBe(seedForSecond.id);
    expect(matches[1].status).toBe("exact");
  });

  it("같은 날짜 모바일 식대 후보가 여러 개면 확인 필요로 둔다", () => {
    const rows = [
      statement({ id: "row-1", merchant: "식당 A", chargedAmount: 18000 }),
      statement({ id: "row-2", merchant: "식당 B", chargedAmount: 21000 }),
    ];
    const mobileA = entry({
      id: "mobile-a",
      expectedAmount: undefined,
      createdAt: "2026-05-12T10:00:00.000Z",
    });
    const mobileB = entry({
      id: "mobile-b",
      expectedAmount: undefined,
      createdAt: "2026-05-12T11:00:00.000Z",
      participants: ["최기환", "강지명"],
      description: "야근 식대 2인",
    });

    const matches = buildMatches([mobileA, mobileB], rows);

    expect(matches.map((match) => match.status)).toEqual(["review", "review"]);
    expect(matches[0].reason).toContain("모바일 후보가 2건");
    expect(matches.map((match) => match.entry?.id)).toEqual(["mobile-a", "mobile-b"]);
  });
});
