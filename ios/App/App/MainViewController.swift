import UIKit
import Capacitor

/// Capacitor's web view, plus RUNNER's own app-only plugin (RunnerNativePlugin.swift).
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(RunnerNativePlugin())
    }
}
