import type {
  JournalEntry,
  MatchResult,
  Profile,
  RulesConfig,
  StatementRow,
} from "@exem/shared";
import {
  estimateMealParticipantCount,
  inferMealSupportKind,
  isFoodMerchant,
  pickAccount,
} from "@exem/shared";
import rulesJson from "../../../packages/shared/rules.json";

export const rules = rulesJson as RulesConfig;

/** FE1팀 멤버 (사용자명(all) 칩 시드). 변동 시 이 배열만 갱신. */
export const TEAM_MEMBERS: string[] = [
  "강지명",
  "배지훈",
  "김재선",
  "문성우",
  "박영호",
  "권수연",
  "한원영",
  "최기환",
  "김서린",
];

/** 가맹점 비교용 정규화. PG/법인 표기·공백·구두점 제거 후 lower. */
function normalizeMerchant(s: string): string {
  return s
    .replace(/㈜|\(주\)|주식회사/g, "")
    .replace(/[\s·\-_().,'"\[\]/\\]/g, "")
    .toLowerCase();
}

/**
 * Sørensen-Dice bigram 유사도. 0~1.
 * - 정규화 후 동일 → 1
 * - 한쪽이 다른 쪽을 포함 → 길이 비율
 * - 그 외 → bigram 교집합 기반
 */
function merchantSimilarity(a: string, b: string): number {
  const na = normalizeMerchant(a);
  const nb = normalizeMerchant(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) {
    return Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
  }
  if (na.length < 2 || nb.length < 2) return 0;
  const bigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const A = bigrams(na);
  const B = bigrams(nb);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  const denom = A.size + B.size;
  return denom > 0 ? (2 * inter) / denom : 0;
}

const SIMILAR_HIGH = 0.5; // 1·2단계: 같은 가맹점 confirmation
const SIMILAR_MID = 0.6; // 3단계: 가맹점 가까움 (금액 다름)

function dotToDash(s: string) {
  return s.replaceAll(".", "-");
}

function pickPredictedParticipants(profileName: string, count: number): string[] {
  const ordered = [
    profileName,
    ...TEAM_MEMBERS.filter((member) => member !== profileName),
  ].filter(Boolean);
  return ordered.slice(0, Math.min(count, ordered.length));
}

/**
 * 명세서(SSoT) 1행 = 결과 1행. 각 행에 모바일 entry를 휴리스틱하게 attach.
 * 1) 날짜+금액 일치 → exact
 * 2) 날짜+가맹점 유사 ≥ 0.6 (금액 다름) → review
 * 3) 같은 날짜만 일치 → review
 * 4) 매칭 없음 → missing (시드 단계에서 채워짐)
 */
export function buildMatches(entries: JournalEntry[], rows: StatementRow[]): MatchResult[] {
  const used = new Set<string>();

  return rows.map((statement) => {
    const stmDate = dotToDash(statement.usedAt);
    const stmAmount = statement.chargedAmount;
    const stmMerchant = statement.merchant;

    const exact = entries.find(
      (entry) =>
        !used.has(entry.id) &&
        !entry.draft &&
        entry.occurredAt === stmDate &&
        entry.expectedAmount === stmAmount,
    );
    if (exact) {
      used.add(exact.id);
      const sim = merchantSimilarity(exact.vendorHint, stmMerchant);
      const reason =
        sim >= SIMILAR_HIGH
          ? "날짜·금액·가맹점이 모두 일치해요"
          : "날짜와 금액이 일치해요";
      return {
        id: `match-${statement.id}`,
        status: "exact",
        statement,
        entry: exact,
        reason,
      };
    }

    const sameDay = entries
      .filter((entry) => !used.has(entry.id) && !entry.draft && entry.occurredAt === stmDate)
      .map((entry) => ({ entry, score: merchantSimilarity(entry.vendorHint, stmMerchant) }))
      .sort((a, b) => b.score - a.score);

    if (sameDay.length > 0) {
      const top = sameDay[0];
      if (top.score >= SIMILAR_MID) {
        used.add(top.entry.id);
        return {
          id: `match-${statement.id}`,
          status: "review",
          statement,
          entry: top.entry,
          reason: `금액이 달라요 (휴대폰 ${(top.entry.expectedAmount ?? 0).toLocaleString()}원 / 카드 ${stmAmount.toLocaleString()}원)`,
        };
      }
      used.add(top.entry.id);
      return {
        id: `match-${statement.id}`,
        status: "review",
        statement,
        entry: top.entry,
        reason: "같은 날 항목이 있어요. 같은 결제인지 확인해주세요",
      };
    }

    return {
      id: `match-${statement.id}`,
      status: "missing",
      statement,
      reason: "휴대폰에 같은 항목이 없어요",
    };
  });
}

/**
 * 명세서 1행 → 시드 entry. 명세서 = SSoT 보장 (행 수 고정).
 * 복리후생비는 식대 1인 한도를 기준으로 예상 인원을 먼저 채운다.
 */
export function buildSeedEntry(
  row: StatementRow,
  profile: Profile,
  rulesConfig: RulesConfig,
): JournalEntry {
  const merchant = row.merchant.replace(/\s+/g, " ").trim();
  const isFood = isFoodMerchant(rulesConfig, merchant);
  const account = pickAccount(rulesConfig, merchant) ?? (isFood ? "복리후생비" : "복리후생비");
  const mealLike = account === "복리후생비";
  const mealKind = inferMealSupportKind(row.usedAt);
  const predictedCount = mealLike
    ? estimateMealParticipantCount(rulesConfig, row.chargedAmount, mealKind)
    : 0;
  const participants = mealLike
    ? pickPredictedParticipants(profile.name, predictedCount)
    : [];
  const now = new Date().toISOString();
  return {
    id: `entry-seed-${row.id}`,
    occurredAt: dotToDash(row.usedAt),
    vendorHint: merchant,
    expectedAmount: row.chargedAmount,
    category: account,
    participants,
    description: mealLike ? `${mealKind} 식대 ${predictedCount}인` : "",
    draft: false,
    photoIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 명세서 행에 매칭되지 않은 row만큼 시드 entry를 만들어 모바일 entries와 합친다.
 * 결과: pulledEntries.length ≥ rows.length 보장 (matched + seeds + orphans).
 */
export function seedAttachedEntries(
  rows: StatementRow[],
  mobile: JournalEntry[],
  profile: Profile,
  rulesConfig: RulesConfig,
): JournalEntry[] {
  const matches = buildMatches(mobile, rows);
  const usedIds = new Set<string>();
  matches.forEach((m) => {
    if (m.entry) usedIds.add(m.entry.id);
  });

  const seeds: JournalEntry[] = [];
  matches.forEach((m) => {
    if (!m.entry) seeds.push(buildSeedEntry(m.statement, profile, rulesConfig));
  });

  const orphans = mobile.filter((entry) => !usedIds.has(entry.id));
  const matched = mobile.filter((entry) => usedIds.has(entry.id));

  return [...matched, ...seeds, ...orphans];
}
