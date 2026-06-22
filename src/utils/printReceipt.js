/**
 * printReceipt.js
 * طباعة وصل التوصيل على ورق عرض 100 ملم (ملصق يُلصق على الطلبية).
 * مشترك بين لوحة الموظف ولوحة الأدمن حتى يبقى التصميم موحّداً.
 */

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

  // أرقام الفواتير: تبدأ من اليمين ومفصولة بفاصلة
  const invText = (order.invoice_numbers || []).join('، ') || '—';

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
        <div class="sub">برنامج رياده كونكت للتوصيل</div>
        <div class="rule"></div>
        <div class="doc-title">وصل التوصيل</div>
        <div class="rule"></div>
      </div>
      <div class="body">
        ${line('الصيدلية', order.pharmacy_name)}
        ${order.region_name ? line('المنطقة', order.region_name) : ''}
        ${line('الفواتير', invText, 'inv')}
        ${line('الكميات', packages)}
        ${line('السائق', order.driver_name)}
        ${line('التاريخ', date)}
        ${order.notes ? line('ملاحظات', order.notes) : ''}
      </div>
    </div>`;

  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"/>
    <title>وصل توصيل</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;background:#fff;color:#000}
      .page{width:100mm;padding:4mm 5mm;page-break-after:always}
      .header{text-align:center;margin-bottom:4px}
      .logo{height:62px;width:62px;object-fit:contain;margin-bottom:4px}
      .company{font-size:19px;font-weight:800;color:#000;margin-bottom:2px}
      .sub{font-size:14px;font-weight:600;color:#000;margin-bottom:5px}
      .rule{border-top:2px solid #000;margin:5px 0}
      .doc-title{font-size:17px;font-weight:800;color:#000;letter-spacing:1px;margin:5px 0}
      .body{margin-top:4px}
      .line{
        text-align:right;
        border-bottom:1.5px solid #000;
        padding:8px 2px;
        font-size:16px;
        color:#000;
        line-height:1.5;
      }
      .line:last-child{border-bottom:none}
      .lbl{font-weight:800;color:#000}
      .val{font-weight:600;color:#000;margin-right:4px}
      .line.inv .val{font-weight:800;font-size:17px;letter-spacing:.5px}
      @media print{@page{size:100mm auto;margin:0}body{margin:0}}
    </style></head><body>${Array(copies).fill(pageHTML).join('')}</body></html>`;

  const win = window.open('', '_blank', 'width=420,height=640');
  if (!win) { alert('السماح للنوافذ المنبثقة في المتصفح حتى تشتغل الطباعة'); return; }
  win.document.write(html);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 600);
}
