import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// إصلاح أيقونة Leaflet مع Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// أيقونة مخصصة للسائق
const driverIcon = new L.DivIcon({
  html: '<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.3))">🚗</div>',
  className: '',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

/** مكوّن داخلي: يحرّك الخريطة لما يتغير الموقع */
function MapFly({ lat, lng }) {
  const map = useMap();
  useEffect(() => {
    if (lat && lng) map.flyTo([lat, lng], map.getZoom(), { duration: 1 });
  }, [lat, lng]);
  return null;
}

/**
 * DriverMap — خريطة OpenStreetMap تعرض موقع السائق
 * @param {number}  lat         خط العرض
 * @param {number}  lng         خط الطول
 * @param {string}  driverName  اسم السائق (يظهر في النافذة المنبثقة)
 * @param {number}  height      ارتفاع الخريطة (افتراضي 220px)
 */
export default function DriverMap({ lat, lng, driverName, height = 220 }) {
  if (!lat || !lng) {
    return (
      <div className="map-waiting">
        <div style={{ fontSize: 36 }}>📍</div>
        <p>في انتظار موقع السائق...</p>
        <p style={{ fontSize: 11 }}>يتحدث تلقائياً عند تحرك السائق</p>
      </div>
    );
  }

  return (
    <MapContainer
      center={[lat, lng]}
      zoom={15}
      style={{ height, width: '100%', borderRadius: 12, zIndex: 0 }}
      scrollWheelZoom={false}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='© <a href="https://openstreetmap.org">OpenStreetMap</a>'
      />
      <Marker position={[lat, lng]} icon={driverIcon}>
        <Popup>🚗 {driverName || 'السائق'}</Popup>
      </Marker>
      <MapFly lat={lat} lng={lng} />
    </MapContainer>
  );
}
