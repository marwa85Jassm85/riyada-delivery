/**
 * printReceipt.js
 * طباعة وصل التوصيل على ورق عرض 100 ملم (ملصق يُلصق على الطلبية).
 * مشترك بين لوحة الموظف ولوحة الأدمن حتى يبقى التصميم موحّداً.
 */

import { classifyInvoices } from './invoices';

function fmtDate(iso) {
  if (!iso) return '—';
  const d     = new Date(iso);
  const day   = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year  = d.getFullYear();
  const time  = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${day}/${month}/${year} ${time}`;
}

export function printOrderReceipt(order, copies = 1) {
  const logoUrl = `${window.location.origin}/logo.png`;

  // تصنيف الفواتير حسب رمز المخزن (1 أدوية / 2 عامة / بدون رمز)
  const { meds, general, other } = classifyInvoices(order.invoice_numbers);

  const packages = [
    order.carton_count > 0 ? `${order.carton_count} كارتون` : '',
    order.bag_count    > 0 ? `${order.bag_count} كيس`      : '',
    order.fridge_count > 0 ? `${order.fridge_count} براد`  : '',
  ].filter(Boolean).join(' + ') || '—';

  const date = fmtDate(order.created_at || new Date().toISOString());

  const line = (label, value, extraClass = '') => `
    <div class="line ${extraClass}">
      <span class="lbl">${label}:</span>
      <span class="val">${value || '—'}</span>
    </div>`;

  const pageHTML = `
    <div class="page">
      <div class="header">
        <img src="${logoUrl}" class="logo" onerror="this.style.display='none'" />
        <div class="company">مذخر ادوية الريادة</div>
        <div class="rule"></div>
        <div class="doc-title">وصل التوصيل</div>
        <div class="rule"></div>
      </div>
      <div class="body">
        ${line('الصيدلية', order.pharmacy_name)}
        ${order.region_name ? line('المنطقة', order.region_name) : ''}
        ${meds.length    ? line('فواتير الأدوية', meds.join('، '), 'inv') : ''}
        ${general.length ? line('فواتير العامة', general.join('، '), 'inv') : ''}
        ${other.length   ? line('الفواتير', other.join('، '), 'inv') : ''}
        ${(!meds.length && !general.length && !other.length) ? line('الفواتير', '—', 'inv') : ''}
        ${line('الكميات', packages)}
        ${line('السائق', order.driver_name)}
        ${line('التاريخ', date)}
        ${order.notes ? line('ملاحظات', order.notes) : ''}
      </div>
      <div class="footer">جميع الحقوق محفوظه @2026 — برمجة وتصميم قسم تكنلوجيا المعلومات MΔRWΔN</div>
    </div>`;

  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"/>
    <title>وصل توصيل</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Amiri','Traditional Arabic','Times New Roman',serif;background:#fff;color:#000}
      .page{width:100mm;padding:5mm 5mm;page-break-after:always}
      .header{text-align:center;margin-bottom:3px}
      .logo{height:80px;width:80px;object-fit:contain;margin-bottom:5px}
      .company{font-size:21px;font-weight:700;color:#000;margin-bottom:2px}
      .sub{font-size:15px;font-weight:700;color:#000;margin-bottom:3px}
      .rule{border-top:2px solid #000;margin:3px 0}
      .doc-title{font-size:18px;font-weight:700;color:#000;letter-spacing:1px;margin:3px 0}
      .body{margin-top:3px}
      .line{
        text-align:right;
        border-bottom:1.5px solid #000;
        padding:4px 2px;
        font-size:16px;
        color:#000;
        line-height:1.3;
      }
      .line:last-child{border-bottom:none}
      .lbl{font-weight:700;color:#000}
      .val{font-weight:400;color:#000;margin-right:4px}
      .line.inv{line-height:1.55}
      .line.inv .val{font-weight:700;font-size:17px;letter-spacing:.5px}
      .footer{margin-top:10px;padding-top:6px;border-top:1px solid #999;text-align:center;font-size:9px;font-weight:300;line-height:1.4;color:#666;white-space:nowrap}
      @media print{@page{size:100mm 150mm;margin:0}body{margin:0}}
    </style></head><body>${Array(copies).fill(pageHTML).join('')}</body></html>`;

  // طباعة عبر iframe مخفي — يعمل على iOS Safari واختصار الشاشة الرئيسية
  // (window.open محظور في الوضع المستقل على الآيفون)
  let frame = document.getElementById('__riyada_print_frame__');
  if (!frame) {
    frame = document.createElement('iframe');
    frame.id = '__riyada_print_frame__';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(frame);
  }
  const fdoc = frame.contentWindow.document;
  fdoc.open();
  fdoc.write(html);
  fdoc.close();

  // بعد رسم المحتوى: صغّر أرقام الفواتير إن لزم لتبقى ورقة واحدة، ثم اطبع
  setTimeout(() => {
    try {
      const fwin = frame.contentWindow;
      const MAX = 149 * 96 / 25.4;
      fwin.document.querySelectorAll('.page').forEach((page) => {
        const vals = page.querySelectorAll('.line.inv .val');
        if (!vals.length) return;
        let size = 17, guard = 0;
        while (page.offsetHeight > MAX && size > 8 && guard < 60) {
          size -= 0.5; guard++;
          vals.forEach((v) => { v.style.fontSize = size + 'px'; });
        }
      });
      fwin.focus();
      fwin.print();
    } catch (e) {
      console.warn('print error:', e);
      alert('تعذّرت الطباعة — جرّب فتح التطبيق من متصفح Safari مباشرة');
    }
  }, 450);
}
