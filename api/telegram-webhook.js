/**
 * api/telegram-webhook.js
 * Webhook لبوت تيليجرام — يرد تلقائياً برقم المعرّف (chat_id)
 * عندما يضغط أي شخص Start أو يُضاف البوت لكروب.
 * النتيجة: المندوب يقرأ الرقم من الشاشة مباشرة ويضيفه بالبرنامج
 * بدون الحاجة لـ getUpdates أو مشاركة التوكن.
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.VITE_TELEGRAM_BOT_TOKEN;
const BASE  = `https://api.telegram.org/bot${TOKEN}`;

async function send(chatId, text) {
  await fetch(`${BASE}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: chatId, text }),
  });
}

function buildReply(chat) {
  const id = chat.id;
  const isGroup = chat.type === 'group' || chat.type === 'supergroup';
  if (isGroup) {
    return [
      '✅ تم ربط هذا الكروب بنظام رياده كونكت',
      '',
      '🆔 رقم المعرّف (Chat ID):',
      `${id}`,
      '',
      '📋 انسخ هذا الرقم وأعطه للمندوب ليضيفه في بيانات الصيدلية.',
    ].join('\n');
  }
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ');
  return [
    `✅ أهلاً ${name || ''}`.trim(),
    '',
    '🆔 رقم المعرّف الخاص بك (Chat ID):',
    `${id}`,
    '',
    '📋 انسخ هذا الرقم وأعطه للمندوب ليضيفه في برنامج رياده كونكت،',
    'حتى تصلك إشعارات توصيل طلبياتك.',
  ].join('\n');
}

export default async function handler(req, res) {
  // تيليجرام يرسل POST دائماً
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  try {
    const upd = req.body || {};

    // 1) أُضيف البوت إلى كروب (أو تغيّرت صلاحياته)
    if (upd.my_chat_member) {
      const status = upd.my_chat_member.new_chat_member?.status;
      const chat   = upd.my_chat_member.chat;
      if (chat && (status === 'member' || status === 'administrator')) {
        await send(chat.id, buildReply(chat));
      }
      return res.status(200).json({ ok: true });
    }

    // 2) رسالة عادية: نرد إذا كانت /start أو في محادثة خاصة
    const m = upd.message || upd.edited_message;
    if (m && m.chat) {
      const text      = (m.text || '').trim().toLowerCase();
      const isStart   = text.startsWith('/start') || text.startsWith('/id');
      const isPrivate = m.chat.type === 'private';
      if (isStart || isPrivate) {
        await send(m.chat.id, buildReply(m.chat));
      }
    }
  } catch (e) {
    console.error('telegram-webhook error:', e);
  }

  return res.status(200).json({ ok: true });
}
