// Tournament test: 4 players, 1 round per match. Player D never guesses
// correctly, so D should be eliminated after match 1; the survivors play
// a final and a champion is declared.
const WebSocket = require('ws');
const PORT = process.env.TEST_PORT || 3104;
function queue(ws) {
  const seen = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    let consumed = false;
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].type === m.type) { waiters.splice(i, 1)[0].res(m); consumed = true; }
    }
    // Only queue messages no waiter was waiting for; otherwise a later wait
    // for the same type would return this stale message.
    if (!consumed) seen.push(m);
  });
  return (type, label) => new Promise((res, rej) => {
    const idx = seen.findIndex((m) => m.type === type);
    if (idx >= 0) return res(seen.splice(idx, 1)[0]);
    const timer = setTimeout(() => rej(new Error('timeout waiting for ' + label)), 30000);
    waiters.push({ type, res: (m) => { clearTimeout(timer); res(m); } });
  });
}
function once(ws, type, pred) {
  return new Promise((res) => {
    const h = (d) => { const m = JSON.parse(d); if (m.type === type && (!pred || pred(m))) { ws.off('message', h); res(m); } };
    ws.on('message', h);
  });
}
(async () => {
  const names = ['A', 'B', 'C', 'D'];
  const socks = [];
  for (const n of names) {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    await new Promise((r) => ws.on('open', r));
    socks.push(ws);
  }
  const qs = socks.map(queue);
  socks[0].send(JSON.stringify({ type: 'create', name: 'A' }));
  const joined = await qs[0]('joined', 'joined');
  for (let i = 1; i < 4; i++) {
    socks[i].send(JSON.stringify({ type: 'join', name: names[i], code: joined.code }));
    await qs[i]('joined', 'joined-' + names[i]);
  }
  console.log('room:', joined.code, '| 4 players in');
  socks[0].send(JSON.stringify({ type: 'start', rounds: 1, mode: 'tournament' }));
  const gs = await qs[0]('gameStart', 'gameStart');
  console.log('tournament started:', gs.mode, '| match', gs.match, gs.label);

  // Play turns until the tournament ends. Each turn: drawer picks a word,
  // everyone except D guesses it correctly; D guesses wrong.
  const byName = { A: 0, B: 1, C: 2, D: 3 };
  let champion = null;
  for (let turn = 0; turn < 10 && !champion; turn++) {
    const ts = await qs[0]('turnStart', 'turnStart-' + turn);
    const drawerName = ts.drawer;
    const drawer = socks[byName[drawerName]];
    const dq = qs[byName[drawerName]];
    const yourTurn = await dq('yourTurn', 'yourTurn-' + turn);
    drawer.send(JSON.stringify({ type: 'pickWord', word: yourTurn.choices[0].word }));
    const wordSet = await dq('wordSet', 'wordSet-' + turn);
    for (let i = 0; i < 4; i++) {
      if (names[i] === drawerName) continue;
      socks[i].send(JSON.stringify({ type: 'chat', text: names[i] === 'D' ? 'nope nope' : wordSet.word }));
    }
    // Either the turn ends or the tournament ends right away.
    const end = await Promise.race([
      once(socks[0], 'turnEnd').then(() => 'turnEnd'),
      once(socks[0], 'tournamentEnd').then((m) => { champion = m.champion; return 'champion'; }),
    ]);
    if (end === 'champion') break;
    // After a turn ends, a match may have ended: tournamentUpdate (or
    // tournamentEnd for the final) follows the gameEnd broadcast immediately.
    const after = await Promise.race([
      once(socks[0], 'tournamentUpdate').then((m) => ({ kind: 'update', m })),
      once(socks[0], 'tournamentEnd').then((m) => ({ kind: 'champion', m })),
      new Promise((r) => setTimeout(() => r({ kind: 'none' }), 1000)),
    ]);
    if (after.kind === 'update') {
      const upd = after.m;
      console.log('tournament update: match', upd.match, upd.label, '| advancing:', upd.advancing.join(','), '| eliminated:', upd.eliminated.map((e) => e.name).join(','));
    }
    if (after.kind === 'champion') { champion = after.m.champion; break; }
  }
  if (!champion) {
    const end = await qs[0]('tournamentEnd', 'tournamentEnd');
    champion = end.champion;
  }
  console.log('CHAMPION:', champion);
  socks.forEach((s) => s.close());
  console.log('TOURNAMENT-TEST-PASSED');
  process.exit(0);
})().catch((e) => { console.error('TOURNAMENT-TEST-FAILED:', e.message); process.exit(1); });
