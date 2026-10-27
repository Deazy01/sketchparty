# SketchParty — multiplayer drawing & guessing game

Real-time multiplayer game built for Handshake's AI Skills Studio
"Create a Multiplayer Game" mission.

## How to play
1. `npm install && npm start`
2. Open http://localhost:3000 — create a room, share the 4-letter code.
3. With 2+ players, start the game. Each player draws once per round:
   the drawer picks a word and draws it, everyone else guesses in chat.
   Faster correct guesses score more; the drawer earns points per guesser.

## Tournament mode
Pick "Tournament (elimination bracket)" in the lobby (best with 4+
players). Everyone plays a match; after each match the lowest scorers
are eliminated (half the field, minimum one) and the survivors play the
next match, until one champion remains. Eliminated players stay in the
room as spectators. Bracket labels follow the field size
(Quarterfinal / Semifinal / Final).

## PS5 controller
Connect a DualSense controller and it just works via the Gamepad API:
left stick moves the cursor, X (Cross) draws, Square cycles colors,
Triangle clears the canvas, L1/R1 change brush size. A controller badge
and the controls appear in-game when one is connected.

## Standout mechanics
- **Word tiers:** the drawer picks from Easy (100 pts), Medium (200),
  Hard (300) — or a Custom word if the host added a word pack. Picking
  hard is a gamble: more points, harder to convey.
- **Streak multiplier:** consecutive correct guesses multiply points
  (×1, ×2, ×3), shown as a 🔥 flame next to the player's name.
  Missing a turn resets the streak.
- **Auto-hints:** at 1/3 and 2/3 of a turn, a letter of the word is
  revealed to guessers so games never stall.
- **Post-game stats + share card:** most correct guesses, fastest
  guess, best drawer — with a "Copy results" button for a paste-ready
  recap.
- **Custom word packs:** the host can add comma-separated words in the
  lobby (e.g. ESP32, LoRaWAN) for a themed game.
- **Juice:** WebAudio sound effects (guess chime, countdown ticks,
  fanfare), confetti bursts on correct guesses, and a mute toggle.

## Stack
Node.js + Express + ws (WebSocket). No build step, no database —
rooms live in memory. Vanilla JS canvas client.

## Submission checklist (Handshake mission)
- [ ] Public hosted link (deploy: Render/Railway/Fly free tier)
- [ ] Cover image (screenshot of gameplay)
- [ ] Title + description in the Handshake mission
