import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase';
import { playSuccess, playDelete, playAlert } from '../../utils/sound';
import { requestNotifyPermission, showNotify } from '../../utils/notify';
import BarcodeScanner from '../../components/BarcodeScanner';
import { printOrderReceipt } from '../../utils/printReceipt';

// شبكة أمان: لو تعلّق أي استدعاء حفظ، نُظهر رسالة بدل التحميل اللانهائي
function withTimeout(promise, ms = 20000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('تعذّر الحفظ — تأكد من الاتصال بالإنترنت وحاول مجدداً')), ms)
    ),
  ]);
}

const TABS = [
  { id: 'orders',     icon: '📦', label: 'الطلبيات'  },
  { id: 'archive',    icon: '📁', label: 'الأرشيف'   },
  { id: 'pharmacies', icon: '🏥', label: 'الصيدليات' },
  { id: 'drivers',    icon: '🚗', label: 'السواق'    },
];

const EMPTY_ORDER = {
  invoice_numbers: [], pharmacy_id: '', pharmacy_name: '',
  region_id: '', region_name: '', carton_count: 0, bag_count: 0,
  fridge_count: 0, driver_id: '', driver_name: '', notes: '',
};

const COUNTS = Array.from({ length: 51 }, (_, i) => i);

function statusBadge(status) {
  const map = {
    created:     { label: 'بانتظار السائق', icon: '🕐', cls: 'sbadge-created'  },
    in_progress: { label: 'جاري التوصيل',   icon: '🚗', cls: 'sbadge-progress' },
    delivered:   { label: 'تم التوصيل',     icon: '✅', cls: 'sbadge-done'     },
  };
  const s = map[status] || map.created;
  return <span className={`sbadge ${s.cls}`}>{s.icon} {s.label}</span>;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const day   = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year  = d.getFullYear();
  const time  = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${day}/${month}/${year} ${time}`;
}

export default function EmployeeDashboard() {
  const { userProfile, logout } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('orders');

  // Active orders
  const [orders, setOrders]               = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [statusFilter, setStatusFilter]   = useState('all');
  const [regionFilter, setRegionFilter]   = useState('all');

  // Archive
  const [archOrders, setArchOrders]       = useState([]);
  const [loadingArch, setLoadingArch]     = useState(false);
  const [archFrom, setArchFrom]           = useState('');
  const [archTo, setArchTo]               = useState('');
  const [archSearch, setArchSearch]       = useState('');
  const [archFetched, setArchFetched]     = useState(false);

  // Stats
  const [deliveredToday, setDeliveredToday] = useState(0);

  // Reference data
  const [allPharmacies, setAllPharmacies] = useState([]);
  const [allDrivers, setAllDrivers]       = useState([]);
  const [regions, setRegions]             = useState([]);

  // Tab lists
  const [pharList, setPharList]           = useState([]);
  const [drvList, setDrvList]             = useState([]);
  const [loadingPhar, setLoadingPhar]     = useState(false);
  const [loadingDrv, setLoadingDrv]       = useState(false);
  const [pharTabSearch, setPharTabSearch] = useState('');
  const [drvTabSearch, setDrvTabSearch]   = useState('');

  // Order modal
  const [showOrderModal, setShowOrderModal]         = useState(false);
  const [editingOrder, setEditingOrder]             = useState(null);
  const [orderForm, setOrderForm]                   = useState(EMPTY_ORDER);
  const [invoiceInput, setInvoiceInput]             = useState('');
  const [formPharSearch, setFormPharSearch]         = useState('');
  const [formPharOpen, setFormPharOpen]             = useState(false);
  const [savingOrder, setSavingOrder]               = useState(false);
  const [orderError, setOrderError]                 = useState('');
  const [confirmDeleteOrder, setConfirmDeleteOrder] = useState(null);
  const [showScanner, setShowScanner]               = useState(false);
  const [showPrintModal, setShowPrintModal]         = useState(false);
  const [printTargetOrder, setPrintTargetOrder]     = useState(null);
  const [printCopies, setPrintCopies]               = useState(1);
  const [scanError,   setScanError]   = useState('');
  const [scanLoading, setScanLoading] = useState(false);
  const pharDropRef    = useRef(null);
  const httpScanRef    = useRef(null);
  const httpScanOpenAt = useRef(0);
  const canLiveCamera  = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  const handleLogout = async () => { await logout(); navigate('/login'); };

  useEffect(() => { fetchOrders(); fetchRefData(); fetchDeliveredToday(); requestNotifyPermission(); }, []);

  useEffect(() => {
    if (activeTab === 'pharmacies' && pharList.length === 0) fetchPharList();
    if (activeTab === 'drivers'    && drvList.length === 0)  fetchDrvList();
    if (activeTab === 'archive'    && !archFetched)          fetchArchive();
  }, [activeTab]);

  // منع التطبيق من الرجوع للرئيسية بعد إغلاق كاميرا الباركود
  useEffect(() => {
    function onPop() {
      if (Date.now() - httpScanOpenAt.current < 5000) {
        history.pushState({ httpScan: true }, '');
      }
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    function handler(e) {
      if (pharDropRef.current && !pharDropRef.current.contains(e.target)) setFormPharOpen(false);
    }
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, []);

  useEffect(() => {
    const ch = supabase.channel('emp-order-updates')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, () => {
        // طلبية جديدة أُضيفت (من موظف آخر أو من الأدمن)
        fetchOrders();
        fetchDeliveredToday();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, payload => {
        const ns = payload.new?.status, os = payload.old?.status;
        const phar = payload.new?.pharmacy_name || '';
        if (ns === 'in_progress' && os === 'created') {
          playAlert();
          showNotify('🚗 السائق استلم الطلبية', phar);
        } else if (ns === 'delivered' && os === 'in_progress') {
          playAlert();
          showNotify('✅ تم التوصيل', phar);
        }
        // إذا حذف الأدمن الطلبية (deleted_at صار غير null) تختفي من أرشيف الموظف فوراً
        if (payload.new?.deleted_at && !payload.old?.deleted_at) {
          setArchOrders(prev => prev.filter(o => o.id !== payload.new.id));
        }
        fetchOrders();
        fetchDeliveredToday();
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  // ── Fetch ──
  async function fetchOrders() {
    setLoadingOrders(true);
    const { data, error } = await supabase
      .from('orders')
      .select('id, pharmacy_name, invoice_numbers, driver_name, driver_id, packages_note, region_name, region_id, carton_count, bag_count, fridge_count, status, created_at, delivered_at, notes, created_by, pharmacy_id')
      .is('deleted_at', null)
      .in('status', ['created', 'in_progress'])
      .order('created_at', { ascending: false });
    if (error) {
      console.error('fetchOrders error:', error.message);
      // لا نمسح البيانات الموجودة — نبقيها كما هي حتى لا تظهر قائمة فارغة خاطئة
    } else {
      setOrders(data || []);
    }
    setLoadingOrders(false);
  }

  async function fetchDeliveredToday() {
    const tod = new Date(); tod.setHours(0, 0, 0, 0);
    const { count } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'delivered')
      .is('deleted_at', null)
      .gte('delivered_at', tod.toISOString());
    setDeliveredToday(count || 0);
  }

  async function fetchArchive() {
    setLoadingArch(true);
    let q = supabase
      .from('orders')
      .select('id, pharmacy_name, invoice_numbers, driver_name, region_name, packages_note, carton_count, bag_count, fridge_count, status, created_at, delivered_at, notes')
      .eq('status', 'delivered')
      .is('deleted_at', null)
      .order('delivered_at', { ascending: false })
      .limit(300);

    if (archFrom) { const f = new Date(archFrom); f.setHours(0,0,0,0); q = q.gte('delivered_at', f.toISOString()); }
    if (archTo)   { const t = new Date(archTo);   t.setHours(23,59,59,999); q = q.lte('delivered_at', t.toISOString()); }

    const { data } = await q;
    setArchOrders(data || []);
    setLoadingArch(false);
    setArchFetched(true);
  }

  async function fetchRefData() {
    const [pharRes, drvRes, regRes] = await Promise.all([
      supabase.from('pharmacies').select('id, name, region_id, region_name, phone, address').eq('active', true).order('name'),
      supabase.from('profiles').select('id, name').eq('role', 'driver').eq('active', true).order('name'),
      supabase.from('regions').select('id, name').order('name'),
    ]);
    setAllPharmacies(pharRes.data || []);
    setAllDrivers(drvRes.data || []);
    setRegions(regRes.data || []);
  }

  async function fetchPharList() {
    setLoadingPhar(true);
    const { data } = await supabase.from('pharmacies').select('*').eq('active', true).order('name');
    setPharList(data || []);
    setLoadingPhar(false);
  }

  async function fetchDrvList() {
    setLoadingDrv(true);
    const { data } = await supabase.from('profiles').select('*').eq('role', 'driver').eq('active', true).order('name');
    setDrvList(data || []);
    setLoadingDrv(false);
  }

  // ── Order CRUD ──
  function openCreate() {
    setEditingOrder(null); setOrderForm(EMPTY_ORDER); setInvoiceInput('');
    setFormPharSearch(''); setOrderError(''); setShowOrderModal(true);
  }

  function openEdit(order) {
    setEditingOrder(order);
    setOrderForm({
      invoice_numbers: order.invoice_numbers || [],
      pharmacy_id: order.pharmacy_id || '', pharmacy_name: order.pharmacy_name || '',
      region_id: order.region_id || '', region_name: order.region_name || '',
      carton_count: order.carton_count || 0, bag_count: order.bag_count || 0, fridge_count: order.fridge_count || 0,
      driver_id: order.driver_id || '', driver_name: order.driver_name || '', notes: order.notes || '',
    });
    setFormPharSearch(order.pharmacy_name || ''); setInvoiceInput(''); setOrderError(''); setShowOrderModal(true);
  }

  function closeOrderModal() { setShowOrderModal(false); setEditingOrder(null); setOrderError(''); }
  function setOrderField(key, val) { setOrderForm(f => ({ ...f, [key]: val })); }

  function addInvoice() {
    const v = invoiceInput.trim();
    if (!v) return;
    if (!orderForm.invoice_numbers.includes(v)) setOrderField('invoice_numbers', [...orderForm.invoice_numbers, v]);
    setInvoiceInput('');
  }

  function removeInvoice(i) { setOrderField('invoice_numbers', orderForm.invoice_numbers.filter((_, idx) => idx !== i)); }

  async function saveAndPrint() {
    setOrderError('');
    const pending = invoiceInput.trim();
    const allInvoices = pending && !orderForm.invoice_numbers.includes(pending)
      ? [...orderForm.invoice_numbers, pending]
      : [...orderForm.invoice_numbers];
    if (pending) setInvoiceInput('');
    if (allInvoices.length === 0) { setOrderError('أضف رقم فاتورة واحد على الأقل'); return; }
    if (!orderForm.pharmacy_id)   { setOrderError('اختر الصيدلية'); return; }
    if (!orderForm.driver_id)     { setOrderError('اختر السائق'); return; }
    setSavingOrder(true);
    try {
      const parts = [
        orderForm.carton_count > 0 ? `${orderForm.carton_count} كارتون` : '',
        orderForm.bag_count    > 0 ? `${orderForm.bag_count} كيس`      : '',
        orderForm.fridge_count > 0 ? `${orderForm.fridge_count} براد`  : '',
      ].filter(Boolean);
      const payload = {
        invoice_numbers: allInvoices, pharmacy_id: orderForm.pharmacy_id,
        pharmacy_name: orderForm.pharmacy_name, region_id: orderForm.region_id || null,
        region_name: orderForm.region_name || null, carton_count: Number(orderForm.carton_count),
        bag_count: Number(orderForm.bag_count), fridge_count: Number(orderForm.fridge_count),
        driver_id: orderForm.driver_id, driver_name: orderForm.driver_name,
        packages_note: parts.length ? parts.join('، ') : null,
        notes: orderForm.notes.trim() || null,
      };
      if (editingOrder) {
        const { error: e } = await withTimeout(supabase.from('orders').update(payload).eq('id', editingOrder.id));
        if (e) throw new Error(e.message || 'فشل التعديل');
      } else {
        const { error: e } = await withTimeout(supabase.from('orders').insert({ ...payload, status: 'created', created_by: userProfile?.id || null }));
        if (e) throw new Error(e.message || 'فشل الحفظ');
      }
      playSuccess();
      closeOrderModal();
      fetchOrders();
      fetchDeliveredToday();
      setPrintTargetOrder({ ...orderForm, invoice_numbers: allInvoices, created_at: new Date().toISOString() });
      setPrintCopies(1);
      setShowPrintModal(true);
    } catch (e) {
      setOrderError(e.message || 'حدث خطأ غير متوقع');
    } finally {
      setSavingOrder(false);
    }
  }

  // يُفتح الماسح الحيّ — يُضاف الرقم مباشرة عند القراءة
  function handleBarcodeFound(code) {
    const v = code.trim();
    if (v) setOrderForm(f => ({
      ...f,
      invoice_numbers: f.invoice_numbers.includes(v)
        ? f.invoice_numbers
        : [...f.invoice_numbers, v],
    }));
    setShowScanner(false);
  }

  async function handleHttpScan(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (httpScanRef.current) httpScanRef.current.value = '';
    setScanError('');
    setScanLoading(true);

    function addCode(raw) {
      const code = raw.trim();
      if (!code) return;
      setOrderForm(f => ({
        ...f,
        invoice_numbers: f.invoice_numbers.includes(code) ? f.invoice_numbers : [...f.invoice_numbers, code],
      }));
    }

    // يرسم الملف على Canvas مع تصحيح EXIF تلقائياً (portrait/landscape)
    async function toCanvas(src) {
      const bitmap = await createImageBitmap(src);
      const c = document.createElement('canvas');
      c.width = bitmap.width;
      c.height = bitmap.height;
      c.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close();
      return c;
    }

    // يدوّر Canvas بزاوية
    function rotateCanvas(src, deg) {
      const rad = (deg * Math.PI) / 180;
      const c = document.createElement('canvas');
      c.width  = (deg === 90 || deg === 270) ? src.height : src.width;
      c.height = (deg === 90 || deg === 270) ? src.width  : src.height;
      const ctx = c.getContext('2d');
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate(rad);
      ctx.drawImage(src, -src.width / 2, -src.height / 2);
      return c;
    }

    try {
      // ── محاولة 1: BarcodeDetector الأصلي (Chrome/Android — الأسرع) ──
      if ('BarcodeDetector' in window) {
        const bitmap  = await createImageBitmap(file);
        const formats = ['code_128','code_39','code_93','codabar','ean_13','ean_8',
                         'upc_a','upc_e','itf','qr_code','data_matrix','pdf417'];
        const codes = await new BarcodeDetector({ formats }).detect(bitmap);
        bitmap.close();
        if (codes.length > 0) {
          addCode(codes[0].rawValue);
          setScanLoading(false);
          return;
        }
      }

      // ── محاولة 2-4: ZXing مع TRY_HARDER + تدوير 0°/90°/270° ──
      const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library'),
      ]);

      const hints = new Map([
        [DecodeHintType.TRY_HARDER, true],
        [DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93,
          BarcodeFormat.EAN_13,   BarcodeFormat.EAN_8,   BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,    BarcodeFormat.ITF,     BarcodeFormat.QR_CODE,
          BarcodeFormat.PDF_417,  BarcodeFormat.DATA_MATRIX,
        ]],
      ]);

      const reader = new BrowserMultiFormatReader(hints);
      const canvas = await toCanvas(file);

      for (const deg of [0, 90, 270]) {
        const c = deg === 0 ? canvas : rotateCanvas(canvas, deg);
        try {
          const result = await reader.decodeFromCanvas(c);
          addCode(result.getText());
          setScanLoading(false);
          return;
        } catch (_) {}
      }

      setScanError('لم يُتعرف على الباركود — صوّر أقرب وبإضاءة كافية');
      setTimeout(() => setScanError(''), 5000);

    } catch (_) {
      setScanError('لم يُتعرف على الباركود — صوّر أقرب وبإضاءة كافية');
      setTimeout(() => setScanError(''), 5000);
    }
    setScanLoading(false);
  }

  function selectPharmacy(p) {
    setOrderForm(f => ({
      ...f,
      pharmacy_id:   p.id,
      pharmacy_name: p.name,
      region_id:     p.region_id   || f.region_id,
      region_name:   p.region_id   ? (p.region_name || '') : f.region_name,
    }));
    setFormPharSearch(p.name);
    setFormPharOpen(false);
  }

  function selectDriver(driverId) {
    const d = allDrivers.find(x => x.id === driverId);
    setOrderForm(f => ({ ...f, driver_id: driverId, driver_name: d?.name || '' }));
  }

  function selectRegion(regionId) {
    const r = regions.find(x => x.id === regionId);
    setOrderForm(f => ({ ...f, region_id: regionId, region_name: r?.name || '' }));
  }

  async function saveOrder() {
    setOrderError('');

    // إذا كان المستخدم كتب رقم فاتورة بدون ما ضغط + نضيفه تلقائياً
    const pending = invoiceInput.trim();
    const allInvoices = pending && !orderForm.invoice_numbers.includes(pending)
      ? [...orderForm.invoice_numbers, pending]
      : [...orderForm.invoice_numbers];
    if (pending) setInvoiceInput('');

    if (allInvoices.length === 0) { setOrderError('أضف رقم فاتورة واحد على الأقل'); return; }
    if (!orderForm.pharmacy_id)   { setOrderError('اختر الصيدلية'); return; }
    if (!orderForm.driver_id)     { setOrderError('اختر السائق'); return; }
    setSavingOrder(true);
    try {
      const parts = [
        orderForm.carton_count > 0 ? `${orderForm.carton_count} كارتون` : '',
        orderForm.bag_count    > 0 ? `${orderForm.bag_count} كيس`      : '',
        orderForm.fridge_count > 0 ? `${orderForm.fridge_count} براد`  : '',
      ].filter(Boolean);
      const payload = {
        invoice_numbers: allInvoices,
        pharmacy_id:     orderForm.pharmacy_id,
        pharmacy_name:   orderForm.pharmacy_name,
        region_id:       orderForm.region_id   || null,
        region_name:     orderForm.region_name || null,
        carton_count:    Number(orderForm.carton_count),
        bag_count:       Number(orderForm.bag_count),
        fridge_count:    Number(orderForm.fridge_count),
        driver_id:       orderForm.driver_id,
        driver_name:     orderForm.driver_name,
        packages_note:   parts.length ? parts.join('، ') : null,
        notes:           orderForm.notes.trim() || null,
      };
      if (editingOrder) {
        const { error: e } = await withTimeout(supabase.from('orders').update(payload).eq('id', editingOrder.id));
        if (e) {
          const msg = e.message || e.details || e.hint || JSON.stringify(e);
          throw new Error(msg || 'فشل التعديل');
        }
      } else {
        const { error: e } = await withTimeout(supabase.from('orders').insert({
          ...payload,
          status:     'created',
          created_by: userProfile?.id || null,
        }));
        if (e) {
          const msg = e.message || e.details || e.hint || JSON.stringify(e);
          throw new Error(msg || 'فشل الحفظ');
        }
      }
      playSuccess();
      closeOrderModal();
      fetchOrders();
      fetchDeliveredToday();
    } catch (e) {
      setOrderError(e.message || 'حدث خطأ غير متوقع، راجع صلاحيات Supabase');
    } finally {
      setSavingOrder(false);
    }
  }

  async function softDeleteOrder(order) {
    setConfirmDeleteOrder(null);
    const { error } = await supabase.from('orders').update({ deleted_at: new Date().toISOString() }).eq('id', order.id);
    if (!error) {
      playDelete();
      setOrders(prev => prev.filter(o => o.id !== order.id));
    } else {
      alert('فشل الحذف — حاول مرة أخرى');
    }
  }

  // ── Filters ──
  const orderStats = {
    active:     orders.length,
    created:    orders.filter(o => o.status === 'created').length,
    inProgress: orders.filter(o => o.status === 'in_progress').length,
  };

  const filteredOrders = orders
    .filter(o => statusFilter === 'all' || o.status === statusFilter)
    .filter(o => regionFilter === 'all' || o.region_id === regionFilter);

  const filteredArch = archOrders.filter(o => {
    if (!archSearch) return true;
    const s = archSearch.toLowerCase();
    return (o.pharmacy_name || '').toLowerCase().includes(s) ||
           (o.region_name   || '').toLowerCase().includes(s) ||
           (o.driver_name   || '').toLowerCase().includes(s);
  });

  const pharDropList = allPharmacies.filter(p => p.name.toLowerCase().includes(formPharSearch.toLowerCase()));

  const TAB_TITLES = { orders: 'الطلبيات', archive: 'الأرشيف', pharmacies: 'الصيدليات', drivers: 'السواق' };

  return (
    <div className="dashboard role-employee">
      {/* ── ماسح الباركود الحيّ ── */}
      {showScanner && (
        <BarcodeScanner
          onFound={handleBarcodeFound}
          onClose={() => setShowScanner(false)}
        />
      )}

      <div className="accent-bar" />

      <div className="top-bar">
        <div className="top-bar-right">
          <span style={{ fontSize: 28 }}>🏪</span>
          <div>
            <div className="top-bar-title">{TAB_TITLES[activeTab]}</div>
            <div className="top-bar-subtitle">{userProfile?.name || 'مرحباً'}</div>
          </div>
        </div>
        <button className="btn-outline" onClick={handleLogout}>خروج</button>
      </div>

      <div className="page-content" style={{ paddingBottom: 80 }}>

        {/* ══ الطلبيات ══ */}
        {activeTab === 'orders' && (
          <div className="sub-page">
            {/* 4 Stat Cards */}
            <div className="emp-stat-row emp-stat-row-4">
              <div className="emp-stat-card">
                <div className="emp-stat-num">{orderStats.active}</div>
                <div className="emp-stat-lbl">نشطة</div>
              </div>
              <div className="emp-stat-card">
                <div className="emp-stat-num" style={{ color: 'var(--warning)' }}>{orderStats.created}</div>
                <div className="emp-stat-lbl">بانتظار</div>
              </div>
              <div className="emp-stat-card">
                <div className="emp-stat-num" style={{ color: 'var(--primary)' }}>{orderStats.inProgress}</div>
                <div className="emp-stat-lbl">جاري التوصيل</div>
              </div>
              <div className="emp-stat-card">
                <div className="emp-stat-num" style={{ color: 'var(--success)' }}>{deliveredToday}</div>
                <div className="emp-stat-lbl">تم التوصيل</div>
              </div>
            </div>

            <button className="btn-primary" style={{ width: '100%', marginBottom: 12 }} onClick={openCreate}>
              ➕ إنشاء طلبية جديدة
            </button>

            {/* Status Filter */}
            <div className="filter-bar" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
              {[
                { v: 'all',         l: '📋 الكل'           },
                { v: 'created',     l: '🕐 بانتظار السائق' },
                { v: 'in_progress', l: '🚗 جاري'           },
              ].map(f => (
                <button key={f.v} className={`filter-btn${statusFilter === f.v ? ' active' : ''}`} onClick={() => setStatusFilter(f.v)}>{f.l}</button>
              ))}
            </div>

            {/* Region Filter */}
            {regions.length > 0 && (
              <div className="region-select-wrap">
                <span className="region-select-icon">🌍</span>
                <select
                  className="region-select"
                  value={regionFilter}
                  onChange={e => setRegionFilter(e.target.value)}
                >
                  <option value="all">كل المناطق</option>
                  {regions.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
            )}

            {loadingOrders ? (
              <div style={{ textAlign: 'center', padding: 30 }}>
                <div className="spinner" style={{ margin: '0 auto', borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} />
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">📦</div><p>لا توجد طلبيات</p></div>
            ) : (
              <div className="orders-list">
                {filteredOrders.map(order => {
                  const ph = allPharmacies.find(p => p.id === order.pharmacy_id);
                  return (
                    <div key={order.id} className="order-card order-card-slim">
                      {/* الصيدلية + العنوان + الحالة */}
                      <div className="order-card-header">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span className="order-pharmacy">🏥 {order.pharmacy_name || '—'}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>📍 {ph?.address || '—'}</span>
                        </div>
                        {statusBadge(order.status)}
                      </div>

                      {/* أرقام الفواتير */}
                      {order.invoice_numbers?.length > 0 && (
                        <div className="order-invoices">
                          {order.invoice_numbers.map((inv, i) => <span key={i} className="invoice-chip">#{inv}</span>)}
                        </div>
                      )}

                      {/* السائق + الكميات */}
                      <div className="slim-row">
                        {order.driver_name   && <span>🚗 {order.driver_name}</span>}
                        {order.packages_note && <span>📦 {order.packages_note}</span>}
                      </div>

                      {/* الهاتف + الوقت + الملاحظات */}
                      <div className="slim-row">
                        {ph?.phone && <span>📞 {ph.phone}</span>}
                        <span>🕐 {formatDate(order.created_at)}</span>
                        <span>📝 {order.notes || '—'}</span>
                      </div>

                      {/* أزرار التعديل والحذف والطباعة */}
                      <div className="slim-actions">
                        {order.status === 'created' && <>
                          <button className="slim-btn slim-btn-edit" onClick={() => openEdit(order)}>✏️ تعديل</button>
                          <button className="slim-btn slim-btn-del"  onClick={() => setConfirmDeleteOrder(order)}>🗑️ حذف</button>
                        </>}
                        <button className="slim-btn" style={{ background: 'var(--success)', color: '#fff' }}
                          onClick={() => { setPrintTargetOrder(order); setPrintCopies(1); setShowPrintModal(true); }}>
                          🖨️ طباعة
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══ الأرشيف ══ */}
        {activeTab === 'archive' && (
          <div className="sub-page">
            {/* Filters */}
            <div className="arch-filter-box">
              <div className="date-range-row" style={{ marginBottom: 10 }}>
                <div className="date-field">
                  <label>من تاريخ</label>
                  <input type="date" value={archFrom} onChange={e => setArchFrom(e.target.value)} />
                </div>
                <div className="date-range-arrow">←</div>
                <div className="date-field">
                  <label>إلى تاريخ</label>
                  <input type="date" value={archTo} onChange={e => setArchTo(e.target.value)} />
                </div>
              </div>
              <button className="btn-primary" style={{ width: '100%', marginBottom: 10 }}
                onClick={() => { setArchFetched(false); fetchArchive(); }}>
                🔍 بحث بالتاريخ
              </button>
              <input
                className="search-input"
                type="text"
                placeholder="🔍 بحث بالصيدلية أو المنطقة أو السائق..."
                value={archSearch}
                onChange={e => setArchSearch(e.target.value)}
                style={{ marginBottom: 0 }}
              />
            </div>

            {loadingArch ? (
              <div style={{ textAlign: 'center', padding: 30 }}>
                <div className="spinner" style={{ margin: '0 auto', borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} />
              </div>
            ) : filteredArch.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">📁</div><p>لا توجد طلبيات مكتملة</p></div>
            ) : (
              <>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '10px 0 6px' }}>
                  {filteredArch.length} طلبية مكتملة
                </div>
                <div className="orders-list">
                  {filteredArch.map(order => (
                    <div key={order.id} className="order-card" style={{ borderRight: '4px solid var(--success)' }}>
                      <div className="order-card-header">
                        <span className="order-pharmacy">🏥 {order.pharmacy_name || '—'}</span>
                        <span className="sbadge sbadge-done">✅ تم التوصيل</span>
                      </div>
                      {order.invoice_numbers?.length > 0 && (
                        <div className="order-invoices">
                          {order.invoice_numbers.map((inv, i) => <span key={i} className="invoice-chip">#{inv}</span>)}
                        </div>
                      )}
                      <div className="order-meta">
                        {order.region_name   && <div className="order-meta-item"><span className="order-meta-icon">🌍</span><span>{order.region_name}</span></div>}
                        {order.driver_name   && <div className="order-meta-item"><span className="order-meta-icon">🚗</span><span>{order.driver_name}</span></div>}
                        {order.packages_note && <div className="order-meta-item"><span className="order-meta-icon">📦</span><span>{order.packages_note}</span></div>}
                        <div className="order-meta-item"><span className="order-meta-icon">✅</span><span>وصّل: {formatDate(order.delivered_at)}</span></div>
                        <div className="order-meta-item"><span className="order-meta-icon">🕐</span><span>أُنشئت: {formatDate(order.created_at)}</span></div>
                        {order.notes && <div className="order-meta-item"><span className="order-meta-icon">📝</span><span>{order.notes}</span></div>}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ══ الصيدليات ══ */}
        {activeTab === 'pharmacies' && (
          <div className="sub-page">
            <input className="search-input" type="text" placeholder="🔍 بحث..." value={pharTabSearch} onChange={e => setPharTabSearch(e.target.value)} />
            {loadingPhar ? <div style={{ textAlign: 'center', padding: 30 }}><div className="spinner" style={{ margin: '0 auto', borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} /></div> : (
              <div className="items-list">
                {pharList.filter(p => p.name.toLowerCase().includes(pharTabSearch.toLowerCase()) || (p.owner_name || '').toLowerCase().includes(pharTabSearch.toLowerCase())).map(p => (
                  <div key={p.id} className="item-card">
                    <div className="item-card-body">
                      <div className="item-name">{p.name}</div>
                      {p.region_name && <div className="item-meta">🌍 {p.region_name}</div>}
                      {p.owner_name  && <div className="item-meta">👤 {p.owner_name}</div>}
                      {p.phone       && <div className="item-meta">📞 {p.phone}</div>}
                    </div>
                    <div className="item-actions">
                      {p.phone    && <a href={`tel:${p.phone}`} className="btn-icon" title="اتصال">📞</a>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ السواق ══ */}
        {activeTab === 'drivers' && (
          <div className="sub-page">
            <input className="search-input" type="text" placeholder="🔍 بحث..." value={drvTabSearch} onChange={e => setDrvTabSearch(e.target.value)} />
            {loadingDrv ? <div style={{ textAlign: 'center', padding: 30 }}><div className="spinner" style={{ margin: '0 auto', borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} /></div> : (
              <div className="items-list">
                {drvList.filter(d => d.name.toLowerCase().includes(drvTabSearch.toLowerCase()) || (d.phone || '').includes(drvTabSearch)).map(d => (
                  <div key={d.id} className="item-card">
                    <div className="item-card-body">
                      <div className="item-name">{d.name}</div>
                      {d.phone    && <div className="item-meta">📞 {d.phone}</div>}
                      {d.car_type && <div className="item-meta">🚙 {d.car_type}</div>}
                    </div>
                    {d.phone && <div className="item-actions"><a href={`tel:${d.phone}`} className="btn-icon">📞</a></div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom Tab Bar ── */}
      <div className="bottom-tab-bar">
        {TABS.map(t => (
          <button key={t.id} className={`tab-btn${activeTab === t.id ? ' active' : ''}`} onClick={() => setActiveTab(t.id)}>
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </div>

      {/* ══ Order Modal ══ */}
      {showOrderModal && (
        <div className="modal-overlay" onClick={closeOrderModal}>
          <div className="modal-sheet modal-sheet-tall" onClick={e => e.stopPropagation()}>
            <div className="modal-handle" />
            <div className="modal-title">{editingOrder ? '✏️ تعديل الطلبية' : '📦 إنشاء طلبية جديدة'}</div>
            <div className="modal-form">
              {/* تاريخ الإنشاء — read only */}
              <div className="input-group">
                <label>تاريخ الإنشاء</label>
                <input
                  readOnly
                  value={editingOrder ? formatDate(editingOrder.created_at) : formatDate(new Date().toISOString())}
                  style={{ background: 'var(--bg)', color: 'var(--text-secondary)', cursor: 'default' }}
                />
              </div>
              <div className="input-group">
                <label>أرقام الفواتير *</label>
                <div className="invoice-input-row">
                  <input value={invoiceInput} onChange={e => setInvoiceInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addInvoice(); } }}
                    placeholder="رقم الفاتورة" dir="ltr" />
                  {canLiveCamera ? (
                    <button type="button" className="btn-scan" title="مسح الباركود"
                      onClick={() => setShowScanner(true)}>📷</button>
                  ) : (
                    <label className="btn-scan" title="مسح الباركود"
                      style={{
                        cursor: scanLoading ? 'not-allowed' : 'pointer',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        opacity: scanLoading ? 0.6 : 1,
                        pointerEvents: scanLoading ? 'none' : 'auto',
                      }}
                      onClick={() => { httpScanOpenAt.current = Date.now(); history.pushState({ httpScan: true }, ''); }}>
                      {scanLoading ? '⏳' : '📷'}
                      <input ref={httpScanRef} type="file" accept="image/*" capture="environment"
                        style={{ display: 'none' }} onChange={handleHttpScan} disabled={scanLoading} />
                    </label>
                  )}
                  <button type="button" className="btn-add-inv" onClick={addInvoice}>+</button>
                </div>
                {scanLoading && (
                  <div style={{ color: 'var(--primary)', fontSize: 12, marginTop: 4, padding: '4px 8px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                    ⏳ جاري قراءة الباركود...
                  </div>
                )}
                {scanError && !scanLoading && (
                  <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4, padding: '4px 8px', background: '#fef2f2', borderRadius: 6 }}>
                    ⚠️ {scanError}
                  </div>
                )}
                {orderForm.invoice_numbers.length > 0 && (
                  <div className="order-invoices" style={{ marginTop: 8 }}>
                    {orderForm.invoice_numbers.map((inv, i) => (
                      <span key={i} className="invoice-chip inv-removable">
                        #{inv}<button onClick={() => removeInvoice(i)}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="input-group" ref={pharDropRef}>
                <label>الصيدلية *</label>
                <input value={formPharSearch}
                  onChange={e => {
                    setFormPharSearch(e.target.value);
                    setFormPharOpen(true);
                    setOrderForm(f => ({ ...f, pharmacy_id: '', pharmacy_name: '' }));
                  }}
                  onFocus={() => setFormPharOpen(true)} placeholder="ابحث واختر الصيدلية..." />
                {formPharOpen && pharDropList.length > 0 && (
                  <div className="phar-dropdown">
                    {pharDropList.map(p => (
                      <div key={p.id} className="phar-dropdown-item" onClick={() => selectPharmacy(p)}>
                        <div>{p.name}</div>
                        {p.region_name && <div className="phar-dropdown-sub">{p.region_name}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="input-group">
                <label>المنطقة</label>
                <select value={orderForm.region_id} onChange={e => selectRegion(e.target.value)}>
                  <option value="">— اختر المنطقة —</option>
                  {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div className="input-group">
                <label>الكميات</label>
                <div className="count-row">
                  {[{ key: 'carton_count', label: '📦 كارتون' }, { key: 'bag_count', label: '👜 كيس' }, { key: 'fridge_count', label: '❄️ براد' }].map(({ key, label }) => (
                    <div key={key} className="count-group">
                      <label>{label}</label>
                      <select value={orderForm[key]} onChange={e => setOrderField(key, +e.target.value)}>
                        {COUNTS.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
              <div className="input-group">
                <label>السائق *</label>
                <select value={orderForm.driver_id} onChange={e => selectDriver(e.target.value)}>
                  <option value="">— اختر السائق —</option>
                  {allDrivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="input-group">
                <label>ملاحظات</label>
                <textarea value={orderForm.notes} onChange={e => setOrderField('notes', e.target.value)}
                  placeholder="ملاحظات اختيارية..." rows={2} style={{ resize: 'none' }} />
              </div>
            </div>
            {orderError && <div className="error-msg" style={{ margin: '8px 0' }}>{orderError}</div>}
            <div className="modal-actions">
              <button className="btn-primary" onClick={saveOrder} disabled={savingOrder}>
                {savingOrder ? 'جاري الحفظ...' : '💾 حفظ'}
              </button>
              <button className="btn-primary" style={{ background: 'var(--success)' }} onClick={saveAndPrint} disabled={savingOrder}>
                🖨️ حفظ مع طباعة
              </button>
              <button className="btn-outline" onClick={closeOrderModal}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Print Modal ── */}
      {showPrintModal && printTargetOrder && (
        <div className="modal-overlay" onClick={() => setShowPrintModal(false)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxHeight: '50vh' }}>
            <div className="modal-handle" />
            <div className="modal-title">🖨️ طباعة وصل التوصيل</div>
            <div className="modal-form">
              <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>
                📦 {printTargetOrder.pharmacy_name}
              </div>
              <div className="input-group">
                <label>عدد النسخ</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button className="btn-outline" style={{ width: 40, padding: '6px 0', fontSize: 18 }}
                    onClick={() => setPrintCopies(c => Math.max(1, c - 1))}>−</button>
                  <span style={{ fontSize: 22, fontWeight: 700, minWidth: 32, textAlign: 'center' }}>{printCopies}</span>
                  <button className="btn-outline" style={{ width: 40, padding: '6px 0', fontSize: 18 }}
                    onClick={() => setPrintCopies(c => Math.min(10, c + 1))}>+</button>
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn-primary" style={{ background: 'var(--success)' }}
                onClick={() => { printOrderReceipt(printTargetOrder, printCopies); setShowPrintModal(false); }}>
                🖨️ طباعة {printCopies} {printCopies === 1 ? 'نسخة' : 'نسخ'}
              </button>
              <button className="btn-outline" onClick={() => setShowPrintModal(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm Delete ── */}
      {confirmDeleteOrder && (
        <div className="modal-overlay" onClick={() => setConfirmDeleteOrder(null)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-handle" />
            <div className="delete-confirm-box">
              <div className="delete-confirm-text">
                حذف طلبية <strong>{confirmDeleteOrder.pharmacy_name}</strong>؟<br />
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>تنتقل لسلة المهملات — الأدمن يقدر يستعيدها</span>
              </div>
              <div className="modal-actions">
                <button className="btn-danger" onClick={() => softDeleteOrder(confirmDeleteOrder)}>🗑️ نعم، احذف</button>
                <button className="btn-outline" onClick={() => setConfirmDeleteOrder(null)}>إلغاء</button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
