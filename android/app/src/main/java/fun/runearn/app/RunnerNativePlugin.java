package fun.runearn.app;

import android.Manifest;
import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.play.core.integrity.IntegrityManagerFactory;
import com.google.android.play.core.integrity.IntegrityTokenRequest;
import java.util.ArrayList;
import java.util.List;

/**
 * Small app-only helpers for the web code (js/geo.js, js/device.js):
 *  - Android 13+ hides the "RUNNER is recording your run" notification unless the
 *    user allows notifications, so we ask before the first run.
 *  - The step counter during a recording, for the rewards server's cadence check.
 *  - Google Play Integrity tokens, so the server knows a run came from the genuine
 *    app on an unmodified phone.
 */
@CapacitorPlugin(
    name = "RunnerNative",
    permissions = {
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications"),
        @Permission(strings = { Manifest.permission.ACTIVITY_RECOGNITION }, alias = "activity")
    }
)
public class RunnerNativePlugin extends Plugin {

    // ---------------------------------------------------------------- notifications
    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("notifications") != PermissionState.PROMPT) {
            resolve(call);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsCallback");
    }

    @PermissionCallback
    private void notificationsCallback(PluginCall call) {
        resolve(call);
    }

    private void resolve(PluginCall call) {
        JSObject ret = new JSObject();
        boolean granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || getPermissionState("notifications") == PermissionState.GRANTED;
        ret.put("granted", granted);
        call.resolve(ret);
    }

    // ---------------------------------------------------------------- step counter
    // Samples are [wall-clock ms, steps since start], at most one every 5 s. The
    // hardware counter keeps counting with the screen off; batched events carry the
    // time they were measured, so the times stay right.
    private SensorManager sensors;
    private SensorEventListener stepListener;
    private final List<long[]> samples = new ArrayList<>();
    private long baseline = -1;
    private long lastSteps = 0;
    private boolean denied = false;
    private boolean unavailable = false;

    private boolean activityAllowed() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || getPermissionState("activity") == PermissionState.GRANTED;
    }

    @PluginMethod
    public void startSteps(PluginCall call) {
        if (activityAllowed()) {
            beginSteps(call);
        } else {
            requestPermissionForAlias("activity", call, "activityCallback");
        }
    }

    @PermissionCallback
    private void activityCallback(PluginCall call) {
        beginSteps(call);
    }

    private synchronized void beginSteps(PluginCall call) {
        endSteps();
        samples.clear();
        baseline = -1;
        lastSteps = 0;
        denied = !activityAllowed();
        sensors = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        Sensor counter = sensors == null ? null : sensors.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
        unavailable = !denied && counter == null;
        JSObject ret = new JSObject();
        ret.put("denied", denied);
        ret.put("unavailable", unavailable);
        if (denied || unavailable) {
            call.resolve(ret);
            return;
        }
        samples.add(new long[] { System.currentTimeMillis(), 0 });
        stepListener = new SensorEventListener() {
            @Override
            public void onSensorChanged(SensorEvent e) {
                long total = (long) e.values[0];
                long t = System.currentTimeMillis() - (SystemClock.elapsedRealtimeNanos() - e.timestamp) / 1_000_000L;
                addSample(t, total);
            }

            @Override
            public void onAccuracyChanged(Sensor s, int accuracy) {}
        };
        // Batch for up to 10 s; the counter is cumulative, so nothing is lost either way.
        sensors.registerListener(stepListener, counter, SensorManager.SENSOR_DELAY_NORMAL, 10_000_000);
        call.resolve(ret);
    }

    private synchronized void addSample(long t, long total) {
        if (baseline < 0) baseline = total;
        long steps = Math.max(lastSteps, total - baseline);
        long[] last = samples.get(samples.size() - 1);
        t = Math.max(t, last[0]);
        if (t - last[0] < 5000 && samples.size() > 1) {
            last[0] = t;
            last[1] = steps;
        } else {
            samples.add(new long[] { t, steps });
        }
        lastSteps = steps;
    }

    @PluginMethod
    public void stopSteps(PluginCall call) {
        if (stepListener == null) {
            JSObject ret = new JSObject();
            ret.put("denied", denied);
            ret.put("unavailable", unavailable || !denied);
            call.resolve(ret);
            return;
        }
        // Deliver batched steps first, then close with a sample at "now".
        sensors.flush(stepListener);
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            JSObject ret = new JSObject();
            JSArray list = new JSArray();
            synchronized (this) {
                samples.add(new long[] { Math.max(System.currentTimeMillis(), samples.get(samples.size() - 1)[0]), lastSteps });
                for (long[] s : samples) {
                    JSArray pair = new JSArray();
                    pair.put(s[0]);
                    pair.put(s[1]);
                    list.put(pair);
                }
                endSteps();
            }
            ret.put("samples", list);
            call.resolve(ret);
        }, 1500);
    }

    private synchronized void endSteps() {
        if (sensors != null && stepListener != null) sensors.unregisterListener(stepListener);
        stepListener = null;
    }

    // ---------------------------------------------------------------- Play Integrity
    @PluginMethod
    public void integrityToken(PluginCall call) {
        String nonce = call.getString("nonce");
        String project = call.getString("cloudProjectNumber");
        if (nonce == null || project == null || project.isEmpty()) {
            call.reject("nonce and cloudProjectNumber are required");
            return;
        }
        IntegrityManagerFactory.create(getContext().getApplicationContext())
            .requestIntegrityToken(
                IntegrityTokenRequest.builder().setNonce(nonce).setCloudProjectNumber(Long.parseLong(project)).build()
            )
            .addOnSuccessListener(response -> {
                JSObject ret = new JSObject();
                ret.put("token", response.token());
                call.resolve(ret);
            })
            .addOnFailureListener(e -> call.reject(e.getMessage() == null ? "Play Integrity failed" : e.getMessage()));
    }
}
