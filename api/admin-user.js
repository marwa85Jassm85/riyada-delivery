/**
 * Vercel Serverless Function — عمليات Auth الإدارية
 * تعمل من السيرفر فقط، لا تُكشف للمتصفح
 * المتغيرات: SUPABASE_URL و SUPABASE_SERVICE_KEY (بدون VITE_)
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY;

function authHeaders() {
  return {
    'apikey':        SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type':  'application/json',
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, userId, email, password } = req.body || {};

  try {
    // ── إنشاء مستخدم ──
    if (action === 'create') {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method:  'POST',
        headers: authHeaders(),
        body:    JSON.stringify({ email, password, email_confirm: true }),
      });
      const data = await r.json();
      return res.status(r.status).json(data);
    }

    // ── حذف مستخدم ──
    if (action === 'delete') {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
        method:  'DELETE',
        headers: authHeaders(),
      });
      return res.status(r.status).json({ ok: r.ok });
    }

    // ── تغيير كلمة مرور ──
    if (action === 'update_password') {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
        method:  'PUT',
        headers: authHeaders(),
        body:    JSON.stringify({ password }),
      });
      const data = await r.json();
      return res.status(r.status).json(data);
    }

    return res.status(400).json({ error: 'action غير معروف' });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
