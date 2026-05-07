import JSZip from "jszip";
import type { MatchResult, Profile } from "@exem/shared";

const TEMPLATE_URL = "/templates/card-expense-template.xlsx";
const DETAIL_DATA_START_ROW = 3;
const DETAIL_DATA_END_ROW = 288;
const RELATIONSHIP_XMLNS = "http://schemas.openxmlformats.org/package/2006/relationships";
const IMAGE_RELATIONSHIP_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const DRAWING_RELATIONSHIP_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";
const EMU_PER_PIXEL = 9_525;
const DEFAULT_ROW_HEIGHT_PX = 20;
const DEFAULT_COLUMN_WIDTH_PX = 96;
const COMPOSITE_IMAGE_WIDTH_PX = 1_600;
const COMPOSITE_PADDING_PX = 28;
const COMPOSITE_GAP_PX = 20;
const COMPOSITE_IMAGE_QUALITY = 0.92;

const WORKBOOK_PATH = "xl/workbook.xml";
const WORKBOOK_RELS_PATH = "xl/_rels/workbook.xml.rels";
const CONTENT_TYPES_PATH = "[Content_Types].xml";
const DETAIL_SHEET_NAME = "1. 이용내역명세서";
const EVIDENCE_SHEET_NAME_PREFIX = "1-1.";

const DETAIL_COLUMNS_TO_CLEAR = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "P",
  "Q",
  "R",
  "S",
  "T",
] as const;

/** 1-1 시트의 8개 슬롯 좌표 (1-based, 기존 템플릿 기준). */
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

type TemplateParts = {
  detailPath: string;
  evidenceDrawingPath: string;
  evidenceDrawingRelsPath: string;
};

type SlotBox = (typeof SLOT_BOXES)[number];
type ImageSize = Pick<ImageBitmap, "width" | "height">;

function inferMonth(matches: MatchResult[]): number {
  const first = matches.find((m) => m.statement.usedAt);
  if (first) {
    const parts = first.statement.usedAt.split(/[.-]/);
    if (parts.length >= 2) return Number(parts[1]) || new Date().getMonth() + 1;
  }
  return new Date().getMonth() + 1;
}

async function loadTemplateZip(): Promise<JSZip> {
  const response = await fetch(TEMPLATE_URL);
  if (!response.ok) {
    throw new Error(`엑셀 템플릿을 읽을 수 없습니다: ${TEMPLATE_URL}`);
  }

  const templateBuffer = await response.arrayBuffer();
  return JSZip.loadAsync(templateBuffer, { createFolders: false });
}

async function readZipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) {
    throw new Error(`엑셀 템플릿에 필요한 파일이 없습니다: ${path}`);
  }
  return file.async("text");
}

function decodeXmlAttribute(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function getXmlAttribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? decodeXmlAttribute(match[1]) : undefined;
}

function dirname(partPath: string): string {
  const index = partPath.lastIndexOf("/");
  return index === -1 ? "" : partPath.slice(0, index);
}

function basename(partPath: string): string {
  const index = partPath.lastIndexOf("/");
  return index === -1 ? partPath : partPath.slice(index + 1);
}

function normalizePackagePath(value: string): string {
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function resolveRelationshipTarget(sourcePartPath: string, target: string): string {
  if (target.startsWith("/")) return normalizePackagePath(target.slice(1));
  return normalizePackagePath(`${dirname(sourcePartPath)}/${target}`);
}

function relsPathForPart(partPath: string): string {
  return normalizePackagePath(`${dirname(partPath)}/_rels/${basename(partPath)}.rels`);
}

function relationshipTargets(relsXml: string, sourcePartPath: string): Map<string, string> {
  const targets = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const tag = match[0];
    const id = getXmlAttribute(tag, "Id");
    const target = getXmlAttribute(tag, "Target");
    if (id && target) {
      targets.set(id, resolveRelationshipTarget(sourcePartPath, target));
    }
  }
  return targets;
}

function drawingRelationshipId(relsXml: string): string | undefined {
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const tag = match[0];
    const type = getXmlAttribute(tag, "Type");
    const id = getXmlAttribute(tag, "Id");
    if (type === DRAWING_RELATIONSHIP_TYPE && id) return id;
  }
  return undefined;
}

function findSheetRelationshipId(workbookXml: string, predicate: (name: string) => boolean): string {
  for (const match of workbookXml.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const tag = match[0];
    const name = getXmlAttribute(tag, "name");
    const relationshipId = getXmlAttribute(tag, "r:id");
    if (name && relationshipId && predicate(name)) return relationshipId;
  }
  throw new Error("엑셀 템플릿에서 필요한 시트를 찾을 수 없습니다.");
}

async function resolveTemplateParts(zip: JSZip): Promise<TemplateParts> {
  const workbookXml = await readZipText(zip, WORKBOOK_PATH);
  const workbookRelsXml = await readZipText(zip, WORKBOOK_RELS_PATH);
  const workbookTargets = relationshipTargets(workbookRelsXml, WORKBOOK_PATH);

  const detailRelationshipId = findSheetRelationshipId(
    workbookXml,
    (name) => name === DETAIL_SHEET_NAME,
  );
  const evidenceRelationshipId = findSheetRelationshipId(workbookXml, (name) =>
    name.startsWith(EVIDENCE_SHEET_NAME_PREFIX),
  );
  const detailPath = workbookTargets.get(detailRelationshipId);
  const evidencePath = workbookTargets.get(evidenceRelationshipId);
  if (!detailPath || !evidencePath) {
    throw new Error("엑셀 템플릿의 시트 관계를 확인할 수 없습니다.");
  }

  const evidenceRelsPath = relsPathForPart(evidencePath);
  const evidenceRelsXml = await readZipText(zip, evidenceRelsPath);
  const drawingRelId = drawingRelationshipId(evidenceRelsXml);
  if (!drawingRelId) {
    throw new Error("엑셀 템플릿의 증빙 시트 drawing 관계를 찾을 수 없습니다.");
  }

  const evidenceTargets = relationshipTargets(evidenceRelsXml, evidencePath);
  const evidenceDrawingPath = evidenceTargets.get(drawingRelId);
  if (!evidenceDrawingPath) {
    throw new Error("엑셀 템플릿의 증빙 drawing 파일을 확인할 수 없습니다.");
  }

  return {
    detailPath,
    evidenceDrawingPath,
    evidenceDrawingRelsPath: relsPathForPart(evidenceDrawingPath),
  };
}

function formatStatementDateText(s: string): string {
  return s.trim();
}

function statementDateToDash(s: string): string {
  return s.trim().replaceAll(".", "-");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatNumberValue(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`엑셀에 입력할 수 없는 숫자입니다: ${value}`);
  }
  return String(value);
}

function cellStyleAttribute(attrs: string): string {
  return attrs.match(/\ss="[^"]*"/)?.[0] ?? "";
}

function cellPattern(ref: string): RegExp {
  const safeRef = escapeRegExp(ref);
  return new RegExp(
    `<c\\b(?=[^>]*\\br="${safeRef}")([^>]*)\\/>|<c\\b(?=[^>]*\\br="${safeRef}")([^>]*)>([\\s\\S]*?)<\\/c>`,
  );
}

function replaceCellXml(
  xml: string,
  ref: string,
  render: (args: { attrs: string; body: string; selfClosing: boolean }) => string,
): string {
  let found = false;
  const next = xml.replace(cellPattern(ref), (match, selfAttrs, fullAttrs, body) => {
    found = true;
    if (selfAttrs !== undefined) {
      return render({ attrs: selfAttrs, body: "", selfClosing: true });
    }
    return render({ attrs: fullAttrs ?? "", body: body ?? "", selfClosing: false });
  });

  if (!found) {
    throw new Error(`엑셀 템플릿에서 셀을 찾을 수 없습니다: ${ref}`);
  }
  return next;
}

function blankCell(ref: string, attrs: string): string {
  return `<c r="${ref}"${cellStyleAttribute(attrs)}/>`;
}

function stringCell(ref: string, attrs: string, value: string): string {
  if (value === "") return blankCell(ref, attrs);
  const space = value.trim() !== value ? ' xml:space="preserve"' : "";
  return `<c r="${ref}"${cellStyleAttribute(attrs)} t="inlineStr"><is><t${space}>${escapeXml(
    value,
  )}</t></is></c>`;
}

function numberCell(ref: string, attrs: string, value: number): string {
  return `<c r="${ref}"${cellStyleAttribute(attrs)}><v>${formatNumberValue(value)}</v></c>`;
}

function setBlankCell(xml: string, ref: string): string {
  return replaceCellXml(xml, ref, ({ attrs }) => blankCell(ref, attrs));
}

function setStringCell(xml: string, ref: string, value: string): string {
  return replaceCellXml(xml, ref, ({ attrs }) => stringCell(ref, attrs, value));
}

function setNumberCell(xml: string, ref: string, value: number): string {
  return replaceCellXml(xml, ref, ({ attrs }) => numberCell(ref, attrs, value));
}

function setFormulaCachedValue(xml: string, ref: string, value: number | boolean): string {
  const serialized = typeof value === "boolean" ? (value ? "1" : "0") : formatNumberValue(value);
  return replaceCellXml(xml, ref, ({ attrs, body, selfClosing }) => {
    if (selfClosing) {
      throw new Error(`수식 캐시를 갱신할 수 없는 셀입니다: ${ref}`);
    }

    const updatedBody = /<v>[\s\S]*?<\/v>/.test(body)
      ? body.replace(/<v>[\s\S]*?<\/v>/, `<v>${serialized}</v>`)
      : `${body}<v>${serialized}</v>`;
    return `<c${attrs}>${updatedBody}</c>`;
  });
}

function patchDetailSheetXml(xml: string, matches: MatchResult[]): string {
  let next = xml;
  let usedSum = 0;
  let requestedSum = 0;

  for (let rowNumber = DETAIL_DATA_START_ROW; rowNumber <= DETAIL_DATA_END_ROW; rowNumber += 1) {
    for (const column of DETAIL_COLUMNS_TO_CLEAR) {
      next = setBlankCell(next, `${column}${rowNumber}`);
    }
    next = setFormulaCachedValue(next, `O${rowNumber}`, 0);
    next = setFormulaCachedValue(next, `U${rowNumber}`, 0);
  }

  matches.forEach((match, index) => {
    const rowNumber = DETAIL_DATA_START_ROW + index;
    const stm = match.statement;
    const entry = match.entry;
    const requested = entry?.expectedAmount ?? stm.chargedAmount;
    const personal = stm.usedAmount - requested;

    next = setStringCell(next, `A${rowNumber}`, formatStatementDateText(stm.usedAt));
    next = setStringCell(next, `B${rowNumber}`, stm.cardNumber);
    next = setStringCell(next, `C${rowNumber}`, stm.userName);
    next = setStringCell(next, `D${rowNumber}`, stm.employeeNo);
    next = setStringCell(next, `E${rowNumber}`, stm.dept);
    next = setNumberCell(next, `F${rowNumber}`, stm.usedAmount);
    next = setNumberCell(next, `G${rowNumber}`, stm.chargedAmount);
    next = setStringCell(next, `H${rowNumber}`, stm.foreignAmount);
    next = setStringCell(next, `I${rowNumber}`, stm.currency);
    next = setStringCell(next, `J${rowNumber}`, stm.merchant);
    next = setStringCell(next, `K${rowNumber}`, stm.businessNo);
    next = setStringCell(next, `L${rowNumber}`, stm.approvalNo);
    next = setStringCell(next, `M${rowNumber}`, stm.installmentMonths);
    next = setStringCell(next, `N${rowNumber}`, stm.billingRound);
    next = setFormulaCachedValue(next, `O${rowNumber}`, stm.usedAmount);
    next = setStringCell(next, `P${rowNumber}`, entry?.category ?? "");
    next = setBlankCell(next, `Q${rowNumber}`);
    next = setStringCell(next, `R${rowNumber}`, entry?.participants.join(", ") ?? "");
    next = setStringCell(next, `S${rowNumber}`, entry?.description ?? "");
    next = setNumberCell(next, `T${rowNumber}`, requested);
    next = setFormulaCachedValue(next, `U${rowNumber}`, personal);

    usedSum += stm.usedAmount;
    requestedSum += requested;
  });

  const personalSum = usedSum - requestedSum;
  next = setFormulaCachedValue(next, "J1", usedSum);
  next = setFormulaCachedValue(next, "T1", requestedSum);
  next = setFormulaCachedValue(next, "U1", personalSum);
  next = setFormulaCachedValue(next, "V1", usedSum === requestedSum + personalSum);
  return next;
}

function nextMediaIndex(zip: JSZip): number {
  let max = 0;
  Object.keys(zip.files).forEach((path) => {
    const match = path.match(/^xl\/media\/image(\d+)\.[^.]+$/);
    if (match) max = Math.max(max, Number(match[1]));
  });
  return max + 1;
}

function nextRelationshipId(relsXml: string): number {
  let max = 0;
  for (const match of relsXml.matchAll(/\bId="rId(\d+)"/g)) {
    max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function nextDrawingObjectId(drawingXml: string): number {
  let max = 0;
  for (const match of drawingXml.matchAll(/<xdr:cNvPr\b[^>]*\bid="(\d+)"/g)) {
    max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function emptyRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${RELATIONSHIP_XMLNS}"></Relationships>`;
}

function appendRelationship(relsXml: string, id: string, target: string): string {
  const relationship = `<Relationship Id="${id}" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="${target}"/>`;
  return relsXml.replace("</Relationships>", `${relationship}</Relationships>`);
}

function ensureDefaultContentType(xml: string, extension: "jpeg" | "png", contentType: string): string {
  const pattern = new RegExp(`<Default\\b[^>]*\\bExtension="${extension}"[^>]*/>`);
  if (pattern.test(xml)) return xml;
  return xml.replace("</Types>", `<Default Extension="${extension}" ContentType="${contentType}"/></Types>`);
}

function rowAnchor(value: number) {
  const row = Math.floor(value);
  const offset = Math.round((value - row) * DEFAULT_ROW_HEIGHT_PX * EMU_PER_PIXEL);
  return { row, offset };
}

function slotAspectRatio(box: SlotBox): number {
  const width = (box.right - box.left + 1) * DEFAULT_COLUMN_WIDTH_PX;
  const height = (box.bottom - box.top + 1) * DEFAULT_ROW_HEIGHT_PX;
  return width / height;
}

function pickGrid(imageSizes: ImageSize[], canvasWidth: number, canvasHeight: number) {
  const count = imageSizes.length;
  let best = { columns: 1, rows: count, score: -Infinity };

  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const innerWidth = canvasWidth - COMPOSITE_PADDING_PX * 2 - COMPOSITE_GAP_PX * (columns - 1);
    const innerHeight = canvasHeight - COMPOSITE_PADDING_PX * 2 - COMPOSITE_GAP_PX * (rows - 1);
    const cellWidth = innerWidth / columns;
    const cellHeight = innerHeight / rows;
    if (cellWidth <= 0 || cellHeight <= 0) continue;

    const imageArea = imageSizes.reduce((sum, image) => {
      const scale = Math.min(cellWidth / image.width, cellHeight / image.height);
      return sum + image.width * image.height * scale * scale;
    }, 0);
    const balance = 1 / (1 + Math.abs(columns / rows - canvasWidth / canvasHeight));
    const score = imageArea * balance;
    if (score > best.score) {
      best = { columns, rows, score };
    }
  }

  return best;
}

async function composeEvidenceImage(slot: EvidenceSlot, box: SlotBox): Promise<Blob> {
  const bitmaps = await Promise.all(
    slot.photos.map((photo) => createImageBitmap(photo.blob, { imageOrientation: "from-image" })),
  );

  try {
    const width = COMPOSITE_IMAGE_WIDTH_PX;
    const height = Math.round(width / slotAspectRatio(box));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("지출증빙 이미지를 합성할 캔버스를 만들 수 없습니다.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    const { columns, rows } = pickGrid(bitmaps, width, height);
    const innerWidth = width - COMPOSITE_PADDING_PX * 2 - COMPOSITE_GAP_PX * (columns - 1);
    const innerHeight = height - COMPOSITE_PADDING_PX * 2 - COMPOSITE_GAP_PX * (rows - 1);
    const cellWidth = innerWidth / columns;
    const cellHeight = innerHeight / rows;

    bitmaps.forEach((bitmap, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const cellX = COMPOSITE_PADDING_PX + column * (cellWidth + COMPOSITE_GAP_PX);
      const cellY = COMPOSITE_PADDING_PX + row * (cellHeight + COMPOSITE_GAP_PX);
      const scale = Math.min(cellWidth / bitmap.width, cellHeight / bitmap.height);
      const drawWidth = bitmap.width * scale;
      const drawHeight = bitmap.height * scale;
      const drawX = cellX + (cellWidth - drawWidth) / 2;
      const drawY = cellY + (cellHeight - drawHeight) / 2;
      context.drawImage(bitmap, drawX, drawY, drawWidth, drawHeight);
    });

    return canvas.convertToBlob({ type: "image/jpeg", quality: COMPOSITE_IMAGE_QUALITY });
  } finally {
    bitmaps.forEach((bitmap) => bitmap.close());
  }
}

function twoCellAnchorXml(args: {
  relationshipId: string;
  name: string;
  objectId: number;
  fromCol: number;
  fromRow: number;
  toCol: number;
  toRow: number;
}): string {
  const from = rowAnchor(args.fromRow);
  const to = rowAnchor(args.toRow);
  return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${args.fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${from.row}</xdr:row><xdr:rowOff>${from.offset}</xdr:rowOff></xdr:from><xdr:to><xdr:col>${args.toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${to.row}</xdr:row><xdr:rowOff>${to.offset}</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${args.objectId}" name="${escapeXml(
    args.name,
  )}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${args.relationshipId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`;
}

async function addEvidenceImages(
  zip: JSZip,
  templateParts: TemplateParts,
  evidenceSlots: EvidenceSlot[],
): Promise<void> {
  const photos = evidenceSlots.flatMap((slot) => slot.photos);
  if (photos.length === 0) return;

  let drawingXml = await readZipText(zip, templateParts.evidenceDrawingPath);
  let relsXml = zip.file(templateParts.evidenceDrawingRelsPath)
    ? await readZipText(zip, templateParts.evidenceDrawingRelsPath)
    : emptyRelationshipsXml();
  let contentTypesXml = await readZipText(zip, CONTENT_TYPES_PATH);

  let mediaIndex = nextMediaIndex(zip);
  let relationshipIndex = nextRelationshipId(relsXml);
  let objectId = nextDrawingObjectId(drawingXml);
  let anchorsXml = "";

  const sortedSlots = [...evidenceSlots]
    .filter((slot) => slot.photos.length > 0)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  for (let i = 0; i < Math.min(sortedSlots.length, SLOT_BOXES.length); i += 1) {
    const slot = sortedSlots[i];
    const box = SLOT_BOXES[i];
    const mediaPath = `xl/media/image${mediaIndex}.jpeg`;
    const targetPath = `../media/image${mediaIndex}.jpeg`;
    const relationshipId = `rId${relationshipIndex}`;
    const composedImage = await composeEvidenceImage(slot, box);
    const buffer = await composedImage.arrayBuffer();

    zip.file(mediaPath, buffer, { createFolders: false });
    relsXml = appendRelationship(relsXml, relationshipId, targetPath);
    contentTypesXml = ensureDefaultContentType(contentTypesXml, "jpeg", "image/jpeg");

    anchorsXml += twoCellAnchorXml({
      relationshipId,
      name: slot.vendor || "receipt",
      objectId,
      fromCol: box.left - 1,
      fromRow: box.top - 1,
      toCol: box.right,
      toRow: box.bottom,
    });

    mediaIndex += 1;
    relationshipIndex += 1;
    objectId += 1;
  }

  if (anchorsXml === "") return;
  drawingXml = drawingXml.replace("</xdr:wsDr>", `${anchorsXml}</xdr:wsDr>`);
  zip.file(templateParts.evidenceDrawingPath, drawingXml, { createFolders: false });
  zip.file(templateParts.evidenceDrawingRelsPath, relsXml, { createFolders: false });
  zip.file(CONTENT_TYPES_PATH, contentTypesXml, { createFolders: false });
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

  const zip = await loadTemplateZip();
  const templateParts = await resolveTemplateParts(zip);
  const detailXml = await readZipText(zip, templateParts.detailPath);
  zip.file(templateParts.detailPath, patchDetailSheetXml(detailXml, matches), {
    createFolders: false,
  });
  await addEvidenceImages(zip, templateParts, evidenceSlots);

  const buffer = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
  const month = inferMonth(matches);
  const filename = `(카드)제경비신청서_${month}월_${profile.dept}_${profile.name}.xlsx`;
  return { buffer, filename };
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
