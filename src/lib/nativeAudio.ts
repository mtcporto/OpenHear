import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface NativeAudioSettings {
  processingMode: 'raw' | 'gain' | 'dsp' | 'full';
  volume: number;
  speech: number;
  noiseCut: number;
  gateThreshold: number;
  noiseGate: boolean;
  browserNoise: boolean;
  rnnoiseEnabled: boolean;
  lowLatency: boolean;
  inputDeviceId?: string;
  outputDeviceId?: string;
}

export interface NativeAudioDiagnostics {
  inputSampleRate: number;
  outputSampleRate: number;
  inputChannelCount: number;
  bufferSize: number;
  inputDeviceLabel: string;
  outputDeviceLabel: string;
  lowLatencyPath: boolean;
}

export interface NativeAudioPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  requestPermission(): Promise<void>;
  start(options: { settings: NativeAudioSettings }): Promise<NativeAudioDiagnostics>;
  stop(): Promise<void>;
  updateSettings(options: { settings: Partial<NativeAudioSettings> }): Promise<void>;
  addListener(
    eventName: 'meter' | 'state' | 'warning' | 'diagnostics',
    listenerFunc: (data: Record<string, unknown>) => void,
  ): Promise<PluginListenerHandle>;
}

export const NativeAudio = registerPlugin<NativeAudioPlugin>('NativeAudio');

export function isNativeAudioAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}
