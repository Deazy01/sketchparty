// SketchParty client: lobby, canvas drawing, guesses, scoring display.
const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
let myId = null, myRoom = null, isDrawer = false, drawing = false, last = null;
let tournamentMode = false;

const $ = (id) => document.getElementById(id);
const canvas = $('canvas'), ctx = canvas.getContext('2d');
ctx.lineCap = 'round'; ctx.lineJoin = 'round';

function show(el, yes) { $(el).classList.toggle('hidden', !yes); }
function addChat(text, cls = '') {
  const li = document.createElement('li');
  li.textContent = text;
  if (cls) li.className = cls;
  $('chat').appendChild(li);
  $('chat').scrollTop = $('chat').scrollHeight;
}
function renderPlayers(players, drawerId) {
  $('players').innerHTML = players.map((p) =>
    `<li class="${p.id === drawerId ? 'drawer' : ''} ${p.hasGuessed ? 'guessed' : ''}">${p.name} — ${p.score} pts${p.hasGuessed ? ' ✓' : ''}${p.streak >= 2 ? ` <span class="streak">🔥×${Math.min(3, p.streak)}</span>` : ''}</li>`).join('');
  $('lobbyPlayers').innerHTML = players.map((p) => `<li>${p.name}</li>`).join('');
}

// ---- Sounds (WebAudio, no assets) + confetti ----
let audioCtx = null, muted = false;
function tone(freq, dur, type = 'sine', delay = 0) {
  if (muted) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.15, audioCtx.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + delay + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(audioCtx.currentTime + delay); o.stop(audioCtx.currentTime + delay + dur);
  } catch { /* audio unavailable: stay silent */ }
}
$('muteBtn').onclick = () => { muted = !muted; $('muteBtn').textContent = muted ? '🔇' : '🔊'; };

const fx = $('fxCanvas'), fxCtx = fx.getContext('2d');
let particles = [], fxRunning = false;
function resizeFx() { fx.width = innerWidth; fx.height = innerHeight; }
addEventListener('resize', resizeFx); resizeFx();
function confettiBurst(n = 70) {
  for (let i = 0; i < n; i++) {
    particles.push({ x: innerWidth / 2 + (Math.random() - 0.5) * 200, y: 120, vx: (Math.random() - 0.5) * 10, vy: Math.random() * -8 - 2, size: 5 + Math.random() * 6, color: ['#e74c3c', '#3498db', '#27ae60', '#f39c12', '#9b59b6'][i % 5], life: 90 + Math.random() * 40 });
  }
  if (!fxRunning) { fxRunning = true; requestAnimationFrame(fxLoop); }
}
function fxLoop() {
  fxCtx.clearRect(0, 0, fx.width, fx.height);
  particles = particles.filter((p) => p.life > 0);
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy; p.vy += 0.25; p.life--;
    fxCtx.fillStyle = p.color;
    fxCtx.fillRect(p.x, p.y, p.size, p.size * 0.6);
  }
  if (particles.length) requestAnimationFrame(fxLoop);
  else { fxRunning = false; fxCtx.clearRect(0, 0, fx.width, fx.height); }
}

// Shareable results card (plain text, easy to paste anywhere).
function copyResults(title, lines) {
  const text = `🎨 SketchParty — ${title}\n${lines.join('\n')}\nPlay it: ${location.href}`;
  const done = () => { const b = $('copyBtn'); if (b) b.textContent = 'Copied!'; };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done).catch(() => {});
  else { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); }
}
function drawStroke(s) {
  ctx.strokeStyle = s.color; ctx.lineWidth = s.size;
  ctx.beginPath(); ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x1, s.y1); ctx.stroke();
}
function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  const t = e.touches ? e.touches[0] : e;
  return { x: (t.clientX - r.left) * (canvas.width / r.width), y: (t.clientY - r.top) * (canvas.height / r.height) };
}

canvas.addEventListener('pointerdown', (e) => {
  if (!isDrawer) return;
  drawing = true; last = canvasPos(e); canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drawing || !isDrawer) return;
  const p = canvasPos(e);
  const stroke = { x0: last.x, y0: last.y, x1: p.x, y1: p.y, color: $('colorPicker').value, size: +$('brushSize').value };
  drawStroke(stroke);
  ws.send(JSON.stringify({ type: 'stroke', stroke }));
  last = p;
});
for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { drawing = false; });

$('eraserBtn').onclick = () => { $('colorPicker').value = '#ffffff'; };
$('clearBtn').onclick = () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ws.send(JSON.stringify({ type: 'canvasClear' }));
};

function sendChat() {
  const text = $('chatInput').value.trim();
  if (!text) return;
  ws.send(JSON.stringify({ type: 'chat', text }));
  $('chatInput').value = '';
}
$('sendBtn').onclick = sendChat;
$('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

$('createBtn').onclick = () => {
  const name = $('nameInput').value.trim();
  if (!name) return $('lobbyError').textContent = 'Enter your name first.';
  ws.send(JSON.stringify({ type: 'create', name }));
};
$('joinBtn').onclick = () => {
  const name = $('nameInput').value.trim();
  const code = $('codeInput').value.trim().toUpperCase();
  if (!name || !code) return $('lobbyError').textContent = 'Enter your name and a room code.';
  ws.send(JSON.stringify({ type: 'join', name, code }));
};
$('startBtn').onclick = () => ws.send(JSON.stringify({ type: 'start', rounds: $('roundsSelect').value, mode: $('modeSelect').value, customWords: $('customWords').value }));

// ---- PS5 DualSense support (Gamepad API) ----
// Left stick moves a cursor, X draws, Square cycles colors, Triangle clears, L1/R1 resize the brush.
const GP_COLORS = ['#222222', '#e74c3c', '#3498db', '#27ae60', '#f39c12', '#9b59b6', '#e91e63'];
let gpIndex = null, gpColorIdx = 0, gpPrev = {};
let gpCursor = { x: 320, y: 210 }, gpLastDraw = null;
function gpMoveCursor() {
  $('gpCursor').style.left = (gpCursor.x / 640 * 100) + '%';
  $('gpCursor').style.top = (gpCursor.y / 420 * 100) + '%';
}
window.addEventListener('gamepadconnected', (e) => {
  gpIndex = e.gamepad.index;
  $('gpStatus').textContent = '🎮 Controller connected';
  show('gpHelp', true); show('gpCursor', true);
  gpMoveCursor();
  requestAnimationFrame(gpLoop);
});
window.addEventListener('gamepaddisconnected', () => {
  gpIndex = null;
  $('gpStatus').textContent = '';
  show('gpHelp', false); show('gpCursor', false);
});
function gpPressed(gp, i) { return !!(gp.buttons[i] && gp.buttons[i].pressed); }
function gpLoop() {
  if (gpIndex === null) return;
  const gp = navigator.getGamepads()[gpIndex];
  if (gp) {
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    if (Math.abs(ax) > 0.15 || Math.abs(ay) > 0.15) {
      gpCursor.x = Math.max(0, Math.min(640, gpCursor.x + ax * 9));
      gpCursor.y = Math.max(0, Math.min(420, gpCursor.y + ay * 9));
      gpMoveCursor();
    }
    if (gpPressed(gp, 0) && isDrawer) {
      const p = { ...gpCursor };
      if (gpLastDraw) {
        const stroke = { x0: gpLastDraw.x, y0: gpLastDraw.y, x1: p.x, y1: p.y, color: $('colorPicker').value, size: +$('brushSize').value };
        drawStroke(stroke);
        ws.send(JSON.stringify({ type: 'stroke', stroke }));
      }
      gpLastDraw = p;
    } else {
      gpLastDraw = null;
    }
    // Edge-triggered buttons: Square cycles color, Triangle clears, L1/R1 brush size.
    const edge = (i) => gpPressed(gp, i) && !gpPrev[i];
    if (edge(2)) { gpColorIdx = (gpColorIdx + 1) % GP_COLORS.length; $('colorPicker').value = GP_COLORS[gpColorIdx]; }
    if (edge(3) && isDrawer) { ctx.clearRect(0, 0, canvas.width, canvas.height); ws.send(JSON.stringify({ type: 'canvasClear' })); }
    if (edge(4)) $('brushSize').value = Math.max(2, +$('brushSize').value - 2);
    if (edge(5)) $('brushSize').value = Math.min(24, +$('brushSize').value + 2);
    gpPrev = { 2: gpPressed(gp, 2), 3: gpPressed(gp, 3), 4: gpPressed(gp, 4), 5: gpPressed(gp, 5) };
  }
  requestAnimationFrame(gpLoop);
}

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.type === 'error') { $('lobbyError').textContent = m.message; return; }
  if (m.type === 'joined') {
    myId = m.playerId; myRoom = m.code;
    $('roomCode').textContent = m.code;
    show('roomInfo', true);
    renderPlayers(m.players);
    return;
  }
  if (m.type === 'playerList') { renderPlayers(m.players); return; }
  if (m.type === 'gameStart') {
    tournamentMode = m.mode === 'tournament';
    tone(520, 0.15); tone(780, 0.2, 'sine', 0.12);
    show('lobby', false); show('game', true);
    show('bracket', tournamentMode);
    if (tournamentMode) {
      $('bracketMatch').textContent = `Match ${m.match} — ${m.label}`;
      $('bracketAlive').textContent = m.players.map((p) => p.name).join(', ');
      $('bracketOut').textContent = '—';
      addChat(`🏆 Tournament started — Match 1 (${m.label}). Lowest scorers are eliminated each match!`, 'system');
    } else {
      addChat(`Game started — ${m.rounds} round(s).`, 'system');
    }
    return;
  }
  if (m.type === 'tournamentUpdate') {
    $('bracketMatch').textContent = `Match ${m.match} — ${m.label}`;
    $('bracketAlive').textContent = m.advancing.join(', ');
    $('bracketOut').textContent = m.eliminated.map((e) => `${e.name} (Match ${e.match})`).join(', ');
    addChat(`🏆 Match over! Advancing: ${m.advancing.join(', ')}. Eliminated: ${m.eliminated.map((e) => e.name).join(', ')}. Next match starts shortly…`, 'system');
    return;
  }
  if (m.type === 'tournamentEnd') {
    $('banner').innerHTML = `👑 Tournament champion: <strong>${m.champion}</strong>!<br><button id="copyBtn">Copy results</button>`;
    show('banner', true);
    $('turnInfo').textContent = 'Tournament over — start a new game from the lobby.';
    $('copyBtn').onclick = () => copyResults('Tournament champion: ' + m.champion, [`👑 Champion: ${m.champion}`]);
    tone(523, 0.15); tone(659, 0.15, 'sine', 0.15); tone(784, 0.3, 'sine', 0.3);
    confettiBurst(150);
    addChat(`👑 ${m.champion} wins the tournament!`, 'system');
    return;
  }
  if (m.type === 'turnStart') {
    isDrawer = m.drawerId === myId;
    show('tools', isDrawer);
    $('turnInfo').textContent = isDrawer ? 'You are drawing!' : `${m.drawer} is drawing…`;
    $('hint').textContent = '';
    $('timer').textContent = `⏱ ${m.turnSeconds}`;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderPlayers(m.players, m.drawerId);
    show('banner', false);
    return;
  }
  if (m.type === 'yourTurn') {
    show('wordChoices', true);
    $('choices').innerHTML = m.choices.map((c) => `<button data-w="${c.word}">${c.word}<span class="tier ${c.tier}">${c.tier} · ${c.base} pts</span></button>`).join('');
    $('choices').querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        ws.send(JSON.stringify({ type: 'pickWord', word: b.dataset.w }));
        show('wordChoices', false);
      };
    });
    return;
  }
  if (m.type === 'hint') {
    $('hint').textContent = `Hint: ${m.pattern}`;
    return;
  }
  if (m.type === 'wordSet') {
    $('turnInfo').textContent = `Draw: ${m.word}`;
    return;
  }
  if (m.type === 'drawingStarted') { addChat(`${m.drawer} is drawing…`, 'system'); return; }
  if (m.type === 'tick') {
    $('timer').textContent = `⏱ ${m.secondsLeft}`;
    if (m.secondsLeft <= 5 && m.secondsLeft > 0) tone(880, 0.08, 'square');
    return;
  }
  if (m.type === 'stroke') { drawStroke(m.stroke); return; }
  if (m.type === 'canvasClear') { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
  if (m.type === 'chat') { addChat(`${m.from}: ${m.text}`); return; }
  if (m.type === 'correctGuess') {
    addChat(`🎉 ${m.name} guessed it! (+${m.points}${m.multiplier > 1 ? `, 🔥 streak ×${m.multiplier}` : ''})`, 'correct');
    tone(660, 0.12); tone(880, 0.18, 'sine', 0.1);
    confettiBurst(60);
    renderPlayers(m.players);
    return;
  }
  if (m.type === 'turnEnd') {
    isDrawer = false; show('tools', false); show('wordChoices', false);
    $('banner').innerHTML = `The word was <strong>${m.word}</strong> (drawn by ${m.drawer}). Next turn in a few seconds…`;
    show('banner', true);
    renderPlayers(m.players);
    return;
  }
  if (m.type === 'gameEnd') {
    const lines = m.players.map((p, i) => `${i + 1}. ${p.name} — ${p.score} pts`).join('<br>');
    const s = m.stats || {};
    const statLines = [
      s.mostCorrect ? `🎯 Most correct guesses: ${s.mostCorrect.name} (${s.mostCorrect.count})` : null,
      s.fastestGuesser ? `⚡ Fastest guess: ${s.fastestGuesser.name} (${s.fastestGuesser.seconds}s)` : null,
      s.bestDrawer ? `🎨 Best drawer: ${s.bestDrawer.name} (+${s.bestDrawer.points} from guessers)` : null,
    ].filter(Boolean).join('<br>');
    const head = tournamentMode ? 'Match over!' : '🏆 Game over!';
    $('banner').innerHTML = `${head}<br>${lines}${statLines ? `<br>${statLines}` : ''}<br><button id="copyBtn">Copy results</button>`;
    if (!tournamentMode) $('turnInfo').textContent = 'Game over — start a new game from the lobby.';
    show('banner', true);
    $('copyBtn').onclick = () => copyResults(head.replace('🏆 ', ''), [
      ...m.players.map((p, i) => `${i + 1}. ${p.name} — ${p.score} pts`),
      ...(s.mostCorrect ? [`🎯 Most correct: ${s.mostCorrect.name} (${s.mostCorrect.count})`] : []),
      ...(s.fastestGuesser ? [`⚡ Fastest guess: ${s.fastestGuesser.name} (${s.fastestGuesser.seconds}s)`] : []),
      ...(s.bestDrawer ? [`🎨 Best drawer: ${s.bestDrawer.name}`] : []),
    ]);
    return;
  }
  if (m.type === 'backToLobby') {
    tournamentMode = false;
    show('game', false); show('lobby', true); show('bracket', false);
    $('lobbyError').textContent = m.message;
    renderPlayers(m.players);
    return;
  }
};
