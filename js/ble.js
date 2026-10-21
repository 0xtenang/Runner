// Bluetooth LE heart-rate monitor using the standard GATT Heart Rate service
// (0x180D). Works with chest straps (Polar H10, Garmin HRM, Wahoo TICKR) and
// watches that broadcast HR (Garmin "Broadcast Heart Rate", COROS, Polar, etc.).
export class HeartRateMonitor extends EventTarget {
  constructor() {
    super();
    this.bpm = null;
    this.lastAt = 0;
    this.device = null;
  }

  get supported() { return 'bluetooth' in navigator; }
  get connected() { return !!this.device?.gatt?.connected; }

  /** Current bpm, or null if no reading in the last 5 s. */
  current() {
    return this.bpm != null && Date.now() - this.lastAt < 5000 ? this.bpm : null;
  }

  async connect() {
    if (!this.supported) throw new Error('Web Bluetooth is not available in this browser. Try Chrome on Android or desktop.');
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
    this.device = device;
    device.addEventListener('gattserverdisconnected', () => {
      this.bpm = null;
      this._emit('change');
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    const ch = await service.getCharacteristic('heart_rate_measurement');
    ch.addEventListener('characteristicvaluechanged', (e) => {
      const v = e.target.value;
      const flags = v.getUint8(0);
      this.bpm = flags & 0x1 ? v.getUint16(1, true) : v.getUint8(1);
      this.lastAt = Date.now();
      this._emit('hr');
    });
    await ch.startNotifications();
    this._emit('change');
  }

  disconnect() {
    this.device?.gatt?.disconnect();
    this.device = null;
    this.bpm = null;
    this._emit('change');
  }

  _emit(n) { this.dispatchEvent(new Event(n)); }
}
