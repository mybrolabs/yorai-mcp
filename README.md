# yorai-mcp

MCP server buat API [Yorai](https://yorai.id). Fungsinya supaya Claude bisa cek saldo, lihat katalog model, quote, generate gambar/video/audio, upload referensi, dan download hasil.

## Tools

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
| `yorai_download_file` | Simpan output ke disk (default `~/Downloads/yorai`) | – |
| `yorai_chat` | Model teks (format OpenAI) | ✅ kecil |
| `yorai_upload_link` | *(mode remote)* Bikin link upload sekali pakai (30 menit, maks 10 file) buat upload foto/video/audio dari HP | – |
| `yorai_upload_status` | *(mode remote)* Cek hasil link upload → file ID | – |

Setiap job otomatis dapet `Idempotency-Key`. Jadi kalau retry pakai key yang sama, lu nggak bakal kena charge dua kali.

## 1. Build

Butuh Node.js 20 ke atas.

```bash
npm install
npm run build
```

API key bisa dibikin di https://yorai.id/app/api.

## 2a. Lokal: Claude Desktop

Edit `claude_desktop_config.json`
(Windows: `%APPDATA%\Claude\claude_desktop_config.json`, macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "yorai": {
      "command": "node",
      "args": ["C:\\path\\ke\\yorai-mcp\\dist\\index.js"],
      "env": {
        "YORAI_API_KEY": "yk_xxx",
        "YORAI_DOWNLOAD_DIR": "D:\\AI\\yorai"
      }
    }
  }
}
```

Setelah itu restart Claude Desktop.

## 2b. Lokal: Claude Code

```bash
claude mcp add yorai --scope user -e YORAI_API_KEY=yk_xxx -- node C:/path/ke/yorai-mcp/dist/index.js
```

## 2c. Remote: custom connector di claude.ai (web + HP)

Server harus bisa diakses publik lewat HTTPS. Contoh di bawah pakai VPS Hostinger.

```bash
# di VPS
git clone <repo> yorai-mcp && cd yorai-mcp
npm install && npm run build
cp .env.example .env        # isi YORAI_API_KEY dan MCP_SECRET (openssl rand -hex 24)
set -a && . ./.env && set +a
npx pm2 start dist/http.js --name yorai-mcp && npx pm2 save
```

Server listen di `127.0.0.1:3333`. Pasang reverse proxy dengan HTTPS di depannya, misalnya Caddy:

```
yorai-mcp.domainlu.com {
    reverse_proxy 127.0.0.1:3333
}
```

Lalu di claude.ai buka **Settings → Connectors → Add custom connector**, dan isi URL:

```
https://yorai-mcp.domainlu.com/mcp/<MCP_SECRET>
```

Secret-nya ada di path karena custom connector claude.ai nggak bisa ngirim header statis. Perlakukan URL itu kayak password.

### Upload foto dari HP (mode remote)

Server di VPS nggak bisa baca file di HP/PC atau attachment chat. Kalau `PUBLIC_URL` di-set (mis. `https://yorai-mcp.domainlu.com`), Claude bisa panggil `yorai_upload_link`, kasih link ke lu, lu upload dari browser HP, terus Claude ambil file ID-nya pakai `yorai_upload_status`. Link berlaku 30 menit dan cuma bisa dipakai sekali.

### VPS pakai Docker Compose (tanpa build)

Lihat [`deploy/docker-compose.vps.yml`](deploy/docker-compose.vps.yml). Container ambil kode terbaru dari repo ini tiap start, jadi update cukup `git push` terus restart container. Contoh di situ numpang Traefik bawaan template n8n Hostinger.

Kalau mau pakai Docker:

```bash
docker build -t yorai-mcp .
docker run -d --restart unless-stopped -p 127.0.0.1:3333:3333 --env-file .env yorai-mcp
```

> Di mode remote, `yorai_upload_file` dengan `path` dan `yorai_download_file` jalan di disk **VPS**, bukan di PC lu. Buat referensi, pakai `url`.

## Environment

| Variabel | Wajib | Default |
|---|---|---|
| `YORAI_API_KEY` | ya | – |
| `YORAI_BASE_URL` | tidak | `https://yorai.id/api/v1` |
| `YORAI_DOWNLOAD_DIR` | tidak | `~/Downloads/yorai` |
| `MCP_SECRET` | mode HTTP | – (minimal 24 karakter) |
| `PORT` / `HOST` | tidak | `3333` / `127.0.0.1` |
| `PUBLIC_URL` | tidak (mode HTTP) | – (aktifin `yorai_upload_link`) |

## Contoh prompt ke Claude

- "Cek saldo Yorai gue"
- "Model video apa aja di Yorai yang paling murah per detik?"
- "Bikin video Seedance 2.5 480p 5 detik: kucing oren lompat ke meja. Quote dulu ya"
- "Upload foto ini terus jadiin first frame image-to-video"
