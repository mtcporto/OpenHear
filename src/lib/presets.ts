import type { ProcessingMode } from './AudioEngine';

export interface Preset {
  name: string;
  processingMode: ProcessingMode;
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
    name: 'Referência RAW',
    processingMode: 'raw',
    volume: 0,
    speech: 0,
    noiseCut: 80,
    gateThreshold: -50,
    noiseGate: false,
    browserNoise: false,
    rnnoiseEnabled: false,
    lowLatency: true,
  },
  fala: {
    name: 'Fala clara',
    processingMode: 'dsp',
    volume: 6,
    speech: 3,
    noiseCut: 100,
    gateThreshold: -50,
    noiseGate: false,
    browserNoise: false,
    rnnoiseEnabled: false,
    lowLatency: true,
  },
  ruido: {
    name: 'Ambiente ruidoso',
    processingMode: 'full',
    volume: 4,
    speech: 3,
    noiseCut: 120,
    gateThreshold: -46,
    noiseGate: false,
    browserNoise: false,
    rnnoiseEnabled: true,
    lowLatency: true,
  },
  musica: {
    name: 'Música / natural',
    processingMode: 'gain',
    volume: 0,
    speech: 0,
    noiseCut: 60,
    gateThreshold: -60,
    noiseGate: false,
    browserNoise: false,
    rnnoiseEnabled: false,
    lowLatency: true,
  },
};

const STORAGE_KEY = 'openhear_presets_v3';
const LEGACY_STORAGE_KEY = 'openhear_presets_v2';

function isProcessingMode(value: unknown): value is ProcessingMode {
  return value === 'raw' || value === 'gain' || value === 'dsp' || value === 'full';
}

function normalizePreset(value: unknown): Preset | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<Preset>;
  if (
    typeof candidate.name !== 'string' ||
    typeof candidate.volume !== 'number' ||
    typeof candidate.speech !== 'number' ||
    typeof candidate.noiseCut !== 'number' ||
    typeof candidate.gateThreshold !== 'number'
  ) return null;

  return {
    name: candidate.name.slice(0, 60),
    processingMode: isProcessingMode(candidate.processingMode)
      ? candidate.processingMode
      : candidate.rnnoiseEnabled
        ? 'full'
        : 'dsp',
    volume: Math.min(24, Math.max(-6, candidate.volume)),
    speech: Math.min(9, Math.max(0, candidate.speech)),
    noiseCut: Math.min(200, Math.max(60, candidate.noiseCut)),
    gateThreshold: Math.min(-20, Math.max(-70, candidate.gateThreshold)),
    noiseGate: Boolean(candidate.noiseGate),
    browserNoise: Boolean(candidate.browserNoise),
    rnnoiseEnabled: Boolean(candidate.rnnoiseEnabled),
    lowLatency: candidate.lowLatency !== false,
  };
}

function parsePresets(raw: string | null): Record<string, Preset> {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(parsed)
      .map(([id, value]) => [id, normalizePreset(value)] as const)
      .filter((entry): entry is readonly [string, Preset] => entry[1] !== null),
  );
}

export function loadCustomPresets(): Record<string, Preset> {
  if (typeof window === 'undefined') return {};
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current) return parsePresets(current);

    const migrated = parsePresets(localStorage.getItem(LEGACY_STORAGE_KEY));
    if (Object.keys(migrated).length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    }
    return migrated;
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
