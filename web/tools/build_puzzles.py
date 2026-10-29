#!/usr/bin/env python3
"""Generate the rated puzzle set for Puzzles and Puzzle Rush, write puzzles.js.

  python -I tools/build_puzzles.py OPENINGS_DIR [--workers 4] [--scale 1.0]

Uses the same method as build_content.py: engine-played games with noise,
positions kept only when Stockfish confirms the theme and a clear answer.
Each puzzle gets an estimated rating from its theme and how many forcing
moves compete with the answer. Runs several engines in parallel.
"""
import argparse
import json
import multiprocessing as mp
import os
import random
import sys

import chess
import chess.engine

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import build_content as bc  # noqa: E402

TARGET = {"mate1": 80, "free": 80, "fork": 60, "save": 50, "backrank": 30, "mate2": 60}
BASE = {"mate1": 600, "free": 700, "save": 850, "backrank": 900, "fork": 1000, "mate2": 1250}


def rating(p):
    board = chess.Board(p["fen"])
    best = chess.Move.from_uci(p["best"])
    forcing = sum(1 for m in board.legal_moves if board.is_capture(m) or board.gives_check(m))
    r = BASE[p["theme"]] + min(200, 15 * max(0, forcing - 1))
    if not (board.is_capture(best) or board.gives_check(best)):
        r += 120  # quiet answers are harder to see
    if board.piece_at(best.from_square).piece_type == chess.KNIGHT:
        r += 40
    if len(p["accept"]) > 1 and p["theme"] not in ("mate2",):
        r -= 50
    return max(400, min(1700, r))


def worker(args):
    seed, wanted, openings_dir = args
    starts = bc.opening_starts(openings_dir)
    with chess.engine.SimpleEngine.popen_uci(bc.ENGINE) as engine:
        engine.configure({"Threads": 1, "Hash": 64})
        found = generate(engine, wanted, starts, seed)
    return [p for ps in found.values() for p in ps]


def generate(engine, wanted, starts, seed):
    """Like build_content.generate, with up to 3 puzzles per game and a game budget."""
    rng = random.Random(seed)
    found = {t: [] for t in wanted}
    seen = set()
    for games in range(1, 1500):
        if all(len(found[t]) >= n for t, n in wanted.items()):
            break
        game = bc.noisy_game(engine, rng, rng.choice(starts))
        replay = chess.Board()
        per_game = 0
        for move in game.move_stack:
            if replay.ply() >= 10 and per_game < 3 and not replay.is_check() and replay.fen() not in seen:
                if abs(bc.material(replay, chess.WHITE) - bc.material(replay, chess.BLACK)) <= 5:
                    infos = engine.analyse(replay, chess.engine.Limit(depth=10), multipv=2)
                    t = bc.theme_of(replay, infos)
                    if t in wanted and len(found[t]) < wanted[t]:
                        p = bc.refine(engine, replay, t, move_played=move, last=replay.peek())
                        if p:
                            found[t].append(p)
                            seen.add(replay.fen())
                            per_game += 1
            replay.push(move)
        if games % 25 == 0:
            print(f"  seed {seed} game {games}: " + ", ".join(f"{t} {len(v)}/{wanted[t]}" for t, v in found.items()),
                  file=sys.stderr, flush=True)
    return found


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("openings")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--scale", type=float, default=1.0)
    a = ap.parse_args()
    per = {t: max(1, round(n * a.scale / a.workers + 0.49)) for t, n in TARGET.items()}
    jobs = [(1000 + i, per, a.openings) for i in range(a.workers)]
    with mp.Pool(a.workers) as pool:
        results = pool.map(worker, jobs)
    used = set()
    content = open(os.path.join(WEB, "content.js")).read()
    for lesson in json.loads(content[len("window.BC_CONTENT="):-2])["lessons"]:
        for p in lesson.get("puzzles", []):
            used.add(p["fen"])
    puzzles, seen = [], set()
    for p in (p for r in results for p in r):
        if p["fen"] in seen or p["fen"] in used:
            continue
        seen.add(p["fen"])
        p["rating"] = rating(p)
        puzzles.append(p)
    puzzles.sort(key=lambda p: p["rating"])
    for i, p in enumerate(puzzles):
        p["id"] = f"p{i + 1}"
    with open(os.path.join(WEB, "puzzles.js"), "w") as fh:
        fh.write("window.BC_PUZZLES=" + json.dumps(puzzles, separators=(",", ":")) + ";\n")
    counts = {}
    for p in puzzles:
        counts[p["theme"]] = counts.get(p["theme"], 0) + 1
    print(f"puzzles: {len(puzzles)} {counts}; ratings {puzzles[0]['rating']}-{puzzles[-1]['rating']}; "
          f"puzzles.js {os.path.getsize(os.path.join(WEB, 'puzzles.js')) // 1024} KB")
