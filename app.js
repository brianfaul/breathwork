(() => {
'use strict';

/* ---------------- Techniques ---------------- */
const TECHNIQUES = [
  {
    id: 'box', name: 'Box', meta: '4-4-4-4', accent: '#5eead4',
    desc: 'Equal parts inhale, hold, exhale, hold. Used by Navy SEALs to stay calm and focused under pressure.',
    phases: [
      { key: 'inhale', dur: 4, label: 'Breathe In' },
      { key: 'hold1', dur: 4, label: 'Hold' },
      { key: 'exhale', dur: 4, label: 'Breathe Out' },
      { key: 'hold2', dur: 4, label: 'Hold' },
    ],
  },
  {
    id: '478', name: '4-7-8', meta: '4-7-8', accent: '#fbbf24',
    desc: "Dr. Andrew Weil's deeply relaxing pattern — a long, slow exhale melts tension and eases you toward sleep.",
    phases: [
      { key: 'inhale', dur: 4, label: 'Breathe In' },
      { key: 'hold1', dur: 7, label: 'Hold' },
      { key: 'exhale', dur: 8, label: 'Breathe Out' },
    ],
  },
  {
    id: 'coherent', name: 'Coherent', meta: '5.5-5.5', accent: '#c4b5fd',
    desc: 'Smooth, even breathing at about 5.5 breaths a minute to balance your nervous system.',
    phases: [
      { key: 'inhale', dur: 5.5, label: 'Breathe In' },
      { key: 'exhale', dur: 5.5, label: 'Breathe Out' },
    ],
  },
  {
    id: 'belly', name: 'Deep Belly', meta: '4-6', accent: '#fda4af',
    desc: "Slow diaphragmatic breathing with an extended exhale to trigger your body's relaxation response.",
    phases: [
      { key: 'inhale', dur: 4, label: 'Breathe In' },
      { key: 'exhale', dur: 6, label: 'Breathe Out' },
    ],
  },
];
const TARGET_FOR = { inhale: 1, hold1: 1, exhale: 0, hold2: 0 };
const DURATIONS = [
  { label: '1 min', value: 60 },
  { label: '3 min', value: 180 },
  { label: '5 min', value: 300 },
  { label: '10 min', value: 600 },
  { label: 'Open', value: 0 },
];

const byId = (id) => document.getElementById(id);
const $ = (sel, ctx) => (ctx || document).querySelector(sel);

/* ---------------- Persisted settings ---------------- */
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('tidal.' + key); return v === null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  },
  set(key, val) { try { localStorage.setItem('tidal.' + key, JSON.stringify(val)); } catch (e) {} },
};

const state = {
  technique: store.get('technique', 'box'),
  duration: store.get('duration', 180),
  sound: store.get('sound', true),
  haptics: store.get('haptics', true),
  voice: store.get('voice', true),
};

/* ---------------- Voice cues (browser speech synthesis) ---------------- */
class VoiceEngine {
  constructor() {
    this.supported = 'speechSynthesis' in window;
    this.voice = null;
    if (this.supported) {
      const pick = () => {
        const voices = window.speechSynthesis.getVoices();
        if (!voices.length) return;
        this.voice = voices.find((v) => /en[-_]US/i.test(v.lang) && /female|samantha|aria|jenny|google us english/i.test(v.name))
          || voices.find((v) => /^en/i.test(v.lang))
          || voices[0];
      };
      pick();
      window.speechSynthesis.onvoiceschanged = pick;
    }
  }
  say(text) {
    if (!this.supported) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.88; u.pitch = 1; u.volume = 0.9;
    if (this.voice) u.voice = this.voice;
    window.speechSynthesis.speak(u);
  }
  stop() { if (this.supported) window.speechSynthesis.cancel(); }
}
const voiceEngine = new VoiceEngine();
function speakPhase(label) {
  if (state.voice && state.sound) voiceEngine.say(label);
}

/* ---------------- Audio engine (fully synthesized) ---------------- */
class AudioEngine {
  constructor() { this.ctx = null; this.master = null; this.ambient = null; this.muted = false; }
  ensure() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  startAmbient() {
    this.ensure();
    if (this.ambient) return;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = this.muted ? 0 : 0.45;
    gain.connect(this.master);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 480; filter.Q.value = 0.6;
    filter.connect(gain);
    const freqs = [98, 147, 196];
    const oscs = freqs.map((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.055 / (i + 1);
      o.connect(g); g.connect(filter); o.start();
      return o;
    });
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.045;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 200;
    lfo.connect(lfoGain); lfoGain.connect(filter.frequency); lfo.start();
    this.ambient = { gain, filter, oscs, lfo, lfoGain };
  }
  stopAmbient() {
    if (!this.ambient) return;
    const { gain, oscs, lfo } = this.ambient;
    const now = this.ctx.currentTime;
    gain.gain.setTargetAtTime(0, now, 0.25);
    setTimeout(() => {
      oscs.forEach((o) => { try { o.stop(); } catch (e) {} });
      try { lfo.stop(); } catch (e) {}
    }, 800);
    this.ambient = null;
  }
  setMuted(m) {
    this.muted = m;
    if (this.ambient) this.ambient.gain.gain.setTargetAtTime(m ? 0 : 0.45, this.ctx.currentTime, 0.35);
  }
  chime(phaseKey) {
    if (this.muted) return;
    this.ensure();
    const ctx = this.ctx;
    const freqMap = { inhale: 660, hold1: 784, exhale: 392, hold2: 330 };
    const freq = freqMap[phaseKey] || 440;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
    const delay = ctx.createDelay(); delay.delayTime.value = 0.22;
    const feedback = ctx.createGain(); feedback.gain.value = 0.16;
    osc.connect(gain); gain.connect(this.master);
    gain.connect(delay); delay.connect(feedback); feedback.connect(delay); delay.connect(this.master);
    osc.start(now); osc.stop(now + 1.7);
  }
}
const audio = new AudioEngine();

function vibrate(ms) {
  if (state.haptics && navigator.vibrate) navigator.vibrate(ms);
}

/* ---------------- Canvas scene: bioluminescent tide ---------------- */
const canvas = byId('scene');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;
let currentAccent = TECHNIQUES.find((t) => t.id === state.technique).accent;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize, { passive: true });
resize();

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpColor(c1, c2, t) {
  const a = hexToRgb(c1), b = hexToRgb(c2);
  return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;
}
function easeInOutSine(x) { return -(Math.cos(Math.PI * x) - 1) / 2; }

function makeParticle(spawnAnywhere) {
  return {
    fx: Math.random(),
    fy: spawnAnywhere ? Math.random() : 1 + Math.random() * 0.08,
    r: 1 + Math.random() * 2.4,
    speed: 0.01 + Math.random() * 0.018,
    drift: (Math.random() - 0.5) * 0.006,
    twinkleSpeed: 0.4 + Math.random() * 1.1,
    twinkleOffset: Math.random() * Math.PI * 2,
  };
}
const particles = Array.from({ length: 46 }, () => makeParticle(true));

const NIGHT = ['#04050d', '#0d1230', '#1b1440'];
const DAWN = ['#1c2c4d', '#5b3f78', '#e8875f'];

let lastFrame = performance.now();

function renderScene(now, breathValue, dawnProgress) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  // sky
  const top = lerpColor(NIGHT[0], DAWN[0], dawnProgress);
  const mid = lerpColor(NIGHT[1], DAWN[1], dawnProgress);
  const bot = lerpColor(NIGHT[2], DAWN[2], dawnProgress);
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, top); sky.addColorStop(0.55, mid); sky.addColorStop(1, bot);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // inhale glow
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(W * 0.5, H * 0.38, 0, W * 0.5, H * 0.38, Math.max(W, H) * 0.6);
  glow.addColorStop(0, rgba(currentAccent, 0.10 * breathValue));
  glow.addColorStop(1, rgba(currentAccent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // particles rising from the tide
  particles.forEach((p) => {
    p.fy -= p.speed * dt;
    p.fx += p.drift * dt;
    if (p.fx < 0) p.fx += 1; if (p.fx > 1) p.fx -= 1;
    if (p.fy < -0.06) Object.assign(p, makeParticle(false));
    const x = p.fx * W, y = p.fy * H;
    const twinkle = 0.5 + 0.5 * Math.sin(now / 1000 * p.twinkleSpeed + p.twinkleOffset);
    const alpha = (0.12 + 0.5 * twinkle) * (0.45 + 0.55 * breathValue);
    const rad = p.r * (0.85 + 0.35 * breathValue) * 4;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, rgba(currentAccent, alpha));
    g.addColorStop(1, rgba(currentAccent, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  });

  // tide waves
  const baseline = H * (0.9 - breathValue * 0.055);
  drawWave(now, baseline + 20, 22, 2.0, -0.35, 0.11);
  drawWave(now, baseline, 15, 1.35, 0.55, 0.17);

  // vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

function drawWave(now, baseline, amplitude, waveCount, speed, alpha) {
  ctx.beginPath();
  ctx.moveTo(0, H);
  ctx.lineTo(0, baseline);
  const step = Math.max(6, W / 90);
  for (let x = 0; x <= W; x += step) {
    const y = baseline + amplitude * Math.sin((x / W) * Math.PI * 2 * waveCount + now / 1000 * speed * Math.PI * 2);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = rgba(currentAccent, alpha);
  ctx.fill();
}

/* ---------------- Breathing session state machine ---------------- */
const session = {
  running: false, paused: false,
  phases: [], phaseIndex: 0, cycleNum: 1,
  value: 0, startValue: 0, targetValue: 1,
  phaseStartTime: 0, sessionStartTime: 0, pausedAt: 0,
  totalDuration: 0,
};

const els = {
  setup: byId('setupScreen'), sessionScreen: byId('sessionScreen'), complete: byId('completeScreen'),
  techniqueList: byId('techniqueList'), techniqueDesc: byId('techniqueDesc'), durationList: byId('durationList'),
  soundToggle: byId('soundToggle'), hapticsToggle: byId('hapticsToggle'), voiceToggle: byId('voiceToggle'),
  beginBtn: byId('beginBtn'), installBtn: byId('installBtn'), iosTip: byId('iosTip'),
  stopBtn: byId('stopBtn'), pauseBtn: byId('pauseBtn'), sessionSoundBtn: byId('sessionSoundBtn'),
  sessionTimer: byId('sessionTimer'), ring: byId('ringProgress'), phaseLabel: byId('phaseLabel'),
  phaseCount: byId('phaseCount'), cycleCount: byId('cycleCount'), liveRegion: byId('liveRegion'),
  completeStats: byId('completeStats'), doneBtn: byId('doneBtn'), againBtn: byId('againBtn'),
};

const RING_CIRC = 2 * Math.PI * 108;
els.ring.style.strokeDasharray = String(RING_CIRC);

function showScreen(name) {
  ['setup', 'sessionScreen', 'complete'].forEach((k) => {
    els[k].dataset.visible = String(k === name);
  });
}

function techniqueById(id) { return TECHNIQUES.find((t) => t.id === id); }

function applyTechniqueAccent(id) {
  document.documentElement.dataset.technique = id;
  currentAccent = techniqueById(id).accent;
}

function formatTime(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/* ---- setup screen rendering ---- */
function renderTechniqueList() {
  els.techniqueList.innerHTML = '';
  TECHNIQUES.forEach((t) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'technique-card';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(t.id === state.technique));
    btn.innerHTML = `<span class="t-name">${t.name}</span><span class="t-meta">${t.meta}</span>`;
    btn.addEventListener('click', () => selectTechnique(t.id));
    els.techniqueList.appendChild(btn);
  });
  els.techniqueDesc.textContent = techniqueById(state.technique).desc;
}

function selectTechnique(id) {
  state.technique = id;
  store.set('technique', id);
  applyTechniqueAccent(id);
  [...els.techniqueList.children].forEach((child, i) => {
    child.setAttribute('aria-checked', String(TECHNIQUES[i].id === id));
  });
  els.techniqueDesc.textContent = techniqueById(id).desc;
}

function renderDurationList() {
  els.durationList.innerHTML = '';
  DURATIONS.forEach((d) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(d.value === state.duration));
    btn.textContent = d.label;
    btn.addEventListener('click', () => selectDuration(d.value));
    els.durationList.appendChild(btn);
  });
}
function selectDuration(value) {
  state.duration = value;
  store.set('duration', value);
  [...els.durationList.children].forEach((child, i) => {
    child.setAttribute('aria-checked', String(DURATIONS[i].value === value));
  });
}

function setSoundUI(btn, on) {
  btn.setAttribute('aria-pressed', String(on));
  $('.icon-sound-on', btn).hidden = !on;
  $('.icon-sound-off', btn).hidden = on;
}
function applySound(on) {
  state.sound = on;
  store.set('sound', on);
  setSoundUI(els.soundToggle, on);
  setSoundUI(els.sessionSoundBtn, on);
  audio.setMuted(!on);
  if (!on) voiceEngine.stop();
}
els.soundToggle.addEventListener('click', () => applySound(!state.sound));
els.sessionSoundBtn.addEventListener('click', () => applySound(!state.sound));

if (voiceEngine.supported) {
  els.voiceToggle.hidden = false;
  els.voiceToggle.setAttribute('aria-pressed', String(state.voice));
  els.voiceToggle.addEventListener('click', () => {
    state.voice = !state.voice;
    store.set('voice', state.voice);
    els.voiceToggle.setAttribute('aria-pressed', String(state.voice));
    if (!state.voice) voiceEngine.stop();
  });
}

if ('vibrate' in navigator) {
  els.hapticsToggle.hidden = false;
  els.hapticsToggle.setAttribute('aria-pressed', String(state.haptics));
  els.hapticsToggle.addEventListener('click', () => {
    state.haptics = !state.haptics;
    store.set('haptics', state.haptics);
    els.hapticsToggle.setAttribute('aria-pressed', String(state.haptics));
    if (state.haptics) vibrate(12);
  });
}

/* ---- session control ---- */
function startSession() {
  const tech = techniqueById(state.technique);
  session.phases = tech.phases;
  session.phaseIndex = 0;
  session.cycleNum = 1;
  session.value = 0;
  session.startValue = 0;
  session.targetValue = TARGET_FOR[session.phases[0].key];
  session.sessionStartTime = performance.now();
  session.phaseStartTime = session.sessionStartTime;
  session.totalDuration = state.duration;
  session.paused = false;
  session.running = true;

  audio.ensure();
  if (state.sound) audio.startAmbient();
  audio.chime(session.phases[0].key);
  speakPhase(session.phases[0].label);
  vibrate(12);

  els.phaseLabel.textContent = session.phases[0].label;
  els.cycleCount.textContent = 'Cycle 1';
  showScreen('sessionScreen');
}

function advancePhase(now) {
  session.startValue = session.targetValue;
  session.phaseIndex++;
  if (session.phaseIndex >= session.phases.length) {
    session.phaseIndex = 0;
    session.cycleNum++;
    if (session.totalDuration > 0) {
      const elapsed = (now - session.sessionStartTime) / 1000;
      if (elapsed >= session.totalDuration) { finishSession(now); return; }
    }
  }
  session.phaseStartTime = now;
  const phase = session.phases[session.phaseIndex];
  session.targetValue = TARGET_FOR[phase.key];
  els.phaseLabel.textContent = phase.label;
  els.cycleCount.textContent = 'Cycle ' + session.cycleNum;
  els.liveRegion.textContent = phase.label;
  audio.chime(phase.key);
  speakPhase(phase.label);
  vibrate(phase.key === 'inhale' ? 14 : 10);
}

function finishSession(now) {
  session.running = false;
  audio.stopAmbient();
  voiceEngine.stop();
  const elapsedMin = Math.max(1, Math.round((now - session.sessionStartTime) / 60000));
  const cycles = Math.max(1, session.cycleNum - 1);
  els.completeStats.textContent = `${elapsedMin} minute${elapsedMin === 1 ? '' : 's'} · ${cycles} cycle${cycles === 1 ? '' : 's'}`;
  showScreen('complete');
}

function stopSession() {
  session.running = false;
  audio.stopAmbient();
  voiceEngine.stop();
  showScreen('setup');
}

function togglePause() {
  if (!session.running) return;
  const now = performance.now();
  if (session.paused) {
    const pausedDuration = now - session.pausedAt;
    session.phaseStartTime += pausedDuration;
    session.sessionStartTime += pausedDuration;
    session.paused = false;
    els.pauseBtn.textContent = 'Pause';
    if (state.sound) audio.startAmbient();
  } else {
    session.paused = true;
    session.pausedAt = now;
    els.pauseBtn.textContent = 'Resume';
    audio.stopAmbient();
    voiceEngine.stop();
  }
}

els.beginBtn.addEventListener('click', startSession);
els.stopBtn.addEventListener('click', stopSession);
els.pauseBtn.addEventListener('click', togglePause);
els.doneBtn.addEventListener('click', () => showScreen('setup'));
els.againBtn.addEventListener('click', startSession);

/* ---- main loop: always animates the scene; drives the breath state machine when running ---- */
function tick(now) {
  let breathValue;
  let dawnProgress;

  if (session.running && !session.paused) {
    const phase = session.phases[session.phaseIndex];
    const elapsed = (now - session.phaseStartTime) / 1000;
    const progress = Math.min(1, elapsed / phase.dur);
    session.value = session.startValue + (session.targetValue - session.startValue) * easeInOutSine(progress);
    breathValue = session.value;

    const remaining = Math.max(1, Math.ceil(phase.dur - elapsed));
    els.phaseCount.textContent = String(remaining);
    els.ring.style.strokeDashoffset = String(RING_CIRC * (1 - progress));

    if (session.totalDuration > 0) {
      const remainingSession = Math.max(0, session.totalDuration - (now - session.sessionStartTime) / 1000);
      els.sessionTimer.textContent = formatTime(remainingSession);
    } else {
      els.sessionTimer.textContent = formatTime((now - session.sessionStartTime) / 1000);
    }

    if (progress >= 1) advancePhase(now);

    const denom = session.totalDuration > 0 ? session.totalDuration : 600;
    dawnProgress = Math.min(1, (now - session.sessionStartTime) / 1000 / denom);
  } else if (session.running && session.paused) {
    breathValue = session.value;
    const denom = session.totalDuration > 0 ? session.totalDuration : 600;
    dawnProgress = Math.min(1, (session.pausedAt - session.sessionStartTime) / 1000 / denom);
  } else {
    breathValue = (Math.sin((now / 4500) * Math.PI * 2) + 1) / 2;
    dawnProgress = 0.22 + 0.13 * Math.sin((now / 120000) * Math.PI * 2);
  }

  renderScene(now, breathValue, dawnProgress);
  requestAnimationFrame(tick);
}

/* ---------------- PWA install ---------------- */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  els.installBtn.hidden = false;
});
els.installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  els.installBtn.hidden = true;
});
window.addEventListener('appinstalled', () => { els.installBtn.hidden = true; });

const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
if (isIOS && !isStandalone && !store.get('iosTipDismissed', false)) {
  els.iosTip.hidden = false;
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/* ---------------- init ---------------- */
applyTechniqueAccent(state.technique);
renderTechniqueList();
renderDurationList();
setSoundUI(els.soundToggle, state.sound);
setSoundUI(els.sessionSoundBtn, state.sound);
audio.setMuted(!state.sound);
requestAnimationFrame(tick);

})();
