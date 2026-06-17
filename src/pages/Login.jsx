import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const ROLES = [
  { id: 'employee',   label: 'موظف المذخر', icon: '🏪' },
  { id: 'driver',     label: 'سائق',         icon: '🚗' },
  { id: 'pharmacist', label: 'صيدلاني',      icon: '💊' },
  { id: 'admin',      label: 'الإدارة',      icon: '⚙️' },
];

const STORAGE_KEY = 'riyada_saved_creds';

export default function Login() {
  const [role, setRole]         = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const { login } = useAuth();
  const navigate  = useNavigate();

  // تحميل البيانات المحفوظة + دخول تلقائي
  useEffect(() => {
    let cancelled = false;
    const tryAutoLogin = async () => {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (!saved?.username || !saved?.password || !saved?.role) return;

        // ملء الحقول أولاً (يظهر للمستخدم أثناء المحاولة)
        setUsername(saved.username);
        setPassword(saved.password);
        setRole(saved.role);
        setRemember(true);
        setLoading(true);

        await login(saved.username, saved.password, saved.role);
        if (!cancelled) navigate(`/${saved.role}`);
      } catch {
        // كلمة المرور تغيّرت أو مشكلة في الشبكة — نعرض النموذج
        if (!cancelled) setLoading(false);
      }
    };
    tryAutoLogin();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!role) { setError('اختر دورك أولاً'); return; }
    setLoading(true);
    setError('');
    try {
      await login(username.trim(), password, role);
      if (remember) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ username: username.trim(), password, role }));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
      navigate(`/${role}`);
    } catch {
      setError('اسم المستخدم أو الباسورد غلط');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-bg">
      <div className="login-card">

        <div className="login-header">
          <a href="/" className="logo-link">
            <img src="/logo.png" alt="رياده كونكت" className="login-logo-img" />
          </a>
          <h1>رياده كونكت</h1>
          <p>نظام إدارة التوصيل</p>
        </div>

        <p className="role-section-label">اختر دورك</p>
        <div className="role-grid">
          {ROLES.map(r => (
            <button
              key={r.id}
              type="button"
              className={`role-btn${role === r.id ? ' active' : ''}`}
              onClick={() => setRole(r.id)}
            >
              <span className="role-icon">{r.icon}</span>
              <span className="role-label">{r.label}</span>
            </button>
          ))}
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="input-group">
            <label>الاسم</label>
            <input
              type="text"
              placeholder="أدخل اسمك"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoComplete="username"
            />
          </div>
          <div className="input-group">
            <label>الباسورد</label>
            <input
              type="password"
              placeholder="أدخل الباسورد"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          {error && <div className="error-msg">{error}</div>}

          <label className="remember-row">
            <input
              type="checkbox"
              checked={remember}
              onChange={e => setRemember(e.target.checked)}
            />
            <span>تذكر بياناتي</span>
          </label>

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'جاري الدخول...' : 'دخول  🔐'}
          </button>
        </form>

        <div className="login-footer">
          <p>جميع الحقوق محفوظة © 2026</p>
          <p>برمجة وتصميم قسم الـ IT مذخر الريادة</p>
          <p className="login-footer-dev">MaRWaN</p>
        </div>

      </div>
    </div>
  );
}
