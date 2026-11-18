"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "cn";

interface RollingScoreProps {
  value: number;
  className?: string;
  showDelta?: boolean;
}

export function RollingScore({
  value,
  className,
  showDelta = true,
}: RollingScoreProps) {
  const [displayValue, setDisplayValue] = useState<number>(value);
  const [delta, setDelta] = useState<number | null>(null);
  const [isRolling, setIsRolling] = useState(false);
  const [direction, setDirection] = useState<"up" | "down" | null>(null);

  const prevValueRef = useRef<number>(value);
  const isFirstMountRef = useRef<boolean>(true);
  const animFrameRef = useRef<number | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Skip animation on initial page load / refresh
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      prevValueRef.current = value;
      setDisplayValue(value);
      return;
    }

    const prev = prevValueRef.current;
    if (prev === value) return;

    const diff = value - prev;
    prevValueRef.current = value;

    if (showDelta) {
      setDelta(diff);
    }
    setDirection(diff > 0 ? "up" : "down");
    setIsRolling(true);

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    const duration = 1600; // 1.6s roulette-inspired deceleration
    const startTime = performance.now();
    const startVal = prev;
    const endVal = value;

    // Casino roulette-style exponential deceleration curve
    const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const eased = easeOutExpo(progress);

      const current = startVal + (endVal - startVal) * eased;
      setDisplayValue(Math.round(current));

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(step);
      } else {
        // Firmly clamp to exact backend value
        setDisplayValue(endVal);
        timeoutRef.current = setTimeout(() => {
          setIsRolling(false);
          setDelta(null);
          setDirection(null);
        }, 2200);
      }
    };

    animFrameRef.current = requestAnimationFrame(step);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, showDelta]);

  return (
    <div className="relative inline-flex flex-col items-center justify-center">
      {/* Floating Delta Badge (+/- Score) */}
      {delta !== null && delta !== 0 && (
        <div
          className={cn(
            "absolute -top-7 sm:-top-8 left-1/2 -translate-x-1/2 pointer-events-none px-2 py-0.5 rounded-full text-[11px] sm:text-xs font-black font-mono shadow-xl border z-30 animate-float-delta flex items-center gap-1 backdrop-blur-md",
            delta > 0
              ? "bg-gold/25 text-gold-bright border-gold/70 shadow-[0_0_15px_rgba(212,168,67,0.7)]"
              : "bg-casino-red/25 text-red-300 border-casino-red/70 shadow-[0_0_15px_rgba(192,57,43,0.7)]"
          )}
        >
          <span>{delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString()}</span>
        </div>
      )}

      {/* Main Score Display with Roulette Glow Highlights */}
      <span
        className={cn(
          "tabular-nums transition-all duration-300 font-mono inline-block",
          className,
          isRolling &&
            direction === "up" &&
            "text-gold-bright drop-shadow-[0_0_20px_rgba(212,168,67,0.95)] scale-105",
          isRolling &&
            direction === "down" &&
            "text-red-400 drop-shadow-[0_0_20px_rgba(192,57,43,0.95)] scale-95"
        )}
      >
        {displayValue.toLocaleString()}
      </span>
    </div>
  );
}
