import type { Category, JournalEntry, RulesConfig, StatementRow } from "./types";

export function pickAccount(rules: RulesConfig, vendor: string): Category | null {
  if (!vendor) return null;
  for (const rule of rules.merchant_rules) {
    try {
      const re = new RegExp(rule.pattern);
      if (re.test(vendor)) return rule.account;
    } catch {
      // ignore invalid regex
    }
  }
  return null;
}

export function isFoodMerchant(rules: RulesConfig, vendor: string): boolean {
  if (!vendor) return false;
  return rules.food_merchant_patterns.some((pattern) => vendor.includes(pattern));
}

export function isReceiptRequired(rules: RulesConfig, vendor: string): boolean {
  if (!vendor) return false;
  return rules.receipt_required_patterns.some((pattern) => {
    try {
      return new RegExp(pattern).test(vendor);
    } catch {
      return vendor.includes(pattern);
    }
  });
}

export function isFoodCategory(category: Category): boolean {
  return category === "복리후생비" || category === "회식비" || category === "접대비" || category === "회의비";
}

/**
 * 항목별 검증 결과. 모두 안내(warn) 톤이며 다운로드 차단은 하지 않는다.
 * UI에서 type별로 톤만 다르게 표시한다.
 */
export type EntryIssue =
  | { type: "receipt"; message: string }
  | { type: "participants"; message: string }
  | { type: "amount"; message: string }
  | { type: "per_person"; message: string };

export function validateForExport(
  rules: RulesConfig,
  entry: JournalEntry,
  statement?: StatementRow,
): EntryIssue[] {
  const issues: EntryIssue[] = [];

  // 영수증 필수 가맹점 검증 (저널 vendorHint 또는 명세서 가맹점 둘 중 하나로 판정)
  const merchantText = `${entry.vendorHint} ${statement?.merchant ?? ""}`;
  if (isReceiptRequired(rules, merchantText) && entry.photoIds.length === 0) {
    issues.push({
      type: "receipt",
      message: "영수증이 필수인 가맹점인데 사진이 없어요",
    });
  }

  // 식대 동반인 누락
  if (isFoodCategory(entry.category) && entry.participants.length === 0) {
    issues.push({
      type: "participants",
      message: "식대성 항목인데 함께한 사람이 비어 있어요",
    });
  }

  // 50만원 초과
  const amount = statement?.chargedAmount ?? entry.expectedAmount ?? 0;
  if (amount >= (rules.limits["품의서_초과기준"] ?? 500000)) {
    issues.push({
      type: "amount",
      message: "50만원 초과 항목은 품의서를 사전에 작성해야 해요",
    });
  }

  // 인당 한도 (복리후생비 + 야근/야간 또는 휴일/주말 키워드만)
  // 출처: 2026년 경비규정.pdf §II-6 식대 지원 (평일 저녁 12,000 / 휴일 15,000)
  if (entry.category === "복리후생비" && entry.participants.length > 0 && amount > 0) {
    const perPerson = Math.round(amount / entry.participants.length);
    const desc = entry.description ?? "";
    if (/야근|야간/.test(desc)) {
      const limit = rules.limits["야근식대_1인"] ?? 12000;
      if (perPerson > limit) {
        issues.push({
          type: "per_person",
          message: `야근 식대는 1인당 ${limit.toLocaleString()}원 한도예요 (인당 ${perPerson.toLocaleString()}원)`,
        });
      }
    } else if (/휴일|주말/.test(desc)) {
      const limit = rules.limits["휴일식대_1인"] ?? 15000;
      if (perPerson > limit) {
        issues.push({
          type: "per_person",
          message: `휴일 식대는 1인당 ${limit.toLocaleString()}원 한도예요 (인당 ${perPerson.toLocaleString()}원)`,
        });
      }
    }
  }

  return issues;
}
