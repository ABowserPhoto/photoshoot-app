import confetti from "canvas-confetti";

export const TASK_COMPLETION_MESSAGE = "🎉 Awesome work! Task completed.";

export const COMPLETION_CELEBRATION_MESSAGES = [
  "🎉 Awesome work!",
  "🌟 Great Job!",
  "🎂 Go, Go, Go Shawty its Your Birthday!!",
  "💪 Keep up the good work!!",
] as const;

export function buildRandomDailyCompletionMessage(todayCompletionCount: number): string {
  const randomMsg =
    COMPLETION_CELEBRATION_MESSAGES[Math.floor(Math.random() * COMPLETION_CELEBRATION_MESSAGES.length)];
  return `${randomMsg} That's ${todayCompletionCount} task(s) completed today! 🔥`;
}

/** @deprecated Use buildRandomDailyCompletionMessage instead. */
export function buildDailyCompletionMessage(todayCompletionCount: number): string {
  return buildRandomDailyCompletionMessage(todayCompletionCount);
}

export function celebrateTaskCompletion() {
  void confetti({
    particleCount: 150,
    spread: 70,
    origin: { y: 0.6 },
    colors: ["#4CAF50", "#FFC107", "#2196F3", "#FF5722"],
  });

  try {
    const AudioContextCtor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }
    const ctx = new AudioContextCtor();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(523.25, ctx.currentTime);
    oscillator.frequency.setValueAtTime(659.25, ctx.currentTime + 0.08);
    oscillator.frequency.setValueAtTime(783.99, ctx.currentTime + 0.16);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.35);
    window.setTimeout(() => {
      void ctx.close();
    }, 400);
  } catch {
    // Audio is optional; confetti alone is enough.
  }
}

export function isCelebrationMessage(message: string): boolean {
  return message.startsWith("🎉");
}
