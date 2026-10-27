// SketchParty — real-time multiplayer drawing-guess game.
// Node + Express + ws. No database: rooms live in memory.
// Run: npm start (PORT env or 3000).

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const TURN_SECONDS = parseInt(process.env.TURN_SECONDS, 10) || 60;
const PICK_SECONDS = 10;
// Word tiers: the drawer picks a strategy, not just a word.
const EASY = ['cat', 'dog', 'pizza', 'banana', 'tree', 'book', 'chair', 'key', 'clock', 'bee', 'owl', 'ghost', 'tent', 'lamp', 'sun', 'fish', 'cake', 'ball', 'star', 'moon'];
const MEDIUM = ['elephant', 'penguin', 'giraffe', 'butterfly', 'guitar', 'rocket', 'camera', 'bicycle', 'umbrella', 'rainbow', 'beach', 'snowman', 'robot', 'pirate', 'dragon', 'sailboat', 'fireworks', 'kangaroo', 'snowflake', 'volcano', 'mountain', 'island', 'sunset', 'anchor', 'balloon', 'candle', 'glasses', 'backpack', 'scissors', 'lighthouse', 'waterfall', 'tornado', 'octopus', 'monkey', 'shark', 'rabbit', 'turtle', 'lion', 'snake', 'crab', 'popcorn', 'cupcake', 'burger', 'carrot', 'cheese', 'ice cream', 'magician', 'dancer'];
const HARD = ['superhero', 'spaceship', 'astronaut', 'helicopter', 'skyscraper', 'chandelier', 'saxophone', 'trampoline', 'windmill', 'submarine', 'telescope', 'bulldozer'];

const rooms = new Map(); // code -> room

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function pickWords(customWords = []) {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const choices = [
    { word: pick(EASY), tier: 'Easy', base: 100 },
    { word: pick(MEDIUM), tier: 'Medium', base: 200 },
    { word: pick(HARD), tier: 'Hard', base: 300 },
  ];
  // A host-supplied custom word replaces the medium slot when available.
  if (customWords.length) {
    choices[1] = { word: customWords[Math.floor(Math.random() * customWords.length)], tier: 'Custom', base: 200 };
  }
  return choices;
}

function wordPattern(room) {
  return [...room.word].map((ch, i) => (ch === ' ' || room.revealed.has(i) ? ch : '_')).join(' ');

}

function send(ws, type, data = {}) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data }));
}

function broadcast(room, type, data = {}) {
  for (const p of room.players.values()) send(p.ws, type, data);
}

function publicPlayers(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id, name: p.name, score: p.score, hasGuessed: p.hasGuessed, streak: p.streak || 0,
  }));
}

// Players still competing. In a tournament, eliminated players become spectators.
function activePlayers(room) {
  if (room.mode === 'tournament' && room.tourney && !room.tourney.champion) {
    return [...room.players.values()].filter((p) => room.tourney.alive.includes(p.id));
  }
  return [...room.players.values()];
}

function matchLabel(aliveCount) {
  if (aliveCount <= 2) return 'Final';
  if (aliveCount <= 4) return 'Semifinal';
  if (aliveCount <= 8) return 'Quarterfinal';
  return `Round of ${aliveCount}`;
}

// Reset the room back to an open lobby after a game or tournament ends.
function resetToLobby(room) {
  room.state = 'lobby';
  room.mode = 'casual';
  room.tourney = null;
  room.turnCount = 0;
  room.drawerIndex = 0;
  for (const p of room.players.values()) { p.score = 0; p.hasGuessed = false; p.streak = 0; p.correctCount = 0; p.fastest = null; p.drawerPoints = 0; }
  broadcast(room, 'playerList', { players: publicPlayers(room) });
}

function declareChampion(room, champion) {
  room.tourney.champion = champion.id;
  broadcast(room, 'tournamentEnd', {
    champion: champion.name, championId: champion.id,
    eliminated: room.tourney.eliminated,
  });
  resetToLobby(room);
}

// A full match (every active player has drawn) just ended.
function finishMatch(room) {
  const ranked = activePlayers(room)
    .map((p) => ({ id: p.id, name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
  // Post-game stats: most correct guesses, fastest guess, best drawer.
  const scorers = activePlayers(room);
  const mostCorrect = scorers.reduce((a, b) => (b.correctCount > (a.correctCount || 0) ? b : a), scorers[0]);
  const guessers = scorers.filter((p) => p.fastest !== null);
  const fastestGuesser = guessers.length ? guessers.reduce((a, b) => (b.fastest < a.fastest ? b : a)) : null;
  const bestDrawer = scorers.reduce((a, b) => (b.drawerPoints > (a.drawerPoints || 0) ? b : a), scorers[0]);
  broadcast(room, 'gameEnd', { players: ranked, stats: {
    mostCorrect: mostCorrect ? { name: mostCorrect.name, count: mostCorrect.correctCount } : null,
    fastestGuesser: fastestGuesser ? { name: fastestGuesser.name, seconds: fastestGuesser.fastest } : null,
    bestDrawer: bestDrawer ? { name: bestDrawer.name, points: bestDrawer.drawerPoints } : null,
  } });
  if (room.mode !== 'tournament') {
    resetToLobby(room);
    return;
  }
  const t = room.tourney;
  if (t.alive.length <= 2) {
    const champion = room.players.get(ranked[0].id);
    declareChampion(room, champion);
    return;
  }
  const elimCount = Math.max(1, Math.floor(t.alive.length / 2));
  const eliminated = ranked.slice(-elimCount);
  const advancing = ranked.slice(0, ranked.length - elimCount);
  t.eliminated.push(...eliminated.map((p) => ({ name: p.name, match: t.match })));
  t.alive = advancing.map((p) => p.id);
  t.match += 1;
  broadcast(room, 'tournamentUpdate', {
    match: t.match, label: matchLabel(t.alive.length),
    advancing: advancing.map((p) => p.name),
    eliminated: t.eliminated,
  });
  room.state = 'betweenMatches';
  setTimeout(() => {
    if (room.state === 'betweenMatches' && rooms.has(room.code) && room.tourney && !room.tourney.champion) {
      room.drawerIndex = 0;
      room.turnCount = 0;
      for (const p of room.players.values()) { p.score = 0; p.hasGuessed = false; p.streak = 0; p.correctCount = 0; p.fastest = null; p.drawerPoints = 0; }
      broadcast(room, 'gameStart', { players: publicPlayers(room), rounds: room.rounds, mode: 'tournament', match: t.match, label: matchLabel(t.alive.length) });
      startTurn(room);
    }
  }, 6000);
}

function clearTimers(room) {
  if (room.timer) clearInterval(room.timer);
  if (room.timeout) clearTimeout(room.timeout);
  if (room.hintTimeouts) room.hintTimeouts.forEach(clearTimeout);
  room.timer = null;
  room.timeout = null;
  room.hintTimeouts = [];
}

function endTurn(room, reason = 'time') {
  clearTimers(room);
  // Streaks survive only for players who guessed this turn (drawer excluded).
  for (const p of room.players.values()) {
    if (p.id !== room.drawerId && !p.hasGuessed) p.streak = 0;
  }
  const drawer = room.players.get(room.drawerId);
  broadcast(room, 'turnEnd', {
    word: room.word, drawer: drawer ? drawer.name : null, reason,
    players: publicPlayers(room),
  });
  room.drawerIndex += 1;
  room.turnCount += 1;
  if (room.turnCount >= activePlayers(room).length * room.rounds) {
    finishMatch(room);
    return;
  }
  setTimeout(() => startTurn(room), 4000);
}

function startTurn(room) {
  const players = activePlayers(room);
  if (players.length < 2) {
    if (room.mode === 'tournament' && room.tourney && players.length === 1) {
      declareChampion(room, players[0]);
      return;
    }
    room.state = 'lobby';
    broadcast(room, 'backToLobby', { players: publicPlayers(room), message: 'Need at least 2 players to keep playing.' });
    return;
  }
  room.state = 'playing';
  const drawer = players[room.drawerIndex % players.length];
  room.drawerId = drawer.id;
  room.word = null;
  room.wordBase = 100;
  room.revealed = new Set();
  room.choices = pickWords(room.customWords || []);
  room.guessedCount = 0;
  for (const p of players) p.hasGuessed = false;
  broadcast(room, 'canvasClear', {});
  send(drawer.ws, 'yourTurn', { choices: room.choices, pickSeconds: PICK_SECONDS });
  broadcast(room, 'turnStart', {
    drawer: drawer.name, drawerId: drawer.id, turnSeconds: TURN_SECONDS,
    players: publicPlayers(room),
  });
  // If the drawer does not pick in time, choose for them.
  room.timeout = setTimeout(() => {
    if (room.state === 'playing' && !room.word) {
      const choice = room.choices[Math.floor(Math.random() * room.choices.length)];
      room.word = choice.word;
      room.wordBase = choice.base;
      beginDrawing(room);
    }
  }, PICK_SECONDS * 1000);
}

function beginDrawing(room) {
  room.turnEndsAt = Date.now() + TURN_SECONDS * 1000;
  // Auto-hints: reveal one letter at 1/3 and 2/3 of the turn.
  room.hintTimeouts = [];
  for (const frac of [1 / 3, 2 / 3]) {
    room.hintTimeouts.push(setTimeout(() => {
      if (room.state !== 'playing' || !room.word) return;
      const hidden = [...room.word].map((_, i) => i).filter((i) => room.word[i] !== ' ' && !room.revealed.has(i));
      if (hidden.length > 1) room.revealed.add(hidden[Math.floor(Math.random() * hidden.length)]);
      broadcast(room, 'hint', { pattern: wordPattern(room) });
    }, Math.floor(TURN_SECONDS * frac) * 1000));
  }
  clearInterval(room.timer);
  room.timer = setInterval(() => {
    const left = Math.max(0, Math.ceil((room.turnEndsAt - Date.now()) / 1000));
    broadcast(room, 'tick', { secondsLeft: left });
    if (left <= 0) {
      clearInterval(room.timer);
      room.timer = null;
      endTurn(room, 'time');
    }
  }, 1000);
  const drawer = room.players.get(room.drawerId);
  send(drawer.ws, 'wordSet', { word: room.word });
  broadcast(room, 'drawingStarted', { drawer: drawer.name });
}

function handleGuess(room, player, text) {
  if (room.state !== 'playing' || !room.word) return;
  // Eliminated tournament players are spectators: they can chat, not score.
  if (room.mode === 'tournament' && room.tourney && !room.tourney.alive.includes(player.id)) {
    broadcast(room, 'chat', { from: player.name, text });
    return;
  }
  if (player.id === room.drawerId) {
    send(player.ws, 'chat', { from: 'System', text: 'The drawer cannot guess.' });
    return;
  }
  if (player.hasGuessed) {
    broadcast(room, 'chat', { from: player.name, text });
    return;
  }
  const guess = text.trim().toLowerCase();
  if (guess === room.word.toLowerCase()) {
    player.hasGuessed = true;
    const secondsLeft = Math.max(0, Math.ceil((room.turnEndsAt - Date.now()) / 1000));
    const timeBonus = Math.round((secondsLeft / TURN_SECONDS) * 100);
    player.streak = (player.streak || 0) + 1;
    const multiplier = Math.min(3, player.streak);
    const points = Math.round(((room.wordBase || 100) + timeBonus) * multiplier);
    player.score += points;
    player.correctCount = (player.correctCount || 0) + 1;
    const timeToGuess = TURN_SECONDS - secondsLeft;
    if (player.fastest === null || timeToGuess < player.fastest) player.fastest = timeToGuess;
    const drawer = room.players.get(room.drawerId);
    if (drawer) { drawer.score += 50; drawer.drawerPoints = (drawer.drawerPoints || 0) + 50; }
    room.guessedCount += 1;
    broadcast(room, 'correctGuess', {
      name: player.name, points, streak: player.streak, multiplier, players: publicPlayers(room),
    });
    // Everyone has guessed: end the turn early.
    const guessers = [...room.players.values()].filter((p) => p.id !== room.drawerId);
    if (guessers.every((p) => p.hasGuessed)) endTurn(room, 'allGuessed');
  } else {
    broadcast(room, 'chat', { from: player.name, text });
  }
}

wss.on('connection', (ws) => {
  let room = null;
  let player = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'create') {
      const code = makeCode();
      room = { code, players: new Map(), state: 'lobby', rounds: 2, drawerIndex: 0, turnCount: 0, timer: null, timeout: null, mode: 'casual', tourney: null };
      rooms.set(code, room);
      player = { id: Math.random().toString(36).slice(2, 9), name: String(msg.name || 'Player').slice(0, 20), ws, score: 0, hasGuessed: false, streak: 0, correctCount: 0, fastest: null, drawerPoints: 0 };
      room.players.set(player.id, player);
      send(ws, 'joined', { code, playerId: player.id, players: publicPlayers(room) });
      return;
    }

    if (msg.type === 'join') {
      room = rooms.get(String(msg.code || '').toUpperCase());
      if (!room) return send(ws, 'error', { message: 'Room not found. Check the code and try again.' });
      if (room.state === 'playing') return send(ws, 'error', { message: 'That game is already in progress. Wait for the next one.' });
      player = { id: Math.random().toString(36).slice(2, 9), name: String(msg.name || 'Player').slice(0, 20), ws, score: 0, hasGuessed: false, streak: 0, correctCount: 0, fastest: null, drawerPoints: 0 };
      room.players.set(player.id, player);
      send(ws, 'joined', { code: room.code, playerId: player.id, players: publicPlayers(room) });
      broadcast(room, 'playerList', { players: publicPlayers(room) });
      return;
    }

    if (!room || !player) return;

    if (msg.type === 'start') {
      if (room.state !== 'lobby') return;
      if (room.players.size < 2) return send(ws, 'error', { message: 'Need at least 2 players to start.' });
      room.rounds = Math.min(3, Math.max(1, parseInt(msg.rounds, 10) || 2));
      room.customWords = String(msg.customWords || '').split(',')
        .map((w) => w.trim()).filter((w) => w.length >= 1 && w.length <= 20).slice(0, 30);
      room.drawerIndex = 0;
      room.turnCount = 0;
      if (msg.mode === 'tournament') {
        room.mode = 'tournament';
        room.tourney = { match: 1, alive: [...room.players.keys()], eliminated: [], champion: null };
        broadcast(room, 'gameStart', { players: publicPlayers(room), rounds: room.rounds, mode: 'tournament', match: 1, label: matchLabel(room.tourney.alive.length) });
      } else {
        room.mode = 'casual';
        broadcast(room, 'gameStart', { players: publicPlayers(room), rounds: room.rounds, mode: 'casual' });
      }
      startTurn(room);
      return;
    }

    if (msg.type === 'pickWord') {
      if (player.id !== room.drawerId || room.word) return;
      const choice = (room.choices || []).find((c) => c.word === msg.word);
      if (!choice) return;
      clearTimeout(room.timeout);
      room.timeout = null;
      room.word = choice.word;
      room.wordBase = choice.base;
      beginDrawing(room);
      return;
    }

    if (msg.type === 'stroke' || msg.type === 'canvasClear') {
      if (player.id !== room.drawerId || room.state !== 'playing') return;
      for (const p of room.players.values()) {
        if (p.id !== player.id) send(p.ws, msg.type, msg.type === 'stroke' ? { stroke: msg.stroke } : {});
      }
      return;
    }

    if (msg.type === 'chat') {
      const text = String(msg.text || '').slice(0, 200);
      if (!text.trim()) return;
      if (room.state === 'playing' && room.word && player.id !== room.drawerId && !player.hasGuessed) {
        handleGuess(room, player, text);
      } else {
        broadcast(room, 'chat', { from: player.name, text });
      }
      return;
    }
  });

  ws.on('close', () => {
    if (!room || !player) return;
    const wasDrawer = room.drawerId === player.id;
    room.players.delete(player.id);
    if (room.players.size === 0) {
      clearTimers(room);
      rooms.delete(room.code);
      return;
    }
    // Tournament: a leaver drops out of the bracket.
    if (room.mode === 'tournament' && room.tourney && !room.tourney.champion) {
      room.tourney.alive = room.tourney.alive.filter((id) => id !== player.id);
      if (room.tourney.alive.length === 1) {
        clearTimers(room);
        const last = room.players.get(room.tourney.alive[0]);
        if (last) { declareChampion(room, last); return; }
      }
      if (room.tourney.alive.length === 0) {
        clearTimers(room);
        rooms.delete(room.code);
        return;
      }
    }
    broadcast(room, 'playerList', { players: publicPlayers(room) });
    if (room.state === 'playing' && wasDrawer) {
      broadcast(room, 'chat', { from: 'System', text: `${player.name} left — ending this turn.` });
      endTurn(room, 'drawerLeft');
    } else if (room.state === 'playing' && room.players.size < 2) {
      clearTimers(room);
      room.state = 'lobby';
      broadcast(room, 'backToLobby', { players: publicPlayers(room), message: 'Not enough players left — back to the lobby.' });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`SketchParty running on http://localhost:${PORT}`));
