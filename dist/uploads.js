import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { YoraiClient, YoraiError, loadConfig } from "./yorai.js";
const TTL_MS = 30 * 60 * 1000;
const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const sessions = new Map();
function sweep() {
    const now = Date.now();
    for (const [k, s] of sessions)
        if (s.expiresAt + TTL_MS < now)
            sessions.delete(k);
}
export function createUploadSession(note) {
    sweep();
    const token = randomBytes(18).toString("base64url");
    const s = { token, note, createdAt: Date.now(), expiresAt: Date.now() + TTL_MS, status: "waiting", files: [] };
    sessions.set(token, s);
    return s;
}
export function getUploadSession(tokenOrUrl) {
    const token = tokenOrUrl.trim().replace(/\/+$/, "").split("/").pop() || "";
    return sessions.get(token);
}
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function page(body) {
    return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Upload ke Yorai</title><style>
:root{color-scheme:light dark;--bg:#f6f5f2;--card:#fff;--fg:#1d1d1f;--mut:#6b6b70;--ac:#e8590c;--ok:#2b8a3e;--bd:#e3e1dc}
@media(prefers-color-scheme:dark){:root{--bg:#141414;--card:#1f1f1f;--fg:#f2f2f2;--mut:#a0a0a5;--bd:#333}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;justify-content:center;padding:24px 16px}
.c{width:100%;max-width:440px;background:var(--card);border:1px solid var(--bd);border-radius:16px;padding:24px}
h1{font-size:20px;margin:0 0 4px}p{margin:0 0 16px;color:var(--mut)}.note{color:var(--fg);background:var(--bg);border-radius:10px;padding:10px 12px}
label.pick{display:block;border:2px dashed var(--bd);border-radius:12px;padding:28px 12px;text-align:center;cursor:pointer;font-weight:600}
input[type=file]{display:none}button{width:100%;margin-top:14px;padding:14px;border:0;border-radius:12px;background:var(--ac);color:#fff;font-size:16px;font-weight:600}
button:disabled{opacity:.5}ul{padding-left:18px;margin:12px 0 0}.ok{color:var(--ok);font-weight:600}.err{color:#e03131;font-weight:600}
progress{width:100%;margin-top:12px;height:10px}
</style></head><body><div class="c">${body}</div></body></html>`;
}
function formPage(s) {
    return page(`<h1>Upload ke Yorai</h1>
<p>Pilih foto/video/audio, terus tekan Upload. Abis itu balik ke chat Claude.</p>
${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}
<form id="f"><label class="pick" for="i" id="lbl">📷 Pilih file (maks ${MAX_FILES})</label>
<input id="i" name="file" type="file" multiple accept="image/*,video/*,audio/*">
<button id="b" disabled>Upload</button><progress id="p" value="0" max="100" hidden></progress></form>
<div id="r"></div>
<script>
const i=document.getElementById('i'),b=document.getElementById('b'),l=document.getElementById('lbl'),p=document.getElementById('p'),r=document.getElementById('r');
i.onchange=()=>{const n=i.files.length;l.textContent=n?n+' file dipilih':'📷 Pilih file';b.disabled=!n;};
document.getElementById('f').onsubmit=e=>{e.preventDefault();const fd=new FormData();for(const f of i.files)fd.append('file',f,f.name);
b.disabled=true;b.textContent='Mengupload...';p.hidden=false;const x=new XMLHttpRequest();x.open('POST',location.pathname);
x.upload.onprogress=ev=>{if(ev.lengthComputable)p.value=ev.loaded/ev.total*100};
x.onload=()=>{let d={};try{d=JSON.parse(x.responseText)}catch{}p.hidden=true;
if(x.status===200){r.innerHTML='<p class="ok">✅ Berhasil! '+d.files.length+' file masuk ke Yorai.</p><p>Balik ke chat Claude, bilang "udah".</p>';document.getElementById('f').hidden=true;}
else{r.innerHTML='<p class="err">Gagal: '+(d.error||x.status)+'</p>';b.disabled=false;b.textContent='Coba lagi';}};
x.onerror=()=>{r.innerHTML='<p class="err">Koneksi putus, coba lagi.</p>';b.disabled=false;b.textContent='Coba lagi';};x.send(fd);};
</script>`);
}
export function mountUploadRoutes(app) {
    app.get("/u/:token", (req, res) => {
        const s = sessions.get(String(req.params.token));
        res.set("Cache-Control", "no-store").set("X-Robots-Tag", "noindex");
        if (!s)
            return void res.status(404).send(page(`<h1>Link nggak valid</h1><p>Minta link baru ke Claude.</p>`));
        if (Date.now() > s.expiresAt)
            return void res.status(410).send(page(`<h1>Link udah kedaluwarsa</h1><p>Link berlaku 30 menit. Minta link baru ke Claude.</p>`));
        if (s.status === "done")
            return void res.send(page(`<h1>Udah ke-upload ✅</h1><p>${s.files.length} file udah masuk. Balik ke chat Claude.</p>`));
        res.send(formPage(s));
    });
    app.post("/u/:token", async (req, res) => {
        const s = sessions.get(String(req.params.token));
        if (!s || Date.now() > s.expiresAt)
            return void res.status(410).json({ error: "Link udah nggak berlaku, minta link baru ke Claude." });
        if (s.status === "uploading")
            return void res.status(409).json({ error: "Upload lain lagi jalan, tunggu sebentar." });
        if (s.status === "done")
            return void res.status(409).json({ error: "Link ini udah dipakai." });
        const len = Number(req.headers["content-length"] || 0);
        if (len > MAX_TOTAL_BYTES)
            return void res.status(413).json({ error: "Total file kegedean (maks 200 MB)." });
        s.status = "uploading";
        try {
            const webReq = new Request("http://local/upload", {
                method: "POST",
                headers: { "content-type": String(req.headers["content-type"] || "") },
                body: Readable.toWeb(req),
                duplex: "half",
            });
            const form = await webReq.formData();
            const files = form.getAll("file").filter((f) => typeof f !== "string");
            if (!files.length)
                throw new Error("Nggak ada file yang dipilih.");
            if (files.length > MAX_FILES)
                throw new Error(`Maksimal ${MAX_FILES} file sekali upload.`);
            const client = new YoraiClient(loadConfig());
            const out = [];
            for (const f of files) {
                const r = await client.uploadFile(new Uint8Array(await f.arrayBuffer()), f.name || "upload", f.type || "application/octet-stream");
                out.push({ id: r.id ?? r.file_id ?? r.data?.id, name: f.name, mime: f.type, bytes: f.size });
            }
            s.files.push(...out);
            s.status = "done";
            res.json({ files: out.map(({ name }) => ({ name })) });
        }
        catch (e) {
            s.status = "error";
            s.error = e instanceof YoraiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
            // allow retry on the same link
            s.status = "waiting";
            res.status(400).json({ error: s.error });
        }
    });
}
