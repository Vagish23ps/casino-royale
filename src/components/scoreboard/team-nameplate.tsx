"use client";

import React from "react";
import { cn } from "cn";

export interface TeamNameplateProps {
  teamId: string;
  teamName: string;
  teamColor?: string | null;
  variant?: "champion" | "silver" | "bronze" | "standard";
  className?: string;
  isShuffling?: boolean;
}

export function TeamNameplate({
  teamId,
  teamName,
  teamColor,
  variant = "standard",
  className,
  isShuffling = false,
}: TeamNameplateProps) {
  // Visual styling: identifiable rectangular casino nameplate plaque
  // Dark casino background, visible restrained gold border, subtle bevel/depth, clean typography, consistent dimensions
  const plateStyling = {
    champion:
      "bg-gradient-to-b from-[#241708]/98 via-[#120a03]/98 to-[#060301]/98 border-2 border-[#f0c85a]/75 shadow-[0_4px_16px_rgba(0,0,0,0.9),inset_0_1px_2px_rgba(240,200,90,0.35),inset_0_-1px_2px_rgba(0,0,0,0.8)]",
    silver:
      "bg-gradient-to-b from-[#181d28]/98 via-[#0d1118]/98 to-[#05070a]/98 border-2 border-slate-300/70 shadow-[0_4px_16px_rgba(0,0,0,0.9),inset_0_1px_2px_rgba(255,255,255,0.25),inset_0_-1px_2px_rgba(0,0,0,0.8)]",
    bronze:
      "bg-gradient-to-b from-[#240c10]/98 via-[#130508]/98 to-[#060203]/98 border-2 border-[#d48050]/70 shadow-[0_4px_16px_rgba(0,0,0,0.9),inset_0_1px_2px_rgba(212,128,80,0.3),inset_0_-1px_2px_rgba(0,0,0,0.8)]",
    standard:
      "bg-gradient-to-b from-[#1b111e]/98 via-[#0e0712]/98 to-[#050207]/98 border-[1.5px] border-gold/55 shadow-[0_4px_14px_rgba(0,0,0,0.85),inset_0_1px_2px_rgba(212,168,67,0.22),inset_0_-1px_2px_rgba(0,0,0,0.8)]",
  }[variant];

  const fontStyling = {
    champion:
      "text-xs sm:text-sm lg:text-base font-bold font-serif text-[#fdf8eb] tracking-wide uppercase truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]",
    silver:
      "text-xs sm:text-sm lg:text-base font-bold font-serif text-slate-100 tracking-wide uppercase truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]",
    bronze:
      "text-xs sm:text-sm lg:text-base font-bold font-serif text-amber-100 tracking-wide uppercase truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]",
    standard:
      "text-xs sm:text-sm font-semibold font-serif text-[#f5ebd7] tracking-wider uppercase truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]",
  }[variant];

  return (
    <div
      data-team-nameplate={teamId}
      className={cn(
        "relative flex items-center justify-center px-3.5 sm:px-4.5 h-10 sm:h-11 rounded-lg sm:rounded-xl select-none will-change-transform transition-all duration-300",
        plateStyling,
        isShuffling && "shadow-[0_10px_35px_rgba(212,168,67,0.55)] border-gold ring-1 ring-gold/60 scale-[1.02]",
        className
      )}
    >
      {/* Subtle Metallic Corner Highlights */}
      <div className="absolute top-0.5 left-1 w-2 h-0.5 bg-gradient-to-r from-white/30 to-transparent rounded pointer-events-none" />
      <div className="absolute top-0.5 right-1 w-2 h-0.5 bg-gradient-to-l from-white/30 to-transparent rounded pointer-events-none" />

      {/* Team Color Accent Gem / Pip */}
      <div
        className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full shrink-0 mr-2 sm:mr-2.5 shadow-sm ring-1 ring-gold/40 border border-black/40"
        style={{ backgroundColor: teamColor || "#d4a843" }}
      />
      <span className={fontStyling}>{teamName}</span>
    </div>
  );
}
