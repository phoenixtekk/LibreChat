import { useEffect, useRef } from 'react';
import { useRecoilValue } from 'recoil';
import store from '~/store';

/**
 * On-screen "voice light" — a glowing ring (ACEMAGIC-ring inspired) that activates and
 * pulses whenever the assistant is speaking via TTS, and fades out when it stops.
 *
 * v1 drives the animation from the global TTS playing state (safe — never touches the
 * audio pipeline, works for every TTS backend). A future v2 can tap the global audio
 * element (id=globalAudioId) with a Web Audio AnalyserNode for true amplitude sync.
 */
export default function VoiceVisualizer() {
  // Main conversation's global TTS playback state (StreamAudio uses index 0).
  const isPlaying = useRecoilValue(store.globalAudioPlayingFamily(0));
  const ringRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const ring = ringRef.current;
    if (ring == null) {
      return;
    }
    if (!isPlaying) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      ring.style.opacity = '0';
      ring.style.transform = 'scale(0.85)';
      return;
    }

    ring.style.opacity = '1';
    // Lively, slightly layered pulse so it reads as "talking", not a metronome.
    let t = 0;
    const loop = () => {
      t += 0.09;
      const level = 0.5 + 0.28 * Math.sin(t) + 0.14 * Math.sin(t * 2.7 + 1.3);
      const clamped = Math.max(0, Math.min(1, level));
      const scale = (0.9 + clamped * 0.45).toFixed(3);
      const glow = (10 + clamped * 26).toFixed(0);
      const glowOpacity = (0.4 + clamped * 0.5).toFixed(2);
      ring.style.transform = `scale(${scale})`;
      ring.style.filter = `drop-shadow(0 0 ${glow}px rgba(56,210,239,${glowOpacity}))`;
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying]);

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        right: 24,
        bottom: 24,
        zIndex: 60,
        pointerEvents: 'none',
      }}
    >
      <div
        ref={ringRef}
        style={{
          opacity: 0,
          transform: 'scale(0.85)',
          transition: 'opacity .35s ease, transform .07s linear',
          willChange: 'transform, opacity, filter',
        }}
      >
        <svg width="72" height="72" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="atk-vv-grad" x1="0" y1="0" x2="72" y2="72" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#38d2ef" />
              <stop offset="0.5" stopColor="#6a32c0" />
              <stop offset="1" stopColor="#18a8da" />
            </linearGradient>
          </defs>
          {/* outer arc ring */}
          <circle cx="36" cy="36" r="30" stroke="url(#atk-vv-grad)" strokeWidth="3" strokeLinecap="round"
            strokeDasharray="150 38" opacity="0.9" />
          {/* inner arc ring (counter) */}
          <circle cx="36" cy="36" r="22" stroke="url(#atk-vv-grad)" strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray="90 48" opacity="0.75" />
          {/* glowing core */}
          <circle cx="36" cy="36" r="9" fill="url(#atk-vv-grad)" opacity="0.95" />
        </svg>
      </div>
    </div>
  );
}
