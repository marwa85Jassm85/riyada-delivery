import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
export const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // تفادي تعليق طلبات الكتابة: قفل navigator.locks يعلّق أحياناً في المتصفح
    // فيوقف إرسال الطلبات المصادَق عليها. نستبدله بقفل تمريري بسيط (مستخدم واحد لكل جهاز).
    lock: async (_name, _acquireTimeout, fn) => fn(),
  }
});
