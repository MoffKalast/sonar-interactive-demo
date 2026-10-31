const INTENSITY = [[6, 10, 16], [52, 30, 18], [158, 84, 30], [238, 160, 62], [255, 236, 190]];
const ELEVATION = [[232, 74, 140], [246, 166, 60], [120, 214, 160], [72, 150, 255]];
const ELEVATION_DISPLAY = { gain: 22, dynamicRange: 40 };

function sample(stops, v, out, offset, scale) {
	const x = Math.min(Math.max(v, 0), 1) * (stops.length - 1);
	const i = Math.min(Math.floor(x), stops.length - 2);
	const f = x - i;
	const a = stops[i];
	const b = stops[i + 1];

	for (let c = 0; c < 3; c++) {
		out[offset + c] = (a[c] + (b[c] - a[c]) * f) * scale;
	}
}

function level(density, display) {
	if (density <= 0) {
		return 0;
	}

	return Math.min(Math.max(1 + (10 * Math.log10(density) + display.gain) / display.dynamicRange, 0), 1);
}

export function imageColors(sonar, display, intensity, elevation) {
	const count = sonar.beams * sonar.rangeBins;
	const norm = sonar.binSize * sonar.azimuthRays / sonar.beams;
	const background = INTENSITY[0];

	for (let i = 0; i < count; i++) {
		const energy = sonar.energy[i];
		const o = i * 3;
		const v = level(energy / norm, ELEVATION_DISPLAY);

		sample(INTENSITY, level(energy / norm, display), intensity, o, 1);

		if (v <= 0) {
			sample(INTENSITY, 0, elevation, o, 1);
			continue;
		}

		sample(ELEVATION, sonar.phiSum[i] / energy, elevation, o, v);

		for (let c = 0; c < 3; c++) {
			elevation[o + c] += background[c] * (1 - v);
		}
	}
}

export function pointColors(sonar, out) {
	const count = sonar.azimuthRays * sonar.elevationRays;

	for (let k = 0; k < count; k++) {
		sample(ELEVATION, sonar.rayShade[k], out, k * 3, 1 / 255);
	}
}

export function css(rgb, alpha = 1) {
	return `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${alpha})`;
}

function ramp(stops, low, high) {
	return `<div class="ramp" style="background: linear-gradient(to right, ${stops.map((stop) => css(stop)).join(', ')})"></div><div class="ramp-labels"><span>${low}</span><span>${high}</span></div>`;
}

export const INTENSITY_LEGEND = ramp(INTENSITY, 'Weak echo', 'Strong echo');
export const ELEVATION_LEGEND = ramp(ELEVATION, 'Bottom of the vertical aperture', 'Top');
