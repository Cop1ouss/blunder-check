# Blunder Check: Product Requirements

**Owner:** the repository owner (personal use)
**Status:** v1 built and tested; this document describes it and sets the rules for changes.

## 1. Summary

Blunder Check is a free chess coach that runs entirely in the browser and installs on an iPhone as a home-screen web app (a Progressive Web App). It reviews finished games with Stockfish, teaches openings and tactics, and lets the player learn from famous players. There is no server, no account and no cost.

## 2. Goal

Take the owner from a **136 to a 400** rating on chess.com by fixing the mistakes that decide games at that level: hanging pieces, missing free pieces, missing checkmates, weak opening habits.

Success looks like this:
- Every rated game gets reviewed, with no daily limit (chess.com's free plan allows one review a day).
- The number of "hung a piece" mistakes per game goes down over the weeks.
- Opening and lesson practice happens a few minutes every day.

## 3. Principles (non-negotiable)

1. **Fair play.** The app is for finished games and practice only. Never add anything that helps during a live game on another site: no overlays, no screen reading, no move suggestions for positions pasted mid-game. Every review screen keeps the fair-play note.
2. **Free.** No paid services, no API keys, no backend. Static files only.
3. **Private.** Games and progress stay on the device (`localStorage`). Nothing is uploaded.
4. **Offline.** After the first visit everything works without internet, including Stockfish.
5. **Beginner-first.** Plain language, short sentences, no jargon without explanation. Giving away material is always flagged, even in a position that is already won or lost.
6. **Correct chess content.** Every opening line, puzzle answer and famous game is checked with Stockfish at build time (see section 7). Never hand-edit content without re-running the checks.

## 4. Users and platform

- One user: a beginner (rated around 136 to 400) who plays on the chess.com iPhone app.
- Primary device: **iPhone 16 Pro Max, Safari, installed to the home screen**. Also works in desktop browsers.
- Must work at phone width (about 390px) with no sideways scrolling, in light and dark mode.

## 5. Features

### 5.1 Review (tab "Review")

The player pastes a PGN (chess.com app: open the game, then the magnifying glass, then **Options → Share → Copy**) and taps **Review**.

- Stockfish 17.1 analyses every position in the browser (Fast, Standard or Deep depth).
- Each move is classified like chess.com: Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, Miss, Blunder (plus Forced). Thresholds use the drop in winning chances (lichess formula); book moves come from the lichess opening list.
- Accuracy per player (lichess method), eval bar, clickable eval graph, opening name.
- **Coach** for every move: for good moves, what the move does (develops, castles, wins a piece, attacks, forks, saves a piece); for bad moves, why (hung a piece, allowed a fork, walked into mate, missed mate, missed a free piece) and the best line, with an arrow on the board.
- **Retry this move**: replay your own mistake and find a better move; any move about as good as the engine's is accepted.
- **Opening checklist** for your side: center pawn, queen out early, development by move 10, castling, same piece moved twice, early f-pawn push.
- **Legend match**: which famous player your game's style most resembled (from counts of captures, checks, trades, development and castling). Labeled "just for fun".
- **Recent reviews** saved on the device (most recent 12).

### 5.2 Openings (tab "Openings")

A repertoire trainer. The app plays the opponent's moves; the player plays their own.

- **Learn** mode shows the move with an arrow and a one-line note on the idea. **Practice** mode hides it; a hint appears after two wrong tries.
- Spaced repetition: a finished line comes back after 1, 3, 7, 14 and 30 days; a slip in practice moves it back a level.
- Starter repertoire: Italian Game and London System (White), 1...e5 and 1...d5 (Black), 19 lines including the traps beginners meet (Scholar's mate, Fried Liver, Legal's mate, Blackburne Shilling, copycat trap, Elephant trap).
- Legends' repertoires: Morphy's open games, Fischer's 1.e4, the Najdorf, Kasparov's King's Indian, Carlsen's Berlin, Karpov's Caro-Kann (18 lines).

### 5.3 Lessons (tab "Lessons")

- Principles: opening principles, the blunder check (three questions before every move).
- Tactics: take free pieces, forks.
- Checkmates: mate in one, back-rank mate, mate in two (the opponent's reply is played automatically).
- Endgame drills against Stockfish: ladder mate, queen mate, rook mate, each with a move limit; stalemate counts as a fail.
- **Your own mistakes**: positions from the player's reviewed games where they made a mistake or blunder.
- Each puzzle: hint (highlights the piece), show answer, explanation after solving. Progress is saved per puzzle.

### 5.4 Legends (tab "Legends")

Nine players: Morphy, Anderssen, Capablanca, Tal, Fischer, Karpov, Kasparov, Polgar, Carlsen.

- **Legend bots**: play a game against a bot that opens with that player's real openings, then picks among Stockfish's candidate moves with a bonus for moves that fit the player's style (attack, trades, development, king safety). Five strengths from about 400 to full strength (estimates). Take back, resign, and **Review this game** (sends the game to the Review tab). Results are saved per legend.
- **Guess the Move** through 8 famous games (Opera Game, Immortal, Evergreen, Game of the Century, Fischer–Spassky game 6, Kasparov's Immortal, Tal–Smyslov 1959, Carlsen–Ernst 2004): 10 points for the master's move, 5 for a move Stockfish rates as just as good, with notes at key moments.
- The UI must say the bots imitate openings and tendencies and are not the real players.

### 5.5 chess.com games, Insights and training

- **Your chess.com games** (Review tab): enter a chess.com username once; the app loads that player's **finished** games from chess.com's free public API (monthly archives only, which contain finished games). Tap a game to review it. Only standard chess is loaded. Fair-play note stays on the card.
- **Auto-review**: reviews the last 10 unreviewed games in the background at Fast depth, pausing while a review you started is running. Each review (automatic or manual) stores a compact game summary and adds your mistakes to Daily training.
- **Insights** tab: filter by time control; rating with a goal (default 400) and progress meter; rating chart with the goal line and a crosshair tooltip; results as White and Black (win/draw/loss bar in colorblind-safe blue/gray/orange); your openings with score and accuracy; from reviewed games: average accuracy, blunders and mistakes per game, accuracy chart, biggest leaks with links to lessons, when mistakes happen (opening, middlegame, endgame, low on time); how games end, with tips.
- **Daily training** (Lessons): your own mistakes with spaced repetition (1, 2, 4, 8, 16, 32 days); first-try solves move a position up a level, misses bring it back tomorrow; a daily streak.
- **Rated puzzles**: 364 engine-checked puzzles with estimated ratings (about 580 to 1530); an Elo-style puzzle rating.
- **Puzzle Rush**: 3 minutes, 3 strikes, puzzles get harder as you solve; best score saved.

### 5.6 App shell

- Installable: web app manifest, icons (white knight on blue), service worker that caches every file (about 9 MB, mostly the engine) so the app works offline.
- When a new version is published, an **Update** bar appears; tapping it switches to the new version.
- **Back up progress** downloads a JSON file; **Restore backup** loads it. Needed because progress lives only on the device.

## 6. Technical design

- **Static site**, no build tools or frameworks. Plain HTML, CSS and JavaScript (classic scripts, no modules).
- `docs/` is the published app (GitHub Pages serves it). It is **generated**: edit files in `web/`, then run `python3 web/tools/build_app.py`.
- `web/review.html`: markup and CSS for all four tabs. `web/js/shared.js` (board, engine wrapper, storage), `review.js`, `learn.js`, `legends.js`; `web/app/app.js` (installed-app extras).
- Data files (generated, do not hand-edit): `data.js` (opening book, piece images, sample game), `content.js` (courses, lessons, puzzles), `legends.js` (legends, their courses and famous games).
- Engine: `engine/stockfish-17.1-lite-single-*.js/.wasm` (single-threaded WebAssembly, runs without special server headers), fallback `engine/stockfish-10-asm.js` (pure JavaScript). Both run in a Web Worker and speak UCI. chess.js 0.10.3 handles rules and PGN.
- Storage: `localStorage` keys `bc.progress` (openings, lessons, legends, puzzle rating), `bc.history` (full reviews), `bc.username`, `bc.botLevel`, `bc.ccgames` (loaded chess.com games), `bc.summaries` (per-game summaries for Insights), `bc.trainer` (Daily training positions and days trained), `bc.goal`, `bc.insTc`, `bc.ccOpenings` (opening-name cache).
- `js/mygames.js`: chess.com import, auto-review queue, summaries and trainer storage (`BC.stats`). `js/insights.js`: the Insights tab. `puzzles.js`: the rated puzzle set. The same code also runs as a claude.ai artifact, where it syncs to the owner's account; in the installed app it stays local.

## 7. Content quality checks

Content is built by Python scripts in `web/tools/` with python-chess and a local Stockfish:

- `build_content.py`: opening lines must be legal; your side's moves may not lose more than 0.7 pawns against Stockfish (depth 16). Hand-written puzzles must have their answer among the moves Stockfish accepts. Tactics puzzles come from engine-played games and are kept only when Stockfish confirms the theme and a clear answer.
- `build_legends.py`: famous games must be legal; games ending in mate must end in checkmate, others must leave the winner clearly ahead; records alternative moves for Guess the Move.
- `build_data.py`: opening book (lichess chess-openings, CC0), piece images, sample game.
- `build_puzzles.py`: the rated puzzle set (same engine checks as the lesson puzzles, run in parallel), with ratings estimated from theme and difficulty.

A build that prints `PROBLEM:` lines must not be published.

## 8. Acceptance checks for any change

1. Serve `docs/` locally (`python3 -m http.server` in `docs/`) and open it at phone width.
2. No errors in the browser console.
3. Review: the sample game shows accuracy and a coach note on every move; a pasted PGN reviews to "Review complete."
4. Openings: a line can be learned to the end and shows "Line complete".
5. Lessons: a puzzle can be solved; a drill gets replies from Stockfish.
6. Legends: a bot game can be played and sent to Review; Guess the Move scores a game.
7. Offline: after one visit, turn the network off and reload; the app still loads and reviews a game.
8. No sideways scrolling at 390px wide; light and dark mode both readable.
9. If any file in `docs/` changed, `docs/sw.js` has a new version string (the build script does this).

## 9. Out of scope

- Anything usable during a live game on another site.
- Accounts, servers, sync between devices, paid services.
- App Store distribution (needs a $99/year Apple developer account and a Mac).
- Anything from chess.com other than the player's finished games and public ratings. No logins, no scraping, nothing from games in progress.

## 10. Licenses

The app ships Stockfish (GPLv3), so the project is GPLv3 (`LICENSE`). chess.js is BSD-2-Clause, the opening list is CC0, the cburnett pieces are GPLv2+. See `docs/NOTICE.md`. Keep these files and credits.
