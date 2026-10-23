package fun.runearn.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RunnerNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
