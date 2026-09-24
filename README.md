# ABC — Aku Butuh Code

MVP permainan tebak kata dua tim untuk jeda kantor. Browser, tanpa akun, 4–12 pemain. Nama pemain diisi sendiri, dapat diubah, dan tidak pernah diganti nama acak.

## Menjalankan

Butuh **Node.js 24+**. Diuji dengan Node.js 26.6.0. Tidak ada paket npm runtime yang perlu diinstal.

```sh
cd /Users/mac-213364/Documents/Codex/2026-09-24/saya-ingin-membuat-platform-seperti-https/outputs/abc
npm start
```

Buka http://127.0.0.1:3000. Isi nama, pilih avatar, buat ruang, lalu bagikan tautan. Setiap tim perlu satu pemberi petunjuk dan minimal satu penebak sebelum host memulai.

Untuk teman-teman pada Wi-Fi/LAN yang sama, hentikan proses lokal sebelumnya lalu jalankan:

```sh
ABC_HOST=0.0.0.0 npm start
```

Semua peserta, termasuk host, sebaiknya membuka `http://IP-KOMPUTER-HOST:3000` dan membagikan link yang dibuat dari alamat itu. Link `127.0.0.1` hanya bekerja pada komputer host. Komputer host harus menyala dan port 3000 dapat dijangkau jaringan kantor. Identitas browser pada `127.0.0.1` dan alamat LAN berbeda karena cookie terikat host; isi nama sendiri pada alamat yang baru.

Variabel konfigurasi: `ABC_HOST`, `ABC_PORT` (default 3000), `ABC_DB` (default `data/abc.sqlite`), `COOKIE_SECURE=true` untuk deployment HTTPS. `PORT` juga diterima untuk platform hosting.

## Yang sudah berjalan

- Room privat berkode, undangan, batas 12 pemain, lock/unlock, kick, leave/rejoin.
- Nama Unicode 1–24 karakter tampak, kapitalisasi dipertahankan, validasi tanpa nama fallback. Duplikat dibedakan badge ID terpisah. Avatar dari 12 Open Peeps.
- Nama dan avatar tersimpan di profil guest server selama sesi browser berlaku (30 hari), termasuk refresh, reconnect, rematch, dan room baru pada host yang sama. Sesi/perangkat baru meminta nama lagi.
- Dua tim, role pemberi petunjuk/penebak, penonton, role terkunci saat pertandingan.
- Papan 5×5 dari **496 kata Indonesia unik**, distribusi 9/8/7/1, satu kata + angka 1–9, maksimal angka+1 tebakan, seluruh kondisi menang/kalah, akhir giliran, rematch.
- Pilih kartu lalu konfirmasi; server menentukan hasil. Skor/riwayat/peran disinkronkan.
- Peta rahasia hanya dikirim ke pemberi petunjuk yang sah; kartu terbuka menjadi informasi publik. Semua kartu terlihat setelah pertandingan selesai.
- Realtime SSE dengan polling pemulihan setiap 10 detik saat tab terlihat. State tersimpan di SQLite; server restart tidak menghapus pertandingan.
- Pengalihan host yang terputus setelah sekitar 60–75 detik bila peserta lain memiliki koneksi aktif. Keluar eksplisit langsung memindahkan host.
- UI Indonesia, desktop/mobile, papan dengan area scroll lokal pada layar sangat sempit, dialog native, focus ring, reduced motion, suara opt-in.
- Semua font, ilustrasi, dan ikon disajikan lokal; gameplay tidak memerlukan CDN.

## Arsitektur aktual dan perubahan dari planning

Node HTTP monolith + SQLite + ES modules tanpa framework + SSE. Rails/PostgreSQL/Action Cable pada planning diganti untuk MVP ini karena mesin hanya memiliki Ruby 2.6 tanpa Rails. Prinsip satu aplikasi, kontrak API, dan state otoritatif tetap dipakai.

SQLite menyimpan profil, dokumen state room, dan receipt command. Mutasi game dilakukan dalam transaksi `BEGIN IMMEDIATE`. Expected version menolak aksi stale; command ID memastikan retry identik tidak membuka kartu dua kali. Nama memiliki version tersendiri sehingga edit profil tidak membatalkan giliran.

SSE hanya membawa notifikasi `update` tanpa payload permainan. Client mengambil snapshot yang telah difilter berdasarkan peran. Belum ada durable outbox; jika notifikasi hilang, polling/reconnect memulihkan state dari DB. Jalankan **satu proses aplikasi**; jangan memakai beberapa worker/replica dengan broker realtime in-memory ini.

Cookie token acak disimpan sebagai hash di DB; cookie HttpOnly/SameSite, CSRF token, origin check, rate limits, CSP, dan escaping teks diterapkan. HTTPS dan cookie Secure perlu diaktifkan untuk deployment internet. Room kedaluwarsa setelah 24 jam tidak aktif; koneksi room aktif memperpanjang aktivitas. Tidak ada voice/video bawaan, analytics pihak ketiga, pembayaran, atau akun.

## Pengujian

```sh
npm run check
npm test
```

12 pengujian mencakup game rules, secret isolation, role authorization, nama manual/duplikat/persistensi, profile conflict, idempotency, stale state, restart DB, CSRF, kick, dan 120 koneksi SSE pada 10 room. Hasil pengujian dan batas cakupan tersedia di `VERIFICATION.md`.

## Data, backup, dan pemulihan

```sh
node scripts/backup.mjs /path/to/new-backup.sqlite
```

Backup memakai SQLite backup API agar snapshot konsisten walau WAL aktif. Jangan hanya menyalin file `.sqlite` saat proses sedang menulis. Untuk restore, hentikan server, simpan database lama beserta file WAL/SHM jika ada, lalu jalankan `ABC_DB=/path/to/backup-copy.sqlite npm start`. Gunakan salinan backup agar backup asli tidak dimutasi aplikasi.

Runbook: periksa `/health`, log proses, ruang disk, dan konektivitas; restart proses dengan file DB yang sama; client akan reconnect. Untuk rollback kode, hentikan server lalu kembalikan folder source versi sebelumnya; versi ini belum memiliki migrasi skema lanjutan. Jangan mengekspos file di `data/` lewat reverse proxy.

## Struktur

`server.mjs`: HTTP, session, persistence, realtime, rate limits.
`lib/game.mjs`: aturan dan snapshot sesuai peran.
`lib/words.mjs`: deck Indonesia versi id-1.
`public/`: UI, CSS, modul frontend, aset self-hosted.
`test/`: unit, integration, dan realtime smoke tests.
`API.md`: kontrak endpoint.

## Batas versi ini

Ini MVP untuk pilot internal, belum deployment internet atau sistem multi-instance. Belum ada monitoring eksternal, restore otomatis, pengujian lintas-browser lengkap, audit screen reader, atau benchmark jaringan kantor sebenarnya. Pemberi petunjuk yang keluar harus kembali dengan sesi yang sama; host dapat menghentikan ronde bila perlu. Rekan yang tahu link bisa masuk selama room tidak dikunci; tidak ada SSO/PIN tambahan.

Aset: Open Peeps oleh Pablo Stanley (CC0), Lucide 0.468.0 (ISC), Space Grotesk dan DM Sans (OFL). Sumber aset serta salinan lisensi font/ikon ada di `public/assets/`. Tidak menyalin logo, deck, atau kode aplikasi Codenames.
