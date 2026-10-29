# Instructions for Copilot

Read `PRD.md` first. It describes the app, its rules and the checks every change must pass.

## Repository layout

- `docs/`: the published app (GitHub Pages serves this folder). **Generated** by `web/tools/build_app.py`. Never edit it by hand; edit `web/` and rebuild.
- `web/`: app source. `review.html` (markup and CSS), `js/shared.js`, `js/review.js`, `js/learn.js`, `js/legends.js`, `js/mygames.js` (chess.com import, auto-review, stats), `js/insights.js`, `app/app.js` (installed-app extras).
- `web/data.js`, `web/content.js`, `web/legends.js`, `web/puzzles.js`: generated content. Rebuild with the scripts in `web/tools/`; never hand-edit.
- `web/engine/`: Stockfish and chess.js builds. **Do not modify** (GPLv3 binaries).
- `review.py`, `drill.py`: optional command-line tools (Python, python-chess, local Stockfish).

## Rules

- **Fair play first.** Never add features that help during a live game (overlays, screen reading, live move hints). The app is for finished games and practice.
- No frameworks, bundlers, npm dependencies or servers. Plain HTML, CSS and classic `<script>` files.
- Match the existing code style: small functions, `const` and arrow functions, the `BC` namespace for shared helpers, comments only where the reason isn't obvious.
- Colors come from the CSS variables on `:root`, with dark-mode values in both dark blocks. Keep the layout working at 390px wide.
- Wrap every `localStorage` access in try/catch (use `BC.local`).
- chess.com data comes only from the public API's monthly archives (finished games). Never fetch or show games in progress.
- Charts: one series per chart, thin marks, a legend when there are two or more series, text in text colors (never the series color), and a table or text alternative. Win/draw/loss uses the `--win`, `--draw`, `--loss` tokens (colorblind-safe).
- Write user-facing text plainly, for a beginner.
- Chess content changes (opening lines, puzzles, famous games) go through `web/tools/content_src.py` or `web/tools/legends_src.py` and must be rebuilt with `build_content.py` or `build_legends.py`, which check them with Stockfish. Don't publish a build that prints `PROBLEM:`.

## After changing anything in `web/`

```
cd web
python3 tools/build_app.py
```

This copies the app into `docs/` and gives `docs/sw.js` a new version, so installed copies get the **Update** bar.

## Checking a change

Run the acceptance checks in `PRD.md` section 8. Serve the app with `python3 -m http.server 8000` inside `docs/`, open http://localhost:8000/ at phone width, and confirm there are no console errors.
