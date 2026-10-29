#!/usr/bin/env python3
"""Build the installable app (a Progressive Web App) into ../../docs.

  python3 tools/build_app.py

Takes review.html (the page as published on claude.ai) and wraps it as a
full document with a web app manifest, icons and a service worker that
caches everything, so the app installs to a phone's home screen and works
offline. GitHub Pages serves the docs/ folder.
"""
import hashlib
import json
import os
import shutil

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(os.path.dirname(WEB), "docs")
FILES = ["data.js", "content.js", "legends.js",
         "js/shared.js", "js/review.js", "js/learn.js", "js/legends.js",
         "engine/chess-0.10.3.js", "engine/stockfish-17.1-lite-single-03e3232.js",
         "engine/stockfish-17.1-lite-single-03e3232.wasm", "engine/stockfish-10-asm.js"]
ICONS = ["icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png",
         "icons/apple-touch-icon.png", "icons/favicon-32.png"]

HEAD = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Free chess coach: unlimited game review with Stockfish, opening trainer, lessons, legend bots.">
<meta name="theme-color" content="#2C4F86" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0E131A" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Blunder Check">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<style>
:root { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); color-scheme: light; }
[hidden] { display: none !important; }
body { margin: 0; font: 14px system-ui, -apple-system, sans-serif; }
img { max-width: 100%; }
</style>
"""

APP_CSS = """<style>
.appbox { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0 0 14px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
.appbox p { margin: 0; flex: 1 1 260px; }
.appbox .btn { font-size: 14px; padding: 7px 12px; }
#backupMsg:empty { display: none; }
#backupMsg { flex-basis: 100%; color: var(--ink); }
.updatebar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; display: flex; gap: 12px; align-items: center; justify-content: center;
  padding: 10px max(16px, env(safe-area-inset-right, 0px)) calc(10px + env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px));
  background: var(--ink); color: var(--bg); font-weight: 600; }
</style>
"""

APP_MARKUP = """<div class="updatebar" id="updateBar" hidden role="status"><span>A new version of Blunder Check is ready.</span><button class="btn" id="updateBtn">Update</button></div>
  <div class="appbox">
    <p id="installHint" hidden></p><button class="btn" id="installBtn" hidden>Install app</button>
    <p>Your reviews and progress are saved on this device only. Back them up now and then.</p>
    <button class="btn ghost" id="backupBtn">Back up progress</button>
    <label class="btn ghost" for="restoreFile">Restore backup</label><input type="file" id="restoreFile" accept="application/json,.json" hidden>
    <p id="backupMsg" role="status"></p>
  </div>
"""

SW = """// Caches the whole app so it works offline. The version changes whenever
// any file changes, which makes the app offer an update.
const CACHE = 'bc-__VERSION__';
const FONTS = 'fonts-v1';
const ASSETS = __ASSETS__;
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('bc-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (req.mode === 'navigate') { e.respondWith(caches.match('./index.html').then(r => r || fetch(req))); return; }
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
"""

MANIFEST = {
    "id": "./", "name": "Blunder Check", "short_name": "Blunder Check",
    "description": "Free chess coach: unlimited game review with Stockfish, opening trainer, lessons and legend bots.",
    "start_url": "./", "scope": "./", "display": "standalone",
    "background_color": "#EDF0F3", "theme_color": "#2C4F86", "categories": ["games", "education"],
    "icons": [
        {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ],
}

NOTICE = """# Third-party components

- **Stockfish** (GPLv3) by the Stockfish developers, https://github.com/official-stockfish/Stockfish.
  In-browser builds by stockfish.js (Nathan Rugg), https://github.com/nmrugg/stockfish.js
  (`engine/stockfish-17.1-lite-single-*` from stockfish.js 17.1.0, `engine/stockfish-10-asm.js` from 10.0.2).
  Full license text: COPYING.
- **chess.js** 0.10.3 (BSD-2-Clause) by Jeff Hlywa, https://github.com/jhlywa/chess.js.
- **Opening names**: lichess chess-openings (CC0), https://github.com/lichess-org/chess-openings.
- **Pieces**: cburnett set by Colin M.L. Burnett (GPLv2+), via https://github.com/lichess-org/lila.
"""


def main():
    page = open(os.path.join(WEB, "review.html")).read()
    head_part, body_part = page.split("</style>", 1)
    head_part += "</style>\n"
    body_part = body_part.replace("Your reviews and progress are saved in this browser.",
                                  "Your reviews and progress are saved on this device.")
    body_part = body_part.replace("<footer>", "<footer>\n  " + APP_MARKUP, 1)
    body_part = body_part.replace('<script src="js/legends.js"></script>',
                                  '<script src="js/legends.js"></script>\n<script src="js/app.js"></script>', 1)
    for needed in ('<script src="js/app.js">', 'id="backupBtn"'):
        assert needed in body_part, needed

    if os.path.isdir(OUT):
        for name in os.listdir(OUT):
            if name != "icons":
                p = os.path.join(OUT, name)
                shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
    for f in FILES:
        os.makedirs(os.path.dirname(os.path.join(OUT, f)), exist_ok=True)
        shutil.copy2(os.path.join(WEB, f), os.path.join(OUT, f))
    shutil.copy2(os.path.join(WEB, "app", "app.js"), os.path.join(OUT, "js", "app.js"))
    for icon in ICONS:
        assert os.path.exists(os.path.join(OUT, icon)), f"missing {icon}: render the icons first"

    html = HEAD + head_part + APP_CSS + "</head><body>\n" + body_part + "\n</body></html>\n"
    open(os.path.join(OUT, "index.html"), "w").write(html)
    json.dump(MANIFEST, open(os.path.join(OUT, "manifest.webmanifest"), "w"), indent=1)
    open(os.path.join(OUT, "NOTICE.md"), "w").write(NOTICE)
    open(os.path.join(OUT, ".nojekyll"), "w").write("")
    copying = os.path.join(WEB, "engine", "COPYING")
    if os.path.exists(copying):
        shutil.copy2(copying, os.path.join(OUT, "COPYING"))

    assets = ["./", "index.html", "manifest.webmanifest", "js/app.js"] + FILES + ICONS
    digest = hashlib.sha256()
    for a in assets[1:]:
        digest.update(open(os.path.join(OUT, a), "rb").read())
    version = digest.hexdigest()[:12]
    sw = SW.replace("__VERSION__", version).replace("__ASSETS__", json.dumps(assets))
    open(os.path.join(OUT, "sw.js"), "w").write(sw)
    size = sum(os.path.getsize(os.path.join(OUT, a)) for a in assets[1:])
    print(f"built docs/ version {version}: {len(assets)} cached files, {size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
