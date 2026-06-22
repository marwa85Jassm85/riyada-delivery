import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../supabase';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

function buildEmail(username, role) {
  const clean = username.trim().toLowerCase().replace(/\s+/g, '.');
  return `${role}.${clean}@riyada.app`;
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser]   = useState(null);
  const [userProfile, setUserProfile]   = useState(null);
  const [loading, setLoading]           = useState(true);

  async function fetchProfile(userId) {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      setUserProfile(data);
      return data;
    } catch (_) {
      setUserProfile(null);
      return null;
    }
  }

  async function login(username, password, role) {
    const email = buildEmail(username, role);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const profile = await fetchProfile(data.user.id);
    if (!profile) throw new Error('لم يُعثر على ملفك الشخصي — تواصل مع الإدارة');
    return data;
  }

  async function logout() {
    // امسح البيانات المحفوظة أولاً حتى لا يعيد الدخول التلقائي تسجيل الدخول فوراً
    try { localStorage.removeItem('riyada_saved_creds'); } catch (_) {}
    await supabase.auth.signOut();
    setCurrentUser(null);
    setUserProfile(null);
  }

  useEffect(() => {
    let active = true;

    // onAuthStateChange يُطلق INITIAL_SESSION فوراً بالجلسة الحالية
    // مهم جداً: لا نستخدم await لاستدعاء Supabase مباشرة داخل هذا الـ callback
    // لأنه يمسك قفل المصادقة → استدعاء آخر داخله يسبب deadlock وتجمّد على شاشة التحميل
    // الحل: نؤجّل جلب الملف الشخصي بـ setTimeout(0) حتى يتحرر القفل
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user ?? null);
      if (session?.user) {
        setTimeout(() => {
          if (!active) return;
          fetchProfile(session.user.id).finally(() => {
            if (active) setLoading(false);
          });
        }, 0);
      } else {
        setUserProfile(null);
        setLoading(false);
      }
    });

    // أمان إضافي: لو تأخر كل شيء لأي سبب، نُنهي التحميل بعد 8 ثوانٍ
    const safety = setTimeout(() => { if (active) setLoading(false); }, 8000);

    return () => {
      active = false;
      clearTimeout(safety);
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ currentUser, userProfile, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
