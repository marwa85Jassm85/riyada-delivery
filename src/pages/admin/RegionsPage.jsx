import { useState, useEffect } from 'react';
import { supabase } from '../../supabase';
import { playSuccess, playDelete } from '../../utils/sound';

const EMPTY = { name: '' };

export default function RegionsPage() {
  const [regions, setRegions]             = useState([]);
  const [loading, setLoading]             = useState(true);
  const [showModal, setShowModal]         = useState(false);
  const [editing, setEditing]             = useState(null);
  const [form, setForm]                   = useState(EMPTY);
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting]           = useState(false);

  useEffect(() => { fetchRegions(); }, []);

  async function fetchRegions() {
    setLoading(true);
    const { data } = await supabase.from('regions').select('*').order('name');
    setRegions(data || []);
    setLoading(false);
  }

  function openAdd() {
    setEditing(null); setForm(EMPTY); setError(''); setConfirmDelete(false); setShowModal(true);
  }
  function openEdit(r) {
    setEditing(r); setForm({ name: r.name }); setError(''); setConfirmDelete(false); setShowModal(true);
  }
  function closeModal() { setShowModal(false); setConfirmDelete(false); setError(''); }

  async function save() {
    setError('');
    if (!form.name.trim()) { setError('اسم المنطقة مطلوب'); return; }
    setSaving(true);
    try {
      if (editing) {
        const { error: e } = await supabase.from('regions').update({ name: form.name.trim() }).eq('id', editing.id);
        if (e) throw e;
      } else {
        const { error: e } = await supabase.from('regions').insert({ name: form.name.trim() });
        if (e) {
          if (e.code === '23505') throw new Error('هذه المنطقة موجودة مسبقاً');
          throw e;
        }
      }
      playSuccess(); closeModal(); fetchRegions();
    } catch (e) { setError(e.message || 'حدث خطأ'); }
    finally { setSaving(false); }
  }

  async function deleteRegion() {
    setDeleting(true);
    const { error: e } = await supabase.from('regions').delete().eq('id', editing.id);
    if (!e) { playDelete(); setRegions(prev => prev.filter(x => x.id !== editing.id)); closeModal(); }
    else setError('فشل الحذف — تأكد أن المنطقة غير مرتبطة بصيدليات');
    setDeleting(false);
  }

  return (
    <div className="sub-page">
      <div className="sub-page-header">
        <div className="sub-page-title">🌍 المناطق <span className="sub-count">({regions.length})</span></div>
        <button className="btn-add" onClick={openAdd}>+ إضافة</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 30 }}>
          <div className="spinner" style={{ margin: '0 auto', borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} />
        </div>
      ) : regions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🌍</div>
          <p>لا توجد مناطق بعد</p>
          <p style={{ fontSize: 13, marginTop: 6 }}>اضغط «+ إضافة» لإضافة أول منطقة</p>
        </div>
      ) : (
        <div className="items-list">
          {regions.map(r => (
            <div key={r.id} className="item-card">
              <div className="item-card-body">
                <div className="item-name">🌍 {r.name}</div>
              </div>
              <div className="item-actions">
                <button className="btn-icon" title="تعديل" onClick={() => openEdit(r)}>✏️</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-handle" />
            <div className="modal-title">{editing ? '✏️ تعديل منطقة' : '🌍 إضافة منطقة جديدة'}</div>
            {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}
            {confirmDelete ? (
              <div className="delete-confirm-box">
                <div className="delete-confirm-text">حذف منطقة <strong>{editing?.name}</strong>؟</div>
                <div className="modal-actions">
                  <button className="btn-danger" onClick={deleteRegion} disabled={deleting}>
                    {deleting ? 'جاري الحذف...' : '🗑️ نعم، احذف'}
                  </button>
                  <button className="btn-outline" onClick={() => setConfirmDelete(false)}>إلغاء</button>
                </div>
              </div>
            ) : (
              <>
                <div className="modal-form">
                  <div className="input-group">
                    <label>اسم المنطقة *</label>
                    <input value={form.name} onChange={e => setForm({ name: e.target.value })} placeholder="مثال: الفلوجة" autoFocus />
                  </div>
                </div>
                <div className="modal-actions">
                  <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'جاري الحفظ...' : '💾 حفظ'}</button>
                  {editing && <button className="btn-danger-outline" onClick={() => setConfirmDelete(true)}>🗑️ حذف</button>}
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
