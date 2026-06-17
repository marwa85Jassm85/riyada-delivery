/**
 * offlineDelivery.js
 * يخزن تأكيدات التوصيل في IndexedDB لما يكون النت مقطوع،
 * ويعالجها تلقائياً لما يرجع الاتصال.
 */

const DB_NAME = 'riyada_offline';
const DB_VER  = 1;
const STORE   = 'pending_deliveries';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(STORE, { keyPath: 'orderId' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

/** حفظ تأكيد توصيل في الانتظار */
export async function queueDelivery(data) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).put(data);
    req.onsuccess = () => res();
    req.onerror   = e => rej(e.target.error);
  });
}

/** جلب كل التأكيدات المعلقة */
export async function getPending() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = e => res(e.target.result || []);
    req.onerror   = e => rej(e.target.error);
  });
}

/** حذف تأكيد بعد معالجته */
export async function removePending(orderId) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(orderId);
    req.onsuccess = () => res();
    req.onerror   = e => rej(e.target.error);
  });
}

