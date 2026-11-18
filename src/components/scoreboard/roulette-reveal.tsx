"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import { Sparkles, FastForward } from "lucide-react";
import { cn } from "cn";
import { casinoSound } from "./casino-sound";

interface CurtainRevealProps {
  onComplete: () => void;
  headingFontClassName?: string;
  updatedTeamsCount?: number;
}

type CurtainStage = "curtain-entering" | "curtain-parting" | "curtain-complete";

export function CurtainReveal({
  onComplete,
  headingFontClassName,
  updatedTeamsCount = 1,
}: CurtainRevealProps) {
  const [stage, setStage] = useState<CurtainStage>("curtain-entering");

  const timersRef = useRef<NodeJS.Timeout[]>([]);
  const hasCompletedRef = useRef(false);

  // Safe idempotent completion handler
  const completeSequence = useCallback(() => {
    if (hasCompletedRef.current) return;
    hasCompletedRef.current = true;
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    onComplete();
  }, [onComplete]);

  useEffect(() => {
    hasCompletedRef.current = false;
    const addTimer = (fn: () => void, delayMs: number) => {
      const id = setTimeout(fn, delayMs);
      timersRef.current.push(id);
      return id;
    };

    // STAGE 1: Curtains enter from both sides (0ms -> 700ms)
    // STAGE 2: Curtains smoothly part from centre & reveal PowerHouse + Bodoni CASINO ROYALE (at 700ms)
    addTimer(() => {
      setStage("curtain-parting");
      casinoSound.playScoreReveal(true);
    }, 700);

    // STAGE 3: Curtains fully parted, transition to Slot Machine Score Reveal on scoreboard (at 2300ms)
    addTimer(() => {
      setStage("curtain-complete");
      completeSequence();
    }, 2300);

    // GUARANTEED SAFETY TIMEOUT FALLBACK (at 3000ms)
    const safetyId = setTimeout(() => {
      completeSequence();
    }, 3000);
    timersRef.current.push(safetyId);

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [completeSequence]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/95 select-none overflow-hidden transition-opacity duration-500",
        stage === "curtain-complete" && "opacity-0 pointer-events-none"
      )}
    >
      {/* 1. CINEMATIC BLACK & RUBY-RED STAGE AMBIENT LIGHTING */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Overhead Theatrical Spotlight */}
        <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-[700px] h-[100vh] bg-gradient-to-b from-amber-100/30 via-gold/15 to-transparent blur-3xl" />
        {/* Rich Ruby-Red & Amethyst Stage Flares */}
        <div className="absolute top-1/4 left-10 w-96 h-96 rounded-full bg-[#b91c1c]/25 blur-[140px]" />
        <div className="absolute top-1/4 right-10 w-96 h-96 rounded-full bg-[#7c3aed]/25 blur-[140px]" />
      </div>

      {/* 2. THEATRICAL RED VELVET CURTAINS */}
      <div className="absolute inset-0 z-40 pointer-events-none flex overflow-hidden">
        {/* Left Velvet Curtain */}
        <div
          className={cn(
            "w-1/2 h-full shadow-[14px_0_50px_rgba(0,0,0,0.95)] relative transition-opacity duration-500",
            stage === "curtain-entering" && "animate-curtain-in-left",
            stage === "curtain-parting" && "animate-curtain-part-left",
            stage === "curtain-complete" && "-translate-x-full opacity-0"
          )}
          style={{
            background:
              "repeating-linear-gradient(90deg, #180204 0%, #3a0509 4%, #720f18 9%, #9e1724 14%, #600c14 19%, #280306 24%)",
            boxShadow:
              "inset 0 35px 70px rgba(0,0,0,0.9), inset -12px 0 35px rgba(0,0,0,0.95)",
          }}
        >
          {/* Golden Bullion Fringe at Inner Curtain Edge */}
          <div className="absolute top-0 right-0 w-2.5 h-full bg-gradient-to-b from-[#f0c85a] via-[#d4a843] to-[#8d681f] shadow-[0_0_15px_rgba(240,200,90,0.7)]" />
        </div>

        {/* Right Velvet Curtain */}
        <div
          className={cn(
            "w-1/2 h-full shadow-[-14px_0_50px_rgba(0,0,0,0.95)] relative transition-opacity duration-500",
            stage === "curtain-entering" && "animate-curtain-in-right",
            stage === "curtain-parting" && "animate-curtain-part-right",
            stage === "curtain-complete" && "translate-x-full opacity-0"
          )}
          style={{
            background:
              "repeating-linear-gradient(90deg, #280306 0%, #600c14 5%, #9e1724 10%, #720f18 15%, #3a0509 20%, #180204 24%)",
            boxShadow:
              "inset 0 35px 70px rgba(0,0,0,0.9), inset 12px 0 35px rgba(0,0,0,0.95)",
          }}
        >
          {/* Golden Bullion Fringe at Inner Curtain Edge */}
          <div className="absolute top-0 left-0 w-2.5 h-full bg-gradient-to-b from-[#f0c85a] via-[#d4a843] to-[#8d681f] shadow-[0_0_15px_rgba(240,200,90,0.7)]" />
        </div>
      </div>

      {/* Skip Button for Event Controller / Presenter */}
      <button
        onClick={completeSequence}
        title="Skip reveal to updated scoreboard"
        className="absolute top-5 right-6 z-50 flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/10 hover:bg-gold/25 text-neutral-200 hover:text-gold border border-white/20 text-xs font-mono uppercase tracking-wider backdrop-blur-md transition-all cursor-pointer shadow-xl"
      >
        <FastForward className="w-3.5 h-3.5" />
        <span>Skip Reveal</span>
      </button>

      {/* 3. CENTERPIECE PRESENTATION: POWERHOUSE LOGO & CASINO ROYALE */}
      <div className="relative z-30 flex flex-col items-center max-w-2xl w-full text-center px-4">
        <div className="flex flex-col items-center space-y-5 animate-brand-reveal">
          {/* The Actual PowerHouse Black-Square Logo with Red Lettering */}
          <div className="relative shrink-0 flex items-center justify-center rounded-2xl overflow-hidden bg-black shadow-[0_0_60px_rgba(192,57,43,0.55)] border-2 border-red-950 p-2 sm:p-2.5">
            <Image
              src="/powerhouse-logo.png"
              alt="PowerHouse"
              width={319}
              height={249}
              className="h-20 sm:h-28 w-auto object-contain"
              priority
            />
          </div>

          {/* CASINO ROYALE in Bodoni Moda Didone Uppercase */}
          <h1
            className={cn(
              "text-4xl sm:text-6xl uppercase tracking-[0.24em] sm:tracking-[0.26em] text-foreground drop-shadow-[0_4px_24px_rgba(240,200,90,0.65)]",
              headingFontClassName || "font-serif"
            )}
          >
            CASINO ROYALE
          </h1>

          <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-gradient-to-r from-[#b91c1c]/50 via-gold/30 to-[#b91c1c]/50 border border-gold/60 shadow-2xl backdrop-blur-md text-xs sm:text-sm font-mono uppercase tracking-widest text-gold-bright">
            <Sparkles className="w-4 h-4 text-gold animate-spin-chip" />
            <span>Championship Scoring Batch Confirmed</span>
          </div>

          <p className="text-xs sm:text-sm font-mono text-neutral-300 tracking-wider">
            Updating {updatedTeamsCount} {updatedTeamsCount === 1 ? "team score" : "team scores"} • Spinning mechanical reels...
          </p>
        </div>
      </div>
    </div>
  );
}

// Backwards compatibility alias for existing imports
export { CurtainReveal as RouletteReveal };
