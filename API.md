# Kontrak API ABC v0.1

Base `/api` di Worker Cloudflare, JSON. Semua respons `Cache-Control: no-store`. Autentikasi: `Authorization: Bearer <token>`. Token dibuat oleh `GET /me` pertama (field `token`) dan disimpan client. Tidak ada cookie maupun CSRF token. Origin lintas situs hanya diizinkan bila ada di `ALLOWED_ORIGINS` (CORS). Role/team dari client tidak pernah dipercaya untuk otorisasi.

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/me` | — | `{profile:{id,name,avatar,version}, token?}`; `token` hanya ada saat sesi baru dibuat |
| PATCH | `/me` | `{name,avatar?,version}` | `{profile}`; conflict 409 jika version sudah berubah |
| POST | `/rooms` | `{title?}` | 201 `{code}`; nama pemain wajib tersimpan |
| POST | `/rooms/:code/join` | `{}` | `{code}`; lock/kick/capacity diperiksa |
| GET | `/rooms/:code/ws` | WebSocket, subprotocol `['abc', token]` | lihat bagian Realtime |

`GET /health` (di luar base API) mengembalikan `{ok:true}` bila HTTP process dapat melayani request; bukan pemeriksaan mendalam database.

## Realtime (WebSocket)

Server → client:
- `{type:'snapshot', room}`: dikirim saat terhubung dan setelah setiap perubahan (termasuk online/offline pemain).
- `{type:'ack', commandId}` / `{type:'error', commandId, error, status, code}`: balasan command.
- `{type:'removed', error, code}` lalu close `4403`: bukan anggota, dikeluarkan, atau keluar.

Client → server: `{type:'command', action, version, commandId, ...data}`. Kirim teks `ping` untuk keepalive (dibalas `pong` tanpa membangunkan objek).

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

`commandId`: string unik 8–80 karakter alfanumerik/hyphen, biasanya UUID. Retry harus mengirim body identik termasuk `version`. Receipt disimpan per room (200 command terakhir). Penggunaan ID sama untuk payload/actor berbeda ditolak. Mutasi baru wajib memakai ID baru.

## Snapshot

`{code,title,hostId,version,locked,round,ready,me,members,game}`.
Member: ID stabil, team/role, name, avatar, online. Nama bukan identifier.
Game: ID, status `playing|finished`, team aktif, phase `clue|guess`, turn, clue, guesses, winner, reason, deckVersion, cards, history, remaining.
Card: `{word,revealed,type?}`. `type` tidak ada untuk kartu tersembunyi di respons penebak/penonton. Spymaster dapat melihat semua tipe; setelah pertandingan selesai semua role bisa melihat tipe.
`remaining`: hitungan kartu tim, bukan peta rahasia. History hanya merekam petunjuk publik, kartu yang sudah dibuka, dan akhir giliran.

## Error

`{error: "Pesan Indonesia untuk pengguna", code: "..."}`.
400 input/aksi tidak valid; 401 sesi berakhir; 403 hak akses/origin/lock/kick; 404 room/endpoint tidak ditemukan; 409 stale state/profile conflict/full room; 413 body terlalu besar; 429 rate limit; 500 kegagalan server.
Kode khusus: `stale_state`, `profile_conflict`, `session_expired`, `not_member`, `room_missing`, `rate_limit`; error domain lainnya memakai `invalid_action`.
Pada konflik, ambil snapshot/profil terbaru; jangan menerapkan hasil optimistis atau mengganti nama dengan fallback.

## Transport dan deployment

Satu WebSocket per tab ke Durable Object room. Bila terputus, client menyambung ulang dengan backoff (1–15 detik) dan menerima snapshot penuh. `GET /health` → `{ok:true}`.
