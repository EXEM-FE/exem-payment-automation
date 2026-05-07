import ExcelJS from "exceljs";
import type { MatchResult, Profile } from "@exem/shared";

const TEMPLATE_URL = "/templates/card-expense-template.xlsx";
const DETAIL_DATA_START_ROW = 3;
const DETAIL_DATA_END_ROW = 288;
const TEXT_CELL_NUM_FORMAT = "@";
const DETAIL_DATA_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9D9D9" },
};
const PERSONAL_AMOUNT_NUM_FORMAT = '" "* #,##0" ";"-"* #,##0" ";" "* "- "';

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

function formatStatementDateText(s: string): string {
  return s.trim();
}

function statementDateToDash(s: string): string {
  return s.trim().replaceAll(".", "-");
}

function setTextCell(cell: ExcelJS.Cell, value: string) {
  cell.value = value;
  cell.style = { ...cell.style, numFmt: TEXT_CELL_NUM_FORMAT };
}

function clearWorksheetMedia(worksheet: ExcelJS.Worksheet) {
  (worksheet as ExcelJS.Worksheet & { _media: unknown[] })._media = [];
}

function normalizeWorksheetView(worksheet: ExcelJS.Worksheet) {
  worksheet.views = [{ ...worksheet.views[0], showGridLines: false }];
  worksheet.autoFilter = undefined;
  delete worksheet.pageSetup.printArea;
  delete worksheet.pageSetup.printTitlesRow;
}

function normalizeDetailDataCell(cell: ExcelJS.Cell) {
  cell.fill = DETAIL_DATA_FILL;
}

function resetDetailRows(detail: ExcelJS.Worksheet) {
  normalizeWorksheetView(detail);

  for (let rowNumber = DETAIL_DATA_START_ROW; rowNumber <= DETAIL_DATA_END_ROW; rowNumber += 1) {
    const row = detail.getRow(rowNumber);

    for (let col = 1; col <= 14; col += 1) {
      row.getCell(col).value = null;
      normalizeDetailDataCell(row.getCell(col));
    }
    for (let col = 16; col <= 20; col += 1) {
      row.getCell(col).value = null;
      normalizeDetailDataCell(row.getCell(col));
    }
    row.getCell(17).style = { ...row.getCell(17).style, numFmt: "General" };

    row.getCell(15).value = { formula: `+F${rowNumber}*1` };
    row.getCell(15).style = { ...row.getCell(15).style, numFmt: "#,##0" };
    normalizeDetailDataCell(row.getCell(15));
    row.getCell(21).value = { formula: `F${rowNumber}-T${rowNumber}` };
    row.getCell(21).style = { ...row.getCell(21).style, numFmt: PERSONAL_AMOUNT_NUM_FORMAT };
    normalizeDetailDataCell(row.getCell(21));
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

  normalizeWorksheetView(evidence);
  clearWorksheetMedia(evidence);
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

    setTextCell(row.getCell(1), formatStatementDateText(stm.usedAt));
    setTextCell(row.getCell(2), stm.cardNumber);
    setTextCell(row.getCell(3), stm.userName);
    setTextCell(row.getCell(4), stm.employeeNo);
    setTextCell(row.getCell(5), stm.dept);
    row.getCell(6).value = stm.usedAmount;
    row.getCell(7).value = stm.chargedAmount;
    setTextCell(row.getCell(8), String(stm.foreignAmount));
    setTextCell(row.getCell(9), stm.currency);
    setTextCell(row.getCell(10), stm.merchant);
    setTextCell(row.getCell(11), stm.businessNo);
    setTextCell(row.getCell(12), String(stm.approvalNo));
    setTextCell(row.getCell(13), String(stm.installmentMonths));
    setTextCell(row.getCell(14), String(stm.billingRound));
    row.getCell(15).value = { formula: `+F${rowNumber}*1`, result: stm.usedAmount };
    setTextCell(row.getCell(16), entry?.category ?? "");
    row.getCell(17).value = null;
    setTextCell(row.getCell(18), entry?.participants.join(", ") ?? "");
    setTextCell(row.getCell(19), entry?.description ?? "");
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
  detail.autoFilter = undefined;

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
      const date = match.entry?.occurredAt ?? statementDateToDash(match.statement.usedAt);
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
