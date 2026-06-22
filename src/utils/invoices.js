/**
 * invoices.js
 * تصنيف أرقام الفواتير حسب رمز المخزن في بدايتها:
 *   "1 23455" → فواتير الأدوية   (يبدأ بـ 1 ثم مسافة)
 *   "2 78900" → فواتير العامة     (يبدأ بـ 2 ثم مسافة)
 *   "23455"   → بدون رمز → تظهر عادي تحت "الفواتير"
 * يُستخدم في طباعة الوصل ورسالة التيليجرام معاً.
 */

export function classifyInvoices(list) {
  const meds = [], general = [], other = [];
  for (const raw of (list || [])) {
    const s = String(raw).trim();
    const m = s.match(/^([12])\s+(.+)$/);
    if      (m && m[1] === '1') meds.push(m[2].trim());
    else if (m && m[1] === '2') general.push(m[2].trim());
    else                         other.push(s);
  }
  return { meds, general, other };
}

/** أسطر الفواتير المصنّفة لرسالة التيليجرام (تتجاهل المجموعة الفارغة) */
export function invoiceTelegramLines(list) {
  const { meds, general, other } = classifyInvoices(list);
  const lines = [];
  if (meds.length)    lines.push(`💊 فواتير الأدوية: ${meds.join('، ')}`);
  if (general.length) lines.push(`📦 فواتير العامة: ${general.join('، ')}`);
  if (other.length)   lines.push(`📋 الفواتير: ${other.join('، ')}`);
  if (!lines.length)  lines.push(`📋 الفواتير: —`);
  return lines;
}
