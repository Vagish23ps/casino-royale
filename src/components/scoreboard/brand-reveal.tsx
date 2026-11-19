"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import { FastForward } from "lucide-react";
import { cn } from "cn";
import { casinoSound } from "./casino-sound";

interface BrandRevealProps {
  onComplete: () => void;
  headingFontClassName?: string;
}

type BrandPhase = "phase-1" | "phase-2" | "phase-3" | "phase-4";

export function BrandReveal({
  onComplete,
  headingFontClassName,
}: BrandRevealProps) {
  // Phase 1: PowerHouse logo appears
  // Phase 2: CASINO ROYALE appears in Bodoni Didone serif
  // Phase 3: Dissolve both brand elements (refined PowerPoint dissolve in red-and-black)
  // Phase 4: Scoreboard reveal (onComplete called)
  const [phase, setPhase] = useState<BrandPhase>("phase-1");
  const timersRef = useRef<NodeJS.Timeout[]>([]);
  const hasCompletedRef = useRef(false);

  const completeSequence = useCallback(() => {
    if (hasCompletedRef.current) return;
    hasCompletedRef.current = true;
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setPhase("phase-4");
    onComplete();
  }, [onComplete]);

  useEffect(() => {
    hasCompletedRef.current = false;
    const addTimer = (fn: () => void, delayMs: number) => {
      const id = setTimeout(fn, delayMs);
      timersRef.current.push(id);
      return id;
    };

    // Phase 1 is active on mount (0ms)

    // Phase 2: CASINO ROYALE appears prominently below POWERHOUSE logo (at 750ms)
    addTimer(() => {
      setPhase("phase-2");
      casinoSound.playScoreReveal(true);
    }, 750);

    // Phase 3: PowerPoint-style dissolve of brand elements into subtle red-and-black (at 1900ms)
    addTimer(() => {
      setPhase("phase-3");
    }, 1900);

    // Phase 4: Smoothly complete brand reveal and transition to scoreboard (at 2700ms)
    addTimer(() => {
      completeSequence();
    }, 2700);

    // Safety fallback
    const safetyId = setTimeout(completeSequence, 3500);
    timersRef.current.push(safetyId);

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [completeSequence]);

  if (phase === "phase-4") {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center select-none overflow-hidden transition-opacity duration-800 ease-in-out",
        phase === "phase-3" ? "opacity-0 pointer-events-none" : "opacity-100",
        "bg-[#050508]"
      )}
      style={{
        backgroundImage:
          "radial-gradient(ellipse at center, rgba(130, 15, 25, 0.22) 0%, rgba(18, 3, 6, 0.88) 55%, #050508 100%)",
      }}
    >
      {/* Subtle red-and-black ambient lighting (no spinning, no curtains) */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-gradient-to-b from-[#8b0000]/15 via-[#4a0404]/10 to-transparent blur-3xl" />
      </div>

      {/* Discrete Skip Button */}
      <button
        onClick={completeSequence}
        title="Skip to scoreboard"
        className="absolute top-5 right-6 z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/35 hover:bg-black/60 text-neutral-500 hover:text-neutral-300 border border-white/5 hover:border-white/15 text-xs font-mono uppercase tracking-wider backdrop-blur-sm transition-colors cursor-pointer"
      >
        <FastForward className="w-3.5 h-3.5" />
        <span>Skip</span>
      </button>

      {/* Brand Sequence Content: Strictly POWERHOUSE logo & CASINO ROYALE */}
      <div className="relative z-30 flex flex-col items-center max-w-3xl w-full text-center px-4">
        {/* PHASE 1: POWERHOUSE Logo (Relatively small) */}
        <div
          className={cn(
            "transition-all duration-700 ease-out mb-4 sm:mb-6",
            phase === "phase-1" && "opacity-100 scale-100 translate-y-0",
            phase === "phase-2" && "opacity-100 scale-100 translate-y-0",
            phase === "phase-3" && "opacity-0 scale-98 -translate-y-2 filter blur-[2px]"
          )}
        >
          <div className="relative shrink-0 flex items-center justify-center rounded-xl overflow-hidden bg-black shadow-[0_0_35px_rgba(192,57,43,0.35)] border border-red-950/60 p-2 sm:p-2.5">
            <Image
              src="/powerhouse-logo.png"
              alt="PowerHouse"
              width={319}
              height={249}
              className="h-10 sm:h-14 w-auto object-contain"
              priority
            />
          </div>
        </div>

        {/* PHASE 2: CASINO ROYALE (Significantly larger than PowerHouse, Bodoni Didone uppercase, high-contrast) */}
        <h1
          className={cn(
            "text-4xl sm:text-6xl lg:text-7xl uppercase tracking-[0.22em] sm:tracking-[0.28em] text-[#fbf6e8] drop-shadow-[0_4px_30px_rgba(212,168,67,0.45)] transition-all duration-700 ease-out",
            headingFontClassName || "font-serif",
            phase === "phase-1" && "opacity-0 translate-y-4 scale-95 pointer-events-none",
            phase === "phase-2" && "opacity-100 translate-y-0 scale-100",
            phase === "phase-3" && "opacity-0 -translate-y-3 scale-102 filter blur-[2px]"
          )}
        >
          CASINO ROYALE
        </h1>
      </div>
    </div>
  );
}

// Backwards compatibility aliases
export { BrandReveal as CurtainReveal, BrandReveal as RouletteReveal };
