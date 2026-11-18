import Link from "next/link";
import { Crown, Shield, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CasinoNetworkingVisual } from "@/components/home/casino-networking-visual";

export default function Home() {
  return (
    <main className="h-screen w-screen max-h-screen overflow-hidden bg-[#08080c] flex flex-col items-center justify-between p-4 sm:p-6 lg:p-8 select-none relative font-sans">
      {/* Subtle corner suit flourishes */}
      <div className="absolute top-6 left-6 text-gold/10 text-4xl sm:text-6xl font-serif pointer-events-none select-none">
        ♠
      </div>
      <div className="absolute top-6 right-6 text-casino-red/10 text-4xl sm:text-6xl font-serif pointer-events-none select-none">
        ♥
      </div>
      <div className="absolute bottom-6 left-6 text-[#168b58]/10 text-4xl sm:text-6xl font-serif pointer-events-none select-none">
        ♦
      </div>
      <div className="absolute bottom-6 right-6 text-[#00b9e8]/10 text-4xl sm:text-6xl font-serif pointer-events-none select-none">
        ♣
      </div>

      {/* Top: Logo & Title ONLY */}
      <header className="z-10 flex flex-col items-center text-center pt-2 sm:pt-4">
        <div className="flex items-center justify-center gap-3">
          <div className="flex items-center justify-center w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-gold/15 border border-gold/40 shadow-[0_0_25px_rgba(212,168,67,0.25)]">
            <Crown className="w-6 h-6 text-gold" />
          </div>
          <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black tracking-widest text-foreground font-serif uppercase drop-shadow-[0_2px_15px_rgba(212,168,67,0.3)]">
            CASINO ROYALE
          </h1>
        </div>
      </header>

      {/* Center: Main Visual with Casino & Computer Networking Theme */}
      <div className="z-10 flex-1 flex items-center justify-center w-full my-auto">
        <CasinoNetworkingVisual />
      </div>

      {/* Bottom: Only Admin Login & Live Scoreboard Buttons */}
      <footer className="z-10 flex flex-col sm:flex-row items-center justify-center gap-4 pb-4 sm:pb-8 w-full max-w-md">
        <Link href="/public-view" className="w-full sm:w-auto flex-1">
          <Button
            className="w-full h-12 px-6 bg-gradient-to-r from-gold via-gold-bright to-gold text-charcoal hover:brightness-110 font-bold text-xs sm:text-sm tracking-widest uppercase shadow-xl shadow-gold/20 gap-2 border border-gold/40 transition-all cursor-pointer"
          >
            <Eye className="w-4 h-4 text-charcoal" />
            Live Scoreboard
          </Button>
        </Link>
        <Link href="/login" className="w-full sm:w-auto flex-1">
          <Button
            variant="outline"
            className="w-full h-12 px-6 border-gold/40 bg-card/70 hover:bg-gold/15 text-foreground hover:text-gold text-xs sm:text-sm tracking-widest uppercase gap-2 transition-all cursor-pointer"
          >
            <Shield className="w-4 h-4 text-gold" />
            Admin Login
          </Button>
        </Link>
      </footer>
    </main>
  );
}
