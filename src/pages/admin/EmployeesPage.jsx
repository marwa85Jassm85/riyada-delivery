import { useState, useEffect } from 'react';
import { supabase } from '../../supabase';
import { adminCreateUser, adminDeleteUser, adminUpdatePassword } from '../../utils/adminAuth';
import { useAuth } from '../../contexts/AuthContext';
import { playSuccess, playDelete } from '../../utils/sound';

const EMPTY_ADD = { username: '', password: '', name: '', phone: '', role: 'employee' };
const USERNAME_RE = /^[a-z0-9._-]+$/;

const ROLE_OPTIONS = [
  { value: 'employee', label: 'موظف',  icon: '👨‍💼' },
  { value: 'admin',    label: 'إداره', icon: '🔑'   },
];

function roleBadge(role) {
  if (role === 'admin') return <span className="badge-role badge-admin">🔑 إداره</span>;
  return <span className="badge-role badge-employee">👨‍💼 موظف</span>;
}

export default function EmployeesPage() {
  const { currentUser } = useAuth();
  const [employees, setEmployees]         = useState([]);
  const [loading, setLoading]             = useState(true);
  const [showModal, setShowModal]         = useState(false);
  const [editing, setEditing]             = useState(null);
  const [form, setForm]                   = useState(EMPTY_ADD);
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting]           = useState(false);
  const [showPass, setShowPass]           = useState(false);
  const [showNewPass, setShowNewPass]     = useState(false);

  useEffect(() => { fetchEmployees(); }, []);

  async function fetchEmployees() {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, name, phone, role, active, username')
      .in('role', ['employee', 'admin'])
      .order('name');
    if (error) {
      console.error('fetchEmployees:', error.message);
      // لا نمسح القائمة الموجودة عند الفشل
    } else {
      setEmployees(data || []);
    }
    setLoading(false);
  }

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_ADD);
    setError('');
    setConfirmDelete(false);
    setShowModal(true);
  }

  function openEdit(e) {
    setEditing(e);
    setForm({ name: e.name || '', phone: e.phone || '', newPassword: '' });
    setError('');
    setConfirmDelete(false);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setConfirmDelete(false);
    setError('');
  }

  function setField(key, val) {
    setForm(f => ({ ...f, [key]: val }));
  }

  async function save() {
    setError('');
    if (!form.name.trim()) { setError('الاسم مطلوب'); return; }
    setSaving(true);
    try {
      if (editing) {
        // تحديث البيانات الأساسية
        const { error: e } = await supabase
          .from('profiles')
          .update({ name: form.name.trim(), phone: form.phone.trim() })
          .eq('id', editing.id);
        if (e) throw e;

        // تغيير كلمة المرور إذا أُدخلت
        if (form.newPassword.trim()) {
          if (form.newPassword.trim().length < 6) {
            setError('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل');
            setSaving(false); return;
          }
          await adminUpdatePassword(editing.id, form.newPassword.trim());
        }
      } else {
        if (!form.username.trim()) { setError('اسم المستخدم مطلوب'); setSaving(false); return; }
        if (!USERNAME_RE.test(form.username.trim())) { setError('اسم المستخدم: حروف إنجليزية وأرقام فقط، بدون مسافات'); setSaving(false); return; }
        if (form.password.trim().length < 6) { setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل'); setSaving(false); return; }

        const role  = form.role;
        const email = `${role}.${form.username.trim()}@riyada.app`;

        const authData = await adminCreateUser({ email, password: form.password.trim() });
        const userId   = authData.id;
        if (!userId) throw new Error('فشل إنشاء الحساب');

        const { error: pe } = await supabase.from('profiles').insert({
          id:       userId,
          name:     form.name.trim(),
          role:     role,
          phone:    form.phone.trim(),
          active:   true,
          username: form.username.trim(),
        });
        if (pe) {
          await adminDeleteUser(userId).catch(() => {});
          throw pe;
        }
        playSuccess(); closeModal(); fetchEmployees();
        return;
      }
      playSuccess(); closeModal(); fetchEmployees();
    } catch (e) {
      setError(e.message || 'حدث خطأ، حاول مرة أخرى');
    } finally {
      setSaving(false);
    }
  }

  async function deleteEmployee() {
    setDeleting(true);
    try {
      await adminDeleteUser(editing.id);
      await supabase.from('profiles').delete().eq('id', editing.id);
      playDelete();
      setEmployees(prev => prev.filter(x => x.id !== editing.id));
      closeModal();
    } catch (e) {
      setError('فشل الحذف: ' + (e.message || 'حاول مرة أخرى'));
    }
    setDeleting(false);
  }

  async function toggleActive(emp) {
    const { error } = await supabase.from('profiles').update({ active: !emp.active }).eq('id', emp.id);
    if (error) { alert('فشل تغيير الحالة — حاول مرة أخرى'); return; }
    setEmployees(prev => prev.map(x => x.id === emp.id ? { ...x, active: !x.active } : x));
  }

  return (
    <div className="sub-page">
      <div className="sub-page-header">
        <div className="sub-page-title">👨‍💼 الموظفون <span className="sub-count">({employees.length})</span></div>
        <button className="btn-add" onClick={openAdd}>+ إضافة</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 30 }}>
          <div className="spinner" style={{ margin: '0 auto', borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} />
        </div>
      ) : employees.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">👨‍💼</div>
          <p>لا يوجد موظفون بعد</p>
          <p style={{ fontSize: 13, marginTop: 6 }}>اضغط «+ إضافة» لإضافة أول موظف</p>
        </div>
      ) : (
        <div className="items-list">
          {employees.map(emp => (
            <div key={emp.id} className={`item-card${!emp.active ? ' item-inactive' : ''}`}>
              <div className="item-card-body">
                <div className="item-name">{emp.name}</div>
                {emp.phone   && <div className="item-meta">📞 {emp.phone}</div>}
                <div style={{ marginTop: 4 }}>{roleBadge(emp.role)}</div>
                {!emp.active && <span className="badge-inactive">غير نشط</span>}
              </div>
              <div className="item-actions">
                <button className="btn-icon" title="تعديل" onClick={() => openEdit(emp)}>✏️</button>
                {emp.id !== currentUser?.id && (
                  <button className="btn-icon" title={emp.active ? 'إيقاف' : 'تفعيل'} onClick={() => toggleActive(emp)}>
                    {emp.active ? '🔴' : '🟢'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-handle" />
            <div className="modal-title">
              {editing ? '✏️ تعديل البيانات' : '➕ إضافة حساب جديد'}
            </div>

            {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}

            {confirmDelete ? (
              <div className="delete-confirm-box">
                <div className="delete-confirm-text">
                  هل أنت متأكد من حذف <strong>{editing?.name}</strong>؟
                </div>
                <div className="modal-actions">
                  <button className="btn-danger" onClick={deleteEmployee} disabled={deleting}>
                    {deleting ? 'جاري الحذف...' : '🗑️ نعم، احذف'}
                  </button>
                  <button className="btn-outline" onClick={() => setConfirmDelete(false)}>إلغاء</button>
                </div>
              </div>
            ) : (
              <>
                <div className="modal-form">
                  {!editing && (
                    <>
                      {/* ── اختيار الدور ── */}
                      <div className="input-group">
                        <label>الدور *</label>
                        <div className="role-toggle">
                          {ROLE_OPTIONS.map(r => (
                            <button
                              key={r.value}
                              type="button"
                              className={`role-toggle-btn${form.role === r.value ? ' active' : ''}`}
                              onClick={() => setField('role', r.value)}
                            >
                              {r.icon} {r.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="input-group">
                        <label>اسم المستخدم *</label>
                        <input
                          value={form.username}
                          onChange={e => setField('username', e.target.value)}
                          placeholder="بالإنجليزي فقط (مثال: ali)"
                          dir="ltr"
                        />
                      </div>
                      <div className="input-group">
                        <label>كلمة المرور *</label>
                        <div style={{ position: 'relative' }}>
                          <input
                            type={showPass ? 'text' : 'password'}
                            value={form.password}
                            onChange={e => setField('password', e.target.value)}
                            placeholder="6 أحرف على الأقل"
                            style={{ paddingLeft: 44 }}
                          />
                          <button type="button" onClick={() => setShowPass(s => !s)} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-secondary)', padding: '4px' }}>{showPass ? '🙈' : '👁️'}</button>
                        </div>
                      </div>
                      <div className="modal-divider" />
                    </>
                  )}
                  {/* اسم المستخدم — قراءة فقط عند التعديل */}
                  {editing && (
                    <div className="input-group">
                      <label>اسم المستخدم (للدخول)</label>
                      <input
                        value={editing.username || '—'}
                        readOnly
                        dir="ltr"
                        style={{ background: 'var(--bg)', color: 'var(--text-secondary)', cursor: 'default' }}
                      />
                    </div>
                  )}
                  <div className="input-group">
                    <label>الاسم الكامل *</label>
                    <input
                      value={form.name}
                      onChange={e => setField('name', e.target.value)}
                      placeholder="الاسم الكامل"
                    />
                  </div>
                  <div className="input-group">
                    <label>رقم الهاتف</label>
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={e => setField('phone', e.target.value)}
                      placeholder="07X XXXX XXXX"
                    />
                  </div>
                  {/* تغيير كلمة المرور — فقط عند التعديل */}
                  {editing && (
                    <div className="input-group">
                      <label>كلمة مرور جديدة</label>
                      <div style={{ position: 'relative' }}>
                        <input
                          type={showNewPass ? 'text' : 'password'}
                          value={form.newPassword}
                          onChange={e => setField('newPassword', e.target.value)}
                          placeholder="اتركها فارغة إذا لا تريد تغييرها"
                          style={{ paddingLeft: 44 }}
                        />
                        <button type="button" onClick={() => setShowNewPass(s => !s)} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-secondary)', padding: '4px' }}>{showNewPass ? '🙈' : '👁️'}</button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="modal-actions">
                  <button className="btn-primary" onClick={save} disabled={saving}>
                    {saving ? 'جاري الحفظ...' : '💾 حفظ'}
                  </button>
                  {editing && editing.id !== currentUser?.id && (
                    <button className="btn-danger-outline" onClick={() => setConfirmDelete(true)}>
                      🗑️ حذف
                    </button>
                  )}
                  <button className="btn-outline" onClick={closeModal}>إلغاء</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
