"use client";

// Web Audio API synthesizer for casino audio effects.
// Completely self-contained with zero external asset dependencies.
// Does not autoplay without explicit user interaction.

class CasinoSoundController {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = true;
  private lastPlayed: Record<string, number> = {};
  private rollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Initialized on user interaction
  }

  private shouldThrottle(soundKey: string, minIntervalMs: number = 180): boolean {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const last = this.lastPlayed[soundKey] || 0;
    if (now - last < minIntervalMs) {
      return true;
    }
    this.lastPlayed[soundKey] = now;
    return false;
  }

  public init() {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  public toggleMute(): boolean {
    this.init();
    this.isMuted = !this.isMuted;
    return this.isMuted;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  // Rapid ticking of ball against roulette wheel frets
  public playRouletteTick(pitchMultiplier: number = 1.0) {
    if (this.isMuted || !this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(800 * pitchMultiplier, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(180, this.ctx.currentTime + 0.04);

      gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.04);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.045);
    } catch {
      // Audio fallback
    }
  }

  // Ball dropping into winning pocket
  public playBallPocket() {
    if (this.isMuted || !this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(320, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(90, this.ctx.currentTime + 0.12);

      gain.gain.setValueAtTime(0.18, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.14);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.15);
    } catch {
      // Audio fallback
    }
  }

  // Dramatic score reveal chime
  public playScoreReveal(isPositive: boolean = true) {
    if (this.isMuted || !this.ctx || this.shouldThrottle("score_reveal", 280)) return;
    try {
      const notes = isPositive ? [523.25, 659.25, 783.99, 1046.5] : [440, 392, 349.23];
      notes.forEach((freq, i) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime + i * 0.08);

        gain.gain.setValueAtTime(0, this.ctx.currentTime + i * 0.08);
        gain.gain.linearRampToValueAtTime(0.12, this.ctx.currentTime + i * 0.08 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + i * 0.08 + 0.6);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(this.ctx.currentTime + i * 0.08);
        osc.stop(this.ctx.currentTime + i * 0.08 + 0.65);
      });
    } catch {
      // Audio fallback
    }
  }

  // Subtle mechanical sliding/shuffling sound as physical nameplates exchange positions
  public playNameplateShuffle() {
    if (this.isMuted || !this.ctx || this.shouldThrottle("nameplate_shuffle", 400)) return;
    try {
      // 1. Tactile friction slide (brass plate sliding smoothly along felted rail)
      const bufferSize = Math.floor(this.ctx.sampleRate * 0.35);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.4;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(750, this.ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.3);
      filter.Q.setValueAtTime(2.5, this.ctx.currentTime);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.07, this.ctx.currentTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.32);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      noise.start();
      noise.stop(this.ctx.currentTime + 0.34);

      // 2. Soft mechanical detent click as nameplate seats into new slot
      const clickOsc = this.ctx.createOscillator();
      const clickGain = this.ctx.createGain();

      clickOsc.type = "triangle";
      clickOsc.frequency.setValueAtTime(320, this.ctx.currentTime + 0.26);
      clickOsc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.32);

      clickGain.gain.setValueAtTime(0, this.ctx.currentTime + 0.26);
      clickGain.gain.linearRampToValueAtTime(0.06, this.ctx.currentTime + 0.27);
      clickGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.33);

      clickOsc.connect(clickGain);
      clickGain.connect(this.ctx.destination);

      clickOsc.start(this.ctx.currentTime + 0.26);
      clickOsc.stop(this.ctx.currentTime + 0.34);
    } catch {
      // Audio fallback
    }
  }

  // Start rhythmic mechanical reel clicks matching the visual spinning reels
  public startSlotRoll(durationMs: number = 1600) {
    if (this.isMuted) return;
    this.stopSlotRoll();
    this.init();
    if (!this.ctx) return;

    const startTime = typeof performance !== "undefined" ? performance.now() : Date.now();
    let tickInterval = 75; // Fast initial ticking matching rapid spin

    const scheduleNext = () => {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const elapsed = now - startTime;
      if (elapsed >= durationMs) {
        this.stopSlotRoll();
        return;
      }

      this.playSlotReelClick(1.0 + (Math.random() * 0.25 - 0.12));

      // As reels approach settling (past 60% of duration), clicks naturally decelerate
      if (elapsed > durationMs * 0.6) {
        tickInterval = Math.min(220, tickInterval + 18);
      }

      this.rollTimer = setTimeout(scheduleNext, tickInterval);
    };

    scheduleNext();
  }

  // Stop mechanical reel clicking cleanly
  public stopSlotRoll() {
    if (this.rollTimer) {
      clearTimeout(this.rollTimer);
      this.rollTimer = null;
    }
  }

  // Mechanical slot reel spinning click
  public playSlotReelClick(pitchMultiplier: number = 1.0) {
    if (this.isMuted || !this.ctx || this.shouldThrottle("slot_click", 50)) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "square";
      osc.frequency.setValueAtTime(420 * pitchMultiplier, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(120, this.ctx.currentTime + 0.025);

      gain.gain.setValueAtTime(0.06, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.025);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.03);
    } catch {
      // Audio fallback
    }
  }

  // Mechanical slot reel digit stop & lock snap
  public playSlotReelLock() {
    if (this.isMuted || !this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(560, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(120, this.ctx.currentTime + 0.065);

      gain.gain.setValueAtTime(0.16, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.075);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.08);
    } catch {
      // Audio fallback
    }
  }

  // Champion celebration fanfare
  public playChampionFanfare() {
    if (this.isMuted || !this.ctx || this.shouldThrottle("champion_fanfare", 900)) return;
    try {
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
      notes.forEach((freq, i) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime + i * 0.09);

        gain.gain.setValueAtTime(0, this.ctx.currentTime + i * 0.09);
        gain.gain.linearRampToValueAtTime(0.16, this.ctx.currentTime + i * 0.09 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + i * 0.09 + 0.8);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(this.ctx.currentTime + i * 0.09);
        osc.stop(this.ctx.currentTime + i * 0.09 + 0.85);
      });
    } catch {
      // Audio fallback
    }
  }
}

export const casinoSound = new CasinoSoundController();
