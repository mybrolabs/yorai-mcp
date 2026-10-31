import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { YoraiClient, YoraiError, loadConfig } from "./yorai.js";
import { createUploadSession, getUploadSession } from "./uploads.js";
import { downloadDir, publicDownloadUrl } from "./downloads.js";

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".bmp": "image/bmp", ".mp4": "video/mp4", ".mov": "video/quicktime",
  ".webm": "video/webm", ".mkv": "video/x-matroska", ".mp3": "audio/mpeg", ".wav": "audio/wav",
  ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg",
};
const EXT_BY_MIME = Object.fromEntries(Object.entries(MIME).map(([e, m]) => [m, e]));

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

function fail(e: unknown) {
  let msg: string;
  if (e instanceof YoraiError) {
    msg = `Yorai error ${e.status} (${e.code}): ${e.message}`;
    if (e.retryAfter) msg += ` — coba lagi setelah ${e.retryAfter} detik.`;
    if (e.code === "insufficient_credits") msg += " Saldo kurang, top up di yorai.id.";
  } else {
    msg = e instanceof Error ? e.message : String(e);
  }
  return { content: [{ type: "text" as const, text: msg }], isError: true };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Compact a /models/{slug} response so the model sees only what it needs to build `input`.
function compactModel(m: any) {
  return {
    slug: m.slug,
    title: m.title,
    provider: m.provider,
    category: m.category,
    types: (m.types ?? []).map((t: any) => ({
      type: t.type,
      media_in: t.media_in,
      inputs: (t.inputs ?? []).map((i: any) => {
        const o: Record<string, unknown> = { name: i.name, type: i.type, control: i.control };
        if (i.required) o.required = true;
        if (i.default !== undefined) o.default = i.default;
        if (i.options?.length) o.options = i.options.map((x: any) => x.value);
        for (const k of ["min", "max", "step", "maxLength", "maxItems", "maxFileMb", "media", "imageRole"]) {
          if (i[k] !== undefined && i[k] !== "" && !(Array.isArray(i[k]) && !i[k].length)) o[k] = i[k];
        }
        if (i.affects_price) o.affects_price = true;
        if (i.description) o.description = i.description;
        return o;
      }),
      rules: t.rules?.length ? t.rules : undefined,
      prices: (t.prices ?? []).map((p: any) => ({ unit: p.unit, credits: p.credits, when: p.when, component: p.component || undefined })),
    })),
  };
}

const jobBody = {
  model: z.string().describe("Model slug, e.g. bytedance-seedance-2-5, z-image, nano-banana-2-lite"),
  type: z.string().optional().describe("Generation type, e.g. text-to-image, image-to-video. Optional only if the model has one type."),
  input: z.record(z.string(), z.any()).describe("Model inputs. Use exact names/values from yorai_get_model. File inputs take file IDs from yorai_upload_file."),
};

export interface BuildOptions {
  /** Public https base URL of this server (HTTP mode). Enables one-time upload links. */
  publicUrl?: string;
}

export function buildServer(opts: BuildOptions = {}) {
  const client = new YoraiClient(loadConfig());
  const server = new McpServer(
    { name: "yorai", version: "0.1.0" },
    {
      instructions:
        "Yorai (yorai.id) generates images, video, audio and text from many models on one prepaid credit balance (1 credit = IDR 1,000). " +
        "Workflow: yorai_list_models -> yorai_get_model (exact input names) -> yorai_quote -> tell the user the cost -> yorai_create_job -> yorai_get_job until succeeded/failed. " +
        "Reference images/videos/audio must be uploaded with yorai_upload_file first; their IDs go in the model's file inputs (arbitrary URLs are rejected). " +
        "Every job spends real credits: never resubmit a job to retry — reuse the same idempotency_key. Results expire after 14 days." +
        (opts.publicUrl ? " If the user wants to use their own photo/video/audio (e.g. attached in chat or on their phone), call yorai_upload_link, give them the link, then call yorai_upload_status after they say it is done and use the returned file IDs." : ""),
    },
  );

  server.registerTool(
    "yorai_balance",
    { title: "Yorai balance", description: "Check available and held Yorai credits (1 credit = IDR 1,000).", inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => {
      try {
        const b = await client.get("/balance");
        return json({ ...b, available_idr: Math.round((b.available ?? 0) * 1000), held_idr: Math.round((b.held ?? 0) * 1000) });
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    "yorai_list_models",
    {
      title: "List Yorai models",
      description: "List models in the Yorai catalog with their starting price. Filter by category (chat, image, video, audio), type or provider slug.",
      inputSchema: {
        category: z.enum(["chat", "image", "video", "audio"]).optional(),
        type: z.string().optional().describe("e.g. text-to-video, image-to-video, text-to-image"),
        provider: z.string().optional().describe("Maker slug, e.g. bytedance, kling, google"),
        search: z.string().optional().describe("Client-side filter on slug/name"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ category, type, provider, search }) => {
      try {
        const r = await client.get("/models", { category, type, provider }, false);
        let data: any[] = r.data ?? [];
        if (search) {
          const q = search.toLowerCase();
          data = data.filter((m) => `${m.slug ?? m.id ?? ""} ${m.title ?? m.name ?? ""}`.toLowerCase().includes(q));
        }
        return json(data.map((m) => ({
          slug: m.slug ?? m.id,
          name: m.title ?? m.name,
          provider: m.provider,
          category: m.category ?? m.categories,
          types: (m.types ?? []).map((t: any) => (typeof t === "string" ? t : t.type)),
          from: m.pricing?.from ?? m.from,
          unit: m.pricing?.unit ?? m.unit,
        })));
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    "yorai_get_model",
    {
      title: "Get Yorai model",
      description: "Get one model's generation types, exact input names/options/limits, linkage rules and prices. Call before quoting or creating a job.",
      inputSchema: { slug: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ slug }) => {
      try { return json(compactModel(await client.get(`/models/${encodeURIComponent(slug)}`, undefined, false))); }
      catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    "yorai_quote",
    {
      title: "Quote a Yorai job",
      description: "Price a request without starting a job or holding credits. Returns credits, upTo and line items. Free.",
      inputSchema: jobBody,
      annotations: { readOnlyHint: true },
    },
    async ({ model, type, input }) => {
      try {
        const q = await client.post("/quote", { model, type, input });
        return json({ ...q, estimated_idr: Math.round((q.upTo ?? q.credits ?? 0) * 1000) });
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    "yorai_create_job",
    {
      title: "Create a Yorai job",
      description:
        "Start an image/video/audio generation. SPENDS CREDITS. The server quotes first and refuses if the hold exceeds max_credits. " +
        "Returns the job; then poll yorai_get_job. Pass the same idempotency_key when retrying an ambiguous failure so you are not charged twice.",
      inputSchema: {
        ...jobBody,
        max_credits: z.number().positive().describe("Refuse if the quoted hold (upTo) is above this. Use the amount the user approved."),
        idempotency_key: z.string().max(100).optional(),
        webhook_url: z.string().url().optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ model, type, input, max_credits, idempotency_key, webhook_url }) => {
      try {
        const q = await client.post("/quote", { model, type, input });
        const hold = q.upTo ?? q.credits;
        if (hold > max_credits) {
          return fail(new Error(`Quote ${hold} credits (≈Rp${Math.round(hold * 1000).toLocaleString("id-ID")}) melebihi max_credits ${max_credits}. Job tidak dibuat.`));
        }
        const key = idempotency_key || `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const body: Record<string, unknown> = { model, type, input };
        if (webhook_url) body.webhook_url = webhook_url;
        const job = await client.post("/jobs", body, { "Idempotency-Key": key });
        return json({ job, quoted_credits: hold, idempotency_key: key });
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    "yorai_get_job",
    {
      title: "Get a Yorai job",
      description: "Get a job's status and outputs. Set wait_seconds (max 55) to poll until it finishes or the wait ends. Status: queued, running, succeeded, failed.",
      inputSchema: {
        id: z.string(),
        wait_seconds: z.number().int().min(0).max(55).optional().default(0),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id, wait_seconds }) => {
      try {
        const deadline = Date.now() + wait_seconds * 1000;
        let job = await client.get(`/jobs/${encodeURIComponent(id)}`);
        while (!["succeeded", "failed"].includes(job.status) && Date.now() < deadline) {
          await sleep(Math.min(5000, Math.max(0, deadline - Date.now())));
          job = await client.get(`/jobs/${encodeURIComponent(id)}`);
        }
        return json(job);
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    "yorai_list_jobs",
    {
      title: "List Yorai jobs",
      description: "List recent jobs, newest first. Use next_cursor for more.",
      inputSchema: { limit: z.number().int().min(1).max(100).optional().default(20), cursor: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ limit, cursor }) => {
      try { return json(await client.get("/jobs", { limit, cursor })); } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    "yorai_cancel_job",
    {
      title: "Cancel a Yorai job",
      description: "Cancel a queued job and release its credit hold. Running jobs cannot be cancelled (409).",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      try { return json(await client.post(`/jobs/${encodeURIComponent(id)}/cancel`, {})); } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    "yorai_upload_file",
    {
      title: "Upload a file to Yorai",
      description:
        "Upload an image (PNG/JPEG/WebP ≤30 MB), video (MP4/MOV/WebM ≤95 MB, 2–60 s) or audio (MP3/WAV/M4A/AAC/OGG ≤95 MB) and get a file ID for job inputs. " +
        "Give either a public https URL (the server downloads it) or a local path on the machine running this MCP server.",
      inputSchema: {
        url: z.string().url().optional(),
        path: z.string().optional(),
        filename: z.string().optional(),
      },
    },
    async ({ url, path, filename }) => {
      try {
        let data: Uint8Array;
        let name = filename;
        let mime: string | undefined;
        if (path) {
          const p = resolve(path.replace(/^~(?=$|\/|\\)/, process.env.HOME || process.env.USERPROFILE || "~"));
          data = new Uint8Array(await readFile(p));
          name ||= basename(p);
        } else if (url) {
          const r = await fetch(url);
          if (!r.ok) throw new Error(`Gagal download ${url}: HTTP ${r.status}`);
          data = new Uint8Array(await r.arrayBuffer());
          mime = r.headers.get("content-type")?.split(";")[0] || undefined;
          name ||= basename(new URL(url).pathname) || "upload";
        } else {
          throw new Error("Isi salah satu: url atau path.");
        }
        mime = MIME[extname(name!).toLowerCase()] || mime || "application/octet-stream";
        if (!extname(name!) && EXT_BY_MIME[mime]) name += EXT_BY_MIME[mime];
        return json(await client.uploadFile(data, name!, mime));
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    "yorai_download_file",
    {
      title: "Download a Yorai file",
      description:
        "Save a Yorai file (e.g. a job output id) to disk on the machine running this MCP server. Yorai purges results after 14 days. " +
        "Default folder: YORAI_DOWNLOAD_DIR or ~/Downloads/yorai. In remote mode the result includes download_url, a public link the user can open on their phone — always give that link to the user.",
      inputSchema: { id: z.string(), save_dir: z.string().optional(), filename: z.string().optional() },
    },
    async ({ id, save_dir, filename }) => {
      try {
        const dir = resolve(save_dir || downloadDir());
        const f = await client.downloadFile(id);
        const name = filename || f.filename || `${id}${EXT_BY_MIME[f.mime.split(";")[0]] || ""}`;
        const out = join(dir, basename(name));
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, f.data);
        const result: Record<string, unknown> = { saved_to: out, bytes: f.data.byteLength, mime: f.mime };
        if (opts.publicUrl && dir === downloadDir()) {
          result.download_url = publicDownloadUrl(opts.publicUrl, basename(out));
          result.note = "Kasih download_url ke user: bisa langsung dibuka di HP. Tambah ?dl=1 untuk paksa download.";
        }
        return json(result);
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    "yorai_chat",
    {
      title: "Yorai chat completion",
      description: "Run a text chat model from the Yorai catalog (OpenAI chat.completion format, no streaming, text only). Spends a small amount of credits.",
      inputSchema: {
        model: z.string().default("deepseek-v4-1-flash"),
        messages: z.array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string() })).min(1),
        max_tokens: z.number().int().positive().optional(),
        temperature: z.number().min(0).max(2).optional(),
      },
    },
    async ({ model, messages, max_tokens, temperature }) => {
      try {
        const r = await client.post("/chat/completions", { model, messages, max_tokens, temperature });
        return json({ text: r.choices?.[0]?.message?.content, usage: r.usage, yorai: r.yorai });
      } catch (e) { return fail(e); }
    },
  );

  if (opts.publicUrl) {
    const base = opts.publicUrl.replace(/\/+$/, "");
    server.registerTool(
      "yorai_upload_link",
      {
        title: "Create a one-time upload link",
        description:
          "Create a one-time link (valid 30 min, up to 10 files) where the user uploads their own image/video/audio from their phone or browser. " +
          "Files go straight to Yorai. Give the link to the user, wait until they say it is done, then call yorai_upload_status to get the file IDs. " +
          "Use this whenever the user wants to use a file they have (including one attached in chat), because this server cannot read chat attachments.",
        inputSchema: { note: z.string().max(200).optional().describe("Short hint shown on the upload page, e.g. 'Foto produk buat first frame'") },
      },
      async ({ note }) => {
        const s = createUploadSession(note);
        return json({ upload_url: `${base}/u/${s.token}`, token: s.token, expires_at: new Date(s.expiresAt).toISOString(), next: "Kasih link ini ke user. Setelah dia bilang udah, panggil yorai_upload_status." });
      },
    );

    server.registerTool(
      "yorai_upload_status",
      {
        title: "Check an upload link",
        description: "Get the status and Yorai file IDs of a link from yorai_upload_link. Set wait_seconds (max 55) to wait for the upload to finish.",
        inputSchema: {
          token: z.string().describe("Token or full upload_url from yorai_upload_link"),
          wait_seconds: z.number().int().min(0).max(55).default(0),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ token, wait_seconds }) => {
        const deadline = Date.now() + wait_seconds * 1000;
        let s = getUploadSession(token);
        if (!s) return fail(new Error("Link upload nggak ditemukan (mungkin server baru restart atau token salah). Bikin link baru."));
        while (s.status !== "done" && Date.now() < deadline) {
          await sleep(2000);
          s = getUploadSession(token)!;
        }
        const expired = Date.now() > s.expiresAt && s.status !== "done";
        return json({ status: expired ? "expired" : s.status, files: s.files, error: s.error });
      },
    );
  }

  return server;
}
