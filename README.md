# ABC — Aku Butuh Code

MVP permainan tebak kata dua tim untuk jeda kantor. Browser, tanpa akun, 4–12 pemain. Nama pemain diisi sendiri, dapat diubah, dan tidak pernah diganti nama acak.

## Deployment

```
Browser ── https://abc-quiz.farrid.dev ──► Netlify (halaman, CSS, JS, gambar)
   └──── wss://abc-quiz.<subdomain>.workers.dev ──► Cloudflare Worker + Durable Objects (API & realtime)
```

- **Netlify** hanya menyajikan `public/` (tanpa function). Domain `farrid.dev` tetap di Netlify DNS.
- **Cloudflare Worker** (`worker/index.mjs`, `wrangler.toml`) menjalankan API dan WebSocket. Worker yang sama juga menyajikan `public/`, jadi `https://abc-quiz.farridpastikaya.workers.dev` bisa langsung dipakai bermain.
- `<meta name="abc-api">` di `public/index.html` menunjuk ke URL Worker. `ALLOWED_ORIGINS` di `wrangler.toml` berisi domain halaman yang boleh memanggil API.

### Feature flag: ruang publik

Diatur lewat variabel Worker, tanpa ubah kode: Cloudflare dashboard → Workers & Pages → **abc-quiz** → **Settings → Variables and Secrets** → tambah `FEATURE_PUBLIC_ROOMS` = `true` (jenis Text) → **Deploy**. Untuk mematikan, ubah nilainya (misalnya `false`) atau hapus variabelnya. Default: mati.

Saat mati, daftar dan pilihan "publik" hilang dari UI, API daftar mengembalikan 404, dan ruang berhenti dipublikasikan. Ruang tetap bisa dimasuki lewat kode/link. `keep_vars = true` di `wrangler.toml` menjaga nilai dari dashboard agar tidak tertimpa saat deploy berikutnya.

### Deploy Worker (sekali, lalu setiap ada perubahan backend)

1. Buat akun Cloudflare gratis. Subdomain `workers.dev` terlihat di **Workers & Pages → Account details**.
2. Dari repo ini:
   ```sh
   npm install
   npx wrangler login
   npx wrangler deploy
   ```
   Hasilnya `https://abc-quiz.<subdomain>.workers.dev`. Cek `…/health` → `{"ok":true}`.
3. Ganti `YOUR-SUBDOMAIN` di `public/index.html` (`<meta name="abc-api">`) dengan subdomain tersebut, commit, lalu Netlify deploy ulang otomatis.

Alternatif tanpa CLI: **Workers & Pages → Create → Import a repository**, pilih repo ini, build command kosong, deploy command `npx wrangler deploy`. Setiap push ke `master` akan men-deploy Worker.

Paket gratis Workers cukup untuk pilot: 100.000 permintaan Durable Object per hari. Pesan WebSocket ikut dihitung, tetapi koneksi yang diam tidak memakan durasi karena Hibernation API.

## Menjalankan lokal

Butuh **Node.js 22+**.

```sh
npm install
npm run dev
```

Buka http://127.0.0.1:8787. `wrangler dev` menjalankan Worker, Durable Objects (SQLite lokal di `.wrangler/`), dan frontend dari satu alamat.

## Yang sudah berjalan

- Room privat berkode, undangan, batas 12 pemain, lock/unlock, kick, leave/rejoin.
- Nama Unicode 1–24 karakter tampak, kapitalisasi dipertahankan, validasi tanpa nama fallback. Duplikat dibedakan badge ID terpisah. Avatar dari 12 Open Peeps.
- Nama dan avatar tersimpan di profil guest server selama sesi browser berlaku (30 hari), termasuk refresh, reconnect, rematch, dan room baru pada host yang sama. Sesi/perangkat baru meminta nama lagi.
- Dua tim, role pemberi petunjuk/penebak, penonton, role terkunci saat pertandingan.
- **Acak tim & peran** (host): pemain online dibagi rata ke dua tim, masing-masing 1 pemberi petunjuk; pemain offline jadi penonton.
- **Hak kelola ruang** (mulai, kunci, kick, acak, publik/privat, ronde baru, hentikan) hanya untuk host dan pembuat ruang, dicek di server. Pembuat ruang tidak bisa di-kick dan otomatis jadi host lagi saat kembali.
- **Daftar ruang publik** (feature flag, lihat bawah): ruang bisa ditandai publik saat dibuat atau dari lobby, lalu muncul di beranda selama ada pemain online, tidak dikunci, dan belum penuh.
- **Selebrasi akhir game**: confetti dan photocard 1080×1920 (ukuran IG Story) yang dibuat di browser. Pola kata dan nomor serinya unik per game dan per pemain. Tombol bagikan membuka menu share HP (pilih Instagram → Cerita); tombol simpan mengunduh PNG.
- Papan 5×5 dari **496 kata Indonesia unik**, distribusi 9/8/7/1, satu kata + angka 1–9, maksimal angka+1 tebakan, seluruh kondisi menang/kalah, akhir giliran, rematch.
- Pilih kartu lalu konfirmasi; server menentukan hasil. Skor/riwayat/peran disinkronkan.
- Peta rahasia hanya dikirim ke pemberi petunjuk yang sah; kartu terbuka menjadi informasi publik. Semua kartu terlihat setelah pertandingan selesai.
- Realtime lewat WebSocket: setiap perubahan langsung dikirim ke semua pemain (tanpa polling). Koneksi terputus otomatis tersambung lagi dan memuat papan terbaru.
- Pengalihan host yang terputus lebih dari 60 detik ke peserta online yang bergabung paling awal. Keluar eksplisit langsung memindahkan host.
- UI Indonesia, desktop/mobile, papan dengan area scroll lokal pada layar sangat sempit, dialog native, focus ring, reduced motion, suara opt-in.
- Semua font, ilustrasi, dan ikon disajikan lokal; gameplay tidak memerlukan CDN.

## Arsitektur

Cloudflare Worker + dua Durable Object (SQLite, paket gratis). Aturan permainan tetap di `lib/game.mjs`.

- **Session** (satu per token browser): ID stabil, nama, avatar, version, dan daftar room. Token acak 32 byte disimpan di `localStorage` dan dikirim sebagai `Authorization: Bearer`; server hanya menyimpan hash SHA-256-nya sebagai nama objek. Masa berlaku 30 hari sejak terakhir dipakai.
- **Room** (satu per kode room): state permainan di memori, disimpan ke SQLite objek tersebut setiap perubahan. Satu thread per room, jadi tidak ada race: dua tebakan bersamaan diproses berurutan dan expected version menolak yang kedua. Receipt `commandId` (200 terakhir) membuat retry identik tidak membuka kartu dua kali.
- **Realtime**: `GET /api/rooms/:kode/ws` (WebSocket Hibernation API). Setiap pemain menerima snapshot yang sudah difilter sesuai perannya; peta rahasia hanya dikirim ke pemberi petunjuk. Online = punya koneksi terbuka. Alarm objek menangani pengalihan host dan kedaluwarsa room (24 jam tanpa aktivitas).
- **Lobby** (satu objek): direktori ruang publik. Room mengirim ringkasan (judul, host, jumlah pemain, status) setiap berubah; tanpa ID pemain.
- **Ganti nama**: Session menyimpan daftar room, lalu Worker mengirim nama baru ke setiap Room yang terkait tanpa mengubah version permainan.

Keamanan: tidak ada cookie, jadi CSRF tidak relevan. API menolak origin di luar `ALLOWED_ORIGINS`, ada rate limit (per instance Worker dan per koneksi), CSP ketat (`public/_headers`, dipakai Netlify maupun Cloudflare), dan semua teks di-escape.

Riwayat: v0.1 memakai Node + SQLite + SSE, v0.2 Netlify Functions + Blobs + polling (lambat dari Indonesia karena function berjalan di AS). v0.3 pindah ke Cloudflare supaya state room berjalan dekat pemain dan perubahan dikirim langsung.

## Pengujian

```sh
npm run check
npm test          # unit + integrasi Worker (menjalankan wrangler dev)
npm run test:unit # hanya aturan permainan (dipakai build Netlify)
```

`test/game.test.mjs`: aturan permainan dan isolasi rahasia. `test/worker.test.mjs` menjalankan Worker asli di workerd lalu menguji lewat HTTP dan WebSocket: CORS/origin, nama manual, konflik profil, push realtime, isolasi rahasia, retry idempoten, stale state, dua tebakan bersamaan, restart dengan storage yang sama, kick, dan pengalihan host.

## Data dan operasional

Data ada di Durable Objects (Cloudflare dashboard → Workers & Pages → abc-quiz → Durable Objects). Log: `npx wrangler tail` atau tab Observability. Rollback: `npx wrangler rollback`, atau pilih versi sebelumnya di dashboard.

## Struktur

`worker/index.mjs`: Worker (HTTP API, CORS, auth) serta Durable Object `Session` dan `Room`.
`wrangler.toml`: konfigurasi Cloudflare.
`netlify.toml`: hosting statis di Netlify.
`lib/game.mjs`: aturan dan snapshot sesuai peran.
`lib/words.mjs`: deck Indonesia versi id-1.
`public/`: UI, CSS, modul frontend, aset self-hosted.
`test/`: unit, integration, dan realtime smoke tests.
`API.md`: kontrak endpoint.

## Batas versi ini

Ini MVP untuk pilot internal. Belum ada monitoring eksternal, restore otomatis, pengujian lintas-browser lengkap, audit screen reader, atau benchmark jaringan kantor sebenarnya. Pemberi petunjuk yang keluar harus kembali dengan sesi yang sama; host dapat menghentikan ronde bila perlu. Rekan yang tahu link bisa masuk selama room tidak dikunci; tidak ada SSO/PIN tambahan.

Aset: Open Peeps oleh Pablo Stanley (CC0), Lucide 0.468.0 (ISC), Space Grotesk dan DM Sans (OFL). Sumber aset serta salinan lisensi font/ikon ada di `public/assets/`. Tidak menyalin logo, deck, atau kode aplikasi Codenames.
