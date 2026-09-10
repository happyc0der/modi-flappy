# Modi Flappy

A browser-based Flappy Bird-style game. No build step, no dependencies — it's
three static files and two audio assets.

## Run natively on your machine

### 1) Clone/download the project

```bash
git clone <your-repo-url>
cd modi-flappy
```

### 2) Start a local web server

Use Python (preinstalled on many systems):

```bash
python3 -m http.server 8081
```

### 3) Open the game

Open this URL in your browser:

```text
http://127.0.0.1:8081
```

## Notes

- Do not open `index.html` directly from `file://`; use a local server for reliable audio behavior.
- Click **Start Game** once to satisfy browser audio autoplay rules.

## Controls

| Action | Default |
|---|---|
| Flap | `Space` / `↑` / click or tap the canvas |
| Restart | `R` |
| Start from menu | `Enter` or any flap key |

All three key bindings are remappable in **Settings** and persist in `localStorage`.

## Layout

```
index.html          markup, HUD and menu panels
style.css           page chrome, panels, HUD
game.js             everything else, in labelled sections:
                    CONFIG · SPRITES · AUDIO · SIMULATION · RENDER · UI
assets/audio/       theme.mp3 (music), flap.mp3 (flap SFX)
```

## How it works

**Fixed-timestep simulation.** The game simulates at exactly 60 steps per second
regardless of display refresh rate, using an accumulator in `loop()`. Every
physics constant (`GRAVITY`, `FLAP`, `PIPE_SPEED`) is expressed per-step, so the
game plays identically on a 60 Hz panel and a 144 Hz one. Measured spread in fall
distance across 30–165 Hz is under 0.1 px.

**Pipes are spaced by distance, not time.** `PIPE_SPACING` is a pixel distance
measured from `SPAWN_X`, so the gap between pipes does not depend on frame rate.
Gap centres follow a bounded random walk (`MAX_CENTER_DELTA`) so consecutive
pipes never demand more vertical travel than the horizontal spacing allows.

**The hitbox is the art.** `gapTop` / `gapBottom` are the same values used both
to draw the pipe mouths and to test collisions, and the flange collar is drawn
*inside* the pipe body rather than overhanging it. There is no region where the
bird looks clear but dies, or looks blocked but survives.

**Sprites are pre-rendered.** All static art — parallax layers, pipe body and
mouths, the character — is rasterised once into offscreen canvases at startup by
`buildSprites()` and then blitted. A frame is ~22 `drawImage` calls and **zero**
gradient allocations.

**Quality tiers** (`Settings → Graphics`) scale decoration only — parallax
layers, particles, ambient effects. Gameplay geometry is byte-identical on Low,
Medium and High; only the scenery changes.

## Adding your own art

Sprites are plain canvas draw functions in the `SPRITES` section of `game.js`;
each returns an offscreen canvas via `makeSprite(w, h, drawFn)`. To swap the
character for a bitmap, replace `buildModi()` with something that draws an
`Image` into the same `MODI_W × MODI_H` box — nothing downstream needs to change.
