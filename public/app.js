const $ = s => document.querySelector(s);
const app = $('#app'), dialog = $('#dialog');
const state = { profile: null, csrf: '', room: null, code: location.pathname.match(/^\/r\/([A-Z2-9]{6})$/)?.[1] || '', mode: 'create', avatar: 1, selected: null, stream: null, online: true, busy: false, sound: false, signature: '', lastGameId: null };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = '') => `<img class="icon ${cls}" src="/assets/icon-${name}.svg" alt="" aria-hidden="true" width="20" height="20">`;
const avatar = (n, cls = '') => `<span class="avatar avatar-${n % 4} ${cls}"><img src="/assets/peep-${n}.svg" alt=""></span>`;
const teamName = team => team === 'coral' ? 'Coral' : 'Ocean';
function newCommandId() {
  // getRandomValues is supported on LAN HTTP too; randomUUID requires HTTPS.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
}
const teamSymbol = team => icon(team === 'coral' ? 'triangle' : 'circle');
const announce = message => { $('#announcer').textContent = message; };
function notice(message) { const n = $('#notice'); n.innerHTML = `<span>${esc(message)}</span><button data-action="dismiss-notice" aria-label="Tutup pemberitahuan">${icon('x')}</button>`; n.hidden = false; }
function clearNotice() { $('#notice').hidden = true; }
async function api(path, data, method = 'POST') {
  let response;
  try { response = await fetch('/api' + path, { method: data === undefined ? 'GET' : method, credentials: 'same-origin', headers: data === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }); }
  catch { throw new Error('Koneksi terputus. Data belum dikirim. Coba lagi saat terhubung.'); }
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error); error.status = response.status; error.code = result.code; throw error; }
  return result;
}
function header() {
  return `<header class="site-header"><a href="/" class="brand" data-action="home" aria-label="ABC — Aku Butuh Code, beranda"><span class="brand-tiles"><b>A</b><b>B</b><b>C</b></span><span class="brand-name">Aku Butuh Code<span>a little break, a lot of connection.</span></span></a><nav aria-label="Navigasi utama"><button class="text-button" data-action="help">${icon('help-circle')}<span>Cara main</span></button>${state.profile?.name ? `<button class="profile-button" data-action="profile">${avatar(state.profile.avatar)}<span>${esc(state.profile.name)}</span>${icon('pencil')}</button>` : `<span class="header-tag">MADE FOR YOUR PEOPLE ${icon('sparkles')}</span>`}</nav></header>`;
}
function footer() {
  return `<footer class="site-footer"><span>ABC <span class="footer-dot">/</span> Waktunya nyambung, bukan meeting.</span><button class="text-button" data-action="about">Dibuat untuk jeda yang berarti ${icon('arrow-right')}</button></footer>`;
}
function avatarPicker(selected, all = false) {
  return `<div class="avatar-picker" role="group" aria-label="Pilih avatar">${Array.from({ length: all ? 12 : 6 }, (_, i) => `<button type="button" data-action="avatar" data-avatar="${i + 1}" aria-label="Avatar ${i + 1}" aria-pressed="${selected === i + 1}" class="avatar-option ${selected === i + 1 ? 'chosen' : ''}">${avatar(i + 1)}${selected === i + 1 ? `<span class="avatar-check">${icon('check')}</span>` : ''}</button>`).join('')}</div>`;
}
function landing() {
  const joining = state.code || state.mode === 'join';
  return `${header()}<main id="main" class="landing" tabindex="-1"><section class="hero-copy"><div class="eyebrow"><span class="status-dot"></span> YOUR NEXT COFFEE BREAK, UPGRADED</div><h1>Satu kode.<br>Banyak <span class="word-highlight">cerita.<svg viewBox="0 0 400 16" aria-hidden="true"><path d="M3 10 Q190 -3 397 9 M30 15 Q190 4 340 12"/></svg></span></h1><p class="hero-description">Tutup tab kerja sebentar. Buka obrolan baru.<br>Tebak kata, baca pikiran, dan ketawa bareng<br class="desktop-break"> orang-orang favoritmu di kantor.</p><div class="hero-facts"><span>${icon('users')}4–12 pemain</span><span>${icon('clock')}± 15–20 menit</span><span>${icon('coffee')}Tanpa instal</span></div><div class="hero-art" aria-hidden="true"><span class="art-note">beda kepala,<br>satu frekuensi.</span><div class="art-circle"></div><img class="hero-peep peep-left" src="/assets/peep-3.svg" alt=""><img class="hero-peep peep-right" src="/assets/peep-1.svg" alt=""><div class="floating-word word-coral">KOPI <span>01</span></div><div class="floating-word word-lime">IDE <span>02</span></div><span class="art-star">✳</span><span class="art-line"></span></div></section><section class="entry-panel" aria-labelledby="entry-title"><div class="panel-sticker">GOOD TIMES<br>START HERE ${icon('arrow-right')}</div><div class="entry-heading"><span class="overline">${joining ? 'SUDAH DITUNGGU TEMAN?' : 'ADA JEDA? ADA ABC.'}</span><h2 id="entry-title">${joining ? 'Masuk ke circle-mu.' : 'Kumpulkan circle-mu.'}</h2><p>${joining ? 'Isi nama kamu, lalu gabung ke ruang teman.' : 'Satu ruang kecil untuk ide-ide besar.'}</p></div><form id="entry-form" novalidate><label for="player-name">Nama kamu <span>biar teman tahu ini kamu</span></label><input id="player-name" name="name" autocomplete="nickname" placeholder="Contoh: Rani" value="${esc(state.profile?.name || '')}" maxlength="100" aria-describedby="entry-error" required><div class="avatar-label">Pilih versi kamu <span>bebas jadi diri sendiri</span></div>${avatarPicker(state.avatar)}<div class="entry-tabs" role="group" aria-label="Pilih tindakan"><button type="button" data-action="entry-create" class="${!joining ? 'active' : ''}">${icon('plus')}Buat ruang</button><button type="button" data-action="entry-join" class="${joining ? 'active' : ''}">${icon('link')}Gabung ruang</button></div>${joining ? `<label for="room-code">Kode ruang</label><input id="room-code" name="code" class="code-input" placeholder="ABC123" value="${esc(state.code)}" maxlength="6" autocapitalize="characters" autocomplete="off" aria-describedby="entry-error" required>` : `<label for="room-title">Nama ruang <span>opsional</span></label><input id="room-title" name="title" placeholder="Jeda anak lantai 3" maxlength="100">`}<p id="entry-error" class="form-error" role="alert"></p><button class="button primary full" type="submit">${joining ? 'Gabung & main bareng' : 'Buat ruang bermain'}${icon('arrow-right')}</button><p class="entry-note">${icon('lock')}Ruang privat. Tanpa akun. Nama pilihanmu tetap.</p></form></section><section class="how-strip" aria-label="Tiga langkah bermain"><div class="how-intro"><span class="overline">LESS SCROLLING.</span><h3>More connecting.</h3></div><div><span class="step-number">01</span><p><strong>Ajak orang-orangmu</strong><span>Bagikan link, kumpulkan tim.</span></p></div><div><span class="step-number">02</span><p><strong>Satu kata jadi petunjuk</strong><span>Temukan koneksi di balik kata.</span></p></div><div><span class="step-number">03</span><p><strong>Rayakan satu frekuensi</strong><span>Menang atau kalah, main lagi.</span></p></div></section></main>${footer()}`;
}
function memberRow(m, host) {
  const duplicate = state.room.members.filter(p => p.name.toLocaleLowerCase('id') === m.name.toLocaleLowerCase('id')).length > 1;
  return `<div class="member-row">${avatar(m.avatar)}<div class="member-text"><strong>${esc(m.name)}${duplicate ? `<small class="identity-badge">#${m.id.slice(0, 4)}</small>` : ''}${m.id === state.profile.id ? '<small>kamu</small>' : ''}</strong><span>${m.id === host ? 'Host · ' : ''}${m.role === 'spymaster' ? 'Pemberi petunjuk' : m.team ? 'Penebak' : 'Penonton'} <span class="online-dot ${m.online ? 'is-online' : ''}" aria-label="${m.online ? 'Terhubung' : 'Tidak terhubung'}"></span></span></div>${state.room.hostId === state.profile.id && m.id !== state.profile.id ? `<button class="icon-button subtle" data-action="kick" data-id="${m.id}" aria-label="Keluarkan ${esc(m.name)}">${icon('x')}</button>` : ''}</div>`;
}
function teamPanel(team, lobby = false) {
  const r = state.room, members = r.members.filter(m => m.team === team), me = r.me;
  const spy = members.find(m => m.role === 'spymaster');
  return `<section class="team-panel ${team}"><div class="team-heading"><div>${teamSymbol(team)}<h2>Tim ${teamName(team)}</h2></div>${r.game ? `<span class="score">${r.game.remaining[team]}<small> tersisa</small></span>` : `<span class="team-count">${members.length} pemain</span>`}</div><p class="team-motto">${team === 'coral' ? 'Berani nebak. Berani nyambung.' : 'Tenang di luar. Banyak ide di dalam.'}</p><div class="member-list">${members.length ? members.map(m => memberRow(m, r.hostId)).join('') : `<div class="empty-team">${icon('users')}Belum ada yang di sini.<br>Jadi yang pertama?</div>`}</div>${lobby ? `<div class="seat-actions"><button class="button small ${me.team === team && me.role === 'guesser' ? 'selected-seat' : ''}" data-action="seat" data-team="${team}" data-role="guesser" ${me.team === team && me.role === 'guesser' ? 'disabled' : ''}>${icon('users')}${me.team === team && me.role === 'guesser' ? 'Kamu penebak' : 'Jadi penebak'}</button><button class="button small ${me.team === team && me.role === 'spymaster' ? 'selected-seat' : ''}" data-action="seat" data-team="${team}" data-role="spymaster" ${spy ? 'disabled' : ''}>${icon('eye')}${me.team === team && me.role === 'spymaster' ? 'Kamu pemberi petunjuk' : 'Beri petunjuk'}</button></div>` : ''}</section>`;
}
function roomHeader() {
  const r = state.room;
  return `<div class="room-top"><div><div class="eyebrow">${r.game ? `RONDE ${r.round} · ${r.game.status === 'finished' ? 'SELESAI' : 'LET’S CONNECT THE DOTS'}` : 'THE GANG’S ALMOST HERE'}</div><h1>${esc(r.title)}</h1></div><div class="room-tools"><span class="connection ${state.online ? '' : 'disconnected'}"><span class="status-dot"></span>${state.online ? 'Terhubung' : 'Menghubungkan…'}</span><button class="button small invite-button" data-action="invite">${icon('copy')}<span>${r.code}</span></button><button class="icon-button" data-action="leave" aria-label="Keluar ruang">${icon('log-out')}</button></div></div>${!state.online ? `<div class="connection-banner" role="status">${icon('wifi-off')}Koneksi terputus. Aksi dijeda; kami akan memuat papan terbaru saat terhubung.</div>` : ''}`;
}
function lobby() {
  const r = state.room, host = r.hostId === state.profile.id, waiting = r.members.filter(m => !m.team);
  return `${header()}<main id="main" class="room-main" tabindex="-1">${roomHeader()}<div class="lobby-layout"><div class="lobby-left"><div class="section-label"><span>01 / PILIH TIM & PERAN</span><span>${r.members.length}/12 pemain</span></div><div class="lobby-teams">${teamPanel('coral', true)}${teamPanel('ocean', true)}</div><div class="spectator-panel"><div><h3>${icon('coffee')}Bangku santai</h3><p>Belum memilih tim? Kamu ada di sini.</p></div>${r.me.team ? '<button class="text-button" data-action="spectate">Jadi penonton</button>' : ''}<div class="spectator-list">${waiting.map(m => memberRow(m, r.hostId)).join('')}</div></div></div><aside class="lobby-aside"><div class="invite-card"><div class="overline">02 / AJAK TEMANMU</div><h2>Jeda makin seru<br>kalau bareng.</h2><div class="invite-art">${avatar(3)}${avatar(1)}${avatar(5)}</div><button class="button primary full" data-action="invite">${icon('link')}Salin link undangan</button><p>Bagikan di grup kantor atau panggilanmu.</p></div><div class="ready-card"><h3>${icon('play')}Siap satu frekuensi?</h3><p>Setiap tim perlu <strong>1 pemberi petunjuk</strong> dan minimal <strong>1 penebak</strong>.</p><div class="ready-checks">${['coral', 'ocean'].map(t => `<span>${icon(r.members.some(m => m.team === t && m.role === 'spymaster') && r.members.some(m => m.team === t && m.role === 'guesser') ? 'check-check' : 'clock')}Tim ${teamName(t)}</span>`).join('')}</div>${host ? `<button class="button dark full" data-action="start" ${!r.ready || !state.online ? 'disabled' : ''}>Mulai permainan${icon('arrow-right')}</button><button class="text-button full lock-action" data-action="lock">${icon(r.locked ? 'lock' : 'unlock')}${r.locked ? 'Buka kunci ruang' : 'Kunci ruang'}</button>` : '<p class="waiting-note">Host akan memulai setelah tim siap.</p>'}</div></aside></div><div class="lobby-tip">${icon('eye')}Pemberi petunjuk melihat peta rahasia. Penebak mencari kata yang tepat. <button class="text-button" data-action="help">Lihat cara main ${icon('arrow-right')}</button></div></main>${footer()}`;
}
function cardMarkup(c, i, canGuess) {
  const g = state.room.game, isSpy = state.room.me.role === 'spymaster' && state.room.me.team;
  const known = c.type && (c.revealed || isSpy || g.status === 'finished');
  const typeText = c.type === 'neutral' ? 'Netral' : c.type === 'trap' ? 'Jebakan' : c.type ? `Tim ${teamName(c.type)}` : '';
  return `<button class="word-card ${known ? c.type : ''} ${c.revealed ? 'revealed' : ''} ${state.selected === i ? 'card-selected' : ''} ${isSpy && !c.revealed ? 'secret-card' : ''}" data-action="card" data-index="${i}" ${!canGuess || c.revealed ? 'disabled' : ''} aria-pressed="${state.selected === i}" aria-label="${String.fromCharCode(65 + Math.floor(i / 5))}${i % 5 + 1}, ${esc(c.word)}${known ? ', ' + typeText : ''}${c.revealed ? ', sudah terbuka' : ''}"><span class="card-coordinate">${String.fromCharCode(65 + Math.floor(i / 5))}${i % 5 + 1}</span><strong>${esc(c.word)}</strong><span class="card-foot">${known ? `${icon(c.type === 'trap' ? 'x' : c.type === 'neutral' ? 'minus' : c.type === 'coral' ? 'triangle' : 'circle')} ${typeText}` : 'ABC'}${c.revealed ? icon('check') : ''}</span></button>`;
}
function gameView() {
  const r = state.room, g = r.game, me = r.me, finished = g.status === 'finished';
  const isSpy = me.role === 'spymaster' && me.team;
  const canGuess = !finished && g.phase === 'guess' && me.role === 'guesser' && me.team === g.team && state.online;
  const canClue = !finished && g.phase === 'clue' && isSpy && me.team === g.team;
  const spy = r.members.find(m => m.team === g.team && m.role === 'spymaster');
  const selected = state.selected !== null ? g.cards[state.selected] : null;
  const status = finished ? g.winner ? `Tim ${teamName(g.winner)} menemukan frekuensinya!` : 'Pertandingan dihentikan' : g.phase === 'clue' ? `Menunggu petunjuk ${spy?.name || 'pemberi petunjuk'}` : me.team === g.team && !isSpy ? 'Giliran timmu. Hubungkan kata-katanya.' : `Tim ${teamName(g.team)} sedang menebak.`;
  return `${header()}<main id="main" class="room-main game-main" tabindex="-1">${roomHeader()}${isSpy && !finished ? `<div class="secret-warning">${icon('eye')}Peta rahasia · Kamu pemberi petunjuk. Jangan bagikan layar ini.</div>` : ''}<div class="game-layout"><aside class="game-sidebar">${teamPanel('coral')}${teamPanel('ocean')}<div class="role-card"><span class="overline">PERAN KAMU</span><strong>${icon(isSpy ? 'eye' : me.team ? 'users' : 'coffee')}${isSpy ? 'Pemberi petunjuk' : me.team ? 'Penebak' : 'Penonton'}</strong><p>${isSpy ? 'Satu kata. Bantu timmu menemukan koneksinya.' : me.team ? 'Diskusikan pilihanmu. Klik kartu, lalu konfirmasi.' : 'Nikmati permainan dari bangku santai.'}</p></div></aside><section class="play-surface" aria-label="Papan permainan"><div class="turn-banner ${finished ? 'finished-banner' : g.team}"><div class="turn-symbol">${icon(finished ? 'trophy' : 'sparkles')}</div><div><span class="overline">${finished ? 'THAT WAS A GOOD BREAK' : `GILIRAN TIM ${teamName(g.team).toUpperCase()} · ${g.turn}`}</span><h2>${esc(status)}</h2>${finished ? `<p>${g.reason === 'trap' ? 'Satu jebakan, banyak cerita. Siap coba lagi?' : g.reason === 'complete' ? 'Semua kata tim berhasil ditemukan. Nice teamwork!' : 'Ajak teman kembali dan mulai ronde baru.'}</p>` : ''}</div></div>${!finished ? `<div class="clue-area">${canClue ? `<form id="clue-form" class="clue-form"><div><label for="clue-word">Petunjuk satu kata</label><input id="clue-word" placeholder="Contoh: Sarapan" autocomplete="off" maxlength="32" required></div><div class="clue-number"><label for="clue-count">Jumlah</label><select id="clue-count">${Array.from({ length: 9 }, (_, i) => `<option>${i + 1}</option>`).join('')}</select></div><button class="button dark" ${!state.online ? 'disabled' : ''}>Kirim ${icon('arrow-right')}</button></form>` : g.clue ? `<div class="active-clue"><span>PETUNJUK</span><strong>${esc(g.clue.word)}</strong><b>${g.clue.count}</b><span class="guess-count">${g.guesses}/${g.clue.count + 1} tebakan</span></div>` : `<div class="clue-waiting">${icon('coffee')}Ide bagus butuh sedikit waktu. Petunjuk segera datang.</div>`}</div>` : ''}<div class="board-scroll"><div class="word-grid">${g.cards.map((c, i) => cardMarkup(c, i, canGuess)).join('')}</div></div><div class="board-actions">${finished ? `<div><strong>${g.winner ? 'Satu ronde lagi?' : 'Mulai dari awal lagi.'}</strong><span>Tim yang sama, kemungkinan baru.</span></div>${r.hostId === state.profile.id ? `<button class="button primary" data-action="rematch">${icon('rotate-ccw')}Siapkan ronde baru</button>` : '<p>Menunggu host menyiapkan ronde baru.</p>'}` : `<div class="selection-status">${selected && canGuess ? `<strong>${esc(selected.word)}</strong><span>Yakin ini kata yang dimaksud?</span>` : `<span>${canGuess ? 'Pilih kartu, lalu konfirmasi untuk membukanya.' : 'Papan diperbarui otomatis untuk semua pemain.'}</span>`}</div><div class="board-action-buttons">${canGuess ? `<button class="button small" data-action="end-turn" ${g.guesses < 1 ? 'disabled' : ''}>Akhiri giliran</button><button class="button dark" data-action="reveal" ${!selected ? 'disabled' : ''}>${selected ? 'Buka ' + esc(selected.word) : 'Pilih kartu'}${icon('arrow-right')}</button>` : ''}</div>`}</div><div class="board-legend"><span>${teamSymbol('coral')}Coral</span><span>${teamSymbol('ocean')}Ocean</span><span>${icon('minus')}Netral</span><span>${icon('x')}Jebakan = kalah</span><button class="text-button" data-action="sound">${icon(state.sound ? 'volume-2' : 'volume-x')}${state.sound ? 'Suara aktif' : 'Suara mati'}</button></div></section><aside class="history-sidebar"><h2>${icon('clock')}Jejak petunjuk</h2><p class="muted">Setiap kata punya cerita.</p><div class="history-list">${g.history.length ? [...g.history].reverse().map(e => `<div class="history-item"><span class="history-team ${e.team}">${teamSymbol(e.team)}</span><div>${e.type === 'clue' ? `<strong>${esc(e.word)} <b>${e.count}</b></strong><span>${esc(r.members.find(m => m.id === e.by)?.name || 'Pemain yang keluar')} memberi petunjuk</span>` : e.type === 'guess' ? `<strong>${esc(e.word)}</strong><span>${e.cardType === 'trap' ? 'Jebakan terbuka' : e.cardType === 'neutral' ? 'Kartu netral' : 'Kartu ' + teamName(e.cardType)} · ${esc(r.members.find(m => m.id === e.by)?.name || 'Pemain yang keluar')}</span>` : '<strong>Giliran diakhiri</strong>'}</div></div>`).join('') : `<div class="history-empty">${icon('sparkles')}Cerita pertama<br>dimulai dari satu kata.</div>`}</div>${r.hostId === state.profile.id && !finished ? `<button class="text-button end-game" data-action="abort">Hentikan pertandingan</button>` : ''}</aside></div></main>${footer()}`;
}
function render() {
  const values = [...app.querySelectorAll('input,select')].filter(x => x.id).map(x => [x.id, x.value]);
  const active = document.activeElement;
  const focus = app.contains(active) ? { id: active.id, action: active.dataset?.action, index: active.dataset?.index, team: active.dataset?.team, role: active.dataset?.role, start: active.selectionStart, end: active.selectionEnd } : null;
  app.innerHTML = state.room ? state.room.game ? gameView() : lobby() : landing();
  values.forEach(([id, value]) => { const input = document.getElementById(id); if (input && app.contains(input)) input.value = value; });
  if (focus) {
    let target = focus.id ? document.getElementById(focus.id) : [...app.querySelectorAll('[data-action]')].find(el => el.dataset.action === focus.action && el.dataset.index === focus.index && el.dataset.team === focus.team && el.dataset.role === focus.role);
    if (target?.disabled && focus.action === 'card') target = app.querySelector('.word-card:not(:disabled)') || document.getElementById('main');
    if (target && !target.disabled) { target.focus({ preventScroll: true }); if (focus.start != null && target.setSelectionRange) try { target.setSelectionRange(focus.start, focus.end); } catch {} }
  }
  document.title = state.room ? `${state.room.title} · ABC — Aku Butuh Code` : 'ABC — Aku Butuh Code';
}
async function refresh() {
  if (!state.code || !state.room) return;
  try {
    const code = state.code;
    const r = await api(`/rooms/${code}`);
    if (code !== state.code) return;
    const me = await api('/me');
    state.csrf = me.csrf;
    if (state.stream?.readyState === EventSource.OPEN && !state.online) { state.online = true; state.signature = ""; }
    if (me.profile.version >= (state.profile?.version || 0)) state.profile = me.profile;
    if (state.lastGameId !== r.game?.id) { state.selected = null; state.lastGameId = r.game?.id; }
    if (state.selected !== null && (r.game?.cards[state.selected]?.revealed || r.game?.phase !== 'guess' || r.game?.team !== r.me.team)) state.selected = null;
    const signature = JSON.stringify([r, state.profile]);
    if (signature !== state.signature) {
      const old = state.room;
      state.signature = signature; state.room = r; render();
      if (old?.game?.history.length !== r.game?.history.length) { announce('Papan permainan diperbarui.'); if (state.sound) playTone(); }
    }
  } catch (err) {
    if ([401, 403, 404].includes(err.status)) { leaveLocal(); notice(err.message); }
    else if (state.online) { state.online = false; render(); }
  }
}
let refreshing = false, refreshAgain = false;
async function sync() {
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  try { do { refreshAgain = false; await refresh(); } while (refreshAgain); } finally { refreshing = false; }
}
function connect() {
  state.stream?.close();
  state.stream = new EventSource(`/api/rooms/${state.code}/events`);
  state.stream.onopen = () => { state.online = true; render(); sync(); };
  state.stream.addEventListener('update', sync);
  state.stream.onerror = () => { state.online = false; render(); };
}
async function enter(code) {
  await api(`/rooms/${code}/join`, {});
  state.code = code;
  state.room = await api(`/rooms/${code}`); state.signature = ''; state.lastGameId = state.room.game?.id;
  history.pushState({}, '', `/r/${code}`); render(); connect(); $('#main')?.focus(); clearNotice();
}
function leaveLocal() {
  state.stream?.close(); state.stream = null; state.room = null; state.code = ''; state.signature = ''; state.selected = null; state.online = true;
  history.pushState({}, '', '/'); render(); $('#main')?.focus();
}
async function runCommand(action, data = {}, commandId = newCommandId()) {
  if (!state.online) return notice('Tunggu koneksi pulih sebelum melanjutkan.');
  if (state.busy) return;
  state.busy = true;
  try { await api(`/rooms/${state.code}/command`, { ...data, action, version: state.room.version, commandId }); clearNotice(); if (action === 'leave') leaveLocal(); else await sync(); }
  catch (err) { notice(err.message); if (err.status === 409) await sync(); }
  finally { state.busy = false; }
}
let modalAction = null, modalTrigger = null, profileEditVersion = null;
function openDialog(title, content, action = null) {
  modalTrigger = document.activeElement; modalAction = action;
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">${title}</h2><button class="icon-button" data-action="close-dialog" aria-label="Tutup">${icon('x')}</button></div>${content}`;
  dialog.showModal();
}
dialog.addEventListener('close', () => { state.avatar = state.profile.avatar; if (modalTrigger?.isConnected) modalTrigger.focus(); else $('#main')?.focus(); });
function confirmAction(title, text, label, fn) { openDialog(title, `<p class="dialog-description">${text}</p><div class="dialog-actions"><button class="button" data-action="close-dialog" autofocus>Batal</button><button class="button dark" data-action="confirm">${label}</button></div>`, fn); }
function help() {
  openDialog('Satu kata. Banyak kemungkinan.', `<p class="dialog-description">Dua tim berlomba menemukan semua kata miliknya. Yang paling nyambung, menang.</p><ol class="help-steps"><li><b>Pilih peranmu</b><p>Satu pemberi petunjuk per tim melihat peta rahasia. Penebak hanya melihat kata.</p></li><li><b>Hubungkan lewat satu kata</b><p>Misalnya “Sarapan · 2” untuk KOPI dan ROTI. Petunjuk tidak boleh sama dengan kata di papan.</p></li><li><b>Diskusi, pilih, konfirmasi</b><p>Tebak hingga jumlah petunjuk + 1. Setelah satu tebakan, kamu boleh mengakhiri giliran.</p></li><li><b>Hati-hati salah frekuensi</b><p>Netral atau kartu lawan mengakhiri giliran. Kartu lawan membantu mereka. Membuka jebakan membuat timmu kalah.</p></li></ol><div class="help-note">${icon('coffee')}Ngobrol langsung atau pakai panggilan favoritmu. ABC mengurus papannya.</div><button class="button primary full" data-action="close-dialog">Oke, siap main ${icon('check')}</button>`);
}
function profileDialog() {
  profileEditVersion = state.profile.version;
  state.avatar = state.profile.avatar;
  openDialog('Tetap jadi diri sendiri.', `<p class="dialog-description">Nama pilihanmu tetap tersimpan. Ganti nama tidak mengubah tim atau peranmu.</p><form id="profile-form" novalidate><label for="edit-name">Nama kamu</label><input id="edit-name" value="${esc(state.profile.name)}" autocomplete="nickname" maxlength="100" aria-describedby="profile-error" required><div class="avatar-label">Pilih avatar</div><div id="profile-avatars">${avatarPicker(state.avatar, true)}</div><p id="profile-error" class="form-error" role="alert"></p><div class="dialog-actions"><button class="button" type="button" data-action="close-dialog">Batal</button><button class="button primary" type="submit">Simpan nama ${icon('check')}</button></div></form>`);
  $('#edit-name').focus();
}
function playTone() { try { const Audio = window.AudioContext || window.webkitAudioContext; const context = new Audio(); const osc = context.createOscillator(), gain = context.createGain(); osc.type = 'sine'; osc.frequency.value = 620; gain.gain.setValueAtTime(0.035, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + .15); osc.connect(gain).connect(context.destination); osc.start(); osc.stop(context.currentTime + .16); osc.onended = () => context.close(); } catch {} }

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'home') { event.preventDefault(); if (state.room) confirmAction('Kembali ke beranda?', 'Tujuanmu beranda? Kamu akan keluar dari ruang ini. Kamu bisa bergabung kembali lewat tautannya.', 'Keluar ruang', () => runCommand('leave')); else leaveLocal(); }
  if (action === 'help') help();
  if (action === 'about') openDialog('ABC — Aku Butuh Code', `<p class="dialog-description">Ruang kecil untuk jeda yang berarti. Game tebak kata dua tim untuk teman-teman kantor.</p><p>Ilustrasi Open Peeps oleh Pablo Stanley (CC0). Ikon Lucide (ISC). Font DM Sans dan Space Grotesk (OFL). Dibuat sebagai game independen yang terinspirasi permainan asosiasi kata.</p><button class="button primary full" data-action="close-dialog">Kembali ke jeda</button>`);
  if (action === 'profile') profileDialog();
  if (action === 'dismiss-notice') clearNotice();
  if (action === 'close-dialog') dialog.close();
  if (action === 'confirm') { dialog.close(); await modalAction?.(); }
  if (action === 'entry-create' || action === 'entry-join') { state.mode = action === 'entry-create' ? 'create' : 'join'; state.code = ''; render(); }
  if (action === 'avatar') {
    state.avatar = Number(button.dataset.avatar);
    if (dialog.open) { $('#profile-avatars').innerHTML = avatarPicker(state.avatar, true); dialog.querySelector(`[data-avatar="${state.avatar}"]`)?.focus(); }
    else { render(); app.querySelector(`[data-avatar="${state.avatar}"]`)?.focus(); }
  }
  if (action === 'invite') {
    const link = `${location.origin}/r/${state.code}`;
    try { await navigator.clipboard.writeText(link); notice('Link undangan disalin. Kirim ke teman-temanmu!'); }
    catch { openDialog('Ajak circle-mu.', `<label for="invite-link">Salin link ini</label><input id="invite-link" readonly value="${esc(link)}"><p>Pilih dan salin link di atas untuk dibagikan.</p>`); $('#invite-link').select(); }
  }
  if (action === 'seat') await runCommand('seat', { team: button.dataset.team, role: button.dataset.role });
  if (action === 'spectate') await runCommand('seat', { team: null, role: 'guesser' });
  if (['start', 'rematch', 'lock'].includes(action)) await runCommand(action);
  if (action === 'leave') confirmAction('Sampai ketemu di ronde berikutnya?', 'Kamu akan keluar dari ruang ini. Tim dan peranmu tetap tersimpan jika kamu kembali selama pertandingan.', 'Keluar ruang', () => runCommand('leave'));
  if (action === 'kick') confirmAction('Keluarkan pemain?', 'Pemain ini tidak bisa bergabung kembali menggunakan sesi yang sama.', 'Keluarkan', () => runCommand('kick', { memberId: button.dataset.id }));
  if (action === 'abort') confirmAction('Hentikan pertandingan?', 'Ronde ini akan selesai tanpa pemenang dan semua kartu dibuka. Setelah itu kamu bisa menyiapkan ronde baru.', 'Hentikan', () => runCommand('abort'));
  if (action === 'end-turn') confirmAction('Akhiri giliran timmu?', 'Kesempatan menebak berikutnya beralih ke tim lawan.', 'Akhiri giliran', () => runCommand('end-turn'));
  if (action === 'card') { state.selected = Number(button.dataset.index); render(); announce(`${state.room.game.cards[state.selected].word} dipilih. Konfirmasi untuk membuka.`); }
  if (action === 'reveal' && state.selected !== null) { await runCommand('guess', { index: state.selected }); }
  if (action === 'sound') { state.sound = !state.sound; if (state.sound) playTone(); render(); }
});

document.addEventListener('submit', async event => {
  if (!['entry-form', 'profile-form', 'clue-form'].includes(event.target.id)) return;
  event.preventDefault();
  const form = event.target, submit = form.querySelector('[type="submit"]') || form.querySelector('button');
  if (submit.disabled) return;
  submit.disabled = true;
  try {
    if (form.id === 'entry-form') {
      $('#entry-error').textContent = ''; $('#player-name').removeAttribute('aria-invalid');
      const name = $('#player-name').value;
      if (name !== state.profile.name || state.avatar !== state.profile.avatar) {
        const result = await api('/me', { name, avatar: state.avatar, version: state.profile.version }, 'PATCH'); state.profile = result.profile;
      }
      if (!state.profile.name) throw new Error('Isi nama kamu dulu, ya.');
      if (state.code || state.mode === 'join') {
        const code = $('#room-code').value.trim().toUpperCase();
        if (!/^[A-Z2-9]{6}$/.test(code)) throw new Error('Isi 6 karakter kode ruang dari temanmu.');
        await enter(code);
      } else { const result = await api('/rooms', { title: $('#room-title').value.trim() }); await enter(result.code); }
    } else if (form.id === 'profile-form') {
      $('#profile-error').textContent = ''; $('#edit-name').removeAttribute('aria-invalid');
      const result = await api('/me', { name: $('#edit-name').value, avatar: state.avatar, version: profileEditVersion }, 'PATCH');
      state.profile = result.profile; dialog.close(); render();
      if (!state.room && $('#player-name')) $('#player-name').value = state.profile.name;
      await sync(); notice('Nama kamu sudah disimpan. Tetap kamu, di setiap ronde.');
    } else if (form.id === 'clue-form') await runCommand('clue', { word: $('#clue-word').value, count: Number($('#clue-count').value) });
  } catch (err) {
    const errorTarget = form.id === 'entry-form' ? $('#entry-error') : $('#profile-error');
    if (errorTarget) errorTarget.textContent = err.message; else notice(err.message);
    const input = form.querySelector('input'); if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
    if (err.code === 'profile_conflict') { const fresh = await api('/me'); state.profile = fresh.profile; state.csrf = fresh.csrf; profileEditVersion = fresh.profile.version; }
  } finally { if (submit.isConnected) submit.disabled = false; }
});
window.addEventListener('online', () => { if (state.room) connect(); });
window.addEventListener('offline', () => { state.online = false; if (state.room) render(); });
window.addEventListener('popstate', () => location.reload());
setInterval(() => { if (state.room && !document.hidden) sync(); }, 10000);
async function boot() {
  try {
    const result = await api('/me'); state.profile = result.profile; state.csrf = result.csrf; state.avatar = result.profile.avatar;
    render();
    if (state.code && state.profile.name) { const code = state.code; try { await enter(code); } catch (err) { notice(err.message); } }
  } catch (err) { app.innerHTML = `<main class="boot"><h1>ABC — Aku Butuh Code</h1><p>${esc(err.message)}</p><a class="button primary" href="/">Coba lagi</a></main>`; }
}
boot();
