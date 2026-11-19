"use client";

import { useEffect, useState } from "react";
import { cn } from "cn";
import { casinoSound } from "./casino-sound";

export interface SlotScoreReelProps {
  value: number;
  delta?: number | null;
  isSpinning?: boolean;
  staggerDelay?: number;
  variant?: "champion" | "silver" | "bronze" | "standard";
  className?: string;
  showDelta?: boolean;
  onSettled?: () => void;
}

// Exactly 10 digits per reel strip
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

interface SingleDigitReelProps {
  targetDigit: number;
  isSpinning: boolean;
  settleDelayMs: number;
  variant: "champion" | "silver" | "bronze" | "standard";
  onSettled?: () => void;
}

function SingleDigitReel({
  targetDigit,
  isSpinning,
  settleDelayMs,
  variant,
  onSettled,
}: SingleDigitReelProps) {
  const [isSettling, setIsSettling] = useState(false);
  const [isSettled, setIsSettled] = useState(false);
  const [prevSpinning, setPrevSpinning] = useState(isSpinning);

  if (isSpinning !== prevSpinning) {
    setPrevSpinning(isSpinning);
    if (isSpinning) {
      setIsSettling(false);
      setIsSettled(false);
    }
  }

  const settleDurationMs = 420;

  useEffect(() => {
    if (!isSpinning) {
      return;
    }

    let lockTimer: ReturnType<typeof setTimeout> | null = null;

    const settleTimer = setTimeout(() => {
      setIsSettling(true);

      lockTimer = setTimeout(() => {
        setIsSettled(true);
        casinoSound.playSlotReelLock();
        onSettled?.();
      }, settleDurationMs);
    }, settleDelayMs);

    return () => {
      clearTimeout(settleTimer);
      if (lockTimer) clearTimeout(lockTimer);
    };
  }, [isSpinning, settleDelayMs, targetDigit, onSettled]);

  const isLocked = !isSpinning || isSettling || isSettled;
  const isFastSpinning = isSpinning && !isSettling && !isSettled;

  // Viewport dimensions by variant
  const cellWidth = {
    champion: "w-10 sm:w-13 lg:w-16",
    silver: "w-8.5 sm:w-11 lg:w-13",
    bronze: "w-8.5 sm:w-11 lg:w-13",
    standard: "w-6.5 sm:w-7.5 lg:w-8.5",
  }[variant];

  const cellHeight = {
    champion: "h-14 sm:h-18 lg:h-22",
    silver: "h-12 sm:h-15 lg:h-17",
    bronze: "h-12 sm:h-15 lg:h-17",
    standard: "h-9 sm:h-10 lg:h-11",
  }[variant];

  const fontSize = {
    champion: "text-3xl sm:text-5xl lg:text-6xl font-black font-mono tabular-nums text-[#f7dc87] drop-shadow-[0_2px_14px_rgba(240,200,90,0.8)]",
    silver: "text-2xl sm:text-4xl lg:text-5xl font-black font-mono tabular-nums text-[#f8f9fa] drop-shadow-[0_2px_12px_rgba(255,255,255,0.4)]",
    bronze: "text-2xl sm:text-4xl lg:text-5xl font-black font-mono tabular-nums text-[#ffb399] drop-shadow-[0_2px_12px_rgba(192,57,43,0.5)]",
    standard: "text-lg sm:text-xl lg:text-2xl font-black font-mono tabular-nums text-[#f7dc87] drop-shadow-[0_1px_8px_rgba(240,200,90,0.4)]",
  }[variant];

  return (
    <div
      className={cn(
        "relative overflow-hidden flex items-center justify-center border-r border-white/10 last:border-r-0 select-none shrink-0",
        cellWidth,
        cellHeight
      )}
    >
      {/* 3D Cylindrical Shadow Over Viewport Aperture */}
      <div className="absolute inset-0 pointer-events-none z-10 shadow-[inset_0_7px_8px_-2px_rgba(0,0,0,0.95),inset_0_-7px_8px_-2px_rgba(0,0,0,0.95)]" />

      {/* Reel Digit Strip Track: Height is 100% of Viewport */}
      <div
        className={cn(
          "absolute inset-x-0 top-0 flex flex-col items-center",
          isFastSpinning && "animate-slot-spin-fast"
        )}
        style={{
          height: "100%", // Exactly 1 viewport height
          transform: isLocked ? `translateY(-${targetDigit * 100}%)` : undefined,
          transition:
            isSettling && !isSettled
              ? `transform ${settleDurationMs}ms cubic-bezier(0.16, 1, 0.3, 1)`
              : "none",
        }}
      >
        {DIGITS.map((d) => (
          <div
            key={d}
            className={cn(
              "w-full h-full flex items-center justify-center shrink-0 leading-none select-none",
              fontSize
            )}
            style={{ height: "100%" }}
          >
            {d}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SlotScoreReel({
  value,
  delta = null,
  isSpinning = false,
  staggerDelay = 1800,
  variant = "standard",
  className,
  showDelta = true,
  onSettled,
}: SlotScoreReelProps) {
  const [windowFlash, setWindowFlash] = useState(false);

  // Parse value into character array (handles integers, decimals, and negative scores)
  const isNegative = value < 0;
  const absValue = Math.abs(value);
  const formattedStr = Number.isInteger(absValue)
    ? String(absValue)
    : absValue.toFixed(1);
  const characters = (isNegative ? `-${formattedStr}` : formattedStr).split("");

  // Count only digit characters for stagger calculations
  const digitIndices: number[] = [];
  characters.forEach((char, idx) => {
    if (char >= "0" && char <= "9") {
      digitIndices.push(idx);
    }
  });

  useEffect(() => {
    if (!isSpinning) {
      return;
    }

    // Schedule subtle bezel highlight right after the last digit locks
    const lastDigitDelay = staggerDelay + (digitIndices.length - 1) * 220 + 420;
    const flashTimer = setTimeout(() => {
      setWindowFlash(true);
      setTimeout(() => setWindowFlash(false), 1200);
    }, lastDigitDelay + 50);

    return () => clearTimeout(flashTimer);
  }, [isSpinning, staggerDelay, digitIndices.length]);

  const frameBezel = {
    champion:
      "border-2 sm:border-[3px] border-[#f0c85a] bg-gradient-to-b from-[#261706] via-[#100903] to-[#050201] shadow-[0_0_28px_rgba(240,200,90,0.4),inset_0_2px_10px_rgba(240,200,90,0.3)]",
    silver:
      "border-2 border-slate-300/85 bg-gradient-to-b from-[#181d26] via-[#0c1016] to-[#040608] shadow-[0_0_20px_rgba(148,163,184,0.3),inset_0_2px_8px_rgba(255,255,255,0.25)]",
    bronze:
      "border-2 border-casino-red/85 bg-gradient-to-b from-[#260a0e] via-[#120406] to-[#050102] shadow-[0_0_20px_rgba(192,57,43,0.35),inset_0_2px_8px_rgba(192,57,43,0.3)]",
    standard:
      "border border-gold/50 bg-gradient-to-b from-[#180e15] via-[#0c050a] to-[#040203] shadow-[0_0_12px_rgba(212,168,67,0.2),inset_0_2px_6px_rgba(0,0,0,0.85)]",
  }[variant];

  // Extra width/height styling for minus and decimal dot cells
  const nonDigitCellHeight = {
    champion: "h-14 sm:h-18 lg:h-22",
    silver: "h-12 sm:h-15 lg:h-17",
    bronze: "h-12 sm:h-15 lg:h-17",
    standard: "h-9 sm:h-10 lg:h-11",
  }[variant];

  let currentDigitCount = 0;

  const isRowVariant = variant === "standard";

  return (
    <div
      className={cn(
        "inline-flex items-center",
        isRowVariant ? "flex-row gap-2 justify-end" : "flex-col gap-1.5 items-center",
        className
      )}
    >
      {/* Point Difference / Delta Badge (positioned to the left of the score reel in leaderboard rows) */}
      {showDelta && delta !== null && delta !== 0 && isRowVariant && (
        <div
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] sm:text-xs font-mono font-bold tracking-wider uppercase border shadow-sm animate-bounce shrink-0",
            delta > 0
              ? "bg-emerald-950/90 text-emerald-300 border-emerald-500/70 shadow-emerald-900/40"
              : "bg-red-950/90 text-red-300 border-red-500/70 shadow-red-900/40"
          )}
        >
          <span>{delta > 0 ? "▲" : "▼"}</span>
          <span>{delta > 0 ? `+${delta}` : `${delta}`}</span>
        </div>
      )}

      {/* 1. Mechanical Slot Machine Reel Window */}
      <div
        className={cn(
          "relative flex items-center rounded-xl sm:rounded-2xl overflow-hidden p-0.5 sm:p-1 transition-all duration-500 shrink-0",
          frameBezel,
          windowFlash && "ring-4 ring-gold-bright shadow-[0_0_45px_rgba(240,200,90,0.9)] scale-105"
        )}
      >
        {/* Glass reflection angle */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/16 via-transparent to-black/40 pointer-events-none z-20" />

        {/* Render each character in sequence */}
        {characters.map((char, idx) => {
          if (char === "-") {
            return (
              <div
                key={idx}
                className={cn(
                  "flex items-center justify-center font-mono font-black text-casino-red px-1 shrink-0 border-r border-white/10 select-none",
                  nonDigitCellHeight,
                  variant === "champion" ? "text-2xl sm:text-4xl lg:text-5xl w-6 sm:w-8 lg:w-10" : "text-xl sm:text-3xl w-5 sm:w-6 lg:w-8"
                )}
              >
                -
              </div>
            );
          }

          if (char === ".") {
            return (
              <div
                key={idx}
                className={cn(
                  "flex items-end justify-center font-mono font-black text-gold pb-1.5 sm:pb-2.5 px-0.5 shrink-0 border-r border-white/10 select-none",
                  nonDigitCellHeight,
                  variant === "champion" ? "text-2xl sm:text-4xl lg:text-5xl w-4 sm:w-6" : "text-xl sm:text-3xl w-3 sm:w-4"
                )}
              >
                .
              </div>
            );
          }

          const digitVal = Number(char);
          const thisDigitOrder = currentDigitCount;
          currentDigitCount++;
          const isLastDigit = thisDigitOrder === digitIndices.length - 1;

          return (
            <SingleDigitReel
              key={idx}
              targetDigit={digitVal}
              isSpinning={isSpinning}
              settleDelayMs={staggerDelay + thisDigitOrder * 220}
              variant={variant}
              onSettled={isLastDigit ? onSettled : undefined}
            />
          );
        })}
      </div>

      {/* Point Difference / Delta Badge (positioned underneath the score reel for podium cards) */}
      {showDelta && delta !== null && delta !== 0 && !isRowVariant && (
        <div
          className={cn(
            "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-mono font-bold tracking-wider uppercase border shadow-md animate-bounce shrink-0 mt-1",
            delta > 0
              ? "bg-emerald-950/90 text-emerald-300 border-emerald-500/70 shadow-emerald-900/40"
              : "bg-red-950/90 text-red-300 border-red-500/70 shadow-red-900/40"
          )}
        >
          <span>{delta > 0 ? "▲" : "▼"}</span>
          <span>{delta > 0 ? `+${delta} PTS` : `${delta} PTS`}</span>
        </div>
      )}
    </div>
  );
}
