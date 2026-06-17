import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { supabase } from '../../supabase';
import { adminCreateUser, adminDeleteUser, adminUpdatePassword } from '../../utils/adminAuth';
import { playSuccess, playDelete } from '../../utils/sound';

// تحميل الخريطة بشكل lazy (ثقيلة نسبياً)
const DriverMap = lazy(() => import('../../components/DriverMap'));

const EMPTY_ADD  = { username: '', password: '', name: '', phone: '', car_type: '' };
const EMPTY_EDIT = { name: '', phone: '', car_type: '', newPassword: '' };
const USERNAME_RE = /^[a-z0-9._-]+$/;

export default function DriversPage() {
  const [drivers,         setDrivers]         = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [showModal,       setShowModal]       = useState(false);
  const [editing,         setEditing]         = useState(null);
  const [form,            setForm]            = useState(EMPTY_ADD);
  const [saving,          setSaving]          = useState(false);
  const [error,           setError]           = useState('');
  const [confirmDelete,   setConfirmDelete]   = useState(false);
  const [deleting,        setDeleting]        = useState(false);
  const [showPass,        setShowPass]        = useState(false);
  const [showNewPass,     setShowNewPass]     = useState(false);

  // تتبع الموقع
  const [driverLocations, setDriverLocations] = useState({}); // { [driver_id]: {lat,lng} }
  const [trackingDriver,  setTrackingDriver]  = useState(null); // { id, name, lat, lng }

  // اسم قناة فريد لكل mount — يمنع تعارض القنوات عند تبديل التبويبات
  const channelName = useRef(`admin-driver-locs-${Date.now()}`);

  useEffect(() => {
    fetchDrivers();
    fetchLocations();

    // Realtime — تحديثات مواقع السواق
    const ch = supabase.channel(channelName.current)
      .on('postgres_changes', {
        event:  '*',
        schema: 'public',
        table:  'driver_locations',
      }, payload => {
        if (payload.eventType === 'DELETE') {
          setDriverLocations(prev => {
            const copy = { ...prev };
            delete copy[payload.old?.driver_id];
            return copy;
          });
          // إذا كان السائق الذي حُذف موقعه هو المعروض، نغلق الخريطة
          setTrackingDriver(prev =>
            prev?.id === payload.old?.driver_id ? null : prev
          );
        } else {
          const { driver_id, lat, lng } = payload.new || {};
          if (driver_id) {
            setDriverLocations(prev => ({ ...prev, [driver_id]: { lat, lng } }));
            // تحديث الخريطة المفتوحة إن وُجدت
            setTrackingDriver(prev =>
              prev?.id === driver_id ? { ...prev, lat, lng } : prev
            );
          }
        }
      })
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, []);

  async function fetchLocations() {
    const { data } = await supabase
      .from('driver_locations')
      .select('driver_id, lat, lng');
    if (data) {
      const map = {};
      data.forEach(d => { map[d.driver_id] = { lat: d.lat, lng: d.lng }; });
      setDriverLocations(map);
    }
  }

  async function fetchDrivers() {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, name, phone, car_type, active, username')
      .eq('role', 'driver')
      .order('name');
    if (error) {
      console.error('fetchDrivers:', error.message);
      // لا نمسح القائمة الموجودة عند الفشل
    } else {
      setDrivers(data || []);
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

  function openEdit(d) {
    setEditing(d);
    setForm({ name: d.name || '', phone: d.phone || '', car_type: d.car_type || '', newPassword: '' });
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
          .update({
            name:     form.name.trim(),
            phone:    form.phone.trim(),
            car_type: form.car_type.trim(),
          })
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
        if (!USERNAME_RE.test(form.username.trim())) {
          setError('اسم المستخدم: حروف إنجليزية وأرقام فقط، بدون مسافات');
          setSaving(false); return;
        }
        if (form.password.trim().length < 6) {
          setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
          setSaving(false); return;
        }

        const email = `driver.${form.username.trim()}@riyada.app`;
        const authData = await adminCreateUser({ email, password: form.password.trim() });
        const userId   = authData.id;
        if (!userId) throw new Error('فشل إنشاء الحساب');

        const { error: pe } = await supabase.from('profiles').insert({
          id:       userId,
          name:     form.name.trim(),
          role:     'driver',
          phone:    form.phone.trim(),
          car_type: form.car_type.trim(),
          active:   true,
          username: form.username.trim(),
        });
        if (pe) {
          await adminDeleteUser(userId).catch(() => {});
          throw pe;
        }
        playSuccess(); closeModal(); fetchDrivers();
        return;
      }
      playSuccess(); closeModal(); fetchDrivers();
    } catch (e) {
      setError(e.message || 'حدث خطأ، حاول مرة أخرى');
    } finally {
      setSaving(false);
    }
  }

  async function deleteDriver() {
    setDeleting(true);
    try {
      // احذف حساب الدخول أولاً (يحذف الجلسات تلقائياً)
      await adminDeleteUser(editing.id);
      // احذف الملف الشخصي (قد يكون حُذف تلقائياً بـ cascade — تجاهل الخطأ)
      await supabase.from('profiles').delete().eq('id', editing.id);
      playDelete();
      setDrivers(prev => prev.filter(x => x.id !== editing.id));
      closeModal();
    } catch (e) {
      setError('فشل الحذف: ' + (e.message || 'حاول مرة أخرى'));
    }
    setDeleting(false);
  }

  async function toggleActive(d) {
    const { error } = await supabase.from('profiles').update({ active: !d.active }).eq('id', d.id);
    if (error) { alert('فشل تغيير الحالة — حاول مرة أخرى'); return; }
    setDrivers(prev => prev.map(x => x.id === d.id ? { ...x, active: !x.active } : x));
  }

  function openTracking(d) {
    const loc = driverLocations[d.id];
    setTrackingDriver({ id: d.id, name: d.name, lat: loc?.lat, lng: loc?.lng });
  }

  const activeCount = drivers.filter(d => driverLocations[d.id]).length;

  return (
    <div className="sub-page">
      <div className="sub-page-header">
        <div className="sub-page-title">
          🚗 السواق <span className="sub-count">({drivers.length})</span>
          {activeCount > 0 && (
            <span className="drivers-live-count">{activeCount} على الطريق</span>
          )}
        </div>
        <button className="btn-add" onClick={openAdd}>+ إضافة</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 30 }}>
          <div className="spinner" style={{ margin: '0 auto', borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} />
        </div>
      ) : drivers.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🚗</div>
          <p>لا يوجد سواق بعد</p>
          <p style={{ fontSize: 13, marginTop: 6 }}>اضغط «+ إضافة» لإضافة أول سائق</p>
        </div>
      ) : (
        <div className="items-list">
          {drivers.map(d => {
            const isLive = !!driverLocations[d.id];
            return (
              <div key={d.id} className={`item-card${!d.active ? ' item-inactive' : ''}`}>
                <div className="item-card-body">
                  <div className="item-name">
                    {d.name}
                    {isLive && <span className="driver-live-dot" title="على الطريق الآن" />}
                  </div>
                  {d.phone    && <div className="item-meta">📞 {d.phone}</div>}
                  {d.car_type && <div className="item-meta">🚙 {d.car_type}</div>}
                  {!d.active  && <span className="badge-inactive">غير نشط</span>}
                </div>
                <div className="item-actions">
                  {/* زر تتبع الموقع — يظهر دائماً لكن يتغير لونه حسب وجود موقع */}
                  <button
                    className={`btn-icon${isLive ? ' btn-icon-live' : ''}`}
                    title={isLive ? 'عرض الموقع الحالي' : 'السائق غير نشط الآن'}
                    onClick={() => openTracking(d)}
                  >
                    📍
                  </button>
                  {d.phone && (
                    <a href={`tel:${d.phone}`} className="btn-icon" title="اتصال">📞</a>
                  )}
                  <button className="btn-icon" title="تعديل" onClick={() => openEdit(d)}>✏️</button>
                  <button className="btn-icon" title={d.active ? 'إيقاف' : 'تفعيل'} onClick={() => toggleActive(d)}>
                    {d.active ? '🔴' : '🟢'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ══ مودال تعديل / إضافة السائق ══ */}
      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-handle" />
            <div className="modal-title">
              {editing ? '✏️ تعديل بيانات السائق' : '🚗 إضافة سائق جديد'}
            </div>

            {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}

            {confirmDelete ? (
              <div className="delete-confirm-box">
                <div className="delete-confirm-text">
                  هل أنت متأكد من حذف السائق <strong>{editing?.name}</strong>؟
                </div>
                <div className="modal-actions">
                  <button className="btn-danger" onClick={deleteDriver} disabled={deleting}>
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
                      <div className="input-group">
                        <label>اسم المستخدم *</label>
                        <input
                          value={form.username}
                          onChange={e => setField('username', e.target.value)}
                          placeholder="بالإنجليزي فقط (مثال: ahmad)"
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
                      placeholder="اسم السائق"
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
                  <div className="input-group">
                    <label>نوع السيارة</label>
                    <input
                      value={form.car_type}
                      onChange={e => setField('car_type', e.target.value)}
                      placeholder="مثال: كيا سيراتو 2020"
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
                  {editing && (
                    <button className="btn-danger-outline" onClick={() => setConfirmDelete(true)}>
                      🗑️ حذف السائق
                    </button>
                  )}
                  <button className="btn-outline" onClick={closeModal}>إلغاء</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ══ مودال خريطة موقع السائق ══ */}
      {trackingDriver && (
        <div className="modal-overlay" onClick={() => setTrackingDriver(null)}>
          <div className="modal-sheet modal-sheet-tall" onClick={e => e.stopPropagation()}>
            <div className="modal-handle" />
            <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              📍 موقع {trackingDriver.name}
              {driverLocations[trackingDriver.id] && (
                <span className="map-live-badge">● مباشر</span>
              )}
            </div>

            {/* الخريطة */}
            <div style={{ margin: '12px 0', borderRadius: 12, overflow: 'hidden' }}>
              <Suspense fallback={
                <div className="map-waiting">
                  <div className="spinner" style={{ margin: '0 auto', borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} />
                </div>
              }>
                <DriverMap
                  lat={trackingDriver.lat}
                  lng={trackingDriver.lng}
                  driverName={trackingDriver.name}
                  height={300}
                />
              </Suspense>
            </div>

            {/* معلومات السائق */}
            {(() => {
              const drv = drivers.find(d => d.id === trackingDriver.id);
              return drv ? (
                <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
                  {drv.car_type && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>🚙 {drv.car_type}</div>}
                  {drv.phone   && (
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                      📞 {drv.phone}
                      <a href={`tel:${drv.phone}`} className="pharm-call-btn" style={{ marginRight: 8, fontSize: 12, padding: '4px 12px' }}>
                        اتصل
                      </a>
                    </div>
                  )}
                  {!driverLocations[trackingDriver.id] && (
                    <div className="map-https-notice" style={{ marginTop: 8 }}>
                      📍 السائق غير نشط حالياً — لا يوجد موقع محدّث
                    </div>
                  )}
                </div>
              ) : null;
            })()}

            <div className="modal-actions">
              <button className="btn-outline" onClick={() => setTrackingDriver(null)}>إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
