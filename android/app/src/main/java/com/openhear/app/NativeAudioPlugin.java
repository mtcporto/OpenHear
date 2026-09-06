package com.openhear.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "NativeAudio",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class NativeAudioPlugin extends Plugin {
    private static final int SAMPLE_RATE = 48000;
    private static final int CHANNEL_MASK = AudioFormat.CHANNEL_IN_MONO;
    private static final int CHANNEL_OUT_MASK = AudioFormat.CHANNEL_OUT_MONO;
    private static final int ENCODING = AudioFormat.ENCODING_PCM_16BIT;

    private volatile boolean running;
    private Thread audioThread;
    private AudioRecord recorder;
    private AudioTrack player;
    private AudioManager audioManager;
    private int bufferSize;
    private long lastMeterNanos;
    private String processingMode = "dsp";
    private float volumeDb = 6f;
    private float speech = 3f;
    private float noiseCut = 100f;
    private float highPassInput;
    private float highPassOutput;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", true);
        call.resolve(result);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED) {
            call.resolve();
            return;
        }
        requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        if (hasPermission(Manifest.permission.RECORD_AUDIO)) {
            call.resolve();
        } else {
            call.reject("Permissão de microfone negada");
        }
    }

    @PluginMethod
    public synchronized void start(PluginCall call) {
        if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
            call.reject("Permissão de microfone necessária");
            return;
        }
        if (running) {
            call.resolve(diagnostics());
            return;
        }

        bufferSize = Math.max(
                AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_MASK, ENCODING),
                SAMPLE_RATE / 100
        );

        try {
            applySettings(call.getObject("settings"));
            audioManager = (AudioManager) getContext().getSystemService(android.content.Context.AUDIO_SERVICE);
            if (audioManager != null) audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
            recorder = new AudioRecord(
                    android.media.MediaRecorder.AudioSource.VOICE_RECOGNITION,
                    SAMPLE_RATE,
                    CHANNEL_MASK,
                    ENCODING,
                    bufferSize * 2
            );

            AudioTrack.Builder trackBuilder = new AudioTrack.Builder()
                    .setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build())
                    .setAudioFormat(new AudioFormat.Builder()
                            .setSampleRate(SAMPLE_RATE)
                            .setEncoding(ENCODING)
                            .setChannelMask(CHANNEL_OUT_MASK)
                            .build())
                    .setBufferSizeInBytes(bufferSize * 2)
                    .setTransferMode(AudioTrack.MODE_STREAM);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                trackBuilder.setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY);
            }
            player = trackBuilder.build();
            recorder.startRecording();
            player.play();
            running = true;
            startAudioForegroundService();
            notifyListeners("state", new JSObject().put("state", "running"));
            call.resolve(diagnostics());
            startAudioLoop();
        } catch (Exception error) {
            stopAudio();
            call.reject("Não foi possível iniciar o áudio nativo", error);
        }
    }

    @PluginMethod
    public synchronized void stop(PluginCall call) {
        stopAudio();
        call.resolve();
    }

    @PluginMethod
    public void updateSettings(PluginCall call) {
        applySettings(call.getObject("settings"));
        call.resolve();
    }

    private void startAudioLoop() {
        audioThread = new Thread(() -> {
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO);
            short[] buffer = new short[bufferSize / 2];
            while (running) {
                int read = recorder == null ? 0 : recorder.read(buffer, 0, buffer.length);
                if (read > 0 && player != null) {
                    processAudio(buffer, read);
                    player.write(buffer, 0, read);
                    notifyMeter(buffer, read);
                } else if (read < 0) {
                    notifyListeners("warning", new JSObject().put("message", "Falha na captura nativa: " + read));
                    break;
                }
            }
        }, "OpenHear-Audio");
        audioThread.start();
    }

    private void notifyMeter(short[] buffer, int length) {
        long now = System.nanoTime();
        if (now - lastMeterNanos < 50_000_000L) return;
        lastMeterNanos = now;
        double sum = 0;
        int peak = 0;
        for (int index = 0; index < length; index++) {
            int sample = Math.abs(buffer[index]);
            peak = Math.max(peak, sample);
            sum += (double) sample * sample;
        }
        double rms = length == 0 ? 0 : Math.sqrt(sum / length) / 32768.0;
        double rmsDb = rms <= 0 ? -96 : 20.0 * Math.log10(rms);
        notifyListeners("meter", new JSObject()
                .put("rmsDb", Math.max(-96, rmsDb))
                .put("peak", Math.min(1, peak / 32768.0)));
    }

    private synchronized void applySettings(JSObject settings) {
        if (settings == null) return;
        processingMode = settings.getString("processingMode", processingMode);
        volumeDb = (float) settings.optDouble("volume", volumeDb);
        speech = (float) settings.optDouble("speech", speech);
        noiseCut = (float) settings.optDouble("noiseCut", noiseCut);
        volumeDb = Math.max(-6f, Math.min(18f, volumeDb));
        speech = Math.max(0f, Math.min(9f, speech));
        noiseCut = Math.max(60f, Math.min(200f, noiseCut));
    }

    private void processAudio(short[] buffer, int length) {
        if ("raw".equals(processingMode)) return;
        float gain = (float) Math.pow(10, volumeDb / 20.0);
        if ("dsp".equals(processingMode) || "full".equals(processingMode)) {
            gain *= (float) Math.pow(10, (speech / 9f * 3f) / 20.0);
        }
        float alpha = (float) Math.exp(-2.0 * Math.PI * noiseCut / SAMPLE_RATE);
        for (int index = 0; index < length; index++) {
            float input = buffer[index] / 32768f;
            if ("dsp".equals(processingMode) || "full".equals(processingMode)) {
                highPassOutput = alpha * (highPassOutput + input - highPassInput);
                highPassInput = input;
                input = highPassOutput;
            }
            float amplified = input * gain;
            buffer[index] = (short) Math.round(Math.tanh(amplified) * 32767f);
        }
    }

    private JSObject diagnostics() {
        return new JSObject()
                .put("inputSampleRate", SAMPLE_RATE)
                .put("outputSampleRate", SAMPLE_RATE)
                .put("inputChannelCount", 1)
                .put("bufferSize", bufferSize)
                .put("inputDeviceLabel", "Android native microphone")
                .put("outputDeviceLabel", "Android native output")
                .put("lowLatencyPath", true);
    }

    private synchronized void stopAudio() {
        running = false;
        if (recorder != null) {
            try { recorder.stop(); } catch (Exception ignored) { }
            recorder.release();
            recorder = null;
        }
        if (player != null) {
            try { player.stop(); } catch (Exception ignored) { }
            player.release();
            player = null;
        }
        stopAudioForegroundService();
        if (audioManager != null) {
            audioManager.setMode(AudioManager.MODE_NORMAL);
            audioManager = null;
        }
        highPassInput = 0;
        highPassOutput = 0;
        audioThread = null;
        notifyListeners("state", new JSObject().put("state", "idle"));
    }

    private void startAudioForegroundService() {
        Intent intent = new Intent(getContext(), AudioForegroundService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
    }

    private void stopAudioForegroundService() {
        getContext().stopService(new Intent(getContext(), AudioForegroundService.class));
    }

    @Override
    protected void handleOnDestroy() {
        stopAudio();
        super.handleOnDestroy();
    }
}
