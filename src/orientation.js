// Moonlit Knight — landscape lock helper (v0.7).
// The original game plays in landscape (16:9). On a phone or tablet held
// in portrait, the rotate overlay (a CSS portrait media query in
// index.html) tells the player to turn the device; this helper ALSO tries
// the Screen Orientation API so a tap on Begin can rotate the screen for
// them. Best-effort only: every step is guarded and failures are silent —
// the overlay is the real gate, this is just a convenience.

export function tryLockLandscape(deps = {}) {
  const scr = deps.screen !== undefined
    ? deps.screen
    : (typeof screen !== 'undefined' ? screen : undefined);
  const mm = deps.matchMedia !== undefined
    ? deps.matchMedia
    : (typeof matchMedia !== 'undefined' ? matchMedia : undefined);
  const doc = deps.document !== undefined
    ? deps.document
    : (typeof document !== 'undefined' ? document : undefined);
  try {
    if (!scr || !scr.orientation || typeof scr.orientation.lock !== 'function') return false;
    if (!mm || !mm('(orientation: portrait)').matches) return false;
    if (!mm('(pointer: coarse)').matches) return false;
    const lock = () => {
      try {
        const p = scr.orientation.lock('landscape');
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch { /* orientation lock refused: the overlay guides the user */ }
    };
    const el = doc && doc.documentElement;
    if (el && typeof el.requestFullscreen === 'function') {
      try {
        const p = el.requestFullscreen();
        if (p && typeof p.then === 'function') p.then(lock, lock);
        else lock();
      } catch { lock(); }
    } else {
      lock();
    }
    return true;
  } catch {
    return false;
  }
}
