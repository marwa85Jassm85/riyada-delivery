/**
 * locationTracker.js
 * يتتبع موقع السائق ويرفعه لـ Supabase كل 15 ثانية تقريباً
 * يعمل على HTTPS فقط (production) — على HTTP يُظهر رسالة توضيحية
 */
import { supabase } from '../supabase';

let watchId = null;

/** بدء تتبع الموقع */
export function startTracking(driverId, orderId) {
  if (!driverId) return;
  if (!navigator.geolocation) return;

  stopTracking(); // أوقف أي تتبع سابق

  const opts = { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 };

  watchId = navigator.geolocation.watchPosition(
    async ({ coords }) => {
      const { latitude: lat, longitude: lng } = coords;
      await supabase.from('driver_locations').upsert({
        driver_id:  driverId,
        order_id:   orderId,
        lat,
        lng,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'driver_id' });
    },
    err => console.warn('Geolocation error:', err.message),
    opts
  );
}

/** إيقاف التتبع وحذف الموقع من الجدول */
export async function stopTracking(driverId) {
  if (watchId !== null) {
    navigator.geolocation?.clearWatch(watchId);
    watchId = null;
  }
  if (driverId) {
    await supabase.from('driver_locations').delete().eq('driver_id', driverId);
  }
}
