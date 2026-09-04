import { useState } from 'react';
import { supabase } from '../../supabase';
import { classifyInvoices } from '../../utils/invoices';

// أرضية التقرير: نتجاهل كل ما قبل هذا التاريخ (بيانات قديمة فيها خلل)
const START_DATE = '2026-09-05';

function fmtDateOnly(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
function fmtTimeOnly(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function fmtDuration(fromISO, toISO) {
  if (!fromISO || !toISO) return '—';
  const mins = Math.round((new Date(toISO) - new Date(fromISO)) / 60000);
  if (mins < 0) return '—';
  if (mins < 60) return `${mins} دقيقة`;
  return `${Math.floor(mins / 60)} ساعة ${mins % 60} دقيقة`;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const COLS = ['التاريخ', 'رقم الفاتورة', 'الصيدلية', 'الأكياس', 'الكراتين', 'البراد', 'الوقت', 'السائق', 'المردود', 'الملاحظات', 'مدة التوصيل'];

export default function ReportsTab() {
  const today = new Date().toISOString().slice(0, 10);
  const [warehouse, setWarehouse] = useState('meds');
  const [from, setFrom]           = useState(today);
  const [to, setTo]               = useState(today);
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(false);
  const [searched, setSearched]   = useState(false);
  const [search, setSearch]       = useState('');
  const [filter, setFilter]       = useState('all'); // all | delivered | pending | missing

  const whName = warehouse === 'meds' ? 'مخزن الأدوية' : 'مخزن المواد العامة';

  async function runReport() {
    setLoading(true);
    setSearched(true);
    setFilter('all');
    try {
      const displayFrom    = from < START_DATE ? START_DATE : from;
      const existFromISO   = new Date(START_DATE + 'T00:00:00').toISOString();
      const displayFromISO = new Date(displayFrom + 'T00:00:00').toISOString();
      const toISO          = new Date(to + 'T23:59:59').toISOString();

      // نجلب كل الطلبيات من الأرضية حتى نهاية الفترة — لكشف المفقود بدقة عبر كل الأيام
      const { data, error } = await supabase.from('orders')
        .select('invoice_numbers, pharmacy_name, carton_count, bag_count, fridge_count, driver_name, created_at, delivered_at, return_status, delivery_notes, status')
        .is('deleted_at', null)
        .gte('created_at', existFromISO)
        .lte('created_at', toISO)
        .order('created_at');
      if (error) throw error;

      const map = new Map(); // رقم الفاتورة → بيانات الطلبية
      for (const o of (data || [])) {
        const cls  = classifyInvoices(o.invoice_numbers);
        const list = warehouse === 'meds' ? cls.meds : cls.general;
        for (const inv of list) {
          const n = parseInt(inv, 10);
          if (isNaN(n)) continue;
          map.set(n, {
            num: n, missing: false,
            otherDate: new Date(o.created_at) < new Date(displayFromISO), // موجود لكن بيوم خارج الفترة المحددة
            date:     fmtDateOnly(o.created_at),
            pharmacy: o.pharmacy_name || '—',
            bags:     o.bag_count > 0 ? String(o.bag_count) : '—',
            cartons:  o.carton_count > 0 ? String(o.carton_count) : '—',
            fridge:   o.fridge_count > 0 ? String(o.fridge_count) : '—',
            time:     fmtTimeOnly(o.delivered_at),
            driver:   o.driver_name || '—',
            hasReturn: o.status === 'delivered' ? !!o.return_status : null,
            notes:    o.delivery_notes || '—',
            status:   o.status,
            duration: o.status === 'delivered' ? fmtDuration(o.created_at, o.delivered_at) : '—',
          });
        }
      }

      // نطاق العرض = أصغر/أكبر رقم ضمن الفترة المحددة فقط
      const inRangeNums = [...map.entries()].filter(([, v]) => !v.otherDate).map(([k]) => k);
      const result = [];
      if (inRangeNums.length) {
        const min = Math.min(...inRangeNums), max = Math.max(...inRangeNums);
        for (let i = min; i <= max; i++) {
          // موجود (بالفترة أو بيوم آخر) → صف عادي، غير موجود إطلاقاً → مفقود حقيقي (أحمر)
          result.push(map.has(i) ? map.get(i) : { num: i, missing: true });
        }
      }
      setRows(result);
    } catch (e) {
      console.error('report error:', e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  function buildSummaryText() {
    const missNums = rows.filter(r => r.missing).map(r => r.num);
    return [
      `📊 تقرير ${whName}`,
      `📅 الفترة: ${from} إلى ${to}`,
      `🟩 موصّلة: ${deliveredCount}`,
      `🟨 غير موصّلة: ${pendingCount}`,
      `🟥 مفقودة: ${missingCount}`,
      missNums.length ? `\n🔴 الأرقام المفقودة:\n${missNums.join('، ')}` : '',
    ].filter(Boolean).join('\n');
  }

  async function shareTelegram() {
    const text = buildSummaryText();
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch (_) { /* أُلغيت المشاركة */ }
    }
    window.open(`https://t.me/share/url?url=${encodeURIComponent('https://riyada-delivery.vercel.app')}&text=${encodeURIComponent(text)}`, '_blank');
  }

  function printReport(list) {
    if (!list.length) return;
    const logoUrl = `${window.location.origin}/logo.png`;
    const cls = r => r.missing ? 'missing' : (r.otherDate ? 'other' : (r.status === 'delivered' ? 'delivered' : 'pending'));
    const rowsHtml = list.map(r => r.missing
      ? `<tr class="missing"><td>—</td><td>${r.num}</td><td colspan="9">☐ لم يُسلّم هذا الرقم التسلسلي إلى السائق</td></tr>`
      : `<tr class="${cls(r)}"><td>${r.date}</td><td>${r.num}</td><td>${esc(r.pharmacy)}</td><td>${r.bags}</td><td>${r.cartons}</td><td>${r.fridge}</td><td>${r.time}</td><td>${esc(r.driver)}</td><td>${r.hasReturn === null ? '—' : (r.hasReturn ? 'نعم مردود' : 'لا')}</td><td>${esc(r.notes)}</td><td>${esc(r.duration)}</td></tr>`
    ).join('');

    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"/><title>تقرير</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'Amiri','Traditional Arabic','Times New Roman',serif;color:#000;padding:6mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        .head{text-align:center;margin-bottom:8px}
        .logo{height:56px;width:56px;object-fit:contain}
        .company{font-size:18px;font-weight:700;margin-top:3px}
        .rtitle{font-size:14px;font-weight:700;margin-top:5px}
        .meta{font-size:11px;color:#333;margin-top:2px}
        table{border-collapse:collapse;margin:10px auto 0;font-size:13px}
        th,td{border:1px solid #000;padding:5px 9px;text-align:center;white-space:nowrap;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        th{background:#e5e5e5;font-weight:700}
        tr.delivered td{background:#dcfce7}
        tr.pending td{background:#fef9c3}
        tr.other td{background:#f1f2f4}
        tr.missing td{background:#fde2e2;color:#b91c1c;font-weight:700}
        @media print{@page{size:A4 landscape;margin:6mm}}
      </style></head><body>
      <div class="head">
        <img src="${logoUrl}" class="logo" onerror="this.style.display='none'"/>
        <div class="company">مذخر ادويه الرياده</div>
        <div class="rtitle">تقرير الطلبيات — ${whName}</div>
        <div class="meta">من ${from} إلى ${to}</div>
      </div>
      <table>
        <thead><tr>${COLS.map(c => `<th>${c}</th>`).join('')}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      </body></html>`;

    let frame = document.getElementById('__riyada_report_frame__');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = '__riyada_report_frame__';
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:297mm;height:210mm;border:0;';
      document.body.appendChild(frame);
    }
    const fdoc = frame.contentWindow.document;
    fdoc.open(); fdoc.write(html); fdoc.close();
    setTimeout(() => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { console.warn(e); } }, 500);
  }

  const missingCount   = rows.filter(r => r.missing).length;
  const deliveredCount = rows.filter(r => !r.missing && !r.otherDate && r.status === 'delivered').length;
  const pendingCount   = rows.filter(r => !r.missing && !r.otherDate && r.status !== 'delivered').length;

  // فلترة بالأزرار + البحث
  let shown = rows;
  if (filter === 'delivered')    shown = shown.filter(r => !r.missing && !r.otherDate && r.status === 'delivered');
  else if (filter === 'pending') shown = shown.filter(r => !r.missing && !r.otherDate && r.status !== 'delivered');
  else if (filter === 'missing') shown = shown.filter(r => r.missing);
  const q = search.trim().toLowerCase();
  if (q) shown = shown.filter(r => String(r.num).includes(q) || (!r.missing && (r.pharmacy || '').toLowerCase().includes(q)));

  const td = (extra) => ({ padding: '7px 6px', border: '1px solid #e5e7eb', ...extra });
  const fbtn = (id, label, color) => (
    <button
      onClick={() => setFilter(filter === id ? 'all' : id)}
      style={{
        padding: '5px 10px', fontSize: 12, borderRadius: 20, cursor: 'pointer', fontWeight: 700,
        border: `1px solid ${color}`,
        background: filter === id ? color : 'transparent',
        color: filter === id ? '#fff' : color,
      }}>{label}</button>
  );

  return (
    <div className="sub-page">
      {/* اختيار المخزن */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button className={`role-toggle-btn${warehouse === 'meds' ? ' active' : ''}`} style={{ flex: 1, padding: '8px 0' }} onClick={() => setWarehouse('meds')}>💊 مخزن الأدوية</button>
        <button className={`role-toggle-btn${warehouse === 'general' ? ' active' : ''}`} style={{ flex: 1, padding: '8px 0' }} onClick={() => setWarehouse('general')}>📦 المواد العامة</button>
      </div>

      {/* الفترة */}
      <div className="date-range-card" style={{ marginBottom: 10 }}>
        <div className="date-range-row">
          <div className="date-field"><label>من</label><input type="date" value={from} min={START_DATE} onChange={e => setFrom(e.target.value)} /></div>
          <div className="date-range-arrow">←</div>
          <div className="date-field"><label>إلى</label><input type="date" value={to} min={START_DATE} onChange={e => setTo(e.target.value)} /></div>
        </div>
        <button className="btn-primary" style={{ marginTop: 10, width: '100%' }} onClick={runReport} disabled={loading}>
          {loading ? 'جاري التحميل...' : '🔍 عرض التقرير'}
        </button>
      </div>

      {/* بحث */}
      {rows.length > 0 && (
        <input className="search-input" type="text" style={{ marginBottom: 8 }} placeholder="🔍 بحث باسم الصيدلية أو رقم الفاتورة..." value={search} onChange={e => setSearch(e.target.value)} />
      )}

      {/* أزرار الفلترة + مشاركة + طباعة */}
      {searched && !loading && rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {fbtn('delivered', `🟩 موصّلة ${deliveredCount}`, '#16a34a')}
          {fbtn('pending',   `🟨 غير موصّلة ${pendingCount}`, '#a16207')}
          {fbtn('missing',   `🟥 مفقودة ${missingCount}`, '#dc2626')}
          <div style={{ marginRight: 'auto', display: 'flex', gap: 6 }}>
            <button className="btn-outline" style={{ padding: '6px 12px' }} onClick={shareTelegram}>📤 مشاركة</button>
            <button className="btn-outline" style={{ padding: '6px 12px' }} onClick={() => printReport(shown)}>🖨️ طباعة</button>
          </div>
        </div>
      )}

      {/* الجدول */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 30 }}><div className="spinner" style={{ margin: '0 auto', borderTopColor: 'var(--primary)', borderColor: 'var(--border)' }} /></div>
      ) : searched && rows.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">📊</div><p>لا توجد فواتير لهذا المخزن في الفترة المحددة</p></div>
      ) : rows.length > 0 ? (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap' }}>
            <thead>
              <tr>{COLS.map(c => <th key={c} style={{ background: 'var(--bg)', padding: '8px 6px', border: '1px solid #d1d5db', fontSize: 11, position: 'sticky', top: 0 }}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {shown.map((r, i) => r.missing ? (
                <tr key={i} style={{ background: '#fee2e2', color: '#b91c1c', fontWeight: 700 }}>
                  <td style={td({ textAlign: 'center' })}>—</td>
                  <td style={td({ textAlign: 'center' })}>{r.num}</td>
                  <td style={td({ textAlign: 'right' })} colSpan={9}>☐ لم يُسلّم هذا الرقم التسلسلي إلى السائق</td>
                </tr>
              ) : (
                <tr key={i} style={{ background: r.otherDate ? '#f1f2f4' : (r.status === 'delivered' ? '#dcfce7' : '#fef9c3') }}>
                  <td style={td({ textAlign: 'center' })}>{r.date}</td>
                  <td style={td({ textAlign: 'center', fontWeight: 700 })}>{r.num}</td>
                  <td style={td({ textAlign: 'right' })}>{r.pharmacy}</td>
                  <td style={td({ textAlign: 'center' })}>{r.bags}</td>
                  <td style={td({ textAlign: 'center' })}>{r.cartons}</td>
                  <td style={td({ textAlign: 'center' })}>{r.fridge}</td>
                  <td style={td({ textAlign: 'center' })}>{r.time}</td>
                  <td style={td({ textAlign: 'right' })}>{r.driver}</td>
                  <td style={td({ textAlign: 'center', color: r.hasReturn ? 'var(--danger)' : 'inherit', fontWeight: r.hasReturn ? 700 : 400 })}>{r.hasReturn === null ? '—' : (r.hasReturn ? 'نعم مردود' : 'لا')}</td>
                  <td style={td({ textAlign: 'right' })}>{r.notes}</td>
                  <td style={td({ textAlign: 'center' })}>{r.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
