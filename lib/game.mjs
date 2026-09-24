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
  return { code, title, hostId, version: 1, locked: false, createdAt: Date.now(), updatedAt: Date.now(), round: 0,
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
function other(team) { return team === 'coral' ? 'ocean' : 'coral'; }
function nextTurn(game) { game.team = other(game.team); game.phase = 'clue'; game.clue = null; game.guesses = 0; game.turn++; }
function log(game, type, data) { game.history.push({ type, ...data, at: Date.now(), turn: game.turn }); }
export function applyCommand(room, id, action, data = {}) {
  const me = membership(room, id), host = room.hostId === id;
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
      winner: null, reason: null, deckVersion: 'id-1', history: [], cards: shuffle(WORDS).slice(0, 25).map((word, i) => ({ word, type: types[i], revealed: false })) };
  } else if (action === 'clue') {
    requireThat(game?.status === 'playing' && game.phase === 'clue', 'Belum waktunya mengirim petunjuk.');
    requireThat(me.team === game.team && me.role === 'spymaster', 'Hanya pemberi petunjuk tim aktif yang bisa mengirim.', 403);
    const word = typeof data.word === 'string' ? data.word.trim().normalize('NFC') : '';
    requireThat(/^[\p{L}]{1,32}$/u.test(word), 'Petunjuk harus satu kata, 1–32 huruf.');
    requireThat(Number.isInteger(data.count) && data.count >= 1 && data.count <= 9, 'Pilih jumlah antara 1–9.');
    requireThat(!game.cards.some(c => !c.revealed && c.word.toLocaleLowerCase('id') === word.toLocaleLowerCase('id')), 'Petunjuk tidak boleh sama dengan kata yang belum terbuka.');
    game.clue = { word, count: data.count, by: id }; game.guesses = 0; game.phase = 'guess';
    log(game, 'clue', { word, count: data.count, by: id, team: game.team });
  } else if (action === 'guess') {
    requireThat(game?.status === 'playing' && game.phase === 'guess', 'Tunggu petunjuk sebelum menebak.');
    requireThat(me.team === game.team && me.role === 'guesser', 'Hanya penebak tim aktif yang bisa membuka kartu.', 403);
    requireThat(Number.isInteger(data.index) && data.index >= 0 && data.index < 25, 'Kartu tidak ditemukan.');
    const card = game.cards[data.index]; requireThat(!card.revealed, 'Kartu sudah terbuka.');
    card.revealed = true; game.guesses++;
    log(game, 'guess', { index: data.index, word: card.word, cardType: card.type, by: id, team: game.team });
    if (card.type === 'trap') { game.status = 'finished'; game.winner = other(game.team); game.reason = 'trap'; }
    else if (['coral', 'ocean'].includes(card.type) && !game.cards.some(c => c.type === card.type && !c.revealed)) {
      game.status = 'finished'; game.winner = card.type; game.reason = 'complete';
    } else if (card.type !== game.team || game.guesses >= game.clue.count + 1) nextTurn(game);
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
  } else if (action === 'kick') {
    requireThat(host && data.memberId !== id, 'Hanya host yang bisa mengeluarkan peserta lain.', 403);
    const target = membership(room, data.memberId); target.active = false; room.banned.push(target.id);
  } else if (action === 'leave') {
    me.active = false;
    if (host) room.hostId = room.members.filter(m => m.active).sort((a, b) => a.joinedAt - b.joinedAt)[0]?.id ?? null;
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
  if (!room.hostId) room.hostId = id;
  room.version++; room.updatedAt = Date.now(); return true;
}

export function snapshot(room, id, profiles, isOnline = () => false) {
  const me = membership(room, id);
  const result = { code: room.code, title: room.title, hostId: room.hostId, version: room.version, locked: room.locked,
    round: room.round, ready: ready(room), me: { ...me }, members: room.members.filter(m => m.active).map(m => ({
      ...m, name: profiles(m.id)?.name || 'Nama tidak tersedia', avatar: profiles(m.id)?.avatar || 1, online: isOnline(m.id)
    })), game: null };
  if (room.game) {
    const g = room.game;
    const secret = me.role === 'spymaster' && me.team !== null;
    result.game = { ...g, cards: g.cards.map(c => ({ word: c.word, revealed: c.revealed,
      ...(c.revealed || secret || g.status === 'finished' ? { type: c.type } : {}) })),
      remaining: { coral: g.cards.filter(c => c.type === 'coral' && !c.revealed).length, ocean: g.cards.filter(c => c.type === 'ocean' && !c.revealed).length }
    };
  }
  return result;
}
