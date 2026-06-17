import { useState, useEffect } from 'react';
import { supabase } from '../../supabase';
import { adminCreateUser, adminDeleteUser } from '../../utils/adminAuth';
import { playSuccess, playDelete } from '../../utils/sound';

const EMPTY = { username: '', password: '', name: '', owner_name: '', phone: '', telegram_chat_id: '', address: '', map_link: '', region_id: '', region_name: '' };
const USERNAME_RE = /^[a-z0-9._-]+$/;

export default function PharmaciesPage() {
  const [pharmacies, setPharmacies]       = useState([]);
  const [regions, setRegions]             = useState([]);
  const [loading, setLoading]             = useState(true);
  const [search, setSearch]               = useState('');
  const [showModal, setShowModal]         = useState(false);
  const [editing, setEditing]             = useState(null);
  const [form, setForm]                   = useState(EMPTY);
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting]           = useState(false);

  useEffect(() => { fetchPharmacies(); fetchRegions(); }, []);

  async function fetchPharmacies() {
    setLoading(true);
    const { data } = await supabase.from('pharmacies').select('*').order('name');
    setPharmacies(data || []);
    setLoading(false);
  }

  async function fetchRegions() {
    const { data } = await supabase.from('regions').select('id, name').order('name');
    setRegions(data || []);
  }

  function setField(key, val) {
    if (key === 'region_id') {
      const r = regions.find(x => x.id === val);
      setForm(f => ({ ...f, region_id: val, region_name: r?.name || '' }));
    } else {
      setForm(f => ({ ...f, [key]: val }));
    }
  }

  function openAdd() {
    setEditing(null); setForm(EMPTY); setError(''); setConfirmDelete(false); setShowModal(true);
  }

  function openEdit(p) {
    setEditing(p);
    setForm({
      username: '', password: '',
      name: p.name || '', owner_name: p.owner_name || '',
      phone: p.phone || '',
      telegram_chat_id: p.telegram_chat_id || '',
      address: p.address || '', map_link: p.map_link || '',
      region_id: p.region_id || '', region_name: p.region_name || '',
    });
    setError(''); setConfirmDelete(false); setShowModal(true);
  }

  function closeModal() { setShowModal(false); setConfirmDelete(false); setError(''); }

  async function save() {
    setError('');
    if (!form.name.trim() || !form.phone.trim()) { setError('اسم الصيدلية والهاتف مطلوبان'); return; }

    if (!editing) {
      if (!form.username.trim()) { setError('اسم المستخدم مطلوب'); return; }
      if (!USERNAME_RE.test(form.username.trim())) { setError('اسم المستخدم: حروف إنجليزية وأرقام فقط، بدون مسافات'); return; }
      if (form.password.trim().length < 6) { setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل'); return; }
    }

    setSaving(true);
    try {
      const regionPayload = {
        region_id:   form.region_id   || null,
        region_name: form.region_name || null,
      };

      if (editing) {
        const { error: e } = await supabase.from('pharmacies').update({
          name: form.name.trim(), owner_name: form.owner_name.trim(),
          phone: form.phone.trim(),
          telegram_chat_id: form.telegram_chat_id.trim() || null,
          address: form.address.trim(), map_link: form.map_link.trim(),
          ...regionPayload,
        }).eq('id', editing.id);
        if (e) throw e;
      } else {
        const email    = `pharmacist.${form.username.trim()}@riyada.app`;
        const authData = await adminCreateUser({ email, password: form.password.trim() });
        const userId   = authData.id;
        if (!userId) throw new Error('فشل إنشاء الحساب');

        const { data: pharData, error: pharErr } = await supabase
          .from('pharmacies')
          .insert({ name: form.name.trim(), owner_name: form.owner_name.trim(), phone: form.phone.trim(), telegram_chat_id: form.telegram_chat_id.trim() || null, address: form.address.trim(), map_link: form.map_link.trim(), active: true, ...regionPayload })
          .select('id').single();
        if (pharErr) {
          await adminDeleteUser(userId).catch(() => {});
          throw pharErr;
        }

        const { error: profErr } = await supabase.from('profiles').insert({
          id: userId, name: form.owner_name.trim() || form.name.trim(),
          role: 'pharmacist', phone: form.phone.trim(), pharmacy_id: pharData.id, active: true,
        });
        if (profErr) {
          await supabase.from('pharmacies').delete().eq('id', pharData.id);
          await adminDeleteUser(userId).catch(() => {});
          throw new Error('فشل إنشاء الملف الشخصي — حاول مجدداً');
        }
      }
      playSuccess(); closeModal(); fetchPharmacies();
    } catch (e) { setError(e.message || 'حدث خطأ، حاول مرة أخرى'); }
    finally { setSaving(false); }
  }

  async function deletePharmacy() {
    setDeleting(true);
    try {
      // احذف أولاً الـ profile المرتبط بهذه الصيدلية
      const { data: profRow } = await supabase
        .from('profiles')
        .select('id')
        .eq('pharmacy_id', editing.id)
        .maybeSingle();

      if (profRow?.id) {
        // احذف حساب الدخول من Auth (يحذف الجلسات تلقائياً)
        await adminDeleteUser(profRow.id).catch(() => {});
        // احذف الـ profile
        await supabase.from('profiles').delete().eq('id', profRow.id);
      }

      // ثم احذف الصيدلية
      const { error: pharErr } = await supabase.from('pharmacies').delete().eq('id', editing.id);
      if (pharErr) throw pharErr;

      playDelete();
      setPharmacies(prev => prev.filter(x => x.id !== editing.id));
      closeModal();
    } catch (e) {
      setError('فشل الحذف: ' + (e.message || 'حاول مرة أخرى'));
    }
    setDeleting(false);
  }

  async function toggleActive(p) {
    const { error } = await supabase.from('pharmacies').update({ active: !p.active }).eq('id', p.id);
    if (error) { alert('فشل تغيير الحالة — حاول مرة أخرى'); return; }
    setPharmacies(prev => prev.map(x => x.id === p.id ? { ...x, active: !x.active } : x));
  }

  const filtered = pharmacies.filter(p =>
    (p.name || '').includes(search) || (p.owner_name || '').includes(search) || (p.phone || '').includes(search)
  );

  return (
    <div className="sub-page">
      <div className="sub-page-header">
        <div className="sub-page-title">🏥 الصيدليات <span className="sub-count">({pharmacies.length})</span></div>
        <button className="btn-add" onClick={openAdd}>+ إضافة</button>
      </div>

      <input className="search-input" type="text" placeholder="🔍 بحث بالاسم أو المالك أو الهاتف..." value={search} onChange={e => setSearch(e.target.value)} />

      {loading ? (
        <div style={{ textAlign: 'center', padding: 30 }}>
          <div className="spinner" style={{ margin: '0 auto', borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🏥</div>
          <p>{search ? 'لا توجد نتائج مطابقة' : 'لا توجد صيدليات بعد — أضف أول صيدلية'}</p>
        </div>
      ) : (
        <div className="items-list">
          {filtered.map(p => (
            <div key={p.id} className={`item-card${!p.active ? ' item-inactive' : ''}`}>
              <div className="item-card-body">
                <div className="item-name">{p.name}</div>
                {p.region_name && <div className="item-meta">🌍 {p.region_name}</div>}
                {p.owner_name  && <div className="item-meta">👤 {p.owner_name}</div>}
                {p.phone       && <div className="item-meta">📞 {p.phone}</div>}
                <div className="item-meta">{p.telegram_chat_id ? '✈️ تيليجرام مفعّل' : '⚠️ لم يُسجَّل تيليجرام'}</div>
                {p.address     && <div className="item-meta">📍 {p.address}</div>}
                {!p.active     && <span className="badge-inactive">غير نشط</span>}
              </div>
              <div className="item-actions">
                {p.phone && <a href={`tel:${p.phone}`} className="btn-icon" title="اتصال">📞</a>}
                <button className="btn-icon" title="تعديل" onClick={() => openEdit(p)}>✏️</button>
                <button className="btn-icon" title={p.active ? 'إيقاف' : 'تفعيل'} onClick={() => toggleActive(p)}>
                  {p.active ? '🔴' : '🟢'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-handle" />
            <div className="modal-title">{editing ? '✏️ تعديل صيدلية' : '🏥 إضافة صيدلية جديدة'}</div>
            {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}

            {confirmDelete ? (
              <div className="delete-confirm-box">
                <div className="delete-confirm-text">حذف صيدلية <strong>{editing?.name}</strong>؟</div>
                <div className="modal-actions">
                  <button className="btn-danger" onClick={deletePharmacy} disabled={deleting}>{deleting ? 'جاري الحذف...' : '🗑️ نعم، احذف'}</button>
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
                        <input value={form.username} onChange={e => setField('username', e.target.value)} placeholder="بالإنجليزي فقط (مثال: nakhba)" dir="ltr" />
                      </div>
                      <div className="input-group">
                        <label>كلمة المرور *</label>
                        <input type="password" value={form.password} onChange={e => setField('password', e.target.value)} placeholder="6 أحرف على الأقل" />
                      </div>
                      <div className="modal-divider" />
                    </>
                  )}
                  <div className="input-group">
                    <label>اسم الصيدلية *</label>
                    <input value={form.name} onChange={e => setField('name', e.target.value)} placeholder="اسم الصيدلية" />
                  </div>
                  <div className="input-group">
                    <label>المنطقة</label>
                    <select value={form.region_id} onChange={e => setField('region_id', e.target.value)}>
                      <option value="">— بدون منطقة —</option>
                      {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                  <div className="input-group">
                    <label>اسم المالك / المسؤول</label>
                    <input value={form.owner_name} onChange={e => setField('owner_name', e.target.value)} placeholder="اسم المالك" />
                  </div>
                  <div className="input-group">
                    <label>هاتف *</label>
                    <input type="tel" value={form.phone} onChange={e => setField('phone', e.target.value)} placeholder="07X XXXX XXXX" />
                  </div>
                  <div className="input-group">
                    <label>Telegram Chat ID</label>
                    <input value={form.telegram_chat_id} onChange={e => setField('telegram_chat_id', e.target.value)} placeholder="يُرسل بعد ما الصيدلاني يضغط Start بالبوت" dir="ltr" />
                  </div>
                  <div className="input-group">
                    <label>العنوان</label>
                    <input value={form.address} onChange={e => setField('address', e.target.value)} placeholder="العنوان التفصيلي" />
                  </div>
                  <div className="input-group">
                    <label>رابط الخريطة</label>
                    <input value={form.map_link} onChange={e => setField('map_link', e.target.value)} placeholder="https://maps.google.com/..." />
                  </div>
                </div>
                <div className="modal-actions">
                  <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'جاري الحفظ...' : '💾 حفظ'}</button>
                  {editing && <button className="btn-danger-outline" onClick={() => setConfirmDelete(true)}>🗑️ حذف الصيدلية</button>}
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
