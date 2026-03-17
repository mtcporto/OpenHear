export interface Preset {
  name: string;
  volume: number;
  speech: number;
  noiseCut: number;
  gateThreshold: number;
  noiseGate: boolean;
  browserNoise: boolean;
  rnnoiseEnabled: boolean;
  lowLatency: boolean;
}

export const BUILT_IN_PRESETS: Record<string, Preset> = {
  default: {
    name: 'Padrão',
    volume: 18,
    speech: 4,
    noiseCut: 100,
    gateThreshold: -50,
    noiseGate: false,
    browserNoise: false,
    rnnoiseEnabled: true,
    lowLatency: true,
  },
  fala: {
    name: 'Fala clara',
    volume: 22,
    speech: 7,
    noiseCut: 120,
    gateThreshold: -48,
    noiseGate: false,
    browserNoise: false,
    rnnoiseEnabled: true,
    lowLatency: true,
  },
  ruido: {
    name: 'Ambiente ruidoso',
    volume: 20,
    speech: 6,
    noiseCut: 140,
    gateThreshold: -45,
    noiseGate: true,
    browserNoise: false,
    rnnoiseEnabled: true,
    lowLatency: false,
  },
  musica: {
    name: 'Música',
    volume: 14,
    speech: 0,
    noiseCut: 60,
    gateThreshold: -60,
    noiseGate: false,
    browserNoise: false,
    rnnoiseEnabled: false,
    lowLatency: true,
  },
};

const STORAGE_KEY = 'openhear_presets_v2';

export function loadCustomPresets(): Record<string, Preset> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Preset>) : {};
  } catch {
    return {};
  }
}

export function saveCustomPreset(id: string, preset: Preset): void {
  const custom = loadCustomPresets();
  custom[id] = preset;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
}

export function deleteCustomPreset(id: string): void {
  const custom = loadCustomPresets();
  delete custom[id];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
}
