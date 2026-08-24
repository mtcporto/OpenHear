# OpenHear

Aplicação web experimental para escuta assistida e diagnóstico de áudio em tempo real. O microfone é processado localmente com Web Audio, AudioWorklet e RNNoise/WASM; o áudio não é enviado a um servidor.

> O OpenHear não é um dispositivo médico, não mede nível de pressão sonora no ouvido e não substitui avaliação audiológica. Comece sempre com o volume do aparelho e do fone baixos.

## Modos de diagnóstico

Os modos permitem descobrir em qual etapa a qualidade se perde:

| Modo | Caminho de áudio | Uso principal |
|---|---|---|
| **A · RAW** | microfone → limiter de segurança → saída | referência do hardware e do roteamento |
| **B · GAIN** | RAW + ganho | testar amplificação sem DSP |
| **C · DSP** | ganho + filtros + EQ + compressor moderado | melhorar inteligibilidade |
| **D · FULL** | DSP + RNNoise e gate opcionais | testar redução adicional de ruído |

O limiter evita picos digitais, mas não garante um volume acusticamente seguro. RNNoise e gate começam desligados no preset de referência. O gate ganhou retenção e histerese, mas ainda deve permanecer desligado se cortar o início ou o fim das palavras.

## Pipeline

```text
microfone → medidor bruto ─┬→ RAW ───────────────────────────┐
                          ├→ ganho → GAIN ──────────────────┤
                          ├→ filtros → EQ → ganho → comp. → DSP ─┤
                          └→ RNNoise? → filtros → EQ → ganho → comp. → gate? → FULL
                                                                      │
                                      limiter → fade → analyser → saída
```

- O contexto solicita 48 kHz, formato esperado pelo RNNoise, e mostra a taxa realmente obtida.
- A saída padrão liga diretamente ao `AudioContext.destination`; `setSinkId` só é usado quando o usuário escolhe uma saída explícita.
- O painel de diagnóstico mostra canais, taxas, latências informadas pelo navegador, processamento nativo e rota de saída.
- A troca entre os quatro modos usa crossfade curto para reduzir estalos.

## Requisitos e execução

- Node.js 20.9 ou superior
- Navegador com `getUserMedia`, Web Audio, AudioWorklet e WebAssembly
- `https://` em celulares; `http://localhost` é aceito para desenvolvimento no próprio computador

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`. O `postinstall` copia o módulo ES e o WASM de `@jitsi/rnnoise-wasm` para `public/rnnoise/`.

Para verificar o projeto:

```bash
npm run check
```

O comando executa ESLint, TypeScript e o build de produção.

### Teste em um celular

Um endereço como `http://192.168.x.x:3000` normalmente **não** é contexto seguro para microfone. Use um deploy HTTPS ou um túnel HTTPS durante o desenvolvimento.

1. Conecte o fone antes de abrir o app.
2. Comece em **A · RAW**, com volume baixo.
3. Compare o microfone interno com o microfone do fone.
4. Compare Bluetooth com um fone com fio ou USB-C, se possível.
5. Avance para GAIN, DSP e FULL, uma etapa por vez.

Ao usar simultaneamente o microfone e a saída de um headset Bluetooth, muitos celulares mudam de A2DP para o perfil de chamada HFP/HSP. Esse perfil tem menor largura de banda e pode soar abafado ou metálico; nesse caso, a limitação é do conjunto telefone/Bluetooth, não necessariamente do DSP.

## Estrutura

```text
src/
  app/                  rota, layout e estilos
  components/           interface e visualizador
  hooks/                ciclo de vida React do motor
  lib/AudioEngine.ts    grafo, dispositivos e diagnóstico
  lib/presets.ts        presets e migração do localStorage
public/
  worklets/             medidor/gate e RNNoise
  rnnoise/              glue ES module e WASM
scripts/setup-rnnoise.js
```

A implementação antiga em HTML/JS na raiz foi removida. `src/` é agora a única aplicação executável, e artefatos `.next/` não ficam versionados.

## Deploy

Qualquer hospedagem compatível com Next.js e HTTPS funciona. Na Vercel, por exemplo:

```bash
npx vercel
```

## Licença

MIT
