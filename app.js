/* BeatBloom - a browser step sequencer whose beats grow generative blooms.
   No server, no account: songs live in the URL hash. */
"use strict";

const STEPS = 16;
const TRACKS = [
  { id: "kick",  name: "Kick" },
  { id: "snare", name: "Snare" },
  { id: "hat",   name: "Hi-hat" },
  { id: "lead",  name: "Lead" },
];
// A minor pentatonic across two octaves, one note per column - every drawn
// melody stays in key by construction.
const SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27, 29, 31, 34, 36];
const BASE_FREQ = 220; // A3

const state = {
  tempo: 112,
  // pattern[track][step] = bool
  pattern: TRACKS.map(() => Array(STEPS).fill(false)),
  theme: "neon",
  playing: false,
  step: 0,
  nextNoteTime: 0,
  timer: null,
};

let audio = null;
let master = null;

function ensureAudio() {
  if (audio) return;
  audio = new (window.AudioContext || window.webkitAudioContext)();
  master = audio.createGain();
  master.gain.value = 0.9;
  master.connect(audio.destination);
}

function noiseBuffer(ctx) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function playKick(ctx, out, t) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(0.01, t + 0.5);
  g.gain.setValueAtTime(1, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  osc.connect(g).connect(out);
  osc.start(t); osc.stop(t + 0.55);
}

function playSnare(ctx, out, t) {
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.7, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  noise.connect(bp).connect(g).connect(out);
  noise.start(t); noise.stop(t + 0.25);
  const osc = ctx.createOscillator();
  osc.type = "triangle"; osc.frequency.value = 190;
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.4, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  osc.connect(g2).connect(out);
  osc.start(t); osc.stop(t + 0.15);
}

function playHat(ctx, out, t, open) {
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass"; hp.frequency.value = 7500;
  const g = ctx.createGain();
  const dur = open ? 0.3 : 0.06;
  g.gain.setValueAtTime(0.35, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  noise.connect(hp).connect(g).connect(out);
  noise.start(t); noise.stop(t + dur + 0.05);
}

function playLead(ctx, out, t, stepIdx) {
  const semis = SCALE[stepIdx % SCALE.length];
  const freq = BASE_FREQ * Math.pow(2, semis / 12);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.setValueAtTime(2400, t);
  lp.frequency.exponentialRampToValueAtTime(600, t + 0.28);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  lp.connect(g).connect(out);
  [-6, 6].forEach((det) => {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    osc.detune.value = det;
    osc.connect(lp);
    osc.start(t); osc.stop(t + 0.32);
  });
}

function triggerTrack(ctx, out, trackIdx, stepIdx, t) {
  const id = TRACKS[trackIdx].id;
  if (id === "kick") playKick(ctx, out, t);
  else if (id === "snare") playSnare(ctx, out, t);
  else if (id === "hat") playHat(ctx, out, t, stepIdx % 8 === 7);
  else playLead(ctx, out, t, stepIdx);
}

/* ---------- sequencer engine ---------- */

function stepDuration() { return 60 / state.tempo / 4; }

function scheduleStep(stepIdx, t, visualCb) {
  for (let tr = 0; tr < TRACKS.length; tr++) {
    if (state.pattern[tr][stepIdx]) {
      triggerTrack(audio, master, tr, stepIdx, t);
      const delay = Math.max(0, (t - audio.currentTime) * 1000);
      setTimeout(() => visualCb(tr, stepIdx), delay);
    }
  }
  setTimeout(() => paintPlayhead(stepIdx), Math.max(0, (t - audio.currentTime) * 1000));
}

function scheduler() {
  while (state.nextNoteTime < audio.currentTime + 0.12) {
    scheduleStep(state.step, state.nextNoteTime, bloomAt);
    state.nextNoteTime += stepDuration();
    state.step = (state.step + 1) % STEPS;
  }
}

async function togglePlay() {
  ensureAudio();
  if (audio.state === "suspended") await audio.resume();
  state.playing = !state.playing;
  const btn = document.getElementById("playBtn");
  if (state.playing) {
    state.step = 0;
    state.nextNoteTime = audio.currentTime + 0.06;
    state.timer = setInterval(scheduler, 25);
    btn.textContent = "■ Stop";
    btn.classList.add("playing");
  } else {
    clearInterval(state.timer);
    paintPlayhead(-1);
    btn.textContent = "▶ Play";
    btn.classList.remove("playing");
  }
}

/* ---------- visualizer ---------- */

const canvas = document.getElementById("bloom");
const cx2d = canvas.getContext("2d");
const PALETTES = {
  neon:   ["#38e1ff", "#ff5ca8", "#9d6bff", "#5cff9d"],
  sunset: ["#ffb347", "#ff6b6b", "#ffd166", "#ff8fa3"],
  mono:   ["#e8e8e8", "#9a9a9a", "#c8c8c8", "#6f6f6f"],
};
let blooms = [];

function bloomAt(trackIdx, stepIdx) {
  const color = PALETTES[state.theme][trackIdx % 4];
  const x = ((stepIdx + 0.5) / STEPS) * canvas.width;
  const y = canvas.height * (0.18 + trackIdx * 0.22);
  blooms.push({ x, y, r: 4, max: 46 + trackIdx * 14, color, alpha: 1 });
}

function paintPlayhead(stepIdx) {
  document.querySelectorAll(".cell.playhead").forEach((c) => c.classList.remove("playhead"));
  if (stepIdx < 0) return;
  document.querySelectorAll(`.cell[data-step="${stepIdx}"]`).forEach((c) => c.classList.add("playhead"));
}

// Gentle ambient blooms so the stage is alive before the first note.
const REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
setInterval(() => {
  if (REDUCED || state.playing || blooms.length > 0) return;
  const theme = PALETTES[state.theme];
  blooms.push({
    x: canvas.width * (0.15 + Math.random() * 0.7),
    y: canvas.height * (0.15 + Math.random() * 0.7),
    r: 3, max: 24 + Math.random() * 20,
    color: theme[Math.floor(Math.random() * theme.length)], alpha: 0.55,
  });
}, 1400);

function drawFrame() {
  cx2d.fillStyle = getComputedStyle(document.body).getPropertyValue("--panel");
  cx2d.fillRect(0, 0, canvas.width, canvas.height);
  blooms = blooms.filter((b) => b.alpha > 0.02);
  for (const b of blooms) {
    b.r += (b.max - b.r) * 0.08;
    b.alpha *= 0.955;
    cx2d.globalAlpha = b.alpha;
    cx2d.strokeStyle = b.color;
    cx2d.lineWidth = 2.5;
    cx2d.beginPath();
    cx2d.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    cx2d.stroke();
    // petals
    for (let p = 0; p < 6; p++) {
      const a = (p / 6) * Math.PI * 2 + b.r * 0.02;
      cx2d.beginPath();
      cx2d.arc(b.x + Math.cos(a) * b.r, b.y + Math.sin(a) * b.r, b.r * 0.22, 0, Math.PI * 2);
      cx2d.stroke();
    }
  }
  cx2d.globalAlpha = 1;
  requestAnimationFrame(drawFrame);
}

/* ---------- grid UI ---------- */

function buildGrid() {
  const nums = document.getElementById("stepNumbers");
  for (let s = 0; s < STEPS; s++) {
    const el = document.createElement("div");
    el.textContent = s + 1;
    nums.appendChild(el);
  }
  const wrap = document.getElementById("tracks");
  TRACKS.forEach((track, tr) => {
    const row = document.createElement("div");
    row.className = "track";
    const label = document.createElement("div");
    label.className = "track-name";
    label.textContent = track.name;
    const cells = document.createElement("div");
    cells.className = "cells";
    for (let s = 0; s < STEPS; s++) {
      const c = document.createElement("button");
      c.className = "cell" + (s % 4 === 0 ? " beat4" : "");
      c.dataset.track = tr;
      c.dataset.step = s;
      c.setAttribute("aria-label", `${track.name} step ${s + 1}`);
      c.addEventListener("click", () => {
        state.pattern[tr][s] = !state.pattern[tr][s];
        c.classList.toggle("on", state.pattern[tr][s]);
        if (state.pattern[tr][s]) { ensureAudio(); triggerTrack(audio, master, tr, s, audio.currentTime); bloomAt(tr, s); }
      });
      cells.appendChild(c);
    }
    row.appendChild(label);
    row.appendChild(cells);
    wrap.appendChild(row);
  });
}

function refreshGrid() {
  document.querySelectorAll(".cell").forEach((c) => {
    const tr = +c.dataset.track, s = +c.dataset.step;
    c.classList.toggle("on", state.pattern[tr][s]);
  });
}

/* ---------- share link (URL hash) ---------- */

function encodeState() {
  // 4 rows x 16 bits -> 8 bytes, plus tempo and theme.
  const bytes = new Uint8Array(10);
  for (let tr = 0; tr < 4; tr++) {
    let bits = 0;
    for (let s = 0; s < STEPS; s++) if (state.pattern[tr][s]) bits |= 1 << s;
    bytes[tr * 2] = bits & 0xff;
    bytes[tr * 2 + 1] = (bits >> 8) & 0xff;
  }
  bytes[8] = state.tempo;
  bytes[9] = { neon: 0, sunset: 1, mono: 2 }[state.theme] || 0;
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeState(str) {
  try {
    const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    if (bytes.length !== 10) return false;
    for (let tr = 0; tr < 4; tr++) {
      const bits = bytes[tr * 2] | (bytes[tr * 2 + 1] << 8);
      for (let s = 0; s < STEPS; s++) state.pattern[tr][s] = !!(bits & (1 << s));
    }
    state.tempo = Math.min(180, Math.max(70, bytes[8] || 112));
    state.theme = ["neon", "sunset", "mono"][bytes[9]] || "neon";
    return true;
  } catch { return false; }
}

/* ---------- WAV export (renders the exact current song) ---------- */

async function exportWav(bars = 4) {
  const sr = 44100;
  const seconds = bars * 16 * stepDuration() + 0.6;
  const off = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
  const out = off.createGain();
  out.gain.value = 0.9;
  out.connect(off.destination);
  let t = off.currentTime + 0.05;
  for (let i = 0; i < bars * 16; i++) {
    const stepIdx = i % STEPS;
    for (let tr = 0; tr < TRACKS.length; tr++) {
      if (state.pattern[tr][stepIdx]) triggerTrack(off, out, tr, stepIdx, t);
    }
    t += stepDuration();
  }
  const rendered = await off.startRendering();
  const blob = bufferToWav(rendered);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "beatbloom.wav";
  a.click();
  URL.revokeObjectURL(a.href);
}

function bufferToWav(buffer) {
  const nCh = 2, sr = buffer.sampleRate, len = buffer.length * nCh * 2;
  const buf = new ArrayBuffer(44 + len);
  const v = new DataView(buf);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, "RIFF"); v.setUint32(4, 36 + len, true); wstr(8, "WAVE"); wstr(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * nCh * 2, true); v.setUint16(32, nCh * 2, true);
  v.setUint16(34, 16, true); wstr(36, "data"); v.setUint32(40, len, true);
  const ch0 = buffer.getChannelData(0), ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
  let o = 44;
  for (let i = 0; i < buffer.length; i++) {
    v.setInt16(o, Math.max(-1, Math.min(1, ch0[i])) * 0x7fff, true); o += 2;
    v.setInt16(o, Math.max(-1, Math.min(1, ch1[i])) * 0x7fff, true); o += 2;
  }
  return new Blob([buf], { type: "audio/wav" });
}

/* ---------- presets, controls, boot ---------- */

const PRESETS = {
  bloom: {
    tempo: 112,
    kick:  [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
    snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    hat:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,1],
    lead:  [1,0,0,1, 0,0,1,0, 0,1,0,0, 1,0,0,1],
  },
  night: {
    tempo: 96,
    kick:  [1,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,0,0],
    snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,1,0],
    hat:   [1,1,0,1, 1,1,0,1, 1,1,0,1, 1,1,0,1],
    lead:  [0,0,1,0, 0,1,0,0, 1,0,0,0, 0,0,1,0],
  },
};

function applyPattern(p) {
  TRACKS.forEach((t, i) => { state.pattern[i] = p[t.id].map(Boolean); });
  state.tempo = p.tempo;
  document.getElementById("tempo").value = p.tempo;
  document.getElementById("tempoVal").textContent = p.tempo;
  refreshGrid();
}

function setTheme(theme) {
  state.theme = theme;
  document.body.dataset.theme = theme;
  document.querySelectorAll("[data-themebtn]").forEach((b) => b.classList.toggle("on", b.dataset.themebtn === theme));
}

function boot() {
  buildGrid();
  const hash = location.hash.slice(1);
  if (hash && decodeState(hash)) {
    setTheme(state.theme);
    document.getElementById("tempo").value = state.tempo;
    document.getElementById("tempoVal").textContent = state.tempo;
    refreshGrid();
  } else {
    applyPattern(PRESETS.bloom);
  }
  document.getElementById("playBtn").addEventListener("click", togglePlay);
  document.getElementById("tempo").addEventListener("input", (e) => {
    state.tempo = +e.target.value;
    document.getElementById("tempoVal").textContent = state.tempo;
  });
  document.getElementById("preset1").addEventListener("click", () => applyPattern(PRESETS.bloom));
  document.getElementById("preset2").addEventListener("click", () => applyPattern(PRESETS.night));
  document.getElementById("randomize").addEventListener("click", () => {
    const dens = [0.3, 0.25, 0.55, 0.3];
    TRACKS.forEach((t, i) => { state.pattern[i] = state.pattern[i].map(() => Math.random() < dens[i]); });
    refreshGrid();
  });
  document.getElementById("clear").addEventListener("click", () => {
    state.pattern = TRACKS.map(() => Array(STEPS).fill(false));
    refreshGrid();
  });
  document.getElementById("share").addEventListener("click", async (e) => {
    const url = location.origin + location.pathname + "#" + encodeState();
    try { await navigator.clipboard.writeText(url); e.target.textContent = "Link copied!"; }
    catch { prompt("Copy your song link:", url); }
    setTimeout(() => { e.target.textContent = "Copy share link"; }, 1600);
  });
  document.getElementById("exportWav").addEventListener("click", () => exportWav(4));
  const muteBtn = document.getElementById("muteBtn");
  muteBtn.addEventListener("click", () => {
    ensureAudio();
    const muted = master.gain.value > 0;
    master.gain.setValueAtTime(muted ? 0 : 0.9, audio.currentTime);
    muteBtn.textContent = muted ? "🔇 Muted" : "🔊 Sound";
    muteBtn.setAttribute("aria-pressed", String(muted));
  });
  document.querySelectorAll("[data-themebtn]").forEach((b) => b.addEventListener("click", () => setTheme(b.dataset.themebtn)));
  drawFrame();
}

document.addEventListener("DOMContentLoaded", boot);
