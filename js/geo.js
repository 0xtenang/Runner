// Location source for the recorder. On the web this is navigator.geolocation,
// which phones pause when the screen locks. Inside the RUNNER phone app
// (Capacitor) it uses the native background-geolocation plugin instead, so GPS
// keeps recording with the screen off — like Strava.

const Cap = globalThis.Capacitor;
export const isNative = Boolean(Cap?.isNativePlatform?.());
const BgGeo = isNative ? Cap.registerPlugin('BackgroundGeolocation') : null;

/**
 * Starts watching the location. Calls onFix({lat, lon, ele, acc, t}) for each
 * fix and onError(message) on problems. Returns a function that stops it.
 */
export function watchLocation(onFix, onError) {
  return isNative ? watchNative(onFix, onError) : watchWeb(onFix, onError);
}

function watchWeb(onFix, onError) {
  if (!('geolocation' in navigator)) {
    onError('This browser has no GPS access.');
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (p) => onFix({
      lat: p.coords.latitude, lon: p.coords.longitude,
      ele: p.coords.altitude, acc: p.coords.accuracy, t: p.timestamp || Date.now(),
    }),
    (e) => onError(e.code === 1 ? 'Location blocked — allow it in browser settings' : 'Searching for GPS…'),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
  );
  return () => navigator.geolocation.clearWatch(id);
}

function watchNative(onFix, onError) {
  let stopped = false;
  const pending = BgGeo.addWatcher(
    {
      // Android shows this as a notification while GPS runs in the background.
      backgroundTitle: 'RUNNER',
      backgroundMessage: 'RUNNER is recording your run',
      requestPermissions: true,
      stale: false,
      distanceFilter: 0,
    },
    (loc, err) => {
      if (stopped) return;
      if (err) {
        if (err.code === 'NOT_AUTHORIZED') {
          onError('Location is off for RUNNER — allow it in Settings');
          if (confirm('RUNNER needs your location to record runs. Open Settings to allow it?')) BgGeo.openSettings();
        } else onError('Searching for GPS…');
        return;
      }
      if (!loc) return;
      onFix({
        lat: loc.latitude, lon: loc.longitude,
        ele: loc.altitude, acc: loc.accuracy, t: loc.time || Date.now(),
      });
    }
  );
  return () => {
    stopped = true;
    pending.then((id) => BgGeo.removeWatcher({ id })).catch(() => {});
  };
}
