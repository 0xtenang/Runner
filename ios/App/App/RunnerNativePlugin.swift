import Foundation
import Capacitor
import CoreMotion
import CryptoKit
import DeviceCheck

/// Small app-only helpers for the web code (js/device.js):
///  - the step counter (CMPedometer) during a recording, for the rewards server's cadence check;
///  - Apple App Attest, so the server knows a run came from the genuine app on a real iPhone.
@objc(RunnerNativePlugin)
public class RunnerNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RunnerNativePlugin"
    public let jsName = "RunnerNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startSteps", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSteps", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appAttest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resetAppAttest", returnType: CAPPluginReturnPromise),
    ]

    // MARK: step counter
    // Samples are [wall-clock ms, steps since start], at most one every 5 s.
    private let pedometer = CMPedometer()
    private let lock = NSLock()
    private var stepsStart: Date?
    private var samples: [[Double]] = []

    private func stepsDenied() -> Bool {
        let status = CMPedometer.authorizationStatus()
        return status == .denied || status == .restricted
    }

    @objc func startSteps(_ call: CAPPluginCall) {
        pedometer.stopUpdates()
        guard CMPedometer.isStepCountingAvailable() else { call.resolve(["unavailable": true]); return }
        if stepsDenied() { call.resolve(["denied": true]); return }
        let start = Date()
        lock.lock()
        stepsStart = start
        samples = [[start.timeIntervalSince1970 * 1000, 0]]
        lock.unlock()
        // Asks for Motion & Fitness the first time. Keeps updating while the app records
        // in the background (location background mode).
        pedometer.startUpdates(from: start) { [weak self] data, _ in
            guard let data = data else { return }
            self?.addSample(at: data.endDate, steps: data.numberOfSteps.doubleValue)
        }
        call.resolve([:])
    }

    private func addSample(at date: Date, steps: Double) {
        lock.lock()
        defer { lock.unlock() }
        let t = date.timeIntervalSince1970 * 1000
        guard let last = samples.last, t >= last[0], steps >= last[1] else { return }
        if t - last[0] < 5000 && samples.count > 1 {
            samples[samples.count - 1] = [t, steps]
        } else {
            samples.append([t, steps])
        }
    }

    @objc func stopSteps(_ call: CAPPluginCall) {
        pedometer.stopUpdates()
        if stepsDenied() { call.resolve(["denied": true]); return }
        lock.lock()
        let start = stepsStart
        lock.unlock()
        guard let from = start else { call.resolve(["unavailable": true]); return }
        let now = Date()
        // Close with the total for the whole recording (covers updates that never arrived).
        pedometer.queryPedometerData(from: from, to: now) { [weak self] data, _ in
            guard let self = self else { return }
            if let data = data { self.addSample(at: now, steps: data.numberOfSteps.doubleValue) }
            self.lock.lock()
            let out = self.samples
            self.stepsStart = nil
            self.lock.unlock()
            if self.stepsDenied() { call.resolve(["denied": true]) } else { call.resolve(["samples": out]) }
        }
    }

    // MARK: App Attest
    // First upload: create a Secure Enclave key and have Apple certify it (attestation).
    // Later uploads: sign the run with that key (assertion). The server keeps the key.
    private let keyIdKey = "runner.appAttest.keyId"

    @objc func appAttest(_ call: CAPPluginCall) {
        guard let challenge = call.getString("challenge") else { call.reject("challenge is required"); return }
        let service = DCAppAttestService.shared
        guard service.isSupported else { call.reject("App Attest is not supported on this device"); return }
        let clientDataHash = Data(SHA256.hash(data: Data(challenge.utf8)))
        let defaults = UserDefaults.standard
        if let keyId = defaults.string(forKey: keyIdKey) {
            service.generateAssertion(keyId, clientDataHash: clientDataHash) { assertion, error in
                if let assertion = assertion {
                    call.resolve(["keyId": keyId, "assertion": assertion.base64EncodedString()])
                } else {
                    // Key lost (e.g. app restored on a new phone): make a new one next time.
                    if (error as? DCError)?.code == .invalidKey { defaults.removeObject(forKey: self.keyIdKey) }
                    call.reject(error?.localizedDescription ?? "App Attest failed")
                }
            }
            return
        }
        service.generateKey { keyId, error in
            guard let keyId = keyId else { call.reject(error?.localizedDescription ?? "App Attest failed"); return }
            service.attestKey(keyId, clientDataHash: clientDataHash) { attestation, error in
                guard let attestation = attestation else { call.reject(error?.localizedDescription ?? "App Attest failed"); return }
                defaults.set(keyId, forKey: self.keyIdKey)
                call.resolve(["keyId": keyId, "attestation": attestation.base64EncodedString()])
            }
        }
    }

    @objc func resetAppAttest(_ call: CAPPluginCall) {
        UserDefaults.standard.removeObject(forKey: keyIdKey)
        call.resolve([:])
    }
}
