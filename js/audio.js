// Tactile audio micro-feedback synthesized via native Web Audio API.
// Zero external files, zero dependencies, completely offline, zero latency.

let ctx = null;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!ctx) ctx = new AudioCtx();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// User-gesture unlocker: unlocks AudioContext on first pointer/key touch
if (typeof window !== 'undefined') {
  const unlock = () => {
    const ac = getAudioContext();
    if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
  };
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true, passive: true });
  window.addEventListener('click', unlock, { capture: true, passive: true });
}

function canPlay(state) {
  if (typeof window === 'undefined') return false;
  if (state?.settings?.sound === false) return false;
  return true;
}

function playSafe(state, fn) {
  if (!canPlay(state)) return;
  const ac = getAudioContext();
  if (!ac) return;
  if (ac.state === 'suspended') {
    ac.resume().then(() => {
      try { fn(ac); } catch {}
    }).catch(() => {});
  } else {
    try { fn(ac); } catch {}
  }
}

export const sound = {
  // Crisp mechanical tactile click for buttons, keys, and navigation.
  click(state) {
    playSafe(state, (ac) => {
      const t = ac.currentTime;

      // Transient sharp tick (audible on small phone & laptop speakers)
      const osc1 = ac.createOscillator();
      const g1 = ac.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(1400, t);
      osc1.frequency.exponentialRampToValueAtTime(500, t + 0.018);
      g1.gain.setValueAtTime(0.22, t);
      g1.gain.exponentialRampToValueAtTime(0.001, t + 0.018);
      osc1.connect(g1);
      g1.connect(ac.destination);
      osc1.start(t);
      osc1.stop(t + 0.022);

      // Resonant body (warm switch feedback)
      const osc2 = ac.createOscillator();
      const g2 = ac.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(450, t);
      osc2.frequency.exponentialRampToValueAtTime(180, t + 0.028);
      g2.gain.setValueAtTime(0.14, t);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.028);
      osc2.connect(g2);
      g2.connect(ac.destination);
      osc2.start(t);
      osc2.stop(t + 0.032);
    });
  },

  // Satisfying punchy double-tap for logging an expense.
  expense(state) {
    playSafe(state, (ac) => {
      const t = ac.currentTime;

      // First punchy body thump
      const osc1 = ac.createOscillator();
      const g1 = ac.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(360, t);
      osc1.frequency.exponentialRampToValueAtTime(120, t + 0.04);
      g1.gain.setValueAtTime(0.24, t);
      g1.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      osc1.connect(g1);
      g1.connect(ac.destination);
      osc1.start(t);
      osc1.stop(t + 0.045);

      // Second crisp confirmation click
      const osc2 = ac.createOscillator();
      const g2 = ac.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(800, t + 0.035);
      osc2.frequency.exponentialRampToValueAtTime(260, t + 0.08);
      g2.gain.setValueAtTime(0.18, t + 0.035);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      osc2.connect(g2);
      g2.connect(ac.destination);
      osc2.start(t + 0.035);
      osc2.stop(t + 0.085);
    });
  },

  // Bright metallic coin drop / shimmer for income and savings transfers.
  income(state) {
    playSafe(state, (ac) => {
      const t = ac.currentTime;
      // Arpeggiated harmonic coin shimmer (C6, E6, G6, C7)
      const freqs = [1046.50, 1318.51, 1567.98, 2093.00];
      freqs.forEach((f, i) => {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, t + i * 0.038);
        gain.gain.setValueAtTime(0.18, t + i * 0.038);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.038 + 0.24);
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.start(t + i * 0.038);
        osc.stop(t + i * 0.038 + 0.25);
      });
    });
  },

  // Ascending harmonic chime for reaching a goal or celebratory event.
  chime(state) {
    playSafe(state, (ac) => {
      const t = ac.currentTime;
      const chord = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      chord.forEach((f, i) => {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, t + i * 0.065);
        gain.gain.setValueAtTime(0.18, t + i * 0.065);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.065 + 0.36);
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.start(t + i * 0.065);
        osc.stop(t + i * 0.065 + 0.38);
      });
    });
  },

  // Multi-tone test demonstration
  test(state) {
    this.click(state);
    setTimeout(() => this.income(state), 140);
  },
};
