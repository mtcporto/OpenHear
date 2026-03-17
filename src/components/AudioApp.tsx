'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAudioEngine } from '@/hooks/useAudioEngine';
import {
  BUILT_IN_PRESETS,
  loadCustomPresets,
  saveCustomPreset,
  type Preset,
} from '@/lib/presets';
import { type EngineSettings } from '@/lib/AudioEngine';
import Waveform from './Waveform';

// ────────────────────── helpers ──────────────────────
function fmtDb(db: number) {
  return `${db >= 0 ? '+' : ''}${db} dB`;
}

const RNNOISE_LABEL: Record<string, string> = {
  idle:    'aguardando',
  loading: 'carregando…',
  ready:   'ativo',
  error:   'indisponível',
};
const RNNOISE_COLOR: Record<string, string> = {
  idle:    'text-muted',
  loading: 'text-accent2',
  ready:   'text-accent',
  error:   'text-red-500',
};

// ────────────────────── defaults ─────────────────────
const DEFAULT: EngineSettings = {
  ...BUILT_IN_PRESETS.default,
  inputDeviceId:  '',
  outputDeviceId: '',
};

// ────────────────────── component ────────────────────
export default function AudioApp() {
  const engine = useAudioEngine();

  const [settings, setSettings] = useState<EngineSettings>(DEFAULT);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [presetName, setPresetName]     = useState('');
  const [customPresets, setCustomPresets] = useState<Record<string, Preset>>({});
  const [allPresets, setAllPresets]       = useState({ ...BUILT_IN_PRESETS, ...customPresets });
  const [error, setError] = useState('');
  const startingRef = useRef(false);

  // Carrega dispositivos e presets ao montar
  useEffect(() => {
    engine.refreshDevices().catch(() => {});
    const custom = loadCustomPresets();
    setCustomPresets(custom);
    setAllPresets({ ...BUILT_IN_PRESETS, ...custom });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Atualiza parametros em tempo real enquanto ativo
  const set = useCallback(
    (patch: Partial<EngineSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        if (engine.isActive) engine.updateSettings(patch);
        return next;
      });
    },
    [engine]
  );

  // ── Start / Stop ──
  const handleStart = useCallback(async () => {
    if (startingRef.current || engine.isActive) return;
    startingRef.current = true;
    setError('');
    try {
      await engine.start(settings);
    } catch (e) {
      setError('Falha ao acessar o microfone. Verifique as permissões do navegador.');
      console.error(e);
    } finally {
      startingRef.current = false;
    }
  }, [engine, settings]);

  const handleStop = useCallback(async () => {
    await engine.stop();
  }, [engine]);

  // ── Calibrar gate ──
  const handleCalibrate = useCallback(async () => {
    if (!engine.isActive) { alert('Inicie a escuta antes de calibrar.'); return; }
    const threshold = await engine.calibrateGate();
    if (threshold !== null) set({ gateThreshold: threshold, noiseGate: true });
  }, [engine, set]);

  // ── Presets ──
  const applyPreset = useCallback((p: Preset) => {
    const next: EngineSettings = {
      ...p,
      inputDeviceId:  settings.inputDeviceId,
      outputDeviceId: settings.outputDeviceId,
    };
    setSettings(next);
    if (engine.isActive) engine.updateSettings(next);
  }, [engine, settings.inputDeviceId, settings.outputDeviceId]);

  const handleSavePreset = useCallback(() => {
    const name = presetName.trim();
    if (!name) { alert('Informe um nome para o preset.'); return; }
    const id = `custom_${Date.now()}`;
    const preset: Preset = {
      name,
      volume:         settings.volume,
      speech:         settings.speech,
      noiseCut:       settings.noiseCut,
      gateThreshold:  settings.gateThreshold,
      noiseGate:      settings.noiseGate,
      browserNoise:   settings.browserNoise,
      rnnoiseEnabled: settings.rnnoiseEnabled,
      lowLatency:     settings.lowLatency,
    };
    saveCustomPreset(id, preset);
    const custom = loadCustomPresets();
    setCustomPresets(custom);
    setAllPresets({ ...BUILT_IN_PRESETS, ...custom });
    setPresetName('');
  }, [presetName, settings]);

  // ── Meter ──
  const meterPct = Math.min(100, Math.max(0, Math.round(((engine.meterData.rmsDb + 60) / 60) * 100)));

  return (
    <div className="w-full max-w-lg space-y-4">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">OpenHear</h1>
          <p className="text-sm text-muted">Amplificador auditivo no smartphone</p>
        </div>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span
            className={`h-3 w-3 rounded-full transition-all ${
              engine.isActive
                ? 'bg-accent scale-110 shadow-[0_0_0_4px_rgba(15,107,95,0.2)]'
                : 'bg-[#c3b49f]'
            }`}
          />
          <span className={engine.isActive ? 'text-accent' : 'text-muted'}>
            {engine.isActive
              ? engine.deviceLabel
                ? engine.deviceLabel.length > 22
                  ? engine.deviceLabel.slice(0, 22) + '…'
                  : engine.deviceLabel
                : 'Ativo'
              : 'Inativo'}
          </span>
        </div>
      </div>

      {/* ── Botão principal ────────────────────────────────── */}
      <div className="flex gap-3">
        <button
          onClick={handleStart}
          disabled={engine.isActive}
          className="flex-1 h-16 rounded-2xl bg-accent text-white text-lg font-bold
                     shadow-[0_12px_20px_rgba(15,107,95,0.3)] active:scale-95
                     disabled:opacity-40 disabled:cursor-not-allowed transition-transform"
        >
          🎧 Iniciar escuta
        </button>
        <button
          onClick={handleStop}
          disabled={!engine.isActive}
          className="h-16 px-5 rounded-2xl bg-[#f2e4d0] text-ink font-bold
                     active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-transform"
        >
          ■ Parar
        </button>
      </div>

      {error && (
        <div className="rounded-xl border-l-4 border-red-400 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Waveform ───────────────────────────────────────── */}
      <Waveform analyserNode={engine.analyserNode} />

      {/* ── Meter ──────────────────────────────────────────── */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted">
          <span>Nível de entrada</span>
          <span className="flex items-center gap-2">
            <span
              className={`font-bold transition-opacity ${engine.clipActive ? 'text-red-500 opacity-100' : 'opacity-0'}`}
            >
              CLIP
            </span>
            <span>{Math.round(engine.meterData.rmsDb)} dB</span>
          </span>
        </div>
        <div className="h-3 w-full rounded-full bg-border overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-75"
            style={{
              width: `${meterPct}%`,
              background: 'linear-gradient(90deg, #1d8a6f, #e0a03a, #e06a2f)',
            }}
          />
        </div>
      </div>

      {/* ── Aviso de microfonia ────────────────────────────── */}
      {engine.feedbackActive && (
        <div className="rounded-xl border-l-4 border-accent2 bg-[#fff0e3] px-3 py-2 text-sm text-[#7a2e14]">
          ⚠️ Possível realimentação (microfonia). Reduza o volume ou afaste o microfone.
        </div>
      )}

      {/* ── Card de controles ──────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-panel p-4 space-y-5
                      shadow-[0_8px_30px_rgba(31,27,22,0.08)]">

        {/* Volume */}
        <Slider
          label="🔊 Volume"
          value={settings.volume}
          min={-6} max={40} step={1}
          display={fmtDb(settings.volume)}
          onChange={(v) => set({ volume: v })}
        />

        {/* Enfase de fala */}
        <Slider
          label="🗣️ Clareza de fala"
          value={settings.speech}
          min={0} max={12} step={1}
          display={fmtDb(settings.speech)}
          onChange={(v) => set({ speech: v })}
        />

        {/* Toggles rápidos */}
        <div className="space-y-3">
          <Toggle
            id="rnnoise"
            label="🧠 Supressão neural de ruído"
            sublabel={
              <span className={`text-xs font-semibold ${RNNOISE_COLOR[engine.rnnoiseStatus]}`}>
                {RNNOISE_LABEL[engine.rnnoiseStatus]}
              </span>
            }
            checked={settings.rnnoiseEnabled}
            onChange={(v) => set({ rnnoiseEnabled: v })}
          />
          <Toggle
            id="noisegate"
            label="🔕 Gate de ruído"
            sublabel={<span className="text-xs text-muted">Abre apenas quando há fala</span>}
            checked={settings.noiseGate}
            onChange={(v) => set({ noiseGate: v })}
          />
        </div>

        {/* Presets */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide">Presets</p>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(allPresets).map(([id, p]) => (
              <button
                key={id}
                onClick={() => applyPreset(p)}
                className="px-3 py-1.5 rounded-full text-sm font-semibold
                           bg-[#f2e4d0] text-ink active:scale-95 transition-transform"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* Configurações avançadas */}
        <details
          open={showAdvanced}
          onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
          className="space-y-4"
        >
          <summary className="cursor-pointer text-sm font-bold text-accent list-none">
            {showAdvanced ? '▲' : '▼'} Configurações avançadas
          </summary>

          <div className="space-y-5 pt-2">

            {/* Dispositivos */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted uppercase tracking-wide">Dispositivos</p>
              <DeviceSelect
                label="Microfone"
                devices={engine.devices.inputs}
                value={settings.inputDeviceId ?? ''}
                disabled={engine.isActive}
                onChange={(v) => setSettings((s) => ({ ...s, inputDeviceId: v }))}
              />
              <DeviceSelect
                label="Saída de áudio"
                devices={engine.devices.outputs}
                value={settings.outputDeviceId ?? ''}
                disabled={engine.isActive}
                onChange={(v) => setSettings((s) => ({ ...s, outputDeviceId: v }))}
              />
              <button
                onClick={() => engine.refreshDevices().catch(() => {})}
                className="text-xs font-bold text-accent underline"
              >
                Atualizar lista de dispositivos
              </button>
              {engine.isActive && (
                <p className="text-xs text-muted italic">
                  Pare a escuta para trocar de dispositivo.
                </p>
              )}
            </div>

            {/* Corte de graves */}
            <Slider
              label="✂️ Corte de graves"
              value={settings.noiseCut}
              min={60} max={200} step={10}
              display={`${settings.noiseCut} Hz`}
              onChange={(v) => set({ noiseCut: v })}
            />

            {/* Gate threshold */}
            <div className="space-y-1">
              <Slider
                label="📊 Sensibilidade do gate"
                value={settings.gateThreshold}
                min={-70} max={-20} step={1}
                display={fmtDb(settings.gateThreshold)}
                onChange={(v) => set({ gateThreshold: v })}
              />
              <button
                onClick={handleCalibrate}
                className="mt-1 text-xs font-bold text-accent2 underline"
              >
                Calibrar ruído ambiente (1,5 s)
              </button>
            </div>

            {/* Toggles secundários */}
            <Toggle
              id="browser-noise"
              label="🌐 Redução de ruído do browser"
              sublabel={<span className="text-xs text-muted">Usa o processador nativo do sistema</span>}
              checked={settings.browserNoise}
              onChange={(v) => set({ browserNoise: v })}
              disabled={engine.isActive}
            />
            <Toggle
              id="low-latency"
              label="⚡ Priorizar baixa latência"
              checked={settings.lowLatency}
              onChange={(v) => {
                setSettings((s) => ({ ...s, lowLatency: v }));
                if (engine.isActive) alert('Pare e inicie novamente para aplicar.');
              }}
              disabled={engine.isActive}
            />

            {/* Salvar preset */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted uppercase tracking-wide">Salvar preset</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="Nome do preset"
                  className="flex-1 rounded-xl border border-border bg-bg1 px-3 py-2
                             text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <button
                  onClick={handleSavePreset}
                  className="px-4 rounded-xl bg-accent text-white text-sm font-bold"
                >
                  Salvar
                </button>
              </div>
            </div>

          </div>
        </details>

      </div>

      {/* ── Nota ───────────────────────────────────────────── */}
      <p className="text-xs text-muted text-center px-2 pb-4">
        Use fones de ouvido. Mantenha o volume moderado para evitar microfonia.
      </p>
    </div>
  );
}

// ────────────────────── sub-components ───────────────

function Slider({
  label, value, min, max, step, display, onChange,
}: {
  label: string; value: number; min: number; max: number;
  step: number; display: string; onChange(v: number): void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <label className="text-sm font-semibold">{label}</label>
        <span className="text-sm font-mono text-muted">{display}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 rounded-full cursor-pointer"
      />
    </div>
  );
}

function Toggle({
  id, label, sublabel, checked, onChange, disabled = false,
}: {
  id: string; label: string; sublabel?: React.ReactNode;
  checked: boolean; onChange(v: boolean): void; disabled?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex items-center justify-between gap-3 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
    >
      <div>
        <p className="text-sm font-semibold">{label}</p>
        {sublabel}
      </div>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors
                    focus-visible:ring-2 focus-visible:ring-accent
                    ${checked ? 'bg-accent' : 'bg-[#c3b49f]'}`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform
                      ${checked ? 'translate-x-6' : 'translate-x-1'}`}
        />
      </button>
    </label>
  );
}

function DeviceSelect({
  label, devices, value, onChange, disabled,
}: {
  label: string;
  devices: MediaDeviceInfo[];
  value: string;
  onChange(v: string): void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-muted">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || devices.length === 0}
        className="w-full rounded-xl border border-border bg-bg1 px-3 py-2
                   text-sm focus:outline-none focus:ring-2 focus:ring-accent
                   disabled:opacity-50"
      >
        <option value="">Padrão do sistema</option>
        {devices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
}
