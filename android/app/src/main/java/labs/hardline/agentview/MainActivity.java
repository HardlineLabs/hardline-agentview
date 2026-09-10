package labs.hardline.agentview;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(android.os.Bundle state) {
        registerPlugin(WorkspaceSocketPlugin.class);
        super.onCreate(state);
        android.webkit.WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        if (BuildConfig.DEBUG) getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        androidx.core.view.WindowInsetsControllerCompat insets = new androidx.core.view.WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        insets.setAppearanceLightStatusBars(false);
        insets.setAppearanceLightNavigationBars(false);
    }
}
