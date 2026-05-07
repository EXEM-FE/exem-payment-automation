import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Photo } from "../../../packages/shared/src/types.js";
import { type PhotoBlob, type Store } from "./store.js";

type FileLike = {
  type?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
};

const isFileLike = (value: unknown): value is FileLike =>
  typeof value === "object" && value !== null && "arrayBuffer" in value;

export function createHubApp(store: Store) {
  const app = new Hono();

  app.use("/api/*", cors({ origin: (origin) => origin ?? "*", maxAge: 600 }));
  app.use("/api/*", async (_c, next) => {
    store.gc();
    await next();
  });

  /* ===================== Push ===================== */

  app.post("/api/push", async (c) => {
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: "invalid form" }, 400);
    }

    const metaRaw = form.get("meta");
    if (typeof metaRaw !== "string") return c.json({ error: "meta missing" }, 400);
    let meta: { dept?: string; name?: string; entries?: unknown };
    try {
      meta = JSON.parse(metaRaw);
    } catch {
      return c.json({ error: "meta json" }, 400);
    }

    const dept = (meta.dept ?? "").trim();
    const name = (meta.name ?? "").trim();
    if (!dept || !name) return c.json({ error: "dept/name required" }, 400);

    const photos: PhotoBlob[] = [];
    for (const [key, value] of form.entries()) {
      if (key === "meta") continue;
      if (!isFileLike(value)) continue;
      const buffer = new Uint8Array(await value.arrayBuffer());
      const mime = (value.type as Photo["mime"]) || "image/jpeg";
      photos.push({
        id: key,
        mime,
        size: buffer.byteLength,
        bytes: buffer,
      });
    }

    try {
      const slot = store.upsert({
        dept,
        name,
        entriesRaw: meta.entries,
        photos,
      });
      return c.json({
        pin: slot.pin,
        pinExpiresAt: new Date(slot.pinExpiresAt).toISOString(),
        slotExpiresAt: new Date(slot.expiresAt).toISOString(),
        uploaded: {
          entries: slot.entries.length,
          photos: slot.photos.size,
          bytes: slot.bytes,
        },
      });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      return c.json({ error: (err as Error).message }, status as 400 | 401 | 404 | 413 | 500);
    }
  });

  /* ===================== Pull ===================== */

  app.post("/api/pull", async (c) => {
    let body: { dept?: string; name?: string; pin?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "json required" }, 400);
    }
    const dept = (body.dept ?? "").trim();
    const name = (body.name ?? "").trim();
    const pin = (body.pin ?? "").trim();
    if (!dept || !name || pin.length !== 4) {
      return c.json({ error: "dept/name/pin required" }, 400);
    }
    try {
      const slot = store.consumePin({ dept, name, pin });
      const photoMeta: Photo[] = [...slot.photos.values()].map((photo) => ({
        id: photo.id,
        mime: photo.mime,
        size: photo.size,
      }));
      return c.json({
        entries: slot.entries,
        photoMeta,
        pullToken: slot.pullToken,
        uploadedAt: new Date(slot.uploadedAt).toISOString(),
      });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      return c.json({ error: (err as Error).message }, status as 400 | 401 | 404 | 500);
    }
  });

  /* ===================== Photo (lazy) ===================== */

  app.get("/api/photos/:photoId", (c) => {
    const dept = c.req.query("dept") ?? "";
    const name = c.req.query("name") ?? "";
    const token = c.req.query("token") ?? "";
    const photoId = c.req.param("photoId");
    if (!dept || !name || !token || !photoId) return c.json({ error: "params required" }, 400);
    try {
      const photo = store.getPhoto({ dept, name, photoId, token });
      return new Response(new Uint8Array(photo.bytes) as ConstructorParameters<typeof Response>[0], {
        status: 200,
        headers: {
          "Content-Type": photo.mime,
          "Cache-Control": "no-store",
        },
      });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      return c.json({ error: (err as Error).message }, status as 400 | 401 | 404 | 500);
    }
  });

  /* ===================== Delete ===================== */

  app.delete("/api/me", async (c) => {
    let body: { dept?: string; name?: string; pullToken?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "json required" }, 400);
    }
    const dept = (body.dept ?? "").trim();
    const name = (body.name ?? "").trim();
    const token = (body.pullToken ?? "").trim();
    if (!dept || !name || !token) return c.json({ error: "params required" }, 400);
    try {
      store.deleteSlot({ dept, name, token });
      return c.json({ ok: true });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      return c.json({ error: (err as Error).message }, status as 400 | 401 | 404 | 500);
    }
  });

  return app;
}
