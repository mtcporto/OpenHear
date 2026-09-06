'use client';

import { useCallback, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useAudioEngine } from '@/hooks/useAudioEngine';
import { BUILT_IN_PRESETS, loadCustomPresets, saveCustomPreset, type Preset } from '@/lib/presets';
import { type AudioDiagnostics, type EngineSettings } from '@/lib/AudioEngine';

const DEFAULT_SETTINGS: EngineSettings = { ...BUILT_IN_PRESETS.fala, inputDeviceId: '', outputDeviceId: '' };
const LISTENING_PROFILES = [
  { id: 'balanced', presetId: 'default', title: 'Equilibrado', description: 'Som natural para o dia a dia', icon: '◒' },
  { id: 'speech', presetId: 'fala', title: 'Conversas', description: 'Ajuda a destacar as vozes', icon: '••' },
  { id: 'quiet', presetId: 'ruido', title: 'Lugar barulhento', description: 'Reduz distrações ao redor', icon: '≋' },
  { id: 'music', presetId: 'musica', title: 'Música', description: 'Preserva sons mais naturais', icon: '♫' },
] as const;
const STATUS_LABEL = { idle: 'Pronto para começar', starting: 'Preparando o áudio…', running: 'Você está ouvindo', degraded: 'Ouvindo com uma redução', suspended: 'Áudio pausado', error: 'Não foi possível iniciar' };

export default function AudioApp() {
  const engine = useAudioEngine();
  const { isActive, start: startEngine, updateSettings: updateEngineSettings, calibrateGate } = engine;
  const [settings, setSettings] = useState<EngineSettings>(DEFAULT_SETTINGS);
  const [selectedProfile, setSelectedProfile] = useState('speech');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [customPresets, setCustomPresets] = useState<Record<string, Preset>>({});
  const [notice, setNotice] = useState('');
  const allPresets = useMemo(() => ({ ...BUILT_IN_PRESETS, ...customPresets }), [customPresets]);

  useEffect(() => {
    const timer = window.setTimeout(() => setCustomPresets(loadCustomPresets()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const updateSetting = useCallback((patch: Partial<EngineSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    if (isActive) updateEngineSettings(patch);
  }, [isActive, updateEngineSettings]);

  const applyPreset = useCallback((preset: Preset, profileId?: string) => {
    const next = { ...preset, inputDeviceId: settings.inputDeviceId, outputDeviceId: settings.outputDeviceId };
    setSettings(next);
    if (profileId) setSelectedProfile(profileId);
    if (isActive) updateEngineSettings(next);
    setNotice(`Modo “${preset.name}” selecionado.`);
  }, [isActive, settings.inputDeviceId, settings.outputDeviceId, updateEngineSettings]);

  const handleStart = useCallback(async () => {
    setNotice('');
    try { await startEngine(settings); } catch { /* O hook já mostra o erro. */ }
  }, [settings, startEngine]);

  const handleVolume = useCallback((value: number) => updateSetting({ volume: Math.min(18, Math.max(-6, value)) }), [updateSetting]);

  const handleCalibrate = useCallback(async () => {
    if (!isActive) { setNotice('Comece a escuta antes de ajustar o som do ambiente.'); return; }
    setNotice('Fique em silêncio por um instante…');
    const threshold = await calibrateGate();
    if (threshold !== null) { updateSetting({ gateThreshold: threshold, noiseGate: true }); setNotice('O som do ambiente foi ajustado.'); }
  }, [calibrateGate, isActive, updateSetting]);

  const handleSavePreset = useCallback(() => {
    const name = presetName.trim();
    if (!name) { setNotice('Dê um nome para guardar este ajuste.'); return; }
    saveCustomPreset(`custom_${Date.now()}`, { ...settings, name });
    setCustomPresets(loadCustomPresets());
    setPresetName('');
    setNotice(`“${name}” foi guardado neste dispositivo.`);
  }, [presetName, settings]);

  const volumePercent = Math.round(((settings.volume + 6) / 24) * 100);
  const controlsLocked = engine.isStarting;
  const statusTone = engine.isActive ? 'active' : engine.isStarting ? 'starting' : 'idle';

  return (
    <div className="w-full max-w-2xl space-y-5 pb-8">
      <header className="flex items-center justify-between gap-4 px-1">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-xl font-bold text-white shadow-[0_8px_18px_rgba(15,107,95,0.24)]" aria-hidden="true">O</div>
          <div><h1 className="text-xl font-bold tracking-tight">OpenHear</h1><p className="text-sm text-muted">Escuta assistida</p></div>
        </div>
        <div className={`flex items-center gap-2 rounded-full px-3 py-2 text-xs font-bold ${statusTone === 'active' ? 'bg-[#e4f2ed] text-accent' : statusTone === 'starting' ? 'bg-[#fff0e3] text-[#7a4a14]' : 'bg-[#f2e4d0] text-muted'}`}>
          <span className={`h-2.5 w-2.5 rounded-full ${statusTone === 'active' ? 'bg-accent' : statusTone === 'starting' ? 'animate-pulse bg-accent2' : 'bg-[#b99d78]'}`} />
          {engine.isActive ? 'Ativo' : engine.isStarting ? 'Aguarde' : 'Parado'}
        </div>
      </header>

      <section className="overflow-hidden rounded-[2rem] bg-accent px-5 py-6 text-white shadow-[0_16px_35px_rgba(15,107,95,0.22)] sm:px-8 sm:py-8">
        <div className="max-w-lg"><p className="mb-2 text-sm font-semibold text-[#c8eee3]">{STATUS_LABEL[engine.sessionState]}</p><h2 className="text-3xl font-bold leading-tight sm:text-4xl">Ouça o que importa para você.</h2><p className="mt-3 max-w-md text-sm leading-relaxed text-[#d9f1eb]">Coloque os fones, escolha um modo e ajuste o volume até ficar confortável.</p></div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={() => void handleStart()} disabled={engine.isActive || engine.isStarting} className="h-16 flex-1 rounded-2xl bg-white px-5 text-lg font-bold text-accent shadow-[0_8px_16px_rgba(0,0,0,0.12)] transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55">{engine.isStarting ? 'Preparando…' : 'Começar a ouvir'}</button>
          <button type="button" onClick={() => void engine.stop()} disabled={!engine.isActive} className="h-16 rounded-2xl border border-white/30 bg-white/10 px-6 font-bold text-white transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-45">Parar</button>
        </div>
      </section>

      {engine.sessionState === 'suspended' && <button type="button" onClick={() => void engine.resume()} className="w-full rounded-2xl border-2 border-accent bg-panel px-4 py-4 text-sm font-bold text-accent">Retomar escuta</button>}
      {engine.error && <Message tone="error">{engine.error}</Message>}
      {engine.warning && <Message tone="warning">{engine.warning}</Message>}
      {notice && <Message tone="info">{notice}</Message>}

      <section className="rounded-[1.75rem] border border-border bg-panel p-5 shadow-[0_8px_30px_rgba(31,27,22,0.07)] sm:p-6" aria-labelledby="profile-title">
        <div className="mb-4"><h2 id="profile-title" className="text-lg font-bold">Como você quer ouvir?</h2><p className="mt-1 text-sm text-muted">Você pode mudar a qualquer momento.</p></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {LISTENING_PROFILES.map((profile) => { const selected = selectedProfile === profile.id; return <button key={profile.id} type="button" aria-pressed={selected} disabled={controlsLocked} onClick={() => applyPreset(allPresets[profile.presetId], profile.id)} className={`min-h-[116px] rounded-2xl border p-3 text-left transition-all disabled:opacity-50 ${selected ? 'border-accent bg-[#e4f2ed] shadow-[inset_0_0_0_1px_#0f6b5f]' : 'border-border bg-bg1 hover:border-[#b99d78]'}`}><span className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl text-lg font-bold ${selected ? 'bg-accent text-white' : 'bg-[#f2e4d0] text-accent'}`} aria-hidden="true">{profile.icon}</span><span className="block text-sm font-bold">{profile.title}</span><span className="mt-1 block text-xs leading-snug text-muted">{profile.description}</span></button>; })}
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-border bg-panel p-5 shadow-[0_8px_30px_rgba(31,27,22,0.07)] sm:p-6" aria-labelledby="volume-title">
        <div className="flex items-center justify-between gap-4"><div><h2 id="volume-title" className="text-lg font-bold">Volume da escuta</h2><p className="mt-1 text-sm text-muted">Comece baixo e aumente devagar.</p></div><span className="rounded-xl bg-[#f2e4d0] px-3 py-2 text-lg font-bold text-accent">{settings.volume <= 0 ? 'Baixo' : settings.volume < 9 ? 'Médio' : 'Alto'}</span></div>
        <div className="mt-5 flex items-center gap-3"><button type="button" aria-label="Diminuir volume" disabled={controlsLocked} onClick={() => handleVolume(settings.volume - 1)} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-bg1 text-2xl font-medium text-accent disabled:opacity-45">−</button><div className="relative flex-1"><div className="pointer-events-none absolute inset-y-0 left-0 w-full rounded-full bg-border" /><div className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${volumePercent}%` }} /><input aria-label="Volume da escuta" type="range" min={-6} max={18} step={1} value={settings.volume} disabled={controlsLocked} onChange={(event) => handleVolume(Number(event.target.value))} className="relative h-3 w-full cursor-pointer appearance-none bg-transparent accent-accent disabled:cursor-not-allowed disabled:opacity-45" /></div><button type="button" aria-label="Aumentar volume" disabled={controlsLocked} onClick={() => handleVolume(settings.volume + 1)} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-bg1 text-2xl font-medium text-accent disabled:opacity-45">+</button></div>
      </section>

      <details open={showAdvanced} onToggle={(event) => setShowAdvanced(event.currentTarget.open)} className="rounded-[1.75rem] border border-border bg-panel shadow-[0_8px_30px_rgba(31,27,22,0.05)]"><summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-bold sm:px-6"><span>Mais opções</span><span className="text-xl font-normal text-accent" aria-hidden="true">{showAdvanced ? '−' : '+'}</span></summary><div className="space-y-5 border-t border-border px-5 py-5 sm:px-6"><p className="text-sm leading-relaxed text-muted">Estas opções são úteis para quem está ajudando a configurar o aparelho.</p><AdvancedSettings settings={settings} setSettings={setSettings} engine={engine} updateSetting={updateSetting} calibrate={handleCalibrate} controlsLocked={controlsLocked} allPresets={allPresets} applyPreset={applyPreset} presetName={presetName} setPresetName={setPresetName} savePreset={handleSavePreset} /></div></details>
      <p className="px-3 text-center text-xs leading-relaxed text-muted">Use fones confortáveis e mantenha o volume baixo. O OpenHear é experimental e não substitui uma avaliação audiológica.</p>
    </div>
  );
}

type AdvancedProps = { settings: EngineSettings; setSettings: Dispatch<SetStateAction<EngineSettings>>; engine: ReturnType<typeof useAudioEngine>; updateSetting(patch: Partial<EngineSettings>): void; calibrate(): Promise<void>; controlsLocked: boolean; allPresets: Record<string, Preset>; applyPreset(preset: Preset, profileId?: string): void; presetName: string; setPresetName(value: string): void; savePreset(): void };

function AdvancedSettings({ settings, setSettings, engine, updateSetting, calibrate, controlsLocked, allPresets, applyPreset, presetName, setPresetName, savePreset }: AdvancedProps) {
  const dspAvailable = settings.processingMode === 'dsp' || settings.processingMode === 'full';
  const fullAvailable = settings.processingMode === 'full';
  return <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2"><DeviceSelect id="input-device" label="Microfone" devices={engine.devices.inputs} value={settings.inputDeviceId ?? ''} disabled={engine.isActive || controlsLocked} onChange={(value) => setSettings((current) => ({ ...current, inputDeviceId: value }))} /><DeviceSelect id="output-device" label="Fone ou saída" devices={engine.devices.outputs} value={settings.outputDeviceId ?? ''} disabled={engine.isActive || controlsLocked} onChange={(value) => setSettings((current) => ({ ...current, outputDeviceId: value }))} /></div><button type="button" disabled={engine.isActive || controlsLocked} onClick={() => void engine.refreshDevices(true)} className="text-xs font-bold text-accent underline disabled:opacity-45">Autorizar e atualizar dispositivos</button><Slider id="speech" label="Clareza das vozes" value={settings.speech} min={0} max={9} step={1} display={`${settings.speech}/9`} disabled={!dspAvailable || controlsLocked} onChange={(value) => updateSetting({ speech: value })} /><Slider id="noise-cut" label="Redução de sons graves" value={settings.noiseCut} min={60} max={200} step={10} display={`${settings.noiseCut}`} disabled={!dspAvailable || controlsLocked} onChange={(value) => updateSetting({ noiseCut: value })} /><div className="space-y-3"><Toggle id="rnnoise" label="Reduzir ruído do ambiente" sublabel={<span className="text-xs text-muted">Pode ajudar em lugares movimentados</span>} checked={settings.rnnoiseEnabled} disabled={!fullAvailable || controlsLocked || engine.rnnoiseStatus === 'error'} onChange={(value) => updateSetting({ rnnoiseEnabled: value })} /><Toggle id="noise-gate" label="Silenciar pausas do ambiente" sublabel={<span className="text-xs text-muted">Desligue se o começo das palavras for cortado</span>} checked={settings.noiseGate} disabled={!fullAvailable || controlsLocked} onChange={(value) => updateSetting({ noiseGate: value })} /></div><div className="flex flex-wrap gap-2">{Object.entries(allPresets).map(([id, preset]) => <button key={id} type="button" disabled={engine.isActive || controlsLocked} onClick={() => applyPreset(preset)} className="rounded-full bg-[#f2e4d0] px-3 py-2 text-xs font-semibold text-ink disabled:opacity-45">{preset.name}</button>)}</div><button type="button" disabled={!fullAvailable || controlsLocked} onClick={() => void calibrate()} className="text-xs font-bold text-accent2 underline disabled:opacity-45">Ajustar ao som do ambiente</button><Toggle id="browser-noise" label="Ajustes automáticos do aparelho" sublabel={<span className="text-xs text-muted">Pode exigir reiniciar a escuta</span>} checked={settings.browserNoise} disabled={engine.isActive || controlsLocked} onChange={(value) => setSettings((current) => ({ ...current, browserNoise: value }))} /><Toggle id="low-latency" label="Resposta mais rápida" sublabel={<span className="text-xs text-muted">Pode variar entre aparelhos</span>} checked={settings.lowLatency} disabled={engine.isActive || controlsLocked} onChange={(value) => setSettings((current) => ({ ...current, lowLatency: value }))} />{engine.diagnostics ? <Diagnostics diagnostics={engine.diagnostics} /> : <p className="rounded-xl bg-bg1 p-3 text-xs text-muted">As informações da sessão aparecem aqui depois de começar a ouvir.</p>}<div className="flex gap-2"><input id="preset-name" type="text" maxLength={60} value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Nome do ajuste" className="min-w-0 flex-1 rounded-xl border border-border bg-bg1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" /><button type="button" onClick={savePreset} className="rounded-xl bg-accent px-4 text-sm font-bold text-white">Guardar</button></div></div>;
}

function Message({ tone, children }: { tone: 'error' | 'warning' | 'info'; children: ReactNode }) { const styles = { error: 'border-red-500 bg-red-50 text-red-800', warning: 'border-accent2 bg-[#fff0e3] text-[#7a2e14]', info: 'border-accent bg-[#e4f2ed] text-[#184c43]' }; return <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border-l-4 px-4 py-3 text-sm ${styles[tone]}`}>{children}</div>; }
function Slider({ id, label, value, min, max, step, display, disabled, onChange }: { id: string; label: string; value: number; min: number; max: number; step: number; display: string; disabled?: boolean; onChange(value: number): void }) { return <div className="space-y-2"><div className="flex items-center justify-between gap-3"><label htmlFor={id} className="text-sm font-semibold">{label}</label><span className="text-sm text-muted">{display}</span></div><input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} className="h-2 w-full cursor-pointer rounded-full disabled:opacity-45" /></div>; }
function Toggle({ id, label, sublabel, checked, onChange, disabled = false }: { id: string; label: string; sublabel?: ReactNode; checked: boolean; onChange(value: boolean): void; disabled?: boolean }) { return <div className="flex items-center justify-between gap-4"><div><p id={`${id}-label`} className="text-sm font-semibold">{label}</p>{sublabel}</div><button id={id} type="button" role="switch" aria-labelledby={`${id}-label`} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-45 ${checked ? 'bg-accent' : 'bg-[#c3b49f]'}`}><span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} /></button></div>; }
function DeviceSelect({ id, label, devices, value, onChange, disabled }: { id: string; label: string; devices: MediaDeviceInfo[]; value: string; onChange(value: string): void; disabled: boolean }) { return <div className="space-y-1"><label htmlFor={id} className="text-xs font-semibold text-muted">{label}</label><select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="w-full rounded-xl border border-border bg-bg1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"><option value="">Padrão do sistema</option>{devices.map((device, index) => <option key={device.deviceId || `${device.kind}-${index}`} value={device.deviceId}>{device.label || `${label} ${index + 1}`}</option>)}</select></div>; }
function Diagnostics({ diagnostics }: { diagnostics: AudioDiagnostics }) { const outputRoute = { 'system-default': 'saída padrão', 'audio-context': 'saída selecionada', 'media-element': 'saída selecionada', fallback: 'saída padrão' }[diagnostics.outputRoute]; const rows = [['Modo', diagnostics.processingMode.toUpperCase()], ['Entrada', diagnostics.inputSampleRate ? `${diagnostics.inputSampleRate} · ${diagnostics.inputChannelCount ?? '?'} canal(is)` : 'não informado'], ['Latência', diagnostics.inputLatencyMs === null ? 'não informada' : `${diagnostics.inputLatencyMs.toFixed(1)} ms`], ['Saída', outputRoute]]; return <div className="space-y-2 rounded-xl bg-bg1 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted">Informações da sessão</p><dl className="space-y-1.5 text-xs">{rows.map(([label, value]) => <div key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-3"><dt className="text-muted">{label}</dt><dd className="text-right font-semibold">{value}</dd></div>)}</dl></div>; }
