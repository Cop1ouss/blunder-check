#!/usr/bin/env python3
"""Keep a chess.com player's finished games, ratings and reviews in docs/data/<user>/.

Run by .github/workflows/sync-chesscom.yml every 15 minutes, so new games are
registered and reviewed even when the app is closed. The app reads the files
from the same site, so it needs no engine work and no access to chess.com.

  python3 web/tools/sync_chesscom.py fetch   --user Cop1ouss --out docs/data
  python3 web/tools/sync_chesscom.py analyse --user Cop1ouss --out docs/data --max 20

fetch    Standard library only. Downloads the monthly archives (which contain
         finished games only) and current ratings, merges them into
         games.json, and reports whether any game still needs a review
         (also as need_analysis=true|false in $GITHUB_OUTPUT).
analyse  Needs python-chess and Stockfish. Reviews up to --max games without a
         review, newest first, in the same format the app produces, and writes
         an/<id>.json.

--fixture FILE replaces chess.com with a JSON file (for tests):
  {"archives": [url, ...], "months": {url: [game, ...]}, "stats": {...}}
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = "https://api.chess.com/pub/player/"
UA = "BlunderCheck/1.0 (personal chess training app; https://github.com/Cop1ouss/blunder-check)"
MAX_GAMES = 400
DRAW_CODES = {"agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"}


class SyncError(Exception):
    pass


class Source:
    def __init__(self, fixture=None):
        self.fixture = json.load(open(fixture)) if fixture else None

    def get(self, url):
        if self.fixture is not None:
            if url.endswith("/games/archives"):
                return {"archives": self.fixture["archives"]}
            if url.endswith("/stats"):
                return self.fixture.get("stats", {})
            return {"games": self.fixture["months"].get(url, [])}
        problem = ""
        for attempt in range(3):
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    return json.load(r)
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    raise SyncError(f"chess.com has no player called '{url.split('/player/')[1].split('/')[0]}'. Check the username.")
                body = e.read()[:200].decode("utf-8", "replace").strip()
                problem = f"HTTP {e.code} {body}"
                if e.code == 429 and attempt < 2:
                    time.sleep(10 * (attempt + 1))
                    continue
                break
            except (urllib.error.URLError, TimeoutError, ValueError) as e:
                problem = str(e)
                if attempt < 2:
                    time.sleep(5)
                    continue
        # Some servers refuse Python's HTTP client but accept curl.
        r = subprocess.run(["curl", "-sS", "-L", "--max-time", "60", "-A", UA, "-H", "Accept: application/json",
                            "-w", "\n%{http_code}", url], capture_output=True, text=True)
        body, _, code = r.stdout.rpartition("\n")
        if code == "200":
            return json.loads(body)
        if code == "404":
            raise SyncError(f"chess.com has no player called '{url.split('/player/')[1].split('/')[0]}'. Check the username.")
        raise SyncError(f"chess.com refused the request ({problem}; curl: HTTP {code} {body[:150]} {r.stderr[:150]}).".strip())


def game_id(url):
    """'https://www.chess.com/game/live/123' -> 'live-123' (live and daily ids are separate)."""
    parts = url.rstrip("/").split("/")
    return f"{parts[-2]}-{parts[-1]}"


def slim(gm, user):
    me = "w" if gm["white"]["username"].lower() == user else "b"
    side = lambda s: {"u": gm[s]["username"], "r": gm[s].get("rating"), "res": gm[s].get("result")}
    return {"url": gm["url"], "pgn": gm["pgn"], "end": int(gm.get("end_time", 0)) * 1000, "tc": gm.get("time_class"),
            "rated": gm.get("rated", True), "me": me, "white": side("white"), "black": side("black")}


def usable(gm):
    return gm.get("rules") == "chess" and gm.get("pgn") and '[SetUp "1"]' not in gm["pgn"]


def paths(out, user):
    d = os.path.join(out, user)
    return d, os.path.join(d, "games.json"), os.path.join(d, "an")


def load(path, user):
    if os.path.exists(path):
        return json.load(open(path))
    return {"user": user, "updatedAt": 0, "stats": None, "ratingLog": [], "games": []}


def save(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh, separators=(",", ":"))
    os.replace(tmp, path)


def set_output(name, value):
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as fh:
            fh.write(f"{name}={value}\n")


def write_status(folder, status):
    """status.json tells the app (and you) whether the last sync worked. Rewritten only when it changes."""
    path = os.path.join(folder, "status.json")
    old = json.load(open(path)) if os.path.exists(path) else {}
    if {k: v for k, v in old.items() if k != "at"} != status:
        save(path, {**status, "at": int(time.time() * 1000)})


def fetch(args):
    user = args.user.lower()
    folder, games_path, _ = paths(args.out, user)
    os.makedirs(folder, exist_ok=True)
    try:
        fetch_games(args, user, folder, games_path)
        write_status(folder, {"ok": True, "error": None})
    except Exception as e:  # keep going: the error is saved for the app and the next run tries again
        msg = str(e) if isinstance(e, SyncError) else f"{type(e).__name__}: {e}"
        print("SYNC FAILED:", msg)
        write_status(folder, {"ok": False, "error": msg[:500]})
        set_output("need_analysis", "false")


def fetch_games(args, user, folder, games_path):
    data = load(games_path, user)
    before = json.dumps({k: data.get(k) for k in ("games", "stats")}, sort_keys=True, default=str)
    src = Source(args.fixture)
    archives = src.get(f"{API}{user}/games/archives").get("archives", [])
    months = archives[-2:] if data["games"] else archives[-args.months:]
    known = {g["url"]: g for g in data["games"]}
    added = 0
    for url in months:
        for gm in src.get(url).get("games", []):
            if not usable(gm):
                continue
            g = slim(gm, user)
            if g["url"] in known:
                g["an"] = known[g["url"]].get("an", False)
            else:
                g["an"] = False
                added += 1
            known[g["url"]] = g
    data["games"] = sorted(known.values(), key=lambda g: -g["end"])[:MAX_GAMES]

    s = src.get(f"{API}{user}/stats") or {}
    pick = lambda k: ({"rating": s[k]["last"]["rating"], "best": (s[k].get("best") or {}).get("rating"),
                       "bestAt": ((s[k].get("best") or {}).get("date") or 0) * 1000 or None, "record": s[k].get("record")}
                      if s.get(k, {}).get("last") else None)
    now = int(time.time() * 1000)
    stats = {"at": now, "rapid": pick("chess_rapid"), "blitz": pick("chess_blitz"), "bullet": pick("chess_bullet"), "daily": pick("chess_daily")}
    if any(stats[k] for k in ("rapid", "blitz", "bullet", "daily")):
        data["stats"] = stats
        for tc in ("rapid", "blitz", "bullet", "daily"):
            if not stats[tc]:
                continue
            last = next((e for e in reversed(data["ratingLog"]) if e["tc"] == tc), None)
            if not last or last["r"] != stats[tc]["rating"] or now - last["t"] > 86400000:
                data["ratingLog"].append({"t": now, "tc": tc, "r": stats[tc]["rating"], "src": "chess.com"})
        data["ratingLog"] = data["ratingLog"][-2000:]
    stats_cmp = lambda st: {k: v for k, v in (st or {}).items() if k != "at"}
    old = json.loads(before)
    changed = (json.dumps(data["games"], sort_keys=True) != json.dumps(old["games"], sort_keys=True)
               or stats_cmp(data["stats"]) != stats_cmp(old["stats"]) or not os.path.exists(games_path)
               or len(data["ratingLog"]) != len(load(games_path, user)["ratingLog"]))
    if changed:  # only commit when something really changed
        data["updatedAt"] = now
        save(games_path, data)
    pending = sum(1 for g in data["games"] if not g.get("an"))
    print(f"{user}: {added} new game(s), {len(data['games'])} stored, {pending} waiting for a review")
    set_output("need_analysis", "true" if pending else "false")
    set_output("added", str(added))


def analyse(args):
    import chess
    import chess.engine
    import chess.pgn
    import io

    user = args.user.lower()
    folder, games_path, an_dir = paths(args.out, user)
    os.makedirs(an_dir, exist_ok=True)
    data = load(games_path, user)
    todo = [g for g in data["games"] if not g.get("an")][:args.max]
    engine_path = os.environ.get("STOCKFISH") or shutil.which("stockfish") or "/usr/games/stockfish"
    limit = chess.engine.Limit(depth=args.depth, time=args.movetime)
    done = 0
    with chess.engine.SimpleEngine.popen_uci(engine_path) as engine:
        engine.configure({"Threads": max(1, os.cpu_count() or 1), "Hash": 128})
        for g in todo:
            game = chess.pgn.read_game(io.StringIO(g["pgn"]))
            if game is None:
                g["an"] = "bad"
                continue
            board = game.board()
            positions = [board.copy()]
            for move in game.mainline_moves():
                board.push(move)
                positions.append(board.copy())
            an = []
            for b in positions:
                if b.is_checkmate() or b.is_stalemate() or b.is_insufficient_material():
                    an.append({"lines": [], "end": True})
                    continue
                lines = []
                for info in engine.analyse(b, limit, multipv=2):
                    if "pv" not in info:
                        continue
                    score = info["score"].white()
                    line = {"uci": info["pv"][0].uci(), "pv": " ".join(m.uci() for m in info["pv"][:10])}
                    if score.is_mate():
                        line["mate"] = score.mate()
                    else:
                        line["cp"] = score.score()
                    lines.append(line)
                an.append({"lines": lines, "depth": args.depth})
            with open(os.path.join(an_dir, game_id(g["url"]) + ".json"), "w") as fh:
                json.dump({"url": g["url"], "depth": args.depth, "an": an}, fh, separators=(",", ":"))
            g["an"] = True
            done += 1
            save(games_path, data)  # keep progress if the job is stopped
            print(f"  reviewed {g['url']} ({len(positions) - 1} moves)")
    print(f"{user}: reviewed {done} game(s)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["fetch", "analyse"])
    ap.add_argument("--user", required=True)
    ap.add_argument("--out", default="docs/data")
    ap.add_argument("--fixture")
    ap.add_argument("--months", type=int, default=12, help="months to load on the first run")
    ap.add_argument("--max", type=int, default=20, help="games to review per run")
    ap.add_argument("--depth", type=int, default=14)
    ap.add_argument("--movetime", type=float, default=1.0, help="seconds per position at most")
    a = ap.parse_args()
    fetch(a) if a.mode == "fetch" else analyse(a)
