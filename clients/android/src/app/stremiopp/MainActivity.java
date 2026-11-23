package app.stremiopp;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** Stremio++ for Android: a fullscreen landscape WebView around the bundled TV app (assets/app/). */
public class MainActivity extends Activity {
    // Server candidates in priority order: Tailscale, home LAN, public relay. The app picks the first that answers.
    private static final String SERVERS = "http://100.64.0.10:8790,http://192.168.1.10:8790,https://relay.example.com:8443/rtv";
    // Data saver defaults ON here. HEVC through MSE in WebView is not verified on devices: advertise H.264 only.
    private static final String URL = "file:///android_asset/app/index.html?client=android&saver=1&codecs=h264&servers=";

    private WebView web;
    private float lastHatX, lastHatY;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.addJavascriptInterface(new Bridge(), "AndroidSPP");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return !"file".equals(r.getUrl().getScheme()); // never navigate away from the bundled app
            }
        });
        web.loadUrl(URL + Uri.encode(SERVERS));
        web.requestFocus();
        immersive();
    }

    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) immersive(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
    @Override protected void onPause() { web.onPause(); super.onPause(); }
    @Override protected void onDestroy() { if (web != null) web.destroy(); super.onDestroy(); }

    /** Sends an app key name (left/right/up/down/enter/back/toggle/play/pause/stop/ff/rw) to the web app. */
    private void appKey(String name) { web.evaluateJavascript("window.SPP&&SPP.key('" + name + "')", null); }

    @Override public void onBackPressed() { appKey("back"); }

    @Override public boolean dispatchKeyEvent(KeyEvent e) {
        int c = e.getKeyCode();
        String name = null;
        switch (c) {
            case KeyEvent.KEYCODE_BACK: name = "back"; break;
            case KeyEvent.KEYCODE_BUTTON_A: name = "enter"; break;
            case KeyEvent.KEYCODE_BUTTON_B: name = "back"; break;
            case KeyEvent.KEYCODE_BUTTON_X: case KeyEvent.KEYCODE_BUTTON_START: case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: name = "toggle"; break;
            case KeyEvent.KEYCODE_BUTTON_L1: case KeyEvent.KEYCODE_MEDIA_REWIND: name = "rw"; break;
            case KeyEvent.KEYCODE_BUTTON_R1: case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: name = "ff"; break;
            case KeyEvent.KEYCODE_MEDIA_PLAY: name = "play"; break;
            case KeyEvent.KEYCODE_MEDIA_PAUSE: name = "pause"; break;
            case KeyEvent.KEYCODE_MEDIA_STOP: name = "stop"; break;
            default: break; // D-pad, Enter, Escape, letters: the WebView turns them into normal DOM key events
        }
        if (name == null) return super.dispatchKeyEvent(e);
        if (e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 0) appKey(name);
        return true;
    }

    /** Gamepads that report the D-pad / left stick as motion axes instead of key events. */
    @Override public boolean onGenericMotionEvent(MotionEvent e) {
        if ((e.getSource() & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK && e.getAction() == MotionEvent.ACTION_MOVE) {
            float x = e.getAxisValue(MotionEvent.AXIS_HAT_X), y = e.getAxisValue(MotionEvent.AXIS_HAT_Y);
            if (x == 0 && y == 0) { x = e.getAxisValue(MotionEvent.AXIS_X); y = e.getAxisValue(MotionEvent.AXIS_Y); x = Math.abs(x) > 0.6f ? Math.signum(x) : 0; y = Math.abs(y) > 0.6f ? Math.signum(y) : 0; }
            if (x != lastHatX && x != 0) appKey(x < 0 ? "left" : "right");
            if (y != lastHatY && y != 0) appKey(y < 0 ? "up" : "down");
            lastHatX = x; lastHatY = y;
            return true;
        }
        return super.onGenericMotionEvent(e);
    }

    private class Bridge {
        @JavascriptInterface public void exit() { runOnUiThread(new Runnable() { public void run() { finishAndRemoveTask(); } }); }
    }
}
