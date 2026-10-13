// Synthesized Lo-Fi & Zen Ambient Background Music via Web Audio API.
// 100% offline, zero network requests, zero audio files, lightweight procedural audio.

const TRACKS = [
  { id: 'sakura', name: 'Sakura Lo-Fi Chill', icon: '🌸', desc: 'Warm Rhodes & koto chords with vintage tape warmth' },
  { id: 'temple', name: 'Zen Temple & Singing Bowls', icon: '⛩️', desc: 'Meditative 108Hz harmonic drone & Tibetan bells' },
  { id: 'rain', name: 'Bamboo Wind & Soft Rain', icon: '🎋', desc: 'Gentle summer rainfall & melodic pentatonic chimes' },
];

let ac = null;
let masterGain = null;
let noiseNode = null;
let loopTimer = null;
let chimeTimer = null;
let activeOscs = [];
let listeners = new Set();

const STORAGE_KEY = 'finance-helper.ambient';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { playing: false, track: 'sakura', volume: 0.35 };
  } catch {
    return { playing: false, track: 'sakura', volume: 0.35 };
  }
}

function saveState(st) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
  } catch {}
}

const state = loadState();

function getContext() {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!ac) {
    ac = new AudioCtx();
    masterGain = ac.createGain();
    masterGain.gain.setValueAtTime(state.volume, ac.currentTime);
    masterGain.connect(ac.destination);
  }
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}

function notify() {
  for (const fn of listeners) {
    try { fn({ ...state }); } catch {}
  }
}

// Generate pink/warm noise buffer for rain & tape warmth
function createNoiseBuffer(ctx, seconds = 3) {
  const bufferSize = ctx.sampleRate * seconds;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  return buffer;
}

function stopCurrent() {
  if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
  if (chimeTimer) { clearInterval(chimeTimer); chimeTimer = null; }
  if (noiseNode) {
    try { noiseNode.stop(); noiseNode.disconnect(); } catch {}
    noiseNode = null;
  }
  for (const o of activeOscs) {
    try { o.stop(); o.disconnect(); } catch {}
  }
  activeOscs = [];
}

// --- Soundscape 1: Sakura Lo-Fi Chill ---
function startSakura(ctx) {
  const chords = [
    // Am9 (A3, C4, E4, G4, B4)
    [220.00, 261.63, 329.63, 392.00, 493.88],
    // Fmaj7 (F3, A3, C4, E4)
    [174.61, 220.00, 261.63, 329.63],
    // Dm9 (D3, F3, A3, C4, E4)
    [146.83, 174.61, 220.00, 261.63, 329.63],
    // Em7 (E3, G3, B3, D4)
    [164.81, 196.00, 246.94, 293.66],
  ];

  const pentatonicNotes = [440.00, 523.25, 587.33, 659.25, 783.99, 880.00]; // A4, C5, D5, E5, G5, A5
  let chordIndex = 0;

  // Gentle vinyl/tape hiss
  try {
    const noise = ctx.createBufferSource();
    noise.buffer = createNoiseBuffer(ctx, 4);
    noise.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1600;
    filter.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.value = 0.04;
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    noise.start();
    noiseNode = noise;
  } catch {}

  const playChord = () => {
    if (!state.playing) return;
    const notes = chords[chordIndex];
    chordIndex = (chordIndex + 1) % chords.length;
    const t = ctx.currentTime;
    const duration = 3.6;

    for (const freq of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      // Lowpass warmth filter
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(850, t);
      filter.frequency.exponentialRampToValueAtTime(550, t + duration);

      // Soft envelope
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.06 / notes.length, t + 0.8);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);

      osc.start(t);
      osc.stop(t + duration);
    }
  };

  playChord();
  loopTimer = setInterval(playChord, 3600);

  // Occasional koto / chime pluck
  const playPluck = () => {
    if (!state.playing) return;
    const t = ctx.currentTime;
    const freq = pentatonicNotes[Math.floor(Math.random() * pentatonicNotes.length)];
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.07, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(t);
    osc.stop(t + 1.25);
  };

  chimeTimer = setInterval(() => {
    if (Math.random() > 0.3) playPluck();
  }, 1800);
}

// --- Soundscape 2: Zen Temple & Singing Bowls ---
function startTemple(ctx) {
  const t = ctx.currentTime;
  // Deep warm 108Hz harmonic drone
  const droneFreqs = [108.00, 216.00, 324.00];
  for (const f of droneFreqs) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f, t);
    gain.gain.setValueAtTime(0.035 / (f / 100), t);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(t);
    activeOscs.push(osc);
  }

  // Tibetan singing bowl strikes
  const playBowl = () => {
    if (!state.playing) return;
    const now = ctx.currentTime;
    const bowlFreqs = [528.00, 1056.00, 1584.00]; // 528Hz Solfeggio bell
    bowlFreqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq + (Math.random() * 2 - 1), now);
      const amp = 0.08 / (idx + 1);
      gain.gain.setValueAtTime(amp, now);
      gain.gain.exponentialRampToValueAtTime(0.00001, now + 5.5);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(now);
      osc.stop(now + 5.6);
    });
  };

  playBowl();
  loopTimer = setInterval(playBowl, 7500);
}

// --- Soundscape 3: Bamboo Wind & Soft Rain ---
function startRain(ctx) {
  // Continuous rain noise
  try {
    const noise = ctx.createBufferSource();
    noise.buffer = createNoiseBuffer(ctx, 4);
    noise.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1100;
    const gain = ctx.createGain();
    gain.gain.value = 0.09;
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    noise.start();
    noiseNode = noise;
  } catch {}

  // Gentle bamboo wind chimes
  const chimePitches = [587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66];
  const playChimes = () => {
    if (!state.playing) return;
    const now = ctx.currentTime;
    const count = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      const f = chimePitches[Math.floor(Math.random() * chimePitches.length)];
      const delay = i * 0.12;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now + delay);
      gain.gain.setValueAtTime(0.06, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 1.8);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(now + delay);
      osc.stop(now + delay + 1.9);
    }
  };

  loopTimer = setInterval(playChimes, 3200);
}

function startSoundscape() {
  const ctx = getContext();
  if (!ctx) return;
  stopCurrent();
  if (state.track === 'sakura') startSakura(ctx);
  else if (state.track === 'temple') startTemple(ctx);
  else if (state.track === 'rain') startRain(ctx);
}

export const AmbientMusic = {
  TRACKS,

  play() {
    state.playing = true;
    saveState(state);
    startSoundscape();
    notify();
  },

  pause() {
    state.playing = false;
    saveState(state);
    stopCurrent();
    notify();
  },

  toggle() {
    if (state.playing) this.pause();
    else this.play();
  },

  setTrack(trackId) {
    if (!TRACKS.some((t) => t.id === trackId)) return;
    state.track = trackId;
    saveState(state);
    if (state.playing) startSoundscape();
    notify();
  },

  nextTrack() {
    const idx = TRACKS.findIndex((t) => t.id === state.track);
    const next = TRACKS[(idx + 1) % TRACKS.length].id;
    this.setTrack(next);
  },

  setVolume(vol) {
    const v = Math.max(0, Math.min(1, Number(vol) || 0));
    state.volume = v;
    saveState(state);
    if (masterGain && ac) {
      masterGain.gain.setValueAtTime(v, ac.currentTime);
    }
    notify();
  },

  getState() {
    return { ...state };
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

// Pause automatically when tab is hidden, resume when visible
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state.playing) stopCurrent();
    } else {
      if (state.playing) startSoundscape();
    }
  });
}
