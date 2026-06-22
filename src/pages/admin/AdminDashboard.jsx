import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase';
import { playSuccess, playDelete, playAlert } from '../../utils/sound';
import { requestNotifyPermission, showNotify } from '../../utils/notify';
import PharmaciesPage  from './PharmaciesPage';
import DriversPage     from './DriversPage';
import EmployeesPage   from './EmployeesPage';
import RegionsPage     from './RegionsPage';
import BarcodeScanner  from '../../components/BarcodeScanner';
import { printOrderReceipt } from '../../utils/printReceipt';

const COUNTS = Array.from({ length: 51 }, (_, i) => i);

const EMPTY_ORDER = {
  invoice_numbers: [], pharmacy_id: '', pharmacy_name: '',
  region_id: '', region_name: '', carton_count: 0, bag_count: 0,
  fridge_count: 0, driver_id: '', driver_name: '', notes: '',
};

// حساب مدة التوصيل بالدقائق
function calcDuration(created_at, delivered_at) {
  if (!created_at || !delivered_at) return null;
  const m = Math.round((new Date(delivered_at) - new Date(created_at)) / 60000);
  return m >= 0 ? m : null;
}

function formatDuration(mins) {
  if (mins === null) return '—';
  if (mins < 60) return `${mins} دقيقة`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}س ${m}د` : `${h} ساعة`;
}


const STATUS_FILTERS = [
  { label: 'الكل',            value: 'all',         icon: '📊', color: 'var(--primary-dark)' },
  { label: 'بانتظار السائق', value: 'created',     icon: '🕐', color: 'var(--warning)'     },
  { label: 'جاري التوصيل',   value: 'in_progress', icon: '🚗', color: 'var(--primary)'     },
  // delivered تُعرض في الأرشيف فقط — لا تظهر هنا
];

const TABS = [
  { id: 'stats',         icon: '📊', label: 'الإحصائيات'  },
  { id: 'delivery_perf', icon: '⏱️', label: 'وقت التوصيل' },
  { id: 'pharmacies',    icon: '🏥', label: 'الصيدليات'   },
  { id: 'archive',       icon: '📁', label: 'الأرشيف'     },
  { id: 'complaints',    icon: '📢', label: 'شكاوى'       },
  { id: 'regions',       icon: '🌍', label: 'المناطق'     },
  { id: 'drivers',       icon: '🚗', label: 'السواق'      },
  { id: 'employees',     icon: '👨‍💼', label: 'الموظفون'   },
  { id: 'deleted',       icon: '🗑️', label: 'المحذوفات'   },
];

const TAB_TITLES = {
  stats: 'لوحة الإدارة', delivery_perf: 'تقييم التوصيل',
  pharmacies: 'الصيدليات', drivers: 'السواق',
  employees: 'الموظفون', regions: 'المناطق',
  archive: 'الأرشيف', deleted: 'المحذوفات',
  complaints: 'الشكاوى',
};

function complaintStatusInfo(status) {
  if (status === 'new')        return { label: 'جديدة',          icon: '🆕', color: 'var(--warning)' };
  if (status === 'processing') return { label: 'جاري المعالجة', icon: '⚙️', color: 'var(--primary)' };
  if (status === 'resolved')   return { label: 'تمت المعالجة',  icon: '✅', color: 'var(--success)' };
  return { label: status, icon: '❓', color: 'var(--text-secondary)' };
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const day   = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year  = d.getFullYear();
  const time  = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${day}/${month}/${year} ${time}`;
}

function statusInfo(status) {
  return STATUS_FILTERS.find(s => s.value === status) || STATUS_FILTERS[0];
}

export default function AdminDashboard() {
  const { userProfile, logout } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab]       = useState('stats');
  const [activeStatus, setActiveStatus] = useState('all');
  const [regionFilter, setRegionFilter] = useState('all');
  const [orders, setOrders]             = useState([]);
  const [deletedOrders, setDeletedOrders] = useState([]);
  const [archOrders, setArchOrders]     = useState([]);
  const [archFrom, setArchFrom]         = useState('');
  const [archTo, setArchTo]             = useState('');
  const [archSearch, setArchSearch]     = useState('');
  const [archInvoice, setArchInvoice]   = useState('');   // بحث برقم الفاتورة في الأرشيف
  const [archDeleting, setArchDeleting] = useState(null);
  const [regions, setRegions]           = useState([]);
  const [stats, setStats]               = useState({ total: 0, created: 0, inProgress: 0 });
  const [loading, setLoading]           = useState(true);
  const [loadingDeleted, setLoadingDeleted] = useState(false);
  const [loadingArch, setLoadingArch]   = useState(false);
  const [archFetched, setArchFetched]   = useState(false);

  // الشكاوى
  const [complaints,         setComplaints]         = useState([]);
  const [loadingComplaints,  setLoadingComplaints]  = useState(false);
  const [complaintFilter,    setComplaintFilter]    = useState('all');
  const [newComplaintsCount, setNewComplaintsCount] = useState(0);

  // Delivery Performance tab
  const [perfOrders, setPerfOrders]           = useState([]);
  const [perfFrom, setPerfFrom]               = useState('');
  const [perfTo, setPerfTo]                   = useState('');
  const [perfDriverFilter, setPerfDriverFilter] = useState('all');
  const [loadingPerf, setLoadingPerf]         = useState(false);
  const [perfFetched, setPerfFetched]         = useState(false);
  const [deletingPerfId, setDeletingPerfId]   = useState(null);   // حذف فردي
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false); // تأكيد الحذف الجماعي
  const [deletingBulk, setDeletingBulk]       = useState(false);  // جاري الحذف الجماعي

  // Edit / Delete order
  const [showEditModal, setShowEditModal]       = useState(false);
  const [editingOrder, setEditingOrder]         = useState(null);
  const [editForm, setEditForm]                 = useState(EMPTY_ORDER);
  const [invoiceInput, setInvoiceInput]         = useState('');
  const [savingEdit, setSavingEdit]             = useState(false);
  const [editError, setEditError]               = useState('');
  const [confirmDeleteOrder, setConfirmDeleteOrder] = useState(null);
  const [allPharmacies, setAllPharmacies]       = useState([]);
  const [allDrivers, setAllDrivers]             = useState([]);
  const [formPharSearch, setFormPharSearch]     = useState('');
  const [formPharOpen, setFormPharOpen]         = useState(false);
  const [showScanner, setShowScanner]           = useState(false);
  const [refreshing, setRefreshing]             = useState(false);
  const [showPrintModal, setShowPrintModal]     = useState(false);
  const [printTargetOrder, setPrintTargetOrder] = useState(null);
  const [printCopies, setPrintCopies]           = useState(1);
  const pharDropRef      = useRef(null);
  // نحتاج ref لـ regionFilter حتى تستخدمه callbacks الـ Realtime الثابتة (تجنب stale closure)
  const regionFilterRef  = useRef('all');
  // ref لـ activeTab لاستخدامه داخل callbacks الـ Realtime الثابتة (تجنب stale closure)
  const activeTabRef     = useRef('stats');
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  const handleLogout = async () => { await logout(); navigate('/login'); };

  // ── تحديث بيانات التبويب الحالي يدوياً ──
  async function refreshCurrentTab() {
    setRefreshing(true);
    try {
      await fetchRefData();
      await fetchComplaintsCount();
      if (activeTab === 'stats')              await fetchOrders();
      else if (activeTab === 'deleted')       await fetchDeletedOrders();
      else if (activeTab === 'archive')       { setArchFetched(false); await fetchArchive(); }
      else if (activeTab === 'delivery_perf') { setPerfFetched(false); await fetchPerfOrders(); }
      else if (activeTab === 'complaints')    await fetchComplaints();
    } catch (e) { console.error('refresh error:', e); }
    finally { setRefreshing(false); }
  }

  useEffect(() => {
    fetchRegions();
    fetchRefData();
    fetchComplaintsCount();
    requestNotifyPermission();
    // Realtime: تنبيه الأدمن عند كل تغيير حالة أو إضافة طلبية أو شكوى
    const ch = supabase.channel('admin-order-updates')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, () => {
        fetchOrders(); // طلبية جديدة أضافها الموظف
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, payload => {
        const ns = payload.new?.status, os = payload.old?.status;
        const phar = payload.new?.pharmacy_name || '';
        const drv  = payload.new?.driver_name   || '';
        if (ns === 'in_progress' && os === 'created') {
          playAlert();
          showNotify('🚗 السائق استلم طلبية', `${phar} — ${drv}`);
        } else if (ns === 'delivered' && os === 'in_progress') {
          playAlert();
          showNotify('✅ تم التوصيل', `${phar} — ${drv}`);
        }
        fetchOrders();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'complaints' }, payload => {
        const pharName = payload.new?.pharmacy_name || 'صيدلية';
        playAlert();
        showNotify('📣 شكوى جديدة', `من: ${pharName}`);
        // إذا كان الأدمن واقف على تبويب الشكاوى، نعيد جلب القائمة كاملة (تتضمن تحديث العدّاد)
        if (activeTabRef.current === 'complaints') fetchComplaints();
        else fetchComplaintsCount();
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  useEffect(() => {
    if (activeTab === 'stats') fetchOrders();
  }, [activeTab, regionFilter]);

  useEffect(() => {
    if (activeTab === 'deleted') fetchDeletedOrders();
  }, [activeTab]);

  // إغلاق dropdown الصيدلية عند الضغط خارجه
  useEffect(() => {
    function handler(e) {
      if (pharDropRef.current && !pharDropRef.current.contains(e.target)) setFormPharOpen(false);
    }
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
  }, []);

  useEffect(() => {
    if (activeTab === 'archive' && !archFetched) fetchArchive();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'delivery_perf' && !perfFetched) fetchPerfOrders();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'complaints') fetchComplaints();
  }, [activeTab]);

  async function fetchRegions() {
    const { data } = await supabase.from('regions').select('id, name').order('name');
    setRegions(data || []);
  }

  async function fetchRefData() {
    const [pharRes, drvRes] = await Promise.all([
      supabase.from('pharmacies').select('id, name, region_id, region_name, phone, address').eq('active', true).order('name'),
      supabase.from('profiles').select('id, name').eq('role', 'driver').eq('active', true).order('name'),
    ]);
    setAllPharmacies(pharRes.data || []);
    setAllDrivers(drvRes.data || []);
  }

  async function fetchComplaintsCount() {
    const { count } = await supabase
      .from('complaints')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'new');
    setNewComplaintsCount(count || 0);
  }

  async function fetchComplaints() {
    setLoadingComplaints(true);
    const { data } = await supabase
      .from('complaints')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    const list = data || [];
    setComplaints(list);
    setNewComplaintsCount(list.filter(c => c.status === 'new').length);
    setLoadingComplaints(false);
  }

  async function updateComplaintStatus(id, newStatus) {
    const { error } = await supabase.from('complaints').update({ status: newStatus }).eq('id', id);
    if (!error) {
      setComplaints(prev => {
        const updated = prev.map(c => c.id === id ? { ...c, status: newStatus } : c);
        setNewComplaintsCount(updated.filter(c => c.status === 'new').length);
        return updated;
      });
    } else {
      alert('فشل تحديث الحالة — حاول مرة أخرى');
    }
  }

  async function deleteComplaint(id) {
    const { error } = await supabase.from('complaints').delete().eq('id', id);
    if (!error) {
      playDelete();
      setComplaints(prev => {
        const updated = prev.filter(c => c.id !== id);
        setNewComplaintsCount(updated.filter(c => c.status === 'new').length);
        return updated;
      });
    } else {
      alert('فشل الحذف — حاول مرة أخرى');
    }
  }

  async function fetchOrders() {
    setLoading(true);
    try {
      // نجلب فقط الطلبيات النشطة (الـ delivered تروح الأرشيف مباشرة)
      let q = supabase
        .from('orders')
        .select('id, pharmacy_id, pharmacy_name, invoice_numbers, driver_id, driver_name, packages_note, region_id, region_name, carton_count, bag_count, fridge_count, status, created_at, notes')
        .is('deleted_at', null)
        .in('status', ['created', 'in_progress'])
        .order('created_at', { ascending: false });

      if (regionFilterRef.current !== 'all') q = q.eq('region_id', regionFilterRef.current);

      const { data, error } = await q;
      if (error) throw error;
      const d = data || [];
      setOrders(d);
      setStats({
        total:      d.length,
        created:    d.filter(o => o.status === 'created').length,
        inProgress: d.filter(o => o.status === 'in_progress').length,
      });
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function fetchDeletedOrders() {
    setLoadingDeleted(true);
    const { data } = await supabase
      .from('orders')
      .select('id, pharmacy_name, invoice_numbers, driver_name, region_name, status, created_at, deleted_at, notes')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false });
    setDeletedOrders(data || []);
    setLoadingDeleted(false);
  }

  async function hardDeleteOrder(id) {
    const { error } = await supabase.from('orders').delete().eq('id', id);
    if (!error) { playDelete(); setDeletedOrders(prev => prev.filter(o => o.id !== id)); }
  }

  async function restoreOrder(id) {
    const { error } = await supabase.from('orders').update({ deleted_at: null }).eq('id', id);
    if (!error) { playSuccess(); setDeletedOrders(prev => prev.filter(o => o.id !== id)); }
  }

  async function fetchArchive() {
    setLoadingArch(true);
    try {
      let q = supabase
        .from('orders')
        .select('id, pharmacy_name, invoice_numbers, driver_name, packages_note, region_name, carton_count, bag_count, fridge_count, status, created_at, delivered_at, notes')
        .eq('status', 'delivered')
        .is('deleted_at', null)
        .order('delivered_at', { ascending: false })
        .limit(500);
      if (archFrom) { const f = new Date(archFrom); f.setHours(0, 0, 0, 0); q = q.gte('delivered_at', f.toISOString()); }
      if (archTo)   { const t = new Date(archTo);   t.setHours(23, 59, 59, 999); q = q.lte('delivered_at', t.toISOString()); }
      const { data } = await q;
      setArchOrders(data || []);
      setArchFetched(true);
    } catch (e) { console.error(e); }
    finally { setLoadingArch(false); }
  }

  async function fetchPerfOrders() {
    setLoadingPerf(true);
    try {
      let q = supabase
        .from('orders')
        .select('id, pharmacy_name, driver_id, driver_name, created_at, delivered_at, invoice_numbers, region_name')
        .eq('status', 'delivered')
        .is('deleted_at', null)
        .order('delivered_at', { ascending: false })
        .limit(1000);
      if (perfFrom) { const f = new Date(perfFrom); f.setHours(0,0,0,0); q = q.gte('delivered_at', f.toISOString()); }
      if (perfTo)   { const t = new Date(perfTo);   t.setHours(23,59,59,999); q = q.lte('delivered_at', t.toISOString()); }
      if (perfDriverFilter !== 'all') q = q.eq('driver_id', perfDriverFilter);
      const { data } = await q;
      setPerfOrders(data || []);
      setPerfFetched(true);
    } catch (e) { console.error(e); }
    finally { setLoadingPerf(false); }
  }

  // حذف سجل توصيل واحد من تقييم الأداء (soft delete)
  async function deletePerfOrder(id) {
    setDeletingPerfId(id);
    const { error } = await supabase
      .from('orders')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (!error) {
      playDelete();
      setPerfOrders(prev => prev.filter(o => o.id !== id));
    } else {
      alert('فشل الحذف — حاول مرة أخرى');
    }
    setDeletingPerfId(null);
  }

  // حذف جماعي لكل سجلات الفترة المعروضة
  async function bulkDeletePerfOrders() {
    setDeletingBulk(true);
    const ids = perfOrders.map(o => o.id);
    const { error } = await supabase
      .from('orders')
      .update({ deleted_at: new Date().toISOString() })
      .in('id', ids);
    if (!error) {
      playDelete();
      setPerfOrders([]);
      setConfirmBulkDelete(false);
    } else {
      alert('فشل الحذف الجماعي — حاول مرة أخرى');
    }
    setDeletingBulk(false);
  }

  async function softDeleteFromArchive(id) {
    setArchDeleting(id);
    const { error } = await supabase.from('orders').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (!error) {
      playDelete();
      setArchOrders(prev => prev.filter(o => o.id !== id));
    } else {
      alert('فشل الحذف — حاول مرة أخرى');
    }
    setArchDeleting(null);
  }

  // ── Order Create / Edit / Delete ──
  function openCreateOrder() {
    setEditingOrder(null);
    setEditForm(EMPTY_ORDER);
    setFormPharSearch('');
    setInvoiceInput('');
    setEditError('');
    setShowEditModal(true);
  }

  function openEditOrder(order) {
    setEditingOrder(order);
    setEditForm({
      invoice_numbers: order.invoice_numbers || [],
      pharmacy_id:   order.pharmacy_id   || '',
      pharmacy_name: order.pharmacy_name || '',
      region_id:     order.region_id     || '',
      region_name:   order.region_name   || '',
      carton_count:  order.carton_count  || 0,
      bag_count:     order.bag_count     || 0,
      fridge_count:  order.fridge_count  || 0,
      driver_id:     order.driver_id     || '',
      driver_name:   order.driver_name   || '',
      notes:         order.notes         || '',
    });
    setFormPharSearch(order.pharmacy_name || '');
    setInvoiceInput('');
    setEditError('');
    setShowEditModal(true);
  }

  function closeEditModal() { setShowEditModal(false); setEditingOrder(null); setEditError(''); }
  function setEditField(key, val) { setEditForm(f => ({ ...f, [key]: val })); }

  function addInvoice() {
    const v = invoiceInput.trim(); if (!v) return;
    if (!editForm.invoice_numbers.includes(v)) setEditField('invoice_numbers', [...editForm.invoice_numbers, v]);
    setInvoiceInput('');
  }
  function removeInvoice(i) { setEditField('invoice_numbers', editForm.invoice_numbers.filter((_, idx) => idx !== i)); }

  // يُضاف رقم الفاتورة مباشرة عند قراءة الباركود
  function handleBarcodeFound(code) {
    const v = code.trim();
    if (v) setEditForm(f => ({
      ...f,
      invoice_numbers: f.invoice_numbers.includes(v)
        ? f.invoice_numbers
        : [...f.invoice_numbers, v],
    }));
    setShowScanner(false);
  }

  function selectPharmacy(p) {
    setEditForm(f => ({
      ...f,
      pharmacy_id: p.id, pharmacy_name: p.name,
      region_id:   p.region_id   || f.region_id,
      region_name: p.region_id   ? (p.region_name || '') : f.region_name,
    }));
    setFormPharSearch(p.name);
    setFormPharOpen(false);
  }

  function selectDriver(driverId) {
    const d = allDrivers.find(x => x.id === driverId);
    setEditForm(f => ({ ...f, driver_id: driverId, driver_name: d?.name || '' }));
  }

  function selectRegionEdit(regionId) {
    const r = regions.find(x => x.id === regionId);
    setEditForm(f => ({ ...f, region_id: regionId, region_name: r?.name || '' }));
  }

  async function saveEditOrder(withPrint = false) {
    setEditError('');
    const pending     = invoiceInput.trim();
    const allInvoices = pending && !editForm.invoice_numbers.includes(pending)
      ? [...editForm.invoice_numbers, pending] : [...editForm.invoice_numbers];
    if (pending) setInvoiceInput('');
    if (allInvoices.length === 0) { setEditError('أضف رقم فاتورة واحد على الأقل'); return; }
    if (!editForm.pharmacy_id)    { setEditError('اختر الصيدلية'); return; }
    if (!editForm.driver_id)      { setEditError('اختر السائق'); return; }

    setSavingEdit(true);
    try {
      const parts = [
        editForm.carton_count  > 0 ? `${editForm.carton_count} كارتون`  : '',
        editForm.bag_count     > 0 ? `${editForm.bag_count} كيس`         : '',
        editForm.fridge_count  > 0 ? `${editForm.fridge_count} براد`     : '',
      ].filter(Boolean);

      const payload = {
        invoice_numbers: allInvoices,
        pharmacy_id:     editForm.pharmacy_id,
        pharmacy_name:   editForm.pharmacy_name,
        region_id:       editForm.region_id   || null,
        region_name:     editForm.region_name || null,
        carton_count:    Number(editForm.carton_count),
        bag_count:       Number(editForm.bag_count),
        fridge_count:    Number(editForm.fridge_count),
        driver_id:       editForm.driver_id,
        driver_name:     editForm.driver_name,
        packages_note:   parts.length ? parts.join('، ') : null,
        notes:           editForm.notes.trim() || null,
      };

      if (editingOrder) {
        const { error: e } = await supabase.from('orders').update(payload).eq('id', editingOrder.id);
        if (e) throw new Error(e.message || 'فشل التعديل');
      } else {
        const { error: e } = await supabase.from('orders').insert({
          ...payload, status: 'created', created_by: userProfile?.id || null,
        });
        if (e) throw new Error(e.message || 'فشل الحفظ');
      }

      playSuccess();
      const printSnap = {
        ...payload, invoice_numbers: allInvoices,
        created_at: editingOrder?.created_at || new Date().toISOString(),
      };
      closeEditModal();
      fetchOrders();
      if (withPrint) {
        setPrintTargetOrder(printSnap);
        setPrintCopies(1);
        setShowPrintModal(true);
      }
    } catch (e) {
      setEditError(e.message || 'حدث خطأ غير متوقع');
    } finally {
      setSavingEdit(false);
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

  const pharDropList = allPharmacies.filter(p =>
    p.name.toLowerCase().includes(formPharSearch.toLowerCase())
  );

  const filteredOrders = orders.filter(o => activeStatus === 'all' || o.status === activeStatus);

  const filteredComplaints = complaintFilter === 'all'
    ? complaints
    : complaints.filter(c => c.status === complaintFilter);

  return (
    <div className="dashboard role-admin">
      {/* ── ماسح الباركود الحيّ ── */}
      {showScanner && (
        <BarcodeScanner
          onFound={handleBarcodeFound}
          onClose={() => setShowScanner(false)}
        />
      )}

      <div className="accent-bar" />

      {/* ── Top Bar ── */}
      <div className="top-bar">
        <div className="top-bar-right">
          <img src="/logo.png" alt="logo" style={{ width: 36, height: 36 }} />
          <div>
            <div className="top-bar-title">{TAB_TITLES[activeTab]}</div>
            <div className="top-bar-subtitle">{userProfile?.name || 'مروان'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className="btn-outline"
            onClick={refreshCurrentTab}
            disabled={refreshing}
            title="تحديث"
            style={{ padding: '6px 10px', fontSize: 16, lineHeight: 1 }}
          >
            <span style={{ display: 'inline-block', animation: refreshing ? 'spin 0.7s linear infinite' : 'none' }}>🔄</span>
          </button>
          <button className="btn-outline" onClick={handleLogout}>خروج</button>
        </div>
      </div>

      {/* ── Page Content ── */}
      <div className="page-content" style={{ paddingBottom: 80 }}>

        {activeTab === 'pharmacies' && <PharmaciesPage />}
        {activeTab === 'drivers'    && <DriversPage />}
        {activeTab === 'employees'  && <EmployeesPage />}
        {activeTab === 'regions'    && <RegionsPage />}

        {/* ══ تقييم التوصيل ══ */}
        {activeTab === 'delivery_perf' && (() => {
          // حساب إحصائيات السواق
          const byDriver = {};
          perfOrders.forEach(o => {
            const mins = calcDuration(o.created_at, o.delivered_at);
            if (mins === null) return;
            if (!byDriver[o.driver_id]) byDriver[o.driver_id] = { name: o.driver_name, durations: [] };
            byDriver[o.driver_id].durations.push(mins);
          });
          const driverStats = Object.entries(byDriver).map(([id, d]) => {
            const avg  = Math.round(d.durations.reduce((a, b) => a + b, 0) / d.durations.length);
            const minD = Math.min(...d.durations);
            const maxD = Math.max(...d.durations);
            return { id, name: d.name, count: d.durations.length, avg, minD, maxD };
          }).sort((a, b) => a.avg - b.avg);

          return (
            <div className="sub-page">

              {/* فلاتر */}
              <div className="perf-filter-box">
                <div className="date-range-row" style={{ marginBottom: 10 }}>
                  <div className="date-field">
                    <label>من تاريخ</label>
                    <input type="date" value={perfFrom} onChange={e => setPerfFrom(e.target.value)} />
                  </div>
                  <div className="date-range-arrow">←</div>
                  <div className="date-field">
                    <label>إلى تاريخ</label>
                    <input type="date" value={perfTo} onChange={e => setPerfTo(e.target.value)} />
                  </div>
                </div>

                {/* فلتر السائق */}
                <div className="region-select-wrap" style={{ marginBottom: 10 }}>
                  <span className="region-select-icon">🚗</span>
                  <select className="region-select" value={perfDriverFilter}
                    onChange={e => setPerfDriverFilter(e.target.value)}>
                    <option value="all">كل السواق</option>
                    {allDrivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>

                <button className="btn-primary" style={{ width: '100%' }}
                  onClick={() => { setPerfFetched(false); fetchPerfOrders(); }}>
                  🔍 بحث
                </button>

                {/* زر الحذف الجماعي — يظهر فقط عند وجود نتائج */}
                {perfOrders.length > 0 && !confirmBulkDelete && (
                  <button
                    className="btn-danger-outline"
                    style={{ width: '100%', marginTop: 8 }}
                    onClick={() => setConfirmBulkDelete(true)}>
                    🗑️ حذف كل سجلات هذه الفترة ({perfOrders.length})
                  </button>
                )}

                {/* تأكيد الحذف الجماعي */}
                {confirmBulkDelete && (
                  <div className="delete-confirm-box" style={{ marginTop: 8 }}>
                    <div className="delete-confirm-text">
                      هل أنت متأكد من حذف <strong>{perfOrders.length} سجل</strong>؟<br />
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        سيتم تصفير التقييم — لا يمكن التراجع
                      </span>
                    </div>
                    <div className="modal-actions" style={{ marginTop: 10 }}>
                      <button className="btn-danger" onClick={bulkDeletePerfOrders} disabled={deletingBulk}>
                        {deletingBulk ? '⏳ جاري الحذف...' : '🗑️ نعم، احذف الكل'}
                      </button>
                      <button className="btn-outline" onClick={() => setConfirmBulkDelete(false)}>إلغاء</button>
                    </div>
                  </div>
                )}
              </div>

              {loadingPerf ? (
                <div style={{ textAlign: 'center', padding: 40 }}>
                  <div className="spinner" style={{ margin: '0 auto', borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} />
                </div>
              ) : perfOrders.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">⏱️</div>
                  <p>لا توجد طلبيات مكتملة في هذه الفترة</p>
                </div>
              ) : (
                <>
                  {/* ── بطاقات تقييم السواق ── */}
                  {driverStats.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div className="perf-section-title">🏆 تقييم السواق</div>
                      {driverStats.map((d, i) => (
                        <div key={d.id} className="driver-perf-card">
                          <div className="driver-perf-top">
                            <div className="driver-perf-rank">#{i + 1}</div>
                            <div className="driver-perf-name">{d.name}</div>
                            <div className="driver-perf-avg-badge">
                              ⏱️ متوسط {formatDuration(d.avg)}
                            </div>
                          </div>
                          <div className="driver-perf-stats">
                            <div className="driver-perf-stat">
                              <span className="driver-perf-stat-val">{d.count}</span>
                              <span className="driver-perf-stat-lbl">طلبية</span>
                            </div>
                            <div className="driver-perf-stat">
                              <span className="driver-perf-stat-val">{formatDuration(d.avg)}</span>
                              <span className="driver-perf-stat-lbl">متوسط</span>
                            </div>
                            <div className="driver-perf-stat">
                              <span className="driver-perf-stat-val" style={{ color: '#22c55e' }}>{formatDuration(d.minD)}</span>
                              <span className="driver-perf-stat-lbl">أسرع</span>
                            </div>
                            <div className="driver-perf-stat">
                              <span className="driver-perf-stat-val" style={{ color: '#ef4444' }}>{formatDuration(d.maxD)}</span>
                              <span className="driver-perf-stat-lbl">أبطأ</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── قائمة الطلبيات ── */}
                  <div className="perf-section-title">📦 تفاصيل الطلبيات ({perfOrders.length})</div>
                  <div className="orders-list">
                    {perfOrders.map(o => {
                      const mins = calcDuration(o.created_at, o.delivered_at);
                      return (
                        <div key={o.id} className="order-card order-card-slim"
                          style={{ borderRight: '3px solid var(--primary)' }}>
                          <div className="order-card-header">
                            <span className="order-pharmacy">🏥 {o.pharmacy_name || '—'}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)' }}>
                                ⏱️ {formatDuration(mins)}
                              </span>
                              <button
                                className="btn-icon"
                                title="حذف هذا السجل"
                                disabled={deletingPerfId === o.id}
                                onClick={() => deletePerfOrder(o.id)}
                                style={{ fontSize: 14, opacity: deletingPerfId === o.id ? 0.5 : 1 }}>
                                {deletingPerfId === o.id ? '⏳' : '🗑️'}
                              </button>
                            </div>
                          </div>
                          {o.invoice_numbers?.length > 0 && (
                            <div className="order-invoices" style={{ margin: '3px 0' }}>
                              {o.invoice_numbers.map((inv, i) => <span key={i} className="invoice-chip">#{inv}</span>)}
                            </div>
                          )}
                          <div className="slim-row">
                            <span>🚗 {o.driver_name || '—'}</span>
                            {o.region_name && <span>🌍 {o.region_name}</span>}
                          </div>
                          <div className="slim-row">
                            <span>🕐 {formatDate(o.created_at)}</span>
                            <span>✅ {formatDate(o.delivered_at)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {/* ── الأرشيف ── */}
        {activeTab === 'archive' && (
          <div className="sub-page">

            {/* Date range filter */}
            <div className="date-range-card" style={{ marginBottom: 10 }}>
              <div className="date-range-title">📅 فلترة بتاريخ التوصيل</div>
              <div className="date-range-row">
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
              <button className="btn-primary" style={{ marginTop: 10 }} onClick={() => { setArchFetched(false); fetchArchive(); }}>🔍 بحث بالتاريخ</button>
            </div>

            {/* بحث نصي: صيدلية / منطقة / سائق */}
            <input
              className="search-input"
              type="text"
              placeholder="🔍 بحث: صيدلية / منطقة / سائق..."
              value={archSearch}
              onChange={e => setArchSearch(e.target.value)}
            />

            {/* بحث برقم الفاتورة */}
            <input
              className="search-input"
              type="text"
              inputMode="numeric"
              placeholder="🔢 بحث برقم الفاتورة..."
              value={archInvoice}
              onChange={e => setArchInvoice(e.target.value)}
              dir="ltr"
            />

            {loadingArch ? (
              <div style={{ textAlign: 'center', padding: 30 }}>
                <div className="spinner" style={{ margin: '0 auto', borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} />
              </div>
            ) : (() => {
              const s   = archSearch.trim().toLowerCase();
              const inv = archInvoice.trim();
              const filtered = archOrders.filter(o => {
                if (s && !(
                  (o.pharmacy_name || '').toLowerCase().includes(s) ||
                  (o.region_name   || '').toLowerCase().includes(s) ||
                  (o.driver_name   || '').toLowerCase().includes(s)
                )) return false;
                if (inv && !(o.invoice_numbers || []).some(n => n.includes(inv))) return false;
                return true;
              });
              return filtered.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📁</div>
                  <p>{(archSearch || archInvoice) ? 'لا توجد نتائج مطابقة' : 'لا توجد طلبيات مؤرشفة'}</p>
                </div>
              ) : (
                <div className="orders-list">
                  {filtered.map(o => (
                    <div key={o.id} className="order-card" style={{ borderRight: '4px solid var(--success)' }}>
                      <div className="order-card-header">
                        <span className="order-pharmacy">🏥 {o.pharmacy_name || '—'}</span>
                        <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 600 }}>✅ تم التوصيل</span>
                      </div>
                      {o.invoice_numbers?.length > 0 && (
                        <div className="order-invoices">
                          {o.invoice_numbers.map((inv, i) => <span key={i} className="invoice-chip">#{inv}</span>)}
                        </div>
                      )}
                      <div className="order-meta">
                        {o.region_name && <div className="order-meta-item"><span className="order-meta-icon">🌍</span><span>{o.region_name}</span></div>}
                        {o.driver_name && <div className="order-meta-item"><span className="order-meta-icon">🚗</span><span>{o.driver_name}</span></div>}
                        {o.packages_note && <div className="order-meta-item"><span className="order-meta-icon">📦</span><span>{o.packages_note}</span></div>}
                        <div className="order-meta-item"><span className="order-meta-icon">🕐</span><span>أُنشئت: {formatDate(o.created_at)}</span></div>
                        {o.delivered_at && <div className="order-meta-item"><span className="order-meta-icon">✅</span><span>وُصِّلت: {formatDate(o.delivered_at)}</span></div>}
                        {o.notes && <div className="order-meta-item"><span className="order-meta-icon">📝</span><span>{o.notes}</span></div>}
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <button
                          className="btn-danger"
                          style={{ fontSize: 13, width: '100%' }}
                          disabled={archDeleting === o.id}
                          onClick={() => softDeleteFromArchive(o.id)}
                        >
                          {archDeleting === o.id ? 'جاري الحذف...' : '🗑️ نقل إلى المحذوفات'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── المحذوفات ── */}
        {activeTab === 'deleted' && (
          <div className="sub-page">
            {loadingDeleted ? (
              <div style={{ textAlign: 'center', padding: 30 }}>
                <div className="spinner" style={{ margin: '0 auto', borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} />
              </div>
            ) : deletedOrders.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🗑️</div>
                <p>سلة المهملات فارغة</p>
              </div>
            ) : (
              <div className="orders-list">
                {deletedOrders.map(o => (
                  <div key={o.id} className="order-card" style={{ opacity: 0.85 }}>
                    <div className="order-card-header">
                      <span className="order-pharmacy">🏥 {o.pharmacy_name || '—'}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>🗑️ {formatDate(o.deleted_at)}</span>
                    </div>
                    {o.invoice_numbers?.length > 0 && (
                      <div className="order-invoices">
                        {o.invoice_numbers.map((inv, i) => <span key={i} className="invoice-chip">#{inv}</span>)}
                      </div>
                    )}
                    <div className="order-meta">
                      {o.region_name && <div className="order-meta-item"><span className="order-meta-icon">🌍</span><span>{o.region_name}</span></div>}
                      {o.driver_name && <div className="order-meta-item"><span className="order-meta-icon">🚗</span><span>{o.driver_name}</span></div>}
                      <div className="order-meta-item"><span className="order-meta-icon">🕐</span><span>{formatDate(o.created_at)}</span></div>
                    </div>
                    <div className="modal-actions" style={{ marginTop: 10 }}>
                      <button className="btn-outline" style={{ fontSize: 13 }} onClick={() => restoreOrder(o.id)}>↩️ استعادة</button>
                      <button className="btn-danger" style={{ fontSize: 13 }} onClick={() => hardDeleteOrder(o.id)}>🗑️ حذف نهائي</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ الشكاوى ══ */}
        {activeTab === 'complaints' && (
          <div className="sub-page">
            {/* فلتر الحالة */}
            <div className="complaint-filter-bar">
              {[
                { value: 'all',        label: 'الكل',           icon: '📋' },
                { value: 'new',        label: 'جديدة',          icon: '🆕' },
                { value: 'processing', label: 'جاري المعالجة', icon: '⚙️' },
                { value: 'resolved',   label: 'تمت المعالجة',  icon: '✅' },
              ].map(f => (
                <button
                  key={f.value}
                  className={`status-filter-btn${complaintFilter === f.value ? ' active' : ''}`}
                  onClick={() => setComplaintFilter(f.value)}
                >
                  <span>{f.icon}</span>
                  <span>{f.label}</span>
                  {f.value !== 'all' && (
                    <span className="status-filter-count">
                      {complaints.filter(c => c.status === f.value).length}
                    </span>
                  )}
                  {f.value === 'all' && (
                    <span className="status-filter-count">{complaints.length}</span>
                  )}
                </button>
              ))}
            </div>

            {loadingComplaints ? (
              <div style={{ textAlign: 'center', padding: 30 }}>
                <div className="spinner" style={{ margin: '0 auto', borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} />
              </div>
            ) : filteredComplaints.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📣</div>
                <p>لا توجد شكاوى</p>
              </div>
            ) : (
              <div className="items-list">
                {filteredComplaints.map(c => {
                  const si = complaintStatusInfo(c.status);
                  return (
                    <div key={c.id} className={`complaint-card complaint-card-${c.status}`}>
                      <div className="complaint-header">
                        <div className="complaint-pharmacy">🏥 {c.pharmacy_name || '—'}</div>
                        <span className="complaint-status-badge" style={{ color: si.color }}>
                          {si.icon} {si.label}
                        </span>
                      </div>
                      {c.pharmacy_phone && (
                        <div className="complaint-phone">📞 {c.pharmacy_phone}</div>
                      )}
                      <div className="complaint-message">{c.message}</div>
                      <div className="complaint-date">🕐 {formatDate(c.created_at)}</div>
                      <div className="complaint-actions">
                        {c.status !== 'processing' && c.status !== 'resolved' && (
                          <button
                            className="btn-outline"
                            style={{ fontSize: 12, padding: '5px 12px' }}
                            onClick={() => updateComplaintStatus(c.id, 'processing')}
                          >
                            ⚙️ جاري المعالجة
                          </button>
                        )}
                        {c.status !== 'resolved' && (
                          <button
                            className="btn-outline"
                            style={{ fontSize: 12, padding: '5px 12px', borderColor: 'var(--success)', color: 'var(--success)' }}
                            onClick={() => updateComplaintStatus(c.id, 'resolved')}
                          >
                            ✅ تمت المعالجة
                          </button>
                        )}
                        <button
                          className="btn-danger-outline"
                          style={{ fontSize: 12, padding: '5px 12px' }}
                          onClick={() => deleteComplaint(c.id)}
                        >
                          🗑️ حذف
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── الإحصائيات ── */}
        {activeTab === 'stats' && <>

          {/* ── Stat Cards (3 بطاقات — الطلبيات النشطة فقط) ── */}
          <div className="admin-stat-cards" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
            {[
              { label: 'نشطة الكل',      value: stats.total,      icon: '📊', color: 'var(--primary-dark)' },
              { label: 'بانتظار السائق', value: stats.created,    icon: '🕐', color: 'var(--warning)'     },
              { label: 'جاري التوصيل',   value: stats.inProgress, icon: '🚗', color: 'var(--primary)'     },
            ].map(s => (
              <div key={s.label} className="admin-stat-card">
                <div className="admin-stat-icon">{s.icon}</div>
                <div className="admin-stat-num" style={{ color: s.color }}>{loading ? '—' : s.value}</div>
                <div className="admin-stat-label">{s.label}</div>
              </div>
            ))}
          </div>

          {/* ── بطاقة الشكاوى الجديدة ── */}
          {newComplaintsCount > 0 && (
            <div className="complaints-summary-card" onClick={() => setActiveTab('complaints')}>
              <div className="complaints-summary-left">
                <span className="complaints-summary-icon">📣</span>
                <div>
                  <div className="complaints-summary-title">شكاوى تنتظر المراجعة</div>
                  <div className="complaints-summary-sub">اضغط للعرض والمعالجة</div>
                </div>
              </div>
              <div className="complaints-count-badge">{newComplaintsCount}</div>
            </div>
          )}

          {/* ── فلتر المنطقة ── */}
          {regions.length > 0 && (
            <div className="region-select-wrap">
              <span className="region-select-icon">🌍</span>
              <select
                className="region-select"
                value={regionFilter}
                onChange={e => { regionFilterRef.current = e.target.value; setRegionFilter(e.target.value); }}
              >
                <option value="all">كل المناطق</option>
                {regions.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* ── زر إنشاء طلبية (مثل الموظف) ── */}
          <button className="btn-primary" style={{ width: '100%', margin: '4px 0 10px' }} onClick={openCreateOrder}>
            ➕ إنشاء طلبية جديدة
          </button>

          {/* ── فلتر الحالة ── */}
          <div className="status-filter-bar">
            {STATUS_FILTERS.map(s => (
              <button
                key={s.value}
                className={`status-filter-btn${activeStatus === s.value ? ' active' : ''}`}
                style={activeStatus === s.value ? { '--status-color': s.color } : {}}
                onClick={() => setActiveStatus(s.value)}
              >
                <span>{s.icon}</span>
                <span>{s.label}</span>
                {!loading && (
                  <span className="status-filter-count">
                    {s.value === 'all' ? stats.total : s.value === 'created' ? stats.created : stats.inProgress}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Orders List ── */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: 30 }}>
              <div className="spinner" style={{ margin: '0 auto', borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} />
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="empty-state"><div className="empty-icon">📭</div><p>لا توجد طلبيات في هذه الفترة</p></div>
          ) : (
            <div className="orders-list">
              {filteredOrders.map(order => {
                const si = statusInfo(order.status);
                return (
                  <div key={order.id} className="order-card order-card-slim">
                    <div className="order-card-header">
                      <span className="order-pharmacy">🏥 {order.pharmacy_name || '—'}</span>
                      <span className="order-status-badge" style={{ color: si.color, fontSize: 12, fontWeight: 700 }}>{si.icon} {si.label}</span>
                    </div>
                    {order.invoice_numbers?.length > 0 && (
                      <div className="order-invoices" style={{ margin: '4px 0' }}>
                        {order.invoice_numbers.map((inv, i) => <span key={i} className="invoice-chip">#{inv}</span>)}
                      </div>
                    )}
                    <div className="slim-row">
                      {order.region_name   && <span>🌍 {order.region_name}</span>}
                      <span>🚗 {order.driver_name || 'غير محدد'}</span>
                      {order.packages_note && <span>📦 {order.packages_note}</span>}
                    </div>
                    <div className="slim-row">
                      <span>🕐 {formatDate(order.created_at)}</span>
                      {order.notes && <span>📝 {order.notes}</span>}
                    </div>
                    <div className="slim-actions">
                      <button className="slim-btn slim-btn-edit" onClick={() => openEditOrder(order)}>✏️ تعديل</button>
                      <button className="slim-btn slim-btn-del"  onClick={() => setConfirmDeleteOrder(order)}>🗑️ حذف</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>}
      </div>

      {/* ── Bottom Tab Bar ── */}
      <div className="bottom-tab-bar">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab-btn${activeTab === t.id ? ' active' : ''}${t.id === 'complaints' ? ' tab-btn-complaints' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            <span className="tab-icon" style={{ position: 'relative', display: 'inline-block' }}>
              {t.icon}
              {t.id === 'complaints' && newComplaintsCount > 0 && (
                <span className="tab-badge">{newComplaintsCount > 9 ? '9+' : newComplaintsCount}</span>
              )}
            </span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </div>

      {/* ══ Edit Order Modal ══ */}
      {showEditModal && (
        <div className="modal-overlay" onClick={closeEditModal}>
          <div className="modal-sheet modal-sheet-tall" onClick={e => e.stopPropagation()}>
            <div className="modal-handle" />
            <div className="modal-title">{editingOrder ? '✏️ تعديل الطلبية' : '📦 إنشاء طلبية جديدة'}</div>
            <div className="modal-form">

              {/* تاريخ الإنشاء */}
              <div className="input-group">
                <label>تاريخ الإنشاء</label>
                <input readOnly value={editingOrder ? formatDate(editingOrder.created_at) : formatDate(new Date().toISOString())}
                  style={{ background: 'var(--bg)', color: 'var(--text-secondary)', cursor: 'default' }} />
              </div>

              {/* أرقام الفواتير */}
              <div className="input-group">
                <label>أرقام الفواتير *</label>
                <div className="invoice-input-row">
                  <input value={invoiceInput} onChange={e => setInvoiceInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addInvoice(); } }}
                    placeholder="رقم الفاتورة" dir="ltr" />
                  <button type="button" className="btn-scan" title="مسح الباركود"
                    onClick={() => setShowScanner(true)}>
                    📷
                  </button>
                  <button type="button" className="btn-add-inv" onClick={addInvoice}>+</button>
                </div>
                {editForm.invoice_numbers.length > 0 && (
                  <div className="order-invoices" style={{ marginTop: 8 }}>
                    {editForm.invoice_numbers.map((inv, i) => (
                      <span key={i} className="invoice-chip inv-removable">
                        #{inv}<button onClick={() => removeInvoice(i)}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* الصيدلية */}
              <div className="input-group" ref={pharDropRef}>
                <label>الصيدلية *</label>
                <input value={formPharSearch}
                  onChange={e => {
                    setFormPharSearch(e.target.value);
                    setFormPharOpen(true);
                    setEditForm(f => ({ ...f, pharmacy_id: '', pharmacy_name: '' }));
                  }}
                  onFocus={() => setFormPharOpen(true)}
                  placeholder="ابحث واختر الصيدلية..." />
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

              {/* المنطقة */}
              <div className="input-group">
                <label>المنطقة</label>
                <select value={editForm.region_id} onChange={e => selectRegionEdit(e.target.value)}>
                  <option value="">— اختر المنطقة —</option>
                  {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>

              {/* الكميات */}
              <div className="input-group">
                <label>الكميات</label>
                <div className="count-row">
                  {[{ key: 'carton_count', label: '📦 كارتون' }, { key: 'bag_count', label: '👜 كيس' }, { key: 'fridge_count', label: '❄️ براد' }].map(({ key, label }) => (
                    <div key={key} className="count-group">
                      <label>{label}</label>
                      <select value={editForm[key]} onChange={e => setEditField(key, +e.target.value)}>
                        {COUNTS.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* السائق */}
              <div className="input-group">
                <label>السائق *</label>
                <select value={editForm.driver_id} onChange={e => selectDriver(e.target.value)}>
                  <option value="">— اختر السائق —</option>
                  {allDrivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>

              {/* ملاحظات */}
              <div className="input-group">
                <label>ملاحظات</label>
                <textarea value={editForm.notes} onChange={e => setEditField('notes', e.target.value)}
                  placeholder="ملاحظات اختيارية..." rows={2} style={{ resize: 'none' }} />
              </div>
            </div>

            {editError && <div className="error-msg" style={{ margin: '8px 0' }}>{editError}</div>}
            <div className="modal-actions">
              <button className="btn-primary" onClick={() => saveEditOrder(false)} disabled={savingEdit}>
                {savingEdit ? 'جاري الحفظ...' : (editingOrder ? '💾 حفظ التعديل' : '💾 حفظ')}
              </button>
              <button className="btn-primary" style={{ background: 'var(--success)' }} onClick={() => saveEditOrder(true)} disabled={savingEdit}>
                🖨️ حفظ مع طباعة
              </button>
              <button className="btn-outline" onClick={closeEditModal}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Print Modal ══ */}
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

      {/* ══ Confirm Delete Order ══ */}
      {confirmDeleteOrder && (
        <div className="modal-overlay" onClick={() => setConfirmDeleteOrder(null)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-handle" />
            <div className="delete-confirm-box">
              <div className="delete-confirm-text">
                حذف طلبية <strong>{confirmDeleteOrder.pharmacy_name}</strong>؟<br />
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>تنتقل لسلة المهملات — يمكن استعادتها لاحقاً</span>
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
