# Verification — ABC MVP

Tanggal: 24 September 2026. Runtime Node.js 26.6.0, browser pengujian visual Codex in-app browser.

## Otomatis

`npm run check`: syntax server, game engine, dan frontend diperiksa.

`npm test`: 12 pengujian unit/integrasi/realtime. Meliputi nama manual dan Unicode, 496 kata unik, distribusi papan, batas tebakan, kartu netral/lawan/jebakan, kondisi menang, role lock, secret isolation, host bukan izin membaca rahasia, leave/rejoin, kick, rematch, profil persisten, konflik versi nama, CSRF, retry command, stale command, dua tebakan bersamaan, dan restart dengan DB yang sama.

Smoke test memakai 120 koneksi SSE pada 10 room. Run awal mencatat p95 lokal 18,4 ms untuk satu perubahan kunci + 12 pembacaan snapshot. Ini bukan benchmark latency jaringan produksi dan bukan pengujian 120 manusia memakai browser sekaligus.

## Browser yang benar-benar dijalankan

- Beranda desktop pada viewport bawaan sekitar 884 px; ilustrasi, font, dan ikon tampil. Tidak ada error/warning console pada pemeriksaan sebelum simulasi disconnect.
- Beranda 390 px: scrollWidth sama dengan viewport; tidak ada gambar rusak.
- Validasi nama kosong menampilkan pesan dan tetap mempertahankan input kosong; tidak dibuat nama random.
- Buat room “Uji ABC kantor” dengan nama “Rani QA”; ubah menjadi “Rani Pilihan Sendiri”; reload mempertahankan nama baru.
- Tiga sesi HTTP terpisah bergabung ke room browser dan mengambil peran. Browser memperbarui roster secara realtime tanpa reload. Ini satu browser manusia-simulasi + tiga klien API, bukan empat browser yang diuji manual.
- Host memilih tim, mulai game, menerima petunjuk dari sesi lain, memilih kartu lalu mengonfirmasi. Kartu terbuka dan skor Coral berubah 9→8; kartu lain tidak memuat label tipe rahasia.
- Server dihentikan: banner offline muncul dan kartu tak dapat ditebak. Server dijalankan lagi dengan database sama: banner hilang, nama sama, satu kartu yang telah terbuka tetap terbuka, aksi bisa dilanjutkan.
- Kartu jebakan dibuka melalui UI: hasil Ocean menang muncul; tombol rematch mengembalikan lobby; nama tetap sama.
- Dialog panduan menerima fokus keyboard, Tab tetap berada di dialog, Escape menutup dialog dan mengembalikan fokus ke tombol pemicu.
- Papan diuji di 390 dan 320 px. Halaman tidak melebar; pada 320 px papan 330 px bisa digulir di kontainernya sendiri. Teks kartu diperbesar menjadi 14 px dan diverifikasi dari computed style.
- Akses via alamat LAN dari komputer host: buat room, pilih peran, dan undangan berhasil. Belum diuji dari perangkat fisik kedua. Command ID memakai getRandomValues agar tidak bergantung pada randomUUID yang memerlukan secure context.
- Semua override viewport dikembalikan ke ukuran normal setelah pengujian.

## Kontras

Perhitungan pasangan token utama (rasio luminance WCAG): ink/paper 14,16:1; muted/paper 4,77:1; ink/lime 12,15:1; ink/coral card 9,74:1; ink/ocean card 9,72:1; white/trap 12:1. Ini pemeriksaan token terpilih, bukan audit semua elemen dan state.

## Backup

`scripts/backup.mjs` berhasil membuat backup konsisten saat aplikasi aktif. Database backup dibuka terpisah, `PRAGMA integrity_check` mengembalikan `ok`, dan state room/kartu terbuka terbaca. Belum melakukan drill restore operasional pada hosting eksternal.

## Yang belum diverifikasi

Screen reader, 200% browser zoom, Safari/Firefox/Android/iOS fisik, jaringan Wi-Fi antarperangkat, latency regional, kegagalan disk, serta observability layanan produksi. Host failover 60–75 detik tersedia di kode tetapi belum diuji manual selama interval penuh. Pengujian otomatis headless Chrome lewat shell tidak tersedia di sandbox ini; verifikasi UI memakai in-app browser.

Status: siap untuk dicoba sebagai MVP/pilot internal. Belum menyatakan readiness deployment publik atau aksesibilitas tersertifikasi.
