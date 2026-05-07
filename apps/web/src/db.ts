import { createStore, del, get, keys, set } from "idb-keyval";

const photoStore = createStore("exem-photos", "blobs");

export async function savePhoto(id: string, blob: Blob) {
  await set(id, blob, photoStore);
}

export async function loadPhoto(id: string): Promise<Blob | undefined> {
  return get<Blob>(id, photoStore);
}

export async function deletePhoto(id: string) {
  await del(id, photoStore);
}

export async function listPhotoIds(): Promise<string[]> {
  const all = await keys(photoStore);
  return all.filter((k): k is string => typeof k === "string");
}

export function newPhotoId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `photo-${crypto.randomUUID()}`;
  return `photo-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * 영수증 사진을 1600px 이내 JPEG q=0.85로 다운스케일.
 * EXIF 회전은 createImageBitmap이 자동 처리.
 */
export async function compressImage(file: File, maxSize = 1600): Promise<Blob> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > maxSize ? maxSize / longest : 1;
    const targetW = Math.round(bitmap.width * scale);
    const targetH = Math.round(bitmap.height * scale);
    const canvas = new OffscreenCanvas(targetW, targetH);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    return blob;
  } catch {
    return file;
  }
}

export async function blobToObjectUrl(blob: Blob): Promise<string> {
  return URL.createObjectURL(blob);
}
