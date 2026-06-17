import { createClient } from '@supabase/supabase-js';

export const supabaseUrl        = import.meta.env.VITE_SUPABASE_URL;
export const supabaseKey        = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabaseServiceKey = import.meta.env.VITE_SUPABASE_SERVICE_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  }
});

// ملاحظة: عمليات Auth الإدارية موجودة في src/utils/adminAuth.js
// (تستخدم fetch مباشر بدل SDK لتفادي حجب service_role في المتصفح)
