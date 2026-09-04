import { useState } from 'react';
import { APP_VERSION } from '../version';

// يفرض جلب أحدث نسخة: يلغي الـ Service Worker + يمسح الكاش + يعيد التحميل
async function forceUpdate() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (_) { /* تجاهل */ }
  window.location.reload();
}

export default function AppUpdate() {
  const [busy, setBusy] = useState(false);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 10, color: 'var(--text-secondary)', direction: 'ltr', fontWeight: 600 }}>{APP_VERSION}</span>
      <button
        className="btn-outline"
        title="تحديث التطبيق لأحدث نسخة"
        disabled={busy}
        onClick={() => { setBusy(true); forceUpdate(); }}
        style={{ padding: '4px 8px', fontSize: 13, lineHeight: 1 }}
      >
        <span style={{ display: 'inline-block', animation: busy ? 'spin 0.7s linear infinite' : 'none' }}>⬆️</span>
      </button>
    </span>
  );
}
