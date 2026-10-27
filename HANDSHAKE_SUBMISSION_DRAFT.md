# SketchParty — Handshake AI Skills Studio submission draft

Paste-ready text for the "Create a Multiplayer Game" mission.
Safe deadline: October 30, 2026, 11:59 PM PT (official rules; the email says October 31).

## Title
SketchParty — Real-Time Multiplayer Drawing-Guess Game

## Description (paste into the mission)
SketchParty is a real-time multiplayer drawing-guess game. Players create a room, share a 4-letter code, and take turns drawing while everyone else guesses in chat — 60 seconds a turn, faster correct guesses score more, and the drawer earns points for each player who gets it.

Tournament mode adds an elimination bracket: everyone plays a full match, the lowest scorers are cut (half the field each match), and survivors play on until one champion is crowned; eliminated players stay in the room as spectators, with a bracket panel showing the current match and who is still in.

It also supports a PS5 DualSense controller via the Gamepad API: left stick moves the cursor, X draws, Square cycles colors, Triangle clears, and L1/R1 change brush size, with a controller badge and control list in-game when one is connected.

Built with Node.js + Express + WebSocket, vanilla JS canvas client, no build step and no database — rooms live in memory.

## Cover image
Use a gameplay screenshot showing a drawing in progress plus the bracket panel (tournament mode) — that shows both the core game and the differentiator in one image. A second shot with the DualSense badge visible is a good backup.

## Still needed before submitting
- [ ] Public hosted link (Render / Railway / Fly free tier — needs Joshua's account login; the game currently runs only locally via `npm start` at http://localhost:3000)
- [ ] Cover image (screenshot as above)
- [ ] Paste the title + description above into the Handshake mission and submit by Oct 30, 11:59 PM PT
