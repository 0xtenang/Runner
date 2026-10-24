// Location source for the recorder. On the web this is navigator.geolocation,
// which phones pause when the screen locks. Inside the RUNNER phone app
// (Capacitor) it uses the native background-geolocation plugin instead, so GPS
// keeps recording with the screen off.

const Cap = globalThis.Capacitor;
export const isNative = Boolean(Cap?.isNativePlatform?.());
// capacitorExports comes from capacitor.js, which only the phone apps load.
export const registerPlugin = (name) => globalThis.capacitorExports.registerPlugin(name);
const BgGeo = isNative ? registerPlugin('BackgroundGeolocation') : null;

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

// Android won't keep GPS alive with the screen off (foreground service) if
// the watcher was created while the location prompt was still open, and the
// plugin doesn't retry. So the first watcher of each app session is replaced
// once its first fix arrives, by which point permission is granted.
let verified = false;
// App-only helpers (android/…/RunnerNativePlugin.java, ios/App/App/RunnerNativePlugin.swift).
export const Native = isNative ? registerPlugin('RunnerNative') : null;
export const platform = isNative ? Cap.getPlatform() : 'web';
let askedNotifications = null;

function watchNative(onFix, onError) {
  let stopped = false;
  let pending = null;
  const options = {
    // Android shows this as a notification while GPS runs in the background.
    backgroundTitle: 'RUNNER',
    backgroundMessage: 'RUNNER is recording your run',
    requestPermissions: true,
    stale: false,
    distanceFilter: 0,
  };
  const remove = (p) => p?.then((id) => BgGeo.removeWatcher({ id })).catch(() => {});
  const start = () => {
    pending = BgGeo.addWatcher(options, (loc, err) => {
      if (stopped) return;
      if (err) {
        if (err.code === 'NOT_AUTHORIZED') {
          onError('Location is off for RUNNER — allow it in Settings');
          if (confirm('RUNNER needs your location to record runs. Open Settings to allow it?')) BgGeo.openSettings();
        } else onError('Searching for GPS…');
        return;
      }
      if (!loc) return;
      if (!verified) {
        verified = true;
        const old = pending;
        start();
        remove(old);
      }
      onFix({
        lat: loc.latitude, lon: loc.longitude,
        ele: loc.altitude, acc: loc.accuracy, t: loc.time || Date.now(),
        mock: Boolean(loc.simulated), // Android mock-location app / iOS 15+ simulated location
      });
    });
  };
  // Ask for notifications first (Android 13+), so the "recording" notice shows.
  askedNotifications ??= platform === 'android' ? Native.requestNotifications().catch(() => {}) : Promise.resolve();
  askedNotifications.then(() => { if (!stopped) start(); });
  return () => {
    stopped = true;
    askedNotifications.then(() => remove(pending));
  };
}
