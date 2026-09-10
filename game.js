(() => {
  "use strict";

  // ==========================================================================
  // CONFIG
  // ==========================================================================

  const STORAGE_KEY = "modiFlappySettings";
  const BG_MUSIC_FILE = "assets/audio/theme.mp3";
  const CRASH_SFX_FILE = "assets/audio/flap.mp3";
  // The theme opens with a groan and a quiet lead-in; the first musical phrase
  // attacks at 1.63s, so both playback and looping start just before it.
  const MUSIC_LOOP_START = 1.61;

  const DEFAULT_SETTINGS = {
    musicVolume: 0.45,
    sfxVolume: 0.8,
    flapKey: "Space",
    flapAltKey: "ArrowUp",
    restartKey: "KeyR",
    quality: "auto",
    highScore: 0,
  };

  // Logical play area. All drawing and physics use these units; the backing
  // canvas is scaled by devicePixelRatio on top (see setupCanvas).
  const W = 540;
  const H = 810;
  const GROUND_H = 35;
  const FLOOR_Y = H - GROUND_H;

  // The simulation runs at a fixed 60 steps/sec regardless of refresh rate, so
  // every constant below is "per step" and means the same thing on every machine.
  const STEP_MS = 1000 / 60;
  const MAX_FRAME_MS = 250; // clamp tab-switch stalls
  const MAX_STEPS_PER_FRAME = 5; // guard the spiral of death

  const GRAVITY = 0.38;
  const FLAP = -9.87;
  const BIRD_X = 108;
  const BIRD_R = 16; // forgiving hitbox radius
  // The character is drawn at this fraction of its authored size. The art was
  // authored large and drifted larger during iteration, leaving the silhouette
  // ~1.7x the hitbox -- which reads as much harder than the game actually is.
  const MODI_SCALE = 0.75;
  const MAX_FALL = 13;

  const PIPE_WIDTH = 81;
  const SPAWN_X = 560; // just off the right edge; pipe spacing is measured from here
  const PIPE_COLLAR = 45; // collar sits INSIDE the body extent, never past the gap edge
  const PIPE_TILE = 70; // rivet band period

  // Difficulty ramp. Gameplay geometry only -- never touched by quality tiers.
  const GAP_START = 221;
  const GAP_END = 171;
  const GAP_AT = 25;
  const SPEED_START = 2.7;
  const SPEED_END = 3.8;
  const SPEED_AT = 30;
  const SPACING_START = 338;
  const SPACING_END = 281;
  const SPACING_AT = 30;
  const MAX_CENTER_DELTA = 135;

  const GRACE_STEPS = 72; // ~1.2s
  const EDGE_MARGIN = 78; // keep gap centres away from ceiling/floor

  const LAYER_W = { clouds: 1080, far: 756, mid: 864, near: 972, wires: 810 };
  const PARALLAX = { clouds: 0.06, far: 0.16, mid: 0.34, wires: 0.46, near: 0.62 };

  const TIERS = {
    low: { far: false, wires: false, smoke: 0, motes: 0, crows: false, puddles: false, particles: false, drips: 0.4 },
    medium: { far: true, wires: true, smoke: 3, motes: 0, crows: false, puddles: false, particles: true, drips: 0.7 },
    high: { far: true, wires: true, smoke: 5, motes: 26, crows: true, puddles: true, particles: true, drips: 1 },
  };

  // ==========================================================================
  // DOM
  // ==========================================================================

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const hintEl = document.getElementById("hint");
  const graceEl = document.getElementById("grace");
  const mainMenu = document.getElementById("main-menu");
  const gameOverPanel = document.getElementById("game-over");
  const gameOverMsg = document.getElementById("game-over-msg");
  const gameOverBest = document.getElementById("game-over-best");
  const menuBest = document.getElementById("menu-best");
  const settingsPanel = document.getElementById("settings");
  const menuStartBtn = document.getElementById("menu-start");
  const menuSettingsBtn = document.getElementById("menu-settings");
  const retryBtn = document.getElementById("retry");
  const goMainBtn = document.getElementById("go-main");
  const goSettingsBtn = document.getElementById("go-settings");
  const settingsBackBtn = document.getElementById("settings-back");
  const settingsResetBtn = document.getElementById("settings-reset");
  const musicVolInput = document.getElementById("music-vol");
  const sfxVolInput = document.getElementById("sfx-vol");
  const musicVolVal = document.getElementById("music-vol-val");
  const sfxVolVal = document.getElementById("sfx-vol-val");
  const qualitySelect = document.getElementById("quality");
  const bindFlapBtn = document.getElementById("bind-flap");
  const bindFlapAltBtn = document.getElementById("bind-flap-alt");
  const bindRestartBtn = document.getElementById("bind-restart");

  // ==========================================================================
  // STATE
  // ==========================================================================

  let settings = loadSettings();
  let listeningFor = null;
  /** @type {"menu"|"playing"|"dead"|"settings"} */
  let state = "menu";
  let returnAfterSettings = "menu";
  let score = 0;
  let lastTime = 0;
  let accumulator = 0;
  let scrollX = 0; // world scroll in px, drives every parallax layer
  let graceSteps = 0;
  let paused = false;
  let flapAnim = 0; // counts down after a flap, drives the arm sprite
  let shake = 0;
  let flash = 0;
  let tier = "high";
  let sprites = null;

  const bird = { y: H / 2, vy: 0, rot: 0, bob: 0 };
  const pipes = [];
  const particles = [];
  const popups = [];
  const motes = [];
  const smoke = [];
  const crows = [];

  let lastGapCenter = H / 2;
  let pipeSeq = 0;

  // ==========================================================================
  // SETTINGS
  // ==========================================================================

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* private browsing -- settings just won't persist */
    }
    applySettingsToUI();
    applyAudioVolumes();
    updateHint();
  }

  function keyLabel(code) {
    const labels = {
      Space: "Space",
      ArrowUp: "↑",
      ArrowDown: "↓",
      ArrowLeft: "←",
      ArrowRight: "→",
      Enter: "Enter",
      ShiftLeft: "Shift",
      ShiftRight: "Shift",
    };
    return labels[code] || code.replace(/^Key/, "");
  }

  function applySettingsToUI() {
    musicVolInput.value = String(Math.round(settings.musicVolume * 100));
    sfxVolInput.value = String(Math.round(settings.sfxVolume * 100));
    musicVolVal.textContent = `${musicVolInput.value}%`;
    sfxVolVal.textContent = `${sfxVolInput.value}%`;
    qualitySelect.value = settings.quality;
    bindFlapBtn.textContent = keyLabel(settings.flapKey);
    bindFlapAltBtn.textContent = keyLabel(settings.flapAltKey);
    bindRestartBtn.textContent = keyLabel(settings.restartKey);
    menuBest.textContent = `Best: ${settings.highScore}`;
  }

  function updateHint() {
    hintEl.textContent = `${keyLabel(settings.flapKey)} / ${keyLabel(settings.flapAltKey)} to flap · ${keyLabel(settings.restartKey)} to restart`;
  }

  function isFlapKey(code) {
    return code === settings.flapKey || code === settings.flapAltKey;
  }

  // ==========================================================================
  // MATH HELPERS
  // ==========================================================================

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  function ramp(from, to, at, value) {
    return lerp(from, to, clamp(value / at, 0, 1));
  }

  function seededRandom(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  // Difficulty is a pure function of score, so it is identical on every machine
  // and every quality tier.
  const gapFor = (s) => ramp(GAP_START, GAP_END, GAP_AT, s);
  const speedFor = (s) => ramp(SPEED_START, SPEED_END, SPEED_AT, s);
  const spacingFor = (s) => ramp(SPACING_START, SPACING_END, SPACING_AT, s);

  // ==========================================================================
  // SPRITES
  //
  // Every static element is rasterised once into an offscreen canvas here and
  // blitted at draw time. This is what keeps the frame budget at roughly two
  // dozen drawImage calls instead of several hundred path operations.
  // ==========================================================================

  let RENDER_SCALE = 1;

  function makeSprite(w, h, drawFn) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w * RENDER_SCALE));
    c.height = Math.max(1, Math.ceil(h * RENDER_SCALE));
    const g = c.getContext("2d");
    g.scale(RENDER_SCALE, RENDER_SCALE);
    g.lineJoin = "round";
    g.lineCap = "round";
    drawFn(g, w, h);
    c.lw = w;
    c.lh = h;
    return c;
  }

  // Draws an item into a seamless strip: anything crossing a strip edge is also
  // drawn on the opposite side, so the two-blit wrap at render time is exact.
  function wrapped(item, layerW, render) {
    render(item.x);
    if (item.x + item.w > layerW) render(item.x - layerW);
    if (item.x < 0) render(item.x + layerW);
  }

  function roundRect(g, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
  }

  // --- Sky -------------------------------------------------------------------
  // Cached gradient objects rather than a full-screen texture: a handful of
  // fillRects is cheaper than a 540x810 blit and costs no VRAM.

  let skyGrad = null;
  let sunGrad = null;
  let hazeGrad = null;
  let vignetteGrad = null;

  function buildSkyGradients() {
    skyGrad = ctx.createLinearGradient(0, 0, 0, FLOOR_Y);
    skyGrad.addColorStop(0.0, "#5b6b82");
    skyGrad.addColorStop(0.28, "#8a8f96");
    skyGrad.addColorStop(0.55, "#b99f81");
    skyGrad.addColorStop(0.78, "#d9b183");
    skyGrad.addColorStop(1.0, "#c98f5e");

    sunGrad = ctx.createRadialGradient(W * 0.72, H * 0.42, 6, W * 0.72, H * 0.42, 150);
    sunGrad.addColorStop(0, "rgba(255, 226, 168, 0.85)");
    sunGrad.addColorStop(0.28, "rgba(249, 199, 133, 0.34)");
    sunGrad.addColorStop(1, "rgba(240, 180, 120, 0)");

    hazeGrad = ctx.createLinearGradient(0, H * 0.42, 0, FLOOR_Y);
    hazeGrad.addColorStop(0, "rgba(214, 180, 142, 0)");
    hazeGrad.addColorStop(1, "rgba(214, 180, 142, 0.42)");

    vignetteGrad = ctx.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.78);
    vignetteGrad.addColorStop(0, "rgba(0,0,0,0)");
    vignetteGrad.addColorStop(1, "rgba(20, 12, 6, 0.42)");
  }

  // --- Smog bands drifting across the upper sky ------------------------------

  function buildClouds() {
    const lw = LAYER_W.clouds;
    const lh = 340;
    return makeSprite(lw, lh, (g) => {
      const rng = seededRandom(60613);
      // Wide and very flat: smog strata, not cotton-wool clouds. Anything close
      // to circular reads as a grey blob against this sky.
      for (let i = 0; i < 13; i++) {
        const c = { x: rng() * lw, w: 260 + rng() * 380 };
        const y = 26 + rng() * (lh - 70);
        const h = 7 + rng() * 13;
        const a = 0.025 + rng() * 0.04;
        wrapped(c, lw, (cx) => {
          for (let k = 0; k < 7; k++) {
            const kx = cx + (k / 6) * c.w;
            const ky = y + Math.sin(k * 1.3 + i * 2.1) * h * 0.5;
            const taper = Math.sin((k / 6) * Math.PI); // fade out at both ends
            g.fillStyle = `rgba(240, 220, 192, ${a * taper})`;
            g.beginPath();
            g.ellipse(kx, ky, c.w * 0.22, h * (0.7 + rng() * 0.4), 0, 0, Math.PI * 2);
            g.fill();
          }
        });
      }
    });
  }

  // --- Far layer: hazed Mumbai high-rises -----------------------------------

  function buildSkyline() {
    const lw = LAYER_W.far;
    const lh = 340;
    return makeSprite(lw, lh, (g) => {
      const rng = seededRandom(1337);
      const towers = [];
      let x = -40;
      while (x < lw + 40) {
        const w = 28 + rng() * 50;
        // Wide height spread, so the skyline has a real silhouette instead of
        // reading as one flat grey wall.
        const tall = rng() > 0.62;
        towers.push({
          x,
          w,
          h: tall ? 190 + rng() * 130 : 90 + rng() * 90,
          tank: rng() > 0.6,
          mast: rng() > 0.66,
          step: rng() > 0.7,
          tone: rng(),
        });
        x += w + 5 + rng() * 26;
      }

      for (const t of towers) {
        wrapped(t, lw, (tx) => {
          const y = lh - t.h;
          const shade = 74 + t.tone * 24;
          g.fillStyle = `rgba(${shade}, ${shade + 10}, ${shade + 28}, 0.82)`;
          g.fillRect(tx, y, t.w, t.h);

          // faint window grid -- barely visible through the smog
          g.fillStyle = "rgba(228, 214, 186, 0.13)";
          for (let wy = y + 9; wy < lh - 8; wy += 13) {
            for (let wx = tx + 5; wx < tx + t.w - 6; wx += 9) {
              if ((wx + wy) % 3 === 0) g.fillRect(wx, wy, 4, 6);
            }
          }

          g.fillStyle = `rgba(${shade - 16}, ${shade - 8}, ${shade + 8}, 0.7)`;
          g.fillRect(tx, y, t.w, 4);

          if (t.step) {
            // setback crown -- breaks up the flat-topped repetition
            g.fillStyle = `rgba(${shade - 6}, ${shade + 4}, ${shade + 22}, 0.85)`;
            g.fillRect(tx + t.w * 0.16, y - 16, t.w * 0.68, 16);
            g.fillRect(tx + t.w * 0.34, y - 26, t.w * 0.32, 10);
          }
          if (t.tank) {
            g.fillRect(tx + t.w * 0.28, y - 11, t.w * 0.32, 11);
          }
          if (t.mast) {
            g.fillRect(tx + t.w * 0.5 - 1, y - 26, 2, 26);
            g.fillStyle = "rgba(226, 96, 72, 0.5)";
            g.fillRect(tx + t.w * 0.5 - 2, y - 28, 4, 4);
          }
        });
      }

      // atmospheric perspective: wash toward the sky colour, but lightly enough
      // that the skyline still reads as a silhouette
      const wash = g.createLinearGradient(0, 0, 0, lh);
      wash.addColorStop(0, "rgba(198, 172, 144, 0.16)");
      wash.addColorStop(1, "rgba(208, 170, 130, 0.42)");
      g.fillStyle = wash;
      g.fillRect(0, 0, lw, lh);
    });
  }

  // --- Mid layer: stacked slum blocks ---------------------------------------

  const WALL_COLORS = ["#c2857f", "#9db29e", "#c4a56d", "#8fa3b6", "#c9b795", "#b58a6a", "#a8967f"];
  const TARP_BLUE = "#2f6fb5";

  function paintTin(g, x, y, w, h, base, dark) {
    g.fillStyle = base;
    g.fillRect(x, y, w, h);
    g.strokeStyle = dark;
    g.lineWidth = 1;
    for (let rx = x + 3; rx < x + w; rx += 6) {
      g.beginPath();
      g.moveTo(rx, y);
      g.lineTo(rx, y + h);
      g.stroke();
    }
  }

  function paintTarp(g, x, y, w, rng) {
    g.fillStyle = TARP_BLUE;
    g.beginPath();
    g.moveTo(x, y + 6);
    g.quadraticCurveTo(x + w * 0.3, y - 3, x + w * 0.55, y + 4);
    g.quadraticCurveTo(x + w * 0.8, y + 10, x + w, y + 2);
    g.lineTo(x + w, y + 15);
    g.lineTo(x, y + 19);
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.16)";
    g.fillRect(x + w * 0.2, y + 5, w * 0.24, 3);
    // tyres and bricks holding it down
    g.fillStyle = "#22242a";
    for (let i = 0; i < 2; i++) {
      const tx = x + 6 + rng() * (w - 20);
      g.beginPath();
      g.ellipse(tx, y + 5, 6, 3.2, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "#8d5f43";
    g.fillRect(x + w * 0.62, y + 1, 9, 4);
  }

  function buildSlumMid() {
    const lw = LAYER_W.mid;
    const lh = 300;
    return makeSprite(lw, lh, (g) => {
      const rng = seededRandom(90210);
      const blocks = [];
      let x = -30;
      while (x < lw + 30) {
        const w = 54 + rng() * 64;
        blocks.push({ x, w, h: 88 + rng() * 96, color: WALL_COLORS[(rng() * WALL_COLORS.length) | 0], tarp: rng() > 0.52, stack: rng() > 0.55, seed: rng() });
        x += w + 2 + rng() * 10;
      }

      for (const b of blocks) {
        wrapped(b, lw, (bx) => {
          const rr = seededRandom(1 + Math.floor(b.seed * 99999));
          const y = lh - b.h;

          g.fillStyle = b.color;
          g.fillRect(bx, y, b.w, b.h);
          // grime running down the wall
          g.fillStyle = "rgba(60, 48, 36, 0.18)";
          g.fillRect(bx, y + b.h * 0.62, b.w, b.h * 0.38);
          g.fillStyle = "rgba(0,0,0,0.14)";
          g.fillRect(bx + b.w - 5, y, 5, b.h);

          // windows, a few lit from inside
          for (let wy = y + 14; wy < lh - 16; wy += 26) {
            for (let wx = bx + 7; wx < bx + b.w - 12; wx += 22) {
              const lit = rr() > 0.72;
              g.fillStyle = lit ? "rgba(255, 196, 104, 0.8)" : "rgba(38, 32, 28, 0.78)";
              g.fillRect(wx, wy, 11, 13);
              g.fillStyle = "rgba(0,0,0,0.3)";
              g.fillRect(wx, wy, 11, 2);
            }
          }

          paintTin(g, bx - 3, y - 7, b.w + 6, 8, "#7c6a52", "#59493a");
          if (b.tarp) paintTarp(g, bx + 4, y - 16, b.w - 8, rr);

          if (b.stack) {
            const sw = b.w * 0.6;
            const sx = bx + b.w * 0.2;
            const sh = 34 + rr() * 26;
            g.fillStyle = WALL_COLORS[(rr() * WALL_COLORS.length) | 0];
            g.fillRect(sx, y - sh - 7, sw, sh);
            g.fillStyle = "rgba(0,0,0,0.16)";
            g.fillRect(sx + sw - 4, y - sh - 7, 4, sh);
            paintTin(g, sx - 3, y - sh - 13, sw + 6, 7, "#6e5e49", "#4e4133");
          }
        });
      }

      const wash = g.createLinearGradient(0, 0, 0, lh);
      wash.addColorStop(0, "rgba(198, 162, 124, 0.28)");
      wash.addColorStop(1, "rgba(150, 118, 88, 0.1)");
      g.fillStyle = wash;
      g.fillRect(0, 0, lw, lh);
    });
  }

  // --- Near layer: shanties with the full clutter ----------------------------

  function paintTank(g, x, y) {
    g.fillStyle = "#1d1f24";
    roundRect(g, x, y, 18, 22, 4);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,0.1)";
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      g.beginPath();
      g.moveTo(x + 1, y + i * 5);
      g.lineTo(x + 17, y + i * 5);
      g.stroke();
    }
    g.fillStyle = "#34373d";
    g.fillRect(x + 5, y - 3, 8, 3);
  }

  function paintDish(g, x, y) {
    g.strokeStyle = "#5c5850";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x, y + 12);
    g.lineTo(x, y + 2);
    g.stroke();
    g.fillStyle = "#cdc7ba";
    g.beginPath();
    g.ellipse(x, y, 8, 9, -0.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.beginPath();
    g.ellipse(x + 1.5, y, 5, 6, -0.4, 0, Math.PI * 2);
    g.fill();
  }

  function paintLadder(g, x, y, h) {
    g.strokeStyle = "#6d5334";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 3, y + h);
    g.moveTo(x + 11, y);
    g.lineTo(x + 14, y + h);
    g.stroke();
    g.lineWidth = 1.5;
    for (let i = 1; i * 9 < h; i++) {
      const ry = y + i * 9;
      g.beginPath();
      g.moveTo(x + (ry - y) * 0.03, ry);
      g.lineTo(x + 11 + (ry - y) * 0.03, ry);
      g.stroke();
    }
  }

  function paintLaundry(g, x, y, w, rng) {
    g.strokeStyle = "rgba(40, 34, 28, 0.75)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + w / 2, y + 7, x + w, y);
    g.stroke();
    const shirts = ["#d9534f", "#3d8bd6", "#e8c04a", "#e8e2d4", "#6cb26c", "#c765a8"];
    for (let i = 0; i < 4; i++) {
      const t = (i + 0.5) / 4;
      const cx = x + w * t;
      const cy = y + Math.sin(Math.PI * t) * 7;
      g.fillStyle = shirts[(rng() * shirts.length) | 0];
      g.fillRect(cx - 4, cy, 8, 11 + rng() * 5);
    }
  }

  function paintSign(g, x, y, rng) {
    const colors = ["#c8452f", "#1f6f3e", "#d5a520"];
    g.fillStyle = colors[(rng() * colors.length) | 0];
    g.fillRect(x, y, 30, 11);
    g.fillStyle = "rgba(255,255,255,0.82)";
    // abstract painted glyph strokes -- deliberately not real text
    for (let i = 0; i < 4; i++) {
      g.fillRect(x + 3 + i * 7, y + 3, 4, 1.6);
      g.fillRect(x + 3 + i * 7, y + 5.5, 2 + rng() * 3, 3);
    }
  }

  function buildSlumNear() {
    const lw = LAYER_W.near;
    const lh = 340;
    return makeSprite(lw, lh, (g) => {
      const rng = seededRandom(24680);
      const huts = [];
      let x = -40;
      while (x < lw + 40) {
        const w = 78 + rng() * 78;
        huts.push({ x, w, h: 104 + rng() * 78, color: WALL_COLORS[(rng() * WALL_COLORS.length) | 0], seed: rng() });
        x += w + 4 + rng() * 14;
      }

      for (const hut of huts) {
        wrapped(hut, lw, (hx) => {
          const rr = seededRandom(1 + Math.floor(hut.seed * 99999));
          const y = lh - hut.h;

          // half painted concrete, half corrugated tin -- the usual patchwork
          if (rr() > 0.45) {
            g.fillStyle = hut.color;
            g.fillRect(hx, y, hut.w, hut.h);
            g.fillStyle = "rgba(56, 42, 30, 0.22)";
            g.fillRect(hx, y + hut.h * 0.55, hut.w, hut.h * 0.45);
          } else {
            paintTin(g, hx, y, hut.w, hut.h, "#8a7355", "#5f4d38");
          }
          g.fillStyle = "rgba(0,0,0,0.2)";
          g.fillRect(hx + hut.w - 6, y, 6, hut.h);
          g.fillStyle = "rgba(255, 236, 200, 0.07)";
          g.fillRect(hx, y, 4, hut.h);

          // doorway + windows
          g.fillStyle = "rgba(26, 20, 16, 0.86)";
          g.fillRect(hx + hut.w * 0.14, lh - 44, 20, 44);
          g.fillStyle = "rgba(255, 190, 96, 0.55)";
          g.fillRect(hx + hut.w * 0.14 + 4, lh - 38, 12, 20);
          for (let wx = hx + hut.w * 0.45; wx < hx + hut.w - 16; wx += 26) {
            const lit = rr() > 0.6;
            g.fillStyle = lit ? "rgba(255, 198, 110, 0.72)" : "rgba(30, 25, 21, 0.8)";
            g.fillRect(wx, y + 22 + rr() * 20, 14, 16);
          }

          paintTin(g, hx - 5, y - 9, hut.w + 10, 10, "#7a6749", "#544530");
          if (rr() > 0.4) paintTarp(g, hx + 6, y - 19, hut.w - 12, rr);
          if (rr() > 0.35) paintTank(g, hx + hut.w * 0.62, y - 30);
          if (rr() > 0.5) paintDish(g, hx + hut.w * 0.28, y - 22);
          if (rr() > 0.6) paintLadder(g, hx + hut.w - 22, y + 6, hut.h - 30);
          if (rr() > 0.45) paintLaundry(g, hx + 8, y + 34, hut.w - 20, rr);
          if (rr() > 0.55) paintSign(g, hx + hut.w * 0.2, y + 12, rr);
          if (rr() > 0.7) {
            g.fillStyle = "#8e9298";
            g.fillRect(hx + hut.w * 0.7, y + 26, 15, 11);
            g.strokeStyle = "rgba(0,0,0,0.35)";
            g.lineWidth = 1;
            for (let i = 1; i < 4; i++) {
              g.beginPath();
              g.moveTo(hx + hut.w * 0.7 + 1, y + 26 + i * 3);
              g.lineTo(hx + hut.w * 0.7 + 14, y + 26 + i * 3);
              g.stroke();
            }
          }
        });
      }
      return undefined;
    });
  }

  // --- Wires -----------------------------------------------------------------

  function buildWires() {
    const lw = LAYER_W.wires;
    const lh = 210;
    return makeSprite(lw, lh, (g) => {
      const rng = seededRandom(7777);
      for (let i = 0; i < 5; i++) {
        const baseY = 26 + i * 32 + rng() * 14;
        const sag = 16 + rng() * 26;
        const strands = 2 + ((rng() * 3) | 0);
        for (let s = 0; s < strands; s++) {
          g.strokeStyle = `rgba(26, 22, 17, ${0.5 + rng() * 0.35})`;
          g.lineWidth = 1 + rng() * 1.1;
          g.beginPath();
          const y0 = baseY + s * 2.4;
          g.moveTo(0, y0);
          g.quadraticCurveTo(lw / 2, y0 + sag, lw, y0);
          g.stroke();
        }
        // a junction box or two dangling off the bundle
        if (rng() > 0.55) {
          const t = 0.25 + rng() * 0.5;
          const bx = lw * t;
          const by = baseY + sag * 2 * t * (1 - t) * 2;
          g.strokeStyle = "rgba(26, 22, 17, 0.7)";
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(bx, by);
          g.lineTo(bx, by + 9);
          g.stroke();
          g.fillStyle = "#3b3a34";
          g.fillRect(bx - 4, by + 9, 8, 10);
        }
      }
    });
  }

  // --- Ground: wet lane with an open drain -----------------------------------

  function buildGround() {
    const tileW = 180;
    const totalH = GROUND_H + 26; // includes the drain lip drawn above the floor line
    return makeSprite(tileW, totalH, (g) => {
      const rng = seededRandom(4242);
      const lip = 26;

      // open drain channel running along the near edge
      g.fillStyle = "#3b3323";
      g.fillRect(0, lip - 12, tileW, 12);
      g.fillStyle = "#20301c";
      g.fillRect(0, lip - 9, tileW, 7);
      g.fillStyle = "rgba(126, 158, 86, 0.35)";
      for (let i = 0; i < 6; i++) {
        const x = rng() * tileW;
        g.beginPath();
        g.ellipse(x, lip - 6 + rng() * 3, 5 + rng() * 9, 1.8, 0, 0, Math.PI * 2);
        g.fill();
      }

      // muddy lane
      const mud = g.createLinearGradient(0, lip, 0, totalH);
      mud.addColorStop(0, "#4a3b28");
      mud.addColorStop(0.4, "#3a2e20");
      mud.addColorStop(1, "#241c14");
      g.fillStyle = mud;
      g.fillRect(0, lip, tileW, GROUND_H);

      // ruts and debris
      g.fillStyle = "rgba(20, 15, 10, 0.5)";
      for (let i = 0; i < 10; i++) {
        g.fillRect(rng() * tileW, lip + 4 + rng() * (GROUND_H - 8), 6 + rng() * 16, 2);
      }
      g.fillStyle = "rgba(180, 165, 140, 0.22)";
      for (let i = 0; i < 14; i++) {
        g.fillRect(rng() * tileW, lip + 3 + rng() * (GROUND_H - 6), 2, 2);
      }
      g.fillStyle = "#5a4830";
      g.fillRect(0, lip, tileW, 2);
    });
  }

  function buildPuddles() {
    const tileW = 180;
    const totalH = GROUND_H + 26;
    return makeSprite(tileW, totalH, (g) => {
      const rng = seededRandom(31415);
      const lip = 26;
      // Wide, flat and sky-tinted. Small opaque ellipses here just read as
      // pebbles lying on the mud.
      for (let i = 0; i < 3; i++) {
        const px = rng() * tileW;
        const py = lip + 10 + rng() * (GROUND_H - 18);
        const pw = 26 + rng() * 34;

        // dark wet rim
        g.fillStyle = "rgba(18, 14, 9, 0.45)";
        g.beginPath();
        g.ellipse(px, py, pw + 3, 5.4, 0, 0, Math.PI * 2);
        g.fill();
        // the water itself, reflecting the dusk sky
        const water = g.createLinearGradient(0, py - 4, 0, py + 4);
        water.addColorStop(0, "rgba(150, 154, 158, 0.62)");
        water.addColorStop(0.5, "rgba(196, 168, 132, 0.5)");
        water.addColorStop(1, "rgba(112, 96, 76, 0.55)");
        g.fillStyle = water;
        g.beginPath();
        g.ellipse(px, py, pw, 4.2, 0, 0, Math.PI * 2);
        g.fill();
        // specular streak
        g.fillStyle = "rgba(255, 232, 194, 0.42)";
        g.beginPath();
        g.ellipse(px + pw * 0.18, py - 1, pw * 0.42, 1, 0, 0, Math.PI * 2);
        g.fill();
      }
    });
  }

  // --- Sewer pipes -----------------------------------------------------------
  //
  // The body is one full-height tileable sprite so any pipe length is a single
  // blit, and the collar is drawn INSIDE the body extent so the art edge and the
  // collision edge are the same line.

  function buildPipeBody() {
    const w = PIPE_WIDTH;
    const h = H + PIPE_TILE;
    return makeSprite(w, h, (g) => {
      const rng = seededRandom(5150);

      // cylindrical form: dark edge -> mid -> specular band -> mid -> darkest edge
      const cyl = g.createLinearGradient(0, 0, w, 0);
      cyl.addColorStop(0.0, "#141c16");
      cyl.addColorStop(0.1, "#26332a");
      cyl.addColorStop(0.32, "#4e5f48");
      cyl.addColorStop(0.44, "#63755a");
      cyl.addColorStop(0.6, "#3d4b39");
      cyl.addColorStop(0.82, "#232e23");
      cyl.addColorStop(1.0, "#0e1410");
      g.fillStyle = cyl;
      g.fillRect(0, 0, w, h);

      // heavy vertical grime streaking down the whole barrel
      for (let i = 0; i < 40; i++) {
        const x = rng() * w;
        const y = rng() * h;
        const len = 40 + rng() * 180;
        const streak = g.createLinearGradient(0, y, 0, y + len);
        streak.addColorStop(0, "rgba(12, 16, 10, 0)");
        streak.addColorStop(0.3, `rgba(14, 20, 12, ${0.12 + rng() * 0.16})`);
        streak.addColorStop(1, "rgba(12, 16, 10, 0)");
        g.fillStyle = streak;
        g.fillRect(x, y, 2 + rng() * 7, len);
      }

      // aggregate speckle in the concrete
      for (let i = 0; i < 900; i++) {
        const x = rng() * w;
        const y = rng() * h;
        const a = 0.04 + rng() * 0.1;
        g.fillStyle = rng() > 0.5 ? `rgba(220, 214, 196, ${a})` : `rgba(20, 26, 20, ${a})`;
        g.fillRect(x, y, 1 + rng() * 1.6, 1 + rng() * 1.6);
      }

      // rivet bands every PIPE_TILE px, with rust bleeding down from each bolt
      for (let by = 0; by < h; by += PIPE_TILE) {
        const bandGrad = g.createLinearGradient(0, by, 0, by + 11);
        bandGrad.addColorStop(0, "rgba(30, 40, 32, 0.85)");
        bandGrad.addColorStop(0.45, "rgba(122, 136, 112, 0.75)");
        bandGrad.addColorStop(1, "rgba(28, 36, 28, 0.85)");
        g.fillStyle = bandGrad;
        g.fillRect(0, by, w, 11);

        for (let i = 0; i < 5; i++) {
          const bx = 9 + i * ((w - 18) / 4);
          g.fillStyle = "#8d7a55";
          g.beginPath();
          g.arc(bx, by + 5.5, 3, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = "rgba(255, 236, 190, 0.35)";
          g.beginPath();
          g.arc(bx - 0.9, by + 4.6, 1.2, 0, Math.PI * 2);
          g.fill();

          // rust streak
          const streak = g.createLinearGradient(0, by + 8, 0, by + 8 + 34);
          streak.addColorStop(0, "rgba(138, 76, 30, 0.5)");
          streak.addColorStop(1, "rgba(138, 76, 30, 0)");
          g.fillStyle = streak;
          g.fillRect(bx - 1.6, by + 8, 3.2, 34);
        }
      }

      // algae creeping along the wet side
      for (let i = 0; i < 70; i++) {
        const x = rng() * w;
        const y = rng() * h;
        g.fillStyle = `rgba(78, 104, 48, ${0.06 + rng() * 0.16})`;
        g.beginPath();
        g.ellipse(x, y, 3 + rng() * 11, 2 + rng() * 7, rng(), 0, Math.PI * 2);
        g.fill();
      }
    });
  }

  // facing: -1 for the top pipe (mouth opens downward), +1 for the bottom pipe.
  function buildPipeMouth(facing) {
    const w = PIPE_WIDTH;
    const h = PIPE_COLLAR;
    return makeSprite(w, h, (g) => {
      // Normalise so we always draw "mouth at the bottom", then flip for the
      // bottom pipe. Lighting is re-applied after the flip so it stays top-left.
      if (facing > 0) {
        g.translate(0, h);
        g.scale(1, -1);
      }

      const cyl = g.createLinearGradient(0, 0, w, 0);
      cyl.addColorStop(0.0, "#131b15");
      cyl.addColorStop(0.32, "#51624b");
      cyl.addColorStop(0.44, "#66785d");
      cyl.addColorStop(0.66, "#38452f");
      cyl.addColorStop(1.0, "#0d1310");
      g.fillStyle = cyl;
      g.fillRect(0, 0, w, h);

      // heavy flange collar, raised via bevel rather than overhang so the
      // silhouette stays exactly PIPE_WIDTH wide
      const collarTop = 8;
      g.fillStyle = "rgba(6, 10, 7, 0.75)";
      g.fillRect(0, collarTop - 4, w, 5);
      const flange = g.createLinearGradient(0, collarTop, 0, h);
      flange.addColorStop(0, "rgba(188, 202, 172, 0.95)");
      flange.addColorStop(0.1, "rgba(132, 148, 120, 0.98)");
      flange.addColorStop(0.55, "rgba(74, 88, 66, 0.98)");
      flange.addColorStop(1, "rgba(20, 28, 20, 0.98)");
      g.fillStyle = flange;
      g.fillRect(0, collarTop, w, h - collarTop);
      // vertical cylinder shading over the flange so it still reads as round
      const flangeCyl = g.createLinearGradient(0, 0, w, 0);
      flangeCyl.addColorStop(0, "rgba(8, 12, 8, 0.6)");
      flangeCyl.addColorStop(0.38, "rgba(255, 255, 255, 0.08)");
      flangeCyl.addColorStop(0.7, "rgba(8, 12, 8, 0.18)");
      flangeCyl.addColorStop(1, "rgba(6, 10, 6, 0.62)");
      g.fillStyle = flangeCyl;
      g.fillRect(0, collarTop, w, h - collarTop);

      // bolts around the collar
      for (let i = 0; i < 6; i++) {
        const bx = 8 + i * ((w - 16) / 5);
        g.fillStyle = "#96835c";
        g.beginPath();
        g.arc(bx, collarTop + 9, 3.4, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "rgba(20, 24, 18, 0.55)";
        g.beginPath();
        g.arc(bx, collarTop + 10.4, 3.4, 0.2, Math.PI - 0.2);
        g.fill();
        g.fillStyle = "rgba(255, 244, 206, 0.42)";
        g.beginPath();
        g.arc(bx - 1, collarTop + 7.8, 1.3, 0, Math.PI * 2);
        g.fill();
      }

      // dark bore + sludge waterline inside the mouth
      g.fillStyle = "#14180f";
      g.beginPath();
      g.ellipse(w / 2, h - 5, w / 2 - 5, 9, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#3f4a1c";
      g.beginPath();
      g.ellipse(w / 2, h - 2.5, w / 2 - 9, 5.5, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(132, 158, 74, 0.5)";
      g.beginPath();
      g.ellipse(w / 2 - 6, h - 3.5, w * 0.2, 2.2, 0, 0, Math.PI * 2);
      g.fill();

      // algae skirt around the mouth
      for (let i = 0; i < 16; i++) {
        const x = 4 + Math.random() * (w - 8);
        g.fillStyle = `rgba(64, 92, 40, ${0.2 + Math.random() * 0.3})`;
        g.beginPath();
        g.ellipse(x, h - 12 + Math.random() * 8, 3 + Math.random() * 7, 2 + Math.random() * 4, 0, 0, Math.PI * 2);
        g.fill();
      }

      // the bright rim that makes the gap edge read instantly
      g.fillStyle = "rgba(214, 228, 198, 0.9)";
      g.fillRect(0, collarTop, w, 2);
      g.fillStyle = "rgba(236, 246, 224, 0.55)";
      g.fillRect(0, h - 1.5, w, 1.5);
    });
  }

  // --- Modi caricature -------------------------------------------------------
  //
  // Recognition rests on four things that all read at this size: swept-back
  // silver hair, a full close-trimmed white beard, thin rectangular glasses,
  // and saffron. Two variants are baked (arms down / arms up) so the flap
  // animation is a sprite swap rather than re-drawing paths every frame.

  const MODI_W = 112;
  const MODI_H = 128;
  const HEAD_CX = 56;
  const HEAD_CY = 48;
  const HEAD_R = 29;

  function buildModi(armsUp) {
    return makeSprite(MODI_W, MODI_H, (g) => {
      const SKIN = "#b8815a";
      const SKIN_DK = "#96643f";
      const HAIR = "#dcdad4";
      const HAIR_DK = "#b3b1ab";
      const BEARD = "#efece5";
      const BEARD_DK = "#cbc7bd";
      const SAFFRON = "#e8801f";
      const KURTA = "#f4efe6";

      // ---- neck ----
      const bodyTop = HEAD_CY + HEAD_R - 4;
      g.fillStyle = SKIN_DK;
      g.fillRect(HEAD_CX - 9, bodyTop - 14, 18, 18);

      // ---- body ----
      g.fillStyle = KURTA;
      g.beginPath();
      g.moveTo(HEAD_CX - 27, MODI_H - 4);
      g.quadraticCurveTo(HEAD_CX - 30, bodyTop + 8, HEAD_CX - 15, bodyTop);
      g.lineTo(HEAD_CX + 15, bodyTop);
      g.quadraticCurveTo(HEAD_CX + 30, bodyTop + 8, HEAD_CX + 27, MODI_H - 4);
      g.closePath();
      g.fill();

      // saffron sadri vest over the kurta
      g.fillStyle = SAFFRON;
      g.beginPath();
      g.moveTo(HEAD_CX - 27, MODI_H - 4);
      g.quadraticCurveTo(HEAD_CX - 30, bodyTop + 8, HEAD_CX - 16, bodyTop + 1);
      g.lineTo(HEAD_CX - 8, bodyTop + 6);
      g.lineTo(HEAD_CX - 10, MODI_H - 4);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(HEAD_CX + 27, MODI_H - 4);
      g.quadraticCurveTo(HEAD_CX + 30, bodyTop + 8, HEAD_CX + 16, bodyTop + 1);
      g.lineTo(HEAD_CX + 8, bodyTop + 6);
      g.lineTo(HEAD_CX + 10, MODI_H - 4);
      g.closePath();
      g.fill();
      g.fillStyle = "rgba(120, 60, 8, 0.28)";
      g.fillRect(HEAD_CX + 14, bodyTop + 6, 12, MODI_H - bodyTop - 10);

      // Nehru collar
      g.fillStyle = "#f7f3ea";
      g.beginPath();
      g.moveTo(HEAD_CX - 13, bodyTop - 1);
      g.lineTo(HEAD_CX + 13, bodyTop - 1);
      g.lineTo(HEAD_CX + 8, bodyTop + 9);
      g.lineTo(HEAD_CX - 8, bodyTop + 9);
      g.closePath();
      g.fill();

      // ---- arms: sleeve with a dark edge so it reads as a limb, not a blob ----
      const armY = armsUp ? bodyTop + 4 : bodyTop + 16;
      const armTilt = armsUp ? -1.05 : 0.45;
      for (const side of [-1, 1]) {
        g.save();
        g.translate(HEAD_CX + side * 22, armY);
        g.rotate(side * armTilt);
        g.fillStyle = "#c96a12";
        roundRect(g, -7, -6, 14, 27, 7);
        g.fill();
        g.fillStyle = SAFFRON;
        roundRect(g, -5.5, -5, 11, 24, 5.5);
        g.fill();
        g.fillStyle = "rgba(255, 214, 150, 0.35)";
        roundRect(g, -4.5, -3, 4, 18, 2);
        g.fill();
        // cuff, then hand
        g.fillStyle = "#f4efe6";
        roundRect(g, -5.5, 15, 11, 5, 2);
        g.fill();
        g.fillStyle = SKIN;
        g.beginPath();
        g.ellipse(0, 23, 5, 5.5, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "rgba(120, 76, 46, 0.3)";
        g.beginPath();
        g.ellipse(0, 25.5, 4.6, 3, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }

      // ---- ears ----
      g.fillStyle = SKIN_DK;
      for (const side of [-1, 1]) {
        g.beginPath();
        g.ellipse(HEAD_CX + side * (HEAD_R - 3), HEAD_CY + 2, 5, 8, 0, 0, Math.PI * 2);
        g.fill();
      }

      // ---- head ----
      const skinGrad = g.createRadialGradient(HEAD_CX - 10, HEAD_CY - 12, 4, HEAD_CX, HEAD_CY, HEAD_R + 8);
      skinGrad.addColorStop(0, "#cf9a6e");
      skinGrad.addColorStop(0.6, SKIN);
      skinGrad.addColorStop(1, SKIN_DK);
      g.fillStyle = skinGrad;
      g.beginPath();
      g.ellipse(HEAD_CX, HEAD_CY + 1, HEAD_R - 2, HEAD_R + 2, 0, 0, Math.PI * 2);
      g.fill();

      // ---- hair: short, silver, swept back with receding temples ----
      // Kept deliberately thin over the crown -- a thick cap reads as a bowl cut
      // rather than as swept-back hair.
      g.fillStyle = HAIR;
      g.beginPath();
      g.moveTo(HEAD_CX - HEAD_R + 2, HEAD_CY - 3);
      g.quadraticCurveTo(HEAD_CX - HEAD_R - 1, HEAD_CY - 18, HEAD_CX - 13, HEAD_CY - 27);
      g.quadraticCurveTo(HEAD_CX, HEAD_CY - 31, HEAD_CX + 14, HEAD_CY - 25);
      g.quadraticCurveTo(HEAD_CX + HEAD_R, HEAD_CY - 17, HEAD_CX + HEAD_R - 2, HEAD_CY - 3);
      // hairline: deep temple notches with a slight rise in the middle
      g.quadraticCurveTo(HEAD_CX + HEAD_R - 5, HEAD_CY - 12, HEAD_CX + 13, HEAD_CY - 15);
      g.quadraticCurveTo(HEAD_CX + 6, HEAD_CY - 19, HEAD_CX, HEAD_CY - 18);
      g.quadraticCurveTo(HEAD_CX - 6, HEAD_CY - 19, HEAD_CX - 13, HEAD_CY - 15);
      g.quadraticCurveTo(HEAD_CX - HEAD_R + 5, HEAD_CY - 12, HEAD_CX - HEAD_R + 2, HEAD_CY - 3);
      g.closePath();
      g.fill();
      // sweep shading, brushed back toward the crown
      g.strokeStyle = HAIR_DK;
      g.lineWidth = 1.4;
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        g.beginPath();
        g.moveTo(HEAD_CX - 12 + t * 24, HEAD_CY - 17 - t * 2);
        g.quadraticCurveTo(HEAD_CX - 4 + t * 26, HEAD_CY - 25, HEAD_CX - 15 + t * 30, HEAD_CY - 27 + t * 6);
        g.stroke();
      }
      g.fillStyle = HAIR_DK;
      g.beginPath();
      g.moveTo(HEAD_CX - HEAD_R + 2, HEAD_CY - 4);
      g.quadraticCurveTo(HEAD_CX - HEAD_R, HEAD_CY - 15, HEAD_CX - 16, HEAD_CY - 22);
      g.quadraticCurveTo(HEAD_CX - 19, HEAD_CY - 13, HEAD_CX - HEAD_R + 5, HEAD_CY - 5);
      g.closePath();
      g.fill();

      // ---- beard: jawline only, leaving the cheeks and mid-face visible ----
      g.fillStyle = BEARD;
      g.beginPath();
      g.moveTo(HEAD_CX - HEAD_R + 2, HEAD_CY - 1);
      // down the left jaw, round the chin, up the right jaw
      g.quadraticCurveTo(HEAD_CX - HEAD_R + 3, HEAD_CY + 21, HEAD_CX, HEAD_CY + 28);
      g.quadraticCurveTo(HEAD_CX + HEAD_R - 3, HEAD_CY + 21, HEAD_CX + HEAD_R - 2, HEAD_CY - 1);
      // inner edge: dips low enough that the mouth area stays open
      g.quadraticCurveTo(HEAD_CX + 15, HEAD_CY + 12, HEAD_CX, HEAD_CY + 13);
      g.quadraticCurveTo(HEAD_CX - 15, HEAD_CY + 12, HEAD_CX - HEAD_R + 2, HEAD_CY - 1);
      g.closePath();
      g.fill();
      g.fillStyle = BEARD_DK;
      g.beginPath();
      g.ellipse(HEAD_CX, HEAD_CY + 22, 12, 4.5, 0, 0, Math.PI);
      g.fill();

      // sideburns tying the hair down into the beard
      g.fillStyle = BEARD;
      for (const side of [-1, 1]) {
        g.beginPath();
        g.ellipse(HEAD_CX + side * (HEAD_R - 4), HEAD_CY - 2, 4.5, 9, 0, 0, Math.PI * 2);
        g.fill();
      }

      // ---- nose: prominent, with a cast shadow ----
      g.fillStyle = "#c08d61";
      g.beginPath();
      g.moveTo(HEAD_CX - 5, HEAD_CY - 4);
      g.quadraticCurveTo(HEAD_CX - 7, HEAD_CY + 6, HEAD_CX, HEAD_CY + 8);
      g.quadraticCurveTo(HEAD_CX + 7, HEAD_CY + 6, HEAD_CX + 5, HEAD_CY - 4);
      g.closePath();
      g.fill();
      g.fillStyle = "rgba(112, 68, 40, 0.42)";
      g.beginPath();
      g.moveTo(HEAD_CX + 2, HEAD_CY - 3);
      g.quadraticCurveTo(HEAD_CX + 7, HEAD_CY + 5, HEAD_CX + 1, HEAD_CY + 7.6);
      g.quadraticCurveTo(HEAD_CX + 4, HEAD_CY + 3, HEAD_CX + 2, HEAD_CY - 3);
      g.closePath();
      g.fill();
      g.fillStyle = "rgba(70, 40, 22, 0.35)";
      for (const side of [-1, 1]) {
        g.beginPath();
        g.ellipse(HEAD_CX + side * 4, HEAD_CY + 6.4, 1.6, 1.1, 0, 0, Math.PI * 2);
        g.fill();
      }

      // ---- moustache, sitting under the nose and above the open mouth area ----
      g.fillStyle = BEARD;
      g.beginPath();
      g.moveTo(HEAD_CX - 12, HEAD_CY + 9);
      g.quadraticCurveTo(HEAD_CX, HEAD_CY + 7, HEAD_CX + 12, HEAD_CY + 9);
      g.quadraticCurveTo(HEAD_CX + 7, HEAD_CY + 14.5, HEAD_CX, HEAD_CY + 13.5);
      g.quadraticCurveTo(HEAD_CX - 7, HEAD_CY + 14.5, HEAD_CX - 12, HEAD_CY + 9);
      g.closePath();
      g.fill();

      // mouth hint between moustache and beard
      g.strokeStyle = "rgba(92, 54, 38, 0.6)";
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(HEAD_CX - 6, HEAD_CY + 16.5);
      g.quadraticCurveTo(HEAD_CX, HEAD_CY + 19, HEAD_CX + 6, HEAD_CY + 16.5);
      g.stroke();

      // ---- eyebrows: grey rather than white, or they vanish into the hairline ----
      g.strokeStyle = "#9a958c";
      g.lineWidth = 3;
      for (const side of [-1, 1]) {
        g.beginPath();
        g.moveTo(HEAD_CX + side * 5, HEAD_CY - 12.5);
        g.quadraticCurveTo(HEAD_CX + side * 12, HEAD_CY - 15.5, HEAD_CX + side * 18, HEAD_CY - 11);
        g.stroke();
      }

      // ---- eyes ----
      for (const side of [-1, 1]) {
        const ex = HEAD_CX + side * 11;
        g.fillStyle = "#f6f0e6";
        g.beginPath();
        g.ellipse(ex, HEAD_CY - 4.5, 5.6, 3.8, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#33241a";
        g.beginPath();
        g.arc(ex + side * 0.8, HEAD_CY - 4, 2.5, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "rgba(255,255,255,0.9)";
        g.beginPath();
        g.arc(ex + side * 0.8 - 0.9, HEAD_CY - 5.2, 0.9, 0, Math.PI * 2);
        g.fill();
        // hooded upper lid
        g.fillStyle = SKIN_DK;
        g.beginPath();
        g.ellipse(ex, HEAD_CY - 8.4, 6, 2.8, 0, 0, Math.PI * 2);
        g.fill();
      }

      // ---- rectangular glasses ----
      g.strokeStyle = "#2e2c2a";
      g.lineWidth = 2;
      for (const side of [-1, 1]) {
        const ex = HEAD_CX + side * 11;
        g.fillStyle = "rgba(222, 238, 248, 0.18)";
        roundRect(g, ex - 9.5, HEAD_CY - 10.5, 19, 13, 3);
        g.fill();
        g.stroke();
        g.beginPath();
        g.moveTo(ex + side * 9.5, HEAD_CY - 7);
        g.lineTo(HEAD_CX + side * (HEAD_R - 3), HEAD_CY - 3);
        g.stroke();
      }
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(HEAD_CX - 1.5, HEAD_CY - 6.5);
      g.lineTo(HEAD_CX + 1.5, HEAD_CY - 6.5);
      g.stroke();
      // lens glint
      g.strokeStyle = "rgba(255,255,255,0.45)";
      g.lineWidth = 1.4;
      for (const side of [-1, 1]) {
        const ex = HEAD_CX + side * 11;
        g.beginPath();
        g.moveTo(ex - 7, HEAD_CY - 8.5);
        g.lineTo(ex - 2.5, HEAD_CY - 2);
        g.stroke();
      }
    });
  }

  // --- Build everything ------------------------------------------------------

  function buildSprites() {
    const t = TIERS[tier];
    sprites = {
      clouds: buildClouds(),
      far: t.far ? buildSkyline() : null,
      mid: buildSlumMid(),
      near: buildSlumNear(),
      wires: t.wires ? buildWires() : null,
      ground: buildGround(),
      puddles: t.puddles ? buildPuddles() : null,
      pipeBody: buildPipeBody(),
      mouthTop: buildPipeMouth(-1),
      mouthBottom: buildPipeMouth(1),
      modi: [buildModi(false), buildModi(true)],
    };
    seedAmbient();
  }

  function seedAmbient() {
    const t = TIERS[tier];
    motes.length = 0;
    smoke.length = 0;
    crows.length = 0;
    for (let i = 0; i < t.motes; i++) {
      motes.push({ x: Math.random() * W, y: Math.random() * FLOOR_Y, r: 0.6 + Math.random() * 1.5, sp: 0.12 + Math.random() * 0.5, ph: Math.random() * Math.PI * 2 });
    }
    for (let i = 0; i < t.smoke; i++) {
      smoke.push({ x: Math.random() * W, y: FLOOR_Y - 150 - Math.random() * 130, r: 20 + Math.random() * 26, sp: 0.1 + Math.random() * 0.22, ph: Math.random() * Math.PI * 2 });
    }
    if (t.crows) {
      for (let i = 0; i < 2; i++) {
        crows.push({ x: Math.random() * W, y: 70 + Math.random() * 150, sp: 0.5 + Math.random() * 0.5, ph: Math.random() * Math.PI * 2 });
      }
    }
  }

  // ==========================================================================
  // CANVAS SETUP
  // ==========================================================================

  function setupCanvas() {
    RENDER_SCALE = clamp(window.devicePixelRatio || 1, 1, 2);
    canvas.width = Math.round(W * RENDER_SCALE);
    canvas.height = Math.round(H * RENDER_SCALE);
    // Display size is left to the stylesheet, which shrinks the canvas on short
    // viewports. Setting it inline here would override that and clip the game.
    ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
    buildSkyGradients();
  }

  // ==========================================================================
  // AUDIO
  //
  // One shared AudioContext for everything. The previous build created a fresh
  // context per sound effect, which silently hit the browser's context cap after
  // a handful of points and killed all audio for the rest of the session.
  //
  // Music runs through Web Audio rather than an <audio> element so the theme can
  // loop from a precise offset: the source file opens with a groan and a quiet
  // lead-in, and MUSIC_LOOP_START skips straight to the first musical phrase.
  // Trimming the file instead would mean either re-encoding (which adds encoder
  // delay, so the loop hiccups every pass) or a stream copy (which can only cut
  // on a frame boundary, landing mid-attack and clicking).
  // ==========================================================================

  let audioCtx = null;
  let musicGain = null; // music bus -- theme and menu both route through here
  let themeBuffer = null;
  let crashBuffer = null;
  let buffersRequested = false;

  function getAudioCtx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        audioCtx = new AC();
      } catch {
        return null;
      }
      musicGain = audioCtx.createGain();
      musicGain.gain.value = settings.musicVolume;
      musicGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function loadAudioBuffers() {
    if (buffersRequested) return;
    const ac = getAudioCtx();
    if (!ac) return;
    buffersRequested = true;
    const grab = (url) =>
      fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => ac.decodeAudioData(b));

    grab(BG_MUSIC_FILE)
      .then((b) => {
        themeBuffer = b;
        if (state === "playing") startTheme();
      })
      .catch(() => {});
    grab(CRASH_SFX_FILE)
      .then((b) => {
        crashBuffer = b;
      })
      .catch(() => {});
  }

  function applyAudioVolumes() {
    if (musicGain) musicGain.gain.value = settings.musicVolume;
  }

  // --- gameplay theme --------------------------------------------------------

  let themeSource = null;

  function startTheme() {
    stopMenuMusic(180);
    const ac = getAudioCtx();
    if (!ac || !themeBuffer || themeSource) return;
    const src = ac.createBufferSource();
    src.buffer = themeBuffer;
    src.loop = true;
    // Skip the groan on the first pass and on every loop thereafter.
    src.loopStart = Math.min(MUSIC_LOOP_START, themeBuffer.duration - 0.05);
    src.loopEnd = themeBuffer.duration;
    src.connect(musicGain);
    src.start(0, src.loopStart);
    themeSource = src;
  }

  function stopTheme(fadeMs = 650) {
    const src = themeSource;
    if (!src) return;
    themeSource = null;
    const ac = audioCtx;
    if (!ac) return;
    // Ramp on its own gain node so a fade never fights the user's volume slider.
    const g = ac.createGain();
    try {
      src.disconnect();
    } catch {
      /* already disconnected */
    }
    src.connect(g);
    g.connect(musicGain);
    const t = ac.currentTime;
    g.gain.setValueAtTime(1, t);
    g.gain.linearRampToValueAtTime(0.0001, t + fadeMs / 1000);
    try {
      src.stop(t + fadeMs / 1000 + 0.02);
    } catch {
      /* already stopped */
    }
  }

  // --- menu music ------------------------------------------------------------
  //
  // Synthesised rather than a recording: a tanpura-style drone under a simple
  // phrase in Bilaval (the major-scale raga). Deliberately generic mood music --
  // not the national anthem, which would need a real recording and which we
  // would only be approximating from memory.

  const MENU_SA = 146.83; // D3
  const SEMI = (n) => MENU_SA * Math.pow(2, n / 12);
  // [scale degree in semitones from Sa, beats]
  const MENU_PHRASE = [
    [0, 1], [2, 1], [4, 1], [5, 1],
    [7, 2], [5, 1], [4, 1],
    [2, 2], [0, 2],
    [4, 1], [7, 1], [9, 2],
    [7, 1], [5, 1], [4, 1], [2, 1],
    [0, 4],
  ];
  const MENU_BEAT = 0.42; // seconds per beat
  const MENU_LEN = MENU_PHRASE.reduce((a, n) => a + n[1], 0) * MENU_BEAT;

  let menuNodes = null;
  let menuTimer = null;

  function startMenuMusic() {
    const ac = getAudioCtx();
    if (!ac || menuNodes) return;

    const bus = ac.createGain();
    bus.gain.value = 0;
    bus.connect(musicGain);
    bus.gain.linearRampToValueAtTime(0.5, ac.currentTime + 0.8);

    // drone: Sa and Pa, slightly detuned against each other so it breathes
    const drones = [];
    for (const [mult, detune, gainv] of [[1, -4, 0.13], [1, 5, 0.11], [1.5, 0, 0.09], [0.5, 0, 0.1]]) {
      const o = ac.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = MENU_SA * mult;
      o.detune.value = detune;
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 620;
      const g = ac.createGain();
      g.gain.value = gainv;
      o.connect(lp);
      lp.connect(g);
      g.connect(bus);
      o.start();
      drones.push(o);
    }

    menuNodes = { bus, drones, voices: [] };
    let nextAt = ac.currentTime + 0.4;
    const schedulePass = () => {
      if (!menuNodes) return;
      let t = nextAt;
      for (const [deg, beats] of MENU_PHRASE) {
        const dur = beats * MENU_BEAT;
        playMenuNote(ac, menuNodes, SEMI(deg), t, dur * 0.92);
        t += dur;
      }
      nextAt = t;
      // re-arm shortly before the pass ends so notes are always queued ahead
      menuTimer = setTimeout(schedulePass, Math.max(120, (MENU_LEN - 0.35) * 1000));
    };
    schedulePass();
  }

  function playMenuNote(ac, nodes, freq, at, dur) {
    const o = ac.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(freq, at);
    // a small scoop into the note, which is what makes it read as a flute
    o.frequency.setValueAtTime(freq * 0.97, at);
    o.frequency.linearRampToValueAtTime(freq, at + 0.06);

    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2200;

    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.22, at + 0.07);
    g.gain.setValueAtTime(0.22, at + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    o.connect(lp);
    lp.connect(g);
    g.connect(nodes.bus);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  function stopMenuMusic(fadeMs = 500) {
    if (menuTimer) {
      clearTimeout(menuTimer);
      menuTimer = null;
    }
    const nodes = menuNodes;
    if (!nodes || !audioCtx) return;
    menuNodes = null;
    const t = audioCtx.currentTime;
    nodes.bus.gain.cancelScheduledValues(t);
    nodes.bus.gain.setValueAtTime(nodes.bus.gain.value, t);
    nodes.bus.gain.linearRampToValueAtTime(0.0001, t + fadeMs / 1000);
    for (const o of nodes.drones) {
      try {
        o.stop(t + fadeMs / 1000 + 0.05);
      } catch {
        /* already stopped */
      }
    }
  }

  // Browsers keep an AudioContext suspended until the user interacts, and
  // currentTime does not advance while suspended -- so anything scheduled before
  // then would all fire at once on resume. Nothing starts until this is set.
  let userGestured = false;

  function noteUserGesture() {
    if (userGestured) return;
    userGestured = true;
    getAudioCtx();
    syncMusicToState();
  }

  // Music follows game state; called both on transitions and on the first user
  // gesture, since the context cannot start before one.
  function syncMusicToState() {
    if (!userGestured) return;
    const ac = getAudioCtx();
    if (!ac) return;
    loadAudioBuffers();
    if (state === "playing") {
      startTheme();
    } else if (state === "menu") {
      stopTheme(300);
      startMenuMusic();
    }
  }

  // --- sound effects ---------------------------------------------------------

  function tone({ type, from, to, dur, vol, delay = 0 }) {
    if (settings.sfxVolume <= 0) return;
    const ac = getAudioCtx();
    if (!ac) return;
    const t = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    gain.gain.setValueAtTime(Math.max(0.0001, vol * settings.sfxVolume), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // Short synthesised whoosh. The voice clip used to play here, but at 3.1s it
  // stacked into mush when flapping twice a second -- it now lands on the crash,
  // where it can play once and in full.
  function playFlapSound() {
    if (settings.sfxVolume <= 0) return;
    const ac = getAudioCtx();
    if (!ac) return;
    const t = ac.currentTime;

    const noise = ac.createBufferSource();
    const len = Math.floor(ac.sampleRate * 0.14);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    noise.buffer = buf;

    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(1900, t + 0.12);
    bp.Q.value = 0.9;

    const g = ac.createGain();
    g.gain.setValueAtTime(0.16 * settings.sfxVolume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);

    noise.connect(bp);
    bp.connect(g);
    g.connect(ac.destination);
    noise.start(t);
    noise.stop(t + 0.16);

    tone({ type: "sine", from: 320, to: 520, dur: 0.08, vol: 0.07 });
  }

  function playScoreSound() {
    tone({ type: "triangle", from: 620, to: 990, dur: 0.1, vol: 0.16 });
    tone({ type: "sine", from: 940, to: 1360, dur: 0.09, vol: 0.09, delay: 0.05 });
  }

  // The voice clip, played once and in full on a crash.
  let crashSource = null;
  function playCrashSound() {
    tone({ type: "sawtooth", from: 230, to: 62, dur: 0.26, vol: 0.18 });
    if (settings.sfxVolume <= 0) return;
    const ac = getAudioCtx();
    if (!ac || !crashBuffer) return;
    if (crashSource) {
      try {
        crashSource.stop();
      } catch {
        /* already ended */
      }
    }
    const src = ac.createBufferSource();
    src.buffer = crashBuffer;
    const g = ac.createGain();
    g.gain.value = Math.min(1, settings.sfxVolume + 0.1);
    src.connect(g);
    g.connect(ac.destination);
    src.start(ac.currentTime + 0.06);
    crashSource = src;
    src.onended = () => {
      if (crashSource === src) crashSource = null;
    };
  }

  function stopCrashSound() {
    if (!crashSource) return;
    try {
      crashSource.stop();
    } catch {
      /* already ended */
    }
    crashSource = null;
  }

  // ==========================================================================
  // SIMULATION
  // ==========================================================================

  function resetRun() {
    bird.y = H / 2;
    bird.vy = 0;
    bird.rot = 0;
    bird.bob = 0;
    score = 0;
    scoreEl.textContent = "0";
    pipes.length = 0;
    particles.length = 0;
    popups.length = 0;
    lastGapCenter = H / 2;
    pipeSeq = 0;
    flapAnim = 0;
    shake = 0;
    flash = 0;
  }

  function inGrace() {
    return state === "playing" && graceSteps > 0;
  }

  function updateGraceHUD() {
    if (inGrace()) {
      graceEl.classList.remove("hidden");
      // No countdown number: the window is 1.2s, so ceil() showed "2" for only
      // 0.2s before dropping to "1", which read as a stuck or broken timer.
      graceEl.textContent = "GET READY";
    } else {
      graceEl.classList.add("hidden");
    }
  }

  function startGame() {
    resetRun();
    hideAllPanels();
    showHud(true);
    state = "playing";
    paused = false;
    graceSteps = GRACE_STEPS;
    resetProbe(); // don't judge the machine on the first frames of a new run
    loadAudioBuffers();
    syncMusicToState();
    updateGraceHUD();
  }

  function flap() {
    if (listeningFor || state !== "playing" || paused) return;
    // A flap during the countdown starts the run immediately rather than being
    // swallowed -- the old build ignored input here and read as broken.
    if (graceSteps > 0) {
      graceSteps = 0;
      updateGraceHUD();
    }
    bird.vy = FLAP;
    flapAnim = 9;
    playFlapSound();
  }

  function spawnPipe() {
    const gap = gapFor(score);
    const minCenter = EDGE_MARGIN + gap / 2;
    const maxCenter = FLOOR_Y - EDGE_MARGIN - gap / 2;
    // Bounded random walk: consecutive gaps can never demand more vertical
    // travel than the horizontal spacing gives you time for.
    const delta = (Math.random() * 2 - 1) * MAX_CENTER_DELTA;
    const center = clamp(lastGapCenter + delta, minCenter, maxCenter);
    lastGapCenter = center;

    const pipe = {
      x: SPAWN_X,
      gapTop: center - gap / 2,
      gapBottom: center + gap / 2,
      passed: false,
      id: ++pipeSeq,
      drips: [],
      bubbles: [],
    };
    seedPipeEffects(pipe);
    pipes.push(pipe);
  }

  // Effects live on the pipe and store x as an offset from it, so they travel
  // with their pipe and are freed with it.
  function seedPipeEffects(pipe) {
    const density = TIERS[tier].drips;
    const dripCount = Math.round((5 + Math.random() * 4) * density);
    for (let i = 0; i < dripCount; i++) {
      pipe.drips.push({
        ox: 8 + Math.random() * (PIPE_WIDTH - 16),
        side: i % 2 === 0 ? "top" : "bottom",
        len: 3 + Math.random() * 8,
        speed: 0.8 + Math.random() * 1.6,
      });
    }
    const bubbleCount = Math.round(3 * density);
    for (let i = 0; i < bubbleCount; i++) {
      pipe.bubbles.push({
        ox: 12 + Math.random() * (PIPE_WIDTH - 24),
        oy: 14 + Math.random() * 36,
        r: 2 + Math.random() * 4,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  function addParticles(x, y, n, palette) {
    if (!TIERS[tier].particles) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 4;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1.5,
        life: 26 + Math.random() * 22,
        max: 48,
        r: 1.5 + Math.random() * 3,
        c: palette[(Math.random() * palette.length) | 0],
      });
    }
  }

  function stepGame() {
    // Pipes stop dead on death, so the background has to stop with them or the
    // world visibly slides out from under the frozen obstacles.
    const speed =
      state === "dead" ? 0
      : state === "playing" && !inGrace() ? speedFor(score)
      : SPEED_START * 0.35; // idle drift on the menu and during the countdown
    scrollX += speed;

    stepAmbient();

    if (shake > 0) shake *= 0.88;
    if (flash > 0) flash -= 0.08;
    if (flapAnim > 0) flapAnim--;

    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      p.y -= 0.9;
      p.life--;
      if (p.life <= 0) popups.splice(i, 1);
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += 0.22;
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      if (p.life <= 0) particles.splice(i, 1);
    }

    if (state !== "playing" || paused) return;

    if (graceSteps > 0) {
      graceSteps--;
      bird.bob += 0.09;
      bird.y = H / 2 + Math.sin(bird.bob) * 9;
      bird.vy = 0;
      bird.rot = Math.sin(bird.bob) * 0.06;
      updateGraceHUD();
      if (graceSteps === 0) {
        updateGraceHUD();
        bird.vy = -1.5;
      }
      return;
    }

    bird.vy = Math.min(bird.vy + GRAVITY, MAX_FALL);
    bird.y += bird.vy;
    bird.rot = clamp(bird.vy * 0.052, -0.5, 1.15);

    // Ceiling clamps rather than kills -- genre standard, and it removes a very
    // cheap death right after a strong flap.
    if (bird.y - BIRD_R < 0) {
      bird.y = BIRD_R;
      bird.vy = 0;
    }
    if (bird.y + BIRD_R > FLOOR_Y) {
      bird.y = FLOOR_Y - BIRD_R;
      die();
      return;
    }

    // Distance-based spawning: pipe spacing is now a fixed number of pixels,
    // not a number of milliseconds multiplied by whatever the refresh rate is.
    // Measured from the spawn point, so PIPE_SPACING is literally the distance
    // between consecutive pipes.
    const last = pipes[pipes.length - 1];
    if (!last || SPAWN_X - last.x >= spacingFor(score)) spawnPipe();

    for (let i = pipes.length - 1; i >= 0; i--) {
      const p = pipes[i];
      p.x -= speed;

      for (const d of p.drips) {
        // Capped short: these hang from the top mouth INTO the playable gap,
        // and a long strand reads like part of the obstacle.
        d.len += d.speed * 0.16;
        if (d.len > 15) d.len = 3;
      }
      for (const b of p.bubbles) b.phase += 0.09;

      if (!p.passed && p.x + PIPE_WIDTH < BIRD_X - BIRD_R) {
        p.passed = true;
        score++;
        scoreEl.textContent = String(score);
        popups.push({ x: BIRD_X + 26, y: bird.y - 26, life: 42, max: 42 });
        playScoreSound();
      }

      if (p.x + PIPE_WIDTH < -40) pipes.splice(i, 1);
    }

    checkCollisions();
  }

  // Ambient drift is deliberately independent of game speed -- smoke and crows
  // read as distance, so they should not accelerate as the pipes do.
  function stepAmbient() {
    for (const m of motes) {
      m.x -= m.sp;
      m.ph += 0.03;
      if (m.x < -4) {
        m.x = W + 4;
        m.y = Math.random() * FLOOR_Y;
      }
    }
    for (const s of smoke) {
      s.x -= s.sp;
      s.ph += 0.012;
      if (s.x < -s.r * 2) s.x = W + s.r * 2;
    }
    for (const c of crows) {
      c.x -= c.sp;
      c.ph += 0.22;
      if (c.x < -20) {
        c.x = W + 20;
        c.y = 60 + Math.random() * 170;
      }
    }
  }

  // The gap is now literally the gap: gapTop/gapBottom are the same lines the
  // art is drawn to, so there is no phantom zone and no premature death.
  function checkCollisions() {
    const pad = 3;
    const r = BIRD_R - pad;
    for (const p of pipes) {
      if (BIRD_X + r < p.x || BIRD_X - r > p.x + PIPE_WIDTH) continue;
      if (bird.y - r < p.gapTop || bird.y + r > p.gapBottom) {
        die();
        return;
      }
    }
  }

  function die() {
    if (state !== "playing") return;
    playCrashSound();
    stopTheme(500);
    shake = 16;
    flash = 1;
    addParticles(BIRD_X, bird.y, 22, ["#e8801f", "#f4efe6", "#8a5c2a", "#4a5c22"]);
    if (score > settings.highScore) {
      settings.highScore = score;
      saveSettings();
    }
    showGameOver();
  }

  // ==========================================================================
  // RENDER
  // ==========================================================================

  function drawLayer(sprite, key, baseY) {
    if (!sprite) return;
    const lw = LAYER_W[key];
    const off = -((scrollX * PARALLAX[key]) % lw);
    const y = baseY - sprite.lh;
    ctx.drawImage(sprite, off, y, sprite.lw, sprite.lh);
    ctx.drawImage(sprite, off + lw, y, sprite.lw, sprite.lh);
  }

  function drawSky() {
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, FLOOR_Y);
    ctx.fillStyle = sunGrad;
    ctx.fillRect(0, 0, W, FLOOR_Y);
    ctx.fillStyle = hazeGrad;
    ctx.fillRect(0, H * 0.42, W, FLOOR_Y - H * 0.42);
  }

  function drawSmoke() {
    for (const s of smoke) {
      const y = s.y + Math.sin(s.ph) * 10;
      ctx.fillStyle = `rgba(96, 86, 74, ${0.05 + Math.sin(s.ph * 0.7) * 0.02 + 0.05})`;
      ctx.beginPath();
      ctx.ellipse(s.x, y, s.r * 1.6, s.r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawCrows() {
    ctx.strokeStyle = "rgba(28, 24, 20, 0.75)";
    ctx.lineWidth = 1.6;
    for (const c of crows) {
      const w = Math.sin(c.ph) * 5;
      ctx.beginPath();
      ctx.moveTo(c.x - 7, c.y + w);
      ctx.quadraticCurveTo(c.x - 3, c.y - 2, c.x, c.y);
      ctx.quadraticCurveTo(c.x + 3, c.y - 2, c.x + 7, c.y + w);
      ctx.stroke();
    }
  }

  function drawMotes() {
    for (const m of motes) {
      ctx.fillStyle = `rgba(238, 220, 186, ${0.1 + Math.sin(m.ph) * 0.08 + 0.1})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y + Math.sin(m.ph) * 5, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawGround() {
    const tile = sprites.ground;
    const tw = tile.lw;
    // Ground scrolls at exactly pipe speed so it reads as attached to the world.
    const off = -(scrollX % tw);
    const y = FLOOR_Y - 26;
    for (let x = off; x < W; x += tw) {
      ctx.drawImage(tile, x, y, tile.lw, tile.lh);
    }
    if (sprites.puddles) {
      const poff = -((scrollX * 1.0) % (tw * 1.37));
      for (let x = poff; x < W; x += tw * 1.37) {
        ctx.drawImage(sprites.puddles, x, y, sprites.puddles.lw, sprites.puddles.lh);
      }
    }
  }

  function drawBackground() {
    drawSky();
    {
      const lw = LAYER_W.clouds;
      const off = -((scrollX * PARALLAX.clouds) % lw);
      ctx.drawImage(sprites.clouds, off, 40, sprites.clouds.lw, sprites.clouds.lh);
      ctx.drawImage(sprites.clouds, off + lw, 40, sprites.clouds.lw, sprites.clouds.lh);
    }
    // Each layer's base sits progressively lower so the one behind still shows
    // above it -- the far skyline was previously drawn entirely inside the mid
    // layer's footprint and never visible at all.
    drawLayer(sprites.far, "far", FLOOR_Y - 46);
    drawLayer(sprites.mid, "mid", FLOOR_Y - 34);
    if (sprites.wires) {
      const lw = LAYER_W.wires;
      const off = -((scrollX * PARALLAX.wires) % lw);
      ctx.drawImage(sprites.wires, off, 96, sprites.wires.lw, sprites.wires.lh);
      ctx.drawImage(sprites.wires, off + lw, 96, sprites.wires.lw, sprites.wires.lh);
    }
    // Near huts stop above the drain so the lane and open drain stay visible.
    drawLayer(sprites.near, "near", FLOOR_Y - 24);
    if (smoke.length) drawSmoke();
    if (crows.length) drawCrows();
    drawGround();
  }

  function drawPipe(p) {
    const body = sprites.pipeBody;
    const x = Math.round(p.x);

    // Top pipe: body runs from the ceiling down to the collar, collar sits
    // inside the body extent ending exactly at gapTop.
    const topBodyH = Math.max(0, p.gapTop - PIPE_COLLAR);
    if (topBodyH > 0) {
      ctx.drawImage(body, 0, body.lh - topBodyH, PIPE_WIDTH, topBodyH, x, 0, PIPE_WIDTH, topBodyH);
    }
    ctx.drawImage(sprites.mouthTop, x, p.gapTop - PIPE_COLLAR, PIPE_WIDTH, PIPE_COLLAR);

    // Bottom pipe: collar starts exactly at gapBottom.
    ctx.drawImage(sprites.mouthBottom, x, p.gapBottom, PIPE_WIDTH, PIPE_COLLAR);
    const botBodyY = p.gapBottom + PIPE_COLLAR;
    const botBodyH = Math.max(0, FLOOR_Y + 6 - botBodyY);
    if (botBodyH > 0) {
      ctx.drawImage(body, 0, 0, PIPE_WIDTH, botBodyH, x, botBodyY, PIPE_WIDTH, botBodyH);
    }
  }

  function drawPipeEffects(p) {
    for (const d of p.drips) {
      const x = p.x + d.ox;
      if (x < -10 || x > W + 10) continue;
      const y = d.side === "top" ? p.gapTop : p.gapBottom + PIPE_COLLAR - 4;
      ctx.strokeStyle = d.side === "top" ? "rgba(92, 70, 26, 0.85)" : "rgba(74, 92, 34, 0.8)";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.sin(d.len * 0.5) * 1.6, y + d.len);
      ctx.stroke();
      ctx.fillStyle = "rgba(107, 74, 32, 0.9)";
      ctx.beginPath();
      ctx.arc(x, y + d.len, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const b of p.bubbles) {
      const x = p.x + b.ox;
      if (x < -10 || x > W + 10) continue;
      const y = p.gapBottom + PIPE_COLLAR + b.oy + Math.sin(b.phase) * 5;
      ctx.fillStyle = "rgba(104, 134, 62, 0.35)";
      ctx.strokeStyle = "rgba(186, 206, 126, 0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  function drawScarf() {
    // Angavastram trailing behind, driven by vertical velocity: it streams up
    // when rising and droops when falling, which is what sells the motion.
    // Anchored at the left shoulder (the sprite's head centre is the origin, so
    // the body sits at positive y) and streaming back behind the character.
    const lift = clamp(-bird.vy * 2.4, -22, 32);
    const sway = Math.sin(scrollX * 0.045) * 5;
    // Anchored at the shoulder, below the head, so it never crosses the face.
    const ax = -12;
    const ay = 32;

    // Sampled along a curve and tapered to a point, so it reads as cloth rather
    // than as a rigid bar.
    const pts = [];
    const STEPS = 8;
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const x = ax - t * 60;
      const droop = t * t * 16;
      const y = ay + droop - lift * t + sway * t * t;
      const halfW = lerp(7, 1.2, t) * (1 - 0.2 * Math.sin(t * Math.PI * 2));
      pts.push({ x, y, halfW });
    }

    const band = (from, to) => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y + pts[0].halfW * from);
      for (let i = 1; i <= STEPS; i++) ctx.lineTo(pts[i].x, pts[i].y + pts[i].halfW * from);
      for (let i = STEPS; i >= 0; i--) ctx.lineTo(pts[i].x, pts[i].y + pts[i].halfW * to);
      ctx.closePath();
      ctx.fill();
    };

    // Pale cream with a saffron border -- deliberately NOT the sleeve orange, or
    // it reads as a third arm.
    ctx.fillStyle = "#f3ead6";
    band(-1, 1);
    ctx.fillStyle = "#e0912c";
    band(-1, -0.45);
    band(0.45, 1);
    ctx.fillStyle = "rgba(120, 86, 40, 0.18)";
    band(0.72, 1);
  }

  function drawModi() {
    if (state === "menu" || state === "settings") return;

    const sprite = sprites.modi[flapAnim > 0 ? 1 : 0];
    // squash/stretch: stretch on the way up, squash on the way down
    const sq = clamp(1 - bird.vy * 0.012, 0.9, 1.12);

    ctx.save();
    ctx.translate(BIRD_X, bird.y);
    ctx.rotate(bird.rot);
    // Scaling here rather than in the sprite keeps every authored proportion --
    // and the procedural scarf below scales with it for free.
    ctx.scale(MODI_SCALE, MODI_SCALE);
    if (inGrace()) ctx.globalAlpha = 0.62 + Math.sin(bird.bob * 2.2) * 0.3;

    drawScarf();

    ctx.scale(1 / sq, sq);
    // Anchor so the head centre sits on the hitbox centre.
    ctx.drawImage(sprite, -HEAD_CX, -HEAD_CY, MODI_W, MODI_H);
    ctx.restore();
  }

  function drawPopups() {
    for (const p of popups) {
      const k = p.life / p.max;
      ctx.globalAlpha = clamp(k * 1.4, 0, 1);
      ctx.fillStyle = "#ffd54f";
      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.lineWidth = 3;
      ctx.font = "700 24px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.strokeText("+1", p.x, p.y);
      ctx.fillText("+1", p.x, p.y);
      ctx.globalAlpha = 1;
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    ctx.save();
    if (shake > 0.4) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    drawBackground();
    for (const p of pipes) {
      if (p.x > W + PIPE_WIDTH || p.x + PIPE_WIDTH < 0) continue;
      drawPipe(p);
      drawPipeEffects(p);
    }
    if (motes.length) drawMotes();
    drawModi();
    drawParticles();
    drawPopups();

    ctx.fillStyle = vignetteGrad;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    if (flash > 0) {
      ctx.fillStyle = `rgba(255, 246, 230, ${clamp(flash, 0, 1) * 0.7})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ==========================================================================
  // QUALITY AUTO-DETECT
  //
  // Watches the frame rate the machine actually delivers. Timing render() with
  // performance.now() does NOT work here: that measures only the JS cost of
  // issuing canvas commands, the GPU work is asynchronous and uncounted, and it
  // reads as ~0.1ms on every tier -- so it can never detect a struggling
  // machine, which is the only thing this is for.
  //
  // The test is a plain absolute one: is the median frame interval worse than
  // SLOW_FRAME_MS, i.e. are we sustaining under ~48fps? Comparing against the
  // window's FASTEST frame does not work -- a uniformly overloaded machine has
  // uniformly slow frames, so the fastest frame tracks the slow rate too and
  // the ratio never fires.
  //
  // Tradeoff: a display whose native rate really is 30Hz looks identical to a
  // 60Hz machine running at half rate, so it gets downgraded too. That is rare,
  // Low still looks coherent, and the manual override in Settings covers it --
  // whereas failing to catch a struggling 60Hz machine defeats the feature.
  // ==========================================================================

  const TIER_ORDER = ["high", "medium", "low"];
  const PROBE_WINDOW = 90;
  const PROBE_SETTLE = 30; // frames ignored after a tier change or a new run
  const SLOW_FRAME_MS = 21; // sustained median worse than this is ~under 48fps

  let frameDeltas = [];
  let probeSettle = PROBE_SETTLE;

  function resolveTier() {
    return settings.quality === "auto" ? "high" : settings.quality;
  }

  function resetProbe() {
    frameDeltas.length = 0;
    probeSettle = PROBE_SETTLE;
  }

  function probeQuality(deltaMs) {
    if (settings.quality !== "auto") return;
    if (tier === "low") return; // nothing left to drop
    // Only judge the heaviest scene, and only when frames are actually being
    // presented -- a paused or backgrounded tab says nothing about capability.
    if (state !== "playing" || paused || document.hidden) {
      resetProbe();
      return;
    }
    if (probeSettle > 0) {
      probeSettle--;
      return;
    }

    frameDeltas.push(deltaMs);
    if (frameDeltas.length < PROBE_WINDOW) return;

    const sorted = [...frameDeltas].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    frameDeltas.length = 0;

    if (median > SLOW_FRAME_MS) {
      tier = TIER_ORDER[Math.min(TIER_ORDER.indexOf(tier) + 1, TIER_ORDER.length - 1)];
      buildSprites();
      probeSettle = PROBE_SETTLE;
    }
    // Downgrade only. Auto-upgrading would oscillate: the lighter tier runs
    // fast, which would immediately argue for going back up.
  }

  // ==========================================================================
  // LOOP
  // ==========================================================================

  function loop(ts) {
    if (!lastTime) lastTime = ts;
    // clamp below at 0 as well as above: a non-monotonic timestamp would
    // otherwise drive the accumulator negative and stall the simulation.
    const frameMs = clamp(ts - lastTime, 0, MAX_FRAME_MS);
    accumulator += frameMs;
    lastTime = ts;

    let steps = 0;
    while (accumulator >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      stepGame();
      accumulator -= STEP_MS;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;

    render();
    probeQuality(frameMs);

    requestAnimationFrame(loop);
  }

  // ==========================================================================
  // UI
  // ==========================================================================

  function hideAllPanels() {
    mainMenu.classList.add("hidden");
    gameOverPanel.classList.add("hidden");
    settingsPanel.classList.add("hidden");
  }

  function showHud(show) {
    scoreEl.classList.toggle("hidden", !show);
    hintEl.classList.toggle("hidden", !show);
    if (!show) graceEl.classList.add("hidden");
  }

  function showMainMenu() {
    state = "menu";
    stopCrashSound();
    syncMusicToState();
    hideAllPanels();
    mainMenu.classList.remove("hidden");
    showHud(false);
    graceSteps = 0;
    pipes.length = 0;
    particles.length = 0;
    popups.length = 0;
    bird.y = H / 2;
    bird.vy = 0;
    bird.rot = 0;
    menuBest.textContent = `Best: ${settings.highScore}`;
  }

  function showGameOver() {
    state = "dead";
    hideAllPanels();
    gameOverMsg.textContent = `Score: ${score}`;
    gameOverBest.textContent = `Best: ${settings.highScore}`;
    gameOverPanel.classList.remove("hidden");
    // The panel sits above the HUD and states the score itself, so leaving the
    // HUD score visible underneath just renders it behind an opaque overlay.
    showHud(false);
  }

  function openSettings() {
    returnAfterSettings = state === "dead" ? "dead" : "menu";
    state = "settings";
    hideAllPanels();
    settingsPanel.classList.remove("hidden");
    cancelBinding();
  }

  function closeSettings() {
    cancelBinding();
    if (returnAfterSettings === "dead") showGameOver();
    else showMainMenu();
  }

  function cancelBinding() {
    listeningFor = null;
    bindFlapBtn.classList.remove("listening");
    bindFlapAltBtn.classList.remove("listening");
    bindRestartBtn.classList.remove("listening");
    applySettingsToUI();
  }

  function startBinding(target, btn) {
    cancelBinding();
    listeningFor = target;
    btn.classList.add("listening");
    btn.textContent = "Press a key…";
  }

  function handleKeyBinding(e) {
    if (!listeningFor) return false;
    if (e.code === "Escape") {
      cancelBinding();
      return true;
    }
    if (["Shift", "Control", "Alt", "Meta"].some((k) => e.code.startsWith(k))) return true;
    if (listeningFor === "flap") settings.flapKey = e.code;
    if (listeningFor === "flapAlt") settings.flapAltKey = e.code;
    if (listeningFor === "restart") settings.restartKey = e.code;
    saveSettings();
    cancelBinding();
    return true;
  }

  menuStartBtn.addEventListener("click", () => {
    noteUserGesture();
    startGame();
  });
  menuSettingsBtn.addEventListener("click", openSettings);
  retryBtn.addEventListener("click", startGame);
  goMainBtn.addEventListener("click", showMainMenu);
  goSettingsBtn.addEventListener("click", openSettings);
  settingsBackBtn.addEventListener("click", closeSettings);
  settingsResetBtn.addEventListener("click", () => {
    const best = settings.highScore;
    settings = { ...DEFAULT_SETTINGS, highScore: best };
    saveSettings();
    applyQualitySetting();
  });

  musicVolInput.addEventListener("input", () => {
    settings.musicVolume = Number(musicVolInput.value) / 100;
    saveSettings();
  });
  sfxVolInput.addEventListener("input", () => {
    settings.sfxVolume = Number(sfxVolInput.value) / 100;
    saveSettings();
  });

  function applyQualitySetting() {
    // "auto" keeps whatever tier is current and lets the probe take over again;
    // an explicit choice pins it. Only rebuild when the tier actually changes.
    const want = settings.quality === "auto" ? tier : settings.quality;
    resetProbe();
    if (want !== tier) {
      tier = want;
      buildSprites();
    }
  }

  qualitySelect.addEventListener("change", () => {
    settings.quality = qualitySelect.value;
    saveSettings();
    applyQualitySetting();
  });

  bindFlapBtn.addEventListener("click", () => startBinding("flap", bindFlapBtn));
  bindFlapAltBtn.addEventListener("click", () => startBinding("flapAlt", bindFlapAltBtn));
  bindRestartBtn.addEventListener("click", () => startBinding("restart", bindRestartBtn));

  window.addEventListener("keydown", (e) => {
    if (handleKeyBinding(e)) {
      e.preventDefault();
      return;
    }
    // Without this, holding the key auto-repeats at the OS rate and the bird
    // just hovers instead of flapping once per press.
    if (e.repeat) return;

    if (state === "playing" && isFlapKey(e.code)) {
      e.preventDefault();
      flap();
      return;
    }
    if (state === "dead" && e.code === settings.restartKey) {
      e.preventDefault();
      startGame();
      return;
    }
    if (state === "menu" && (e.code === "Enter" || isFlapKey(e.code))) {
      e.preventDefault();
      noteUserGesture();
      startGame();
    }
  });

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    noteUserGesture();
    if (state === "playing") flap();
    else if (state === "menu") startGame();
  });

  // Any first interaction unlocks audio -- clicking Settings should start the
  // menu music too, not only pressing Start.
  window.addEventListener("pointerdown", noteUserGesture, { once: true });
  window.addEventListener("keydown", noteUserGesture, { once: true });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      paused = true;
    } else {
      paused = false;
      lastTime = 0;
      accumulator = 0;
    }
  });

  window.addEventListener("blur", () => {
    paused = true;
  });
  window.addEventListener("focus", () => {
    paused = false;
    lastTime = 0;
    accumulator = 0;
  });

  // ==========================================================================
  // BOOT
  // ==========================================================================

  setupCanvas();
  tier = resolveTier();
  buildSprites();
  applySettingsToUI();
  applyAudioVolumes();
  updateHint();
  showMainMenu();
  requestAnimationFrame(loop);

  window.addEventListener("resize", () => {
    const want = clamp(window.devicePixelRatio || 1, 1, 2);
    if (Math.abs(want - RENDER_SCALE) > 0.01) {
      setupCanvas();
      buildSprites();
    }
  });
})();
