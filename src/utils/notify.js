/* ── Browser Notification Utility ── */

export async function requestNotifyPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

export function showNotify(title, body = '') {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(title, {
      body,
      icon:  '/logo.png',
      badge: '/logo.png',
      dir:   'rtl',
      lang:  'ar',
    });
  } catch (_) {}
}
