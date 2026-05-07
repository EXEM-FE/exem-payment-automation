import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHubApp } from "./app.js";
import { Store } from "./store.js";

const PORT = Number(process.env.PORT ?? 4174);
const here = path.dirname(fileURLToPath(import.meta.url));
const STATIC_ROOT = process.env.STATIC_ROOT
  ? path.resolve(process.env.STATIC_ROOT)
  : path.resolve(here, "..", "..", "web", "dist");

const store = new Store();
const app = createHubApp(store);
type ResponseBody = ConstructorParameters<typeof Response>[0];

/* ===================== Static (PWA) ===================== */

app.get("/*", async (c) => {
  const reqPath = new URL(c.req.url).pathname;
  if (reqPath.startsWith("/api/")) return c.notFound();
  const candidate = reqPath === "/" ? "index.html" : reqPath.replace(/^\//, "");
  const filePath = path.resolve(STATIC_ROOT, candidate);
  if (!filePath.startsWith(STATIC_ROOT)) return c.notFound();
  const file = Bun.file(filePath);
  if (await file.exists()) {
    return new Response(file as unknown as ResponseBody, {
      headers: {
        "Cache-Control":
          reqPath === "/" || reqPath === "/index.html" ? "no-store" : "public, max-age=3600",
      },
    });
  }
  // SPA fallback
  const fallback = Bun.file(path.resolve(STATIC_ROOT, "index.html"));
  if (await fallback.exists()) {
    return new Response(fallback as unknown as ResponseBody, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  return c.notFound();
});

console.log(`hub listening on http://localhost:${PORT} (static: ${STATIC_ROOT})`);
export default { port: PORT, fetch: app.fetch };
