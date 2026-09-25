import { randomInt, randomUUID } from 'node:crypto';
import { WORDS } from './words.mjs';

export class GameError extends Error {
  constructor(message, status = 400, code = 'invalid_action') { super(message); this.status = status; this.code = code; }
}
export function requireThat(value, message, status = 400, code) {
  if (!value) throw new GameError(message, status, code);
}
export function validName(value) {
  requireThat(typeof value === 'string', 'Isi nama kamu dulu, ya.');
  const name = value.trim().normalize('NFC');
  const length = [...new Intl.Segmenter('id', { granularity: 'grapheme' }).segment(name)].length;
  requireThat(length >= 1 && length <= 24 && !/[\p{Cc}\p{Cf}<>]/u.test(name), 'Nama perlu 1–24 karakter, tanpa karakter kontrol atau tanda < >.');
  return name;
}
export function shuffle(input) {
  const list = [...input];
  for (let i = list.length - 1; i > 0; i--) { const j = randomInt(i + 1); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
}
export function newRoom(code, hostId, title) {
  // ownerId is the creator: keeps management rights even after a host handoff.
  return { code, title, hostId, ownerId: hostId, public: false, version: 1, locked: false, createdAt: Date.now(), updatedAt: Date.now(), round: 0,
    members: [{ id: hostId, team: null, role: 'guesser', active: true, joinedAt: Date.now() }], banned: [], game: null };
}
export function membership(room, id) {
  const me = room.members.find(m => m.id === id && m.active);
  requireThat(me, 'Kamu belum bergabung atau sudah keluar dari ruang ini.', 403, 'not_member');
  return me;
}
export function ready(room) {
  return ['coral', 'ocean'].every(team => {
    const members = room.members.filter(m => m.active && m.team === team);
    return members.some(m => m.role === 'spymaster') && members.some(m => m.role === 'guesser');
  });
}
// Room management (start, kick, lock, shuffle, visibility...) belongs to the
// current host and the room's creator only.
export function canManage(room, id) { return id === room.hostId || id === room.ownerId; }
function other(team) { return team === 'coral' ? 'ocean' : 'coral'; }
function nextTurn(game) { game.team = other(game.team); game.phase = 'clue'; game.clue = null; game.guesses = 0; game.turn++; game.drafts = []; game.blockedGuessers = []; }
function log(game, type, data) { game.history.push({ type, ...data, at: Date.now(), turn: game.turn }); }
// context comes from the server, never the client: isOnline(id) for presence,
// publicRooms for the public-list feature flag.
export function applyCommand(room, id, action, data = {}, context = {}) {
  const me = membership(room, id), host = canManage(room, id);
  const isOnline = context.isOnline || (() => true);
  const game = room.game;
  if (action === 'seat') {
    requireThat(!game || game.status !== 'playing', 'Tim dan peran terkunci selama permainan.');
    requireThat([null, 'coral', 'ocean'].includes(data.team), 'Tim tidak dikenal.');
    requireThat(['guesser', 'spymaster'].includes(data.role), 'Peran tidak dikenal.');
    requireThat(data.team || data.role === 'guesser', 'Pilih tim untuk memberi petunjuk.');
    if (data.role === 'spymaster') requireThat(!room.members.some(m => m.active && m.id !== id && m.team === data.team && m.role === 'spymaster'), 'Tim ini sudah punya pemberi petunjuk.');
    me.team = data.team; me.role = data.role;
  } else if (action === 'start') {
    requireThat(host, 'Hanya host yang bisa memulai permainan.', 403);
    requireThat(!game || game.status !== 'playing', 'Permainan sedang berlangsung.');
    requireThat(ready(room), 'Setiap tim perlu 1 pemberi petunjuk dan minimal 1 penebak.');
    const first = randomInt(2) ? 'coral' : 'ocean';
    const types = shuffle([...Array(9).fill(first), ...Array(8).fill(other(first)), ...Array(7).fill('neutral'), 'trap']);
    room.round++;
    room.game = { id: randomUUID(), status: 'playing', team: first, phase: 'clue', turn: 1, clue: null, guesses: 0,
    winner: null, reason: null, deckVersion: 'id-1', history: [], drafts: [], blockedGuessers: [], cards: shuffle(WORDS).slice(0, 25).map((word, i) => ({ word, type: types[i], revealed: false })) };
  } else if (action === 'clue') {
    requireThat(game?.status === 'playing' && game.phase === 'clue', 'Belum waktunya mengirim petunjuk.');
    requireThat(me.team === game.team && me.role === 'spymaster', 'Hanya pemberi petunjuk tim aktif yang bisa mengirim.', 403);
    const word = typeof data.word === 'string' ? data.word.trim().normalize('NFC') : '';
    requireThat(/^[\p{L}]{1,32}$/u.test(word), 'Petunjuk harus satu kata, 1–32 huruf.');
    requireThat(Number.isInteger(data.count) && data.count >= 1 && data.count <= 9, 'Pilih jumlah antara 1–9.');
    requireThat(!game.cards.some(c => !c.revealed && c.word.toLocaleLowerCase('id') === word.toLocaleLowerCase('id')), 'Petunjuk tidak boleh sama dengan kata yang belum terbuka.');
    game.clue = { word, count: data.count, by: id }; game.guesses = 0; game.phase = 'guess';
    game.drafts = []; game.blockedGuessers = [];
    log(game, 'clue', { word, count: data.count, by: id, team: game.team });
  } else if (action === 'draft') {
    requireThat(game?.status === 'playing' && game.phase === 'guess', 'Tidak bisa mendraf saat ini.');
    requireThat(me.team === game.team && me.role === 'guesser', 'Hanya penebak tim aktif yang bisa mendraf kartu.', 403);
    requireThat(!game.blockedGuessers.includes(id), 'Tebakan pertamamu salah; kamu tidak bisa memilih kartu lagi di giliran ini.', 403);
    requireThat(Number.isInteger(data.index) && data.index >= 0 && data.index < 25, 'Kartu tidak ditemukan.');
    requireThat(!game.cards[data.index].revealed, 'Kartu sudah terbuka.');
    const existing = game.drafts.findIndex(d => d.playerId === id && d.cardIndex === data.index);
    if (existing >= 0) { game.drafts.splice(existing, 1); } // toggle off
    else { game.drafts.push({ playerId: id, cardIndex: data.index }); } // add draft (multiple per player allowed)
  } else if (action === 'guess') {
    requireThat(game?.status === 'playing' && game.phase === 'guess', 'Tunggu petunjuk sebelum menebak.');
    requireThat(me.team === game.team && me.role === 'guesser', 'Hanya penebak tim aktif yang bisa membuka kartu.', 403);
    requireThat(!game.blockedGuessers.includes(id), 'Tebakan pertamamu salah; kamu tidak bisa membuka kartu lagi di giliran ini.', 403);
    requireThat(Number.isInteger(data.index) && data.index >= 0 && data.index < 25, 'Kartu tidak ditemukan.');
    const card = game.cards[data.index]; requireThat(!card.revealed, 'Kartu sudah terbuka.');
    const isFirstGuess = !game.history.some(h => h.type === 'guess' && h.by === id && h.turn === game.turn);
    card.revealed = true; game.guesses++;
    // Remove this player's draft when they reveal a card
    game.drafts = game.drafts.filter(d => !(d.playerId === id));
    // Block this player from further guesses this turn if their first guess was wrong
    if (isFirstGuess && card.type !== game.team && !game.blockedGuessers.includes(id)) { game.blockedGuessers.push(id); }
    log(game, 'guess', { index: data.index, word: card.word, cardType: card.type, by: id, team: game.team });
    if (card.type === 'trap') { game.status = 'finished'; game.winner = other(game.team); game.reason = 'trap'; }
    else if (['coral', 'ocean'].includes(card.type) && !game.cards.some(c => c.type === card.type && !c.revealed)) {
      game.status = 'finished'; game.winner = card.type; game.reason = 'complete';
    } else if (card.type !== game.team || game.guesses >= game.clue.count + 1) { nextTurn(game); }
  } else if (action === 'end-turn') {
    requireThat(game?.status === 'playing' && game.phase === 'guess' && game.guesses >= 1, 'Tebak minimal satu kartu sebelum mengakhiri giliran.');
    requireThat(me.team === game.team && me.role === 'guesser', 'Hanya penebak tim aktif yang bisa mengakhiri giliran.', 403);
    log(game, 'pass', { by: id, team: game.team }); nextTurn(game);
  } else if (action === 'rematch') {
    requireThat(host, 'Hanya host yang bisa menyiapkan ronde baru.', 403);
    requireThat(game?.status === 'finished', 'Selesaikan pertandingan terlebih dahulu.');
    room.game = null;
  } else if (action === 'abort') {
    requireThat(host && game?.status === 'playing', 'Hanya host yang bisa menghentikan pertandingan aktif.', 403);
    game.status = 'finished'; game.winner = null; game.reason = 'aborted';
  } else if (action === 'lock') {
    requireThat(host, 'Hanya host yang bisa mengunci ruang.', 403); room.locked = !room.locked;
  } else if (action === 'shuffle') {
    requireThat(host, 'Hanya host yang bisa mengacak tim.', 403);
    requireThat(!game || game.status !== 'playing', 'Tim dan peran terkunci selama permainan.');
    const active = room.members.filter(m => m.active);
    const players = shuffle(active.filter(m => isOnline(m.id)));
    requireThat(players.length >= 4, 'Butuh minimal 4 pemain online untuk mengacak tim.');
    // Online players alternate between teams; the first of each team gives clues.
    // Offline players sit out as spectators.
    for (const m of active) { m.team = null; m.role = 'guesser'; }
    players.forEach((m, i) => { m.team = i % 2 ? 'ocean' : 'coral'; m.role = i < 2 ? 'spymaster' : 'guesser'; });
  } else if (action === 'visibility') {
    requireThat(host, 'Hanya host yang bisa mengubah visibilitas ruang.', 403);
    requireThat(context.publicRooms, 'Fitur ruang publik sedang nonaktif.', 403, 'feature_disabled');
    room.public = !room.public;
  } else if (action === 'kick') {
    requireThat(host && data.memberId !== id, 'Hanya host yang bisa mengeluarkan peserta lain.', 403);
    requireThat(data.memberId !== room.ownerId, 'Pembuat ruang tidak bisa dikeluarkan.', 403);
    const target = membership(room, data.memberId); target.active = false; room.banned.push(target.id);
  } else if (action === 'leave') {
    me.active = false;
    if (room.hostId === id) room.hostId = room.members.filter(m => m.active).sort((a, b) => a.joinedAt - b.joinedAt)[0]?.id ?? null;
  } else throw new GameError('Aksi tidak dikenal.', 404);
  room.version++; room.updatedAt = Date.now();
}

export function joinRoom(room, id) {
  requireThat(!room.banned.includes(id), 'Akses kamu ke ruang ini sudah dicabut host.', 403);
  const old = room.members.find(m => m.id === id);
  if (old?.active) return false;
  requireThat(!room.locked, 'Ruang sedang dikunci. Minta host membuka kuncinya.', 403);
  requireThat(room.members.filter(m => m.active).length < 12, 'Ruang penuh. Maksimal 12 pemain.', 409);
  if (old) {
    old.active = true;
    if (room.game?.status !== 'playing' && old.role === 'spymaster' && room.members.some(m => m.active && m.id !== id && m.team === old.team && m.role === 'spymaster')) old.role = 'guesser';
  }
  else room.members.push({ id, active: true, team: null, role: 'guesser', joinedAt: Date.now() });
  // The creator takes the host role back when they return.
  if (!room.hostId || id === room.ownerId) room.hostId = id;
  room.version++; room.updatedAt = Date.now(); return true;
}

export function snapshot(room, id, profiles, isOnline = () => false) {
  const me = membership(room, id);
  const result = { code: room.code, title: room.title, hostId: room.hostId, ownerId: room.ownerId ?? room.hostId, public: !!room.public, version: room.version, locked: room.locked,
    round: room.round, ready: ready(room), me: { ...me, seenAt: undefined }, members: room.members.filter(m => m.active).map(({ seenAt, ...m }) => ({
      ...m, name: profiles(m.id)?.name || 'Nama tidak tersedia', avatar: profiles(m.id)?.avatar || 1, online: isOnline(m.id)
    })), game: null };
  if (room.game) {
    const g = room.game;
    const secret = me.role === 'spymaster' && me.team !== null;
    result.game = { ...g, cards: g.cards.map(c => ({ word: c.word, revealed: c.revealed,
      ...(c.revealed || secret || g.status === 'finished' ? { type: c.type } : {}) })),
      remaining: { coral: g.cards.filter(c => c.type === 'coral' && !c.revealed).length, ocean: g.cards.filter(c => c.type === 'ocean' && !c.revealed).length },
      drafts: g.drafts || [], blockedGuessers: g.blockedGuessers || []
    };
  }
  return result;
}
