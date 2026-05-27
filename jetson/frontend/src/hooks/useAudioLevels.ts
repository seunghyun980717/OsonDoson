import { useEffect, useMemo, useState } from 'react';

const FFT_SIZE = 1024; // frequencyBinCount = 512 (음성 대역 해상도 확보)
const SMOOTHING = 0.75;
// getByteFrequencyData는 dB 매핑 0-255. 일반 발화 피크가 ~180에서 풀-바
const NORMALIZER = 180;
// 사람 목소리 주력 대역만 잘라서 모든 bar에 분배 (고주파 빈 데드존 제거)
const VOICE_MIN_HZ = 80;
const VOICE_MAX_HZ = 3000;

export const useAudioLevels = (
  stream: MediaStream | null,
  barCount: number,
): number[] => {
  const [active, setActive] = useState<number[] | null>(null);
  const zeros = useMemo(
    () => new Array<number>(barCount).fill(0),
    [barCount],
  );

  useEffect(() => {
    if (!stream) return;

    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = SMOOTHING;
    source.connect(analyser);

    const bins = analyser.frequencyBinCount;
    const buffer = new Uint8Array(bins);
    const binHz = ctx.sampleRate / FFT_SIZE;
    const minBin = Math.max(1, Math.floor(VOICE_MIN_HZ / binHz));
    const maxBin = Math.min(bins - 1, Math.ceil(VOICE_MAX_HZ / binHz));
    const voiceBins = Math.max(1, maxBin - minBin + 1);
    const step = voiceBins / barCount;

    let rafId = 0;
    const tick = () => {
      analyser.getByteFrequencyData(buffer);
      const next = new Array<number>(barCount).fill(0);
      for (let i = 0; i < barCount; i++) {
        const start = minBin + Math.floor(i * step);
        const end = Math.max(start + 1, minBin + Math.floor((i + 1) * step));
        let sum = 0;
        let count = 0;
        for (let j = start; j < end && j <= maxBin; j++) {
          sum += buffer[j];
          count++;
        }
        const avg = count > 0 ? sum / count : 0;
        next[i] = Math.min(1, avg / NORMALIZER);
      }
      setActive(next);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      try {
        source.disconnect();
      } catch {
        /* noop */
      }
      try {
        analyser.disconnect();
      } catch {
        /* noop */
      }
      void ctx.close();
    };
  }, [stream, barCount]);

  // stream 끊긴 동안엔 0 baseline 노출 (이전 frame 값 잔상 방지)
  return stream && active && active.length === barCount ? active : zeros;
};
