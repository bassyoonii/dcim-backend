const https = require('https');

const getGoogleGeocodingKey = () =>
  process.env.GOOGLE_GEOCODING_API_KEY ||
  process.env.GEOCODING_API_KEY ||
  process.env.geocoding_api ||
  process.env.VITE_GOOGLE_MAPS_API_KEY ||
  '';

const requestJson = (url, options = {}) =>
  new Promise((resolve, reject) => {
    https
      .get(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', (err) => reject(err));
  });

const pickAddressComponent = (components = [], types = []) =>
  components.find((component) =>
    types.some((type) => component.types?.includes(type))
  );

const parseGoogleCityCountry = (components = []) => {
  const cityComponent =
    pickAddressComponent(components, ['locality', 'postal_town']) ||
    pickAddressComponent(components, ['administrative_area_level_2']) ||
    pickAddressComponent(components, ['administrative_area_level_1']);
  const countryComponent = pickAddressComponent(components, ['country']);

  return {
    city: cityComponent?.long_name || '',
    country: countryComponent?.long_name || ''
  };
};

const parseNominatimCityCountry = (address = {}) => ({
  city:
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.county ||
    address.state ||
    '',
  country: address.country || ''
});

const googleGeocodeAddress = async (address) => {
  const key = getGoogleGeocodingKey();
  if (!address || !key) return null;

  const query = encodeURIComponent(address);
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${encodeURIComponent(key)}`;
  const payload = await requestJson(url);

  if (payload.status === 'ZERO_RESULTS') return null;
  if (payload.status !== 'OK') {
    throw new Error(payload.error_message || `Google Geocoding failed with status: ${payload.status}`);
  }

  const first = payload.results?.[0];
  const lat = Number(first?.geometry?.location?.lat);
  const lng = Number(first?.geometry?.location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { lat, lng };
};

const googleReverseGeocode = async (lat, lng) => {
  const key = getGoogleGeocodingKey();
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!key || !Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;

  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latNum},${lngNum}&key=${encodeURIComponent(key)}`;
  const payload = await requestJson(url);

  if (payload.status === 'ZERO_RESULTS') {
    return {
      address: '',
      city: '',
      country: '',
      latitude: latNum,
      longitude: lngNum
    };
  }

  if (payload.status !== 'OK') {
    throw new Error(payload.error_message || `Google Geocoding failed with status: ${payload.status}`);
  }

  const first = payload.results?.[0];
  const parsed = parseGoogleCityCountry(first?.address_components || []);

  return {
    address: first?.formatted_address || '',
    city: parsed.city,
    country: parsed.country,
    latitude: latNum,
    longitude: lngNum
  };
};

const nominatimGeocodeAddress = (address) =>
  new Promise((resolve, reject) => {
    if (!address) return resolve(null);
    const query = encodeURIComponent(address);
    const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&accept-language=fr`;

    requestJson(url, {
      headers: { 'User-Agent': 'dcim-backend/1.0' }
    })
      .then((arr) => {
        if (!Array.isArray(arr) || arr.length === 0) return resolve(null);
        const first = arr[0];
        const lat = parseFloat(first.lat);
        const lng = parseFloat(first.lon);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          return resolve({ lat, lng });
        }
        return resolve(null);
      })
      .catch((err) => reject(err));
  });

const nominatimReverseGeocode = (lat, lng) =>
  new Promise((resolve, reject) => {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      return resolve(null);
    }

    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latNum}&lon=${lngNum}&addressdetails=1&accept-language=fr`;

    requestJson(url, {
      headers: { 'User-Agent': 'dcim-backend/1.0' }
    })
      .then((payload) => {
        if (!payload || payload.error) return resolve(null);
        const parsed = parseNominatimCityCountry(payload.address || {});
        return resolve({
          address: payload.display_name || '',
          city: parsed.city,
          country: parsed.country,
          latitude: latNum,
          longitude: lngNum
        });
      })
      .catch((err) => reject(err));
  });

async function geocodeAddress(address) {
  try {
    const googleResult = await googleGeocodeAddress(address);
    if (googleResult) return googleResult;
  } catch (err) {
    console.warn('[geocode] Google geocode failed, falling back:', err.message);
  }

  return nominatimGeocodeAddress(address);
}

async function reverseGeocode(lat, lng) {
  try {
    const googleResult = await googleReverseGeocode(lat, lng);
    if (googleResult) return googleResult;
  } catch (err) {
    console.warn('[geocode] Google reverse geocode failed, falling back:', err.message);
  }

  return nominatimReverseGeocode(lat, lng);
}

module.exports = { geocodeAddress, reverseGeocode };
