import ExcelJS from "exceljs";
import type { MatchResult, Profile } from "@exem/shared";

const TEMPLATE_URL = "/templates/card-expense-template.xlsx";
const DETAIL_DATA_START_ROW = 3;
const DETAIL_DATA_END_ROW = 288;
const DATE_CELL_NUM_FORMAT = "m/d/yy";

const SHEET_LABELS = {
  detail: "1. 이용내역명세서",
  evidence: "1-1. 지출증빙 첨부(쇼핑몰,편의점,마트,문구점 등)",
};

/** 1-1 시트의 8개 슬롯 좌표 (1-based, ExcelJS 기준). */
const SLOT_BOXES = [
  // 좌측 페이지
  { top: 3, bottom: 21, left: 1, right: 4 },
  { top: 3, bottom: 21, left: 5, right: 8 },
  { top: 22, bottom: 40, left: 1, right: 4 },
  { top: 22, bottom: 40, left: 5, right: 8 },
  // 우측 페이지
  { top: 3, bottom: 21, left: 9, right: 12 },
  { top: 3, bottom: 21, left: 13, right: 16 },
  { top: 22, bottom: 40, left: 9, right: 12 },
  { top: 22, bottom: 40, left: 13, right: 16 },
];

function dotDateToExcelSerial(s: string): number {
  const parts = s.split(/[.-]/).map(Number);
  if (parts.length < 3) return Number.NaN;
  const [y, m, d] = parts;
  const date = new Date(Date.UTC(y, m - 1, d));
  const epoch = Date.UTC(1899, 11, 30);
  return (date.getTime() - epoch) / 86400000;
}

function inferMonth(matches: MatchResult[]): number {
  const first = matches.find((m) => m.statement.usedAt);
  if (first) {
    const parts = first.statement.usedAt.split(/[.-]/);
    if (parts.length >= 2) return Number(parts[1]) || new Date().getMonth() + 1;
  }
  return new Date().getMonth() + 1;
}

async function loadTemplateWorkbook(): Promise<ExcelJS.Workbook> {
  const response = await fetch(TEMPLATE_URL);
  if (!response.ok) {
    throw new Error(`엑셀 템플릿을 읽을 수 없습니다: ${TEMPLATE_URL}`);
  }

  const templateBuffer = await response.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  workbook.calcProperties.fullCalcOnLoad = true;
  workbook.creator = "Exem 경비 자동화";
  workbook.modified = new Date();
  return workbook;
}

function requireWorksheet(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const worksheet = workbook.getWorksheet(name);
  if (!worksheet) {
    throw new Error(`엑셀 템플릿에 필요한 시트가 없습니다: ${name}`);
  }
  return worksheet;
}

function clearTemplateMedia(workbook: ExcelJS.Workbook) {
  (workbook as ExcelJS.Workbook & { media: ExcelJS.Media[] }).media = [];
  workbook.worksheets.forEach((worksheet) => {
    (worksheet as ExcelJS.Worksheet & { _media: unknown[] })._media = [];
  });
}

function resetDetailRows(detail: ExcelJS.Worksheet) {
  for (let rowNumber = DETAIL_DATA_START_ROW; rowNumber <= DETAIL_DATA_END_ROW; rowNumber += 1) {
    const row = detail.getRow(rowNumber);

    for (let col = 1; col <= 14; col += 1) {
      row.getCell(col).value = null;
    }
    for (let col = 16; col <= 20; col += 1) {
      row.getCell(col).value = null;
    }

    row.getCell(15).value = { formula: `+F${rowNumber}*1` };
    row.getCell(21).value = { formula: `F${rowNumber}-T${rowNumber}` };
  }
}

export type EvidenceSlot = {
  occurredAt: string; // YYYY-MM-DD
  photos: { id: string; blob: Blob }[];
  vendor: string;
};

export type ExportInput = {
  profile: Profile;
  matches: MatchResult[];
  evidenceSlots: EvidenceSlot[];
};

export async function buildWorkbook({
  profile,
  matches,
  evidenceSlots,
}: ExportInput): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const maxRows = DETAIL_DATA_END_ROW - DETAIL_DATA_START_ROW + 1;
  if (matches.length > maxRows) {
    throw new Error(`엑셀 템플릿의 이용내역 행 수를 초과했습니다: ${matches.length}/${maxRows}`);
  }

  const workbook = await loadTemplateWorkbook();
  const detail = requireWorksheet(workbook, SHEET_LABELS.detail);
  const evidence = requireWorksheet(workbook, SHEET_LABELS.evidence);

  clearTemplateMedia(workbook);
  resetDetailRows(detail);

  let usedSum = 0;
  let requestedSum = 0;
  let personalSum = 0;
  matches.forEach((match, index) => {
    const rowNumber = DETAIL_DATA_START_ROW + index;
    const row = detail.getRow(rowNumber);
    const stm = match.statement;
    const entry = match.entry;
    const requested = entry?.expectedAmount ?? stm.chargedAmount;
    const personal = stm.usedAmount - requested;

    const usedAtCell = row.getCell(1);
    usedAtCell.value = dotDateToExcelSerial(stm.usedAt);
    usedAtCell.style = { ...usedAtCell.style, numFmt: DATE_CELL_NUM_FORMAT };
    row.getCell(2).value = stm.cardNumber;
    row.getCell(3).value = stm.userName;
    row.getCell(4).value = stm.employeeNo;
    row.getCell(5).value = stm.dept;
    row.getCell(6).value = stm.usedAmount;
    row.getCell(7).value = stm.chargedAmount;
    row.getCell(8).value = stm.foreignAmount;
    row.getCell(9).value = stm.currency;
    row.getCell(10).value = stm.merchant;
    row.getCell(11).value = stm.businessNo;
    // 승인번호는 앞 0 보존을 위해 문자열
    row.getCell(12).value = String(stm.approvalNo);
    row.getCell(13).value = stm.installmentMonths;
    row.getCell(13).numFmt = "0";
    row.getCell(14).value = stm.billingRound;
    row.getCell(14).numFmt = "0";
    row.getCell(15).value = { formula: `+F${rowNumber}*1`, result: stm.usedAmount };
    row.getCell(16).value = entry?.category ?? "";
    row.getCell(17).value = "";
    row.getCell(18).value = entry?.participants.join(", ") ?? "";
    row.getCell(19).value = entry?.description ?? "";
    row.getCell(20).value = requested;
    row.getCell(21).value = { formula: `F${rowNumber}-T${rowNumber}`, result: personal };

    usedSum += stm.usedAmount;
    requestedSum += requested;
    personalSum += personal;
  });

  detail.getCell(1, 10).value = { formula: "SUM(O3:O288)", result: usedSum };
  detail.getCell(1, 20).value = { formula: "SUM(T3:T288)", result: requestedSum };
  detail.getCell(1, 21).value = { formula: "SUM(U3:U288)", result: personalSum };
  detail.getCell(1, 22).value = {
    formula: "J1=T1+U1",
    result: usedSum === requestedSum + personalSum,
  };
  detail.autoFilter = `A2:U${Math.max(DETAIL_DATA_START_ROW, matches.length + 2)}`;

  // 슬롯에 사진 anchor
  const sortedSlots = [...evidenceSlots].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  for (let i = 0; i < Math.min(sortedSlots.length, SLOT_BOXES.length); i += 1) {
    const slot = sortedSlots[i];
    const box = SLOT_BOXES[i];
    if (slot.photos.length === 0) continue;
    const heightRows = box.bottom - box.top + 1;
    const perPhotoRows = heightRows / slot.photos.length;
    for (let p = 0; p < slot.photos.length; p += 1) {
      const photo = slot.photos[p];
      const buffer = await photo.blob.arrayBuffer();
      const imageId = workbook.addImage({
        buffer: buffer as unknown as ArrayBuffer,
        extension: photo.blob.type === "image/png" ? "png" : "jpeg",
      });
      const tlRow = box.top - 1 + perPhotoRows * p;
      const brRow = box.top - 1 + perPhotoRows * (p + 1);
      evidence.addImage(imageId, {
        tl: { col: box.left - 1, row: tlRow } as unknown as ExcelJS.Anchor,
        br: { col: box.right, row: brRow } as unknown as ExcelJS.Anchor,
        editAs: "oneCell",
      });
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const month = inferMonth(matches);
  const filename = `(카드)제경비신청서_${month}월_${profile.dept}_${profile.name}.xlsx`;
  return { buffer: buffer as ArrayBuffer, filename };
}

/** 매칭 결과 + 사진 blob 들로 8슬롯에 배치할 EvidenceSlot[] 빌드. */
export function buildEvidenceSlots({
  matches,
  resolvePhoto,
}: {
  matches: MatchResult[];
  resolvePhoto: (id: string) => Promise<Blob | undefined>;
}): Promise<EvidenceSlot[]> {
  return Promise.all(
    matches.map(async (match) => {
      const date = match.entry?.occurredAt ?? match.statement.usedAt.replaceAll(".", "-");
      const photoIds = match.entry?.photoIds ?? [];
      const photos: { id: string; blob: Blob }[] = [];
      for (const id of photoIds) {
        const blob = await resolvePhoto(id);
        if (blob) photos.push({ id, blob });
      }
      return {
        occurredAt: date,
        photos,
        vendor: match.statement.merchant || match.entry?.vendorHint || "",
      };
    }),
  );
}

export function downloadBlob(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
