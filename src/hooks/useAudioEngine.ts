'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { AudioEngine, type EngineSettings, type MeterData, type RNNoiseStatus } from '@/lib/AudioEngine';

export function useAudioEngine() {
  const engineRef = useRef<AudioEngine | null>(null);

  const [isActive,       setIsActive]       = useState(false);
  const [meterData,      setMeterData]      = useState<MeterData>({ rmsDb: -60, peak: 0 });
  const [rnnoiseStatus,  setRnnoiseStatus]  = useState<RNNoiseStatus>('idle');
  const [deviceLabel,    setDeviceLabel]    = useState('');
  const [clipActive,     setClipActive]     = useState(false);
  const [feedbackActive, setFeedbackActive] = useState(false);
  const [analyserNode,   setAnalyserNode]   = useState<AnalyserNode | null>(null);
  const [devices, setDevices] = useState<{
    inputs: MediaDeviceInfo[];
    outputs: MediaDeviceInfo[];
  }>({ inputs: [], outputs: [] });

  const loadDevices = useCallback(async () => {
    const list = await AudioEngine.enumerateDevices();
    setDevices(list);
  }, []);

  // Garante labels pedindo permissao se necessario
  const refreshDevices = useCallback(async () => {
    let list = await AudioEngine.enumerateDevices();
    const hasLabels = list.inputs.some((d) => d.label);
    if (!hasLabels) {
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
        tmp.getTracks().forEach((t) => t.stop());
        list = await AudioEngine.enumerateDevices();
      } catch { /* sem permissao */ }
    }
    setDevices(list);
  }, []);

  const start = useCallback(async (settings: EngineSettings) => {
    if (engineRef.current) return;
    const engine = new AudioEngine({
      onMeter:          setMeterData,
      onRNNoiseStatus:  setRnnoiseStatus,
      onDeviceLabel:    setDeviceLabel,
      onClip:           setClipActive,
      onFeedback:       setFeedbackActive,
    });
    await engine.start(settings);
    engineRef.current = engine;
    setIsActive(true);
    setAnalyserNode(engine.getAnalyser());
  }, []);

  const stop = useCallback(async () => {
    const engine = engineRef.current;
    engineRef.current = null;
    setIsActive(false);
    setRnnoiseStatus('idle');
    setDeviceLabel('');
    setMeterData({ rmsDb: -60, peak: 0 });
    setClipActive(false);
    setFeedbackActive(false);
    setAnalyserNode(null);
    await engine?.stop();
  }, []);

  const updateSettings = useCallback((partial: Partial<EngineSettings>) => {
    engineRef.current?.updateSettings(partial);
  }, []);

  const calibrateGate = useCallback(async (): Promise<number | null> => {
    return engineRef.current?.calibrateGate() ?? null;
  }, []);

  // Ouve mudancas de dispositivo
  useEffect(() => {
    const handler = () => { loadDevices().catch(() => {}); };
    navigator.mediaDevices?.addEventListener?.('devicechange', handler);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', handler);
  }, [loadDevices]);

  return {
    isActive, meterData, rnnoiseStatus, deviceLabel,
    clipActive, feedbackActive, analyserNode, devices,
    start, stop, updateSettings, calibrateGate, loadDevices, refreshDevices,
  };
}
