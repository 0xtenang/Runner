import { haversine } from './stats.js';
import { watchLocation } from './geo.js';
import { startSteps, stopSteps } from './device.js';

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
    this.mockFixes = 0;
  }

  get activeSeconds() {
    return (this.activeMs + (this.state === 'recording' ? Date.now() - this.resumeAt : 0)) / 1000;
  }

  // ---------- GPS ----------
  ensureGps() {
    if (this.watchId != null) return;
    this.watchId = watchLocation(
      (f) => this._onFix(f),
      (message) => this._emit('gpserror', { message })
    );
  }

  stopGps() {
    if (this.watchId == null) return;
    this.watchId();
    this.watchId = null;
  }

  _onFix(f) {
    if (f.mock) {
      // A fake-GPS (mock location) app is feeding positions: never record them.
      if (this.state === 'recording') this.mockFixes++;
      this._emit('gpserror', { message: 'Fake GPS detected — turn off mock-location apps. These positions are not recorded.' });
      return;
    }
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
    if (f.acc != null) p.acc = Math.round(f.acc); // reported accuracy (m) — part of the server's trust check
    const hr = this.hr?.();
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
    startSteps(); // phone app: step counter for the server's cadence check
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
    // steps: a promise of the step-counter samples (null on the website).
    const out = { type: this.type, startedAt: this.startedAt, points: this.points, activeSeconds: this.activeMs / 1000, mockFixes: this.mockFixes, steps: stopSteps() };
    this.reset();
    this._emit('state');
    return out;
  }

  discard() {
    stopSteps();
    this.reset();
    this._emit('state');
  }

  snapshot() {
    return { type: this.type, startedAt: this.startedAt, points: this.points, mockFixes: this.mockFixes };
  }

  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
}
