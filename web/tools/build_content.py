#!/usr/bin/env python3
"""Check the Openings and Lessons content with Stockfish and write content.js.

  python -I tools/build_content.py OPENINGS_DIR

- Every course line must be legal, and none of your side's moves may lose
  more than LINE_SLACK centipawns against Stockfish's choice.
- Hand-written puzzles must have their intended move among the moves
  Stockfish accepts.
- Themed puzzles (free piece, fork, mate...) come from engine-played games
  with noise, kept only when Stockfish confirms the theme and the answer is
  clear. OPENINGS_DIR holds the lichess {a..e}.tsv files used to vary the
  openings of those games.
"""
import json
import os
import random
import sys

import chess
import chess.engine

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from content_src import COURSES, LESSONS  # noqa: E402

ENGINE = os.environ.get("STOCKFISH", "/usr/games/stockfish")
VAL = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 100}
LINE_SLACK = 70        # cp a repertoire move may lose against the engine's best
ACCEPT = 50            # cp: puzzle answers within this of the best are accepted
MATE = 100000


def cp(score):
    return score.score(mate_score=MATE)


def move_scores(engine, board, depth):
    """Score every legal move from the mover's point of view."""
    out = {}
    for m in board.legal_moves:
        info = engine.analyse(board, chess.engine.Limit(depth=depth), root_moves=[m])
        out[m] = info["score"].pov(board.turn)
    return out


def accepted(scores):
    best = max(cp(s) for s in scores.values())
    if best > MATE - 100:  # mate: accept any move that keeps a mate at least as fast
        return [m for m, s in scores.items() if cp(s) >= best]
    return [m for m, s in scores.items() if cp(s) >= best - ACCEPT]


# ---------- courses ----------
def build_courses(engine):
    problems, out = [], []
    for course in COURSES:
        notes_by_prefix = {}
        for line in course["lines"]:
            sans = []
            for san, note in line["moves"]:
                sans.append(san)
                if note:
                    notes_by_prefix.setdefault(" ".join(sans), note)
        lines = []
        for line in course["lines"]:
            board, sans, moves = chess.Board(), [], []
            for san, note in line["moves"]:
                try:
                    move = board.parse_san(san)
                except ValueError:
                    problems.append(f"{line['id']}: illegal {san} after {' '.join(sans)}")
                    break
                sans.append(san)
                mine = (board.turn == chess.WHITE) == (course["side"] == "w")
                if mine:
                    info = engine.analyse(board, chess.engine.Limit(depth=16), multipv=1)
                    best = cp(info[0]["score"].pov(board.turn))
                    got = cp(engine.analyse(board, chess.engine.Limit(depth=16), root_moves=[move])["score"].pov(board.turn))
                    if best - got > LINE_SLACK and best < MATE - 100:
                        problems.append(f"{line['id']}: {san} loses {best - got}cp (best {board.san(info[0]['pv'][0])})")
                note = note or notes_by_prefix.get(" ".join(sans), "")
                moves.append({"san": board.san(move), "uci": move.uci(), "note": note})
                board.push(move)
            last_mine = (len(moves) % 2 == 1) == (course["side"] == "w")
            if not last_mine:
                problems.append(f"{line['id']}: should end on your own move")
            lines.append({"id": line["id"], "name": line["name"], "moves": moves})
        out.append({k: course[k] for k in ("id", "side", "title", "blurb")} | {"lines": lines})
    return out, problems


# ---------- themed puzzle generation ----------
def material(board, color):
    return sum(VAL[p.piece_type] for p in board.piece_map().values() if p.color == color and p.piece_type != chess.KING)


def is_free(board, move):
    victim = board.piece_at(move.to_square)
    if victim is None:
        return False
    attacker = board.piece_at(move.from_square)
    defended = bool(board.attackers(victim.color, move.to_square))
    return not defended or VAL[victim.piece_type] > VAL[attacker.piece_type]


def fork_targets(board, move):
    """Enemy pieces the moved piece hits after the move: the king, bigger pieces, or unprotected ones."""
    after = board.copy()
    after.push(move)
    piece = after.piece_at(move.to_square)
    hits = []
    for sq in after.attacks(move.to_square):
        p = after.piece_at(sq)
        if p and p.color != piece.color and p.piece_type != chess.PAWN and (
                p.piece_type == chess.KING or VAL[p.piece_type] > VAL[piece.piece_type]
                or not after.attackers(p.color, sq)):
            hits.append(sq)
    return hits


def in_danger(board, sq):
    p = board.piece_at(sq)
    enemies = board.attackers(not p.color, sq)
    if not enemies:
        return False
    if not board.attackers(p.color, sq):
        return True
    return min(VAL[board.piece_at(a).piece_type] for a in enemies) < VAL[p.piece_type]


def theme_of(board, infos):
    best = infos[0]
    s1 = best["score"].pov(board.turn)
    move = best["pv"][0]
    if s1.is_mate() and s1.mate() == 1:
        after = board.copy()
        after.push(move)
        king = after.king(after.turn)
        mover = after.piece_at(move.to_square)
        edge = 0 if after.turn == chess.WHITE else 7
        if (chess.square_rank(king) == edge and mover.piece_type in (chess.ROOK, chess.QUEEN)
                and chess.square_rank(move.to_square) == edge):
            return "backrank"
        return "mate1"
    if s1.is_mate() and s1.mate() == 2:
        return "mate2"
    if s1.is_mate() or len(infos) < 2:
        return None
    gap = cp(s1) - cp(infos[1]["score"].pov(board.turn))
    if gap < 200 or not -150 <= cp(s1) <= 1500:
        return None
    if board.is_capture(move) and board.piece_at(move.to_square) and \
            VAL[board.piece_at(move.to_square).piece_type] >= 3 and is_free(board, move):
        return "free"
    victim = board.piece_at(move.to_square)
    if len(fork_targets(board, move)) >= 2 and not (victim and VAL[victim.piece_type] >= 3):
        return "fork"
    mover = board.piece_at(move.from_square)
    if not board.is_capture(move) and VAL[mover.piece_type] >= 3 and mover.piece_type != chess.KING \
            and in_danger(board, move.from_square):
        return "save"
    return None


def opening_starts(path):
    starts = []
    for f in "abcde":
        with open(os.path.join(path, f + ".tsv")) as fh:
            next(fh)
            for row in fh:
                pgn = row.rstrip("\n").split("\t")[2]
                sans = [t for t in pgn.split() if not t[0].isdigit()]
                if 2 <= len(sans) <= 8:
                    starts.append(sans)
    return starts


def noisy_game(engine, rng, start):
    board = chess.Board()
    for san in start:
        board.push_san(san)
    while not board.is_game_over() and board.ply() < 110:
        infos = engine.analyse(board, chess.engine.Limit(depth=3), multipv=6)
        moves = [i["pv"][0] for i in infos]
        r = rng.random()
        board.push(moves[0] if r < 0.6 else rng.choice(moves[1:4] or moves) if r < 0.88 else rng.choice(moves))
    return board


def generate(engine, wanted, starts, seed=7):
    rng = random.Random(seed)
    found = {t: [] for t in wanted}
    seen = set()
    games = 0
    while any(len(found[t]) < n for t, n in wanted.items()) and games < 400:
        games += 1
        game = noisy_game(engine, rng, rng.choice(starts))
        replay = chess.Board()
        per_game = 0
        for move in game.move_stack:
            if replay.ply() >= 10 and per_game < 2 and not replay.is_check() and replay.fen() not in seen:
                if abs(material(replay, chess.WHITE) - material(replay, chess.BLACK)) <= 5:
                    infos = engine.analyse(replay, chess.engine.Limit(depth=11), multipv=2)
                    t = theme_of(replay, infos)
                    if t in wanted and len(found[t]) < wanted[t]:
                        p = refine(engine, replay, t, move_played=move, last=replay.peek())
                        if p:
                            found[t].append(p)
                            seen.add(replay.fen())
                            per_game += 1
            replay.push(move)
        counts = ", ".join(f"{t} {len(v)}/{wanted[t]}" for t, v in found.items())
        print(f"  game {games}: {counts}", file=sys.stderr)
    return found


def refine(engine, board, theme, move_played, last):
    scores = move_scores(engine, board, depth=13)
    ok = accepted(scores)
    best = max(scores, key=lambda m: cp(scores[m]))
    if theme in ("mate1", "backrank"):
        pass  # accepted() already kept exactly the mating moves
    elif theme == "mate2":
        if not (scores[best].is_mate() and scores[best].mate() == 2):
            return None
    else:
        if len(ok) > 2:
            return None
        rest = [cp(s) for m, s in scores.items() if m not in ok]
        if rest and cp(scores[best]) - max(rest) < 150:
            return None
        if theme_of_move(board, best) != theme:
            return None
    p = {"fen": board.fen(), "theme": theme, "best": best.uci(), "accept": [m.uci() for m in ok],
         "last": last.uci() if last else None}
    if theme == "mate2":
        replies = {}
        for m in ok:
            after = board.copy()
            after.push(m)
            info = engine.analyse(after, chess.engine.Limit(depth=12))
            replies[m.uci()] = info["pv"][0].uci()
        p["replies"] = replies
    return p


def theme_of_move(board, move):
    if board.is_capture(move) and board.piece_at(move.to_square) and \
            VAL[board.piece_at(move.to_square).piece_type] >= 3 and is_free(board, move):
        return "free"
    victim = board.piece_at(move.to_square)
    if len(fork_targets(board, move)) >= 2 and not (victim and VAL[victim.piece_type] >= 3):
        return "fork"
    mover = board.piece_at(move.from_square)
    if not board.is_capture(move) and in_danger(board, move.from_square) and mover.piece_type != chess.KING:
        return "save"
    return None


# ---------- lessons ----------
def build_lessons(engine, generated):
    problems, out = [], []
    for lesson in LESSONS:
        puzzles = []
        for spec in lesson.get("puzzles", []):
            if "gen" in spec:
                got = generated.get(spec["gen"], [])
                if len(got) < spec["count"]:
                    problems.append(f"{lesson['id']}: only {len(got)} {spec['gen']} puzzles")
                puzzles += got[:spec["count"]]
                continue
            board = chess.Board()
            for san in spec["moves"].split():
                board.push_san(san)
            want = board.parse_san(spec["want"])
            ok = accepted(move_scores(engine, board, depth=14))
            if want not in ok:
                problems.append(f"{lesson['id']}: {spec['want']} not accepted (ok: {[board.san(m) for m in ok]})")
            last = board.peek()
            puzzles.append({"fen": board.fen(), "theme": "principle", "best": want.uci(),
                            "accept": [m.uci() for m in ok], "last": last.uci(),
                            "prompt": spec["prompt"], "explain": spec["explain"]})
        for i, p in enumerate(puzzles):
            p["id"] = f"{lesson['id']}-{i + 1}"
        item = {k: lesson[k] for k in ("id", "cat", "title", "body")}
        if puzzles:
            item["puzzles"] = puzzles
        if "drill" in lesson:
            item["drill"] = lesson["drill"]
        out.append(item)
    return out, problems


if __name__ == "__main__":
    starts = opening_starts(sys.argv[1])
    wanted = {"free": 8, "fork": 6, "save": 5, "mate1": 8, "backrank": 5, "mate2": 6}
    with chess.engine.SimpleEngine.popen_uci(ENGINE) as engine:
        engine.configure({"Threads": 4, "Hash": 128})
        courses, p1 = build_courses(engine)
        generated = generate(engine, wanted, starts)
        lessons, p2 = build_lessons(engine, generated)
    for p in p1 + p2:
        print("PROBLEM:", p)
    with open(os.path.join(WEB, "content.js"), "w") as fh:
        fh.write("window.BC_CONTENT=" + json.dumps({"courses": courses, "lessons": lessons}, separators=(",", ":")) + ";\n")
    print(f"courses: {sum(len(c['lines']) for c in courses)} lines; "
          f"lessons: {len(lessons)}, puzzles: {sum(len(l.get('puzzles', [])) for l in lessons)}; "
          f"content.js {os.path.getsize(os.path.join(WEB, 'content.js')) // 1024} KB")
    sys.exit(1 if p1 + p2 else 0)
