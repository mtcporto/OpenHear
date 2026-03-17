# OpenHear

Amplificador auditivo pessoal que roda inteiramente no navegador do smartphone. Conecte um headset comum, abra o app, e o microfone do fone captura o ambiente enquanto o processamento de áudio com IA entrega o som tratado diretamente no seu ouvido — funcionando de forma semelhante a um aparelho auditivo, mas sem hardware dedicado.

---

## Como funciona

```
Microfone (headset)
       │
       ▼
  RNNoise WASM          ← supressão de ruído neural
       │
       ▼
  Highpass Filter       ← corte de graves (ruído de baixa frequência)
       │
       ▼
  Lowpass Filter        ← corte de agudos excessivos
       │
       ▼
  Peaking EQ (3 kHz)    ← ênfase de fala para maior clareza
       │
       ▼
  Gain                  ← volume geral ajustável
       │
       ▼
  DynamicsCompressor    ← compressão suave para proteger o ouvido
       │
       ▼
  Noise Gate            ← abre apenas quando há fala, fecha no silêncio
       │
       ▼
  Saída (headset)
```

Todo o processamento acontece **localmente no dispositivo**, sem enviar áudio para nenhum servidor.

---

## Funcionalidades

- **Supressão neural de ruído (RNNoise)** — modelo de deep learning compilado em WebAssembly, mesmo algoritmo usado como base para ferramentas como Krisp
- **Gate de ruído calibrável** — mede o ruído ambiente e ajusta o limiar automaticamente
- **EQ de fala** — ênfase na faixa 2–4 kHz onde a inteligibilidade da fala é maior
- **Seleção de dispositivo** — detecta headsets automaticamente e roteia entrada e saída para o mesmo hardware
- **Presets** — perfis pré-definidos (Padrão, Fala clara, Ambiente ruidoso, Música) e suporte a presets personalizados salvos localmente
- **Waveform em tempo real** — visualizador de forma de onda e medidor de nível (dB)
- **PWA-ready** — manifest configurado para instalação como app no Android
- **Mobile-first** — interface projetada para uso com uma mão no smartphone

---

## Tecnologias

### Framework e linguagem

| Tecnologia | Uso |
|---|---|
| [Next.js 15](https://nextjs.org/) | Framework React com App Router, build otimizado, deploy Vercel nativo |
| [React 19](https://react.dev/) | Interface declarativa com hooks para estado de áudio em tempo real |
| [TypeScript 5](https://www.typescriptlang.org/) | Tipagem estática em todo o código da aplicação |
| [Tailwind CSS 3](https://tailwindcss.com/) | Estilos utilitários, mobile-first |

### Áudio e processamento

| Tecnologia | Uso |
|---|---|
| **Web Audio API** | Grafo de nós de áudio (filtros, gain, compressor, analyser) |
| **AudioWorklet** | Processamento de áudio em thread dedicada com latência mínima |
| **WebRTC `getUserMedia`** | Captura do microfone com controle de dispositivo, eco e ruído |
| **RNNoise** ([@jitsi/rnnoise-wasm](https://github.com/jitsi/rnnoise-wasm)) | Modelo RNN de supressão de ruído compilado em WASM — roda offline no browser |
| **WebAssembly** | Executa o modelo RNNoise em velocidade nativa dentro do AudioWorklet |
| **`setSinkId` API** | Roteamento da saída de áudio para o headset correto |

### Deploy e infraestrutura

| Tecnologia | Uso |
|---|---|
| [Vercel](https://vercel.com/) | Deploy com zero configuração — `vercel` na raiz do projeto |
| **HTTPS automático** | Obrigatório para `getUserMedia` em dispositivos móveis |

---

## Estrutura do projeto

```
OpenHear/
├── src/
│   ├── app/
│   │   ├── layout.tsx        # layout raiz, metadados, PWA
│   │   ├── page.tsx          # rota /
│   │   └── globals.css       # Tailwind base + customizações
│   ├── components/
│   │   ├── AudioApp.tsx      # componente principal — UI completa
│   │   └── Waveform.tsx      # canvas animado com Web Audio AnalyserNode
│   ├── hooks/
│   │   └── useAudioEngine.ts # hook React que gerencia o ciclo de vida do engine
│   └── lib/
│       ├── AudioEngine.ts    # motor de áudio — grafo, worklets, dispositivos
│       └── presets.ts        # definição e persistência de presets (localStorage)
│
├── public/
│   ├── worklets/
│   │   ├── gate-meter-processor.js   # AudioWorklet: gate + medidor RMS
│   │   └── rnnoise-processor.js      # AudioWorklet: supressão RNNoise WASM
│   ├── rnnoise/
│   │   ├── rnnoise.js        # Emscripten glue (patchado para importScripts)
│   │   └── rnnoise.wasm      # modelo binário compilado
│   └── manifest.json         # PWA manifest
│
├── scripts/
│   └── setup-rnnoise.js      # copia e patcha @jitsi/rnnoise-wasm → public/rnnoise/
│
├── next.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

---

## Rodando localmente

```bash
npm install        # instala dependências e copia automaticamente os arquivos RNNoise
npx next dev       # inicia em http://localhost:3000
```

> O `postinstall` roda `scripts/setup-rnnoise.js` automaticamente — não é necessário nenhum passo manual para o RNNoise.

**Requisito:** a página precisa ser servida via `http://localhost` ou `https://` para que `getUserMedia` e `AudioWorklet` funcionem. Não abre direto como `file://`.

---

## Deploy na Vercel

```bash
npx vercel
```

O Next.js é suportado nativamente. O HTTPS é provisionado automaticamente, o que é obrigatório para captura de microfone em browsers mobile.

Para acessar do Android durante desenvolvimento local, use o endereço de rede exibido pelo `next dev` (ex: `http://192.168.x.x:3000`) na mesma rede Wi-Fi — o Chrome permite `getUserMedia` em IPs locais sem HTTPS.

---

## Como usar no smartphone

1. Acesse o endereço do app no Chrome para Android
2. Conecte o headset USB ou Bluetooth **antes** de abrir o app
3. Toque em **Iniciar escuta**
4. O app detecta e seleciona automaticamente o headset como entrada e saída
5. Ajuste o **Volume** e a **Clareza de fala** conforme necessário
6. Para ambientes ruidosos, ative o **Gate de ruído** e use **Calibrar ruído ambiente**

---

## Licença

MIT
