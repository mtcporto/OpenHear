'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioEngine,
  type AudioDiagnostics,
  type AudioSessionState,
  type EngineSettings,
  type MeterData,
  type RNNoiseStatus,
} from '@/lib/AudioEngine';
import { isNativeAudioAvailable, NativeAudio, type NativeAudioDiagnostics } from '@/lib/nativeAudio';

const EMPTY_METER: MeterData = { rmsDb: -96, peak: 0 };

export function useAudioEngine() {
  const engineRef = useRef<AudioEngine | null>(null);
  const nativeListenersRef = useRef<Array<{ remove: () => Promise<void> }>>([]);
  const nativeActiveRef = useRef(false);
  const lastMeterPaintRef = useRef(0);

  const [sessionState, setSessionState] = useState<AudioSessionState>('idle');
  const [meterData, setMeterData] = useState<MeterData>(EMPTY_METER);
  const [rnnoiseStatus, setRnnoiseStatus] = useState<RNNoiseStatus>('idle');
  const [deviceLabel, setDeviceLabel] = useState('');
  const [clipActive, setClipActive] = useState(false);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [diagnostics, setDiagnostics] = useState<AudioDiagnostics | null>(null);
  const [warning, setWarning] = useState('');
  const [error, setError] = useState('');
  const [devices, setDevices] = useState<{
    inputs: MediaDeviceInfo[];
    outputs: MediaDeviceInfo[];
  }>({ inputs: [], outputs: [] });

  const paintMeter = useCallback((data: MeterData) => {
    const now = performance.now();
    if (now - lastMeterPaintRef.current < 80) return;
    lastMeterPaintRef.current = now;
    setMeterData(data);
  }, []);

  const loadDevices = useCallback(async () => {
    const list = await AudioEngine.enumerateDevices();
    setDevices(list);
    return list;
  }, []);

  const refreshDevices = useCallback(async (requestPermission = true) => {
    let list = await AudioEngine.enumerateDevices();
    const needsPermission = requestPermission && !list.inputs.some((device) => device.label);

    if (needsPermission) {
      try {
        const temporaryStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        temporaryStream.getTracks().forEach((track) => track.stop());
        list = await AudioEngine.enumerateDevices();
      } catch (caught) {
        setWarning(AudioEngine.describeError(caught));
      }
    }

    setDevices(list);
    return list;
  }, []);

  const start = useCallback(async (settings: EngineSettings) => {
    if (engineRef.current?.isRunning()) return;
    engineRef.current = null;

    setError('');
    setWarning('');
    setDiagnostics(null);

    if (isNativeAudioAvailable()) {
      setSessionState('starting');
      try {
        await NativeAudio.requestPermission();
        nativeListenersRef.current = await Promise.all([
          NativeAudio.addListener('meter', (data) => {
            if (typeof data.rmsDb === 'number' && typeof data.peak === 'number')
              paintMeter({ rmsDb: data.rmsDb, peak: data.peak });
            if (typeof data.peak === 'number') setClipActive(data.peak > 0.98);
          }),
          NativeAudio.addListener('state', (data) => {
            if (data.state === 'running') setSessionState('running');
            if (data.state === 'idle') setSessionState('idle');
          }),
          NativeAudio.addListener('warning', (data) => {
            if (typeof data.message === 'string') setWarning(data.message);
          }),
        ]);
        const nativeDiagnostics = await NativeAudio.start({ settings });
        setDiagnostics(toAudioDiagnostics(nativeDiagnostics, settings));
        nativeActiveRef.current = true;
        return;
      } catch (caught) {
        await Promise.all(nativeListenersRef.current.map((listener) => listener.remove()));
        nativeListenersRef.current = [];
        setSessionState('error');
        setError(AudioEngine.describeError(caught));
        throw caught;
      }
    }

    const engine = new AudioEngine({
      onMeter: paintMeter,
      onRNNoiseStatus: setRnnoiseStatus,
      onDeviceLabel: setDeviceLabel,
      onClip: setClipActive,
      onDiagnostics: setDiagnostics,
      onSessionState: (state) => {
        setSessionState(state);
        if (state === 'error') {
          setMeterData(EMPTY_METER);
          setRnnoiseStatus('idle');
          setClipActive(false);
          setAnalyserNode(null);
          setDiagnostics(null);
        }
      },
      onWarning: setWarning,
    });
    engineRef.current = engine;

    try {
      await engine.start(settings);
      setAnalyserNode(engine.getAnalyser());
      await loadDevices();
    } catch (caught) {
      engineRef.current = null;
      setAnalyserNode(null);
      const message = AudioEngine.describeError(caught);
      setError(message);
      throw caught;
    }
  }, [loadDevices, paintMeter]);

  const stop = useCallback(async () => {
    if (nativeActiveRef.current) {
      nativeActiveRef.current = false;
      await NativeAudio.stop();
      await Promise.all(nativeListenersRef.current.map((listener) => listener.remove()));
      nativeListenersRef.current = [];
      setSessionState('idle');
      setMeterData(EMPTY_METER);
      setClipActive(false);
      setDiagnostics(null);
      return;
    }
    const engine = engineRef.current;
    engineRef.current = null;
    await engine?.stop();
    setMeterData(EMPTY_METER);
    setRnnoiseStatus('idle');
    setDeviceLabel('');
    setClipActive(false);
    setAnalyserNode(null);
    setDiagnostics(null);
  }, []);

  const resume = useCallback(async () => {
    if (nativeActiveRef.current) return;
    try {
      await engineRef.current?.resume();
    } catch (caught) {
      setError(AudioEngine.describeError(caught));
    }
  }, []);

  const updateSettings = useCallback((partial: Partial<EngineSettings>) => {
    if (nativeActiveRef.current) {
      void NativeAudio.updateSettings({ settings: partial });
      return;
    }
    engineRef.current?.updateSettings(partial);
  }, []);

  const calibrateGate = useCallback(async (): Promise<number | null> => {
    return engineRef.current?.calibrateGate() ?? null;
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void loadDevices(); }, 0);
    const handleDeviceChange = () => { void loadDevices(); };
    navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange);

    return () => {
      window.clearTimeout(initialLoad);
      navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange);
      const engine = engineRef.current;
      engineRef.current = null;
      void engine?.stop(false);
      if (nativeActiveRef.current) {
        nativeActiveRef.current = false;
        void NativeAudio.stop();
      }
    };
  }, [loadDevices]);

  const isActive = ['running', 'degraded', 'suspended'].includes(sessionState);
  const isStarting = sessionState === 'starting';

  return {
    isActive,
    isStarting,
    sessionState,
    meterData,
    rnnoiseStatus,
    deviceLabel,
    clipActive,
    analyserNode,
    diagnostics,
    warning,
    error,
    devices,
    start,
    stop,
    resume,
    updateSettings,
    calibrateGate,
    loadDevices,
    refreshDevices,
  };
}

function toAudioDiagnostics(native: NativeAudioDiagnostics, settings: EngineSettings): AudioDiagnostics {
  return {
    contextSampleRate: native.outputSampleRate,
    inputSampleRate: native.inputSampleRate,
    inputChannelCount: native.inputChannelCount,
    inputLatencyMs: (native.bufferSize / native.inputSampleRate) * 1000,
    baseLatencyMs: null,
    outputLatencyMs: (native.bufferSize / native.outputSampleRate) * 1000,
    inputDeviceId: null,
    inputDeviceLabel: native.inputDeviceLabel,
    inputFallback: false,
    outputDeviceId: null,
    outputRoute: 'fallback',
    echoCancellation: null,
    noiseSuppression: null,
    autoGainControl: null,
    processingMode: settings.processingMode,
    secureContext: true,
  };
}
