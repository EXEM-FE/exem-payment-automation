import type { JournalEntry, Photo, PullResponse, PushResponse } from "@exem/shared";
import { loadPhoto } from "./db";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

export type HealthState = "ok" | "down" | "checking";

export async function health(timeoutMs = 1500): Promise<HealthState> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${API_BASE}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok ? "ok" : "down";
  } catch {
    return "down";
  }
}

export async function pushJournal(params: {
  dept: string;
  name: string;
  entries: JournalEntry[];
}): Promise<PushResponse> {
  const form = new FormData();
  form.set(
    "meta",
    JSON.stringify({
      dept: params.dept,
      name: params.name,
      entries: params.entries,
      uploadedAt: new Date().toISOString(),
    }),
  );

  const photoIds = new Set<string>();
  for (const entry of params.entries) {
    for (const photoId of entry.photoIds) photoIds.add(photoId);
  }
  for (const photoId of photoIds) {
    const blob = await loadPhoto(photoId);
    if (!blob) continue;
    form.append(photoId, blob, `${photoId}.jpg`);
  }

  const res = await fetch(`${API_BASE}/push`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw Object.assign(new Error(`push failed: ${res.status}`), { detail });
  }
  return (await res.json()) as PushResponse;
}

export async function pullJournal(params: {
  dept: string;
  name: string;
  pin: string;
}): Promise<PullResponse> {
  const res = await fetch(`${API_BASE}/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw Object.assign(new Error(`pull failed: ${res.status}`), {
      detail,
      status: res.status,
    });
  }
  return (await res.json()) as PullResponse;
}

export async function fetchPhotoBlob(params: {
  dept: string;
  name: string;
  token: string;
  photo: Photo;
}): Promise<Blob> {
  const url = new URL(`${API_BASE}/photos/${encodeURIComponent(params.photo.id)}`, window.location.origin);
  url.searchParams.set("dept", params.dept);
  url.searchParams.set("name", params.name);
  url.searchParams.set("token", params.token);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`photo failed: ${res.status}`);
  return res.blob();
}

export async function deleteServerSlot(params: {
  dept: string;
  name: string;
  token: string;
}) {
  const res = await fetch(`${API_BASE}/me`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dept: params.dept, name: params.name, pullToken: params.token }),
  });
  if (!res.ok) throw new Error(`delete failed: ${res.status}`);
}
