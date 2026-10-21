import { haversine } from './stats.js';

const DEFAULT_CENTER = [-7.7956, 110.3695]; // Yogyakarta — used by the simulator if no fix yet
const MAX_ACCURACY_M = 35;   // ignore fixes worse than this
const MIN_STEP_M = 2;        // ignore jitter while standing still

/**
 * Live GPS activity recorder.
 * Events: 'position' (every fix), 'point' (fix accepted into the track),
 *         'state' (idle/recording/paused), 'tick' (1 s timer), 'gpserror'.
 */
export class Recorder extends EventTarget {
  constructor({ hr, persist } = {}) {
    super();
    this.hr = hr;           // () => current bpm or null
    this.persist = persist; // (snapshot) => void, for crash recovery
    this.watchId = null;
    this.lastFix = null;
    this.sim = false;
    this.type = 'run';
    this.reset();
  }

  reset() {
    clearInterval(this.timer);
    this.state = 'idle';
    this.points = [];
    this.distance = 0;
    this.activeMs = 0;
    this.resumeAt = 0;
    this.startedAt = 0;
    this.needBreak = false;
  }

  get activeSeconds() {
    return (this.activeMs + (this.state === 'recording' ? Date.now() - this.resumeAt : 0)) / 1000;
  }

  // ---------- GPS ----------
  ensureGps() {
    if (this.watchId != null) return;
    if (this.sim) return this._startSim();
    if (!('geolocation' in navigator)) {
      this._emit('gpserror', { message: 'This browser has no GPS access.' });
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (p) => this._onFix({
        lat: p.coords.latitude, lon: p.coords.longitude,
        ele: p.coords.altitude, acc: p.coords.accuracy, t: p.timestamp || Date.now(),
      }),
      (e) => this._emit('gpserror', { message: e.code === 1 ? 'Location blocked — allow it in browser settings' : 'Searching for GPS…' }),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );
  }

  stopGps() {
    if (this.watchId == null) return;
    if (this.watchId === 'sim') clearInterval(this.simTimer);
    else navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  setSim(on) {
    const running = this.watchId != null;
    this.stopGps();
    this.sim = on;
    if (running) this.ensureGps();
  }

  _startSim() {
    // Jogs a ~2.2 km loop at a realistic, slightly varying pace with fake HR.
    this.watchId = 'sim';
    const [cLat, cLon] = this.lastFix ? [this.lastFix.lat, this.lastFix.lon] : DEFAULT_CENTER;
    const r = 350, mPerDegLat = 111320, mPerDegLon = 111320 * Math.cos((cLat * Math.PI) / 180);
    let ang = 0, sec = 0;
    const emit = () => {
      const speed = 2.45 + 0.3 * Math.sin(sec / 40); // ~7.7–9.9 km/h
      if (this.state === 'recording') ang += speed / r;
      sec++;
      const wobble = () => (Math.random() - 0.5) * 2;
      this._onFix({
        lat: cLat + (r * Math.sin(ang) + wobble()) / mPerDegLat,
        lon: cLon + (r * (1 - Math.cos(ang)) + wobble()) / mPerDegLon,
        ele: 30 + 12 * Math.sin(ang * 2),
        acc: 4 + Math.random() * 3,
        t: Date.now(),
        hr: Math.round(146 + 10 * Math.sin(sec / 60) + Math.random() * 3),
      });
    };
    emit();
    this.simTimer = setInterval(emit, 1000);
  }

  _onFix(f) {
    this.lastFix = f;
    this._emit('position', f);
    if (this.state !== 'recording') return;
    if (f.acc != null && f.acc > MAX_ACCURACY_M) return;

    const last = this.points[this.points.length - 1];
    let dd = 0;
    if (last && !this.needBreak) {
      dd = haversine(last.lat, last.lon, f.lat, f.lon);
      if (dd < MIN_STEP_M && f.t - last.t < 10000) return;
    }
    const p = { t: f.t, lat: +f.lat.toFixed(7), lon: +f.lon.toFixed(7) };
    if (f.ele != null) p.ele = Math.round(f.ele * 10) / 10;
    const hr = this.hr?.() ?? f.hr;
    if (hr) p.hr = hr;
    if (this.needBreak && last) p.b = 1;
    this.needBreak = false;
    this.distance += dd;
    this.points.push(p);
    this._emit('point', p);
    if (this.points.length % 10 === 0) this.persist?.(this.snapshot());
  }

  /** Speed (m/s) over roughly the last 20 seconds of the current segment. */
  currentSpeed() {
    const pts = this.points;
    if (pts.length < 2 || this.state !== 'recording') return null;
    const last = pts[pts.length - 1];
    if (Date.now() - last.t > 15000) return 0;
    let d = 0, i = pts.length - 1;
    while (i > 0 && !pts[i].b && last.t - pts[i - 1].t <= 20000) {
      d += haversine(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
      i--;
    }
    const dt = (last.t - pts[i].t) / 1000;
    return dt > 0 ? d / dt : null;
  }

  // ---------- lifecycle ----------
  start(type) {
    this.reset();
    this.type = type || this.type;
    this.state = 'recording';
    this.startedAt = this.resumeAt = Date.now();
    this.ensureGps();
    this.timer = setInterval(() => this._emit('tick'), 1000);
    if (this.lastFix && Date.now() - this.lastFix.t < 5000) this._onFix(this.lastFix);
    this._emit('state');
  }

  pause() {
    if (this.state !== 'recording') return;
    this.activeMs += Date.now() - this.resumeAt;
    this.state = 'paused';
    this.needBreak = true;
    this.persist?.(this.snapshot());
    this._emit('state');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'recording';
    this.resumeAt = Date.now();
    this._emit('state');
  }

  finish() {
    if (this.state === 'recording') this.activeMs += Date.now() - this.resumeAt;
    const out = { type: this.type, startedAt: this.startedAt, points: this.points, activeSeconds: this.activeMs / 1000 };
    this.reset();
    this._emit('state');
    return out;
  }

  discard() {
    this.reset();
    this._emit('state');
  }

  snapshot() {
    return { type: this.type, startedAt: this.startedAt, points: this.points };
  }

  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
}
