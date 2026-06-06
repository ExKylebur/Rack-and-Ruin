(function () {
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  class RackRuinAudio {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.lastPlayed = new Map();
      this.masterLevel = 0.2;
    }

    ensureContext() {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        if (this.ctx) return this.ctx;
        const ctx = new Ctx();
        const master = ctx.createGain();
        master.gain.value = this.masterLevel;
        master.connect(ctx.destination);
        this.ctx = ctx;
        this.master = master;
        return ctx;
      } catch (_) {
        return null;
      }
    }

    unlockFromGesture() {
      const ctx = this.ensureContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    }

    canPlay(key, minGapMs) {
      const now = performance.now();
      const last = this.lastPlayed.get(key) || -1e9;
      if ((now - last) < minGapMs) return false;
      this.lastPlayed.set(key, now);
      return true;
    }

    nodeGain(level, pan) {
      const ctx = this.ensureContext();
      if (!ctx || !this.master) return null;
      const g = ctx.createGain();
      g.gain.value = level;
      const usePan = typeof pan === 'number' && Number.isFinite(pan) && typeof ctx.createStereoPanner === 'function';
      if (usePan) {
        const p = ctx.createStereoPanner();
        p.pan.value = clamp(pan, -1, 1);
        g.connect(p);
        p.connect(this.master);
      } else {
        g.connect(this.master);
      }
      return g;
    }

    tone(opts) {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const t0 = ctx.currentTime + (opts.delay || 0);
      const dur = Math.max(0.02, opts.duration || 0.12);
      const out = this.nodeGain(clamp(opts.level == null ? 0.4 : opts.level, 0, 1), opts.pan);
      if (!out) return;

      const osc = ctx.createOscillator();
      osc.type = opts.type || 'sine';
      const f0 = clamp(opts.freq || 220, 20, 22000);
      osc.frequency.setValueAtTime(f0, t0);
      if (opts.freqTo != null) {
        osc.frequency.exponentialRampToValueAtTime(clamp(opts.freqTo, 20, 22000), t0 + dur);
      }

      const attack = Math.max(0.001, opts.attack || 0.002);
      const decay = Math.max(0.01, dur - attack);
      out.gain.setValueAtTime(0.0001, t0);
      out.gain.linearRampToValueAtTime(clamp(opts.level == null ? 0.4 : opts.level, 0, 1), t0 + attack);
      out.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);

      osc.connect(out);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    noiseBurst(opts) {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const t0 = ctx.currentTime + (opts.delay || 0);
      const dur = Math.max(0.02, opts.duration || 0.07);
      const out = this.nodeGain(clamp(opts.level == null ? 0.3 : opts.level, 0, 1), opts.pan);
      if (!out) return;

      const length = Math.max(64, Math.floor(ctx.sampleRate * dur));
      const buf = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);

      const src = ctx.createBufferSource();
      src.buffer = buf;

      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = clamp(opts.hp || 300, 20, 22000);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = clamp(opts.lp || 4200, 20, 22000);

      out.gain.setValueAtTime(0.0001, t0);
      out.gain.linearRampToValueAtTime(clamp(opts.level == null ? 0.3 : opts.level, 0, 1), t0 + 0.003);
      out.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      src.connect(hp);
      hp.connect(lp);
      lp.connect(out);
      src.start(t0);
      src.stop(t0 + dur + 0.01);
    }

    shot(power) {
      if (!this.canPlay('shot', 40)) return;
      const p = clamp((power || 0) / 100, 0, 1);
      this.noiseBurst({ duration: 0.03 + p * 0.035, level: 0.2 + p * 0.24, hp: 700, lp: 6000 });
      this.tone({ type: 'triangle', freq: 150 + p * 120, freqTo: 95 + p * 80, duration: 0.09 + p * 0.05, level: 0.16 + p * 0.12 });
    }

    ballHit(impact) {
      if (!this.canPlay('ball_hit', 16)) return;
      const q = clamp(impact || 0.3, 0, 1);
      const pan = (Math.random() * 2 - 1) * 0.24;
      this.noiseBurst({ duration: 0.008 + q * 0.012, level: 0.04 + q * 0.07, hp: 2200, lp: 12000, pan });
      this.tone({
        type: 'triangle',
        freq: 300 + q * 170,
        freqTo: 185 + q * 90,
        duration: 0.04 + q * 0.035,
        level: 0.03 + q * 0.055,
        pan,
      });
      // Modal ring harmonics for a realistic pool ball clack.
      const base = 660 + q * 520 + (Math.random() * 2 - 1) * 45;
      [1.0, 1.36, 1.92].forEach((ratio, i) => {
        const lv = (0.052 + q * 0.07) / (1 + i * 0.55);
        const dur = (0.032 + q * 0.042) / (1 + i * 0.12);
        const freq = base * ratio;
        this.tone({
          type: 'sine',
          freq,
          freqTo: freq * 0.72,
          duration: dur,
          level: lv,
          delay: i * 0.0018,
          pan,
        });
      });
    }

    railHit(impact, railType) {
      const kind = railType || 'rail';
      if (!this.canPlay('rail_' + kind, 22)) return;
      const q = clamp(impact || 0.35, 0, 1);
      if (kind === 'bounce_house') {
        this.boing(0.35 + q * 0.4);
        return;
      }
      if (kind === 'bear_trap') {
        this.metalTrap(0.42 + q * 0.4);
        return;
      }
      if (kind === 'dead_rail' || kind === 'dead') {
        this.noiseBurst({ duration: 0.03 + q * 0.03, level: 0.1 + q * 0.11, hp: 260, lp: 1400 });
        this.tone({ type: 'triangle', freq: 120 + q * 80, freqTo: 72 + q * 45, duration: 0.07 + q * 0.07, level: 0.06 + q * 0.08 });
        return;
      }
      this.noiseBurst({ duration: 0.03 + q * 0.03, level: 0.12 + q * 0.14, hp: 700, lp: 4200 });
      this.tone({ type: 'triangle', freq: 230 + q * 170, freqTo: 120 + q * 90, duration: 0.07 + q * 0.06, level: 0.08 + q * 0.1 });
    }

    pocket(kind) {
      if (!this.canPlay('pocket_' + (kind || 'obj'), 60)) return;
      if (kind === 'scratch' || kind === 'cue') {
        this.noiseBurst({ duration: 0.06, level: 0.2, hp: 120, lp: 1200 });
        this.tone({ type: 'triangle', freq: 210, freqTo: 80, duration: 0.16, level: 0.15 });
        return;
      }
      this.noiseBurst({ duration: 0.05, level: 0.15, hp: 180, lp: 1800 });
      this.tone({ type: 'sine', freq: 290, freqTo: 130, duration: 0.12, level: 0.1 });
    }

    cardPlayed(cardId) {
      const id = String(cardId || '');
      if (!this.canPlay('card_' + id, 55)) return;
      if (id === 'bounce_house') {
        this.boing(0.62);
        return;
      }
      if (id === 'bear_trap') {
        this.metalTrap(0.65);
        return;
      }
      if (id === 'portal') {
        this.tone({ type: 'sine', freq: 320, freqTo: 740, duration: 0.18, level: 0.16 });
        this.tone({ type: 'sine', freq: 430, freqTo: 1020, duration: 0.16, level: 0.12, delay: 0.03 });
        return;
      }
      if (id === 'warp_rail') {
        this.tone({ type: 'sawtooth', freq: 180, freqTo: 90, duration: 0.2, level: 0.14 });
        this.noiseBurst({ duration: 0.09, level: 0.12, hp: 600, lp: 3200, delay: 0.03 });
        return;
      }
      if (id === 'block_pocket' || id === 'open_pocket' || id === 'pocket_shrink' || id === 'move_hole') {
        this.tone({ type: 'triangle', freq: 420, freqTo: 250, duration: 0.1, level: 0.14 });
        this.tone({ type: 'triangle', freq: 620, freqTo: 350, duration: 0.08, level: 0.09, delay: 0.04 });
        return;
      }
      if (id === 'earthquake') {
        this.noiseBurst({ duration: 0.12, level: 0.22, hp: 60, lp: 800 });
        this.tone({ type: 'triangle', freq: 80, freqTo: 40, duration: 0.18, level: 0.18 });
        return;
      }
      // Default card cue.
      this.noiseBurst({ duration: 0.04, level: 0.08, hp: 700, lp: 4600 });
      this.tone({ type: 'sine', freq: 520, freqTo: 820, duration: 0.08, level: 0.1, delay: 0.01 });
    }

    win() {
      this.tone({ type: 'sine', freq: 523, freqTo: 1047, duration: 0.35, level: 0.22 });
      this.tone({ type: 'sine', freq: 659, freqTo: 1318, duration: 0.3, level: 0.16, delay: 0.08 });
      this.noiseBurst({ duration: 0.06, level: 0.1, hp: 800, lp: 5000, delay: 0.05 });
      this.tone({ type: 'triangle', freq: 784, freqTo: 1568, duration: 0.28, level: 0.14, delay: 0.16 });
    }

    boing(level) {
      const lv = clamp(level == null ? 0.5 : level, 0, 1);
      this.tone({ type: 'triangle', freq: 420, freqTo: 130, duration: 0.26, level: 0.1 + lv * 0.2 });
      this.tone({ type: 'sine', freq: 250, freqTo: 95, duration: 0.24, level: 0.08 + lv * 0.12, delay: 0.01 });
    }

    metalTrap(level) {
      const lv = clamp(level == null ? 0.6 : level, 0, 1);
      this.noiseBurst({ duration: 0.03, level: 0.16 + lv * 0.16, hp: 1200, lp: 8200 });
      this.tone({ type: 'square', freq: 1120, freqTo: 510, duration: 0.1, level: 0.08 + lv * 0.11 });
      this.tone({ type: 'triangle', freq: 770, freqTo: 250, duration: 0.12, level: 0.08 + lv * 0.1, delay: 0.015 });
    }
  }

  window.RRAudio = new RackRuinAudio();
  window.SFX = window.RRAudio; // compatibility alias
})();
