"use client";

/**
 * WebAudio ringtone + vibration, no audio assets needed.
 */
export class Ringtone {
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private vibTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  async start() {
    if (this.running) return;
    this.running = true;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      await this.ctx.resume().catch(() => {});
    } catch {
      this.ctx = null;
    }
    this.playTone();
    this.timer = setInterval(() => this.playTone(), 3000);
    this.vibrate();
    this.vibTimer = setInterval(() => this.vibrate(), 3000);
  }

  private vibrate() {
    try {
      navigator.vibrate?.([600, 400, 600, 400, 600, 600]);
    } catch { /* unsupported */ }
  }

  private playTone() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // classic double-beep ringtone, warm marimba-ish tones
    const notes: Array<[number, number, number]> = [
      [830, now + 0.02, 0.55],
      [622, now + 0.38, 0.55],
      [830, now + 1.1, 0.55],
      [622, now + 1.46, 0.55],
    ];
    for (const [freq, at, dur] of notes) {
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc2.type = "triangle";
      osc.frequency.value = freq;
      osc2.frequency.value = freq * 2.01;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.22, at + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc2.start(at);
      osc.stop(at + dur + 0.05);
      osc2.stop(at + dur + 0.05);
    }
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    if (this.vibTimer) clearInterval(this.vibTimer);
    this.timer = null;
    this.vibTimer = null;
    try {
      navigator.vibrate?.(0);
    } catch { /* noop */ }
    if (this.ctx) {
      const ctx = this.ctx;
      setTimeout(() => ctx.close().catch(() => {}), 100);
      this.ctx = null;
    }
  }
}

/** Short UI blip (answer / hangup). */
export async function playBlip(kind: "answer" | "hangup") {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    await ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const freqs = kind === "answer" ? [520, 780] : [420, 300];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, now + i * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.09 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.09);
      osc.stop(now + i * 0.09 + 0.3);
    });
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch { /* noop */ }
}
