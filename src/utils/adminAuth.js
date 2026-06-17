/**
 * adminAuth.js
 * عمليات Auth الإدارية عبر Supabase REST API مباشرة
 * (بديل supabaseAdmin SDK الذي يُحجب في المتصفح منذ v2.107)
 */
import { supabaseUrl, supabaseServiceKey } from '../supabase';

function authHeaders() {
  return {
    'apikey':        supabaseServiceKey,
    'Authorization': `Bearer ${supabaseServiceKey}`,
    'Content-Type':  'application/json',
  };
}

/** إنشاء مستخدم جديد في Auth */
export async function adminCreateUser({ email, password }) {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method:  'POST',
    headers: authHeaders(),
    body:    JSON.stringify({ email, password, email_confirm: true }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.msg || data.message || data.error_description || data.error || '';
    if (
      msg.toLowerCase().includes('already registered') ||
      msg.toLowerCase().includes('already been registered') ||
      msg.toLowerCase().includes('already exists')
    ) {
      throw new Error('اسم المستخدم هذا مستخدم مسبقاً، جرّب اسماً آخر');
    }
    throw new Error(msg || 'فشل إنشاء الحساب');
  }
  return data; // { id, email, ... }
}

/** حذف مستخدم من Auth (يستتبع حذف الجلسات) */
export async function adminDeleteUser(userId) {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method:  'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    let msg = 'فشل حذف حساب الدخول';
    try { const d = await res.json(); msg = d.message || d.msg || msg; } catch (_) {}
    throw new Error(msg);
  }
}

/** تغيير كلمة مرور مستخدم موجود */
export async function adminUpdatePassword(userId, password) {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method:  'PUT',
    headers: authHeaders(),
    body:    JSON.stringify({ password }),
  });
  if (!res.ok) {
    let msg = 'فشل تغيير كلمة المرور';
    try { const d = await res.json(); msg = d.message || d.msg || msg; } catch (_) {}
    throw new Error(msg);
  }
}
