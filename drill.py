#!/usr/bin/env python3
"""Drill the mistakes from your own games until you stop making them.

Each puzzle is a position where you went wrong. Find the move you missed.
Puzzles you solve twice in a row are retired; misses come back sooner.

Usage:  python drill.py            (10 puzzles)
        python drill.py -n 20
"""
import argparse
import json
import os
import random

import chess
import chess.engine

from review import PUZZLES, cp, find_engine

PIECES = dict(zip("KQRBNPkqrbnp", "♔♕♖♗♘♙♚♛♜♝♞♟"))


def show(board, flip):
    ranks = range(8) if flip else range(7, -1, -1)
    files = range(7, -1, -1) if flip else range(8)
    for r in ranks:
        row = []
        for f in files:
            p = board.piece_at(chess.square(f, r))
            row.append(PIECES[p.symbol()] if p else ("·" if (r + f) % 2 else " "))
        print(f" {r + 1} " + " ".join(row))
    print("   " + " ".join("abcdefgh"[f] for f in files))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", type=int, default=10)
    args = ap.parse_args()
    if not os.path.exists(PUZZLES):
        return print("No puzzles yet. Run review.py on some of your games first.")
    puzzles = [p for p in json.load(open(PUZZLES)) if p.get("streak", 0) < 2]
    if not puzzles:
        return print("All puzzles retired! Review more games to get new ones.")
    # Most-missed first, then random.
    puzzles.sort(key=lambda p: (-p.get("misses", 0), random.random()))

    score, done = 0, []
    try:
        drill(puzzles[:args.n], done)
    except (EOFError, KeyboardInterrupt):
        print("\nStopping early -- progress saved.")
    score = sum(ok for _, ok in done)

    everything = {q["fen"]: q for q in json.load(open(PUZZLES))}
    for p, _ in done:
        everything[p["fen"]] = p
    json.dump(list(everything.values()), open(PUZZLES, "w"), indent=1)
    print(f"\nScore: {score}/{len(done)}")


def drill(puzzles, done):
    with chess.engine.SimpleEngine.popen_uci(find_engine()) as engine:
        for i, p in enumerate(puzzles, 1):
            board = chess.Board(p["fen"])
            side = "White" if board.turn else "Black"
            print(f"\n--- Puzzle {i} ({p['game']}, move {p['move_no']}) -- {side} to move ---")
            print(f"In the game you played {p['played']}. Find something better.\n")
            show(board, flip=not board.turn)
            print("   (♔♕♖♗♘♙ = White, ♚♛♜♝♞♟ = Black)")
            ok, move = False, None
            for attempt in (1, 2):
                raw = input(f"\nYour move (e.g. Nf3, exd5, O-O) or 'hint'/'skip': ").strip()
                if raw == "skip":
                    break
                if raw == "hint":
                    print("  Hint: " + p["lesson"].split(".")[0].split(":")[0] + ".")
                    raw = input("  Your move: ").strip()
                try:
                    move = board.parse_san(raw)
                except ValueError:
                    print("  Not a legal move here.")
                    continue
                # Accept any move about as good as the engine's best, not only the exact one.
                if move.uci() == p["best_uci"]:
                    ok = True
                else:
                    lim = chess.engine.Limit(depth=12)
                    best = engine.analyse(board, lim, root_moves=[chess.Move.from_uci(p["best_uci"])])["score"]
                    mine = engine.analyse(board, lim, root_moves=[move])["score"]
                    ok = cp(best, board.turn) - cp(mine, board.turn) <= 60
                if ok:
                    break
                print("  Not quite." + (" One more try." if attempt == 1 else ""))
            if ok:
                p["streak"] = p.get("streak", 0) + 1
                also = "" if move.uci() == p["best_uci"] else f" (Stockfish's top pick was {p['best']}, also fine)"
                print(f"  Correct!{also}")
            else:
                p["streak"] = 0
                p["misses"] = p.get("misses", 0) + 1
                print(f"  Answer: {p['best']}. {p['lesson']}")
            done.append((p, ok))


if __name__ == "__main__":
    main()
