#!/usr/bin/env python3
"""Check the Legends data with Stockfish and write legends.js.

  python -I tools/build_legends.py

- Bot opening lines and famous games must be legal.
- Games ending in "#" must end in checkmate; the others must end with the
  winner clearly ahead (the loser resigned).
- Course lines get the same check as build_content.py (your side's moves may
  not lose more than the course's slack).
- For every move of the legend in a famous game, records the other moves
  Stockfish rates about as good, so Guess the Move can give partial credit.
"""
import json
import os
import sys

import chess
import chess.engine

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from legends_src import COURSES, GAMES, LEGENDS  # noqa: E402

ENGINE = os.environ.get("STOCKFISH", "/usr/games/stockfish")
MATE = 100000
ALT_SLACK = 30   # cp: other moves this close to the master's count as good guesses


def cp(score):
    return score.score(mate_score=MATE)


def play(sans, where, problems):
    board, ucis = chess.Board(), []
    for san in sans.split():
        try:
            m = board.parse_san(san)
        except ValueError:
            problems.append(f"{where}: illegal {san} after {' '.join(x for x in sans.split()[:len(ucis)])}")
            return None, None
        ucis.append(m.uci())
        board.push(m)
    return board, ucis


def courses(engine, problems):
    out = []
    for course in COURSES:
        slack = course.get("slack", 70)
        notes = {}
        for line in course["lines"]:
            sans = []
            for san, note in line["moves"]:
                sans.append(san)
                if note:
                    notes.setdefault(" ".join(sans), note)
        lines = []
        for line in course["lines"]:
            board, sans, moves = chess.Board(), [], []
            for san, note in line["moves"]:
                try:
                    move = board.parse_san(san)
                except ValueError:
                    problems.append(f"{line['id']}: illegal {san}")
                    break
                sans.append(san)
                if (board.turn == chess.WHITE) == (course["side"] == "w"):
                    best = cp(engine.analyse(board, chess.engine.Limit(depth=16))["score"].pov(board.turn))
                    got = cp(engine.analyse(board, chess.engine.Limit(depth=16), root_moves=[move])["score"].pov(board.turn))
                    if best - got > slack and best < MATE - 100:
                        problems.append(f"{line['id']}: {san} loses {best - got}cp")
                moves.append({"san": board.san(move), "uci": move.uci(), "note": note or notes.get(" ".join(sans), "")})
                board.push(move)
            if (len(moves) % 2 == 1) != (course["side"] == "w"):
                problems.append(f"{line['id']}: should end on your own move")
            lines.append({"id": line["id"], "name": line["name"], "moves": moves})
        out.append({k: course[k] for k in ("id", "side", "title", "blurb", "legends")} | {"lines": lines})
    return out


def games(engine, problems):
    out = []
    for g in GAMES:
        board, ucis = play(g["moves"], g["id"], problems)
        if board is None:
            continue
        last = g["moves"].split()[-1]
        if last.endswith("#"):
            if not board.is_checkmate():
                problems.append(f"{g['id']}: should end in checkmate")
        else:
            winner = chess.WHITE if g["result"] == "1-0" else chess.BLACK
            ev = cp(engine.analyse(board, chess.engine.Limit(depth=16))["score"].pov(winner))
            if ev < 200:
                problems.append(f"{g['id']}: final position only {ev}cp for the winner")
        side = chess.WHITE if g["side"] == "w" else chess.BLACK
        replay, plies = chess.Board(), []
        for u in ucis:
            m = chess.Move.from_uci(u)
            entry = {"uci": u, "san": replay.san(m)}
            if replay.turn == side:
                scores = {}
                for lm in replay.legal_moves:
                    scores[lm] = cp(engine.analyse(replay, chess.engine.Limit(depth=11), root_moves=[lm])["score"].pov(replay.turn))
                master = scores[m]
                best = max(scores.values())
                bar = min(master, best) - ALT_SLACK if best < MATE - 100 else best
                entry["alts"] = [x.uci() for x, s in scores.items() if x != m and s >= bar]
                entry["best"] = max(scores, key=scores.get).uci()
            plies.append(entry)
            replay.push(m)
        for key, text in g["notes"].items():
            num, who = int(key[:-1]), key[-1]
            idx = (num - 1) * 2 + (0 if who == "w" else 1)
            if idx >= len(plies):
                problems.append(f"{g['id']}: note {key} past the end")
            else:
                print(f"  {g['id']} {key} {plies[idx]['san']}: {text[:60]}")
        item = {k: g[k] for k in ("id", "legend", "side", "title", "white", "black", "event", "year", "result", "intro", "notes")}
        item["plies"] = plies
        out.append(item)
        print(f"{g['id']}: {len(plies)} plies ok", file=sys.stderr)
    return out


if __name__ == "__main__":
    problems = []
    legends = []
    for lg in LEGENDS:
        books = {}
        for side in ("white", "black"):
            books[side] = []
            for line in lg[side]:
                _, ucis = play(line, f"{lg['id']} {side} book", problems)
                if ucis:
                    books[side].append(ucis)
        legends.append({k: lg[k] for k in ("id", "name", "years", "from", "tag", "style", "vec")} | books)
    with chess.engine.SimpleEngine.popen_uci(ENGINE) as engine:
        engine.configure({"Threads": 4, "Hash": 128})
        crs = courses(engine, problems)
        gms = games(engine, problems)
    for p in problems:
        print("PROBLEM:", p)
    with open(os.path.join(WEB, "legends.js"), "w") as fh:
        fh.write("window.BC_LEGENDS=" + json.dumps({"legends": legends, "courses": crs, "games": gms}, separators=(",", ":")) + ";\n")
    print(f"legends: {len(legends)}, courses: {len(crs)} ({sum(len(c['lines']) for c in crs)} lines), games: {len(gms)}; "
          f"legends.js {os.path.getsize(os.path.join(WEB, 'legends.js')) // 1024} KB")
    sys.exit(1 if problems else 0)
