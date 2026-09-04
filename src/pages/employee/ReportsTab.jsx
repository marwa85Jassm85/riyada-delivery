import { useState } from 'react';
import { supabase } from '../../supabase';
import { classifyInvoices } from '../../utils/invoices';

function fmtDateOnly(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
function fmtTimeOnly(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function packagesText(o) {
  const parts = [];
  if (o.carton_count > 0) parts.push(`${o.carton_count} كرتون`);
  if (o.bag_count > 0)    parts.push(`${o.bag_count} كيس`);
  return parts.join('، ') || '—';
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const COLS = ['التاريخ', 'رقم الفاتورة', 'الصيدلية', 'الأكياس/الكراتين', 'البراد', 'الوقت', 'السائق', 'المردود', 'الملاحظات'];

export default function ReportsTab() {
  const today = new Date().toISOString().slice(0, 10);
  const [warehouse, setWarehouse] = useState('meds'); // 'meds' | 'general'
  const [from, setFrom]           = useState(today);
  const [to, setTo]               = useState(today);
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(false);
  const [searched, setSearched]   = useState(false);

  const whName = warehouse === 'meds' ? 'مخزن الأدوية' : 'مخزن المواد العامة';

  async function runReport() {
    setLoading(true);
    setSearched(true);
    try {
      const fromISO = new Date(from + 'T00:00:00').toISOString();
      const toISO   = new Date(to   + 'T23:59:59').toISOString();
      const { data, error } = await supabase.from('orders')
        .select('invoice_numbers, pharmacy_name, carton_count, bag_count, fridge_count, driver_name, created_at, delivered_at, return_status, delivery_notes, status')
        .is('deleted_at', null)
        .gte('created_at', fromISO)
        .lte('created_at', toISO)
        .order('created_at');
      if (error) throw error;

      // خريطة: رقم الفاتورة (رقمي) → بيانات الطلبية، للمخزن المختار فقط
      const map = new Map();
      for (const o of (data || [])) {
        const cls  = classifyInvoices(o.invoice_numbers);
        const list = warehouse === 'meds' ? cls.meds : cls.general;
        for (const inv of list) {
          const n = parseInt(inv, 10);
          if (isNaN(n)) continue;
          map.set(n, {
            num: n, missing: false,
            date:     fmtDateOnly(o.created_at),
            pharmacy: o.pharmacy_name || '—',
            packages: packagesText(o),
            fridge:   o.fridge_count > 0 ? String(o.fridge_count) : '—',
            time:     fmtTimeOnly(o.delivered_at),
            driver:   o.driver_name || '—',
            hasReturn: o.status === 'delivered' ? !!o.return_status : null,
            notes:    o.delivery_notes || '—',
          });
        }
      }

      // بناء التسلسل من الأصغر للأكبر مع كشف المفقود
      const nums = [...map.keys()];
      const result = [];
      if (nums.length) {
        const min = Math.min(...nums), max = Math.max(...nums);
        for (let i = min; i <= max; i++) {
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

  function printReport() {
    if (!rows.length) return;
    const logoUrl = `${window.location.origin}/logo.png`;
    const rowsHtml = rows.map(r => r.missing
      ? `<tr class="missing"><td>—</td><td>${r.num}</td><td colspan="7">☐ لم يُسلّم هذا الرقم التسلسلي إلى السائق</td></tr>`
      : `<tr><td>${r.date}</td><td>${r.num}</td><td>${esc(r.pharmacy)}</td><td>${esc(r.packages)}</td><td>${r.fridge}</td><td>${r.time}</td><td>${esc(r.driver)}</td><td>${r.hasReturn === null ? '—' : (r.hasReturn ? 'نعم مردود' : 'لا')}</td><td>${esc(r.notes)}</td></tr>`
    ).join('');

    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"/><title>تقرير</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'Amiri','Traditional Arabic','Times New Roman',serif;color:#000;padding:8mm}
        .head{text-align:center;margin-bottom:10px}
        .logo{height:64px;width:64px;object-fit:contain}
        .company{font-size:20px;font-weight:700;margin-top:4px}
        .rtitle{font-size:15px;font-weight:700;margin-top:6px}
        .meta{font-size:12px;color:#333;margin-top:2px}
        table{width:100%;border-collapse:collapse;margin-top:10px;font-size:11px}
        th,td{border:1px solid #000;padding:4px 5px;text-align:center}
        th{background:#eee;font-weight:700}
        tr.missing td{background:#fde2e2;color:#b91c1c;font-weight:700}
        @media print{@page{size:A4 landscape;margin:8mm}}
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

  const missingCount = rows.filter(r => r.missing).length;
  const doneCount    = rows.length - missingCount;

  return (
    <div className="sub-page">
      {/* اختيار المخزن */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button
          className={`role-toggle-btn${warehouse === 'meds' ? ' active' : ''}`}
          style={{ flex: 1, padding: '8px 0' }}
          onClick={() => setWarehouse('meds')}>💊 مخزن الأدوية</button>
        <button
          className={`role-toggle-btn${warehouse === 'general' ? ' active' : ''}`}
          style={{ flex: 1, padding: '8px 0' }}
          onClick={() => setWarehouse('general')}>📦 المواد العامة</button>
      </div>

      {/* الفترة */}
      <div className="date-range-card" style={{ marginBottom: 10 }}>
        <div className="date-range-row">
          <div className="date-field"><label>من</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div className="date-range-arrow">←</div>
          <div className="date-field"><label>إلى</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        </div>
        <button className="btn-primary" style={{ marginTop: 10, width: '100%' }} onClick={runReport} disabled={loading}>
          {loading ? 'جاري التحميل...' : '🔍 عرض التقرير'}
        </button>
      </div>

      {/* ملخص + طباعة */}
      {searched && !loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{ fontSize: 13 }}>✅ مسلّمة: <strong>{doneCount}</strong></span>
          {missingCount > 0 && <span style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 700 }}>⚠️ مفقودة: {missingCount}</span>}
          {rows.length > 0 && <button className="btn-outline" style={{ marginRight: 'auto', padding: '6px 14px' }} onClick={printReport}>🖨️ طباعة</button>}
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
              <tr>{COLS.map(c => <th key={c} style={{ background: 'var(--bg)', padding: '8px 6px', borderBottom: '2px solid var(--border)', fontSize: 11, position: 'sticky', top: 0 }}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => r.missing ? (
                <tr key={i} style={{ background: '#fee2e2', color: '#b91c1c', fontWeight: 700 }}>
                  <td style={{ padding: '7px 6px', textAlign: 'center' }}>—</td>
                  <td style={{ padding: '7px 6px', textAlign: 'center' }}>{r.num}</td>
                  <td style={{ padding: '7px 6px', textAlign: 'right' }} colSpan={7}>☐ لم يُسلّم هذا الرقم التسلسلي إلى السائق</td>
                </tr>
              ) : (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '7px 6px', textAlign: 'center' }}>{r.date}</td>
                  <td style={{ padding: '7px 6px', textAlign: 'center', fontWeight: 700 }}>{r.num}</td>
                  <td style={{ padding: '7px 6px', textAlign: 'right' }}>{r.pharmacy}</td>
                  <td style={{ padding: '7px 6px', textAlign: 'center' }}>{r.packages}</td>
                  <td style={{ padding: '7px 6px', textAlign: 'center' }}>{r.fridge}</td>
                  <td style={{ padding: '7px 6px', textAlign: 'center' }}>{r.time}</td>
                  <td style={{ padding: '7px 6px', textAlign: 'right' }}>{r.driver}</td>
                  <td style={{ padding: '7px 6px', textAlign: 'center', color: r.hasReturn ? 'var(--danger)' : 'inherit', fontWeight: r.hasReturn ? 700 : 400 }}>{r.hasReturn === null ? '—' : (r.hasReturn ? 'نعم مردود' : 'لا')}</td>
                  <td style={{ padding: '7px 6px', textAlign: 'right' }}>{r.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
