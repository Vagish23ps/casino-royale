"use client";

import { useEffect, useRef } from "react";

interface CasinoBackgroundProps {
  isCelebration?: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  decay: number;
  rotation: number;
  vRot: number;
  isChip?: boolean;
}

export function CasinoBackground({ isCelebration = false }: CasinoBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const parallaxLayer1Ref = useRef<HTMLDivElement | null>(null);
  const parallaxLayer2Ref = useRef<HTMLDivElement | null>(null);

  // Parallax subtle depth effect on mousemove
  useEffect(() => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;

    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let animId: number;

    const handleMouseMove = (e: MouseEvent) => {
      const halfW = window.innerWidth / 2;
      const halfH = window.innerHeight / 2;
      targetX = (e.clientX - halfW) / halfW; // -1 to 1
      targetY = (e.clientY - halfH) / halfH; // -1 to 1
    };

    const updateParallax = () => {
      currentX += (targetX - currentX) * 0.05;
      currentY += (targetY - currentY) * 0.05;

      if (parallaxLayer1Ref.current) {
        parallaxLayer1Ref.current.style.transform = `translate3d(${currentX * 6}px, ${currentY * 6}px, 0)`;
      }
      if (parallaxLayer2Ref.current) {
        parallaxLayer2Ref.current.style.transform = `translate3d(${currentX * 14}px, ${currentY * 14}px, 0)`;
      }

      animId = requestAnimationFrame(updateParallax);
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    animId = requestAnimationFrame(updateParallax);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      cancelAnimationFrame(animId);
    };
  }, []);

  // Canvas particle effervescence & celebration confetti
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", handleResize);

    const particles: Particle[] = [];
    const maxAmbient = 48;

    // Ambient champagne gold, emerald and ruby effervescence
    const ambientColors = ["#f0c85a", "#d4a843", "#c0392b", "#10b981", "#00e5ff"];
    for (let i = 0; i < maxAmbient; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.35,
        vy: -0.25 - Math.random() * 0.45,
        size: 1.5 + Math.random() * 2.5,
        color: ambientColors[Math.floor(Math.random() * ambientColors.length)],
        alpha: 0.15 + Math.random() * 0.45,
        decay: 0.002,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.02,
      });
    }

    // Celebration burst when 1st place shifts
    if (isCelebration) {
      const celebrationColors = [
        "#f0c85a",
        "#d4a843",
        "#ffffff",
        "#c0392b",
        "#047857",
        "#1d4ed8",
        "#7c3aed",
      ];
      for (let i = 0; i < 140; i++) {
        const angle = (Math.PI * 2 * i) / 140 + (Math.random() - 0.5) * 0.4;
        const speed = 4.0 + Math.random() * 9.5;
        particles.push({
          x: width / 2 + (Math.random() - 0.5) * 100,
          y: height * 0.32 + (Math.random() - 0.5) * 50,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 4.0,
          size: Math.random() > 0.4 ? 6 + Math.random() * 5 : 2.5 + Math.random() * 3,
          color: celebrationColors[Math.floor(Math.random() * celebrationColors.length)],
          alpha: 1,
          decay: 0.007 + Math.random() * 0.006,
          rotation: Math.random() * Math.PI * 2,
          vRot: (Math.random() - 0.5) * 0.15,
          isChip: Math.random() > 0.45,
        });
      }
    }

    let isRunning = true;
    const render = () => {
      if (!isRunning) return;
      ctx.clearRect(0, 0, width, height);

      const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (prefersReduced) {
        return;
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.vRot;

        if (p.isChip || p.decay > 0.004) {
          p.vy += 0.13;
          p.vx *= 0.985;
          p.alpha -= p.decay;

          if (p.alpha <= 0) {
            particles.splice(i, 1);
            continue;
          }
        } else {
          if (p.y < -10) {
            p.y = height + 10;
            p.x = Math.random() * width;
          }
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);

        if (p.isChip) {
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.fill();
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = "#ffffff";
          ctx.stroke();
        } else {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      isRunning = false;
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
    };
  }, [isCelebration]);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden select-none z-0">
      {/* 1. Deep Obsidian Base & Multi-Color Casino Table Velvet Felt */}
      <div className="absolute inset-0 bg-[#050508]" />

      {/* Art Deco Casino Marquee Perimeter Bulbs */}
      <div className="absolute top-0 inset-x-0 h-2 flex justify-between px-8 pointer-events-none opacity-45 z-20">
        {Array.from({ length: 28 }).map((_, i) => (
          <div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-[#f0c85a] shadow-[0_0_8px_#f0c85a] animate-pulse"
            style={{ animationDelay: `${(i % 5) * 0.25}s` }}
          />
        ))}
      </div>

      {/* Layer 1: Parallax Ambient Table Glows */}
      <div ref={parallaxLayer1Ref} className="absolute inset-0 transition-transform duration-300 ease-out">
        {/* Radial Table Baize Glows */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,#1e0a12_0%,#10151a_38%,#08090d_72%,#040406_100%)] opacity-95" />

        {/* Emerald Table Baize Sheen */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_62%,rgba(4,120,87,0.18)_0%,rgba(185,28,28,0.12)_48%,transparent_85%)] opacity-90" />

        {/* Luxury Geometric Felt Diamond Pattern */}
        <div className="absolute inset-0 geo-pattern opacity-25 mix-blend-overlay" />

        {/* Moving Stage Spotlights: Left Gold & Right Sapphire-Gold */}
        <div className="absolute -top-32 left-1/4 w-88 h-[135vh] bg-gradient-to-b from-amber-200/22 via-gold/8 to-transparent blur-3xl origin-top-left animate-spotlight-left" />
        <div className="absolute -top-32 right-1/4 w-88 h-[135vh] bg-gradient-to-b from-sky-300/18 via-gold/8 to-transparent blur-3xl origin-top-right animate-spotlight-right" />

        {/* Rich Atmospheric Multi-Color Lighting: Ruby, Emerald, Sapphire, Amethyst, Gold */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[760px] h-[540px] rounded-full bg-[#be123c]/14 blur-[160px]" />
        <div className="absolute top-1/3 left-6 w-[420px] h-[420px] rounded-full bg-[#047857]/16 blur-[145px]" />
        <div className="absolute top-1/3 right-6 w-[420px] h-[420px] rounded-full bg-[#1d4ed8]/16 blur-[145px]" />
        <div className="absolute bottom-12 left-1/3 w-[360px] h-[360px] rounded-full bg-[#7c3aed]/14 blur-[130px]" />
        <div className="absolute bottom-6 right-1/4 w-[340px] h-[340px] rounded-full bg-[#f0c85a]/12 blur-[120px]" />

        {/* Subtle Ambient Spinning Roulette Motif in Center (Deterministic Integer Coordinates) */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[660px] h-[660px] opacity-[0.14] pointer-events-none">
          <svg viewBox="0 0 400 400" className="w-full h-full animate-roulette-spin">
            <circle cx="200" cy="200" r="195" fill="none" stroke="#d4a843" strokeWidth="2.5" strokeDasharray="8 6" />
            <circle cx="200" cy="200" r="175" fill="none" stroke="#c0392b" strokeWidth="3" opacity="0.6" />
            <circle cx="200" cy="200" r="145" fill="none" stroke="#047857" strokeWidth="2.5" opacity="0.7" />
            <circle cx="200" cy="200" r="115" fill="none" stroke="#d4a843" strokeWidth="1.5" strokeDasharray="4 4" />
            <line x1="200" y1="55" x2="200" y2="345" stroke="#d4a843" strokeWidth="1.5" opacity="0.4" />
            <line x1="55" y1="200" x2="345" y2="200" stroke="#d4a843" strokeWidth="1.5" opacity="0.4" />
            <line x1="97" y1="97" x2="303" y2="303" stroke="#d4a843" strokeWidth="1.5" opacity="0.4" />
            <line x1="97" y1="303" x2="303" y2="97" stroke="#d4a843" strokeWidth="1.5" opacity="0.4" />
            <circle cx="200" cy="200" r="35" fill="none" stroke="#f0c85a" strokeWidth="2" />
          </svg>
        </div>
      </div>

      {/* Layer 2: Parallax Floating Casino Props (Dice, Chips, Cards, Suits) */}
      <div ref={parallaxLayer2Ref} className="absolute inset-0 transition-transform duration-300 ease-out">
        {/* 1. Realistic 3D Red Acrylic Dice (Top-Left Pair) */}
        <div className="hidden md:block absolute top-28 left-[10%] w-13 h-13 rounded-xl bg-gradient-to-br from-[#ef4444] via-[#dc2626] to-[#991b1b] border border-red-300/40 shadow-[0_14px_30px_rgba(220,38,38,0.55)] animate-float-1 p-2 opacity-80 -rotate-6">
          <div className="grid grid-cols-3 grid-rows-3 w-full h-full">
            <div className="w-1.5 h-1.5 rounded-full bg-white shadow-sm" />
            <div />
            <div className="w-1.5 h-1.5 rounded-full bg-white shadow-sm ml-auto" />
            <div />
            <div className="w-1.5 h-1.5 rounded-full bg-white shadow-sm mx-auto my-auto" />
            <div />
            <div className="w-1.5 h-1.5 rounded-full bg-white shadow-sm mt-auto" />
            <div />
            <div className="w-1.5 h-1.5 rounded-full bg-white shadow-sm ml-auto mt-auto" />
          </div>
        </div>

        {/* 2. Realistic 3D Red Acrylic Dice (Bottom-Right Pair) */}
        <div className="hidden md:block absolute bottom-28 right-[10%] w-12 h-12 rounded-xl bg-gradient-to-br from-[#dc2626] via-[#b91c1c] to-[#7f1d1d] border border-red-300/40 shadow-[0_14px_30px_rgba(185,28,28,0.55)] animate-float-3 p-2 opacity-75 rotate-12">
          <div className="grid grid-cols-3 grid-rows-3 w-full h-full">
            <div className="w-1.5 h-1.5 rounded-full bg-white shadow-sm" />
            <div />
            <div />
            <div />
            <div className="w-1.5 h-1.5 rounded-full bg-white shadow-sm mx-auto my-auto" />
            <div />
            <div />
            <div />
            <div className="w-1.5 h-1.5 rounded-full bg-white shadow-sm ml-auto mt-auto" />
          </div>
        </div>

        {/* 3. Luxury Striped Poker Chips: Emerald 500 & Sapphire 1K */}
        <div className="hidden md:block absolute top-32 right-[15%] w-14 h-14 rounded-full border-2 border-white/80 bg-gradient-to-br from-[#059669] via-[#047857] to-[#064e3b] shadow-[0_10px_26px_rgba(4,120,87,0.55)] animate-float-2 opacity-75">
          <div className="w-full h-full rounded-full border-2 border-dashed border-white/70 flex items-center justify-center">
            <span className="text-[11px] font-black text-white font-mono tracking-wider drop-shadow-sm">500</span>
          </div>
        </div>

        <div className="hidden lg:block absolute bottom-32 left-[15%] w-14 h-14 rounded-full border-2 border-white/80 bg-gradient-to-br from-[#2563eb] via-[#1d4ed8] to-[#1e3a8a] shadow-[0_10px_26px_rgba(29,78,216,0.55)] animate-float-4 opacity-75">
          <div className="w-full h-full rounded-full border-2 border-dashed border-white/70 flex items-center justify-center">
            <span className="text-[11px] font-black text-white font-mono tracking-wider drop-shadow-sm">1K</span>
          </div>
        </div>

        {/* 4. Luxury Striped Poker Chips: Ruby 5K & Gold 10K */}
        <div className="hidden xl:block absolute top-1/2 left-[5%] w-13 h-13 rounded-full border-2 border-[#f0c85a] bg-gradient-to-br from-[#dc2626] to-[#7f1d1d] shadow-[0_10px_24px_rgba(220,38,38,0.5)] animate-float-1 opacity-70">
          <div className="w-full h-full rounded-full border border-dashed border-[#f0c85a] flex items-center justify-center">
            <span className="text-[10px] font-black text-[#f0c85a] font-mono tracking-wider">5K</span>
          </div>
        </div>

        <div className="hidden xl:block absolute top-1/2 right-[5%] w-13 h-13 rounded-full border-2 border-black/80 bg-gradient-to-br from-[#f0c85a] to-[#b8922e] shadow-[0_10px_24px_rgba(240,200,90,0.5)] animate-float-3 opacity-70">
          <div className="w-full h-full rounded-full border border-dashed border-black/60 flex items-center justify-center">
            <span className="text-[10px] font-black text-black font-mono tracking-wider">10K</span>
          </div>
        </div>

        {/* 5. Floating Semi-Translucent Playing Card Suits: ♠ ♥ ♦ ♣ */}
        <div className="absolute top-16 left-8 text-neutral-300/22 text-6xl font-serif animate-float-1 pointer-events-none select-none drop-shadow-[0_0_12px_rgba(255,255,255,0.25)]">
          ♠
        </div>
        <div className="absolute top-20 right-10 text-[#e11d48]/35 text-6xl font-serif animate-float-2 pointer-events-none select-none drop-shadow-[0_0_20px_rgba(225,29,72,0.45)]">
          ♥
        </div>
        <div className="absolute bottom-16 left-10 text-[#059669]/30 text-5xl font-serif animate-float-3 pointer-events-none select-none drop-shadow-[0_0_18px_rgba(5,150,105,0.35)]">
          ♦
        </div>
        <div className="absolute bottom-20 right-12 text-[#00e5ff]/30 text-5xl font-serif animate-float-4 pointer-events-none select-none drop-shadow-[0_0_18px_rgba(0,229,255,0.35)]">
          ♣
        </div>

        {/* 6. Casino Royale Playing Card Silhouettes in Depth (Ace, King, Queen) */}
        <div className="hidden xl:block absolute top-1/4 -left-6 w-28 h-42 rounded-xl border border-gold/35 bg-[#120a10]/60 backdrop-blur-xs -rotate-12 animate-float-2 pointer-events-none p-2 opacity-50 shadow-2xl">
          <div className="w-full h-full border border-gold/30 rounded-lg flex flex-col justify-between p-2 text-gold/80">
            <span className="font-serif font-black text-sm">A ♠</span>
            <div className="text-center text-3xl text-gold/90">♠</div>
            <span className="font-serif font-black text-sm text-right rotate-180">A ♠</span>
          </div>
        </div>

        <div className="hidden xl:block absolute top-1/3 -right-6 w-28 h-42 rounded-xl border border-[#e11d48]/40 bg-[#14080c]/60 backdrop-blur-xs rotate-12 animate-float-4 pointer-events-none p-2 opacity-50 shadow-2xl">
          <div className="w-full h-full border border-[#e11d48]/35 rounded-lg flex flex-col justify-between p-2 text-[#e11d48]/85">
            <span className="font-serif font-black text-sm">K ♥</span>
            <div className="text-center text-3xl text-[#e11d48]">♥</div>
            <span className="font-serif font-black text-sm text-right rotate-180">K ♥</span>
          </div>
        </div>

        <div className="hidden 2xl:block absolute bottom-14 -left-5 w-26 h-38 rounded-xl border border-emerald-500/35 bg-[#08140f]/60 backdrop-blur-xs -rotate-6 animate-float-3 pointer-events-none p-2 opacity-45 shadow-2xl">
          <div className="w-full h-full border border-emerald-500/30 rounded-lg flex flex-col justify-between p-2 text-emerald-400">
            <span className="font-serif font-black text-sm">Q ♦</span>
            <div className="text-center text-3xl text-emerald-400">♦</div>
            <span className="font-serif font-black text-sm text-right rotate-180">Q ♦</span>
          </div>
        </div>
      </div>

      {/* Layer 3: Canvas Particle & Confetti Layer (Client-Only via useEffect) */}
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none w-full h-full z-10" />
    </div>
  );
}
