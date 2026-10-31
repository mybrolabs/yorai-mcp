#!/usr/bin/env node
// Remote mode: Streamable HTTP for a claude.ai custom connector or Claude Code `--transport http`.
// Auth: the secret lives in the URL path (/mcp/<MCP_SECRET>) because claude.ai custom connectors
// cannot send a static header. A Bearer header with the same secret also works.
import express from "express";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./server.js";
import { mountUploadRoutes } from "./uploads.js";
import { mountDownloadRoutes } from "./downloads.js";
const PORT = Number(process.env.PORT || 3333);
const HOST = process.env.HOST || "127.0.0.1";
const SECRET = process.env.MCP_SECRET || "";
const PUBLIC_URL = process.env.PUBLIC_URL || "";
if (SECRET.length < 24) {
    console.error("MCP_SECRET wajib di-set (minimal 24 karakter). Contoh: openssl rand -hex 24");
    process.exit(1);
}
const safeEq = (a, b) => {
    const x = Buffer.from(a), y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
};
const app = express();
app.use(express.json({ limit: "4mb" }));
app.get("/health", (_req, res) => res.json({ ok: true }));
mountUploadRoutes(app);
mountDownloadRoutes(app);
const handler = async (req, res) => {
    const fromPath = String(req.params.secret ?? "");
    const fromHeader = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!safeEq(fromPath, SECRET) && !safeEq(fromHeader, SECRET)) {
        res.status(401).json({ error: "unauthorized" });
        return;
    }
    if (req.method !== "POST") {
        // Stateless server: no GET SSE stream / DELETE session.
        res.status(405).set("Allow", "POST").json({ error: "method_not_allowed" });
        return;
    }
    // Stateless: a fresh server + transport per request.
    const server = buildServer({ publicUrl: PUBLIC_URL || undefined });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
        transport.close();
        server.close();
    });
    try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    }
    catch (e) {
        console.error(e);
        if (!res.headersSent)
            res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
};
app.all("/mcp/:secret", handler);
app.all("/mcp", handler);
app.listen(PORT, HOST, () => console.error(`yorai-mcp HTTP on http://${HOST}:${PORT}/mcp/<MCP_SECRET>`));
