import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  MoreHorizontal,
  Paperclip,
  Plus,
  Receipt,
  Send,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { OTPInput, type SlotProps } from "input-otp";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TEAM_MEMBERS,
  applyExpensePreset,
  buildMatches,
  buildSeedEntry,
  rememberMerchantPreset,
  rules,
  seedAttachedEntries,
  type MerchantPresetHistory,
} from "./data";
import {
  ALL_CATEGORIES,
  EXPENSE_PRESET_LABELS,
  EXPENSE_PRESETS,
  getCategories,
  getMealSupportLimit,
  inferMealSupportKind,
  isFoodCategory,
  isFoodMerchant,
  isReceiptRequired,
  pickAccount,
  validateForExport,
  type Category,
  type EntryIssue,
  type ExpensePreset,
  type JournalEntry,
  type MatchResult,
  type Photo,
  type Profile,
  type StatementRow,
} from "@exem/shared";
import {
  blobToObjectUrl,
  compressImage,
  deletePhoto,
  loadPhoto,
  newPhotoId,
  savePhoto,
} from "./db";
import { OnboardingScreen } from "./Onboarding";
import { Drawer, DrawerContent, DrawerTitle } from "./Drawer";
import {
  deleteServerSlot,
  fetchPhotoBlob,
  pullJournal,
  pushJournal,
} from "./api";
import { buildEvidenceSlots, buildWorkbook, downloadBlob } from "./xlsx";
import {
  computeAutoDescription,
  computeRequestedAmount,
  entrySheetFieldVisibility,
  isAutoDescription,
  quickAddPrefill,
  type QuickAddPreset,
} from "./quickAdd";
import { QuickAddSheet } from "./QuickAddSheet";

type ViewMode = "journal" | "sync";
type SyncStep = "pull" | "statement" | "match" | "download" | "done";

type ExpenseTotals = {
  charged: number;
  requested: number;
  personal: number;
};

type CompletionSummary = {
  month: number;
  usagePeriod: string;
  filename: string;
  itemCount: number;
  totals: ExpenseTotals;
  issueCount: number;
  serverDataCleared: boolean;
};

type FoodIntent =
  | { intent: "야근식대"; description: string; category: Category }
  | { intent: "휴일식대"; description: string; category: Category }
  | { intent: "회식"; description: string; category: Category }
  | { intent: "회의-주간"; description: string; category: Category }
  | { intent: "접대"; description: string; category: Category };

const FOOD_INTENTS: FoodIntent[] = [
  { intent: "야근식대", description: "야근 식대", category: "복리후생비" },
  { intent: "휴일식대", description: "휴일 출근 식대", category: "복리후생비" },
  { intent: "회식", description: "팀 회식", category: "회식비" },
  { intent: "회의-주간", description: "고객 미팅 (9~18시, 주류 X)", category: "회의비" },
  { intent: "접대", description: "고객 미팅 (그 외)", category: "접대비" },
];

type SheetForm = {
  occurredAt: string;
  vendorHint: string;
  expectedAmount: string;
  requestedAmount: string;
  requestedAmountManual: boolean;
  descriptionManual: boolean;
  category: Category;
  participants: string[];
  description: string;
  photoIds: string[];
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(): SheetForm {
  return {
    occurredAt: todayIso(),
    vendorHint: "",
    expectedAmount: "",
    requestedAmount: "",
    requestedAmountManual: false,
    descriptionManual: false,
    category: "복리후생비",
    participants: [],
    description: "",
    photoIds: [],
  };
}

function formatCurrency(value?: number) {
  if (typeof value !== "number") return "-";
  return `${value.toLocaleString("ko-KR")}원`;
}

function formatNumber(value?: number) {
  if (typeof value !== "number") return "-";
  return value.toLocaleString("ko-KR");
}

function formatDateLabel(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][parsed.getDay()];
  return `${parsed.getMonth() + 1}월 ${parsed.getDate()}일 (${weekday})`;
}

function getStatementYearMonth(matches: MatchResult[]) {
  const first = matches.find((m) => m.statement.usedAt)?.statement.usedAt;
  if (!first) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }
  const [year, month] = first.split(/[.-]/).map(Number);
  if (!year || !month) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }
  return { year, month };
}

function formatIsoWithWeekday(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][date.getUTCDay()];
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}(${weekday})`;
}

function getUsagePeriod(matches: MatchResult[]) {
  const { year, month } = getStatementYearMonth(matches);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${formatIsoWithWeekday(year, month, 1)} ~ ${formatIsoWithWeekday(year, month, lastDay)}`;
}

function calculateExpenseTotals(matches: MatchResult[]): ExpenseTotals {
  return matches.reduce(
    (acc, match) => {
      const requested = match.entry?.expectedAmount ?? match.statement.chargedAmount;
      return {
        charged: acc.charged + match.statement.chargedAmount,
        requested: acc.requested + requested,
        personal: acc.personal + Math.max(0, match.statement.chargedAmount - requested),
      };
    },
    { charged: 0, requested: 0, personal: 0 },
  );
}

function getApprovalGuide(profile: Profile) {
  if (profile.dept === "FE1팀") {
    return {
      line: profile.name === "강지명" ? "강지명 → 본부장" : `${profile.name} → 강지명`,
      designated: "정태규",
      note: "지정결재선은 자동 지정된 값을 유지하세요.",
    };
  }

  return {
    line: "기안자 → 소속 팀장",
    designated: "전자결재 양식의 지정결재선",
    note: "그룹장이 있는 조직은 결재 정보에서 팀장/그룹장/본부장 구조를 확인하세요.",
  };
}

function toDateInputValue(date: string) {
  return date.replaceAll(".", "-");
}

function normalizeAmount(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0;
  return Number(value.replaceAll(",", "").trim()) || 0;
}

function pickRecordValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return "";
}

async function parseStatementFile(file: File): Promise<StatementRow[]> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" });

  return records
    .map((record, index) => ({
      id: `upload-row-${index + 1}`,
      usedAt: String(pickRecordValue(record, ["이용일자", "사용일자", "승인일자"])),
      cardNumber: String(pickRecordValue(record, ["카드번호"])),
      userName: String(pickRecordValue(record, ["이용자명", "사용자명"])),
      employeeNo: String(pickRecordValue(record, ["사원번호"])),
      dept: String(pickRecordValue(record, ["부서명", "부서"])),
      usedAmount: normalizeAmount(pickRecordValue(record, ["국내이용금액", "이용금액"])),
      chargedAmount: normalizeAmount(pickRecordValue(record, ["국내청구금액", "청구금액"])),
      foreignAmount: String(pickRecordValue(record, ["해외현지금액"])),
      currency: String(pickRecordValue(record, ["통화코드"])) || "-",
      merchant: String(pickRecordValue(record, ["가맹점", "가맹점명"])),
      businessNo: String(pickRecordValue(record, ["가맹점사업자번호", "사업자번호"])),
      approvalNo: String(pickRecordValue(record, ["승인번호"])),
      installmentMonths: String(pickRecordValue(record, ["할부개월수"])),
      billingRound: String(pickRecordValue(record, ["청구회차"])),
    }))
    .filter((row) => row.usedAt && row.chargedAmount > 0);
}

function useLocalState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    const stored = window.localStorage.getItem(key);
    if (!stored) return initial;
    try {
      return JSON.parse(stored) as T;
    } catch {
      return initial;
    }
  });

  const update = (next: T | ((current: T) => T)) => {
    setValue((current) => {
      const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(key, JSON.stringify(resolved));
      }
      return resolved;
    });
  };

  return [value, update] as const;
}

function detectMode(): ViewMode {
  if (typeof window === "undefined") return "sync";
  // 터치(pointer: coarse) 또는 좁은 화면이면 모바일 저널, 그 외엔 데스크톱 정산.
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const narrow = window.innerWidth < 920;
  return coarse || narrow ? "journal" : "sync";
}

function useViewMode(): ViewMode {
  const [mode, setMode] = useState<ViewMode>(() => detectMode());

  useEffect(() => {
    const sync = () => setMode(detectMode());
    window.addEventListener("resize", sync);
    const mq = window.matchMedia?.("(pointer: coarse)");
    mq?.addEventListener?.("change", sync);
    return () => {
      window.removeEventListener("resize", sync);
      mq?.removeEventListener?.("change", sync);
    };
  }, []);

  return mode;
}

export default function App() {
  const [profile, setProfile] = useLocalState<Profile | null>("exem-profile", null);
  const [entries, setEntries] = useLocalState<JournalEntry[]>("exem-journal", []);
  const [pushReceipt, setPushReceipt] = useLocalState<{
    pin: string;
    pinExpiresAt: number;
    slotExpiresAt: number;
  } | null>("exem-push-receipt", null);

  const mode = useViewMode();
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [pendingPreset, setPendingPreset] = useState<QuickAddPreset | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);

  const total = useMemo(
    () => entries.reduce((sum, entry) => sum + (entry.expectedAmount ?? 0), 0),
    [entries],
  );
  const draftCount = entries.filter((entry) => entry.draft).length;

  // ↑ 모든 hook 호출 이후 early return (Rules of Hooks 준수)
  if (!profile) {
    return <OnboardingScreen onStart={(next) => setProfile(next)} />;
  }

  const openAdd = () => {
    setEditingEntry(null);
    setPendingPreset(null);
    setQuickAddOpen(true);
  };

  const openEdit = (entry: JournalEntry) => {
    setEditingEntry(entry);
    setPendingPreset(null);
    setSheetOpen(true);
  };

  const handleQuickAddPick = (preset: QuickAddPreset) => {
    setQuickAddOpen(false);
    setEditingEntry(null);
    setPendingPreset(preset);
    setSheetOpen(true);
  };

  const handleSave = (form: SheetForm, draft: boolean) => {
    const now = new Date().toISOString();
    const participants = form.participants.filter(Boolean);

    const expectedNumber = form.expectedAmount ? Number(form.expectedAmount) : undefined;
    const requestedNumber = form.requestedAmount ? Number(form.requestedAmount) : undefined;

    if (editingEntry) {
      const next: JournalEntry = {
        ...editingEntry,
        occurredAt: form.occurredAt,
        vendorHint: form.vendorHint.trim(),
        expectedAmount: expectedNumber,
        requestedAmount: requestedNumber,
        category: form.category,
        participants,
        description: form.description.trim(),
        draft,
        photoIds: form.photoIds,
        updatedAt: now,
      };
      setEntries((current) => current.map((entry) => (entry.id === next.id ? next : entry)));
    } else {
      const entry: JournalEntry = {
        id: `entry-${Date.now()}`,
        occurredAt: form.occurredAt,
        vendorHint: form.vendorHint.trim(),
        expectedAmount: expectedNumber,
        requestedAmount: requestedNumber,
        category: form.category,
        preset: pendingPreset && pendingPreset !== "manual" ? pendingPreset : undefined,
        participants,
        description: form.description.trim(),
        draft,
        photoIds: form.photoIds,
        createdAt: now,
        updatedAt: now,
      };
      setEntries((current) => [entry, ...current]);
    }
    setSheetOpen(false);
    setEditingEntry(null);
    setPendingPreset(null);
  };

  const removeEntry = async (entry: JournalEntry) => {
    setEntries((current) => current.filter((e) => e.id !== entry.id));
    for (const photoId of entry.photoIds) {
      await deletePhoto(photoId);
    }
  };

  const handlePush = async () => {
    try {
      const res = await pushJournal({
        dept: profile.dept,
        name: profile.name,
        entries,
      });
      setPushReceipt({
        pin: res.pin,
        pinExpiresAt: new Date(res.pinExpiresAt).getTime(),
        slotExpiresAt: new Date(res.slotExpiresAt).getTime(),
      });
      setPinModalOpen(true);
    } catch (err) {
      alert(`보내지 못했어요: ${(err as Error).message}`);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <FileSpreadsheet size={16} aria-hidden="true" />
          </div>
          경비
        </div>
        <div className="topbar-actions">
          <button type="button" className="icon-button" onClick={() => setSettingsOpen(true)}>
            <Settings size={18} aria-hidden="true" />
            <span className="sr-only">설정</span>
          </button>
        </div>
      </header>

      <main className="main-screen">
        {mode === "journal" ? (
          <JournalScreen
            entries={entries}
            total={total}
            draftCount={draftCount}
            onOpenAdd={openAdd}
            onPushClick={handlePush}
            onEdit={openEdit}
          />
        ) : (
          <SyncFunnel profile={profile} />
        )}
      </main>

      {quickAddOpen ? (
        <QuickAddSheet
          onPick={handleQuickAddPick}
          onClose={() => setQuickAddOpen(false)}
        />
      ) : null}

      {sheetOpen ? (
        <EntrySheet
          initial={editingEntry}
          profileName={profile.name}
          rules={rules}
          preset={pendingPreset}
          onClose={() => {
            setSheetOpen(false);
            setEditingEntry(null);
            setPendingPreset(null);
          }}
          onSave={(form) => handleSave(form, false)}
          onDraft={(form) => handleSave(form, true)}
          onDelete={
            editingEntry
              ? () => {
                  removeEntry(editingEntry);
                  setSheetOpen(false);
                  setEditingEntry(null);
                  setPendingPreset(null);
                }
              : undefined
          }
        />
      ) : null}

      {pinModalOpen && pushReceipt ? (
        <PinRevealModal
          pin={pushReceipt.pin}
          expiresAt={pushReceipt.pinExpiresAt}
          onClose={() => setPinModalOpen(false)}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsSheet
          profile={profile}
          setProfile={setProfile}
          entries={entries}
          onResetMonth={() => setEntries([])}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}

/* ===================== Mobile: Journal ===================== */

function JournalScreen({
  entries,
  total,
  draftCount,
  onOpenAdd,
  onPushClick,
  onEdit,
}: {
  entries: JournalEntry[];
  total: number;
  draftCount: number;
  onOpenAdd: () => void;
  onPushClick: () => void;
  onEdit: (entry: JournalEntry) => void;
}) {
  const month = new Date().getMonth() + 1;
  return (
    <section className="journal-screen">
      <header className="journal-hero">
        <p className="eyeline">{month}월 경비</p>
        <h1>{entries.length}건</h1>
        <p className="total">{formatCurrency(total)}</p>
        <p className="meta">그때그때 기록해두고, 월말에 한 번에 PC로 보내요</p>
        {draftCount > 0 ? (
          <p className="meta">
            <span className="draft-flag">마저 적기 {draftCount}</span>
          </p>
        ) : null}
      </header>

      {entries.length === 0 ? (
        <div className="empty-state">
          <strong>아직 기록이 없어요</strong>
          <p>오른쪽 아래 ＋를 눌러 추가하세요</p>
        </div>
      ) : (
        <div className="entry-list">
          {entries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} onClick={() => onEdit(entry)} />
          ))}
        </div>
      )}

      <button
        type="button"
        className="floating-add"
        onClick={onOpenAdd}
        aria-label="새 항목 추가"
      >
        <Plus size={24} aria-hidden="true" />
      </button>

      <div className="bottom-bar">
        <div className="inner">
          <button type="button" className="primary-button full" onClick={onPushClick}>
            <Send size={18} aria-hidden="true" />
            PC로 보내기
          </button>
        </div>
      </div>
    </section>
  );
}

function EntryCard({ entry, onClick }: { entry: JournalEntry; onClick: () => void }) {
  const [thumb, setThumb] = useState<string | undefined>(undefined);
  useEffect(() => {
    let url: string | undefined;
    let cancelled = false;
    (async () => {
      const id = entry.photoIds[0];
      if (!id) return;
      const blob = await loadPhoto(id);
      if (!blob || cancelled) return;
      url = await blobToObjectUrl(blob);
      if (!cancelled) setThumb(url);
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [entry.photoIds]);

  return (
    <button
      type="button"
      className={entry.draft ? "entry-row draft" : "entry-row"}
      onClick={onClick}
    >
      <div
        className="receipt-thumb"
        style={thumb ? { backgroundImage: `url(${thumb})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
      >
        {!thumb ? <Camera size={18} aria-hidden="true" /> : null}
      </div>
      <div className="entry-body">
        <div className="entry-title">
          <strong>{entry.vendorHint || (entry.draft ? "사진만 있어요" : "가게 이름 없음")}</strong>
          <b>{formatCurrency(entry.expectedAmount)}</b>
        </div>
        <p className="entry-sub">
          <span>{formatDateLabel(entry.occurredAt)}</span>
          <span className="dot">·</span>
          {entry.draft ? (
            <span className="warn">마저 적기</span>
          ) : (
            <span>{entry.description || entry.category}</span>
          )}
        </p>
      </div>
      <ChevronRight size={16} aria-hidden="true" style={{ color: "var(--soft)" }} />
    </button>
  );
}

/* ===================== Add/Edit entry sheet ===================== */

function EntrySheet({
  initial,
  profileName,
  rules: rulesConfig,
  preset,
  onClose,
  onSave,
  onDraft,
  onDelete,
}: {
  initial: JournalEntry | null;
  profileName: string;
  rules: typeof rules;
  preset: QuickAddPreset | null;
  onClose: () => void;
  onSave: (form: SheetForm) => void;
  onDraft: (form: SheetForm) => void;
  onDelete?: () => void;
}) {
  const [form, setForm] = useState<SheetForm>(() => {
    if (initial) {
      return {
        occurredAt: initial.occurredAt,
        vendorHint: initial.vendorHint,
        expectedAmount: initial.expectedAmount?.toString() ?? "",
        requestedAmount: initial.requestedAmount?.toString() ?? "",
        // 편집 모드는 사용자가 이전에 입력해 둔 값을 보존한다.
        requestedAmountManual: initial.requestedAmount !== undefined,
        descriptionManual: !isAutoDescription(initial.description),
        category: initial.category,
        participants: [...initial.participants],
        description: initial.description,
        photoIds: [...initial.photoIds],
      };
    }
    const base = emptyForm();
    if (preset) {
      const prefill = quickAddPrefill(preset, profileName);
      base.participants = prefill.participants;
      if (prefill.category) base.category = prefill.category;
      if (prefill.description) base.description = prefill.description;
      return base;
    }
    if (TEAM_MEMBERS.includes(profileName)) base.participants = [profileName];
    return base;
  });
  const visibility = useMemo(() => entrySheetFieldVisibility(preset), [preset]);
  const mealLimits = useMemo(
    () => ({
      lateMeal: getMealSupportLimit(rulesConfig, "야근"),
      holidayMeal: getMealSupportLimit(rulesConfig, "휴일"),
    }),
    [rulesConfig],
  );
  const categoryOptions = useMemo(() => getCategories(rulesConfig), [rulesConfig]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  // 카테고리 자동 추천 (preset이 명시된 경우 사용자 의도를 우선해 자동 변경하지 않음)
  useEffect(() => {
    if (initial) return;
    if (preset && preset !== "manual") return;
    const suggested = pickAccount(rulesConfig, form.vendorHint);
    if (suggested && suggested !== form.category) {
      setForm((current) => ({ ...current, category: suggested }));
    }
  }, [form.vendorHint, form.category, initial, rulesConfig, preset]);

  // 신청 금액 자동 계산: 사용자가 직접 수정하지 않았다면 결제 금액 + 참석자 수 기반 한도로 재계산.
  const expectedNumber = Number(form.expectedAmount) || 0;
  const participantCount = form.participants.length;
  useEffect(() => {
    if (form.requestedAmountManual) return;
    const auto = computeRequestedAmount(preset, expectedNumber, participantCount, mealLimits);
    const next = auto > 0 ? String(auto) : "";
    setForm((current) =>
      current.requestedAmount === next ? current : { ...current, requestedAmount: next },
    );
  }, [preset, expectedNumber, participantCount, mealLimits, form.requestedAmountManual]);

  // 내용 자동 채움: 야근/휴일 식대 N인, 택시는 "야근 택시비". 사용자가 직접 수정한 텍스트는 보존.
  useEffect(() => {
    if (form.descriptionManual) return;
    const auto = computeAutoDescription(preset, participantCount);
    if (auto === null) return;
    setForm((current) =>
      current.description === auto ? current : { ...current, description: auto },
    );
  }, [preset, participantCount, form.descriptionManual]);

  // 사진 미리보기
  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      const next: Record<string, string> = {};
      for (const id of form.photoIds) {
        if (thumbs[id]) {
          next[id] = thumbs[id];
          continue;
        }
        const blob = await loadPhoto(id);
        if (!blob || cancelled) continue;
        const url = await blobToObjectUrl(blob);
        urls.push(url);
        next[id] = url;
      }
      if (!cancelled) setThumbs(next);
    })();
    return () => {
      cancelled = true;
      // URL 해제는 컴포넌트 unmount 시 일괄. 여기서 즉시 revoke 하면 미리보기가 깨짐.
      void urls;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.photoIds.join(",")]);

  const update = <Key extends keyof SheetForm>(key: Key, value: SheetForm[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const list = Array.from(files).slice(0, 8);
    const newIds: string[] = [];
    for (const file of list) {
      const blob = await compressImage(file);
      const id = newPhotoId();
      await savePhoto(id, blob);
      newIds.push(id);
    }
    update("photoIds", [...form.photoIds, ...newIds]);
  };

  const removePhoto = async (id: string) => {
    await deletePhoto(id);
    update("photoIds", form.photoIds.filter((x) => x !== id));
  };

  const toggleMember = (name: string) => {
    if (form.participants.includes(name)) {
      update(
        "participants",
        form.participants.filter((x) => x !== name),
      );
    } else {
      update("participants", [...form.participants, name]);
    }
  };

  const applyFoodIntent = (intent: FoodIntent) => {
    setForm((current) => {
      const next: SheetForm = { ...current, category: intent.category };
      if (!current.description) {
        next.description = intent.description;
        next.descriptionManual = true;
      }
      return next;
    });
  };

  const showFoodIntent =
    visibility.foodIntent && isFoodMerchant(rulesConfig, form.vendorHint);
  const receiptRequired =
    visibility.vendor && isReceiptRequired(rulesConfig, form.vendorHint);

  const canSave = Boolean(
    form.occurredAt &&
      form.expectedAmount &&
      form.description &&
      (!visibility.requiresParticipants || form.participants.length > 0),
  );

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent className="sheet">
        <div className="sheet-header">
          <DrawerTitle>{initial ? "수정하기" : presetTitle(preset)}</DrawerTitle>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={18} aria-hidden="true" />
            <span className="sr-only">닫기</span>
          </button>
        </div>

        <div className="sheet-form">
          <PhotoBlock
            photoIds={form.photoIds}
            thumbs={thumbs}
            onPick={addPhotos}
            onRemove={removePhoto}
          />

          <div className="field">
            <span className="field-label">결제 금액</span>
            <input
              className="field-input"
              type="number"
              inputMode="numeric"
              placeholder="47000"
              value={form.expectedAmount}
              onChange={(event) => update("expectedAmount", event.target.value)}
            />
            {visibility.taxiReceiptHint ? (
              <p className="field-hint">
                <Receipt size={14} aria-hidden="true" /> 탑승 시간이 보이는 영수증 사진을 첨부해 주세요
              </p>
            ) : null}
          </div>

          {visibility.participants ? (
            <div className="field">
              <span className="field-label">함께한 사람 ({form.participants.length}명)</span>
              <div className="member-toggles">
                {TEAM_MEMBERS.map((name) => {
                  const active = form.participants.includes(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      className={active ? "member-toggle active" : "member-toggle"}
                      onClick={() => toggleMember(name)}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
              {isFoodCategory(form.category) && form.participants.length === 0 ? (
                <p className="field-hint warn">
                  <AlertTriangle size={14} aria-hidden="true" /> 식사 자리면 함께한 사람을 모두 골라주세요
                </p>
              ) : null}
            </div>
          ) : null}

          {visibility.requestedAmount ? (
            <div className="field">
              <span className="field-label">신청 금액</span>
              <input
                className="field-input"
                type="number"
                inputMode="numeric"
                placeholder="0"
                value={form.requestedAmount}
                onChange={(event) => {
                  const value = event.target.value;
                  setForm((current) => ({
                    ...current,
                    requestedAmount: value,
                    // 빈 칸으로 비우면 자동 계산을 다시 받겠다는 뜻으로 본다.
                    requestedAmountManual: value !== "",
                  }));
                }}
              />
              <p className="field-hint">{requestedAmountHint(preset, mealLimits, form.requestedAmountManual)}</p>
            </div>
          ) : null}

          <div className="field">
            <span className="field-label">내용</span>
            <input
              className="field-input"
              type="text"
              placeholder="야근 식대 4인"
              value={form.description}
              onChange={(event) => {
                const value = event.target.value;
                setForm((current) => ({
                  ...current,
                  description: value,
                  // 비우면 자동 채우기를 다시 켠다.
                  descriptionManual: value.trim() !== "",
                }));
              }}
            />
          </div>

          <div className="field">
            <span className="field-label">날짜</span>
            <input
              className="field-input"
              type="date"
              value={form.occurredAt}
              onChange={(event) => update("occurredAt", event.target.value)}
            />
          </div>

          {visibility.vendor ? (
            <div className="field">
              <span className="field-label">가맹점</span>
              <input
                className="field-input"
                type="text"
                placeholder="낮밤키친"
                value={form.vendorHint}
                onChange={(event) => update("vendorHint", event.target.value)}
              />
              {receiptRequired && form.photoIds.length === 0 ? (
                <p className="field-hint warn">
                  <AlertTriangle size={14} aria-hidden="true" /> 영수증 사진이 필수인 가맹점이에요
                </p>
              ) : null}
            </div>
          ) : null}

          {showFoodIntent ? (
            <div className="field">
              <span className="field-label">어떤 자리였어요?</span>
              <div className="intent-grid">
                {FOOD_INTENTS.map((intent) => (
                  <button
                    key={intent.intent}
                    type="button"
                    className={form.category === intent.category && form.description.includes(intent.description) ? "intent-chip active" : "intent-chip"}
                    onClick={() => applyFoodIntent(intent)}
                  >
                    {intent.description}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {visibility.category ? (
            <div className="field">
              <span className="field-label">계정</span>
              <select
                className="field-select"
                value={form.category}
                onChange={(event) => update("category", event.target.value as Category)}
              >
                {categoryOptions.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="sheet-actions">
            <button type="button" className="secondary-button" onClick={() => onDraft(form)}>
              임시저장
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!canSave}
              onClick={() => onSave(form)}
            >
              저장
            </button>
          </div>
          {onDelete ? (
            <button type="button" className="danger-button" onClick={onDelete}>
              <Trash2 size={16} aria-hidden="true" /> 삭제
            </button>
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function requestedAmountHint(
  preset: QuickAddPreset | null,
  limits: { lateMeal: number; holidayMeal: number },
  manual: boolean,
): string {
  if (manual) {
    return "직접 입력한 금액으로 신청해요. 비우면 자동 계산으로 돌아가요";
  }
  switch (preset) {
    case "late_meal":
      return `참석자 1인당 ${limits.lateMeal.toLocaleString("ko-KR")}원 한도까지 자동으로 계산해요`;
    case "holiday_meal":
      return `참석자 1인당 ${limits.holidayMeal.toLocaleString("ko-KR")}원 한도까지 자동으로 계산해요`;
    case "taxi":
      return "한도 없이 결제 금액 그대로 신청해요";
    case "manual":
    case null:
    default:
      return "결제 금액과 같게 두거나, 회사에 신청할 금액으로 직접 적어주세요";
  }
}

function presetTitle(preset: QuickAddPreset | null): string {
  switch (preset) {
    case "late_meal":
      return "야근 식대 등록";
    case "holiday_meal":
      return "휴일 식대 등록";
    case "taxi":
      return "택시비 등록";
    case "manual":
    case null:
    default:
      return "새로 추가";
  }
}

function PhotoBlock({
  photoIds,
  thumbs,
  onPick,
  onRemove,
}: {
  photoIds: string[];
  thumbs: Record<string, string>;
  onPick: (files: FileList | null) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="photo-block">
      <div className="photo-grid">
        {photoIds.map((id) => (
          <div key={id} className="photo-cell" style={thumbs[id] ? { backgroundImage: `url(${thumbs[id]})` } : undefined}>
            {!thumbs[id] ? <Camera size={18} aria-hidden="true" /> : null}
            <button type="button" className="photo-remove" onClick={() => onRemove(id)} aria-label="삭제">
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        ))}
        <label className="photo-add">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={(event) => onPick(event.target.files)}
          />
          <Plus size={18} aria-hidden="true" />
          <span>{photoIds.length === 0 ? "사진 추가" : "더 추가"}</span>
        </label>
      </div>
    </div>
  );
}

/* ===================== PIN reveal modal ===================== */

function PinRevealModal({
  pin,
  expiresAt,
  onClose,
}: {
  pin: string;
  expiresAt: number;
  onClose: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remainingMs = Math.max(0, expiresAt - now);
  const minutes = Math.floor(remainingMs / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000);

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent className="sheet">
        <DrawerTitle className="sr-only">PIN 확인</DrawerTitle>
        <div className="pin-reveal">
          <p className="label">PC에 이 숫자를 입력하세요</p>
          <div className="pin">
            {pin.split("").map((digit, index) => (
              <span key={index}>{digit}</span>
            ))}
          </div>
          <p className="timer">
            {minutes}분 {String(seconds).padStart(2, "0")}초 후 만료
          </p>
        </div>
        <div className="sheet-actions">
          <button type="button" className="primary-button full" onClick={onClose}>
            확인
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/* ===================== Settings ===================== */

function SettingsSheet({
  profile,
  setProfile,
  entries,
  onResetMonth,
  onClose,
}: {
  profile: Profile;
  setProfile: (profile: Profile) => void;
  entries: JournalEntry[];
  onResetMonth: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(profile);

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent className="sheet">
        <div className="sheet-header">
          <DrawerTitle>설정</DrawerTitle>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={18} aria-hidden="true" />
            <span className="sr-only">닫기</span>
          </button>
        </div>

        <div className="sheet-form">
          <div className="field-row">
            <div className="field">
              <span className="field-label">부서</span>
              <input
                className="field-input"
                value={draft.dept}
                onChange={(event) => setDraft({ ...draft, dept: event.target.value })}
              />
            </div>
            <div className="field">
              <span className="field-label">이름</span>
              <input
                className="field-input"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>
          </div>

          <div className="settings-section">
            <h3>이번 달 기록</h3>
            <p className="hint">{entries.length}건</p>
            <button
              type="button"
              className="danger-button full"
              onClick={onResetMonth}
              style={{ marginTop: 12 }}
            >
              <Trash2 size={14} aria-hidden="true" /> 모두 지우기
            </button>
          </div>

          <div className="sheet-actions">
            <button type="button" className="secondary-button" onClick={onClose}>
              취소
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                setProfile(draft);
                onClose();
              }}
            >
              저장
            </button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/* ===================== PC Funnel ===================== */

type PulledData = {
  entries: JournalEntry[];
  photos: Photo[];
  pullToken: string;
};

function SyncFunnel({ profile }: { profile: Profile }) {
  const [step, setStep] = useState<SyncStep>("pull");
  const [pulled, setPulled] = useState<PulledData | null>(null);
  const [photoBlobs, setPhotoBlobs] = useState<Map<string, Blob>>(new Map());
  const [statementRows, setStatementRows] = useState<StatementRow[]>([]);
  const [statementFile, setStatementFile] = useState<string | null>(null);
  const [statementError, setStatementError] = useState("");
  const [pulledEntries, setPulledEntries] = useState<JournalEntry[]>([]);
  const [completionSummary, setCompletionSummary] = useState<CompletionSummary | null>(null);
  const [presetHistory, setPresetHistory] = useLocalState<MerchantPresetHistory>(
    "exem-merchant-preset-history",
    {},
  );

  const matches = useMemo(
    () => buildMatches(pulledEntries, statementRows),
    [pulledEntries, statementRows],
  );
  const exactCount = matches.filter((m) => m.status === "exact").length;
  const reviewCount = matches.filter((m) => m.status === "review").length;
  const totals = useMemo(() => calculateExpenseTotals(matches), [matches]);

  const validationIssues = useMemo(() => {
    const out: { match: MatchResult; issues: EntryIssue[] }[] = [];
    matches.forEach((match) => {
      if (!match.entry) return;
      const found = validateForExport(rules, match.entry, match.statement);
      if (found.length > 0) out.push({ match, issues: found });
    });
    return out;
  }, [matches]);

  // 명세서 = SSoT. 매칭에 사용되지 않는 모바일 entry는 출력에 포함되지 않으므로 별도 안내.
  const orphanEntries = useMemo(
    () =>
      pulledEntries.filter(
        (entry) => !entry.draft && !matches.some((m) => m.entry?.id === entry.id),
      ),
    [pulledEntries, matches],
  );

  const completePull = async (pin: string) => {
    const res = await pullJournal({ dept: profile.dept, name: profile.name, pin });
    setPulled({ entries: res.entries, photos: res.photoMeta, pullToken: res.pullToken });
    setPulledEntries(res.entries);
    const blobs = new Map<string, Blob>();
    for (const meta of res.photoMeta) {
      try {
        const blob = await fetchPhotoBlob({
          dept: profile.dept,
          name: profile.name,
          token: res.pullToken,
          photo: meta,
        });
        blobs.set(meta.id, blob);
      } catch {
        // skip
      }
    }
    setPhotoBlobs(blobs);
    setStep("statement");
  };

  const skipPull = () => {
    // 모바일 데이터 없이 PC만으로 시작. 서버 슬롯이 없으므로 pullToken은 빈 문자열.
    setPulled({ entries: [], photos: [], pullToken: "" });
    setPulledEntries([]);
    setPhotoBlobs(new Map());
    setStep("statement");
  };

  const handleStatementUploaded = (parsed: StatementRow[], fileName: string) => {
    // 명세서 1행 = 표 1행. 매칭되지 않는 row는 자동 시드 entry로 채워 SSoT 보장.
    const seeded = seedAttachedEntries(parsed, pulledEntries, profile, rules, presetHistory);
    setPulledEntries(seeded);
    setStatementRows(parsed);
    setStatementFile(fileName);
    setCompletionSummary(null);
    setStep("match");
  };

  const handleStatementBack = () => {
    // 같은 파일 재선택을 위해 이전으로 갈 때 명세서 state 모두 리셋.
    setStatementRows([]);
    setStatementFile(null);
    setStatementError("");
    setStep("pull");
  };

  const updateEntry = useCallback((id: string, patch: Partial<JournalEntry>) => {
    const now = new Date().toISOString();
    setPulledEntries((current) =>
      current.map((entry) =>
        entry.id === id ? { ...entry, ...patch, updatedAt: now } : entry,
      ),
    );
  }, []);

  const resetEntry = useCallback(
    (id: string) => {
      // 부착된 명세서 row를 찾아 시드 entry로 되돌림 (행 삭제가 아닌 입력 초기화).
      const target = matches.find((m) => m.entry?.id === id);
      if (!target) return;
      const seed = buildSeedEntry(target.statement, profile, rules, presetHistory);
      setPulledEntries((current) =>
        current.map((entry) => (entry.id === id ? { ...seed, id: entry.id } : entry)),
      );
    },
    [matches, presetHistory, profile],
  );

  const rememberPreset = useCallback(
    (merchant: string, preset: ExpensePreset) => {
      setPresetHistory((current) => rememberMerchantPreset(current, merchant, preset));
    },
    [setPresetHistory],
  );

  const addReceipt = useCallback(async (entryId: string, files: FileList) => {
    const incoming = Array.from(files).slice(0, 8);
    if (incoming.length === 0) return;
    const compressed: { id: string; blob: Blob }[] = [];
    for (const file of incoming) {
      const blob = await compressImage(file);
      compressed.push({ id: newPhotoId(), blob });
    }
    setPhotoBlobs((prev) => {
      const next = new Map(prev);
      compressed.forEach(({ id, blob }) => next.set(id, blob));
      return next;
    });
    const newIds = compressed.map((c) => c.id);
    const now = new Date().toISOString();
    setPulledEntries((current) =>
      current.map((entry) =>
        entry.id === entryId
          ? { ...entry, photoIds: [...entry.photoIds, ...newIds], updatedAt: now }
          : entry,
      ),
    );
  }, []);

  const removeReceipt = useCallback((entryId: string, photoId: string) => {
    const now = new Date().toISOString();
    setPulledEntries((current) =>
      current.map((entry) =>
        entry.id === entryId
          ? {
              ...entry,
              photoIds: entry.photoIds.filter((p) => p !== photoId),
              updatedAt: now,
            }
          : entry,
      ),
    );
  }, []);

  const handleDownload = useCallback(async () => {
    if (!pulled) return;
    const { year, month } = getStatementYearMonth(matches);
    const evidenceSlots = await buildEvidenceSlots({
      matches,
      resolvePhoto: async (id) => photoBlobs.get(id),
    });
    const { buffer, filename } = await buildWorkbook({
      profile,
      matches,
      evidenceSlots,
    });
    downloadBlob(buffer, filename);
    let serverDataCleared = !pulled.pullToken;
    if (pulled.pullToken) {
      // PC 단독 모드(skipPull)는 서버 슬롯이 없으므로 deleteServerSlot 호출도 생략.
      try {
        await deleteServerSlot({
          dept: profile.dept,
          name: profile.name,
          token: pulled.pullToken,
        });
        serverDataCleared = true;
      } catch {
        serverDataCleared = false;
      }
    }
    setCompletionSummary({
      month,
      usagePeriod: `${formatIsoWithWeekday(year, month, 1)} ~ ${formatIsoWithWeekday(
        year,
        month,
        new Date(Date.UTC(year, month, 0)).getUTCDate(),
      )}`,
      filename,
      itemCount: matches.length,
      totals: calculateExpenseTotals(matches),
      issueCount: validationIssues.reduce((sum, item) => sum + item.issues.length, 0),
      serverDataCleared,
    });
    setStep("done");
  }, [matches, photoBlobs, profile, pulled, validationIssues]);

  const stepIndex = step === "pull" ? 0 : step === "statement" ? 1 : step === "match" ? 2 : 3;

  if (step === "done") {
    const summary =
      completionSummary ??
      ({
        month: getStatementYearMonth(matches).month,
        usagePeriod: getUsagePeriod(matches),
        filename: `(카드)제경비신청서_${getStatementYearMonth(matches).month}월_${profile.dept}_${profile.name}.xlsx`,
        itemCount: matches.length,
        totals,
        issueCount: validationIssues.reduce((sum, item) => sum + item.issues.length, 0),
        serverDataCleared: true,
      } satisfies CompletionSummary);

    return (
      <div className="funnel">
        <DoneStep
          profile={profile}
          summary={summary}
          onReview={() => setStep("match")}
          onReset={() => {
            setStep("pull");
            setPulled(null);
            setPhotoBlobs(new Map());
            setStatementRows([]);
            setStatementFile(null);
            setStatementError("");
            setPulledEntries([]);
            setCompletionSummary(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className={`funnel ${step === "match" ? "funnel-wide" : ""}`}>
      <FunnelProgress current={stepIndex} />

      {step === "pull" ? (
        <PullStep profile={profile} onComplete={completePull} onSkip={skipPull} />
      ) : null}

      {step === "statement" ? (
        <StatementStep
          file={statementFile}
          error={statementError}
          onChange={async (file) => {
            if (!file) return;
            try {
              setStatementError("");
              const parsed = await parseStatementFile(file);
              if (parsed.length === 0) {
                setStatementError("이 파일에서 카드 결제 내역을 찾지 못했어요.");
                return;
              }
              handleStatementUploaded(parsed, file.name);
            } catch {
              setStatementError("파일을 열지 못했어요. .xls 또는 .xlsx 파일이 맞는지 확인해주세요.");
            }
          }}
          onBack={handleStatementBack}
        />
      ) : null}

      {step === "match" ? (
        <MatchStep
          profile={profile}
          matches={matches}
          orphanEntries={orphanEntries}
          photoBlobs={photoBlobs}
          exactCount={exactCount}
          reviewCount={reviewCount}
          validationIssues={validationIssues}
          onUpdateEntry={updateEntry}
          onResetEntry={resetEntry}
          onRememberPreset={rememberPreset}
          onAddReceipt={addReceipt}
          onRemoveReceipt={removeReceipt}
          onBack={() => setStep("statement")}
          onNext={() => setStep("download")}
        />
      ) : null}

      {step === "download" ? (
        <DownloadStep
          profile={profile}
          matches={matches}
          total={totals.charged}
          validationIssues={validationIssues}
          onBack={() => setStep("match")}
          onDownload={handleDownload}
        />
      ) : null}
    </div>
  );
}

function CopyableValue({
  value,
  label,
  display,
  size = "md",
}: {
  value: string;
  label: string;
  display?: string;
  size?: "md" | "lg";
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // 클립보드 권한이 거부된 경우 무시 — 사용자가 직접 드래그 복사 가능
    }
  }, [value]);

  return (
    <button
      type="button"
      className={`copyable-value copyable-value--${size}${copied ? " is-copied" : ""}`}
      onClick={handleCopy}
      aria-label={`${label} ${value} 복사`}
    >
      <span className="copyable-value__text">{display ?? value}</span>
      <span className="copyable-value__hint" aria-hidden="true">
        {copied ? (
          <>
            <Check size={12} aria-hidden="true" /> 복사됨
          </>
        ) : (
          <>
            <Copy size={12} aria-hidden="true" /> 복사
          </>
        )}
      </span>
    </button>
  );
}

function FunnelProgress({ current }: { current: number }) {
  return (
    <div className="funnel-progress" aria-label="진행 단계">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={i < current ? "done" : i === current ? "active" : ""} />
      ))}
    </div>
  );
}

function DoneStep({
  profile,
  summary,
  onReview,
  onReset,
}: {
  profile: Profile;
  summary: CompletionSummary;
  onReview: () => void;
  onReset: () => void;
}) {
  const approval = getApprovalGuide(profile);

  return (
    <div className="done-screen done-screen-detailed">
      <div className="done-icon">
        <Check size={36} aria-hidden="true" />
      </div>
      <h2>다운로드 완료</h2>
      <p>이제 다우오피스 기안에 아래 값만 옮기면 됩니다.</p>

      <div className="done-summary-grid" aria-label="경비 신청 요약">
        <div className="done-summary-card">
          <span>합계</span>
          <CopyableValue
            value={formatNumber(summary.totals.charged)}
            label="합계"
            display={formatCurrency(summary.totals.charged)}
            size="lg"
          />
        </div>
        <div className="done-summary-card">
          <span>경비신청금액</span>
          <CopyableValue
            value={formatNumber(summary.totals.requested)}
            label="경비신청금액"
            display={formatCurrency(summary.totals.requested)}
            size="lg"
          />
        </div>
        <div className="done-summary-card">
          <span>개인사용금액</span>
          <CopyableValue
            value={formatNumber(summary.totals.personal)}
            label="개인사용금액"
            display={formatCurrency(summary.totals.personal)}
            size="lg"
          />
        </div>
      </div>

      <div className="next-step-panel">
        <div className="next-step-head">
          <h3>그룹웨어 결재 등록</h3>
          <a
            className="ghost-button next-step-link"
            href="https://gw.ex-em.com/app/approval/document/new/46/1699"
            target="_blank"
            rel="noreferrer"
          >
            열기 <ExternalLink size={14} aria-hidden="true" />
          </a>
        </div>
        <ol className="next-step-list">
          <li>
            <span>사용 월</span>
            <CopyableValue value={`${summary.month}월`} label="사용 월" />
          </li>
          <li>
            <span>사용 기간</span>
            <CopyableValue value={summary.usagePeriod} label="사용 기간" />
          </li>
          <li>
            <span>건수</span>
            <CopyableValue value={`${summary.itemCount}건`} label="건수" />
          </li>
          <li className="next-step-section">
            <span>결재선</span>
            <CopyableValue value={approval.line} label="결재선" />
          </li>
          <li>
            <span>지정결재선</span>
            <CopyableValue value={approval.designated} label="지정결재선" />
            <em>{approval.note}</em>
          </li>
        </ol>
      </div>

      {summary.issueCount > 0 ? (
        <div className="notice warning done-notice">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>첨부 전 확인할 안내가 {summary.issueCount}건 남아 있어요.</span>
        </div>
      ) : (
        <div className="notice success done-notice">
          <CheckCircle2 size={16} aria-hidden="true" />
          <span>영수증·동반인·한도 안내까지 확인됐어요.</span>
        </div>
      )}

      {summary.serverDataCleared ? (
        <p className="done-data-note">서버 임시 데이터 삭제 완료</p>
      ) : (
        <p className="done-data-note">서버 임시 데이터 삭제 상태를 확인해주세요.</p>
      )}

      <div className="done-actions">
        <button type="button" className="secondary-button" onClick={onReview}>
          다시 검토
        </button>
        <button type="button" className="primary-button" onClick={onReset}>
          처음으로
        </button>
      </div>
    </div>
  );
}

/* --- Step 1: Pull --- */

function PullStep({
  profile,
  onComplete,
  onSkip,
}: {
  profile: Profile;
  onComplete: (pin: string) => Promise<void>;
  onSkip: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (value: string) => {
    if (loading) return;
    if (value.length !== 4) {
      setError("4자리를 모두 입력해주세요");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await onComplete(value);
    } catch (err) {
      const status = (err as { status?: number }).status ?? 0;
      if (status === 401) setError("숫자가 다르거나 시간이 지났어요");
      else if (status === 404) setError("아직 휴대폰에서 보내기를 누르지 않았어요");
      else setError(`가져오지 못했어요: ${(err as Error).message}`);
      setPin("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="step">
      <h2 className="step-title">휴대폰에서 받아올게요</h2>
      <p className="step-sub">
        휴대폰에서 받은 숫자 4자리를 입력하세요.
      </p>

      <div className="step-body">
        <div className="field">
          <span className="field-label">내 정보</span>
          <input
            className="field-input"
            type="text"
            value={`${profile.dept} · ${profile.name}`}
            readOnly
          />
        </div>

        <div className="field">
          <span className="field-label">숫자 4자리</span>
          <OTPInput
            maxLength={4}
            value={pin}
            onChange={(value) => {
              setPin(value);
              if (error) setError("");
            }}
            onComplete={handleSubmit}
            containerClassName="otp-container"
            render={({ slots }) => (
              <div className="otp-slots">
                {slots.map((slot, index) => (
                  <PinSlot key={index} {...slot} />
                ))}
              </div>
            )}
          />
        </div>

        {error ? (
          <div className="notice error">
            <AlertTriangle size={16} aria-hidden="true" />
            {error}
          </div>
        ) : null}

        <div className="notice neutral">
          휴대폰에서 "PC로 보내기"를 누르면 숫자가 나와요.
        </div>
      </div>

      <div className="bottom-bar">
        <div className="inner">
          <div className="pull-actions">
            <button
              type="button"
              className="primary-button full"
              disabled={pin.length !== 4 || loading}
              onClick={() => handleSubmit(pin)}
            >
              {loading ? "가져오는 중…" : "가져오기"}
            </button>
            <button
              type="button"
              className="secondary-button full"
              onClick={onSkip}
              disabled={loading}
            >
              휴대폰 없이 시작
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PinSlot({ char, isActive, hasFakeCaret }: SlotProps) {
  return (
    <div className={`otp-slot${isActive ? " active" : ""}${char ? " filled" : ""}`}>
      {char ? <span>{char}</span> : null}
      {hasFakeCaret ? <div className="otp-caret" /> : null}
    </div>
  );
}

/* --- Step 2: Statement upload --- */

function StatementStep({
  file,
  error,
  onChange,
  onBack,
}: {
  file: string | null;
  error: string;
  onChange: (file?: File) => void;
  onBack: () => void;
}) {
  return (
    <div className="step">
      <button
        type="button"
        className="ghost-button"
        onClick={onBack}
        style={{ alignSelf: "flex-start", marginBottom: 8 }}
      >
        <ArrowLeft size={16} aria-hidden="true" /> 이전
      </button>

      <h2 className="step-title">카드 명세서를 올려주세요</h2>
      <p className="step-sub">
        현대카드에서 받은 .xls 파일을 올려주세요. 파일은 이 컴퓨터에서만 읽어요.
      </p>

      <div className="step-body">
        <label className="drop-zone">
          <input
            type="file"
            accept=".xls,.xlsx"
            onClick={(event) => {
              // 같은 파일을 다시 선택해도 onChange가 발화하도록 매번 value 리셋.
              (event.currentTarget as HTMLInputElement).value = "";
            }}
            onChange={(event) => onChange(event.target.files?.[0] ?? undefined)}
          />
          <Upload size={26} aria-hidden="true" />
          <strong>{file ?? "파일 선택"}</strong>
          <span>또는 여기로 끌어 놓으세요</span>
        </label>

        {error ? (
          <div className="notice error">
            <AlertTriangle size={16} aria-hidden="true" /> {error}
          </div>
        ) : null}

        <div className="notice neutral">
          <Sparkles size={14} aria-hidden="true" /> 필요한 항목은 자동으로 읽어요
        </div>
      </div>
    </div>
  );
}

/* --- Step 3: Match table --- */

function MatchStep({
  profile,
  matches,
  orphanEntries,
  photoBlobs,
  exactCount,
  reviewCount,
  validationIssues,
  onUpdateEntry,
  onResetEntry,
  onRememberPreset,
  onAddReceipt,
  onRemoveReceipt,
  onBack,
  onNext,
}: {
  profile: Profile;
  matches: MatchResult[];
  orphanEntries: JournalEntry[];
  photoBlobs: Map<string, Blob>;
  exactCount: number;
  reviewCount: number;
  validationIssues: { match: MatchResult; issues: EntryIssue[] }[];
  onUpdateEntry: (id: string, patch: Partial<JournalEntry>) => void;
  onResetEntry: (id: string) => void;
  onRememberPreset: (merchant: string, preset: ExpensePreset) => void;
  onAddReceipt: (entryId: string, files: FileList) => Promise<void>;
  onRemoveReceipt: (entryId: string, photoId: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const issuesByEntryId = useMemo(() => {
    const map = new Map<string, EntryIssue[]>();
    validationIssues.forEach(({ match, issues }) => {
      if (match.entry) map.set(match.entry.id, issues);
    });
    return map;
  }, [validationIssues]);

  const perPersonCount = validationIssues.filter((v) =>
    v.issues.some((i) => i.type === "per_person"),
  ).length;

  const totals = useMemo(() => {
    let charged = 0;
    let requested = 0;
    let personal = 0;
    matches.forEach((m) => {
      const req = m.entry?.expectedAmount ?? m.statement.chargedAmount;
      const per = Math.max(0, m.statement.chargedAmount - req);
      charged += m.statement.chargedAmount;
      requested += req;
      personal += per;
    });
    return { charged, requested, personal };
  }, [matches]);

  return (
    <div className="step step-wide">
      <button
        type="button"
        className="ghost-button"
        onClick={onBack}
        style={{ alignSelf: "flex-start", marginBottom: 8 }}
      >
        <ArrowLeft size={16} aria-hidden="true" /> 이전
      </button>

      <h2 className="step-title">결제 내역을 확인해주세요</h2>
      <p className="step-sub">
        총 {matches.length}건 · 자동 {exactCount}건 · 확인 필요 {reviewCount}건
        {perPersonCount > 0 ? ` · 한도 초과 ${perPersonCount}건` : ""}
      </p>

      <div className="step-body">
        {matches.length === 0 ? (
          <div className="notice neutral">명세서를 먼저 올려주세요.</div>
        ) : (
          <MatchTable
            profile={profile}
            matches={matches}
            issuesByEntryId={issuesByEntryId}
            photoBlobs={photoBlobs}
            totals={totals}
            onUpdateEntry={onUpdateEntry}
            onResetEntry={onResetEntry}
            onRememberPreset={onRememberPreset}
            onAddReceipt={onAddReceipt}
            onRemoveReceipt={onRemoveReceipt}
          />
        )}

        {orphanEntries.length > 0 ? (
          <div className="orphan-note">
            <AlertTriangle size={14} aria-hidden="true" />
            <div>
              명세서에 없는 항목 {orphanEntries.length}건은 파일에 포함되지 않아요:
              <ul>
                {orphanEntries.map((entry) => (
                  <li key={entry.id}>
                    {entry.occurredAt} · {entry.vendorHint || "(가게 이름 없음)"} · {(entry.expectedAmount ?? 0).toLocaleString()}원
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>

      <div className="bottom-bar">
        <div className="inner">
          <button type="button" className="primary-button full" onClick={onNext}>
            다음
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function MatchTable({
  profile,
  matches,
  issuesByEntryId,
  photoBlobs,
  totals,
  onUpdateEntry,
  onResetEntry,
  onRememberPreset,
  onAddReceipt,
  onRemoveReceipt,
}: {
  profile: Profile;
  matches: MatchResult[];
  issuesByEntryId: Map<string, EntryIssue[]>;
  photoBlobs: Map<string, Blob>;
  totals: { charged: number; requested: number; personal: number };
  onUpdateEntry: (id: string, patch: Partial<JournalEntry>) => void;
  onResetEntry: (id: string) => void;
  onRememberPreset: (merchant: string, preset: ExpensePreset) => void;
  onAddReceipt: (entryId: string, files: FileList) => Promise<void>;
  onRemoveReceipt: (entryId: string, photoId: string) => void;
}) {
  return (
    <div className="match-table-wrap">
      <table className="match-table">
        <thead>
          <tr>
            <th className="col-status" aria-label="상태"></th>
            <th>일자</th>
            <th>가맹점</th>
            <th className="th-num">청구</th>
            <th className="col-meta">카드번호</th>
            <th className="col-meta">이용자</th>
            <th className="col-meta">사원번호</th>
            <th className="col-meta">부서</th>
            <th className="col-meta th-num">사용금액</th>
            <th className="col-meta">사업자번호</th>
            <th className="col-meta">승인번호</th>
            <th className="col-meta th-num">할부</th>
            <th className="col-meta th-num">회차</th>
            <th>프리셋</th>
            <th>계정</th>
            <th>함께한 사람</th>
            <th>업무</th>
            <th className="th-num">신청</th>
            <th className="th-num">개인</th>
            <th>영수증</th>
            <th aria-label=""></th>
          </tr>
        </thead>
        <tbody>
          {matches.map((match) => (
            <MatchRow
              key={match.id}
              match={match}
              profile={profile}
              issues={match.entry ? issuesByEntryId.get(match.entry.id) ?? [] : []}
              photoBlobs={photoBlobs}
              onUpdateEntry={onUpdateEntry}
              onResetEntry={onResetEntry}
              onRememberPreset={onRememberPreset}
              onAddReceipt={onAddReceipt}
              onRemoveReceipt={onRemoveReceipt}
            />
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td></td>
            <td colSpan={2} className="td-foot-label">합계</td>
            <td className="td-num">{totals.charged.toLocaleString()}</td>
            <td colSpan={9}></td>
            <td colSpan={4}></td>
            <td className="td-num">{totals.requested.toLocaleString()}</td>
            <td className="td-num">{totals.personal.toLocaleString()}</td>
            <td colSpan={2}></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function MatchRow({
  match,
  profile,
  issues,
  photoBlobs,
  onUpdateEntry,
  onResetEntry,
  onRememberPreset,
  onAddReceipt,
  onRemoveReceipt,
}: {
  match: MatchResult;
  profile: Profile;
  issues: EntryIssue[];
  photoBlobs: Map<string, Blob>;
  onUpdateEntry: (id: string, patch: Partial<JournalEntry>) => void;
  onResetEntry: (id: string) => void;
  onRememberPreset: (merchant: string, preset: ExpensePreset) => void;
  onAddReceipt: (entryId: string, files: FileList) => Promise<void>;
  onRemoveReceipt: (entryId: string, photoId: string) => void;
}) {
  const stm = match.statement;
  const entry = match.entry;
  const requested = entry?.expectedAmount ?? stm.chargedAmount;
  const personal = Math.max(0, stm.chargedAmount - requested);

  const receiptIssue = issues.find((i) => i.type === "receipt");
  const perPersonIssue = issues.find((i) => i.type === "per_person");
  const participantsIssues = issues.filter((i) => i.type === "participants");
  const amountIssues = issues.filter((i) => i.type === "amount" || i.type === "per_person");
  const currentPreset = entry?.preset ?? "manual";

  const statusKind: "exact" | "review" | "warn" | "missing" = receiptIssue
    ? "missing"
    : match.status === "review"
    ? "review"
    : perPersonIssue || participantsIssues.length > 0
    ? "warn"
    : "exact";

  const statusTitle =
    receiptIssue?.message ?? participantsIssues[0]?.message ?? perPersonIssue?.message ?? match.reason;

  const placeholderDescription = useMemo(() => {
    if (!entry) return "";
    const isFood = isFoodMerchant(rules, stm.merchant) || isFoodCategory(entry.category);
    if (!isFood) return "";
    const n = entry.participants.length || 1;
    const head = currentPreset === "holiday_meal" ? "휴일" : "야근";
    return `${head} 식대 ${n}인`;
  }, [currentPreset, entry, stm.merchant]);

  const handlePresetChange = (preset: ExpensePreset) => {
    if (!entry) return;
    const next = applyExpensePreset(entry, stm, profile, rules, preset);
    onUpdateEntry(entry.id, {
      preset: next.preset,
      category: next.category,
      participants: next.participants,
      description: next.description,
      expectedAmount: next.expectedAmount,
    });
    onRememberPreset(stm.merchant, preset);
  };

  const handleParticipantToggle = (name: string) => {
    if (!entry) return;
    const nextParticipants = entry.participants.includes(name)
      ? entry.participants.filter((p) => p !== name)
      : [...entry.participants, name];
    const isAutoDescription =
      entry.description === "" || /^(야근|휴일) 식대 \d+인$/.test(entry.description);
    const isFood = isFoodMerchant(rules, stm.merchant) || isFoodCategory(entry.category);
    const isMealPreset = currentPreset === "late_meal" || currentPreset === "holiday_meal";
    const patch: Partial<JournalEntry> = {
      participants: nextParticipants,
      preset: isMealPreset ? currentPreset : "manual",
    };
    if (isFood && isAutoDescription) {
      const head =
        currentPreset === "holiday_meal" || /^휴일/.test(entry.description) ? "휴일" : "야근";
      patch.description =
        nextParticipants.length > 0 ? `${head} 식대 ${nextParticipants.length}인` : "";
      const kind = inferMealSupportKind(stm.usedAt, patch.description);
      const limit = getMealSupportLimit(rules, kind);
      patch.expectedAmount = Math.min(stm.chargedAmount, nextParticipants.length * limit);
    }
    onUpdateEntry(entry.id, patch);
  };

  return (
    <tr className={`row-${statusKind}`}>
      <td className="col-status">
        <StatusDot kind={statusKind} title={statusTitle} />
      </td>
      <td className="td-date">{stm.usedAt}</td>
      <td className="td-vendor">{stm.merchant}</td>
      <td className="td-num">{stm.chargedAmount.toLocaleString()}</td>
      <td className="col-meta">{stm.cardNumber}</td>
      <td className="col-meta">{stm.userName}</td>
      <td className="col-meta">{stm.employeeNo}</td>
      <td className="col-meta">{stm.dept}</td>
      <td className="col-meta td-num">{stm.usedAmount.toLocaleString()}</td>
      <td className="col-meta">{stm.businessNo}</td>
      <td className="col-meta">{stm.approvalNo}</td>
      <td className="col-meta td-num">{stm.installmentMonths}</td>
      <td className="col-meta td-num">{stm.billingRound}</td>
      {entry ? (
        <>
          <td>
            <select
              className="cell-select preset-select"
              value={currentPreset}
              onChange={(event) => handlePresetChange(event.target.value as ExpensePreset)}
              title="프리셋을 바꾸면 계정과 업무 내용이 자동으로 맞춰져요"
            >
              {EXPENSE_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {EXPENSE_PRESET_LABELS[preset]}
                </option>
              ))}
            </select>
          </td>
          <td>
            <select
              className="cell-select"
              value={entry.category}
              onChange={(event) =>
                onUpdateEntry(entry.id, {
                  category: event.target.value as Category,
                  preset: "manual",
                })
              }
            >
              {ALL_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </td>
          {currentPreset === "taxi" ? (
            <td className="td-muted">불필요</td>
          ) : (
            <td className={`td-chips${participantsIssues.length > 0 ? " td-issue" : ""}`}>
              <div
                className={`cell-control-wrap cell-control-wrap-chips${participantsIssues.length > 0 ? " has-issue" : ""}`}
                title={formatIssueMessage(participantsIssues)}
              >
                <ChipCell selected={entry.participants} onToggle={handleParticipantToggle} />
                <IssueTooltip issues={participantsIssues} />
              </div>
            </td>
          )}
          <td>
            <input
              className="cell-input"
              type="text"
              value={entry.description}
              placeholder={placeholderDescription}
              onChange={(event) =>
                onUpdateEntry(entry.id, { description: event.target.value, preset: "manual" })
              }
            />
          </td>
          <td>
            <div
              className={`cell-control-wrap${amountIssues.length > 0 ? " has-issue" : ""}`}
              title={formatIssueMessage(amountIssues)}
            >
              <input
                className={`cell-input cell-input-num${amountIssues.length > 0 ? " cell-issue" : ""}`}
                type="number"
                value={requested}
                min={0}
                onChange={(event) => {
                  const next = Number(event.target.value) || 0;
                  onUpdateEntry(entry.id, { expectedAmount: next, preset: "manual" });
                }}
              />
              <IssueTooltip issues={amountIssues} />
            </div>
          </td>
          <td className="td-num">{personal.toLocaleString()}</td>
          <td>
            <ReceiptCell
              entry={entry}
              photoBlobs={photoBlobs}
              receiptRequired={!!receiptIssue}
              onAdd={(files) => onAddReceipt(entry.id, files)}
              onRemove={(photoId) => onRemoveReceipt(entry.id, photoId)}
            />
          </td>
          <td>
            <RowMenu onReset={() => onResetEntry(entry.id)} />
          </td>
        </>
      ) : (
        <td colSpan={8} className="td-empty">
          연결된 항목이 없어요
        </td>
      )}
    </tr>
  );
}

function formatIssueMessage(issues: EntryIssue[]) {
  return issues.map((issue) => issue.message).join("\n");
}

function IssueTooltip({ issues }: { issues: EntryIssue[] }) {
  if (issues.length === 0) return null;

  return (
    <span className="issue-tooltip" role="tooltip">
      {issues.map((issue, index) => (
        <span key={`${issue.type}-${index}`}>{issue.message}</span>
      ))}
    </span>
  );
}

function StatusDot({
  kind,
  title,
}: {
  kind: "exact" | "review" | "warn" | "missing";
  title?: string;
}) {
  return <span className={`status-dot status-${kind}`} title={title} aria-label={title} />;
}

function ChipCell({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (name: string) => void;
}) {
  return (
    <div className="chip-cell">
      {TEAM_MEMBERS.map((name) => {
        const active = selected.includes(name);
        return (
          <button
            key={name}
            type="button"
            className={active ? "chip-mini active" : "chip-mini"}
            onClick={() => onToggle(name)}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}

function ReceiptCell({
  entry,
  photoBlobs,
  receiptRequired,
  onAdd,
  onRemove,
}: {
  entry: JournalEntry;
  photoBlobs: Map<string, Blob>;
  receiptRequired: boolean;
  onAdd: (files: FileList) => Promise<void>;
  onRemove: (photoId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const photoCount = entry.photoIds.length;
  const className = receiptRequired
    ? "receipt-trigger required"
    : photoCount > 0
    ? "receipt-trigger has"
    : "receipt-trigger empty";

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {receiptRequired ? (
          <>
            <AlertTriangle size={12} aria-hidden="true" /> 영수증
          </>
        ) : photoCount > 0 ? (
          <>
            <Paperclip size={12} aria-hidden="true" /> {photoCount}
          </>
        ) : (
          <>
            <Receipt size={12} aria-hidden="true" /> 추가
          </>
        )}
      </button>
      {open ? (
        <ReceiptPopover
          entry={entry}
          photoBlobs={photoBlobs}
          onClose={() => setOpen(false)}
          onAdd={onAdd}
          onRemove={onRemove}
        />
      ) : null}
    </>
  );
}

function ReceiptPopover({
  entry,
  photoBlobs,
  onClose,
  onAdd,
  onRemove,
}: {
  entry: JournalEntry;
  photoBlobs: Map<string, Blob>;
  onClose: () => void;
  onAdd: (files: FileList) => Promise<void>;
  onRemove: (photoId: string) => void;
}) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      const next: Record<string, string> = {};
      for (const id of entry.photoIds) {
        const blob = photoBlobs.get(id);
        if (!blob) continue;
        const url = await blobToObjectUrl(blob);
        urls.push(url);
        next[id] = url;
      }
      if (!cancelled) setThumbs(next);
    })();
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [entry.photoIds, photoBlobs]);

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent className="receipt-modal">
        <div className="sheet-header">
          <DrawerTitle className="receipt-title">
            영수증 ({entry.photoIds.length})
          </DrawerTitle>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={18} aria-hidden="true" />
            <span className="sr-only">닫기</span>
          </button>
        </div>
        <p className="receipt-vendor">{entry.vendorHint}</p>
        <div className="receipt-grid">
          {entry.photoIds.map((id) => (
            <div
              key={id}
              className="receipt-thumb-cell"
              style={
                thumbs[id]
                  ? {
                      backgroundImage: `url(${thumbs[id]})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : undefined
              }
            >
              {!thumbs[id] ? <Camera size={14} aria-hidden="true" /> : null}
              <button
                type="button"
                className="photo-remove"
                onClick={() => onRemove(id)}
                aria-label="삭제"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          ))}
          <label className="receipt-add">
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => {
                if (event.target.files) onAdd(event.target.files);
              }}
            />
            <Plus size={18} aria-hidden="true" />
            <span>{entry.photoIds.length === 0 ? "사진 추가" : "더 추가"}</span>
          </label>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function RowMenu({ onReset }: { onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div className="row-menu" ref={ref}>
      <button
        type="button"
        className="row-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-label="메뉴"
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div className="row-menu-dropdown">
          <button
            type="button"
            onClick={() => {
              onReset();
              setOpen(false);
            }}
          >
            입력 초기화
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* --- Step 4: Download --- */

function DownloadStep({
  profile,
  matches,
  total,
  validationIssues,
  onBack,
  onDownload,
}: {
  profile: Profile;
  matches: MatchResult[];
  total: number;
  validationIssues: { match: MatchResult; issues: EntryIssue[] }[];
  onBack: () => void;
  onDownload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const downloadInFlightRef = useRef(false);
  const month = matches[0]?.statement.usedAt
    ? Number(matches[0].statement.usedAt.split(/[.-]/)[1])
    : new Date().getMonth() + 1;
  const filename = `(카드)제경비신청서_${month}월_${profile.dept}_${profile.name}.xlsx`;

  return (
    <div className="step">
      <button
        type="button"
        className="ghost-button"
        onClick={onBack}
        style={{ alignSelf: "flex-start", marginBottom: 8 }}
      >
        <ArrowLeft size={16} aria-hidden="true" /> 이전
      </button>

      <h2 className="step-title">다 됐어요</h2>
      <p className="step-sub">파일을 받아 그룹웨어에 첨부하세요.</p>

      <div className="step-body">
        <div className="summary-card">
          <p className="label">합계</p>
          <p className="value">{formatCurrency(total)}</p>
          <p className="sub">{matches.length}건</p>
        </div>

        <div>
          <div className="summary-row">
            <span>자동 연결</span>
            <b>{matches.filter((m) => m.status === "exact").length}건</b>
          </div>
          <div className="summary-row">
            <span>확인 필요</span>
            <b>{matches.filter((m) => m.status === "review").length}건</b>
          </div>
          <div className="summary-row">
            <span>파일 이름</span>
            <b style={{ fontSize: 13 }}>{filename}</b>
          </div>
        </div>

        {validationIssues.length > 0 ? (
          <div className="notice warning">
            <AlertTriangle size={16} aria-hidden="true" />
            <div>
              확인할 부분 {validationIssues.length}건이 있어요. 그대로 받아도 괜찮아요.
              <ul style={{ margin: "8px 0 0 0", paddingLeft: 18 }}>
                {validationIssues.map(({ match, issues }) => (
                  <li key={match.id}>
                    <strong>{match.statement.merchant}</strong>
                    <ul style={{ margin: "4px 0 0 0", paddingLeft: 16 }}>
                      {issues.map((i, idx) => (
                        <li key={idx}>{i.message}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="notice success">
            <CheckCircle2 size={16} aria-hidden="true" />
            모두 깔끔하게 정리됐어요.
          </div>
        )}
      </div>

      <div className="bottom-bar">
        <div className="inner">
          <button
            type="button"
            className="primary-button full"
            disabled={busy}
            onClick={async () => {
              if (downloadInFlightRef.current) return;
              downloadInFlightRef.current = true;
              setBusy(true);
              try {
                await onDownload();
              } finally {
                downloadInFlightRef.current = false;
                setBusy(false);
              }
            }}
          >
            <Download size={18} aria-hidden="true" /> {busy ? "생성 중…" : "다운로드"}
          </button>
        </div>
      </div>
    </div>
  );
}
