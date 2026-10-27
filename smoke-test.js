// Smoke test: create room, join, start, pick a word, wrong + right guesses.
// Uses a message queue per socket so messages arriving before a wait still count.
const WebSocket = require('ws');
const PORT = process.env.TEST_PORT || 3103;
function queue(ws) {
  const seen = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    let consumed = false;
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].type === m.type) { waiters.splice(i, 1)[0].res(m); consumed = true; }
    }
    if (!consumed) seen.push(m);
  });
  return (type, label) => new Promise((res, rej) => {
    const found = seen.find((m) => m.type === type);
    if (found) return res(found);
    const timer = setTimeout(() => rej(new Error('timeout waiting for ' + label)), 5000);
    waiters.push({ type, res: (m) => { clearTimeout(timer); res(m); } });
  });
}
(async () => {
  const a = new WebSocket(`ws://localhost:${PORT}`);
  const b = new WebSocket(`ws://localhost:${PORT}`);
  await Promise.all([new Promise(r => a.on('open', r)), new Promise(r => b.on('open', r))]);
  const wa = queue(a); const wb = queue(b);
  a.send(JSON.stringify({ type: 'create', name: 'Joshua' }));
  const joined = await wa('joined', 'joined-a');
  console.log('room:', joined.code);
  b.send(JSON.stringify({ type: 'join', name: 'Friend', code: joined.code }));
  await wb('joined', 'joined-b');
  console.log('second player joined');
  a.send(JSON.stringify({ type: 'start', rounds: 1 }));
  const turn = await wa('turnStart', 'turnStart');
  console.log('drawer:', turn.drawer);
  const yourTurn = await wa('yourTurn', 'yourTurn');
  console.log('choices:', yourTurn.choices.map((c) => `${c.word}(${c.tier}/${c.base})`).join(','));
  a.send(JSON.stringify({ type: 'pickWord', word: yourTurn.choices[0].word }));
  const wordSet = await wa('wordSet', 'wordSet');
  console.log('word:', wordSet.word);
  b.send(JSON.stringify({ type: 'chat', text: 'definitely not it' }));
  const chat = await wa('chat', 'chat-relay');
  console.log('wrong guess relayed:', chat.from, '-', chat.text);
  b.send(JSON.stringify({ type: 'chat', text: wordSet.word }));
  const correct = await wa('correctGuess', 'correctGuess');
  console.log('correct:', correct.name, '+', correct.points, '| scores:', correct.players.map(p => p.name + '=' + p.score).join(' '));
  a.close(); b.close();
  console.log('SMOKE-TEST-PASSED');
  process.exit(0);
})().catch((e) => { console.error('SMOKE-TEST-FAILED:', e.message); process.exit(1); });
