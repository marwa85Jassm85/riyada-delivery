import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase';
import { playSuccess, playAlert } from '../../utils/sound';
import { requestNotifyPermission, showNotify } from '../../utils/notify';
import { sendDeliveryConfirmation } from '../../utils/telegram';
import { queueDelivery, getPending, removePending } from '../../utils/offlineDelivery';
import { startTracking, stopTracking } from '../../utils/locationTracker';

const DRIVER_TABS = [
  { id: 'active',     icon: '📦', label: 'طلبياتي'    },
  { id: 'delivered',  icon: '✅', label: 'تم التوصيل' },
  { id: 'pharmacies', icon: '🏥', label: 'الصيدليات'  },
];

function formatDate(iso) {
  if (!iso) return '';
  const d     = new Date(iso);
  const day   = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year  = d.getFullYear();
  const time  = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${day}/${month}/${year} ${time}`;
}

export default function DriverDashboard() {
  const { userProfile, logout } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('active');
  const [orders,   setOrders]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [updating, setUpdating] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);

  // تم التوصيل
  const [deliveredOrders, setDeliveredOrders]   = useState([]);
  const [loadingDelivered, setLoadingDelivered] = useState(false);
  const [deliveredFetched, setDeliveredFetched] = useState(false);
  const [deliveredMode, setDeliveredMode]       = useState('today'); // 'today' | 'range'
  const [deliveredFrom, setDeliveredFrom]       = useState('');
  const [deliveredTo,   setDeliveredTo]         = useState('');

  // الصيدليات
  const [pharList, setPharList]         = useState([]);
  const [loadingPhar, setLoadingPhar]   = useState(false);
  const [pharFetched, setPharFetched]   = useState(false);
  const [pharSearch, setPharSearch]     = useState('');

  // ── حالة مودال تأكيد التوصيل ──
  const [deliveryOrder,   setDeliveryOrder]   = useState(null);
  const [photos,          setPhotos]          = useState([]);
  const [returnStatus,    setReturnStatus]    = useState('no');
  const [deliveryNotes,   setDeliveryNotes]   = useState('');
  const [submitting,      setSubmitting]      = useState(false);
  const [submitStep,      setSubmitStep]      = useState('');
  const [showPhotoChoice, setShowPhotoChoice] = useState(false);

  // Toast
  const [toast, setToast]   = useState(null); // { msg, type: 'loading'|'success'|'warning' }
  const toastTimerRef        = useRef(null);

  const cameraInputRef       = useRef(null);
  const galleryInputRef      = useRef(null);
  const isProcessingQueueRef = useRef(false);
  const pendingTrackingRef   = useRef(null);
  const driverIdRef          = useRef(null);
  const cameraOpenTimeRef    = useRef(0);
  const deliveryOrderRef     = useRef(null);

  const handleLogout = async () => { await logout(); navigate('/login'); };

  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  function showToast(msg, type = 'loading', duration = 0) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ msg, type });
    if (duration > 0) {
      toastTimerRef.current = setTimeout(() => setToast(null), duration);
    }
  }

  // ── مراقبة حالة الاتصال ──
  useEffect(() => {
    const goOnline  = () => { setIsOnline(true);  processPendingQueue(); };
    const goOffline = () =>   setIsOnline(false);
    window.addEventListener('online',  goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online',  goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // ── مزامنة ref مع state (لاستخدامه في callbacks الثابتة) ──
  useEffect(() => { deliveryOrderRef.current = deliveryOrder; }, [deliveryOrder]);

  // ── دالة مشتركة لاستعادة مودال التوصيل من localStorage ──
  function tryRestoreDelivery() {
    const raw = localStorage.getItem('_deliverySave');
    if (!raw) return;
    localStorage.removeItem('_deliverySave');
    try {
      const s = JSON.parse(raw);
      if (Date.now() - s.ts < 5 * 60 * 1000 && s.order) {
        setDeliveryOrder(s.order);
        setReturnStatus(s.returnStatus || 'no');
        setDeliveryNotes(s.deliveryNotes || '');
        setPhotos([]); // الصور تُفقد بسبب restart — يعيد التصوير
        pendingTrackingRef.current = s.order.id;
      }
    } catch (_) {}
  }

  // ── استعادة المودال عند إعادة تشغيل الـ PWA كاملاً (mount) ──
  useEffect(() => {
    tryRestoreDelivery();
  }, []);

  // ── منع التنقل عند فتح الكاميرا أو أثناء فتح مودال التوصيل ──
  // السبب: أندرويد يطلق popstate بتأخير قد يصل لثواني بعد العودة من الكاميرا
  // الحل: طالما المودال مفتوح (deliveryOrderRef.current) نمنع أي popstate تماماً
  useEffect(() => {
    function onPop() {
      if (deliveryOrderRef.current !== null || Date.now() - cameraOpenTimeRef.current < 5000) {
        history.pushState({ driverNav: true }, '');
      }
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ── استعادة المودال عند العودة للمقدمة بدون إعادة تشغيل (soft resume) ──
  useEffect(() => {
    function onResume() {
      if (document.visibilityState !== 'visible') return;
      // نستعيد فقط إذا لم يكن المودال مفتوحاً (تجنّب التعارض مع الحالة الحالية)
      if (deliveryOrderRef.current) return;
      tryRestoreDelivery();
    }
    document.addEventListener('visibilitychange', onResume);
    return () => document.removeEventListener('visibilitychange', onResume);
  }, []);

  // ── الإشعارات + Realtime ──
  useEffect(() => {
    requestNotifyPermission();
  }, []);

  useEffect(() => {
    if (!userProfile?.id) return;
    driverIdRef.current = userProfile.id;
    fetchOrders();
    refreshPendingCount();

    // إعادة تشغيل GPS إذا أُعيد تشغيل التطبيق بعد فتح الكاميرا
    if (pendingTrackingRef.current) {
      startTracking(userProfile.id, pendingTrackingRef.current);
      pendingTrackingRef.current = null;
    }

    // نستمع لـ كل INSERT/UPDATE في orders بدون فلتر (أكثر موثوقية)
    // ونفلتر بـ driver_id في الكود
    const ch = supabase.channel(`driver-orders-${userProfile.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'orders',
      }, payload => {
        if (payload.new?.driver_id !== userProfile.id) return;
        playAlert();
        showNotify('📦 طلبية جديدة!',
          `${payload.new?.pharmacy_name || ''} — ${payload.new?.region_name || ''}`);
        fetchOrders();
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
      }, payload => {
        if (payload.new?.driver_id !== userProfile.id) return;
        const ns = payload.new?.status;
        if (ns === 'created') {
          playAlert();
          showNotify('📦 طلبية معدّلة!',
            `${payload.new?.pharmacy_name || ''} — ${payload.new?.region_name || ''}`);
        }
        fetchOrders();
      })
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [userProfile?.id]);

  async function fetchOrders() {
    if (!userProfile?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('orders')
      .select('id, pharmacy_id, pharmacy_name, invoice_numbers, packages_note, region_name, carton_count, bag_count, fridge_count, status, created_at, delivered_at, notes')
      .eq('driver_id', userProfile.id)
      .is('deleted_at', null)
      .in('status', ['created', 'in_progress'])
      .order('created_at', { ascending: false });
    if (error) {
      console.error('fetchOrders error:', error.message);
      // لا نمسح البيانات الموجودة عند الفشل
    } else {
      setOrders(data || []);
    }
    setLoading(false);
  }

  async function fetchDeliveredOrders(mode, from, to) {
    if (!userProfile?.id) return;
    setLoadingDelivered(true);
    const m = mode ?? deliveredMode;
    let q = supabase
      .from('orders')
      .select('id, pharmacy_name, invoice_numbers, region_name, delivered_at, created_at, return_status, delivery_notes, delivery_photos, packages_note')
      .eq('driver_id', userProfile.id)
      .eq('status', 'delivered')
      .is('deleted_at', null)
      .order('delivered_at', { ascending: false })
      .limit(100);

    if (m === 'today') {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end   = new Date(); end.setHours(23, 59, 59, 999);
      q = q.gte('delivered_at', start.toISOString()).lte('delivered_at', end.toISOString());
    } else {
      const f = from ?? deliveredFrom;
      const t = to   ?? deliveredTo;
      if (f) { const d = new Date(f); d.setHours(0,0,0,0);       q = q.gte('delivered_at', d.toISOString()); }
      if (t) { const d = new Date(t); d.setHours(23,59,59,999);  q = q.lte('delivered_at', d.toISOString()); }
    }

    const { data } = await q;
    setDeliveredOrders(data || []);
    setDeliveredFetched(true);
    setLoadingDelivered(false);
  }

  async function fetchPharList() {
    setLoadingPhar(true);
    const { data } = await supabase
      .from('pharmacies')
      .select('id, name, owner_name, phone, region_name, address')
      .eq('active', true)
      .order('name');
    setPharList(data || []);
    setPharFetched(true);
    setLoadingPhar(false);
  }

  // تحميل بيانات التبويب عند التغيير
  useEffect(() => {
    if (activeTab === 'delivered'  && !deliveredFetched) fetchDeliveredOrders();
    if (activeTab === 'pharmacies' && !pharFetched)      fetchPharList();
  }, [activeTab]);

  async function refreshPendingCount() {
    const items = await getPending();
    setPendingCount(items.length);
  }

  // ── معالجة قائمة الانتظار لما يرجع النت ──
  const processPendingQueue = useCallback(async () => {
    // منع التشغيل المتزامن (حدث online + ضغطة يدوية في نفس الوقت)
    if (isProcessingQueueRef.current) return;
    isProcessingQueueRef.current = true;
    try {
      const items = await getPending();
      if (!items.length) return;

      let anyDelivered = false;
      for (const item of items) {
        try {
          // رفع الصور
          const photoUrls = [];
          for (let i = 0; i < (item.photoBlobs || []).length; i++) {
            const blob = item.photoBlobs[i];
            const file = new File([blob], `photo_${i}.jpg`, { type: 'image/jpeg' });
            const path = `${item.orderId}/${Date.now()}_${i}.jpg`;
            const { error } = await supabase.storage
              .from('delivery-photos').upload(path, file, { upsert: true });
            if (!error) {
              const { data } = supabase.storage.from('delivery-photos').getPublicUrl(path);
              photoUrls.push(data.publicUrl);
            }
          }

          // تحديث DB — إذا فشل نبقي العنصر في IndexedDB ونحاول في المرة القادمة
          const { error: updateErr } = await supabase.from('orders').update({
            status:          'delivered',
            delivered_at:    item.deliveredAt,
            return_status:   item.returnStatus === 'yes',
            delivery_notes:  item.deliveryNotes || null,
            delivery_photos: photoUrls.length ? photoUrls : null,
          }).eq('id', item.orderId);
          if (updateErr) {
            console.warn('processPending: فشل تحديث DB، سيُعاد المحاولة:', updateErr.message);
            continue; // تخطّ — لا تحذف من IndexedDB ولا ترسل تيليجرام
          }

          // إرسال تيليجرام
          await sendDeliveryConfirmation({
            pharmacyChatId:  item.pharmacyChatId,
            pharmacyName:    item.pharmacyName,
            invoiceNumbers:  item.invoiceNumbers,
            driverName:      item.driverName,
            createdAt:       item.createdAt,
            deliveredAt:     item.deliveredAt,
            hasReturn:       item.returnStatus === 'yes',
            notes:           item.deliveryNotes,
            photoUrls,
          });

          await removePending(item.orderId);
          anyDelivered = true;
        } catch (e) {
          console.warn('processPending error:', e);
        }
      }
      // بعد مزامنة التوصيلات الأوفلاين: امسح موقع السائق القديم من الخريطة
      if (anyDelivered && driverIdRef.current) {
        await stopTracking(driverIdRef.current);
      }
      refreshPendingCount();
    } finally {
      isProcessingQueueRef.current = false;
    }
  }, []);

  // cleanup تتبع الموقع عند إغلاق الصفحة
  useEffect(() => {
    return () => { if (userProfile?.id) stopTracking(userProfile.id); };
  }, [userProfile?.id]);

  // استلام الطلبية + بدء تتبع الموقع
  async function markInProgress(order) {
    setUpdating(order.id);
    const { error } = await supabase.from('orders').update({ status: 'in_progress' }).eq('id', order.id);
    if (!error) {
      playSuccess();
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'in_progress' } : o));
      startTracking(userProfile.id, order.id); // ← بدء إرسال الموقع
    }
    setUpdating(null);
  }

  // فتح مودال التوصيل
  function openDeliveryModal(order) {
    setDeliveryOrder(order);
    setPhotos([]);
    setReturnStatus('no');
    setDeliveryNotes('');
    setSubmitStep('');
    setShowPhotoChoice(false);
  }

  function closeDeliveryModal() {
    if (submitting) return;
    // تجاهل النقرة الوهمية التي يُطلقها أندرويد عند العودة من الكاميرا
    if (Date.now() - cameraOpenTimeRef.current < 1500) return;
    setDeliveryOrder(null);
    setShowPhotoChoice(false);
  }

  // ── فتح الكاميرا (مع حفظ state لتفادي PWA restart) ──
  function openCamera() {
    cameraOpenTimeRef.current = Date.now();
    history.pushState({ driverPhoto: true }, ''); // يمنع popstate من إخراج التطبيق
    localStorage.setItem('_deliverySave', JSON.stringify({
      ts:           cameraOpenTimeRef.current,
      order:        deliveryOrder,
      returnStatus,
      deliveryNotes,
    }));
    setShowPhotoChoice(false);
    cameraInputRef.current?.click();
  }

  function openGallery() {
    cameraOpenTimeRef.current = Date.now(); // نفس الحماية للمعرض
    history.pushState({ driverPhoto: true }, '');
    setShowPhotoChoice(false);
    galleryInputRef.current?.click();
  }

  // معالجة الصور المختارة
  async function handlePhotoInput(e) {
    // نمسح دائماً (حتى لو أُلغيت الكاميرا بدون صورة) ونصفّر حماية النقرة الوهمية
    localStorage.removeItem('_deliverySave');
    cameraOpenTimeRef.current = 0;
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    e.target.value = '';

    const newPhotos = await Promise.all(files.map(file => new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = ev => resolve({ file, preview: ev.target.result });
      reader.readAsDataURL(file);
    })));

    setPhotos(prev => [...prev, ...newPhotos].slice(0, 8));
  }

  function removePhoto(idx) {
    setPhotos(prev => prev.filter((_, i) => i !== idx));
  }

  // رفع صورة لـ Supabase Storage
  async function uploadPhoto(photo, orderId, idx) {
    const ext  = photo.file.name.split('.').pop() || 'jpg';
    const path = `${orderId}/${Date.now()}_${idx}.${ext}`;
    const { error } = await supabase.storage
      .from('delivery-photos').upload(path, photo.file, { upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from('delivery-photos').getPublicUrl(path);
    return data.publicUrl;
  }

  // ── تأكيد التوصيل — Optimistic UI (المودال يُغلق فوراً، العمل في الخلفية) ──
  async function confirmDelivery() {
    if (!deliveryOrder) return;

    // نسخ كل البيانات قبل مسح الـ state
    const order        = deliveryOrder;
    const photoSnap    = [...photos];
    const returnSnap   = returnStatus;
    const notesSnap    = deliveryNotes.trim();
    const deliveredAt  = new Date().toISOString();

    // ── إغلاق المودال فوراً (Optimistic) ──
    setDeliveryOrder(null);
    setPhotos([]);
    setReturnStatus('no');
    setDeliveryNotes('');
    setShowPhotoChoice(false);
    setOrders(prev => prev.filter(o => o.id !== order.id));
    stopTracking(userProfile?.id);
    playSuccess();

    if (!navigator.onLine) {
      // ── أوفلاين: خزّن في IndexedDB ──
      try {
        const photoBlobs = await Promise.all(
          photoSnap.map(ph => fetch(ph.preview).then(r => r.blob()))
        );
        let pharmacyChatId = null;
        try {
          const { data } = await supabase.from('pharmacies')
            .select('telegram_chat_id').eq('id', order.pharmacy_id).single();
          pharmacyChatId = data?.telegram_chat_id || null;
        } catch (_) {}

        await queueDelivery({
          orderId:        order.id,
          pharmacyChatId,
          pharmacyName:   order.pharmacy_name,
          invoiceNumbers: order.invoice_numbers || [],
          driverName:     userProfile?.name || '',
          createdAt:      order.created_at,
          deliveredAt,
          returnStatus:   returnSnap,
          deliveryNotes:  notesSnap,
          photoBlobs,
        });
        setPendingCount(c => c + 1);
        showToast(`⚠️ بدون نت — سيُرسَل تلقائياً عند عودة الاتصال`, 'warning', 7000);
      } catch (e) {
        console.error('offline queue error:', e);
        showToast('❌ فشل الحفظ — حاول مجدداً', 'warning', 5000);
      }
      return;
    }

    // ── أونلاين: كل العمل في الخلفية ──
    showToast(`📤 جاري الإرسال...  ${order.pharmacy_name || ''}`, 'loading');

    ;(async () => {
      // جلب chat_id مرة واحدة — نحتاجه في مسار النجاح والفشل على حد سواء
      let pharmacyChatId = null;
      if (order.pharmacy_id) {
        try {
          const { data: ph } = await supabase
            .from('pharmacies').select('telegram_chat_id')
            .eq('id', order.pharmacy_id).single();
          pharmacyChatId = ph?.telegram_chat_id || null;
        } catch (_) {}
      }

      try {
        // رفع الصور
        let photoUrls = [];
        if (photoSnap.length > 0) {
          photoUrls = await Promise.all(
            photoSnap.map((ph, idx) => uploadPhoto(ph, order.id, idx))
          );
        }

        // حفظ في DB
        const { error: dbErr } = await supabase.from('orders').update({
          status:          'delivered',
          delivered_at:    deliveredAt,
          return_status:   returnSnap === 'yes',
          delivery_notes:  notesSnap || null,
          delivery_photos: photoUrls.length ? photoUrls : null,
        }).eq('id', order.id);
        if (dbErr) throw new Error(dbErr.message);

        // إرسال تيليجرام
        await sendDeliveryConfirmation({
          pharmacyChatId,
          pharmacyName:   order.pharmacy_name,
          invoiceNumbers: order.invoice_numbers || [],
          driverName:     userProfile?.name || '',
          createdAt:      order.created_at,
          deliveredAt,
          hasReturn:      returnSnap === 'yes',
          notes:          notesSnap,
          photoUrls,
        });

        showToast(`✅ تم التوصيل — ${order.pharmacy_name || ''}`, 'success', 5000);

      } catch (err) {
        console.error('background delivery failed — queuing:', err);
        // فشل: نخزّن في الـ queue ليُرسَل لاحقاً
        try {
          const photoBlobs = await Promise.all(
            photoSnap.map(ph => fetch(ph.preview).then(r => r.blob()))
          );

          await queueDelivery({
            orderId:        order.id,
            pharmacyChatId,
            pharmacyName:   order.pharmacy_name,
            invoiceNumbers: order.invoice_numbers || [],
            driverName:     userProfile?.name || '',
            createdAt:      order.created_at,
            deliveredAt,
            returnStatus:   returnSnap,
            deliveryNotes:  notesSnap,
            photoBlobs,
          });
          setPendingCount(c => c + 1);
          showToast(`⚠️ فشل الإرسال — سيُرسَل عند عودة النت`, 'warning', 7000);
        } catch (_) {
          showToast('❌ خطأ غير متوقع — راجع التأكيدات المعلقة', 'warning', 7000);
        }
      }
    })();
  }

  const countPending    = orders.filter(o => o.status === 'created').length;
  const countInProgress = orders.filter(o => o.status === 'in_progress').length;

  return (
    <div className="dashboard role-driver">
      <div className="accent-bar" />

      <div className="top-bar">
        <div className="top-bar-right">
          <span style={{ fontSize: 28 }}>🚗</span>
          <div>
            <div className="top-bar-title">طلبياتي</div>
            <div className="top-bar-subtitle">{userProfile?.name || 'مرحباً'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* مؤشر الاتصال */}
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 20,
            background: isOnline ? '#dcfce7' : '#fef9c3',
            color: isOnline ? '#16a34a' : '#92400e',
          }}>
            {isOnline ? '🟢 متصل' : '🟡 بدون نت'}
          </span>
          <button className="btn-outline" onClick={handleLogout}>خروج</button>
        </div>
      </div>

      {/* تنبيه تأكيدات معلقة */}
      {pendingCount > 0 && (
        <div className="offline-pending-bar" onClick={processPendingQueue}>
          ⏳ {pendingCount} تأكيد توصيل معلق — اضغط لإرسالها الآن
        </div>
      )}

      <div className="page-content" style={{ paddingBottom: 80 }}>

        {/* ══ تم التوصيل ══ */}
        {activeTab === 'delivered' && (
          <div className="sub-page">
            <div className="sub-page-header">
              <div className="sub-page-title">✅ تم التوصيل <span className="sub-count">({deliveredOrders.length})</span></div>
            </div>

            {/* فلتر: اليوم / نطاق */}
            <div className="delivered-filter-bar">
              <button
                className={`delivered-filter-btn${deliveredMode === 'today' ? ' active' : ''}`}
                onClick={() => {
                  setDeliveredMode('today');
                  fetchDeliveredOrders('today');
                }}>
                📅 اليوم
              </button>
              <button
                className={`delivered-filter-btn${deliveredMode === 'range' ? ' active' : ''}`}
                onClick={() => setDeliveredMode('range')}>
                🗓️ تحديد فترة
              </button>
            </div>

            {/* نطاق التاريخ — يظهر فقط في وضع range */}
            {deliveredMode === 'range' && (
              <div className="date-range-card" style={{ marginBottom: 10 }}>
                <div className="date-range-row">
                  <div className="date-field">
                    <label>من</label>
                    <input type="date" value={deliveredFrom} onChange={e => setDeliveredFrom(e.target.value)} />
                  </div>
                  <div className="date-range-arrow">←</div>
                  <div className="date-field">
                    <label>إلى</label>
                    <input type="date" value={deliveredTo} onChange={e => setDeliveredTo(e.target.value)} />
                  </div>
                </div>
                <button className="btn-primary" style={{ marginTop: 10, width: '100%' }}
                  onClick={() => fetchDeliveredOrders('range')}>
                  🔍 بحث
                </button>
              </div>
            )}
            {loadingDelivered ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <div className="spinner" style={{ margin: '0 auto', borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} />
              </div>
            ) : deliveredOrders.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">✅</div><p>لا توجد طلبيات مكتملة</p></div>
            ) : (
              <div className="orders-list">
                {deliveredOrders.map(o => (
                  <div key={o.id} className="order-card" style={{ borderRight: '4px solid var(--success)' }}>
                    <div className="order-card-header">
                      <span className="order-pharmacy">🏥 {o.pharmacy_name || '—'}</span>
                      <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 700 }}>✅ تم التوصيل</span>
                    </div>
                    {o.invoice_numbers?.length > 0 && (
                      <div className="order-invoices">
                        {o.invoice_numbers.map((inv, i) => <span key={i} className="invoice-chip">#{inv}</span>)}
                      </div>
                    )}
                    <div className="order-meta">
                      {o.region_name && <div className="order-meta-item"><span className="order-meta-icon">🌍</span><span>{o.region_name}</span></div>}
                      {o.packages_note && <div className="order-meta-item"><span className="order-meta-icon">📦</span><span>{o.packages_note}</span></div>}
                      {o.delivered_at && <div className="order-meta-item"><span className="order-meta-icon">✅</span><span>وصل: {formatDate(o.delivered_at)}</span></div>}
                      {o.return_status && <div className="order-meta-item"><span className="order-meta-icon">⚠️</span><span style={{ color: 'var(--danger)', fontWeight: 600 }}>يوجد مردودات</span></div>}
                      {o.delivery_notes && <div className="order-meta-item"><span className="order-meta-icon">📝</span><span>{o.delivery_notes}</span></div>}
                    </div>
                    {/* مصغرات الصور */}
                    {o.delivery_photos?.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                        {o.delivery_photos.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noreferrer">
                            <img src={url} alt={`صورة ${i+1}`} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
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

        {/* ══ الصيدليات ══ */}
        {activeTab === 'pharmacies' && (
          <div className="sub-page">
            <input className="search-input" type="text" placeholder="🔍 بحث بالاسم أو المنطقة..."
              value={pharSearch} onChange={e => setPharSearch(e.target.value)} />
            {loadingPhar ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <div className="spinner" style={{ margin: '0 auto', borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} />
              </div>
            ) : (
              <div className="items-list">
                {pharList
                  .filter(p =>
                    (p.name || '').toLowerCase().includes(pharSearch.toLowerCase()) ||
                    (p.region_name || '').toLowerCase().includes(pharSearch.toLowerCase())
                  )
                  .map(p => (
                    <div key={p.id} className="item-card">
                      <div className="item-card-body">
                        <div className="item-name">{p.name}</div>
                        {p.region_name && <div className="item-meta">🌍 {p.region_name}</div>}
                        {p.owner_name  && <div className="item-meta">👤 {p.owner_name}</div>}
                        {p.phone       && <div className="item-meta">📞 {p.phone}</div>}
                        {p.address     && <div className="item-meta">📍 {p.address}</div>}
                      </div>
                      <div className="item-actions">
                        {p.phone    && <a href={`tel:${p.phone}`} className="btn-icon" title="اتصال">📞</a>}
                      </div>
                    </div>
                  ))
                }
              </div>
            )}
          </div>
        )}

        {/* ══ الطلبيات النشطة ══ */}
        {activeTab === 'active' && <>
        <div className="emp-stat-row">
          <div className="emp-stat-card">
            <div className="emp-stat-num">{orders.length}</div>
            <div className="emp-stat-lbl">إجمالي النشطة</div>
          </div>
          <div className="emp-stat-card">
            <div className="emp-stat-num" style={{ color: 'var(--warning)' }}>{countPending}</div>
            <div className="emp-stat-lbl">بانتظار الاستلام</div>
          </div>
          <div className="emp-stat-card">
            <div className="emp-stat-num" style={{ color: 'var(--primary)' }}>{countInProgress}</div>
            <div className="emp-stat-lbl">جاري التوصيل</div>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div className="spinner" style={{ margin: '0 auto', borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} />
          </div>
        ) : orders.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 30 }}>
            <div className="empty-icon">✅</div>
            <p>لا توجد طلبيات نشطة</p>
            <p style={{ fontSize: 13, marginTop: 6, color: 'var(--text-secondary)' }}>ستظهر طلبياتك هنا عند إضافتها</p>
          </div>
        ) : (
          <div className="orders-list" style={{ marginTop: 0 }}>
            {orders.map(order => (
              <div key={order.id}
                className={`order-card driver-order-card${order.status === 'in_progress' ? ' order-in-progress' : ''}`}>
                <div className="order-card-header">
                  <span className="order-pharmacy">🏥 {order.pharmacy_name || '—'}</span>
                  <span className={`sbadge ${order.status === 'in_progress' ? 'sbadge-progress' : 'sbadge-created'}`}>
                    {order.status === 'in_progress' ? '🚗 جاري' : '🕐 جديدة'}
                  </span>
                </div>
                {order.invoice_numbers?.length > 0 && (
                  <div className="order-invoices">
                    {order.invoice_numbers.map((inv, i) => <span key={i} className="invoice-chip">#{inv}</span>)}
                  </div>
                )}
                <div className="order-meta">
                  {order.region_name   && <div className="order-meta-item"><span className="order-meta-icon">🌍</span><span>{order.region_name}</span></div>}
                  {order.packages_note && <div className="order-meta-item"><span className="order-meta-icon">📦</span><span>{order.packages_note}</span></div>}
                  <div className="order-meta-item"><span className="order-meta-icon">🕐</span><span>{formatDate(order.created_at)}</span></div>
                  {order.notes && <div className="order-meta-item"><span className="order-meta-icon">📝</span><span>{order.notes}</span></div>}
                </div>
                <div style={{ marginTop: 12 }}>
                  {order.status === 'created' && (
                    <button className="driver-action-btn btn-progress"
                      disabled={updating === order.id}
                      onClick={() => markInProgress(order)}>
                      {updating === order.id ? '...' : '🚗 استلمت — جاري التوصيل'}
                    </button>
                  )}
                  {order.status === 'in_progress' && (
                    <button className="driver-action-btn btn-delivered"
                      disabled={updating === order.id}
                      onClick={() => openDeliveryModal(order)}>
                      ✅ وصّلت — تأكيد التوصيل
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        </>}
      </div>

      {/* ── Toast إشعار الخلفية ── */}
      {toast && (
        <div
          onClick={() => setToast(null)}
          style={{
            position: 'fixed',
            bottom: 72,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            minWidth: 240,
            maxWidth: 'calc(100vw - 32px)',
            padding: '12px 18px',
            borderRadius: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 14,
            fontWeight: 600,
            boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
            cursor: 'pointer',
            animation: 'slideUp .25s ease',
            background:
              toast.type === 'success' ? '#16a34a' :
              toast.type === 'warning' ? '#b45309' : '#1e40af',
            color: '#fff',
          }}
        >
          {toast.type === 'loading' && (
            <div style={{
              width: 16, height: 16, borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.4)',
              borderTopColor: '#fff',
              animation: 'spin 0.7s linear infinite',
              flexShrink: 0,
            }} />
          )}
          <span style={{ flex: 1 }}>{toast.msg}</span>
        </div>
      )}

      {/* ── شريط التبويبات السفلي ── */}
      <div className="bottom-tab-bar">
        {DRIVER_TABS.map(t => (
          <button key={t.id}
            className={`tab-btn${activeTab === t.id ? ' active' : ''}`}
            onClick={() => setActiveTab(t.id)}>
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </div>

      {/* ══ مودال تأكيد التوصيل ══ */}
      {deliveryOrder && (
        <div className="modal-overlay" onClick={closeDeliveryModal}>
          <div className="modal-sheet modal-sheet-tall delivery-confirm-modal"
            onClick={e => e.stopPropagation()}>
            <div className="modal-handle" />

            <div className="delivery-modal-header">
              <div className="delivery-modal-title">✅ تأكيد التوصيل</div>
              <div className="delivery-modal-pharmacy">🏥 {deliveryOrder.pharmacy_name}</div>
              {deliveryOrder.invoice_numbers?.length > 0 && (
                <div className="order-invoices" style={{ marginTop: 6 }}>
                  {deliveryOrder.invoice_numbers.map((inv, i) => (
                    <span key={i} className="invoice-chip">#{inv}</span>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-form">

              {/* ── صور الفواتير ── */}
              <div className="input-group">
                <label>📸 صور الفواتير</label>

                {/* Input الكاميرا — capture=environment يفتح الكاميرا مباشرة */}
                <input ref={cameraInputRef} type="file" accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={handlePhotoInput} />

                {/* Input المعرض — بدون capture لفتح المعرض */}
                <input ref={galleryInputRef} type="file" accept="image/*"
                  multiple style={{ display: 'none' }}
                  onChange={handlePhotoInput} />

                {/* شبكة الصور */}
                <div className="photo-grid">
                  {photos.map((ph, idx) => (
                    <div key={idx} className="photo-thumb">
                      <img src={ph.preview} alt={`صورة ${idx + 1}`} />
                      <button className="photo-remove" onClick={() => removePhoto(idx)}>✕</button>
                    </div>
                  ))}
                  {photos.length < 8 && (
                    <button className="photo-add-btn"
                      onClick={() => setShowPhotoChoice(true)}>
                      <span>📷</span>
                      <span>{photos.length === 0 ? 'أضف صورة' : 'صورة أخرى'}</span>
                    </button>
                  )}
                </div>

                {/* اختيار مصدر الصورة */}
                {showPhotoChoice && (
                  <div className="photo-choice-box">
                    <button className="photo-choice-btn" onClick={openCamera}>
                      <span>📷</span><span>الكاميرا</span>
                    </button>
                    <button className="photo-choice-btn" onClick={openGallery}>
                      <span>🖼️</span><span>المعرض</span>
                    </button>
                    <button className="photo-choice-cancel"
                      onClick={() => setShowPhotoChoice(false)}>إلغاء</button>
                  </div>
                )}

                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                  حد أقصى 8 صور
                </p>
              </div>

              {/* ── مردود ── */}
              <div className="input-group">
                <label>↩️ مردود؟</label>
                <select className="region-select" value={returnStatus}
                  onChange={e => setReturnStatus(e.target.value)} style={{ width: '100%' }}>
                  <option value="no">لا — لا يوجد مردودات</option>
                  <option value="yes">نعم — يوجد مردودات ⚠️</option>
                </select>
              </div>

              {/* ── ملاحظات ── */}
              <div className="input-group">
                <label>📝 ملاحظات (اختياري)</label>
                <textarea value={deliveryNotes} onChange={e => setDeliveryNotes(e.target.value)}
                  placeholder="أي ملاحظات عن التوصيل..." rows={3} style={{ resize: 'none' }} />
              </div>
            </div>

            {/* خطوة الإرسال */}
            {submitting && submitStep && (
              <div className="delivery-submit-step">
                <div className="spinner" style={{ width: 18, height: 18, borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} />
                <span>{submitStep}</span>
              </div>
            )}

            {/* تنبيه أوفلاين */}
            {!isOnline && (
              <div style={{
                background: '#fef9c3', border: '1px solid #fde68a',
                borderRadius: 8, padding: '8px 12px', fontSize: 13,
                color: '#92400e', margin: '8px 0',
              }}>
                🟡 أنت غير متصل — سيُحفظ التأكيد ويُرسَل عند عودة النت
              </div>
            )}

            <div className="modal-actions">
              <button className="btn-primary" style={{ background: 'var(--success)' }}
                onClick={confirmDelivery} disabled={submitting}>
                {submitting ? 'جاري الإرسال...' : '✅ إرسال وتأكيد التوصيل'}
              </button>
              <button className="btn-outline" onClick={closeDeliveryModal} disabled={submitting}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
