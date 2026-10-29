// Installed-app extras: offline support, update prompt, install hint, and
// backups (in the app, progress lives only on this device).
(() => {
'use strict';
const $ = id => document.getElementById(id);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ---------- offline support and updates ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    const offer = w => { $('updateBar').hidden = false; $('updateBtn').onclick = () => w.postMessage('skipWaiting'); };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(e => console.warn('offline support unavailable', e));
  // Reload only when an update takes over, not when offline support first switches on.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
}
// Ask the browser not to clear saved progress when space runs low.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// ---------- install ----------
let deferred = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferred = e;
  $('installBtn').hidden = false; $('installHint').hidden = true;
});
$('installBtn').addEventListener('click', async () => {
  if (!deferred) return;
  deferred.prompt();
  await deferred.userChoice.catch(() => {});
  deferred = null; $('installBtn').hidden = true;
});
window.addEventListener('appinstalled', () => { $('installBtn').hidden = true; $('installHint').hidden = true; });
if (!standalone && ios) {
  $('installHint').hidden = false;
  $('installHint').textContent = 'Install on your iPhone: open this page in Safari, tap Share, then "Add to Home Screen".';
}

// ---------- backups ----------
const say = msg => { $('backupMsg').textContent = msg; };
$('backupBtn').addEventListener('click', () => {
  const data = { app: 'blunder-check', version: 1, savedAt: new Date().toISOString(),
    progress: BC.sync.progress, history: BC.local.get('bc.history', []), username: BC.local.get('bc.username', '') };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `blunder-check-backup-${data.savedAt.slice(0, 10)}.json`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  say('Backup saved. Keep the file somewhere safe, like iCloud Drive or Google Drive.');
});
$('restoreFile').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== 'blunder-check' || !d.progress) throw new Error('not a backup');
    BC.local.set('bc.progress', d.progress);
    BC.local.set('bc.history', d.history || []);
    if (d.username) BC.local.set('bc.username', d.username);
    say('Backup restored. Reloading…');
    setTimeout(() => location.reload(), 800);
  } catch (err) {
    say("That file isn't a Blunder Check backup. Pick a file named blunder-check-backup-….json.");
  }
});
})();
