/**
 * telegram.js — إرسال رسائل تيليجرام عبر Telegram Bot API
 * التوكن: VITE_TELEGRAM_BOT_TOKEN في ملف .env (تُنشئه عبر @BotFather)
 * كروب المخزن: VITE_TELEGRAM_WAREHOUSE_CHAT في ملف .env (رقم سالب لو كروب، مثال: -1001234567890)
 *
 * ملاحظة: تيليجرام لا يسمح بالإرسال برقم الهاتف — كل صيدلية يجب أن
 * تبدأ محادثة مع البوت أولاً (Start) حتى نحصل على chat_id الخاص بها،
 * ثم يُدخله الأدمن في بيانات الصيدلية (telegram_chat_id).
 */

import { invoiceTelegramLines } from './invoices';

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

/** رفع صورة مباشرة (بلوب) لتيليجرام — يرجع file_id لإعادة استخدامه بلا رفع ثانٍ */
async function sendPhotoBlob({ chatId, blob, caption }) {
  if (!TOKEN || !chatId || !blob) return null;
  try {
    const fd = new FormData();
    fd.append('chat_id', String(chatId));
    if (caption) fd.append('caption', caption);
    fd.append('photo', blob, 'photo.jpg');
    const res  = await fetch(`${BASE}/sendPhoto`, { method: 'POST', body: fd });
    const json = await res.json().catch(() => null);
    if (!json || !json.ok) { console.warn('Telegram sendPhoto فشل:', json?.description); return null; }
    const arr = json.result?.photo || [];
    return arr.length ? arr[arr.length - 1].file_id : null;
  } catch (e) { console.warn('Telegram photo blob:', e); return null; }
}

/** إرسال صورة عبر file_id (بلا إعادة رفع) */
async function sendPhotoId({ chatId, fileId, caption }) {
  if (!TOKEN || !chatId || !fileId) return;
  try {
    const res = await fetch(`${BASE}/sendPhoto`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, photo: fileId, caption }),
    });
    if (!res.ok) await checkResult(res, 'sendPhoto(id)');
  } catch (e) { console.warn('Telegram photo id:', e); }
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
 * @param {Blob[]}   p.photoBlobs      صور الفواتير (تُرسل مباشرة لتيليجرام بدون تخزين)
 */
export async function sendDeliveryConfirmation(p) {
  const warehouseChat = import.meta.env.VITE_TELEGRAM_WAREHOUSE_CHAT || '';
  const pharmChatId   = p.pharmacyChatId || null;
  const invLines      = invoiceTelegramLines(p.invoiceNumbers);
  const deliveredAt   = p.deliveredAt || new Date().toISOString();
  const mins          = calcMins(p.createdAt, deliveredAt);
  const duration      = fmtDuration(mins);

  // ── رسالة الصيدلية ──
  const pharmMsg = [
    `✅ تم توصيل طلبيتكم`,
    ...invLines,
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
    ...invLines,
    `🚗 السائق: ${p.driverName || '—'}`,
    `🕐 التوصيل: ${fmtDateTime(deliveredAt)}`,
    duration ? `⏳ المدة: ${duration}` : '',
    p.hasReturn ? `⚠️ مردودات: نعم` : '',
    p.notes ? `📝 ملاحظات: ${p.notes}` : '',
  ].filter(Boolean).join('\n');

  const blobs = p.photoBlobs || [];

  // بلا صور: نص فقط للطرفين
  if (blobs.length === 0) {
    if (pharmChatId)   await sendText({ chatId: pharmChatId, text: pharmMsg });
    if (warehouseChat) await sendText({ chatId: warehouseChat, text: warehouseMsg });
    return;
  }

  // مع صور: أول صورة تحمل النص الكامل، الباقي «صورة N»
  // نرفع الصورة مرة واحدة (للصيدلية) ونعيد استخدام file_id للمخزن — توفيراً للبيانات
  for (let i = 0; i < blobs.length; i++) {
    const blob     = blobs[i];
    const pharmCap = i === 0 ? pharmMsg     : `صورة ${i + 1}`;
    const whCap    = i === 0 ? warehouseMsg : `صورة ${i + 1}`;
    let fileId = null;
    if (pharmChatId) fileId = await sendPhotoBlob({ chatId: pharmChatId, blob, caption: pharmCap });
    if (warehouseChat) {
      if (fileId) await sendPhotoId({ chatId: warehouseChat, fileId, caption: whCap });
      else        await sendPhotoBlob({ chatId: warehouseChat, blob, caption: whCap });
    }
  }
}
