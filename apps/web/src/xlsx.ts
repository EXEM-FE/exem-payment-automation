import ExcelJS from "exceljs";
import type {
  JournalEntry,
  MatchResult,
  Profile,
  StatementRow,
} from "@exem/shared";

const SHEET_LABELS = {
  detail: "1. 이용내역명세서",
  evidence: "1-1. 지출증빙 첨부(쇼핑몰,편의점,마트,문구점 등)",
  transit: "2. 후불교통,하이패스이용명세서",
  example: "지출증빙 첨부_예시",
};

const HEADER_ROW = [
  "이용일자",
  "카드번호",
  "이용자명",
  "사원번호",
  "부서명",
  "국내이용금액",
  "국내청구금액",
  "해외현지금액",
  "통화코드",
  "가맹점",
  "가맹점사업자번호",
  "승인번호",
  "할부개월수",
  "청구회차",
  "행합계",
  "계정",
  "(외근시 기재)\n거래처명/소재지",
  "사용자명(all)",
  "업무 상세내용\n(주유는 '거리(km)*이용일수' 함께 기재)",
  "경비신청금액",
  "개인사용금액",
];

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
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Exem 경비 자동화";
  workbook.created = new Date();

  /* ===== Sheet 1. 이용내역명세서 ===== */
  const detail = workbook.addWorksheet(SHEET_LABELS.detail, {
    views: [{ state: "frozen", ySplit: 2 }],
  });

  const widths = [12, 22, 10, 14, 12, 14, 14, 14, 10, 28, 18, 14, 12, 12, 14, 14, 22, 24, 32, 14, 14];
  widths.forEach((w, i) => {
    detail.getColumn(i + 1).width = w;
  });

  // Row 1: 사용자 안내 라벨 + 합계
  const r1 = detail.getRow(1);
  r1.getCell(9).value = "<이용내역명세서 붙여넣기 영역>";
  r1.getCell(18).value = "<사용자 추가입력 영역>";
  // 합계는 데이터를 넣은 뒤 계산해서 채움
  r1.font = { bold: true, color: { argb: "FF374151" } };
  r1.height = 22;

  // Row 2: 헤더
  const headerRow = detail.getRow(2);
  HEADER_ROW.forEach((label, i) => {
    headerRow.getCell(i + 1).value = label;
  });
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  headerRow.height = 36;
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    cell.border = {
      top: { style: "thin", color: { argb: "FFCBD5E1" } },
      left: { style: "thin", color: { argb: "FFCBD5E1" } },
      bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
      right: { style: "thin", color: { argb: "FFCBD5E1" } },
    };
  });

  // 데이터 행
  let chargedSum = 0;
  let requestedSum = 0;
  let personalSum = 0;
  matches.forEach((match, index) => {
    const row = detail.getRow(3 + index);
    const stm = match.statement;
    const entry = match.entry;
    const requested = entry?.expectedAmount ?? stm.chargedAmount;
    const personal = Math.max(0, stm.chargedAmount - requested);

    row.getCell(1).value = dotDateToExcelSerial(stm.usedAt);
    row.getCell(1).numFmt = "yyyy-mm-dd";
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
    row.getCell(14).value = stm.billingRound;
    row.getCell(15).value = stm.chargedAmount;
    row.getCell(16).value = entry?.category ?? "";
    row.getCell(17).value = "";
    row.getCell(18).value = entry?.participants.join(", ") ?? "";
    row.getCell(19).value = entry?.description ?? "";
    row.getCell(20).value = requested;
    row.getCell(21).value = personal;

    [6, 7, 8, 15, 20, 21].forEach((col) => {
      row.getCell(col).numFmt = '#,##0';
    });

    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFE5E7EB" } },
        left: { style: "thin", color: { argb: "FFE5E7EB" } },
        bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
        right: { style: "thin", color: { argb: "FFE5E7EB" } },
      };
    });

    chargedSum += stm.chargedAmount;
    requestedSum += requested;
    personalSum += personal;
  });

  r1.getCell(10).value = chargedSum;
  r1.getCell(20).value = requestedSum;
  r1.getCell(21).value = personalSum;
  [10, 20, 21].forEach((col) => {
    r1.getCell(col).numFmt = '#,##0';
  });

  /* ===== Sheet 1-1. 지출증빙 첨부 ===== */
  const evidence = workbook.addWorksheet(SHEET_LABELS.evidence);
  // 16개 컬럼, 좌측 페이지 + 우측 페이지
  for (let i = 1; i <= 16; i += 1) evidence.getColumn(i).width = 11;

  // 헤더 (row 1-2 merged)
  evidence.mergeCells(1, 1, 2, 8);
  evidence.mergeCells(1, 9, 2, 16);
  const headerLeft = evidence.getCell(1, 1);
  const headerRight = evidence.getCell(1, 9);
  headerLeft.value = "지출증빙 첨부파일(1)";
  headerRight.value = "지출증빙 첨부파일(2)";
  for (const cell of [headerLeft, headerRight]) {
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.font = { bold: true, size: 14 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
    cell.border = {
      top: { style: "medium", color: { argb: "FF92400E" } },
      bottom: { style: "medium", color: { argb: "FF92400E" } },
      left: { style: "medium", color: { argb: "FF92400E" } },
      right: { style: "medium", color: { argb: "FF92400E" } },
    };
  }

  // 8 슬롯 merged + 점선 테두리
  for (const slot of SLOT_BOXES) {
    evidence.mergeCells(slot.top, slot.left, slot.bottom, slot.right);
    const cell = evidence.getCell(slot.top, slot.left);
    cell.border = {
      top: { style: "dashed", color: { argb: "FF94A3B8" } },
      left: { style: "dashed", color: { argb: "FF94A3B8" } },
      bottom: { style: "dashed", color: { argb: "FF94A3B8" } },
      right: { style: "dashed", color: { argb: "FF94A3B8" } },
    };
  }

  // 푸터 (row 41-42 merged)
  evidence.mergeCells(41, 1, 42, 8);
  evidence.mergeCells(41, 9, 42, 16);
  const footerLeft = evidence.getCell(41, 1);
  const footerRight = evidence.getCell(41, 9);
  const footerText = "↑   ↑      점선에 맞춰 첨부해주시길 바랍니다.      ↑   ↑";
  footerLeft.value = footerText;
  footerRight.value = footerText;
  for (const cell of [footerLeft, footerRight]) {
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.font = { color: { argb: "FF6B7280" } };
  }

  // 행 높이: 영수증이 충분히 들어가도록
  for (let row = 3; row <= 40; row += 1) evidence.getRow(row).height = 24;

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

  /* ===== Sheet 2. 후불교통 (1차 비목표) ===== */
  const transit = workbook.addWorksheet(SHEET_LABELS.transit);
  transit.getCell(1, 1).value = "1차 앱에서는 후불교통 명세서를 다루지 않습니다.";
  transit.getCell(1, 1).font = { italic: true, color: { argb: "FF6B7280" } };
  transit.getColumn(1).width = 60;

  /* ===== Sheet: 지출증빙 첨부_예시 ===== */
  const example = workbook.addWorksheet(SHEET_LABELS.example);
  example.getCell(1, 1).value =
    "예시 시트입니다. 가운데 점선 영역에 영수증 사진을 위→아래 순서로 붙여주세요.";
  example.getCell(1, 1).font = { italic: true, color: { argb: "FF6B7280" } };
  example.getColumn(1).width = 80;

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
