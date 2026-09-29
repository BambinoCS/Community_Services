/* Live location capture + keyless directions links (Google Maps universal URL, no API key). */
(function () {
  'use strict';
  function supported() {
    return typeof navigator !== 'undefined' && !!navigator.geolocation;
  }
  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!supported()) { reject(new Error('unsupported')); return; }
      navigator.geolocation.getCurrentPosition(
        position => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
        error => reject(error),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
      );
    });
  }
  async function reverseGeocode(latitude, longitude) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('geocode failed');
    const data = await response.json();
    return data.display_name || null;
  }
  function coordinatesUrl(latitude, longitude) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(latitude + ',' + longitude)}`;
  }
  function directionsUrl(target) {
    const destination = target.latitude != null && target.longitude != null
      ? `${target.latitude},${target.longitude}`
      : (target.address || target.location || '');
    if (!destination) return null;
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
  }
  function describeError(error) {
    if (!error || error.message === 'unsupported') {
      return 'Live location is not available. Your browser or connection may not support it — type the location instead.';
    }
    if (error.code === 1) return 'Location permission was denied. Allow location access in your browser settings, or type the location instead.';
    if (error.code === 2) return 'Your position could not be determined. Try again or type the location instead.';
    if (error.code === 3) return 'Finding your location took too long. Try again or type the location instead.';
    return 'Could not get your location. Try again or type the location instead.';
  }
  /* Wire a "Use my current location" button to hidden lat/lng fields and a visible location input. */
  function attachLocator(button, options) {
    if (!button) return;
    const locationInput = options.locationInput;
    const latInput = options.latInput;
    const lngInput = options.lngInput;
    const statusEl = options.statusEl;
    let busy = false;
    function setStatus(text, isError) {
      if (!statusEl) return;
      statusEl.textContent = text || '';
      statusEl.hidden = !text;
      statusEl.classList.toggle('error', !!isError && !!text);
    }
    function clearCoordinates() {
      if (latInput) latInput.value = '';
      if (lngInput) lngInput.value = '';
    }
    button.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      button.disabled = true;
      setStatus('Finding your location…', false);
      try {
        const { latitude, longitude } = await getPosition();
        if (latInput) latInput.value = String(latitude);
        if (lngInput) lngInput.value = String(longitude);
        setStatus('Pinpointing address…', false);
        try {
          const address = await reverseGeocode(latitude, longitude);
          if (address && locationInput) locationInput.value = address;
          setStatus('Location captured.', false);
        } catch (error) {
          if (locationInput && !locationInput.value.trim()) {
            locationInput.value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
          }
          setStatus('Location captured (address lookup unavailable).', false);
        }
      } catch (error) {
        clearCoordinates();
        setStatus(describeError(error), true);
      } finally {
        busy = false;
        button.disabled = false;
      }
    });
    if (locationInput) {
      locationInput.addEventListener('input', () => {
        clearCoordinates();
        setStatus('', false);
      });
    }
  }
  window.CommunityLocation = Object.freeze({ supported, getPosition, reverseGeocode,
    coordinatesUrl, directionsUrl, describeError, attachLocator });
})();
