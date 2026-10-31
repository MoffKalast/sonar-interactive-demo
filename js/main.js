import { World, CATEGORY, DEG } from './scene.js';
import { Sonar } from './sonar.js';
import { View3D } from './view3d.js';
import { FanView } from './fanView.js';
import { SideView } from './sideView.js';
import { buildControls, defaultSettings, clampSetting } from './controls.js';
import { angles } from './pose.js';
import { createPilot } from './pilot.js';
import { imageColors, pointColors, INTENSITY_LEGEND, ELEVATION_LEGEND } from './colors.js';

const WORLD_KEYS = new Set(['slope', 'slopeDirection', 'undulation', 'rocks', 'ripples', 'mound', 'objects', 'fish', 'weeds', 'bubbles']);
const DISPLAY_KEYS = new Set(['gain', 'dynamicRange', 'showFrustum', 'showHits']);
const NAMES = {
	[-1]: 'open water',
	[CATEGORY.seabed]: 'the seabed',
	[CATEGORY.weeds]: 'a weed patch',
	[CATEGORY.object]: 'an object',
	[CATEGORY.fish]: 'a fish',
	[CATEGORY.bubbles]: 'a bubble cloud'
};
const STATUS = {
	shadowed: (blocker) => `It is in the acoustic shadow of ${NAMES[blocker]}: sound never reaches it, so it adds nothing to the image.`,
	aboveBeam: () => 'It is above the top of the vertical aperture, so no sound reaches it.',
	belowBeam: () => 'It is below the bottom of the vertical aperture, so no sound reaches it.',
	outsideFan: () => 'It is outside the horizontal field of view.',
	beyondRange: () => 'It is beyond the maximum range.'
};

const settings = defaultSettings();
const world = new World();
const sonar = new Sonar();
const pending = { world: true, sonar: true, trace: true, colors: true, selection: true, draw: true };
const intensityBuffer = new Float32Array(sonar.beams * sonar.rangeBins * 3);
const elevationBuffer = new Float32Array(sonar.beams * sonar.rangeBins * 3);
const pointBuffer = new Float32Array(sonar.azimuthRays * sonar.elevationRays * 3);
const readout = document.querySelector('#readout');
const pilot = createPilot();
const handleButtons = [...document.querySelectorAll('[data-handle]')];
let selection = null;
let arc = null;
let refreshControls = () => {};
let last = performance.now();

const redraw = () => {
	pending.draw = true;
};

const select = (next) => {
	selection = next;
	pending.selection = true;
};

const view = new View3D(document.querySelector('#scene-view'), (ray) => {
	if (!ray || !world.intersect(ray.origin.x, ray.origin.y, ray.origin.z, ray.direction.x, ray.direction.y, ray.direction.z, 500)) {
		select(null);
		return;
	}

	const t = world.hit.t;
	select({ point: [ray.origin.x + ray.direction.x * t, ray.origin.y + ray.direction.y * t, ray.origin.z + ray.direction.z * t], category: world.hit.category });
}, (position, forward, up) => {
	settings.x = clampSetting('x', position[0]);
	settings.y = clampSetting('y', position[2]);
	settings.height = clampSetting('height', position[1] - world.height(settings.x, settings.y));
	Object.assign(settings, angles(forward, up, settings));
	refreshControls();
	pending.sonar = true;
});

function useHandle(mode) {
	view.setHandle(mode);

	for (const button of handleButtons) {
		button.setAttribute('aria-pressed', String(button.dataset.handle === (mode ?? 'off')));
	}
}

for (const button of handleButtons) {
	button.addEventListener('click', () => useHandle(button.dataset.handle === 'off' ? null : button.dataset.handle));
}

window.addEventListener('keydown', (event) => {
	const modes = { KeyG: 'translate', KeyT: 'rotate', KeyH: null };

	if (event.ctrlKey || event.metaKey || event.altKey || !(event.code in modes)) {
		return;
	}

	useHandle(modes[event.code]);
});

const fans = [new FanView(document.querySelector('#intensity-view'), select, redraw), new FanView(document.querySelector('#elevation-view'), select, redraw)];

const side = new SideView(document.querySelector('#side-view'), (point) => {
	if (!point) {
		select(null);
		return;
	}

	let category = world.materialAt(...point);

	if (category === CATEGORY.seabed || category === CATEGORY.weeds) {
		point[1] = world.height(point[0], point[2]);
		category = world.weed(point[0], point[2]) > 0.5 ? CATEGORY.weeds : CATEGORY.seabed;
	} else if (category === -1 && world.bubbleDensity(...point) > 0.05) {
		category = CATEGORY.bubbles;
	}

	select({ point, category });
}, redraw);

refreshControls = buildControls(document.querySelector('#controls'), settings, (key) => {
	if (WORLD_KEYS.has(key)) {
		pending.world = true;
	} else if (DISPLAY_KEYS.has(key)) {
		pending.colors = true;
	} else {
		pending.sonar = true;
	}
});

document.querySelector('#intensity-legend').innerHTML = INTENSITY_LEGEND;
document.querySelector('#elevation-legend').innerHTML = ELEVATION_LEGEND;

function degrees(radians) {
	return `${(radians / DEG).toFixed(1)}°`;
}

function describe(info) {
	if (!selection) {
		return 'Hover over the 3D view, either sonar image or the side view to see where a pixel’s echoes come from.';
	}

	const parts = [`<strong>Bearing ${degrees(selection.theta)}, range ${selection.range.toFixed(1)} m.</strong>`];

	if (info) {
		const what = NAMES[selection.category];
		parts.push(`You’re pointing at ${what}, at ${degrees(info.phi)} elevation relative to the sonar’s axis.`);

		if (info.status !== 'lit') {
			parts.push(STATUS[info.status](info.blocker));
		} else if (selection.category === -1) {
			parts.push('Open water reflects nothing, so this spot adds nothing to the image.');
		} else {
			parts.push('Sound reaches it, so it lights up the circled pixel in the sonar images.');
		}
	}

	if (!arc) {
		return parts.join(' ');
	}

	parts.push('That pixel collects every echo from this bearing and distance, whatever its elevation. The arc drawn in the 3D and side views shows all those places.');

	if (arc.points.length) {
		parts.push(`Along it, sound reaches ${arc.points.map((point) => `${NAMES[point.category]} at ${degrees(point.phi)} elevation`).join(', ')}.`);
	}

	if (arc.bubbles) {
		parts.push('It also crosses a bubble cloud, which adds a diffuse echo.');
	}

	if (!arc.points.length && !arc.bubbles) {
		parts.push('Nothing along it reflects sound, so the pixel stays dark.');
	}

	if (arc.states.includes(-2)) {
		parts.push('The grey part of the arc lies under the seabed or behind something closer, where no sound reaches.');
	}

	return parts.join(' ');
}

function updateSelection() {
	let info = null;
	arc = null;

	if (selection) {
		if (selection.point) {
			info = sonar.inspect(world, ...selection.point);
			selection.theta = info.theta;
			selection.range = info.range;
		}

		if (Math.abs(selection.theta) <= sonar.hfov / 2 && selection.range <= sonar.maxRange && selection.range > 0.05) {
			arc = sonar.arc(world, selection.theta, selection.range);
		}
	}

	view.setSelection(sonar, arc, selection ? selection.point : null);
	readout.innerHTML = describe(info);
}

function frame(now) {
	const dt = Math.min(0.1, (now - last) / 1000);
	last = now;

	if (pilot(settings, dt)) {
		refreshControls();
		pending.sonar = true;
	}

	if (pending.world) {
		world.configure(settings);
		view.updateWorld(world);
		pending.world = false;
		pending.sonar = true;
	}

	if (pending.sonar) {
		sonar.configure(settings, world);
		view.updateSonar(sonar);
		side.dirty = true;
		pending.sonar = false;
		pending.trace = true;
	}

	if (pending.trace) {
		sonar.trace(world);
		pending.trace = false;
		pending.colors = true;
		pending.selection = true;
	}

	if (pending.colors) {
		imageColors(sonar, settings, intensityBuffer, elevationBuffer);
		pointColors(sonar, pointBuffer);
		view.updatePoints(sonar, pointBuffer, settings);
		pending.colors = false;
		pending.draw = true;
	}

	if (pending.selection) {
		updateSelection();
		pending.selection = false;
		pending.draw = true;
	}

	if (pending.draw) {
		fans[0].draw(sonar, intensityBuffer, selection);
		fans[1].draw(sonar, elevationBuffer, selection);
		side.draw(world, sonar, pointBuffer, arc);
		pending.draw = false;
	}

	view.render();
	requestAnimationFrame(frame);
}

useHandle('translate');
requestAnimationFrame(frame);
