package com.openhear.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

public class AudioForegroundService extends Service {
    private static final String CHANNEL_ID = "openhear-audio";
    private static final int NOTIFICATION_ID = 1001;
    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "OpenHear::AudioProcessing"
            );
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("OpenHear está ouvindo")
                .setContentText("O áudio continua ativo com a tela apagada")
                .setSmallIcon(com.openhear.app.R.mipmap.ic_launcher)
                .setOngoing(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();
        startForeground(NOTIFICATION_ID, notification);
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Áudio do OpenHear",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Indica que a escuta assistida está ativa");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }
}
