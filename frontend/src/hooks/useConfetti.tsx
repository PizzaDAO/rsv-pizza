import React, { useState, useCallback, useRef } from 'react';

interface ConfettiPiece {
  id: number;
  img: string;
  x: number;
  y: number;
  angle: number;
  distance: number;
  size: number;
  rotation: number;
}

let nextBurstId = 0;

export function useConfetti() {
  const [bursts, setBursts] = useState<{ id: number; pieces: ConfettiPiece[] }[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const fire = useCallback((originX: number, originY: number) => {
    const burstId = nextBurstId++;
    const pieces = Array.from({ length: 30 }, (_, i) => {
      const img = Math.random() < 0.6
        ? `/gpp-confetti-${Math.random() < 0.5 ? '1' : '4'}.png`
        : `/gpp-confetti-${[2, 3, 5, 6, 7][Math.floor(Math.random() * 5)]}.png`;
      return {
        id: i,
        img,
        x: originX,
        y: originY,
        angle: Math.random() * 360,
        distance: 100 + Math.random() * 200,
        size: 7 + Math.random() * 10,
        rotation: Math.random() * 720 - 360,
      };
    });
    setBursts(prev => [...prev, { id: burstId, pieces }]);
    const timer = setTimeout(() => {
      setBursts(prev => prev.filter(b => b.id !== burstId));
      timersRef.current.delete(burstId);
    }, 3000);
    timersRef.current.set(burstId, timer);
  }, []);

  const fireFromElement = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    fire(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [fire]);

  const fireFromCenter = useCallback(() => {
    fire(window.innerWidth / 2, window.innerHeight / 2);
  }, [fire]);

  const ConfettiOverlay = bursts.length > 0 ? (
    <div className="fixed inset-0 pointer-events-none z-[100]">
      {bursts.flatMap(burst =>
        burst.pieces.map((p) => (
          <img
            key={`${burst.id}-${p.id}`}
            src={p.img}
            alt=""
            className="absolute"
            style={{
              left: p.x,
              top: p.y,
              width: p.size,
              height: p.size,
              objectFit: 'contain',
              animation: 'confetti-fly 2.5s ease-out forwards',
              '--confetti-tx': `${Math.cos(p.angle * Math.PI / 180) * p.distance}px`,
              '--confetti-ty': `${Math.sin(p.angle * Math.PI / 180) * p.distance}px`,
              '--confetti-rot': `${p.rotation}deg`,
            } as React.CSSProperties}
          />
        ))
      )}
    </div>
  ) : null;

  return { fire, fireFromElement, fireFromCenter, ConfettiOverlay };
}
