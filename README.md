# Modi Flappy

A Flappy Bird knock-off where you play a caricature of Narendra Modi, flapping
through the overflowing sewer pipes of a Mumbai slum at dusk.

![Modi Flappy gameplay](docs/screenshot.png)

## What it is

It's a meme game, and it is exactly as serious as that sounds. Tap to flap, thread
the gap between two dripping storm drains, don't hit anything. Every pipe you clear
is a point, the gap narrows and the pace picks up as you go, and hitting something
gets you a Hindi expletive shouted at you.

The whole thing is one HTML file, one CSS file and one JavaScript file. No build
step, no framework, no dependencies, no bundler — open a static server and it runs.
Every visual in it, including the character and the entire slum skyline, is drawn
with Canvas 2D path calls in `game.js`; there are no image assets at all.

## Running it

You need Python 3 (or any static file server) and a modern browser.

```bash
python3 -m http.server 8081
```

Then open <http://127.0.0.1:8081>.

Don't open `index.html` straight off the filesystem — `file://` blocks the `fetch()`
calls the audio loader uses, so the music and sound effects will silently not work.

## Controls

| Action | Default |
|---|---|
| Flap | `Space`, `↑`, or click / tap the canvas |
| Restart after a crash | `R` |
| Start from the menu | `Enter`, or any flap key |
| Cancel a key rebind | `Esc` |

Flapping during the "GET READY" countdown starts the run immediately rather than
being swallowed.

## Settings

- **Volume** — separate music and SFX sliders.
- **Graphics** — `Auto`, `Low`, `Medium`, `High`. This only ever changes decoration
  (parallax layers, particles, ambient effects). Gap sizes, pipe spacing and speed
  are identical on every setting, so the difficulty never changes with it.
- **Controls** — all three key bindings are remappable.

Settings and your high score persist in `localStorage`.

## How it works

A few things in here are less obvious than they look:

**The simulation is fixed-timestep.** It runs at exactly 60 steps per second no
matter what the display does, via an accumulator in `loop()`. Every physics constant
(`GRAVITY`, `FLAP`, and the speed `speedFor()` returns) is per-step. This matters more than it
sounds: with frame-based physics, a 120Hz display gets 4× the gravity but only 2× the
flap strength, so the bird plummets and the game is unplayable — which is precisely
the bug this replaced.

**Pipe spacing is a distance, not a duration.** `spacingFor()` returns pixels, measured
from `SPAWN_X`, so the gap between pipes doesn't depend on frame rate either. Gap
centres follow a bounded random walk (`MAX_CENTER_DELTA`) so two consecutive pipes
can never demand more vertical travel than the horizontal spacing gives you time for.

**The hitbox is the art.** `gapTop` and `gapBottom` are the same numbers used both to
draw the pipe mouths and to test collisions, and each pipe's flange collar is drawn
*inside* the barrel rather than overhanging it. There's no region where you look
clear but die, or look blocked but survive.

**All static art is pre-rendered.** Parallax layers, the pipe barrel and mouths, and
the character are rasterised once into offscreen canvases by `buildSprites()` and
then blitted. A frame is about 22 `drawImage` calls and zero gradient allocations.

**Music loops from an offset.** The theme's source file opens with a groan and a
quiet lead-in, so it's decoded into an `AudioBuffer` and looped from
`MUSIC_LOOP_START` rather than trimmed — re-encoding the mp3 would add encoder delay
that hiccups on every loop, and a stream copy can only cut on a frame boundary.

**Quality auto-detect watches delivered frame rate**, not render time. Timing
`render()` only measures the cost of *issuing* canvas commands; the GPU work is
asynchronous and uncounted, so it reads as fast on every machine and can never
detect one that's struggling.

## Project layout

```
index.html          markup, HUD, and the menu / game-over / settings panels
style.css           page chrome, panels, HUD
game.js             everything else, in labelled sections:
                    CONFIG · SPRITES · AUDIO · SIMULATION · RENDER · UI
assets/audio/       theme.mp3 (music), flap.mp3 (crash sound)
docs/screenshot.png the image above
```

## Tweaking it

Most of what you'd want to change is a named constant at the top of `game.js`:

| Constant | Does |
|---|---|
| `GAP_START` / `GAP_END` / `GAP_AT` | How wide the gap is, and how fast it narrows |
| `SPEED_START` / `SPEED_END` | Scroll speed ramp |
| `SPACING_START` / `SPACING_END` | Distance between pipes |
| `MODI_SCALE` | How big the character is drawn |
| `BIRD_R` | Collision radius — the real difficulty lever |
| `MUSIC_LOOP_START` | Where the theme loops from |

Sprites are plain Canvas draw functions in the `SPRITES` section, each returning an
offscreen canvas from `makeSprite(w, h, drawFn)`. To swap the character for a bitmap,
replace `buildModi()` with something that draws an `Image` into the same
`MODI_W × MODI_H` box; nothing downstream needs to change.

## Notes

- **The crash sound is explicit.** `assets/audio/flap.mp3` is a clip of Hindi
  profanity. It plays every time you die. Turn the SFX slider down if that's a
  problem where you are.
- This is a private joke project about a sitting head of government. Keep that in
  mind before making the repository public.
