package io.github.guyt.slownavigator;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * The shell, plus one thing a browser cannot do: accept a GPX opened from
 * somewhere else on the phone.
 *
 * Hunting for a file in a picker is the worst way to get a route into the
 * app, and on Android it is worse still — a .gpx has no MIME type the system
 * agrees on, so a filtered picker greys out the very file you are reaching
 * for. Tapping the attachment in the mail it arrived in, and choosing this
 * app, skips all of that.
 *
 * Intents arrive two ways and the app is in a different state for each. A
 * cold start has the intent waiting in onCreate before the web layer exists;
 * a warm one delivers it to onNewIntent with the page already up. So a file
 * is read into a queue either way, and the web side both pulls the queue
 * when it loads and listens for the event fired when one arrives later.
 */
public class MainActivity extends BridgeActivity {
    private static final String TAG = "SlowNav";

    /** A day's walk is tens of kilobytes. Past this it is not a route. */
    private static final int MAX_BYTES = 8 * 1024 * 1024;

    /**
     * Marks an intent this activity has already read.
     *
     * BridgeActivity.load() calls onNewIntent(getIntent()) itself, from
     * inside super.onCreate() — so the launching intent arrives twice, once
     * through Capacitor and once from onCreate below, and without this the
     * same route would be imported twice from one tap. The flag rides on the
     * intent rather than in a field because it is the intent that is
     * duplicated, not the delivery.
     */
    private static final String HANDLED = "io.github.guyt.slownavigator.HANDLED";

    /** Files read from an intent and not yet collected by the web layer. */
    private final List<JSONObject> pending = new ArrayList<>();

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getBridge().getWebView().addJavascriptInterface(new OpenedFiles(), "SlowNavFiles");
        // Whatever launched us, if anything. The web layer collects it once
        // it has loaded; there is nothing to notify yet.
        readFrom(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (readFrom(intent)) notifyWeb();
    }

    /**
     * Queue every file this intent carries. True if it carried any.
     *
     * VIEW puts one URI in the intent's data; SEND puts one in EXTRA_STREAM,
     * because a share and an open are different verbs for the same thing as
     * far as the sender is concerned and quite different intents to receive.
     */
    private boolean readFrom(Intent intent) {
        if (intent == null || intent.getBooleanExtra(HANDLED, false)) return false;
        intent.putExtra(HANDLED, true);

        List<Uri> uris = new ArrayList<>();
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action)) {
            if (intent.getData() != null) uris.add(intent.getData());
        } else if (Intent.ACTION_SEND.equals(action)) {
            Uri one = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (one != null) uris.add(one);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> many = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (many != null) uris.addAll(many);
        }

        boolean any = false;
        for (Uri uri : uris) {
            JSONObject file = read(uri);
            if (file == null) continue;
            synchronized (pending) {
                pending.add(file);
            }
            any = true;
        }
        return any;
    }

    /**
     * Read a URI into {name, text}, or null if it cannot be read.
     *
     * Nothing here decides whether the contents are a GPX. That is the web
     * layer's job, which already has a parser and somewhere to show the
     * answer; failing quietly in Java would leave the walker with an app that
     * opened and did nothing.
     */
    private JSONObject read(Uri uri) {
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) return null;

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16 * 1024];
            int read;
            int total = 0;
            while ((read = in.read(buf)) > 0) {
                total += read;
                if (total > MAX_BYTES) {
                    Log.w(TAG, "Ignoring an opened file larger than " + MAX_BYTES + " bytes");
                    return null;
                }
                out.write(buf, 0, read);
            }

            JSONObject file = new JSONObject();
            file.put("name", displayName(uri));
            file.put("text", out.toString(StandardCharsets.UTF_8.name()));
            return file;
        } catch (JSONException | SecurityException | java.io.IOException e) {
            Log.w(TAG, "Could not read an opened file", e);
            return null;
        }
    }

    /**
     * The name to show for a URI.
     *
     * A content:// URI's path is an opaque document id far more often than it
     * is a filename, so the provider is asked for the display name first.
     */
    private String displayName(Uri uri) {
        if ("content".equals(uri.getScheme())) {
            String[] columns = new String[] { OpenableColumns.DISPLAY_NAME };
            try (Cursor cursor = getContentResolver().query(uri, columns, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    String name = cursor.getString(0);
                    if (name != null && !name.isEmpty()) return name;
                }
            } catch (RuntimeException e) {
                Log.w(TAG, "No display name for an opened file", e);
            }
        }
        String last = uri.getLastPathSegment();
        return last == null || last.isEmpty() ? "Opened route.gpx" : last;
    }

    /** Tell a page that is already loaded that something new is waiting. */
    private void notifyWeb() {
        // Null during the call Capacitor makes from inside super.onCreate():
        // there is no page yet to hear the event, and the queue is collected
        // when one loads.
        final WebView web = getBridge() == null ? null : getBridge().getWebView();
        if (web == null) return;
        web.post(() -> web.evaluateJavascript("window.dispatchEvent(new Event('slownav:openedfiles'))", null));
    }

    /**
     * The handover to the web layer.
     *
     * Read-only and one-way: it hands over files this activity was explicitly
     * asked to open, and offers no way to reach anything else on the device.
     * The WebView loads only the assets bundled in the APK — external links
     * are opened in the in-app browser instead — so nothing else is in a
     * position to call it.
     */
    public class OpenedFiles {
        /** Every queued file as JSON, clearing the queue. */
        @JavascriptInterface
        public String take() {
            JSONArray out = new JSONArray();
            synchronized (pending) {
                for (JSONObject file : pending) out.put(file);
                pending.clear();
            }
            return out.toString();
        }
    }
}
