"use client";

import { Crown } from "lucide-react";

export function CasinoNetworkingVisual() {
  return (
    <div className="relative w-full max-w-4xl h-[380px] sm:h-[440px] lg:h-[490px] flex items-center justify-center select-none overflow-visible">
      {/* 1. AMBIENT LIGHTING GLOWS (Exact Palette: #08080c, #c0392b, #d4a843, #168b58, #00b9e8) */}
      <div className="absolute inset-0 bg-gradient-radial from-[#12121e]/90 via-[#08080c]/95 to-[#08080c] opacity-90 pointer-events-none" />
      {/* Central Electric Blue Network Core Glow */}
      <div className="absolute w-80 h-80 sm:w-[420px] sm:h-[420px] rounded-full bg-[#00b9e8]/10 blur-[80px] pointer-events-none animate-pulse-node" />
      {/* Gold Ambient Atmosphere */}
      <div className="absolute w-72 h-72 sm:w-96 sm:h-96 rounded-full bg-[#d4a843]/12 blur-[70px] pointer-events-none" />
      {/* Casino Red Ambient Accent (Left) */}
      <div className="absolute w-60 h-60 rounded-full bg-[#c0392b]/15 blur-[65px] pointer-events-none -translate-x-36 -translate-y-12" />
      {/* Emerald Accent (Right) */}
      <div className="absolute w-60 h-60 rounded-full bg-[#168b58]/15 blur-[65px] pointer-events-none translate-x-36 translate-y-12" />

      {/* 2. SVG CIRCUIT BOARD PATHS & TRAVELLING PARTICLES */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 840 500"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Gradients */}
          <linearGradient id="traceBlue" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00b9e8" stopOpacity="0.85" />
            <stop offset="50%" stopColor="#0077b6" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#00b9e8" stopOpacity="0.85" />
          </linearGradient>
          <linearGradient id="traceGold" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#d4a843" stopOpacity="0.9" />
            <stop offset="50%" stopColor="#f0c85a" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#d4a843" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="traceRed" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#c0392b" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#d4a843" stopOpacity="0.7" />
          </linearGradient>
          <linearGradient id="traceEmerald" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#168b58" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#00b9e8" stopOpacity="0.7" />
          </linearGradient>

          {/* Neon Glow Filters */}
          <filter id="neonGlowBlue" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.5" result="blur1" />
            <feMerge>
              <feMergeNode in="blur1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="neonGlowGold" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="blur2" />
            <feMerge>
              <feMergeNode in="blur2" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* --- Primary Circuit Highway Traces Leading into Central Roulette Hub (420, 250) --- */}

        {/* Path 1: From Ace of Spades (150, 110) -> Hub (420, 250) */}
        <path
          id="circuitSpade"
          d="M 150 110 L 230 110 L 300 180 L 370 215"
          stroke="url(#traceBlue)"
          strokeWidth="1.8"
          strokeDasharray="6 6"
          className="animate-circuit-flow opacity-70"
          filter="url(#neonGlowBlue)"
        />
        {/* Path 2: From King of Hearts (690, 110) -> Hub (420, 250) */}
        <path
          id="circuitHeart"
          d="M 690 110 L 610 110 L 540 180 L 470 215"
          stroke="url(#traceRed)"
          strokeWidth="1.8"
          strokeDasharray="6 6"
          className="animate-circuit-flow opacity-70"
          filter="url(#neonGlowBlue)"
        />
        {/* Path 3: From Ace of Diamonds (170, 390) -> Hub (420, 250) */}
        <path
          id="circuitDiamond"
          d="M 170 390 L 250 390 L 320 320 L 375 285"
          stroke="url(#traceEmerald)"
          strokeWidth="1.8"
          strokeDasharray="6 6"
          className="animate-circuit-flow opacity-70"
          filter="url(#neonGlowBlue)"
        />
        {/* Path 4: From Queen of Clubs (670, 390) -> Hub (420, 250) */}
        <path
          id="circuitClub"
          d="M 670 390 L 590 390 L 520 320 L 465 285"
          stroke="url(#traceBlue)"
          strokeWidth="1.8"
          strokeDasharray="6 6"
          className="animate-circuit-flow opacity-70"
          filter="url(#neonGlowBlue)"
        />

        {/* Radial Network Concentric Grid Rings */}
        <circle cx="420" cy="250" r="195" stroke="url(#traceBlue)" strokeWidth="1" strokeDasharray="3 7" className="opacity-30" />
        <circle cx="420" cy="250" r="155" stroke="url(#traceGold)" strokeWidth="1.2" strokeDasharray="4 8" className="opacity-45" />
        <circle cx="420" cy="250" r="120" stroke="url(#traceBlue)" strokeWidth="0.8" strokeDasharray="2 5" className="opacity-40" />

        {/* Micro Circuit Branch Lines */}
        <line x1="80" y1="250" x2="220" y2="250" stroke="#00b9e8" strokeWidth="1" strokeDasharray="3 5" className="opacity-30" />
        <line x1="620" y1="250" x2="760" y2="250" stroke="#00b9e8" strokeWidth="1" strokeDasharray="3 5" className="opacity-30" />
        <line x1="420" y1="50" x2="420" y2="130" stroke="#d4a843" strokeWidth="1" strokeDasharray="4 6" className="opacity-35" />
        <line x1="420" y1="370" x2="420" y2="450" stroke="#00b9e8" strokeWidth="1" strokeDasharray="4 6" className="opacity-35" />

        {/* Glowing Network Nodes (At key junctions) */}
        <circle cx="230" cy="110" r="4.5" fill="#00b9e8" className="animate-pulse-node" filter="url(#neonGlowBlue)" />
        <circle cx="300" cy="180" r="3.5" fill="#d4a843" className="animate-pulse-node" filter="url(#neonGlowGold)" />
        <circle cx="610" cy="110" r="4.5" fill="#c0392b" className="animate-pulse-node" />
        <circle cx="540" cy="180" r="3.5" fill="#00b9e8" className="animate-pulse-node" filter="url(#neonGlowBlue)" />
        <circle cx="250" cy="390" r="4.5" fill="#168b58" className="animate-pulse-node" />
        <circle cx="320" cy="320" r="3.5" fill="#00b9e8" className="animate-pulse-node" filter="url(#neonGlowBlue)" />
        <circle cx="590" cy="390" r="4.5" fill="#00b9e8" className="animate-pulse-node" filter="url(#neonGlowBlue)" />
        <circle cx="520" cy="320" r="3.5" fill="#d4a843" className="animate-pulse-node" filter="url(#neonGlowGold)" />

        {/* Travelling Data Particles (Animated Along the Highway Paths) */}
        <circle r="3" fill="#00b9e8" filter="url(#neonGlowBlue)">
          <animateMotion dur="4.5s" repeatCount="indefinite" path="M 150 110 L 230 110 L 300 180 L 370 215" keyPoints="0;1" keyTimes="0;1" />
        </circle>
        <circle r="3" fill="#c0392b">
          <animateMotion dur="5.2s" repeatCount="indefinite" path="M 690 110 L 610 110 L 540 180 L 470 215" keyPoints="0;1" keyTimes="0;1" />
        </circle>
        <circle r="3" fill="#168b58">
          <animateMotion dur="4.8s" repeatCount="indefinite" path="M 170 390 L 250 390 L 320 320 L 375 285" keyPoints="0;1" keyTimes="0;1" />
        </circle>
        <circle r="3" fill="#f0c85a" filter="url(#neonGlowGold)">
          <animateMotion dur="5.8s" repeatCount="indefinite" path="M 670 390 L 590 390 L 520 320 L 465 285" keyPoints="0;1" keyTimes="0;1" />
        </circle>
      </svg>

      {/* 3. CENTRAL ROULETTE WHEEL & NETWORK HUB MATRIX */}
      <div className="relative flex items-center justify-center w-64 h-64 sm:w-80 sm:h-80 lg:w-96 lg:h-96 z-10">
        {/* CONTINUOUS ROTATING ROULETTE WHEEL */}
        <div className="absolute inset-0 rounded-full animate-spin-chip-rev flex items-center justify-center pointer-events-none">
          <svg className="w-full h-full" viewBox="0 0 320 320" fill="none">
            {/* Outer Brass / Gold Fluted Bezel */}
            <circle cx="160" cy="160" r="156" stroke="#d4a843" strokeWidth="4" />
            <circle cx="160" cy="160" r="150" stroke="#f0c85a" strokeWidth="1" strokeDasharray="3 4" opacity="0.6" />
            <circle cx="160" cy="160" r="144" fill="#08080c" stroke="#b8922e" strokeWidth="2" />

            {/* Alternating Casino Red & Deep Black Number Slots with 0 in Emerald */}
            {Array.from({ length: 32 }).map((_, i) => {
              const angle = (i * 360) / 32;
              const isGreen = i === 0;
              const isRed = i % 2 === 1;
              const color = isGreen ? "#168b58" : isRed ? "#c0392b" : "#0f0f18";
              return (
                <g key={i} transform={`rotate(${angle} 160 160)`}>
                  <path
                    d="M 152 24 L 168 24 L 165 60 L 155 60 Z"
                    fill={color}
                    stroke="#d4a843"
                    strokeWidth="0.8"
                  />
                  <line x1="160" y1="24" x2="160" y2="60" stroke="#d4a843" strokeWidth="0.5" opacity="0.4" />
                </g>
              );
            })}

            {/* Inner Chrome Ball Track */}
            <circle cx="160" cy="160" r="98" stroke="#d4a843" strokeWidth="2" />
            <circle cx="160" cy="160" r="92" stroke="#00b9e8" strokeWidth="1" strokeDasharray="4 6" opacity="0.7" />
            <circle cx="160" cy="160" r="86" fill="#0c0c16" stroke="#d4a843" strokeWidth="1.5" />

            {/* 8 Radial Gold Turret Handles */}
            {Array.from({ length: 8 }).map((_, i) => (
              <line
                key={i}
                x1="160"
                y1="75"
                x2="160"
                y2="95"
                stroke="#d4a843"
                strokeWidth="2.5"
                strokeLinecap="round"
                transform={`rotate(${i * 45} 160 160)`}
              />
            ))}
          </svg>
        </div>

        {/* CENTRAL NETWORK PROCESSOR CORE & CHIP NUCLEUS */}
        <div className="relative flex items-center justify-center">
          {/* Master Gold & Electric Blue Core Chip */}
          <div className="relative w-32 h-32 sm:w-40 sm:h-40 rounded-full bg-gradient-to-b from-[#241e12] via-[#121018] to-[#08080c] border-4 border-gold shadow-[0_0_45px_rgba(212,168,67,0.4)] flex items-center justify-center z-20 group">
            {/* Spinning Milled Rim Track */}
            <div className="absolute inset-1.5 rounded-full border border-dashed border-gold/70 animate-spin-chip pointer-events-none" />
            {/* Glowing Cyan Inner Circuit Core */}
            <div className="absolute inset-3.5 rounded-full border-2 border-[#00b9e8]/60 shadow-[inset_0_0_20px_rgba(0,185,232,0.4)] pointer-events-none animate-pulse-node" />

            {/* Center Royal Insignia & Crown */}
            <div className="w-18 h-18 sm:w-22 sm:h-22 rounded-full bg-gradient-to-b from-[#382b0e] via-[#1f180a] to-[#0c0905] border-2 border-gold flex flex-col items-center justify-center shadow-inner">
              <Crown className="w-8 h-8 sm:w-9 sm:h-9 text-gold drop-shadow-[0_2px_10px_rgba(212,168,67,0.6)] animate-crown-glow" />
              <span className="text-[9px] sm:text-[10px] font-mono font-black text-gold tracking-widest mt-0.5">
                ROYALE
              </span>
            </div>

            {/* Gold Notches on Rim */}
            <div className="absolute top-0 w-3.5 h-2 bg-gold rounded-b-sm" />
            <div className="absolute bottom-0 w-3.5 h-2 bg-gold rounded-t-sm" />
            <div className="absolute left-0 h-3.5 w-2 bg-gold rounded-r-sm" />
            <div className="absolute right-0 h-3.5 w-2 bg-gold rounded-l-sm" />
          </div>

          {/* Sub-Orbital Poker Chip: Emerald Green 5K (Bottom Left) */}
          <div className="absolute -left-12 -bottom-8 w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-gradient-to-br from-[#168b58] via-[#116842] to-[#0a3824] border-4 border-[#2ecc71] shadow-xl shadow-[#168b58]/30 flex items-center justify-center transform -rotate-12 hover:scale-105 transition-transform z-15 pointer-events-auto cursor-pointer">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border-2 border-dashed border-white/50 flex items-center justify-center">
              <div className="w-10 h-10 rounded-full bg-[#082216] border border-[#2ecc71]/60 flex items-center justify-center">
                <span className="text-[#2ecc71] font-mono font-bold text-[11px]">♦ 5K</span>
              </div>
            </div>
            <div className="absolute top-0 w-3 h-1.5 bg-white rounded-b-sm" />
            <div className="absolute bottom-0 w-3 h-1.5 bg-white rounded-t-sm" />
            <div className="absolute left-0 h-3 w-1.5 bg-white rounded-r-sm" />
            <div className="absolute right-0 h-3 w-1.5 bg-white rounded-l-sm" />
          </div>

          {/* Sub-Orbital Poker Chip: Casino Red 25K (Top Right) */}
          <div className="absolute -right-12 -top-8 w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-gradient-to-br from-[#c0392b] via-[#962c20] to-[#591710] border-4 border-[#ff7675] shadow-xl shadow-casino-red/35 flex items-center justify-center transform rotate-12 hover:scale-105 transition-transform z-15 pointer-events-auto cursor-pointer">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border-2 border-dashed border-white/50 flex items-center justify-center">
              <div className="w-10 h-10 rounded-full bg-[#3a0d08] border border-white/40 flex items-center justify-center">
                <span className="text-white font-mono font-bold text-[11px]">♥ 25K</span>
              </div>
            </div>
            <div className="absolute top-0 w-3 h-1.5 bg-white rounded-b-sm" />
            <div className="absolute bottom-0 w-3 h-1.5 bg-white rounded-t-sm" />
            <div className="absolute left-0 h-3 w-1.5 bg-white rounded-r-sm" />
            <div className="absolute right-0 h-3 w-1.5 bg-white rounded-l-sm" />
          </div>

          {/* REALISTIC 3D GOLD COIN 1 (Top Left Orbit) */}
          <div className="absolute -left-20 -top-6 w-14 h-14 sm:w-16 sm:h-16 rounded-full animate-coin-spin z-25 pointer-events-none drop-shadow-[0_4px_12px_rgba(212,168,67,0.5)]">
            <svg viewBox="0 0 60 60" className="w-full h-full">
              <circle cx="30" cy="30" r="28" fill="url(#goldCoinGrad)" stroke="#f0c85a" strokeWidth="2.5" />
              <circle cx="30" cy="30" r="23" stroke="#b8922e" strokeWidth="1" strokeDasharray="2 3" />
              <circle cx="30" cy="30" r="18" fill="#d4a843" stroke="#f0c85a" strokeWidth="1" />
              <path d="M 24 34 L 36 34 L 34 26 L 30 29 L 26 26 Z" fill="#4d3a10" />
              <circle cx="30" cy="23" r="2" fill="#4d3a10" />
              <defs>
                <linearGradient id="goldCoinGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#f0c85a" />
                  <stop offset="50%" stopColor="#d4a843" />
                  <stop offset="100%" stopColor="#8a6d20" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          {/* REALISTIC 3D GOLD COIN 2 (Bottom Right Orbit) */}
          <div className="absolute -right-20 -bottom-6 w-14 h-14 sm:w-16 sm:h-16 rounded-full animate-coin-spin-fast z-25 pointer-events-none drop-shadow-[0_4px_12px_rgba(212,168,67,0.5)]">
            <svg viewBox="0 0 60 60" className="w-full h-full">
              <circle cx="30" cy="30" r="28" fill="url(#goldCoinGrad2)" stroke="#f0c85a" strokeWidth="2.5" />
              <circle cx="30" cy="30" r="23" stroke="#b8922e" strokeWidth="1" strokeDasharray="2 3" />
              <circle cx="30" cy="30" r="18" fill="#d4a843" stroke="#f0c85a" strokeWidth="1" />
              <path d="M 30 20 L 33 26 L 39 27 L 35 31 L 36 37 L 30 34 L 24 37 L 25 31 L 21 27 L 27 26 Z" fill="#4d3a10" />
              <defs>
                <linearGradient id="goldCoinGrad2" x1="100%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#f0c85a" />
                  <stop offset="40%" stopColor="#d4a843" />
                  <stop offset="100%" stopColor="#7a5f18" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>
      </div>

      {/* 4. REALISTIC PLAYING CARDS (CONNECTED NODES) */}

      {/* Card 1: Ace of Spades (Top Left Connected Node) */}
      <div className="absolute left-2 sm:left-8 lg:left-14 top-2 sm:top-6 animate-float-1 z-30">
        <div className="w-24 h-36 sm:w-28 sm:h-42 rounded-xl border border-gold/60 bg-gradient-to-b from-[#141420] via-[#0b0b14] to-[#08080c] p-3 shadow-2xl shadow-black flex flex-col justify-between backdrop-blur-md relative overflow-hidden group hover:scale-105 transition-transform cursor-pointer">
          {/* Circuit Trace Network Texture on Face */}
          <div className="absolute inset-0 bg-[radial-gradient(#00b9e8_1px,transparent_1px)] [background-size:10px_10px] opacity-25 pointer-events-none" />
          {/* Card Corner Index */}
          <div className="flex items-center justify-between text-gold">
            <span className="font-serif font-black text-base sm:text-lg leading-none">A</span>
            <span className="text-xs">♠</span>
          </div>
          {/* Center Royal Filigree Spade */}
          <div className="flex flex-col items-center justify-center my-auto">
            <span className="text-3xl sm:text-4xl text-gold font-serif drop-shadow-[0_0_12px_rgba(212,168,67,0.5)]">
              ♠
            </span>
          </div>
          {/* Bottom Inverted Index */}
          <div className="flex items-center justify-between text-gold rotate-180">
            <span className="font-serif font-black text-base sm:text-lg leading-none">A</span>
            <span className="text-xs">♠</span>
          </div>
          {/* Connected Network Pin Glow Indicator */}
          <div className="absolute bottom-1 right-1 w-2 h-2 rounded-full bg-[#00b9e8] shadow-[0_0_8px_#00b9e8]" />
        </div>
      </div>

      {/* Card 2: King of Hearts (Top Right Connected Node) */}
      <div className="absolute right-2 sm:right-8 lg:right-14 top-4 sm:top-8 animate-float-2 z-30">
        <div className="w-24 h-36 sm:w-28 sm:h-42 rounded-xl border border-casino-red/70 bg-gradient-to-b from-[#201014] via-[#10080a] to-[#08080c] p-3 shadow-2xl shadow-black flex flex-col justify-between backdrop-blur-md relative overflow-hidden group hover:scale-105 transition-transform cursor-pointer">
          <div className="absolute inset-0 bg-[radial-gradient(#c0392b_1px,transparent_1px)] [background-size:10px_10px] opacity-25 pointer-events-none" />
          <div className="flex items-center justify-between text-casino-red">
            <span className="font-serif font-black text-base sm:text-lg leading-none">K</span>
            <span className="text-xs">♥</span>
          </div>
          <div className="flex flex-col items-center justify-center my-auto">
            <span className="text-3xl sm:text-4xl text-casino-red font-serif drop-shadow-[0_0_14px_rgba(192,57,43,0.5)]">
              ♥
            </span>
          </div>
          <div className="flex items-center justify-between text-casino-red rotate-180">
            <span className="font-serif font-black text-base sm:text-lg leading-none">K</span>
            <span className="text-xs">♥</span>
          </div>
          <div className="absolute bottom-1 left-1 w-2 h-2 rounded-full bg-casino-red shadow-[0_0_8px_#c0392b]" />
        </div>
      </div>

      {/* Card 3: Ace of Diamonds (Bottom Left Connected Node) */}
      <div className="absolute left-6 sm:left-14 lg:left-22 bottom-2 sm:bottom-4 animate-float-3 z-30">
        <div className="w-22 h-34 sm:w-26 sm:h-38 rounded-xl border border-emerald/60 bg-gradient-to-b from-[#0f1f17] via-[#09140e] to-[#08080c] p-3 shadow-2xl shadow-black flex flex-col justify-between backdrop-blur-md relative overflow-hidden group hover:scale-105 transition-transform cursor-pointer">
          <div className="absolute inset-0 bg-[radial-gradient(#168b58_1px,transparent_1px)] [background-size:10px_10px] opacity-25 pointer-events-none" />
          <div className="flex items-center justify-between text-emerald">
            <span className="font-serif font-black text-sm sm:text-base leading-none">A</span>
            <span className="text-xs">♦</span>
          </div>
          <div className="flex flex-col items-center justify-center my-auto">
            <span className="text-2xl sm:text-3xl text-emerald font-serif drop-shadow-[0_0_12px_rgba(22,139,88,0.5)]">
              ♦
            </span>
          </div>
          <div className="flex items-center justify-between text-emerald rotate-180">
            <span className="font-serif font-black text-sm sm:text-base leading-none">A</span>
            <span className="text-xs">♦</span>
          </div>
          <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#168b58] shadow-[0_0_8px_#168b58]" />
        </div>
      </div>

      {/* Card 4: Queen of Clubs (Bottom Right Connected Node) */}
      <div className="absolute right-6 sm:right-14 lg:right-22 bottom-2 sm:bottom-4 animate-float-4 z-30">
        <div className="w-22 h-34 sm:w-26 sm:h-38 rounded-xl border border-[#00b9e8]/60 bg-gradient-to-b from-[#0e1c26] via-[#081017] to-[#08080c] p-3 shadow-2xl shadow-black flex flex-col justify-between backdrop-blur-md relative overflow-hidden group hover:scale-105 transition-transform cursor-pointer">
          <div className="absolute inset-0 bg-[radial-gradient(#00b9e8_1px,transparent_1px)] [background-size:10px_10px] opacity-25 pointer-events-none" />
          <div className="flex items-center justify-between text-[#00b9e8]">
            <span className="font-serif font-black text-sm sm:text-base leading-none">Q</span>
            <span className="text-xs">♣</span>
          </div>
          <div className="flex flex-col items-center justify-center my-auto">
            <span className="text-2xl sm:text-3xl text-[#00b9e8] font-serif drop-shadow-[0_0_14px_rgba(0,185,232,0.5)]">
              ♣
            </span>
          </div>
          <div className="flex items-center justify-between text-[#00b9e8] rotate-180">
            <span className="font-serif font-black text-sm sm:text-base leading-none">Q</span>
            <span className="text-xs">♣</span>
          </div>
          <div className="absolute top-1 left-1 w-2 h-2 rounded-full bg-[#00b9e8] shadow-[0_0_8px_#00b9e8]" />
        </div>
      </div>
    </div>
  );
}
