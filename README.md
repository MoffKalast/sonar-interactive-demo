# Forward-looking sonar playground

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An interactive demo of how a forward-looking imaging sonar turns a 3D scene into a 2D fan image. 


## Running it

There is no build step and no package manager. Serve the folder with any static file server and open `index.html`:

```
python3 -m http.server 8000
```

Opening the file directly from disk won't work, because browsers block ES module imports from `file://` pages.

three.js 0.160 is loaded from jsDelivr through the import map in `index.html`. If you upgrade three.js, note that from r169 onwards `TransformControls` is no longer an `Object3D` itself: you add `gizmo.getHelper()` to the scene instead of the gizmo (see `buildHandle` in `view3d.js`).

## How it fits together

The code splits into three layers:

1. **Simulation** (`scene.js`, `terrain.js`, `noise.js`, `sonar.js`, `pose.js`). Plain JavaScript with no DOM or three.js. It describes the world, casts rays and fills the sonar image buffers.
2. **Presentation** (`view3d.js`, `fanView.js`, `sideView.js`, `colors.js`). Turns simulation results into pixels: the three.js scene, the two fan images and the side view.
3. **Wiring and input** (`main.js`, `controls.js`, `pilot.js`). Owns the single `settings` object, builds the control panel, reads the keyboard and the drag handle, and schedules updates.

All state that the user can change lives in one flat `settings` object created by `defaultSettings()` in `controls.js`. Everything else is derived from it.

### The update loop

`main.js` runs one `requestAnimationFrame` loop with a set of dirty flags in `pending`. Each stage only runs when something upstream changed, and each stage marks the next one dirty:

```
world  → sonar → trace → colors → selection → draw → (3D render every frame)
```

- **world**: seabed shape, slope, which object groups are enabled. Rebuilds the terrain blend and the 3D meshes. Triggered by keys in `WORLD_KEYS`.
- **sonar**: position, orientation, field of view, range. Recomputes the sonar frame. Triggered by every key that is neither a world nor a display key.
- **trace**: casts all rays and fills the image buffers. This is the expensive step (roughly 30 to 50 ms).
- **colors**: converts buffers to RGB using gain and dynamic range. Triggered by keys in `DISPLAY_KEYS`.
- **selection**: recomputes what's under the mouse and the readout text.
- **draw**: repaints the fan images and the side view.

Because of this chain, changing gain never retraces, and moving the mouse never retraces either. Anything that changes every frame and marks `trace` dirty will cost a full trace per frame, which is why the fish no longer swim.

### Coordinates and conventions

- World axes follow three.js: `y` is up. The user-facing "Position X" is world `x`, and "Position Y" is world `z`.
- Distances are metres, angles in `settings` are degrees, angles inside the simulation are radians (`DEG` converts).
- Yaw 0 faces `+x`. Positive yaw turns toward `+z`. Positive pitch (`tilt`) points the nose down. Positive roll lowers the sonar's right side.
- The sonar has its own frame: `forward`, `up` and `side` (pointing right). Within the fan, `theta` is the angle across the fan (positive to the right) and `phi` is the elevation (positive up).
- Every object that can be hit has a `category` from `CATEGORY` in `scene.js`. Categories decide reflectivity and the names used in the readout.

## The files

### `index.html` and `style.css`

The page layout, the explanatory text and the empty containers that the scripts fill. The grid rows in `.views` have fixed heights on purpose: if any row resized with its content, the readout text changing on hover would resize the 3D canvas and make it flicker.

### `js/main.js`

The entry point. It creates the `World`, the `Sonar`, the three views and the control panel, and connects them:

- holds `settings`, the dirty flags and the current hover `selection`
- turns hovers from any view into a selection (a bearing and range, plus a 3D point when there is one)
- receives poses from the drag handle and writes them back into `settings`
- writes the readout text in `describe()`
- runs the frame loop described above

When adding a new setting, decide which of `WORLD_KEYS` or `DISPLAY_KEYS` it belongs to; anything not listed is treated as a sonar setting.

### `js/controls.js`

The control panel is generated from the `CONTROLS` array. Each entry is a slider (`min`, `max`, `step`, `value`, `unit`) or a toggle (`type: 'toggle'`). `defaultSettings()` reads the default values from that array, and `clampSetting()` keeps values from the keyboard and drag handle inside slider limits. `buildControls()` returns a refresh function that `main.js` calls after anything other than a slider changes `settings`, so the sliders always show the current state.

### `js/pilot.js`

Keyboard driving. `createPilot()` tracks held keys (by physical key position, so it works on any layout) and returns a function that, given `settings` and the frame time, moves and turns the sonar and reports whether anything changed. The key map and speeds are the `KEYS` and `SPEED` tables at the top.

### `js/pose.js`

All orientation maths in one place. `frame(yaw, tilt, roll)` builds the sonar's `forward`, `up` and `side` vectors plus its flat `heading`. `angles(forward, up, previous)` goes the other way, for the rotate handle. Every orientation can be described by two angle sets, `(yaw, pitch, roll)` and `(yaw + 180°, 180° − pitch, roll + 180°)`, so `angles()` returns whichever is closer to `previous` to stop the sliders jumping. At pitch ±90° it keeps the previous yaw. `wrap()` folds any angle into −180° to 180°.

### `js/scene.js`

The world. `createLayout()` places everything with a fixed random seed: weed patches, fish schools, blocks, hexagonal prisms and boulders, spread over ±70 m, plus the mound and bubble clouds. Change the seed or the counts there to get a different map.

`World` turns that layout plus `settings` into something rays can hit:

- `configure(settings)` sets the slope, blends the terrain, and builds the enabled objects. Blocks and hexagons become convex solids described by their face planes, sunk into the ground far enough to sit flush on rough terrain. Boulders and fish become ellipsoids. Fish are grouped into schools with a bounding sphere.
- `intersect(origin, direction, tMax)` finds the first hit and writes it into the shared `world.hit` record (distance, category, reflectivity, surface normal). It checks cheap bounding spheres before exact shapes, then marches the seabed only up to the nearest object hit.
- `marchSeabed()` finds where a ray meets the ground. It first works out from the terrain's overall highest and lowest points the stretch of the ray that could possibly touch the ground. It then skips 6 m regions and 1.5 m blocks whose highest point is below the ray, steps along the ray only where it is close to the ground, and finishes with a few secant steps to pin down the hit.
- `cloudSpan()` and `cloudDensity()` describe the bubble clouds, which are volumes rather than surfaces.
- `materialAt(x, y, z)` says what occupies a point, which the side view uses to paint its background.

`world.hit` is reused for every call to avoid allocating millions of objects per trace. Read what you need from it before the next `intersect()` call.

### `js/terrain.js`

The seabed relief, precomputed once at load (about half a second) into a 0.15 m grid covering 150 × 150 m. It stores separate layers for rolling hills, rocks, sand ripples, the mound and weed coverage. `combine()` blends the layers with the current slider amplitudes, which only takes a few milliseconds, and rebuilds the per-block and per-region maximum heights that `marchSeabed()` uses to skip empty space. `height()`, `weed()` and `rockiness()` read the grids with bilinear interpolation. The slope is not in the grid; `World.height()` adds it on top.

### `js/noise.js`

Seeded randomness and Perlin noise: `random(seed)` returns a repeatable random number generator, `createNoise(seed)` returns a 2D Perlin noise function, and `fractal()` and `ridged()` add up several octaves for smooth hills and sharp rocky ridges.

### `js/sonar.js`

The sonar model and the heart of the demo.

- `configure(settings, world)` sets the pose, field of view and range bins.
- `trace(world)` casts a 128 × 128 grid of rays: one per horizontal beam, 128 across the vertical aperture. Each ray gets a fixed random offset within its cell so no regular sampling pattern shows. For each ray it:
  1. finds the first surface hit,
  2. passes through any bubble clouds on the way, depositing their echoes and losing energy both out and back,
  3. computes the surface echo from the beam's vertical sensitivity, the remaining energy, the reflectivity and how squarely the sound hits,
  4. spreads that echo over the stretch of range the ray's slice of the aperture covers on that surface, so far-range seabed doesn't break up into stripes.
- The results land in two per-cell arrays indexed by `(beam, range bin)`: `energy` (the echo) and `phiSum` (energy-weighted elevation, for the elevation image). Per-ray hit points and elevations are kept for the 3D speckles and side view.
- `inspect()` explains a single 3D point: where it sits in the fan, and whether it is lit, shadowed, outside the fan or out of range.
- `arc()` samples the full arc of points that share one pixel (same bearing and range, every elevation) and finds which surfaces on it actually return sound. This drives the hover arc.

The constants at the top (`BEAMS`, `AZIMUTH_RAYS`, `ELEVATION_RAYS`, `RANGE_BINS`, `MAX_FOOTPRINT`, `BUBBLE_BACKSCATTER`) are the main quality and speed controls.

### `js/colors.js`

Turns sonar buffers into colours. `imageColors()` fills both image buffers. The echo-strength image converts each cell to decibels, then uses gain and dynamic range from `settings`. The elevation image uses its own fixed, brighter mapping (`ELEVATION_DISPLAY`) so faint areas still show where echoes came from. `pointColors()` colours the 3D speckles by elevation. It also builds the legend HTML.

### `js/view3d.js`

Everything three.js: the seabed mesh with sand, rock and weed colouring, objects, instanced fish and weeds, bubble points, the sonar body with its coverage outline, the landing speckles, the hover arc and probe line, the orbit camera and the drag handle. `updateWorld()` rebuilds scene contents after a world change, `updateSonar()` moves the sonar and makes the camera follow it, and `updatePoints()` refreshes the speckles after a trace. The drag handle is attached to an invisible stand-in object; while dragging, the stand-in leads and the real sonar follows through `settings`, and camera following is paused so the drag doesn't feed back into itself.

### `js/fanView.js`

Draws one fan-shaped sonar image on a canvas. On resize or field-of-view change it precomputes, for every pixel, which beam and range bin it falls in. Each redraw is then just a lookup with bilinear interpolation, plus range rings, bearing lines and the hover marker. `main.js` creates two of these, one per colour buffer.

### `js/sideView.js`

A vertical slice through the sonar along its heading. The background is painted by asking `World.materialAt()` for every pixel and is only repainted when the world or pose changes. On top it draws the vertical aperture outline, the region the sound travels through coloured by elevation, the lit surface line, the hover arc and the sonar itself.

## Working on it

### Testing the simulation without a browser

The simulation modules don't touch the DOM, so they run in Node, which is the quickest way to profile or check a change. Node needs to be told these are ES modules: put a `package.json` containing `{"type": "module"}` next to your test script. `controls.js` can also be imported for `defaultSettings()`, as long as you don't call `buildControls()`.

```js
import { World } from '../js/scene.js';
import { Sonar } from '../js/sonar.js';
import { defaultSettings } from '../js/controls.js';

const settings = defaultSettings();
const world = new World();
const sonar = new Sonar();
world.configure(settings);
sonar.configure(settings, world);

const start = performance.now();
sonar.trace(world);
console.log(`trace took ${(performance.now() - start).toFixed(1)} ms`);
```

`node --cpu-prof` on a script like this shows where trace time goes.

### Common changes

**Adding a control.** Add an entry to `CONTROLS` in `controls.js`, read `settings.yourKey` where it's needed, and add the key to `WORLD_KEYS` or `DISPLAY_KEYS` in `main.js` if it isn't a sonar setting.

**Adding a kind of object.** If it's convex, give it a plane list in `scene.js` (see `boxPlanes()` and `hexagonPlanes()`) and a matching mesh in `updateObjects()` in `view3d.js`. The face planes and the mesh faces need to line up, or the 3D view will disagree with the sonar image. If it's roundish, use `ellipsoid()`. Place instances in `createLayout()`.

**Adding a material.** Add a category to `CATEGORY` and a reflectivity to `REFLECTIVITY` in `scene.js`, a fill colour in `sideView.js`, and a name in `NAMES` in `main.js`.

**Changing the terrain.** New layers go in the `Terrain` constructor, get a weight in `combine()`, and a slider. Keep the max-height grids built from the combined relief, or the seabed march will skip over the new terrain.

**Changing how echoes are computed.** The physics is in `Sonar.trace()` and `Sonar.scatterVolume()`. The image is normalised per metre of range and per ray, so changing the ray counts or range bins shouldn't change brightness.

### Performance budget

A trace takes about 30 to 50 ms with default settings, so anything that retraces every frame (keyboard driving, dragging the handle) runs at around 20 updates a second. The main levers are the ray counts in `sonar.js` and the step sizes in `World.refine()`. Objects are cheap as long as each check starts with a bounding sphere. Avoid creating objects inside the per-ray code; the trace is written to reuse `world.hit` and the sonar's `dx`, `dy`, `dz` fields for that reason.

### Code style

Tabs for indentation, one statement per line, blank lines between logical blocks, and no comments.

### Known simplifications

Sound travels in straight lines at constant speed. There are no surface or multiple reflections, no speckle and no horizontal side lobes. Spreading loss is assumed to be fully compensated by the sonar's gain. Beyond the 150 m terrain area the relief is held at its edge values.
