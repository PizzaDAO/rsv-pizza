import React, { useState, useCallback } from 'react';

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

export function useConfetti() {
  const [pieces, setPieces] = useState<ConfettiPiece[]>([]);

  const fire = useCallback((originX: number, originY: number) => {
    const newPieces = Array.from({ length: 45 }, (_, i) => {
      const img = Math.random() < 0.6
        ? `/gpp-confetti-${Math.random() < 0.5 ? '1' : '4'}.png`
        : `/gpp-confetti-${[2, 3, 5, 6, 7][Math.floor(Math.random() * 5)]}.png`;
      return {
        id: i,
        img,
        x: originX,
        y: originY,
        angle: Math.random() * 360,
        distance: 150 + Math.random() * 300,
        size: 10 + Math.random() * 15,
        rotation: Math.random() * 720 - 360,
      };
    });
    setPieces(newPieces);
    setTimeout(() => setPieces([]), 3000);
  }, []);

  const fireFromElement = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    fire(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [fire]);

  const fireFromCenter = useCallback(() => {
    fire(window.innerWidth / 2, window.innerHeight / 2);
  }, [fire]);

  const ConfettiOverlay = pieces.length > 0 ? (
    <div className="fixed inset-0 pointer-events-none z-[100]">
      {pieces.map((p) => (
        <img
          key={p.id}
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
      ))}
    </div>
  ) : null;

  return { fire, fireFromElement, fireFromCenter, ConfettiOverlay };
}
