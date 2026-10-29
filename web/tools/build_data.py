#!/usr/bin/env python3
"""Build the data the review page embeds: opening book, piece art, sample game.

  python -I tools/build_data.py RAW_DIR

RAW_DIR holds openings/{a..e}.tsv (lichess-org/chess-openings, CC0) and
pieces/{w,b}{K,Q,R,B,N,P}.svg (cburnett set, GPLv2+). Writes data.js next to
review.src.html; build.py then inlines it.
"""
import base64
import json
import os
import random
import sys

import chess
import chess.engine
import chess.pgn

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.environ.get("STOCKFISH", "/usr/games/stockfish")


def key(board):
    """Same string the page builds from chess.js: placement, side, castling."""
    return " ".join(board.fen().split()[:3])


def fnv(s):
    h = 0x811C9DC5
    for b in s.encode():
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return format(h, "x")


def openings(raw):
    book, names = set(), {}
    for f in "abcde":
        with open(os.path.join(raw, "openings", f + ".tsv")) as fh:
            next(fh)
            for row in fh:
                eco, name, pgn = row.rstrip("\n").split("\t")
                board = chess.Board()
                for tok in pgn.split():
                    if tok[0].isdigit():
                        continue
                    board.push_san(tok)
                    book.add(fnv(key(board)))
                names.setdefault(fnv(key(board)), f"{eco} {name}")
    return {"book": ",".join(sorted(book)), "names": names}


def pieces(raw):
    out = {}
    for c in "wb":
        for p in "KQRBNP":
            svg = open(os.path.join(raw, "pieces", c + p + ".svg"), "rb").read()
            out[c + p] = "data:image/svg+xml;base64," + base64.b64encode(svg).decode()
    return out


def analyse(engine, board, depth):
    if board.is_game_over():
        return {"lines": [], "end": True}
    infos = engine.analyse(board, chess.engine.Limit(depth=depth), multipv=2)
    lines = []
    for info in infos:
        s = info["score"].white()
        line = {"uci": info["pv"][0].uci(), "pv": " ".join(m.uci() for m in info["pv"][:10])}
        if s.is_mate():
            line["mate"] = s.mate()
        else:
            line["cp"] = s.score()
        lines.append(line)
    return {"lines": lines, "depth": depth}


def play_sample(engine, seed):
    """A believable beginner game: mostly sensible moves, with the kind of slips
    a 150-300 player makes. Picks among the engine's top moves with noise."""
    rng = random.Random(seed)
    board = chess.Board()
    for san in "e4 e5 Nf3 Nc6 Bc4 Nf6".split():
        board.push_san(san)
    while not board.is_game_over() and board.fullmove_number < 40:
        infos = engine.analyse(board, chess.engine.Limit(depth=4), multipv=8)
        moves = [i["pv"][0] for i in infos]
        r = rng.random()
        if r < 0.55:
            move = moves[0]
        elif r < 0.85:
            move = rng.choice(moves[1:4] or moves)
        else:
            move = rng.choice(moves[3:] or moves)
        board.push(move)
    return board


def sample(depth):
    with chess.engine.SimpleEngine.popen_uci(ENGINE) as engine:
        best = None
        for seed in range(1, 60):
            board = play_sample(engine, seed)
            n = len(board.move_stack)
            if board.is_checkmate() and 34 <= n <= 70:
                best = (seed, board)
                break
        seed, board = best
        game = chess.pgn.Game.from_board(board)
        game.headers.update({"Event": "Sample game", "Site": "Blunder Check", "Date": "2026.10.26",
                             "White": "Sample White", "Black": "Sample Black",
                             "WhiteElo": "250", "BlackElo": "260", "TimeControl": "600"})
        replay = chess.Board()
        analysis = [analyse(engine, replay, depth)]
        for m in board.move_stack:
            replay.push(m)
            analysis.append(analyse(engine, replay, depth))
    pgn = str(game).split("\n\n", 1)
    return {"pgn": str(game), "analysis": analysis, "seed": seed}


if __name__ == "__main__":
    raw = sys.argv[1]
    data = {"openings": openings(raw), "pieces": pieces(raw), "sample": sample(depth=15)}
    with open(os.path.join(WEB, "data.js"), "w") as fh:
        fh.write("window.BC_DATA=" + json.dumps(data, separators=(",", ":")) + ";\n")
    o = data["openings"]
    print(f"book positions: {len(o['book'].split(','))}, named: {len(o['names'])}, "
          f"sample: seed {data['sample']['seed']}, {len(data['sample']['analysis']) - 1} plies")
    print(data["sample"]["pgn"])
    print(f"data.js: {os.path.getsize(os.path.join(WEB, 'data.js')) // 1024} KB")
