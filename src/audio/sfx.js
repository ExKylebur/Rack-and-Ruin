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
        // hollow, disappointed thud for a scratch
        this.noiseBurst({ duration: 0.07, level: 0.22, hp: 90, lp: 900 });
        this.tone({ type: 'triangle', freq: 190, freqTo: 62, duration: 0.22, level: 0.16 });
        this.tone({ type: 'sine', freq: 130, freqTo: 55, duration: 0.3, level: 0.12, delay: 0.05 });
        return;
      }
      // leather-pocket thunk…
      this.noiseBurst({ duration: 0.045, level: 0.18, hp: 140, lp: 1500 });
      this.tone({ type: 'sine', freq: 255, freqTo: 105, duration: 0.13, level: 0.14 });
      // …then the ball rattling away down the return: softening wooden knocks
      [0.09, 0.18, 0.29].forEach((d, i) => {
        this.tone({ type: 'triangle', freq: 330 - i * 62, freqTo: 150 - i * 28, duration: 0.05, level: 0.09 - i * 0.024, delay: d });
        this.noiseBurst({ duration: 0.02, level: 0.06 - i * 0.016, hp: 400, lp: 2600, delay: d });
      });
    }

    // Springy launch chirp for a jump shot…
    jump(power) {
      if (!this.canPlay('jump', 80)) return;
      const p = clamp(power == null ? 0.5 : power, 0, 1);
      this.noiseBurst({ duration: 0.04, level: 0.12 + p * 0.1, hp: 500, lp: 5200 });
      this.tone({ type: 'sine', freq: 230, freqTo: 540 + p * 320, duration: 0.16, level: 0.14 });
      this.tone({ type: 'triangle', freq: 150, freqTo: 90, duration: 0.08, level: 0.1 });
    }

    // …and the felt thud when it touches back down.
    land(impact) {
      if (!this.canPlay('land', 60)) return;
      const q = clamp(impact == null ? 0.5 : impact, 0, 1);
      this.noiseBurst({ duration: 0.05, level: 0.12 + q * 0.12, hp: 100, lp: 1100 });
      this.tone({ type: 'triangle', freq: 170 + q * 60, freqTo: 70, duration: 0.12, level: 0.1 + q * 0.08 });
    }

    // Soft UI tick for buttons / card plays.
    click() {
      if (!this.canPlay('click', 50)) return;
      this.noiseBurst({ duration: 0.018, level: 0.05, hp: 1500, lp: 9000 });
      this.tone({ type: 'sine', freq: 740, freqTo: 540, duration: 0.045, level: 0.06 });
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
      // Thematic cues for the rest.
      switch (id) {
        case 'turbo': this.zap(0.7); return;
        case 'crosswind': this.whoosh(0.6); return;
        case 'ice_patch': case 'cool_hands': this.freeze(0.6); return;
        case 'mud_patch': this.squelch(0.7); return;
        case 'magnet': this.hum(0.6); return;
        case 'oil_cue': this.drip(0.6); return;
        case 'sticky': this.squelch(0.4); return;
        case 'bouncer': this.boing(0.5); return;
        case 'roid_rage':
          this.tone({ type: 'sawtooth', freq: 110, freqTo: 240, duration: 0.22, level: 0.16 });
          this.tone({ type: 'square', freq: 220, freqTo: 330, duration: 0.16, level: 0.08, delay: 0.04 });
          return;
        case 'reverse_spin':
          this.tone({ type: 'triangle', freq: 700, freqTo: 240, duration: 0.18, level: 0.13 });
          return;
        case 'drunk':
          this.tone({ type: 'sine', freq: 300, freqTo: 250, duration: 0.3, level: 0.13 });
          this.tone({ type: 'sine', freq: 307, freqTo: 243, duration: 0.3, level: 0.1, delay: 0.01 }); // detuned wobble
          return;
        case 'big_ball': this.tone({ type: 'sine', freq: 180, freqTo: 90, duration: 0.2, level: 0.16 }); return;
        case 'small_ball': this.tone({ type: 'sine', freq: 520, freqTo: 1040, duration: 0.14, level: 0.12 }); return;
        case 'heavyweight': this.tone({ type: 'triangle', freq: 130, freqTo: 70, duration: 0.2, level: 0.16 }); return;
        case 'lightweight': this.tone({ type: 'sine', freq: 760, freqTo: 1180, duration: 0.14, level: 0.1 }); return;
        case 'fog_of_war': this.whoosh(0.35); return;
        case 'cloak': this.tone({ type: 'sine', freq: 600, freqTo: 180, duration: 0.22, level: 0.12 }); return;
        case 'confusion':
          this.tone({ type: 'sine', freq: 500, freqTo: 620, duration: 0.1, level: 0.1 });
          this.tone({ type: 'sine', freq: 420, freqTo: 320, duration: 0.12, level: 0.09, delay: 0.05 });
          return;
        case 'shortsighted': this.tone({ type: 'sine', freq: 320, freqTo: 200, duration: 0.16, level: 0.1 }); return;
        default: break;
      }
      // Default card cue.
      this.noiseBurst({ duration: 0.04, level: 0.08, hp: 700, lp: 4600 });
      this.tone({ type: 'sine', freq: 520, freqTo: 820, duration: 0.08, level: 0.1, delay: 0.01 });
    }

    win() {
      // rising C-major fanfare with an octave sparkle on each note
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        this.tone({ type: 'triangle', freq: f, freqTo: f, duration: 0.34, level: 0.16, delay: i * 0.11 });
        this.tone({ type: 'sine', freq: f * 2, freqTo: f * 2, duration: 0.2, level: 0.05, delay: i * 0.11 + 0.01 });
      });
      this.noiseBurst({ duration: 0.22, level: 0.05, hp: 3500, lp: 13000, delay: 0.44 });
      this.tone({ type: 'sine', freq: 1046.5, freqTo: 1568, duration: 0.5, level: 0.1, delay: 0.5 });
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

    // Electric crackle for Turbo.
    zap(level) {
      const lv = clamp(level == null ? 0.6 : level, 0, 1);
      this.tone({ type: 'square', freq: 1600, freqTo: 220, duration: 0.12, level: 0.06 + lv * 0.1 });
      this.tone({ type: 'sawtooth', freq: 900, freqTo: 2600, duration: 0.08, level: 0.05 + lv * 0.08, delay: 0.02 });
      this.noiseBurst({ duration: 0.05, level: 0.08 + lv * 0.12, hp: 2500, lp: 12000, delay: 0.01 });
    }

    // Airy gust for Crosswind / Fog.
    whoosh(level) {
      const lv = clamp(level == null ? 0.5 : level, 0, 1);
      this.noiseBurst({ duration: 0.34, level: 0.06 + lv * 0.12, hp: 500, lp: 2600 });
      this.noiseBurst({ duration: 0.24, level: 0.04 + lv * 0.08, hp: 900, lp: 5200, delay: 0.06 });
    }

    // Shimmering descent for Ice / Cool Hands.
    freeze(level) {
      const lv = clamp(level == null ? 0.5 : level, 0, 1);
      [1400, 1750, 2100].forEach((f, i) => this.tone({
        type: 'sine', freq: f, freqTo: f * 0.55, duration: 0.26, level: 0.05 + lv * 0.06, delay: i * 0.04,
      }));
      this.noiseBurst({ duration: 0.1, level: 0.03 + lv * 0.05, hp: 4000, lp: 13000, delay: 0.02 });
    }

    // Wet squelch for Mud / Sticky.
    squelch(level) {
      const lv = clamp(level == null ? 0.5 : level, 0, 1);
      this.tone({ type: 'sine', freq: 240, freqTo: 90, duration: 0.16, level: 0.08 + lv * 0.1 });
      this.noiseBurst({ duration: 0.12, level: 0.05 + lv * 0.08, hp: 180, lp: 900 });
    }

    // Low magnetic hum for Magnet.
    hum(level) {
      const lv = clamp(level == null ? 0.5 : level, 0, 1);
      this.tone({ type: 'sine', freq: 90, freqTo: 90, duration: 0.4, level: 0.08 + lv * 0.1 });
      this.tone({ type: 'sine', freq: 91.5, freqTo: 91.5, duration: 0.4, level: 0.06 + lv * 0.08 }); // beat
    }

    // A single oily drip for Oil Cue.
    drip(level) {
      const lv = clamp(level == null ? 0.5 : level, 0, 1);
      this.tone({ type: 'sine', freq: 900, freqTo: 320, duration: 0.14, level: 0.07 + lv * 0.1 });
    }
  }

  window.RRAudio = new RackRuinAudio();
  window.SFX = window.RRAudio; // compatibility alias
})();
