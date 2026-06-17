import { useEffect, useState, lazy, Suspense } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase';
import { playAlert } from '../../utils/sound';
import { requestNotifyPermission, showNotify } from '../../utils/notify';

// تحميل الخريطة بشكل lazy (ثقيلة نسبياً)
const DriverMap = lazy(() => import('../../components/DriverMap'));

const TABS = [
  { id: 'active',    icon: '📦', label: 'طلبياتي'  },
  { id: 'archive',   icon: '📁', label: 'الأرشيف'  },
  { id: 'complaint', icon: '📣', label: 'شكوى'     },
];

const STATUS = {
  created:     { label: 'بانتظار السائق', icon: '🕐', color: 'var(--warning)', step: 0 },
  in_progress: { label: 'جاري التوصيل',  icon: '🚗', color: 'var(--primary)', step: 1 },
  delivered:   { label: 'تم التوصيل',    icon: '✅', color: 'var(--success)', step: 2 },
};

function formatDate(iso) {
  if (!iso) return '';
  const d     = new Date(iso);
  const day   = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year  = d.getFullYear();
  const time  = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${day}/${month}/${year} ${time}`;
}

export default function PharmacistDashboard() {
  const { userProfile, logout } = useAuth();
  const navigate = useNavigate();

  const [activeTab,  setActiveTab]  = useState('active');
  const [orders,     setOrders]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [driverInfo, setDriverInfo] = useState({}); // { [driver_id]: { phone, name } }

  // مواقع السواق في الوقت الفعلي
  const [driverLocations, setDriverLocations] = useState({}); // { [driver_id]: { lat, lng } }

  // أرشيف
  const [archOrders,  setArchOrders]  = useState([]);
  const [loadingArch, setLoadingArch] = useState(false);
  const [archFetched, setArchFetched] = useState(false);
  const [archFrom,    setArchFrom]    = useState('');
  const [archTo,      setArchTo]      = useState('');

  // الشكاوى
  const [complaintMsg,         setComplaintMsg]         = useState('');
  const [sendingComplaint,     setSendingComplaint]     = useState(false);
  const [complaintSent,        setComplaintSent]        = useState(false);
  const [myComplaints,         setMyComplaints]         = useState([]);
  const [loadingMyComplaints,  setLoadingMyComplaints]  = useState(false);
  const [complaintsFetched,    setComplaintsFetched]    = useState(false);

  const handleLogout = async () => { await logout(); navigate('/login'); };

  useEffect(() => { requestNotifyPermission(); }, []);

  useEffect(() => {
    if (!userProfile?.pharmacy_id) return;
    fetchOrders();

    // Realtime — تحديثات الطلبيات
    const ordCh = supabase.channel(`pharmacist-orders-${userProfile.pharmacy_id}`)
      .on('postgres_changes', {
        event:  'UPDATE',
        schema: 'public',
        table:  'orders',
        filter: `pharmacy_id=eq.${userProfile.pharmacy_id}`,
      }, payload => {
        const ns = payload.new?.status, os = payload.old?.status;
        if (ns === 'in_progress' && os === 'created') {
          playAlert();
          showNotify('🚗 طلبيتك في الطريق!', 'السائق استلم الطلبية');
        } else if (ns === 'delivered' && os === 'in_progress') {
          playAlert();
          showNotify('✅ وصلت طلبيتك!', 'تم التوصيل بنجاح');
        }
        fetchOrders();
      })
      .on('postgres_changes', {
        event:  'UPDATE',
        schema: 'public',
        table:  'complaints',
        filter: `pharmacy_id=eq.${userProfile.pharmacy_id}`,
      }, payload => {
        const upd = payload.new;
        if (!upd?.id) return;
        // حدّث حالة الشكوى في القائمة مباشرة (إن كانت معروضة)
        setMyComplaints(prev =>
          prev.map(c => c.id === upd.id ? { ...c, status: upd.status } : c)
        );
        if (upd.status === 'resolved') {
          playAlert();
          showNotify('✅ تمت معالجة شكواك', 'اطّلع على التفاصيل');
        }
      })
      .subscribe();

    // Realtime — مواقع السواق
    const locCh = supabase.channel('driver-locations-watch')
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
        } else {
          const { driver_id, lat, lng } = payload.new || {};
          if (driver_id) {
            setDriverLocations(prev => ({ ...prev, [driver_id]: { lat, lng } }));
          }
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ordCh);
      supabase.removeChannel(locCh);
    };
  }, [userProfile?.pharmacy_id]);

  useEffect(() => {
    if (activeTab === 'archive' && !archFetched) fetchArchive();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'complaint' && !complaintsFetched) fetchMyComplaints();
  }, [activeTab]);

  async function fetchOrders() {
    if (!userProfile?.pharmacy_id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('orders')
      .select('id, invoice_numbers, packages_note, driver_id, driver_name, region_name, status, created_at, delivered_at, notes, delivery_photos, return_status, delivery_notes')
      .eq('pharmacy_id', userProfile.pharmacy_id)
      .is('deleted_at', null)
      .in('status', ['created', 'in_progress'])
      .order('created_at', { ascending: false });

    if (error) {
      console.error('fetchOrders error:', error.message);
      setLoading(false);
      return; // لا نمسح البيانات الموجودة عند الفشل
    }
    const orders = data || [];
    setOrders(orders);
    setLoading(false);

    // جلب مواقع السواق الحاليين
    const driverIds = [...new Set(orders.filter(o => o.driver_id && o.status === 'in_progress').map(o => o.driver_id))];
    if (driverIds.length) fetchDriverLocations(driverIds);

    // جلب أرقام هواتف السواق
    fetchDriverPhones(orders);
  }

  async function fetchDriverLocations(driverIds) {
    const { data } = await supabase
      .from('driver_locations')
      .select('driver_id, lat, lng')
      .in('driver_id', driverIds);
    if (data) {
      const map = {};
      data.forEach(d => { map[d.driver_id] = { lat: d.lat, lng: d.lng }; });
      setDriverLocations(prev => ({ ...prev, ...map }));
    }
  }

  async function fetchDriverPhones(orders) {
    const ids = [...new Set(orders.filter(o => o.driver_id).map(o => o.driver_id))];
    if (!ids.length) return;
    const { data } = await supabase
      .from('profiles')
      .select('id, name, phone')
      .in('id', ids);
    if (data) {
      const map = {};
      data.forEach(d => { map[d.id] = { name: d.name, phone: d.phone }; });
      setDriverInfo(map);
    }
  }

  async function fetchArchive() {
    setLoadingArch(true);
    let q = supabase
      .from('orders')
      .select('id, invoice_numbers, packages_note, driver_name, region_name, status, created_at, delivered_at, notes, delivery_photos, return_status, delivery_notes')
      .eq('pharmacy_id', userProfile.pharmacy_id)
      .eq('status', 'delivered')
      .is('deleted_at', null)
      .order('delivered_at', { ascending: false })
      .limit(100);
    if (archFrom) { const d = new Date(archFrom); d.setHours(0,0,0,0);       q = q.gte('delivered_at', d.toISOString()); }
    if (archTo)   { const d = new Date(archTo);   d.setHours(23,59,59,999);  q = q.lte('delivered_at', d.toISOString()); }
    const { data } = await q;
    setArchOrders(data || []);
    setArchFetched(true);
    setLoadingArch(false);
  }

  async function fetchMyComplaints() {
    if (!userProfile?.pharmacy_id) return;
    setLoadingMyComplaints(true);
    const { data } = await supabase
      .from('complaints')
      .select('id, message, status, created_at')
      .eq('pharmacy_id', userProfile.pharmacy_id)
      .order('created_at', { ascending: false })
      .limit(50);
    setMyComplaints(data || []);
    setComplaintsFetched(true);
    setLoadingMyComplaints(false);
  }

  async function sendComplaint() {
    if (!complaintMsg.trim()) return;
    setSendingComplaint(true);
    // جلب اسم الصيدلية الحقيقي (profile.name يحمل اسم المالك وليس اسم الصيدلية)
    let pharName = userProfile.name || null;
    try {
      const { data: pharRow } = await supabase
        .from('pharmacies')
        .select('name')
        .eq('id', userProfile.pharmacy_id)
        .maybeSingle();
      if (pharRow?.name) pharName = pharRow.name;
    } catch (_) { /* نستخدم الاسم الاحتياطي */ }

    const { error } = await supabase.from('complaints').insert({
      pharmacy_id:    userProfile.pharmacy_id,
      pharmacy_name:  pharName,
      pharmacy_phone: userProfile.phone || null,
      message:        complaintMsg.trim(),
      status:         'new',
    });
    setSendingComplaint(false);
    if (!error) {
      setComplaintMsg('');
      setComplaintSent(true);
      setTimeout(() => setComplaintSent(false), 4000);
      setComplaintsFetched(false);
      fetchMyComplaints();
    } else {
      // نعرض الخطأ الحقيقي لتسهيل التشخيص
      const msg = error.code === '42P01'
        ? 'جدول الشكاوى غير موجود — شغّل SQL الإنشاء في Supabase'
        : error.code === '42501' || error.message?.includes('row-level security')
        ? 'خطأ صلاحيات — أضف policy للجدول في Supabase'
        : `فشل إرسال الشكوى: ${error.message}`;
      alert(msg);
    }
  }

  const activeOrders = orders;

  return (
    <div className="dashboard role-pharmacist">
      <div className="accent-bar" />

      <div className="top-bar">
        <div className="top-bar-right">
          <span style={{ fontSize: 28 }}>💊</span>
          <div>
            <div className="top-bar-title">{userProfile?.name || 'الصيدلية'}</div>
            <div className="top-bar-subtitle">تتبع طلبياتك</div>
          </div>
        </div>
        <button className="btn-outline" onClick={handleLogout}>خروج</button>
      </div>

      <div className="page-content" style={{ paddingBottom: 80 }}>

        {/* ══ الأرشيف ══ */}
        {activeTab === 'archive' && (
          <div className="sub-page">
            <div className="date-range-card" style={{ marginBottom: 10 }}>
              <div className="date-range-title">📅 فلترة بتاريخ التوصيل</div>
              <div className="date-range-row">
                <div className="date-field"><label>من</label><input type="date" value={archFrom} onChange={e => setArchFrom(e.target.value)} /></div>
                <div className="date-range-arrow">←</div>
                <div className="date-field"><label>إلى</label><input type="date" value={archTo} onChange={e => setArchTo(e.target.value)} /></div>
              </div>
              <button className="btn-primary" style={{ marginTop: 10, width: '100%' }}
                onClick={() => { setArchFetched(false); fetchArchive(); }}>🔍 بحث</button>
            </div>

            {loadingArch ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <div className="spinner" style={{ margin: '0 auto', borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} />
              </div>
            ) : archOrders.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">📁</div><p>لا توجد طلبيات في هذه الفترة</p></div>
            ) : (
              <div className="orders-list">
                {archOrders.map(o => (
                  <div key={o.id} className="order-card" style={{ borderRight: '4px solid var(--success)' }}>
                    <div className="order-card-header">
                      <div className="order-invoices" style={{ margin: 0 }}>
                        {(o.invoice_numbers || []).map((inv, i) => <span key={i} className="invoice-chip">#{inv}</span>)}
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 700 }}>✅ تم التوصيل</span>
                    </div>
                    <div className="order-meta">
                      {o.driver_name   && <div className="order-meta-item"><span className="order-meta-icon">🚗</span><span>{o.driver_name}</span></div>}
                      {o.packages_note && <div className="order-meta-item"><span className="order-meta-icon">📦</span><span>{o.packages_note}</span></div>}
                      {o.delivered_at  && <div className="order-meta-item"><span className="order-meta-icon">✅</span><span>وصل: {formatDate(o.delivered_at)}</span></div>}
                      {o.return_status && <div className="order-meta-item"><span className="order-meta-icon">⚠️</span><span style={{ color: 'var(--danger)', fontWeight: 600 }}>يوجد مردودات</span></div>}
                      {o.delivery_notes && <div className="order-meta-item"><span className="order-meta-icon">📝</span><span>{o.delivery_notes}</span></div>}
                    </div>
                    {o.delivery_photos?.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                        {o.delivery_photos.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noreferrer">
                            <img src={url} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ الشكوى ══ */}
        {activeTab === 'complaint' && (
          <div className="sub-page">

            {/* ── إرسال شكوى جديدة ── */}
            <div className="complaint-send-box">
              <div className="sub-page-title" style={{ marginBottom: 12 }}>📣 إرسال شكوى للإدارة</div>
              {complaintSent && (
                <div className="success-msg">✅ تم إرسال شكواك بنجاح — سنتواصل معك قريباً</div>
              )}
              <div className="input-group">
                <label>رسالة الشكوى *</label>
                <textarea
                  value={complaintMsg}
                  onChange={e => setComplaintMsg(e.target.value)}
                  placeholder="اكتب تفاصيل شكواك هنا..."
                  rows={4}
                  style={{ resize: 'none' }}
                />
              </div>
              <button
                className="btn-primary"
                style={{ width: '100%', marginTop: 8 }}
                onClick={sendComplaint}
                disabled={sendingComplaint || !complaintMsg.trim()}
              >
                {sendingComplaint ? 'جاري الإرسال...' : '📤 إرسال الشكوى'}
              </button>
            </div>

            {/* ── شكاواي السابقة ── */}
            <div style={{ marginTop: 20 }}>
              <div className="sub-page-title" style={{ marginBottom: 8 }}>📋 شكاواي السابقة</div>
              {loadingMyComplaints ? (
                <div style={{ textAlign: 'center', padding: 20 }}>
                  <div className="spinner" style={{ margin: '0 auto', borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} />
                </div>
              ) : myComplaints.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--text-secondary)', fontSize: 13 }}>
                  لا توجد شكاوى سابقة
                </div>
              ) : (
                <div className="items-list">
                  {myComplaints.map(c => {
                    const statusMap = {
                      new:        { label: 'جديدة',          icon: '🆕', color: 'var(--warning)' },
                      processing: { label: 'جاري المعالجة', icon: '⚙️', color: 'var(--primary)' },
                      resolved:   { label: 'تمت المعالجة',  icon: '✅', color: 'var(--success)' },
                    };
                    const si = statusMap[c.status] || { label: c.status, icon: '❓', color: 'var(--text-secondary)' };
                    return (
                      <div key={c.id} className={`complaint-card complaint-card-${c.status}`}>
                        <div className="complaint-header">
                          <span className="complaint-date">🕐 {formatDate(c.created_at)}</span>
                          <span className="complaint-status-badge" style={{ color: si.color }}>
                            {si.icon} {si.label}
                          </span>
                        </div>
                        <div className="complaint-message">{c.message}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ طلبياتي النشطة ══ */}
        {activeTab === 'active' && (
          <>
            {/* إحصاء */}
            <div className="emp-stat-row">
              <div className="emp-stat-card">
                <div className="emp-stat-num">{activeOrders.filter(o => o.status === 'created').length}</div>
                <div className="emp-stat-lbl">بانتظار السائق</div>
              </div>
              <div className="emp-stat-card">
                <div className="emp-stat-num" style={{ color: 'var(--primary)' }}>{activeOrders.filter(o => o.status === 'in_progress').length}</div>
                <div className="emp-stat-lbl">جاري التوصيل</div>
              </div>
            </div>

            {loading ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <div className="spinner" style={{ margin: '0 auto', borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} />
              </div>
            ) : activeOrders.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📭</div>
                <p>لا توجد طلبيات نشطة حالياً</p>
              </div>
            ) : (
              <div className="orders-list">
                {activeOrders.map(o => {
                  const sl  = STATUS[o.status] || STATUS.created;
                  const loc = driverLocations[o.driver_id];
                  const drv = driverInfo[o.driver_id];
                  return (
                    <div key={o.id} className="order-card pharm-order-card"
                      style={{ borderRight: `4px solid ${sl.color}` }}>

                      {/* شريط التقدم */}
                      <div className="order-progress-bar">
                        {/* خط التقدم الخلفي */}
                        <div className="progress-track">
                          <div className="progress-track-fill" style={{ width: `${(sl.step / 2) * 100}%` }} />
                        </div>
                        {[{ label: 'انتظار', icon: '🕐' }, { label: 'جاري', icon: '🚗' }, { label: 'وصل', icon: '✅' }].map((s, idx) => {
                          const isDone    = sl.step >  idx;
                          const isCurrent = sl.step === idx;
                          return (
                            <div key={idx} className={`progress-step${isDone ? ' done' : isCurrent ? ' current' : ''}`}>
                              <div className="progress-dot">{isDone ? '✓' : s.icon}</div>
                              <span className="progress-label">{s.label}</span>
                            </div>
                          );
                        })}
                      </div>

                      {/* تفاصيل */}
                      <div className="order-invoices" style={{ marginTop: 10 }}>
                        {(o.invoice_numbers || []).map((inv, i) => <span key={i} className="invoice-chip">#{inv}</span>)}
                      </div>
                      <div className="order-meta" style={{ marginTop: 6 }}>
                        {o.driver_name   && <div className="order-meta-item"><span className="order-meta-icon">🚗</span><span>{o.driver_name}</span></div>}
                        {o.packages_note && <div className="order-meta-item"><span className="order-meta-icon">📦</span><span>{o.packages_note}</span></div>}
                        <div className="order-meta-item"><span className="order-meta-icon">🕐</span><span>{formatDate(o.created_at)}</span></div>
                        {o.notes && <div className="order-meta-item"><span className="order-meta-icon">📝</span><span>{o.notes}</span></div>}
                      </div>

                      {/* زر الاتصال بالسائق */}
                      {(drv?.phone || o.driver_name) && (
                        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                          {drv?.phone && (
                            <a href={`tel:${drv.phone}`} className="pharm-call-btn">
                              📞 اتصل بالسائق
                            </a>
                          )}
                        </div>
                      )}

                      {/* خريطة التتبع — فقط عند جاري التوصيل */}
                      {o.status === 'in_progress' && (
                        <div className="pharm-map-section">
                          <div className="pharm-map-title">
                            📍 موقع السائق الحالي
                            {loc && <span className="map-live-badge">● مباشر</span>}
                          </div>
                          <Suspense fallback={<div className="map-waiting"><div className="spinner" style={{ margin: '0 auto', borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} /></div>}>
                            <DriverMap
                              lat={loc?.lat}
                              lng={loc?.lng}
                              driverName={o.driver_name}
                            />
                          </Suspense>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* شريط التبويبات */}
      <div className="bottom-tab-bar">
        {TABS.map(t => (
          <button key={t.id}
            className={`tab-btn${activeTab === t.id ? ' active' : ''}`}
            onClick={() => setActiveTab(t.id)}>
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
