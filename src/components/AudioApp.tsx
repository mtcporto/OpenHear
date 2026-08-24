'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAudioEngine } from '@/hooks/useAudioEngine';
import {
  BUILT_IN_PRESETS,
  loadCustomPresets,
  saveCustomPreset,
  type Preset,
} from '@/lib/presets';
import {
  type AudioDiagnostics,
  type EngineSettings,
  type ProcessingMode,
  type RNNoiseStatus,
} from '@/lib/AudioEngine';
import Waveform from './Waveform';

const DEFAULT_SETTINGS: EngineSettings = {
  ...BUILT_IN_PRESETS.default,
  inputDeviceId: '',
  outputDeviceId: '',
};

const MODES: Array<{ id: ProcessingMode; title: string; description: string }> = [
  { id: 'raw', title: 'A · RAW', description: 'Microfone direto, sem ganho nem filtros.' },
  { id: 'gain', title: 'B · GAIN', description: 'Sinal bruto com ganho ajustável.' },
  { id: 'dsp', title: 'C · DSP', description: 'Ganho, filtros, EQ e compressor moderado.' },
  { id: 'full', title: 'D · FULL', description: 'DSP com RNNoise e gate opcionais.' },
];

const SESSION_LABEL = {
  idle: 'Inativo',
  starting: 'Iniciando…',
  running: 'Ativo',
  degraded: 'Ativo com ressalva',
  suspended: 'Áudio suspenso',
  error: 'Erro',
};

const RNNOISE_COLOR: Record<RNNoiseStatus, string> = {
  idle: 'text-muted',
  loading: 'text-accent2',
  ready: 'text-accent',
  error: 'text-red-700',
};

function formatDb(value: number): string {
  return `${value >= 0 ? '+' : ''}${value} dB`;
}

function formatMs(value: number | null): string {
  return value === null ? 'não informado' : `${value.toFixed(1)} ms`;
}

function yesNo(value: boolean | null): string {
  if (value === null) return 'não informado';
  return value ? 'sim' : 'não';
}

export default function AudioApp() {
  const engine = useAudioEngine();
  const {
    isActive,
    start: startEngine,
    updateSettings: updateEngineSettings,
    calibrateGate,
  } = engine;
  const [settings, setSettings] = useState<EngineSettings>(DEFAULT_SETTINGS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [customPresets, setCustomPresets] = useState<Record<string, Preset>>({});
  const [notice, setNotice] = useState('');

  const allPresets = useMemo(
    () => ({ ...BUILT_IN_PRESETS, ...customPresets }),
    [customPresets],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setCustomPresets(loadCustomPresets()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const updateSetting = useCallback((patch: Partial<EngineSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    if (isActive) updateEngineSettings(patch);
  }, [isActive, updateEngineSettings]);

  const handleStart = useCallback(async () => {
    setNotice('');
    try {
      await startEngine(settings);
    } catch {
      // O hook traduz e exibe o erro mantendo a exceção fora da UI.
    }
  }, [settings, startEngine]);

  const handleCalibrate = useCallback(async () => {
    if (!isActive) {
      setNotice('Inicie a escuta antes de calibrar o gate.');
      return;
    }
    setNotice('Fique em silêncio por 1,5 segundo enquanto o ruído de fundo é medido.');
    const threshold = await calibrateGate();
    if (threshold !== null) {
      updateSetting({ gateThreshold: threshold, noiseGate: true });
      setNotice(`Gate calibrado em ${threshold} dB.`);
    }
  }, [calibrateGate, isActive, updateSetting]);

  const applyPreset = useCallback((preset: Preset) => {
    const next: EngineSettings = {
      ...preset,
      inputDeviceId: settings.inputDeviceId,
      outputDeviceId: settings.outputDeviceId,
    };
    setSettings(next);
    setNotice(`Preset “${preset.name}” aplicado.`);
  }, [settings.inputDeviceId, settings.outputDeviceId]);

  const handleSavePreset = useCallback(() => {
    const name = presetName.trim();
    if (!name) {
      setNotice('Informe um nome para salvar o preset.');
      return;
    }

    const preset: Preset = {
      name,
      processingMode: settings.processingMode,
      volume: settings.volume,
      speech: settings.speech,
      noiseCut: settings.noiseCut,
      gateThreshold: settings.gateThreshold,
      noiseGate: settings.noiseGate,
      browserNoise: settings.browserNoise,
      rnnoiseEnabled: settings.rnnoiseEnabled,
      lowLatency: settings.lowLatency,
    };
    saveCustomPreset(`custom_${Date.now()}`, preset);
    setCustomPresets(loadCustomPresets());
    setPresetName('');
    setNotice(`Preset “${name}” salvo neste navegador.`);
  }, [presetName, settings]);

  const mode = settings.processingMode;
  const gainAvailable = mode !== 'raw';
  const dspAvailable = mode === 'dsp' || mode === 'full';
  const fullAvailable = mode === 'full';
  const controlsLocked = engine.isStarting;
  const meterPercent = Math.min(
    100,
    Math.max(0, Math.round(((engine.meterData.rmsDb + 72) / 72) * 100)),
  );
  const rnnoiseLabel = getRNNoiseLabel(
    engine.rnnoiseStatus,
    engine.isActive && fullAvailable && settings.rnnoiseEnabled,
  );

  return (
    <div className="w-full max-w-xl space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">OpenHear</h1>
          <p className="text-sm text-muted">Escuta assistida e diagnóstico de áudio</p>
        </div>
        <div className="flex max-w-[48%] items-center gap-2 text-right text-sm font-semibold">
          <span
            aria-hidden="true"
            className={`h-3 w-3 shrink-0 rounded-full transition-all ${
              engine.isActive
                ? 'scale-110 bg-accent shadow-[0_0_0_4px_rgba(15,107,95,0.2)]'
                : engine.isStarting
                  ? 'animate-pulse bg-accent2'
                  : 'bg-[#c3b49f]'
            }`}
          />
          <span className={engine.isActive ? 'text-accent' : 'text-muted'}>
            {engine.isActive && engine.deviceLabel
              ? engine.deviceLabel
              : SESSION_LABEL[engine.sessionState]}
          </span>
        </div>
      </header>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => void handleStart()}
          disabled={engine.isActive || engine.isStarting}
          className="h-16 flex-1 rounded-2xl bg-accent text-lg font-bold text-white shadow-[0_12px_20px_rgba(15,107,95,0.3)] transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {engine.isStarting ? 'Iniciando…' : 'Iniciar escuta'}
        </button>
        <button
          type="button"
          onClick={() => void engine.stop()}
          disabled={!engine.isActive}
          className="h-16 rounded-2xl bg-[#f2e4d0] px-5 font-bold text-ink transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Parar
        </button>
      </div>

      {engine.sessionState === 'suspended' && (
        <button
          type="button"
          onClick={() => void engine.resume()}
          className="w-full rounded-xl border border-accent bg-panel px-4 py-3 text-sm font-bold text-accent"
        >
          Retomar áudio
        </button>
      )}

      {engine.error && <Message tone="error">{engine.error}</Message>}
      {engine.warning && <Message tone="warning">{engine.warning}</Message>}
      {notice && <Message tone="info">{notice}</Message>}

      <section aria-labelledby="mode-title" className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="mode-title" className="text-sm font-bold">Modo de processamento</h2>
          <span className="text-xs text-muted">Troque durante a escuta para comparar</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {MODES.map((item) => {
            const selected = mode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={selected}
                disabled={controlsLocked}
                onClick={() => updateSetting({ processingMode: item.id })}
                className={`rounded-xl border p-3 text-left transition-colors disabled:opacity-50 ${
                  selected
                    ? 'border-accent bg-[#e4f2ed] shadow-[inset_0_0_0_1px_#0f6b5f]'
                    : 'border-border bg-panel hover:border-[#b99d78]'
                }`}
              >
                <span className="block text-sm font-bold">{item.title}</span>
                <span className="mt-1 block text-xs leading-snug text-muted">{item.description}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted">
          Todos os modos mantêm apenas um limiter final contra picos digitais; ele não calibra o volume seguro do fone.
        </p>
      </section>

      <Waveform analyserNode={engine.analyserNode} />

      <section aria-label="Nível bruto do microfone" className="space-y-1">
        <div className="flex justify-between text-xs text-muted">
          <span>Entrada bruta do microfone</span>
          <span className="flex items-center gap-2">
            <span className={`font-bold ${engine.clipActive ? 'text-red-700' : 'invisible'}`}>CLIP</span>
            <span>{Math.round(engine.meterData.rmsDb)} dBFS</span>
          </span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full transition-[width] duration-75"
            style={{
              width: `${meterPercent}%`,
              background: 'linear-gradient(90deg, #1d8a6f, #e0a03a, #d84e35)',
            }}
          />
        </div>
      </section>

      <section className="space-y-5 rounded-2xl border border-border bg-panel p-4 shadow-[0_8px_30px_rgba(31,27,22,0.08)]">
        <Slider
          id="volume"
          label="Ganho"
          value={settings.volume}
          min={-6}
          max={24}
          step={1}
          display={formatDb(settings.volume)}
          disabled={!gainAvailable || controlsLocked}
          onChange={(value) => updateSetting({ volume: value })}
        />

        <Slider
          id="speech"
          label="Clareza de fala (3 kHz)"
          value={settings.speech}
          min={0}
          max={9}
          step={1}
          display={formatDb(settings.speech)}
          disabled={!dspAvailable || controlsLocked}
          onChange={(value) => updateSetting({ speech: value })}
        />

        <div className="space-y-3">
          <Toggle
            id="rnnoise"
            label="Supressão neural RNNoise"
            sublabel={<span className={`text-xs font-semibold ${RNNOISE_COLOR[engine.rnnoiseStatus]}`}>{rnnoiseLabel}</span>}
            checked={settings.rnnoiseEnabled}
            disabled={!fullAvailable || controlsLocked || engine.rnnoiseStatus === 'error'}
            onChange={(value) => updateSetting({ rnnoiseEnabled: value })}
          />
          <Toggle
            id="noise-gate"
            label="Gate de ruído"
            sublabel={<span className="text-xs text-muted">Opcional; deixe desligado se a fala ficar cortada</span>}
            checked={settings.noiseGate}
            disabled={!fullAvailable || controlsLocked}
            onChange={(value) => updateSetting({ noiseGate: value })}
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Presets</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(allPresets).map(([id, preset]) => (
              <button
                key={id}
                type="button"
                disabled={engine.isActive || engine.isStarting}
                onClick={() => applyPreset(preset)}
                className="rounded-full bg-[#f2e4d0] px-3 py-1.5 text-sm font-semibold text-ink transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {preset.name}
              </button>
            ))}
          </div>
          {engine.isActive && <p className="text-xs text-muted">Pare a escuta para aplicar um preset completo.</p>}
        </div>

        <details
          open={showAdvanced}
          onToggle={(event) => setShowAdvanced(event.currentTarget.open)}
          className="space-y-4"
        >
          <summary className="cursor-pointer list-none text-sm font-bold text-accent">
            {showAdvanced ? '▲' : '▼'} Configurações e diagnóstico
          </summary>

          <div className="space-y-5 pt-2">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Dispositivos</p>
              <DeviceSelect
                id="input-device"
                label="Microfone"
                devices={engine.devices.inputs}
                value={settings.inputDeviceId ?? ''}
                disabled={engine.isActive || engine.isStarting}
                onChange={(value) => setSettings((current) => ({ ...current, inputDeviceId: value }))}
              />
              <DeviceSelect
                id="output-device"
                label="Saída de áudio"
                devices={engine.devices.outputs}
                value={settings.outputDeviceId ?? ''}
                disabled={engine.isActive || engine.isStarting}
                onChange={(value) => setSettings((current) => ({ ...current, outputDeviceId: value }))}
              />
              <button
                type="button"
                disabled={engine.isActive || engine.isStarting}
                onClick={() => void engine.refreshDevices(true)}
                className="text-xs font-bold text-accent underline disabled:cursor-not-allowed disabled:opacity-45"
              >
                Autorizar e atualizar dispositivos
              </button>
              <p className="text-xs text-muted">
                Em celulares, a rota Bluetooth final também depende do sistema operacional e pode não aparecer separadamente.
              </p>
            </div>

            <Slider
              id="noise-cut"
              label="Corte de graves"
              value={settings.noiseCut}
              min={60}
              max={200}
              step={10}
              display={`${settings.noiseCut} Hz`}
              disabled={!dspAvailable || controlsLocked}
              onChange={(value) => updateSetting({ noiseCut: value })}
            />

            <div className="space-y-1">
              <Slider
                id="gate-threshold"
                label="Limiar do gate"
                value={settings.gateThreshold}
                min={-70}
                max={-20}
                step={1}
                display={formatDb(settings.gateThreshold)}
                disabled={!fullAvailable || controlsLocked}
                onChange={(value) => updateSetting({ gateThreshold: value })}
              />
              <button
                type="button"
                disabled={!fullAvailable || engine.isStarting}
                onClick={() => void handleCalibrate()}
                className="text-xs font-bold text-accent2 underline disabled:cursor-not-allowed disabled:opacity-45"
              >
                Calibrar com o ruído ambiente (1,5 s)
              </button>
            </div>

            <Toggle
              id="browser-noise"
              label="Processamento de voz do navegador"
              sublabel={<span className="text-xs text-muted">Eco, ruído e ganho automáticos; exige reiniciar</span>}
              checked={settings.browserNoise}
              disabled={engine.isActive || engine.isStarting}
              onChange={(value) => setSettings((current) => ({ ...current, browserNoise: value }))}
            />
            <Toggle
              id="low-latency"
              label="Priorizar baixa latência"
              sublabel={<span className="text-xs text-muted">Exige reiniciar a escuta</span>}
              checked={settings.lowLatency}
              disabled={engine.isActive || engine.isStarting}
              onChange={(value) => setSettings((current) => ({ ...current, lowLatency: value }))}
            />

            {engine.diagnostics ? (
              <Diagnostics diagnostics={engine.diagnostics} />
            ) : (
              <p className="rounded-xl bg-bg1 p-3 text-xs text-muted">
                Inicie a escuta para ver taxa de amostragem, canais, latência e processamento aplicado pelo navegador.
              </p>
            )}

            <div className="space-y-2">
              <label htmlFor="preset-name" className="text-xs font-semibold uppercase tracking-wide text-muted">
                Salvar preset
              </label>
              <div className="flex gap-2">
                <input
                  id="preset-name"
                  type="text"
                  maxLength={60}
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                  placeholder="Nome do preset"
                  className="min-w-0 flex-1 rounded-xl border border-border bg-bg1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <button
                  type="button"
                  onClick={handleSavePreset}
                  className="rounded-xl bg-accent px-4 text-sm font-bold text-white"
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        </details>
      </section>

      <p className="px-2 pb-5 text-center text-xs leading-relaxed text-muted">
        Comece em RAW e com volume baixo. Compare também um fone com fio/USB: Bluetooth em modo de chamada pode reduzir bastante a qualidade. Este app não substitui avaliação audiológica.
      </p>
    </div>
  );
}

function getRNNoiseLabel(status: RNNoiseStatus, active: boolean): string {
  if (status === 'loading') return 'carregando…';
  if (status === 'error') return 'indisponível; usando passagem direta';
  if (status === 'ready') return active ? 'ativo' : 'pronto';
  return 'será carregado ao iniciar';
}

function Message({ tone, children }: { tone: 'error' | 'warning' | 'info'; children: ReactNode }) {
  const styles = {
    error: 'border-red-500 bg-red-50 text-red-800',
    warning: 'border-accent2 bg-[#fff0e3] text-[#7a2e14]',
    info: 'border-accent bg-[#e4f2ed] text-[#184c43]',
  };
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border-l-4 px-3 py-2 text-sm ${styles[tone]}`}>{children}</div>;
}

function Slider({
  id,
  label,
  value,
  min,
  max,
  step,
  display,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  disabled?: boolean;
  onChange(value: number): void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold">{label}</label>
        <span className="font-mono text-sm text-muted">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-2 w-full cursor-pointer rounded-full disabled:cursor-not-allowed disabled:opacity-45"
      />
    </div>
  );
}

function Toggle({
  id,
  label,
  sublabel,
  checked,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  sublabel?: ReactNode;
  checked: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p id={`${id}-label`} className="text-sm font-semibold">{label}</p>
        {sublabel}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-labelledby={`${id}-label`}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-45 ${checked ? 'bg-accent' : 'bg-[#c3b49f]'}`}
      >
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}

function DeviceSelect({
  id,
  label,
  devices,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  devices: MediaDeviceInfo[];
  value: string;
  onChange(value: string): void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-semibold text-muted">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="w-full rounded-xl border border-border bg-bg1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
      >
        <option value="">Padrão do sistema</option>
        {devices.map((device, index) => (
          <option key={device.deviceId || `${device.kind}-${index}`} value={device.deviceId}>
            {device.label || `${label} ${index + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
}

function Diagnostics({ diagnostics }: { diagnostics: AudioDiagnostics }) {
  const outputRoute = {
    'system-default': 'saída padrão do sistema',
    'audio-context': 'AudioContext.setSinkId',
    'media-element': 'elemento de áudio com setSinkId',
    fallback: 'fallback para a saída do sistema',
  }[diagnostics.outputRoute];

  const rows = [
    ['Modo atual', diagnostics.processingMode.toUpperCase()],
    ['Contexto de áudio', `${diagnostics.contextSampleRate} Hz`],
    ['Entrada real', diagnostics.inputSampleRate ? `${diagnostics.inputSampleRate} Hz · ${diagnostics.inputChannelCount ?? '?'} canal(is)` : 'não informado'],
    ['Latência da entrada', formatMs(diagnostics.inputLatencyMs)],
    ['Latência base / saída', `${formatMs(diagnostics.baseLatencyMs)} / ${formatMs(diagnostics.outputLatencyMs)}`],
    ['Rota de saída', outputRoute],
    ['Eco / ruído / ganho do browser', `${yesNo(diagnostics.echoCancellation)} / ${yesNo(diagnostics.noiseSuppression)} / ${yesNo(diagnostics.autoGainControl)}`],
    ['Contexto seguro (HTTPS)', diagnostics.secureContext ? 'sim' : 'não'],
  ];

  return (
    <div className="space-y-2 rounded-xl bg-bg1 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Diagnóstico da sessão</p>
      <dl className="space-y-1.5 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-3">
            <dt className="text-muted">{label}</dt>
            <dd className="break-words text-right font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      {diagnostics.inputFallback && <p className="font-semibold text-accent2">O microfone escolhido falhou; foi usada a entrada padrão.</p>}
    </div>
  );
}
