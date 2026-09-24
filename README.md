# ABC — Aku Butuh Code

MVP permainan tebak kata dua tim untuk jeda kantor. Browser, tanpa akun, 4–12 pemain. Nama pemain diisi sendiri, dapat diubah, dan tidak pernah diganti nama acak.

## Deployment

Produksi berjalan di Netlify: **https://abc-quiz.farrid.dev**.

- `public/` disajikan sebagai file statis; `/r/:kode` diarahkan ke `index.html` (`netlify.toml`).
- `netlify/functions/api.mjs` menangani `/api/*` dan `/health`.
- `netlify/functions/cleanup.mjs` berjalan tiap jam untuk menghapus room dan sesi kedaluwarsa.
- State disimpan di Netlify Blobs (`abc-sessions`, `abc-rooms`, konsistensi kuat). Deploy preview/branch memakai store terpisah dengan akhiran konteks, sehingga data uji tidak tercampur dengan data produksi.

Build Netlify menjalankan `npm test`; deploy gagal bila tes gagal.

## Menjalankan lokal

Butuh **Node.js 22+**.

```sh
npm install
npm start
```

Buka http://127.0.0.1:3000. Server lokal memakai handler yang sama dengan produksi, tetapi dengan store di memori: data hilang saat proses berhenti. Untuk LAN: `ABC_HOST=0.0.0.0 npm start`. Variabel: `ABC_HOST`, `ABC_PORT`/`PORT` (default 3000). Cookie `Secure` otomatis aktif bila permintaan datang lewat HTTPS.

## Yang sudah berjalan

- Room privat berkode, undangan, batas 12 pemain, lock/unlock, kick, leave/rejoin.
- Nama Unicode 1–24 karakter tampak, kapitalisasi dipertahankan, validasi tanpa nama fallback. Duplikat dibedakan badge ID terpisah. Avatar dari 12 Open Peeps.
- Nama dan avatar tersimpan di profil guest server selama sesi browser berlaku (30 hari), termasuk refresh, reconnect, rematch, dan room baru pada host yang sama. Sesi/perangkat baru meminta nama lagi.
- Dua tim, role pemberi petunjuk/penebak, penonton, role terkunci saat pertandingan.
- Papan 5×5 dari **496 kata Indonesia unik**, distribusi 9/8/7/1, satu kata + angka 1–9, maksimal angka+1 tebakan, seluruh kondisi menang/kalah, akhir giliran, rematch.
- Pilih kartu lalu konfirmasi; server menentukan hasil. Skor/riwayat/peran disinkronkan.
- Peta rahasia hanya dikirim ke pemberi petunjuk yang sah; kartu terbuka menjadi informasi publik. Semua kartu terlihat setelah pertandingan selesai.
- Sinkronisasi lewat polling: ±1,5 detik saat tab terlihat, 15 detik di latar belakang. State tersimpan di Netlify Blobs; instance function baru tidak menghapus pertandingan.
- Pengalihan host yang tidak aktif (tidak polling) lebih dari 60 detik ke peserta aktif yang bergabung paling awal. Keluar eksplisit langsung memindahkan host.
- UI Indonesia, desktop/mobile, papan dengan area scroll lokal pada layar sangat sempit, dialog native, focus ring, reduced motion, suara opt-in.
- Semua font, ilustrasi, dan ikon disajikan lokal; gameplay tidak memerlukan CDN.

## Arsitektur

Handler HTTP tanpa state (`lib/app.mjs`, Web `Request`/`Response`) + aturan permainan (`lib/game.mjs`) + key-value store. Di Netlify store-nya Netlify Blobs; secara lokal dan di tes memakai `lib/memory-store.mjs` dengan API yang sama.

- **Sesi**: satu blob per sesi dengan key hash SHA-256 dari token cookie. Isinya profil (ID stabil, nama, avatar, version), CSRF token, dan daftar room terakhir.
- **Room**: satu dokumen JSON per kode room. Isinya anggota (dengan salinan nama/avatar dan `seenAt`), permainan, serta receipt command terakhir.
- **Konkurensi**: setiap mutasi membaca room beserta ETag, lalu menulis dengan `onlyIfMatch`. Bila writer lain lebih dulu, mutasi diulang pada data terbaru. Expected version tetap menolak aksi stale. Receipt `commandId` disimpan di dokumen room sehingga tercatat atomik bersama perubahannya; retry identik tidak membuka kartu dua kali.
- **Presence**: setiap poll memperbarui `seenAt` (paling sering 10 detik sekali). Pemain dianggap online bila terlihat dalam 35 detik terakhir.
- **Ganti nama**: diterapkan langsung ke semua room yang pernah diikuti profil tersebut tanpa mengubah version permainan.

Perubahan dari versi awal: SQLite dan SSE diganti karena Netlify Functions tidak punya disk persisten dan tidak cocok untuk koneksi panjang. Rate limit kini best-effort per instance function.

Cookie token acak (hanya hash yang disimpan), HttpOnly/SameSite/Secure, CSRF token, origin check, rate limit, CSP, HSTS, dan escaping teks tetap diterapkan. Room kedaluwarsa setelah 24 jam tidak aktif; polling anggota memperpanjang aktivitas.

## Pengujian

```sh
npm run check
npm test
```

13 pengujian mencakup game rules, secret isolation, role authorization, nama manual/duplikat/persistensi, profile conflict, idempotency, stale state, tebakan bersamaan, instance baru dengan store yang sama, CSRF, kick, 120 klien polling pada 10 room, serta presence dan pengalihan host. Hasil pengujian dan batas cakupan tersedia di `VERIFICATION.md`.

## Data dan operasional

Data ada di Netlify Blobs (Netlify UI → Project → Blobs). Periksa `/health` dan log function di Netlify bila ada masalah. Rollback kode: publish ulang deploy sebelumnya dari Netlify UI; format data tidak berubah antar deploy versi ini.

## Struktur

`lib/app.mjs`: API, sesi, persistence, presence, rate limit.
`netlify/functions/`: entry point Netlify (API dan cleanup terjadwal).
`server.mjs`: server pengembangan lokal.
`lib/game.mjs`: aturan dan snapshot sesuai peran.
`lib/words.mjs`: deck Indonesia versi id-1.
`public/`: UI, CSS, modul frontend, aset self-hosted.
`test/`: unit, integration, dan realtime smoke tests.
`API.md`: kontrak endpoint.

## Batas versi ini

Ini MVP untuk pilot internal. Belum ada monitoring eksternal, restore otomatis, pengujian lintas-browser lengkap, audit screen reader, atau benchmark jaringan kantor sebenarnya. Pemberi petunjuk yang keluar harus kembali dengan sesi yang sama; host dapat menghentikan ronde bila perlu. Rekan yang tahu link bisa masuk selama room tidak dikunci; tidak ada SSO/PIN tambahan.

Aset: Open Peeps oleh Pablo Stanley (CC0), Lucide 0.468.0 (ISC), Space Grotesk dan DM Sans (OFL). Sumber aset serta salinan lisensi font/ikon ada di `public/assets/`. Tidak menyalin logo, deck, atau kode aplikasi Codenames.
