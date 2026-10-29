#!/usr/bin/env python3
"""Post-game review with Stockfish, written for beginners.

Run this AFTER a game is over, never during one. It finds the moves that
swung the game, explains them in plain words, and saves those positions as
puzzles you can drill later with drill.py.

Usage:
  python review.py game.pgn --me YourUsername
  python review.py --chesscom YourUsername --last 5     # needs internet access
"""
import argparse
import io
import json
import os
import shutil
import sys
import urllib.request

import chess
import chess.engine
import chess.pgn

HERE = os.path.dirname(os.path.abspath(__file__))
PUZZLES = os.path.join(HERE, "my_puzzles.json")
VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}

# Centipawns lost (100 = one pawn) that count as each kind of error. We measure
# material rather than winning chances: at beginner level a "lost" position is
# often still saved, so giving away a piece always matters.
BLUNDER, MISTAKE = 200, 100
CLAMP = 1500


def find_engine():
    for p in (os.environ.get("STOCKFISH"), shutil.which("stockfish"), "/usr/games/stockfish",
              os.path.join(HERE, "stockfish.exe"), os.path.join(HERE, "stockfish"),
              os.path.join(HERE, "..", "stockfish", "src", "stockfish")):
        if p and os.path.exists(p):
            return p
    sys.exit("Stockfish not found. Install it or set STOCKFISH=/path/to/stockfish")


def name(piece_type):
    return chess.piece_name(piece_type)


def cp(score, color):
    return max(-CLAMP, min(CLAMP, score.pov(color).score(mate_score=2 * CLAMP)))


def mated(score, color):
    s = score.pov(color)
    return s.is_mate() and s.mate() <= 0


def piece_list(board, squares):
    return " and ".join(f"your {name(board.piece_at(s).piece_type)} on {chess.square_name(s)}" for s in squares)


def is_free(board, move):
    """True if this capture wins material outright (target undefended or worth more)."""
    victim = board.piece_at(move.to_square)
    if victim is None:
        return False
    attacker = board.piece_at(move.from_square)
    defended = board.is_attacked_by(not board.turn, move.to_square)
    return not defended or VALUES[victim.piece_type] > VALUES[attacker.piece_type]


def explain(board, played, best, info_before, info_after, me):
    """Return (tag, plain-English lesson) for a bad move."""
    sq = chess.square_name
    before, after = info_before["score"].pov(me), info_after["score"].pov(me)
    best_san = board.san(best)

    if before.is_mate() and before.mate() > 0 and not (after.is_mate() and after.mate() > 0):
        return "missed_mate", f"You had checkmate available: {best_san}. Always look at every check first!"

    after_board = board.copy()
    after_board.push(played)
    reply = info_after.get("pv", [None])[0]
    reply_san = after_board.san(reply) if reply else None
    if after.is_mate() and after.mate() < 0:
        hint = f" (starting with {reply_san})" if reply else ""
        return "allowed_mate", (f"This move let your opponent force checkmate in {-after.mate()}{hint}. "
                                f"Before moving, ask: what checks can they give me?")

    if reply and after_board.is_capture(reply) and is_free(after_board, reply):
        victim = after_board.piece_at(reply.to_square)
        how = after_board.san(reply)
        moved_it = reply.to_square == played.to_square
        where = "you just moved it there" if moved_it else "it was left unprotected"
        return "hung_piece", (f"You hung your {name(victim.piece_type)} on {sq(reply.to_square)} -- "
                              f"{where}, and they can take it with {how}. Blunder check: is the square I'm "
                              f"moving to attacked? Did my move leave anything undefended?")

    if reply:
        # Does their reply hit two of our things at once (a fork / double attack)?
        b2 = after_board.copy()
        b2.push(reply)
        hit = [s for s in b2.attacks(reply.to_square)
               if (p := b2.piece_at(s)) and p.color == me
               and (p.piece_type == chess.KING or VALUES[p.piece_type] >= 3 or not b2.is_attacked_by(me, s))]
        if len(hit) >= 2:
            return "allowed_fork", (f"This allowed {reply_san}, which attacks two things at once: "
                                    f"{piece_list(b2, hit)}. You can't save both. Look for squares where one "
                                    f"enemy piece could hit two of yours.")

    if board.is_capture(best) and is_free(board, best):
        victim = board.piece_at(best.to_square)
        return "missed_capture", (f"You could have won their {name(victim.piece_type)} on "
                                  f"{sq(best.to_square)} with {best_san}. Every move, look at what they just left hanging.")

    if board.gives_check(best):
        return "missed_check", f"{best_san} was a strong check. Checks, captures, threats -- look at them first."

    threat = f" Your move allowed {reply_san} -- set it up on the board and see what it does." if reply else ""
    return "other", f"Stronger was {best_san}.{threat}"


def review_game(game, me_name, engine, depth):
    white = game.headers.get("White", "")
    me = chess.WHITE if me_name and white.lower() == me_name.lower() else chess.BLACK
    if not me_name:
        me = chess.WHITE
    limit = chess.engine.Limit(depth=depth)
    board = game.board()
    found = []
    info_before = engine.analyse(board, limit)

    for node in game.mainline():
        move = node.move
        info_after = engine.analyse(_after(board, move), limit)
        if board.turn == me:
            drop = cp(info_before["score"], me) - cp(info_after["score"], me)
            walked_into_mate = mated(info_after["score"], me) and not mated(info_before["score"], me)
            best = info_before.get("pv", [None])[0]
            if best and best != move and (drop >= MISTAKE or walked_into_mate):
                tag, lesson = explain(board, move, best, info_before, info_after, me)
                found.append({
                    "move_no": board.fullmove_number, "fen": board.fen(),
                    "played": board.san(move), "best": board.san(best), "best_uci": best.uci(),
                    "kind": "blunder" if drop >= BLUNDER or walked_into_mate else "mistake",
                    "drop": drop, "tag": tag, "lesson": lesson,
                    "game": f"{white} vs {game.headers.get('Black', '?')}",
                })
        board.push(move)
        info_before = info_after
    return me, found


def _after(board, move):
    b = board.copy()
    b.push(move)
    return b


def fetch_chesscom(user, last):
    req = lambda url: json.load(urllib.request.urlopen(
        urllib.request.Request(url, headers={"User-Agent": "chess-coach-review"})))
    archives = req(f"https://api.chess.com/pub/player/{user.lower()}/games/archives")["archives"]
    games = []
    for url in reversed(archives):
        games = req(url)["games"] + games
        if len(games) >= last:
            break
    return "\n\n".join(g["pgn"] for g in games[-last:] if "pgn" in g)


LABELS = {
    "hung_piece": "Hung a piece", "missed_capture": "Missed a free piece", "allowed_fork": "Allowed a fork",
    "allowed_mate": "Walked into mate", "missed_mate": "Missed checkmate",
    "missed_check": "Missed a strong check", "other": "Other",
}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pgn", nargs="?", help="PGN file (one or many games)")
    ap.add_argument("--me", help="your username, so we review only your moves")
    ap.add_argument("--chesscom", metavar="USER", help="download your recent games from chess.com")
    ap.add_argument("--last", type=int, default=5, help="how many chess.com games (default 5)")
    ap.add_argument("--depth", type=int, default=14, help="engine depth (default 14)")
    args = ap.parse_args()

    if args.chesscom:
        text, args.me = fetch_chesscom(args.chesscom, args.last), args.me or args.chesscom
    elif args.pgn:
        text = open(args.pgn).read()
    else:
        ap.error("give a PGN file or --chesscom USER")

    pgn = io.StringIO(text)
    all_found, n_games = [], 0
    with chess.engine.SimpleEngine.popen_uci(find_engine()) as engine:
        while (game := chess.pgn.read_game(pgn)) is not None:
            n_games += 1
            if game.errors:
                print(f"\nWARNING: game {n_games} has a bad move in its PGN; only the part before it is reviewed.")
            me, found = review_game(game, args.me, engine, args.depth)
            side = "White" if me == chess.WHITE else "Black"
            print(f"\n=== Game {n_games}: {game.headers.get('White')} vs {game.headers.get('Black')} "
                  f"({game.headers.get('Result')}) -- you were {side} ===")
            if not found:
                print("  No big mistakes found. Nice!")
            for f in found:
                dots = "." if side == "White" else "..."
                print(f"\n  [{f['kind'].upper()}] move {f['move_no']}{dots} you played {f['played']}, best was {f['best']}")
                print(f"    {f['lesson']}")
                print(f"    See it: https://lichess.org/analysis/{f['fen'].replace(' ', '_')}")
            all_found += found

    counts = {}
    for f in all_found:
        counts[f["tag"]] = counts.get(f["tag"], 0) + 1
    print(f"\n=== Summary over {n_games} game(s) ===")
    for tag, c in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {LABELS[tag]:24} {c}")
    named = {t: c for t, c in counts.items() if t != "other"}
    if named:
        top = max(named, key=named.get)
        print(f"\nYour #1 leak right now: {LABELS[top]}. Fix that first -- it's worth the most rating.")

    old = json.load(open(PUZZLES)) if os.path.exists(PUZZLES) else []
    seen = {p["fen"] for p in old}
    new = [f for f in all_found if f["fen"] not in seen]
    json.dump(old + new, open(PUZZLES, "w"), indent=1)
    print(f"\nSaved {len(new)} new puzzle(s) from your own games -> run: python drill.py")


if __name__ == "__main__":
    main()
