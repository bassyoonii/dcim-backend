const https = require('https');

// Simple Nominatim geocoding (OpenStreetMap) — no API key required
// address: string -> { lat: Number, lng: Number } or null
function geocodeAddress(address) {
  return new Promise((resolve, reject) => {
    if (!address) return resolve(null);
    const query = encodeURIComponent(address);
    const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&accept-language=fr`;

    const options = {
      headers: { 'User-Agent': 'dcim-backend/1.0 (your@email)' }
    };

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const arr = JSON.parse(data);
          if (!Array.isArray(arr) || arr.length === 0) return resolve(null);
          const first = arr[0];
          const lat = parseFloat(first.lat);
          const lng = parseFloat(first.lon);
          if (Number.isFinite(lat) && Number.isFinite(lng)) return resolve({ lat, lng });
          return resolve(null);
        } catch (err) {
          return reject(err);
        }
      });
    }).on('error', (err) => reject(err));
  });
}

function reverseGeocode(lat, lng) {
  return new Promise((resolve, reject) => {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return resolve(null);
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latNum}&lon=${lngNum}&addressdetails=1&accept-language=fr`;

    const options = {
      headers: { 'User-Agent': 'dcim-backend/1.0 (your@email)' }
    };

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const payload = JSON.parse(data);
          if (!payload || payload.error) return resolve(null);
          return resolve(payload);
        } catch (err) {
          return reject(err);
        }
      });
    }).on('error', (err) => reject(err));
  });
}

module.exports = { geocodeAddress, reverseGeocode };
