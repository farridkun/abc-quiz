# Kontrak API ABC v0.1

Base `/api`, JSON. Semua respons API `Cache-Control: no-store`. Cookie `abc_session` HttpOnly; frontend mengambil token CSRF melalui `GET /me`. Semua mutasi harus menyertakan `X-CSRF-Token`, `Content-Type: application/json`, serta cookie sesi yang sama. Browser lintas origin tidak diizinkan. Tidak pernah mempercayai role/team dari client untuk otorisasi.

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/me` | — | `{profile:{id,name,avatar,version},csrf}`; sesi baru punya nama kosong |
| PATCH | `/me` | `{name,avatar?,version}` | `{profile}`; conflict 409 jika version sudah berubah |
| POST | `/rooms` | `{title?}` | 201 `{code}`; nama pemain wajib tersimpan |
| POST | `/rooms/:code/join` | `{}` | `{code}`; lock/kick/capacity diperiksa |
| GET | `/rooms/:code` | — | snapshot sesuai peran; anggota aktif saja |
| GET | `/rooms/:code/events` | — | `text/event-stream`; event `update`, data `{}` |
| POST | `/rooms/:code/command` | `{action,version,commandId,...data}` | `{ok:true}`; fetch snapshot setelahnya |

`GET /health` (di luar base API) mengembalikan `{ok:true}` bila HTTP process dapat melayani request; bukan pemeriksaan mendalam database.

## Commands

- `seat`: `team` (`coral`, `ocean`, atau `null`) dan `role` (`guesser` / `spymaster`); hanya untuk diri sendiri, sebelum pertandingan aktif.
- `start`: host; setiap tim perlu pemberi petunjuk dan penebak.
- `clue`: `word` (satu kata huruf Unicode, 1–32), `count` (integer 1–9); pemberi petunjuk tim aktif.
- `guess`: `index` (0–24); penebak tim aktif setelah petunjuk.
- `end-turn`: penebak tim aktif setelah minimal satu tebakan.
- `rematch`: host; pertandingan harus selesai; kembali ke lobby untuk penyesuaian peran.
- `abort`: host; akhiri pertandingan tanpa pemenang, semua kartu terbuka.
- `lock`: host; toggle kunci undangan.
- `kick`: host, `memberId`; tidak dapat mengeluarkan diri sendiri. Sesi target diblokir dari room.
- `leave`: keluar; mempertahankan assignment untuk kembali dalam pertandingan yang sama.

`commandId`: string unik 8–80 karakter alfanumerik/hyphen, biasanya UUID. Retry harus mengirim body identik termasuk `version`. Receipt berlaku hingga 24 jam. Penggunaan ID sama untuk payload/actor/scope berbeda ditolak. Mutasi baru wajib memakai ID baru.

## Snapshot

`{code,title,hostId,version,locked,round,ready,me,members,game}`.
Member: ID stabil, team/role, name, avatar, online. Nama bukan identifier.
Game: ID, status `playing|finished`, team aktif, phase `clue|guess`, turn, clue, guesses, winner, reason, deckVersion, cards, history, remaining.
Card: `{word,revealed,type?}`. `type` tidak ada untuk kartu tersembunyi di respons penebak/penonton. Spymaster dapat melihat semua tipe; setelah pertandingan selesai semua role bisa melihat tipe.
`remaining`: hitungan kartu tim, bukan peta rahasia. History hanya merekam petunjuk publik, kartu yang sudah dibuka, dan akhir giliran.

## Error

`{error: "Pesan Indonesia untuk pengguna", code: "..."}`.
400 input/aksi tidak valid; 401 sesi berakhir; 403 hak akses/CSRF/lock/kick; 404 room/endpoint tidak ditemukan; 409 stale state/profile conflict/full room; 413 body terlalu besar; 429 rate limit; 500 kegagalan server.
Kode khusus: `stale_state`, `profile_conflict`, `session_expired`, `not_member`, `room_missing`, `csrf`, `rate_limit`; error domain lainnya memakai `invalid_action`.
Pada konflik, ambil snapshot/profil terbaru; jangan menerapkan hasil optimistis atau mengganti nama dengan fallback.

## Transport dan deployment

SSE mengirim `retry: 2000` dan heartbeat 15 detik. Reconnect mengambil snapshot baru. Frontend melakukan polling 10 detik saat tab terlihat. Reverse proxy harus mematikan buffering pada `/events` dan menjaga koneksi streaming. Gunakan HTTPS serta `COOKIE_SECURE=true` untuk internet. Same-origin reverse proxy harus mempertahankan header Host.
