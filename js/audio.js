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

function canPlay(state) {
  if (!state || state.settings?.sound === false) return false;
  return true;
}

export const sound = {
  // Crisp mechanical micro-click for buttons and switches.
  click(state) {
    if (!canPlay(state)) return;
    const ac = getAudioContext();
    if (!ac) return;
    try {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(120, ac.currentTime);
      osc.frequency.exponentialRampToValueAtTime(40, ac.currentTime + 0.025);
      gain.gain.setValueAtTime(0.12, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.025);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + 0.03);
    } catch { /* audio failure silent fallback */ }
  },

  // Satisfying muted double-tap for logging an expense.
  expense(state) {
    if (!canPlay(state)) return;
    const ac = getAudioContext();
    if (!ac) return;
    try {
      const t = ac.currentTime;
      // First thump
      const osc1 = ac.createOscillator();
      const g1 = ac.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(140, t);
      osc1.frequency.exponentialRampToValueAtTime(50, t + 0.04);
      g1.gain.setValueAtTime(0.18, t);
      g1.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      osc1.connect(g1);
      g1.connect(ac.destination);
      osc1.start(t);
      osc1.stop(t + 0.045);

      // Second crisp click
      const osc2 = ac.createOscillator();
      const g2 = ac.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(260, t + 0.03);
      osc2.frequency.exponentialRampToValueAtTime(80, t + 0.07);
      g2.gain.setValueAtTime(0.12, t + 0.03);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      osc2.connect(g2);
      g2.connect(ac.destination);
      osc2.start(t + 0.03);
      osc2.stop(t + 0.075);
    } catch { /* silent fallback */ }
  },

  // Bright metallic coin drop / shimmer for income and safe transfers.
  income(state) {
    if (!canPlay(state)) return;
    const ac = getAudioContext();
    if (!ac) return;
    try {
      const t = ac.currentTime;
      const freqs = [987.77, 1318.51, 1975.53]; // B5, E6, B6 harmonic sparkle
      freqs.forEach((f, i) => {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, t + i * 0.035);
        gain.gain.setValueAtTime(0.1, t + i * 0.035);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.035 + 0.22);
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.start(t + i * 0.035);
        osc.stop(t + i * 0.035 + 0.23);
      });
    } catch { /* silent fallback */ }
  },

  // Ascending harmonic chime for reaching a goal or celebratory event.
  chime(state) {
    if (!canPlay(state)) return;
    const ac = getAudioContext();
    if (!ac) return;
    try {
      const t = ac.currentTime;
      const chord = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      chord.forEach((f, i) => {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, t + i * 0.07);
        gain.gain.setValueAtTime(0.12, t + i * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.07 + 0.35);
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.start(t + i * 0.07);
        osc.stop(t + i * 0.07 + 0.36);
      });
    } catch { /* silent fallback */ }
  },
};
