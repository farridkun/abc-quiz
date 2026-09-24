// End-of-game celebration: confetti and a shareable 1080×1920 photocard
// (Instagram Story size). The background pattern and serial number are seeded
// from the game and the player, so every card is unique.

const W = 1080, H = 1920;
const INK = '#20261f', PAPER = '#f7f5ed', MUTED = '#5d6657', LIME = '#d8ef72';
const TEAM = { coral: { name: 'Coral', color: '#b83d38', soft: '#f3c2b9' }, ocean: { name: 'Ocean', color: '#205ac5', soft: '#bacef3' } };
const TILE = { coral: '#f3c2b9', ocean: '#bacef3', neutral: '#dedccb', trap: '#30392e' };
const AVATAR_BG = ['#ebdfd2', '#e9eccd', '#e4e7f0', '#f5d6cb'];
const HEADING = '"Space Grotesk", sans-serif', BODY = '"DM Sans", sans-serif';

function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function seeded(seed) {
  let a = seed;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// Stats derived from the public game history.
export function gameStats(room) {
  const g = room.game, correct = {}, clues = {};
  let best = null, current = null;
  for (const e of g.history) {
    if (e.type === 'clue') { current = { word: e.word, count: e.count, team: e.team, by: e.by, hits: 0 }; clues[e.by] = (clues[e.by] || 0) + 1; }
    else if (e.type === 'guess' && e.cardType === e.team) {
      correct[e.by] = (correct[e.by] || 0) + 1;
      if (current && current.team === e.team) { current.hits++; if (!best || current.hits > best.hits) best = { ...current }; }
    }
  }
  const nameOf = id => room.members.find(m => m.id === id)?.name;
  const mvpId = Object.keys(correct).filter(nameOf).sort((a, b) => correct[b] - correct[a])[0];
  const found = team => g.cards.filter(c => c.revealed && c.type === team).length;
  const trapEvent = g.history.find(e => e.type === 'guess' && e.cardType === 'trap');
  return { correct, clues, best, trap: trapEvent ? { word: trapEvent.word, by: nameOf(trapEvent.by) || 'pemain yang keluar' } : null, mvp: mvpId ? { name: nameOf(mvpId), count: correct[mvpId] } : null,
    found: { coral: found('coral'), ocean: found('ocean') }, turns: g.turn };
}

function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(out + '…').width > maxWidth) out = out.slice(0, -1);
  return out + '…';
}
function loadImage(src) {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
}

function drawPattern(ctx, room, rand) {
  // The actual words from this board, scattered as tiles in their revealed colours.
  const cards = room.game.cards;
  for (let i = 0; i < 26; i++) {
    const card = cards[Math.floor(rand() * cards.length)];
    const top = i < 13;
    const x = rand() * (W + 160) - 80, y = top ? rand() * 330 - 60 : H - 360 + rand() * 360;
    ctx.save();
    ctx.translate(x, y); ctx.rotate((rand() - .5) * 0.9); ctx.globalAlpha = 0.5 + rand() * 0.25;
    ctx.font = `700 ${34 + Math.floor(rand() * 18)}px ${HEADING}`;
    const w = ctx.measureText(card.word).width + 56;
    roundRect(ctx, -w / 2, -40, w, 80, 14);
    ctx.fillStyle = TILE[card.type] || TILE.neutral; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
    ctx.fillStyle = card.type === 'trap' ? '#fff' : INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(card.word, 0, 2);
    ctx.restore();
  }
}

function drawBrand(ctx, y) {
  const tiles = [['A', LIME, -4], ['B', '#f3b2a3', 5], ['C', '#c4d5f3', 3]];
  tiles.forEach(([letter, color, deg], i) => {
    ctx.save(); ctx.translate(W / 2 - 96 + i * 96, y); ctx.rotate(deg * Math.PI / 180);
    roundRect(ctx, -40, -46, 80, 92, 14); ctx.fillStyle = INK; ctx.save(); ctx.translate(0, 6); ctx.fill(); ctx.restore();
    roundRect(ctx, -40, -46, 80, 92, 14); ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
    ctx.fillStyle = INK; ctx.font = `700 58px ${HEADING}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(letter, 0, 3);
    ctx.restore();
  });
}

export async function makePhotocard(room, meId) {
  await Promise.all([`700 80px ${HEADING}`, `600 40px ${HEADING}`, `400 30px ${BODY}`, `700 30px ${BODY}`].map(f => document.fonts.load(f).catch(() => {})));
  const g = room.game, me = room.members.find(m => m.id === meId) || room.me;
  const seed = hashString(`${g.id}:${meId}`), rand = seeded(seed);
  const serial = `${room.code}-${seed.toString(36).toUpperCase().slice(0, 5).padStart(5, '0')}`;
  const stats = gameStats(room);
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
  drawPattern(ctx, room, rand);

  // Main card.
  const x = 70, y = 330, w = W - 140, h = 1260;
  roundRect(ctx, x, y + 14, w, h, 48); ctx.fillStyle = INK; ctx.fill();
  roundRect(ctx, x, y, w, h, 48); ctx.fillStyle = '#fffefa'; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = INK; ctx.stroke();
  drawBrand(ctx, y + 110);

  const winner = g.winner ? TEAM[g.winner] : null;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = MUTED; ctx.font = `700 28px ${BODY}`;
  const date = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  ctx.fillText(`ABC - QUIZ · RONDE ${room.round} · ${date.toUpperCase()}`, W / 2, y + 240);

  // Headline banner in the winning team's colour.
  roundRect(ctx, x + 60, y + 280, w - 120, 250, 32);
  ctx.fillStyle = winner ? winner.soft : '#e6ead5'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
  ctx.fillStyle = winner ? winner.color : INK; ctx.font = `700 104px ${HEADING}`;
  ctx.fillText(winner ? `TIM ${winner.name.toUpperCase()}` : 'RONDE SELESAI', W / 2, y + 400);
  ctx.fillStyle = INK; ctx.font = `600 52px ${HEADING}`;
  ctx.fillText(winner ? (g.reason === 'trap' ? 'menang karena jebakan!' : 'menemukan frekuensinya!') : 'Sampai jumpa di ronde berikutnya', W / 2, y + 480);

  // The player.
  const py = y + 580;
  ctx.save(); ctx.beginPath(); ctx.arc(x + 150, py + 90, 90, 0, Math.PI * 2); ctx.fillStyle = AVATAR_BG[(me?.avatar || 1) % 4]; ctx.fill(); ctx.clip();
  try { const img = await loadImage(`/assets/peep-${me?.avatar || 1}.svg`); ctx.drawImage(img, x + 60, py + 10, 180, 190); } catch {}
  ctx.restore();
  ctx.beginPath(); ctx.arc(x + 150, py + 90, 90, 0, Math.PI * 2); ctx.lineWidth = 5; ctx.strokeStyle = INK; ctx.stroke();
  const myTeam = me?.team ? TEAM[me.team] : null;
  const verdict = !myTeam ? 'Penonton setia' : !g.winner ? 'Main bareng' : me.team === g.winner ? 'Menang!' : 'Next time!';
  ctx.textAlign = 'left';
  ctx.fillStyle = INK; ctx.font = `700 60px ${HEADING}`; ctx.fillText(fitText(ctx, me?.name || 'Pemain', w - 360), x + 280, py + 70);
  ctx.fillStyle = myTeam ? myTeam.color : MUTED; ctx.font = `700 32px ${BODY}`;
  ctx.fillText(`${me?.role === 'spymaster' && myTeam ? 'Pemberi petunjuk' : myTeam ? 'Penebak' : 'Penonton'}${myTeam ? ' · Tim ' + myTeam.name : ''}`, x + 280, py + 120);
  roundRect(ctx, x + 280, py + 142, ctx.measureText(verdict).width + 50, 54, 27);
  ctx.fillStyle = LIME; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
  ctx.fillStyle = INK; ctx.font = `700 30px ${BODY}`; ctx.fillText(verdict, x + 305, py + 180);

  // Stats.
  const mine = me?.role === 'spymaster' ? [stats.clues[me.id] || 0, 'petunjukmu'] : [stats.correct[me?.id] || 0, 'tebakanmu tepat'];
  const tiles = [[`${stats.found.coral}–${stats.found.ocean}`, 'kartu Coral–Ocean'], [String(stats.turns), 'giliran'], [String(mine[0]), mine[1]]];
  const sy = py + 260, tw = (w - 160) / 3;
  tiles.forEach(([value, label], i) => {
    const tx = x + 60 + i * (tw + 20);
    roundRect(ctx, tx, sy, tw - 20, 170, 24); ctx.fillStyle = '#f0f1e9'; ctx.fill();
    ctx.textAlign = 'center'; ctx.fillStyle = INK; ctx.font = `700 72px ${HEADING}`; ctx.fillText(value, tx + (tw - 20) / 2, sy + 90);
    ctx.fillStyle = MUTED; ctx.font = `400 24px ${BODY}`; ctx.fillText(fitText(ctx, label, tw - 44), tx + (tw - 20) / 2, sy + 136);
  });

  // Highlights.
  ctx.textAlign = 'left'; let hy = sy + 250;
  const line = (label, value) => {
    ctx.fillStyle = MUTED; ctx.font = `700 26px ${BODY}`; ctx.fillText(label, x + 60, hy);
    ctx.fillStyle = INK; ctx.font = `600 40px ${HEADING}`; ctx.fillText(fitText(ctx, value, w - 120), x + 60, hy + 50); hy += 110;
  };
  if (stats.mvp) line('MVP', `${stats.mvp.name} · ${stats.mvp.count} kartu tepat`);
  if (stats.best) line('PETUNJUK TERBAIK', `“${stats.best.word}” · ${stats.best.hits} kartu nyambung`);
  if (stats.trap) line('JEBAKAN TERBUKA', `“${stats.trap.word}” · oleh ${stats.trap.by}`);
  if (!stats.mvp && !stats.best && !stats.trap) line('CERITA RONDE INI', 'Ronde singkat, cerita panjang. Lain kali!');

  // Footer inside the card: serial number and address.
  ctx.fillStyle = MUTED; ctx.font = `700 26px ${BODY}`; ctx.textAlign = 'left';
  ctx.fillText(`No. ${serial}`, x + 60, y + h - 60);
  ctx.textAlign = 'right'; ctx.fillText('abc-quiz.farrid.dev', x + w - 60, y + h - 60);

  return { blob: await new Promise(resolve => canvas.toBlob(resolve, 'image/png')), serial };
}

export function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
  canvas.className = 'confetti'; canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio;
  document.body.append(canvas); ctx.scale(devicePixelRatio, devicePixelRatio);
  const colors = [LIME, '#f3b2a3', '#c4d5f3', '#b83d38', '#205ac5', INK];
  const parts = Array.from({ length: 170 }, () => ({ x: innerWidth / 2 + (Math.random() - .5) * 120, y: innerHeight * .35, vx: (Math.random() - .5) * 16, vy: -Math.random() * 16 - 6,
    size: 6 + Math.random() * 8, rot: Math.random() * 6, vr: (Math.random() - .5) * .4, color: colors[Math.floor(Math.random() * colors.length)] }));
  const start = performance.now();
  const frame = now => {
    const t = now - start; ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.42; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = Math.max(0, 1 - t / 2800);
      ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); ctx.restore();
    }
    if (t < 2800) requestAnimationFrame(frame); else canvas.remove();
  };
  requestAnimationFrame(frame);
}
