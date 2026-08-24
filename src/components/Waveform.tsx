'use client';

import { useEffect, useRef } from 'react';

interface WaveformProps {
  analyserNode: AnalyserNode | null;
}

export default function Waveform({ analyserNode }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number | null>(null);

  // Dimensiona o canvas conforme o container
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.floor(e.contentRect.width * pixelRatio));
        canvas.height = Math.max(1, Math.floor(e.contentRect.height * pixelRatio));
        canvas.getContext('2d')?.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Loop de desenho
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!analyserNode) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      ctx.fillStyle = '#efe0c9';
      const pixelRatio = window.devicePixelRatio || 1;
      ctx.fillRect(0, 0, canvas.width / pixelRatio, canvas.height / pixelRatio);
      return;
    }

    const data = new Uint8Array(analyserNode.fftSize);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      analyserNode.getByteTimeDomainData(data);

      const pixelRatio = window.devicePixelRatio || 1;
      const w = canvas.width / pixelRatio || 1;
      const h = canvas.height / pixelRatio || 1;
      ctx.fillStyle = '#efe0c9';
      ctx.fillRect(0, 0, w, h);

      const barCount = 64;
      const step = Math.floor(data.length / barCount);
      const mid  = h / 2;
      const barW = w / barCount;
      ctx.fillStyle = '#0f6b5f';

      for (let i = 0; i < barCount; i++) {
        let peak = 0;
        for (let j = 0; j < step; j++) {
          const v = Math.abs((data[i * step + j] - 128) / 128);
          if (v > peak) peak = v;
        }
        const barH = Math.max(2, peak * h * 0.95);
        ctx.fillRect(i * barW + barW * 0.15, mid - barH / 2, barW * 0.7, barH);
      }
    };

    draw();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [analyserNode]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Forma de onda do áudio processado em tempo real"
      className="w-full h-28 rounded-xl"
      style={{ background: '#efe0c9' }}
    />
  );
}
