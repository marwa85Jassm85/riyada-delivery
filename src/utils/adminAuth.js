/**
 * adminAuth.js
 * عمليات Auth الإدارية عبر Vercel Serverless Function (api/admin-user.js)
 * المفتاح السري يبقى في السيرفر فقط
 */

async function callAdminApi(body) {
  const res = await fetch('/api/admin-user', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.msg || data.message || data.error_description || data.error || '';
    throw new Error(msg || 'فشلت العملية');
  }
  return data;
}

/** إنشاء مستخدم جديد في Auth */
export async function adminCreateUser({ email, password }) {
  try {
    return await callAdminApi({ action: 'create', email, password });
  } catch (e) {
    const msg = e.message.toLowerCase();
    if (msg.includes('already registered') || msg.includes('already exists')) {
      throw new Error('اسم المستخدم هذا مستخدم مسبقاً، جرّب اسماً آخر');
    }
    throw e;
  }
}

/** حذف مستخدم من Auth */
export async function adminDeleteUser(userId) {
  await callAdminApi({ action: 'delete', userId });
}

/** تغيير كلمة مرور مستخدم موجود */
export async function adminUpdatePassword(userId, password) {
  await callAdminApi({ action: 'update_password', userId, password });
}
