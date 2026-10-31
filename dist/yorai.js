// Thin client for the Yorai REST API (https://yorai.id/api/v1).
// Docs: https://yorai.id/docs/api/llms-full.txt
export class YoraiError extends Error {
    status;
    code;
    retryAfter;
    constructor(status, code, message, retryAfter) {
        super(message);
        this.status = status;
        this.code = code;
        this.retryAfter = retryAfter;
    }
}
export function loadConfig() {
    return {
        apiKey: process.env.YORAI_API_KEY?.trim() || undefined,
        baseUrl: (process.env.YORAI_BASE_URL || "https://yorai.id/api/v1").replace(/\/+$/, ""),
    };
}
export class YoraiClient {
    cfg;
    constructor(cfg) {
        this.cfg = cfg;
    }
    headers(extra = {}, auth = true) {
        const h = { Accept: "application/json", ...extra };
        if (auth) {
            if (!this.cfg.apiKey) {
                throw new YoraiError(401, "missing_api_key", "YORAI_API_KEY belum di-set di environment MCP server.");
            }
            h.Authorization = `Bearer ${this.cfg.apiKey}`;
        }
        return h;
    }
    async handle(res) {
        const text = await res.text();
        let body = undefined;
        try {
            body = text ? JSON.parse(text) : undefined;
        }
        catch {
            body = text;
        }
        if (!res.ok) {
            const err = body?.error ?? {};
            throw new YoraiError(res.status, err.code || `http_${res.status}`, err.message || (typeof body === "string" ? body.slice(0, 500) : res.statusText), res.headers.get("retry-after"));
        }
        return body;
    }
    async get(path, query, auth = true) {
        const url = new URL(this.cfg.baseUrl + path);
        for (const [k, v] of Object.entries(query ?? {})) {
            if (v !== undefined && v !== "")
                url.searchParams.set(k, String(v));
        }
        const res = await fetch(url, { headers: this.headers({}, auth) });
        return this.handle(res);
    }
    async post(path, body, extraHeaders = {}) {
        const res = await fetch(this.cfg.baseUrl + path, {
            method: "POST",
            headers: this.headers({ "Content-Type": "application/json", ...extraHeaders }),
            body: JSON.stringify(body),
        });
        return this.handle(res);
    }
    async uploadFile(data, filename, mime) {
        const form = new FormData();
        form.append("file", new Blob([data], { type: mime }), filename);
        const res = await fetch(this.cfg.baseUrl + "/files", {
            method: "POST",
            headers: this.headers(),
            body: form,
        });
        return this.handle(res);
    }
    async downloadFile(id) {
        const res = await fetch(`${this.cfg.baseUrl}/files/${encodeURIComponent(id)}?download=1`, {
            headers: this.headers({ Accept: "*/*" }),
        });
        if (!res.ok)
            await this.handle(res);
        const cd = res.headers.get("content-disposition") || "";
        const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
        return {
            data: new Uint8Array(await res.arrayBuffer()),
            mime: res.headers.get("content-type") || "application/octet-stream",
            filename: m ? decodeURIComponent(m[1]) : undefined,
        };
    }
}
