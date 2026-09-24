import test from 'node:test';
import assert from 'node:assert/strict';
import { newRoom, joinRoom, applyCommand, snapshot, validName } from '../lib/game.mjs';
import { WORDS } from '../lib/words.mjs';

function fixture() {
  const room = newRoom('ABC234', 'host', 'Test');
  for (const id of ['a', 'b', 'c']) joinRoom(room, id);
  applyCommand(room, 'host', 'seat', { team: 'coral', role: 'spymaster' });
  applyCommand(room, 'a', 'seat', { team: 'coral', role: 'guesser' });
  applyCommand(room, 'b', 'seat', { team: 'ocean', role: 'spymaster' });
  applyCommand(room, 'c', 'seat', { team: 'ocean', role: 'guesser' });
  applyCommand(room, 'host', 'start');
  return room;
}
function turn(room, count = 2) {
  const team = room.game.team;
  const spy = team === 'coral' ? 'host' : 'b', guesser = team === 'coral' ? 'a' : 'c';
  applyCommand(room, spy, 'clue', { word: 'Asosiasi', count });
  return { team, spy, guesser };
}

test('names are manual, Unicode-safe, trimmed and never randomized', () => {
  assert.equal(validName('  Rani Putri  '), 'Rani Putri');
  assert.equal(validName('Éka 王'), 'Éka 王');
  for (const name of ['', '   ', null, 'x'.repeat(25), 'A\nB', '<script>']) assert.throws(() => validName(name));
});
test('deck has at least 300 unique words; board has exact distribution', () => {
  assert.ok(WORDS.length >= 300);
  const { game } = fixture();
  assert.equal(new Set(game.cards.map(c => c.word)).size, 25);
  assert.equal(game.cards.filter(c => c.type === game.team).length, 9);
  assert.equal(game.cards.filter(c => c.type === 'neutral').length, 7);
  assert.equal(game.cards.filter(c => c.type === 'trap').length, 1);
});
test('guesser, spectator and host do not gain secret access from capabilities', () => {
  const room = fixture(); joinRoom(room, 'watcher');
  const profile = id => ({ name: id, avatar: 1 });
  for (const id of ['a', 'c', 'watcher']) assert.ok(snapshot(room, id, profile).game.cards.every(c => !('type' in c)));
  assert.ok(snapshot(room, 'host', profile).game.cards.every(c => c.type));
  room.hostId = 'watcher'; assert.ok(snapshot(room, 'watcher', profile).game.cards.every(c => !('type' in c)));
});
test('role locking, role authorization, invalid clues and duplicate spy rejected', () => {
  const room = fixture(), { spy, guesser } = turn(room);
  assert.throws(() => applyCommand(room, guesser, 'seat', { team: 'coral', role: 'spymaster' }));
  assert.throws(() => applyCommand(room, spy, 'guess', { index: 0 }));
  assert.throws(() => applyCommand(room, guesser, 'end-turn'));
  room.game.phase = 'clue';
  assert.throws(() => applyCommand(room, guesser, 'clue', { word: 'ABC', count: 1 }));
  assert.throws(() => applyCommand(room, spy, 'clue', { word: room.game.cards[0].word, count: 1 }));
  assert.throws(() => applyCommand(room, spy, 'clue', { word: 'Dua kata', count: 1 }));
});
test('own cards allow count+1 guesses then next team; repeated reveals fail', () => {
  const room = fixture(), { guesser, team } = turn(room, 1);
  const indexes = room.game.cards.map((c, i) => c.type === team ? i : -1).filter(i => i >= 0);
  applyCommand(room, guesser, 'guess', { index: indexes[0] });
  assert.equal(room.game.team, team); assert.equal(room.game.guesses, 1);
  assert.throws(() => applyCommand(room, guesser, 'guess', { index: indexes[0] }));
  applyCommand(room, guesser, 'guess', { index: indexes[1] });
  assert.notEqual(room.game.team, team); assert.equal(room.game.phase, 'clue');
});
test('neutral and opponent cards end turn; revealed information becomes public', () => {
  for (const type of ['neutral', 'opponent']) {
    const room = fixture(), { guesser, team } = turn(room);
    const index = room.game.cards.findIndex(c => type === 'neutral' ? c.type === type : ['coral', 'ocean'].includes(c.type) && c.type !== team);
    applyCommand(room, guesser, 'guess', { index });
    assert.notEqual(room.game.team, team);
    assert.ok(snapshot(room, guesser, id => ({ name: id })).game.cards[index].type);
  }
});
test('trap loses instantly; remaining cards stay secret until game ends', () => {
  const room = fixture(), { guesser, team } = turn(room);
  applyCommand(room, guesser, 'guess', { index: room.game.cards.findIndex(c => c.type === 'trap') });
  assert.equal(room.game.status, 'finished'); assert.notEqual(room.game.winner, team);
  assert.ok(snapshot(room, guesser, id => ({ name: id })).game.cards.every(c => c.type));
});
test('last own or opponent card awards the correct winner', () => {
  for (const opponent of [false, true]) {
    const room = fixture(), { guesser, team } = turn(room);
    const winner = opponent ? team === 'coral' ? 'ocean' : 'coral' : team;
    const cards = room.game.cards.filter(c => c.type === winner); cards.slice(1).forEach(c => c.revealed = true);
    applyCommand(room, guesser, 'guess', { index: room.game.cards.indexOf(cards[0]) });
    assert.equal(room.game.status, 'finished'); assert.equal(room.game.winner, winner);
  }
});
test('leave/rejoin preserves secret role, kick bans and rematch returns to lobby', () => {
  const room = fixture();
  applyCommand(room, 'b', 'leave'); joinRoom(room, 'b');
  assert.equal(room.members.find(m => m.id === 'b').role, 'spymaster');
  applyCommand(room, 'host', 'kick', { memberId: 'a' }); assert.throws(() => joinRoom(room, 'a'));
  applyCommand(room, 'host', 'abort'); applyCommand(room, 'host', 'rematch'); assert.equal(room.game, null);
});

test('rejoining a lobby cannot create two spymasters on one team', () => {
  const room = fixture();
  applyCommand(room, 'host', 'abort'); applyCommand(room, 'host', 'rematch');
  applyCommand(room, 'b', 'leave');
  applyCommand(room, 'c', 'seat', { team: 'ocean', role: 'spymaster' });
  joinRoom(room, 'b');
  assert.equal(room.members.filter(m => m.active && m.team === 'ocean' && m.role === 'spymaster').length, 1);
  assert.equal(room.members.find(m => m.id === 'b').role, 'guesser');
});
