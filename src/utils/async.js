/**
 * async.js — أدوات مساعدة للوعود (مشتركة بين اللوحات)
 */

// لو تعلّق استدعاء (شبكة/قفل)، يرفض بعد المهلة بدل التحميل اللانهائي
export function withTimeout(promise, ms = 20000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('تعذّر الحفظ — تأكد من الاتصال بالإنترنت وحاول مجدداً')), ms)
    ),
  ]);
}
