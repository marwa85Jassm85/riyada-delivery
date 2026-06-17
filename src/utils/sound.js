/* ── Shared Audio Utility ──
   Singleton AudioContext — prevents browser limit exhaustion.
   Resumes suspended context (required for iOS Safari).
*/

let _sharedCtx = null;

function _ctx() {
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    if (_sharedCtx && _sharedCtx.state !== 'closed') return _sharedCtx;
    _sharedCtx = new C();
    return _sharedCtx;
  } catch (_) { return null; }
}

async function _getCtx() {
  const ctx = _ctx();
  if (!ctx) return null;
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch (_) { return null; }
  }
  return ctx;
}

function _tone(ctx, freq, start, end, vol = 0.25) {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain); gain.connect(ctx.destination);
  osc.type = 'sine'; osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, ctx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + end);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + end);
}

/* ✅ حفظ / إضافة / تعديل / استعادة — نغمتان صاعدتان */
export async function playSuccess() {
  try {
    const ctx = await _getCtx(); if (!ctx) return;
    _tone(ctx, 523, 0,    0.18);   // C5
    _tone(ctx, 659, 0.12, 0.32);   // E5
  } catch (_) {}
}

/* 🗑️ حذف — نغمة هابطة */
export async function playDelete() {
  try {
    const ctx = await _getCtx(); if (!ctx) return;
    _tone(ctx, 400, 0,   0.15);
    _tone(ctx, 280, 0.1, 0.30, 0.2);
  } catch (_) {}
}

/* 🔔 تنبيه وارد — ثلاث نغمات */
export async function playAlert() {
  try {
    const ctx = await _getCtx(); if (!ctx) return;
    [[660, 0, 0.25], [880, 0.2, 0.5], [660, 0.45, 0.7]].forEach(([f, s, e]) => _tone(ctx, f, s, e, 0.3));
  } catch (_) {}
}
