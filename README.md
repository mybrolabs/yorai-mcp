# yorai-mcp

Sambungin Claude ke [Yorai](https://yorai.id), biar Claude bisa generate gambar, video, dan audio langsung dari chat. Claude bisa cek saldo, lihat katalog model, hitung biaya, generate, upload foto referensi dari HP, dan kasih link download hasilnya.

Contoh pemakaian setelah terpasang:

- "Cek saldo Yorai gue"
- "Model video apa aja di Yorai yang paling murah per detik?"
- "Bikin video Seedance 2.5 480p 5 detik: kucing oren lompat ke meja. Quote dulu ya"
- "Gue mau upload foto gue buat character sheet pakai Nano Banana 2"

> **Biaya:** semua generate makan kredit dari akun Yorai **lu sendiri** (1 kredit = Rp1.000). Setiap orang pakai API key masing-masing.

---

## Pilih cara pasang

| | **A. Lokal di PC** | **B. Online di VPS** |
|---|---|---|
| Dipakai dari | Claude Desktop / Claude Code di PC itu aja | claude.ai di web **dan HP**, kapan aja |
| Butuh | Node.js | VPS + domain/subdomain |
| Upload foto dari HP | ❌ | ✅ (link upload) |
| Link download hasil | ❌ (hasil disimpan ke folder PC) | ✅ (link bisa dibuka di HP) |
| Tingkat kesulitan | Gampang, ±10 menit | Menengah, ±30 menit |

Kalau baru coba-coba, mulai dari **A**. Kalau mau pakai dari HP, ambil **B**.

### Langkah 0 (wajib, dua-duanya): bikin API key Yorai

1. Login ke https://yorai.id, pastikan ada saldo kredit
2. Buka https://yorai.id/app/api → bikin API key baru
3. Salin key-nya (diawali `yk_`). **Jangan dibagi ke siapa pun.**

---

## A. Pasang lokal di PC (Claude Desktop)

### A1. Install Node.js

Download versi **LTS** di https://nodejs.org lalu install. Cek di PowerShell / Terminal:

```bash
node -v
```

Harus muncul `v20` atau lebih baru.

### A2. Download repo ini

Pakai Git:

```bash
git clone https://github.com/mybrolabs/yorai-mcp.git
cd yorai-mcp
npm install
```

Atau tanpa Git: klik tombol hijau **Code → Download ZIP** di halaman GitHub, extract (misal ke `C:\yorai-mcp`), lalu di folder itu jalankan `npm install`.

### A3. Daftarkan ke Claude Desktop

Buka file config Claude Desktop:

- **Windows:** tekan `Win + R`, ketik `%APPDATA%\Claude`, buka `claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

(Kalau belum ada, buat aja file baru dengan nama itu.)

Isi seperti ini. Ganti path dan API key-nya:

```json
{
  "mcpServers": {
    "yorai": {
      "command": "node",
      "args": ["C:\\yorai-mcp\\dist\\index.js"],
      "env": {
        "YORAI_API_KEY": "yk_isi_key_lu_di_sini",
        "YORAI_DOWNLOAD_DIR": "C:\\Users\\NAMA_LU\\Downloads\\yorai"
      }
    }
  }
}
```

> Di Windows, backslash di path **harus dobel** (`\\`). Kalau file-nya udah ada isi `mcpServers` lain, tambahin blok `"yorai": {...}` di dalamnya, jangan bikin `mcpServers` kedua.

### A4. Restart & tes

Tutup Claude Desktop **sampai benar-benar keluar** (cek system tray), buka lagi, lalu ketik di chat:

```
Cek saldo Yorai gue
```

Kalau saldo muncul, berarti udah jalan. Hasil generate otomatis tersimpan ke folder `YORAI_DOWNLOAD_DIR`.

**Pakai Claude Code?** Cukup satu perintah:

```bash
claude mcp add yorai --scope user -e YORAI_API_KEY=yk_xxx -- node /path/ke/yorai-mcp/dist/index.js
```

---

## B. Pasang online di VPS (bisa dipakai dari HP)

Panduan ini pakai **VPS Hostinger dengan template n8n** (udah ada Docker + Traefik + HTTPS otomatis). VPS lain juga bisa, lihat [VPS selain Hostinger](#vps-selain-hostinger-n8n).

### B1. Fork repo ini (disarankan)

Klik **Fork** di kanan atas halaman GitHub. Container di VPS bakal narik kode dari repo setiap kali restart, jadi lebih aman pakai fork lu sendiri: kode yang jalan di server lu cuma berubah kalau **lu** yang ubah.

### B2. Siapin subdomain

Di pengelola DNS domain lu (Hostinger, Cloudflare, dll), tambah record:

| Type | Name | Value |
|---|---|---|
| A | `yorai-mcp` | IP VPS lu |

Hasilnya misalnya `yorai-mcp.domainlu.com`. Kalau pakai Cloudflare, set ke **DNS only** (awan abu-abu) supaya sertifikat HTTPS bisa dibuat.

### B3. Bikin secret

Secret ini jadi "password" connector lu. Di terminal VPS (atau PC yang ada OpenSSL):

```bash
openssl rand -hex 24
```

Simpan hasilnya.

### B4. Jalankan container

SSH ke VPS, lalu:

```bash
mkdir -p /docker/yorai-mcp && cd /docker/yorai-mcp
wget -O docker-compose.yml https://raw.githubusercontent.com/mybrolabs/yorai-mcp/main/deploy/docker-compose.vps.yml
nano .env
```

Isi `.env` (ganti semua nilainya):

```env
YORAI_API_KEY=yk_isi_key_lu
MCP_SECRET=hasil_openssl_tadi
DOMAIN=yorai-mcp.domainlu.com
YORAI_MCP_REPO=USERNAME_GITHUB_LU/yorai-mcp
```

Simpan (`Ctrl+O`, Enter, `Ctrl+X`), lalu jalankan:

```bash
docker compose up -d
sleep 20 && docker compose logs --tail 5
```

Kalau muncul `kode-terbaru-terpasang` dan `yorai-mcp HTTP on ...`, server udah jalan. Cek juga di browser HP: buka `https://yorai-mcp.domainlu.com/health`, harus keluar `{"ok":true}`.

### B5. Sambungkan ke claude.ai

1. Buka claude.ai → **Settings → Connectors → Add custom connector**
2. Name: `Yorai`
3. URL:
   ```
   https://yorai-mcp.domainlu.com/mcp/MCP_SECRET_LU
   ```
4. Simpan, lalu tes di chat baru: **"Cek saldo Yorai gue"**

> ⚠️ URL connector itu berisi secret lu. **Perlakukan kayak password**: jangan di-screenshot ke grup, jangan di-share. Siapa pun yang pegang URL itu bisa pakai kredit Yorai lu.

### Fitur khusus mode online

- **Upload dari HP:** bilang ke Claude "gue mau upload foto". Claude kasih link upload (berlaku 30 menit, maks 10 file). Upload dari browser HP, bilang "udah", Claude langsung pakai fotonya.
- **Link download:** setiap hasil yang di-download Claude dapat link `https://domain-lu/f/...` yang bisa langsung dibuka di HP. Tambah `?dl=1` di akhir link untuk paksa download. Link-nya ditandatangani pakai `MCP_SECRET`, jadi nggak bisa ditebak orang, dan tetap jalan walaupun container restart.
- Hasil tersimpan di volume Docker `yorai_data` (folder `/data/hasil` di dalam container). Server Yorai sendiri hapus hasil setelah 14 hari, jadi salinan di VPS ini yang awet.

### Update ke versi terbaru

Kalau pakai fork: di GitHub buka fork lu → **Sync fork → Update branch**. Lalu di VPS:

```bash
cd /docker/yorai-mcp && docker compose restart
```

### VPS selain Hostinger n8n

File compose di atas numpang network `n8n_default` dan Traefik dari template n8n. Kalau VPS lu nggak punya itu, cara paling simpel:

```bash
git clone https://github.com/USERNAME_GITHUB_LU/yorai-mcp.git && cd yorai-mcp
cp .env.example .env   # isi YORAI_API_KEY, MCP_SECRET, PUBLIC_URL=https://yorai-mcp.domainlu.com
docker build -t yorai-mcp .
docker run -d --restart unless-stopped -p 127.0.0.1:3333:3333 --env-file .env -v yorai_data:/data -e YORAI_DOWNLOAD_DIR=/data/hasil yorai-mcp
```

Lalu pasang reverse proxy HTTPS di depannya, misalnya [Caddy](https://caddyserver.com):

```
yorai-mcp.domainlu.com {
    reverse_proxy 127.0.0.1:3333
}
```

---

## Troubleshooting

| Masalah | Penyebab & solusi |
|---|---|
| Claude nggak kenal tool Yorai | Lokal: restart Claude Desktop sampai benar-benar keluar, cek path di config (backslash dobel). Online: cek URL connector, buka chat baru. |
| `Kunci API tidak valid` | `YORAI_API_KEY` salah atau udah di-revoke. Bikin baru di yorai.id/app/api. |
| `Saldo kurang` | Top up di yorai.id. |
| `/health` nggak bisa dibuka | DNS belum nyambung (tunggu beberapa menit), Cloudflare masih proxied (oranye), atau container mati (`docker compose logs`). |
| Container langsung mati, log `MCP_SECRET wajib di-set` | `MCP_SECRET` kosong atau kurang dari 24 karakter. |
| Link `yorai.id/api/v1/files/...` error `invalid_api_key` di browser | Itu link API, bukan link download. Minta Claude download hasilnya, nanti dapat link `/f/...`. |
| Lupa / bocor `MCP_SECRET` | Ganti di `.env`, `docker compose up -d`, lalu update URL connector di claude.ai. Link download lama ikut mati. |

---

## Daftar tools

| Tool | Fungsi | Makan kredit |
|---|---|---|
| `yorai_balance` | Saldo available/held (+ konversi Rupiah) | – |
| `yorai_list_models` | Katalog model, filter category/type/provider | – |
| `yorai_get_model` | Nama input, opsi, batas, rules & harga satu model | – |
| `yorai_quote` | Hitung biaya tanpa bikin job | – |
| `yorai_create_job` | Generate. Quote dulu otomatis, **ditolak kalau > `max_credits`** | ✅ |
| `yorai_get_job` | Status + output, bisa nunggu (`wait_seconds` ≤ 55) | – |
| `yorai_list_jobs` / `yorai_cancel_job` | Riwayat / batalin job yang masih queued | – |
| `yorai_upload_file` | Upload dari URL publik atau path lokal → file ID | – |
| `yorai_download_file` | Simpan output ke disk; mode online juga balikin `download_url` | – |
| `yorai_chat` | Model teks (format OpenAI) | ✅ kecil |
| `yorai_upload_link` | *(online)* Link upload sekali pakai dari HP | – |
| `yorai_upload_status` | *(online)* Cek hasil link upload → file ID | – |

Setiap job otomatis dapat `Idempotency-Key`, jadi retry dengan key yang sama nggak kena charge dua kali.

## Environment

| Variabel | Wajib | Default |
|---|---|---|
| `YORAI_API_KEY` | ya | – |
| `YORAI_BASE_URL` | tidak | `https://yorai.id/api/v1` |
| `YORAI_DOWNLOAD_DIR` | tidak | `~/Downloads/yorai` |
| `MCP_SECRET` | mode online | – (minimal 24 karakter) |
| `PUBLIC_URL` | tidak (mode online) | – (aktifin link upload & link download) |
| `PORT` / `HOST` | tidak | `3333` / `127.0.0.1` |
| `DOMAIN`, `YORAI_MCP_REPO` | khusus `deploy/docker-compose.vps.yml` | – / `mybrolabs/yorai-mcp` |

## Develop

```bash
npm install
npm run build   # src/*.ts → dist/
```

`dist/` ikut di-commit supaya container VPS nggak perlu build. Setelah ubah `src/`, jalankan `npm run build` sebelum commit.

## Lisensi

MIT. Bebas dipakai, diubah, dan dibagi.
