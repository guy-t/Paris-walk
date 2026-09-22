package io.github.guyt.slownavigator;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * Recording the walk while the screen is off.
 *
 * The web layer cannot do this and never will: a hidden page gets no fixes,
 * which is why the trail has gaps every time the phone goes in a pocket. What
 * closes the gap is a foreground service — a notification the walker can see,
 * and location updates that keep arriving behind it.
 *
 * Deliberately built on the framework's own LocationManager rather than Play
 * Services: no new dependency, nothing added to the APK, and nothing for the
 * CI build to resolve. A walker moves at 4 km/h; the fused provider's extra
 * cleverness is aimed at cars.
 *
 * Note what is *not* requested: ACCESS_BACKGROUND_LOCATION. A foreground
 * service of type `location`, started while the app is on screen, keeps the
 * ordinary while-in-use permission alive for as long as it runs. Asking for
 * the background permission would gain nothing here and would be a much
 * larger thing to ask of someone.
 *
 * Fixes are queued rather than pushed. While the app is hidden its JavaScript
 * is not running to receive anything, so the service holds what it collects
 * and the web layer drains the queue when it comes back — in order, so the
 * session and the trail are folded exactly as if they had arrived live.
 */
public class TrackingService extends Service {
    private static final String TAG = "SlowNav";
    private static final String CHANNEL_ID = "slownav-tracking";
    private static final int NOTIFICATION_ID = 1;

    /** Fixes asked for no closer together than this. A walker is not a car. */
    private static final long INTERVAL_MS = 5000L;
    /** …and no closer together than this in metres, which idles the chip when still. */
    private static final float INTERVAL_M = 5f;

    /**
     * How many fixes are held before the queue is thinned.
     *
     * 3000 at five seconds is a little over four hours in a pocket. Past that
     * every second fix is dropped rather than the oldest, because what
     * matters for a trail is covering the whole gap: half the resolution over
     * all of it beats full resolution over the last hour of it.
     */
    private static final int QUEUE_CAP = 3000;

    private static final Deque<JSONObject> queue = new ArrayDeque<>();
    private static volatile boolean running = false;

    private LocationManager locations;
    private HandlerThread thread;
    private LocationListener listener;

    /** Whether the service is collecting fixes right now. */
    public static boolean isRunning() {
        return running;
    }

    /** Everything collected since the last call, oldest first, clearing the queue. */
    public static String drain() {
        JSONArray out = new JSONArray();
        synchronized (queue) {
            for (JSONObject fix : queue) out.put(fix);
            queue.clear();
        }
        return out.toString();
    }

    /** Throw away anything queued — on stopping, so a later walk cannot inherit it. */
    public static void discard() {
        synchronized (queue) {
            queue.clear();
        }
    }

    private static void enqueue(JSONObject fix) {
        synchronized (queue) {
            if (queue.size() >= QUEUE_CAP) {
                Deque<JSONObject> thinned = new ArrayDeque<>();
                boolean keep = true;
                for (JSONObject held : queue) {
                    if (keep) thinned.add(held);
                    keep = !keep;
                }
                queue.clear();
                queue.addAll(thinned);
            }
            queue.add(fix);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (running) return START_STICKY;

        // The notification is not a formality: a foreground service must show
        // one, and it is also the only way a walker can tell that the phone
        // in their pocket is still recording.
        createChannel();
        Notification notification = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                        NOTIFICATION_ID,
                        notification,
                        android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            // Android 12+ refuses a foreground service started from the
            // background. Nothing here can fix that, and pretending to be
            // recording would be worse than stopping.
            Log.w(TAG, "could not start the tracking service", e);
            stopSelf();
            return START_NOT_STICKY;
        }

        if (!startUpdates()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        running = true;
        return START_STICKY;
    }

    private boolean startUpdates() {
        if (getApplicationContext().checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "no location permission; not starting updates");
            return false;
        }
        locations = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (locations == null) return false;

        // Its own thread, so callbacks never wait on the WebView's main loop.
        thread = new HandlerThread("slownav-location");
        thread.start();

        listener = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                enqueue(toJson(location));
            }

            @Override
            public void onProviderDisabled(String provider) {
                /* the walker turned GPS off; the next fix will resume us */
            }

            @Override
            public void onProviderEnabled(String provider) {
                /* nothing to do */
            }

            @Override
            public void onStatusChanged(String provider, int status, Bundle extras) {
                /* deprecated, and never useful here */
            }
        };

        boolean any = false;
        for (String provider : new String[] {LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER}) {
            try {
                if (!locations.isProviderEnabled(provider)) continue;
                locations.requestLocationUpdates(
                        provider, INTERVAL_MS, INTERVAL_M, listener, thread.getLooper());
                any = true;
            } catch (SecurityException | IllegalArgumentException e) {
                Log.w(TAG, "could not use " + provider, e);
            }
        }
        if (!any) Log.w(TAG, "no location provider is enabled");
        return any;
    }

    private static JSONObject toJson(Location location) {
        JSONObject fix = new JSONObject();
        try {
            fix.put("lat", location.getLatitude());
            fix.put("lon", location.getLongitude());
            fix.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : 50);
            if (location.hasAltitude()) fix.put("altitude", location.getAltitude());
            if (location.hasSpeed()) fix.put("speed", location.getSpeed());
            if (location.hasBearing()) fix.put("heading", location.getBearing());
            fix.put("timestamp", location.getTime());
        } catch (JSONException e) {
            Log.w(TAG, "could not read a fix", e);
        }
        return fix;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel =
                new NotificationChannel(
                        CHANNEL_ID,
                        "Recording a walk",
                        // Low: it must be visible, but it must never make a
                        // sound on a hillside.
                        NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Shown while the walk is being recorded with the screen off.");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap =
                PendingIntent.getActivity(
                        this,
                        0,
                        open,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder =
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                        ? new Notification.Builder(this, CHANNEL_ID)
                        : new Notification.Builder(this);
        return builder
                .setContentTitle("Recording your walk")
                .setContentText("Tap to open Slow Navigator.")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentIntent(tap)
                .setOngoing(true)
                .build();
    }

    @Override
    public void onDestroy() {
        running = false;
        if (locations != null && listener != null) {
            try {
                locations.removeUpdates(listener);
            } catch (SecurityException e) {
                Log.w(TAG, "could not stop updates", e);
            }
        }
        if (thread != null) thread.quitSafely();
        locations = null;
        listener = null;
        thread = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        // Nothing binds to it: the web layer talks through the activity's
        // JavaScript interface and the static queue above.
        return null;
    }
}
