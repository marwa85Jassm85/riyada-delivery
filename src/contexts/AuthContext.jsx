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
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    setUserProfile(data);
    return data;
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
    await supabase.auth.signOut();
    setCurrentUser(null);
    setUserProfile(null);
  }

  useEffect(() => {
    // onAuthStateChange يُطلق INITIAL_SESSION فوراً بالجلسة الحالية
    // لذا نكتفي به ولا نحتاج getSession بشكل منفصل (يمنع double-fetch)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setCurrentUser(session?.user ?? null);
      if (session?.user) {
        await fetchProfile(session.user.id);
      } else {
        setUserProfile(null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ currentUser, userProfile, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
