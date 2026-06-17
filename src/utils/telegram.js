/**
 * telegram.js — إرسال رسائل تيليجرام عبر Telegram Bot API
 * التوكن: VITE_TELEGRAM_BOT_TOKEN في ملف .env (تُنشئه عبر @BotFather)
 * كروب المخزن: VITE_TELEGRAM_WAREHOUSE_CHAT في ملف .env (رقم سالب لو كروب، مثال: -1001234567890)
 *
 * ملاحظة: تيليجرام لا يسمح بالإرسال برقم الهاتف — كل صيدلية يجب أن
 * تبدأ محادثة مع البوت أولاً (Start) حتى نحصل على chat_id الخاص بها،
 * ثم يُدخله الأدمن في بيانات الصيدلية (telegram_chat_id).
 */

const TOKEN = import.meta.env.VITE_TELEGRAM_BOT_TOKEN || '';
const BASE  = `https://api.telegram.org/bot${TOKEN}`;

/** يفحص رد تيليجرام ويسجّل سبب الفشل (chat_id غلط، البوت محظور، توكن خاطئ...) بدل تجاهله بصمت */
async function checkResult(res, label) {
  try {
    const json = await res.json();
    if (!json.ok) console.warn(`Telegram ${label} فشل:`, json.description || json);
  } catch (_) {
    console.warn(`Telegram ${label} فشل: رد غير متوقع (status ${res.status})`);
  }
}

/** إرسال صورة (رابط) مع نص */
async function sendPhoto({ chatId, url, caption }) {
  if (!TOKEN || !chatId) return;
  try {
    const res = await fetch(`${BASE}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, photo: url, caption }),
    });
    if (!res.ok) await checkResult(res, 'sendPhoto');
  } catch (e) { console.warn('Telegram photo:', e); }
}

/** إرسال نص فقط */
async function sendText({ chatId, text }) {
  if (!TOKEN || !chatId) return;
  try {
    const res = await fetch(`${BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) await checkResult(res, 'sendMessage');
  } catch (e) { console.warn('Telegram text:', e); }
}

/** تنسيق التاريخ والوقت */
function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const day   = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year  = d.getFullYear();
  return `${day}/${month}/${year} ${fmtTime(iso)}`;
}
function calcMins(from, to) {
  if (!from || !to) return null;
  return Math.round((new Date(to) - new Date(from)) / 60000);
}
function fmtDuration(mins) {
  if (mins === null || mins < 0) return null;
  if (mins < 60) return `${mins} دقيقة`;
  return `${Math.floor(mins / 60)} ساعة ${mins % 60} دقيقة`;
}

/**
 * إرسال تأكيد التوصيل لـ:
 *  1. تيليجرام الصيدلية (إذا كان لديها chat_id مسجّل)
 *  2. كروب المخزن
 *
 * @param {Object} p
 * @param {string}   p.pharmacyChatId  chat_id الخاص بالصيدلية في تيليجرام
 * @param {string}   p.pharmacyName    اسم الصيدلية
 * @param {string[]} p.invoiceNumbers  أرقام الفواتير
 * @param {string}   p.driverName      اسم السائق
 * @param {string}   p.createdAt       وقت الإنشاء (ISO)
 * @param {string}   p.deliveredAt     وقت التوصيل (ISO)
 * @param {boolean}  p.hasReturn       مردود؟
 * @param {string}   p.notes           ملاحظات
 * @param {string[]} p.photoUrls       روابط صور الفواتير
 */
export async function sendDeliveryConfirmation(p) {
  const warehouseChat = import.meta.env.VITE_TELEGRAM_WAREHOUSE_CHAT || '';
  const pharmChatId   = p.pharmacyChatId || null;
  const invText       = (p.invoiceNumbers || []).map(n => `#${n}`).join(' ');
  const deliveredAt   = p.deliveredAt || new Date().toISOString();
  const mins          = calcMins(p.createdAt, deliveredAt);
  const duration      = fmtDuration(mins);

  // ── رسالة الصيدلية ──
  const pharmMsg = [
    `✅ تم توصيل طلبيتكم`,
    `📋 الفواتير: ${invText || '—'}`,
    `🚗 السائق: ${p.driverName || '—'}`,
    `🕐 وقت التوصيل: ${fmtTime(deliveredAt)}`,
    p.hasReturn ? `⚠️ يوجد مردودات — يرجى المراجعة` : null,
    p.notes     ? `📝 ملاحظات: ${p.notes}` : null,
    ``,
    `رياده كونكت ✨`,
  ].filter(Boolean).join('\n');

  // ── رسالة مجموعة المخزن ──
  const warehouseMsg = [
    `✅ تم التوصيل`,
    ``,
    `🏥 الصيدلية: ${p.pharmacyName || '—'}`,
    `📋 الفواتير: ${invText || '—'}`,
    `🚗 السائق: ${p.driverName || '—'}`,
    `🕐 التوصيل: ${fmtDateTime(deliveredAt)}`,
    duration ? `⏳ المدة: ${duration}` : '',
    p.hasReturn ? `⚠️ مردودات: نعم` : '',
    p.notes ? `📝 ملاحظات: ${p.notes}` : '',
  ].filter(Boolean).join('\n');

  const firstPhoto  = p.photoUrls?.[0] || null;
  const extraPhotos = p.photoUrls?.slice(1) || [];

  // أرسل للصيدلية
  if (pharmChatId) {
    if (firstPhoto) {
      await sendPhoto({ chatId: pharmChatId, url: firstPhoto, caption: pharmMsg });
      for (let i = 0; i < extraPhotos.length; i++) {
        await sendPhoto({ chatId: pharmChatId, url: extraPhotos[i], caption: `صورة ${i + 2}` });
      }
    } else {
      await sendText({ chatId: pharmChatId, text: pharmMsg });
    }
  }

  // أرسل لمجموعة المخزن
  if (warehouseChat) {
    if (firstPhoto) {
      await sendPhoto({ chatId: warehouseChat, url: firstPhoto, caption: warehouseMsg });
      for (let i = 0; i < extraPhotos.length; i++) {
        await sendPhoto({ chatId: warehouseChat, url: extraPhotos[i], caption: `صورة ${i + 2}` });
      }
    } else {
      await sendText({ chatId: warehouseChat, text: warehouseMsg });
    }
  }
}
