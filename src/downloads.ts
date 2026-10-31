// Public download links for files saved by yorai_download_file (remote/HTTP mode only).
// Link format: <PUBLIC_URL>/f/<sig>/<filename>, where sig = HMAC-SHA256(MCP_SECRET, filename).
// Stateless: no database, links survive restarts, and nobody can guess a link without the secret.
import type express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export function downloadDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || ".";
  return resolve(process.env.YORAI_DOWNLOAD_DIR || join(home, "Downloads", "yorai"));
}

function sign(name: string): string {
  const secret = process.env.MCP_SECRET || "";
  return createHmac("sha256", secret).update(`download:${name}`).digest("base64url").slice(0, 32);
}

export function publicDownloadUrl(publicUrl: string, filename: string): string {
  const name = basename(filename);
  return `${publicUrl.replace(/\/+$/, "")}/f/${sign(name)}/${encodeURIComponent(name)}`;
}

export function mountDownloadRoutes(app: express.Express) {
  app.get("/f/:sig/:name", async (req, res) => {
    const name = basename(String(req.params.name));
    const given = Buffer.from(String(req.params.sig));
    const expected = Buffer.from(sign(name));
    if (!name || name.startsWith(".") || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      res.status(404).send("Not found");
      return;
    }
    const file = join(downloadDir(), name);
    try {
      if (!(await stat(file)).isFile()) throw new Error("not a file");
    } catch {
      res.status(404).send("File tidak ada (mungkin sudah dihapus).");
      return;
    }
    // ?dl=1 forces a download; otherwise images/videos open inline in the phone browser.
    if (req.query.dl) res.attachment(name);
    res.set("Cache-Control", "private, max-age=3600");
    res.sendFile(file);
  });
}
