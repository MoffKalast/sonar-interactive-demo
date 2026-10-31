const GRADIENTS = [[1, 0], [-1, 0], [0, 1], [0, -1], [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2]];

export function random(seed) {
	let state = seed;

	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function fade(t) {
	return t * t * t * (t * (t * 6 - 15) + 10);
}

function corner(hash, x, y) {
	const g = GRADIENTS[hash & 7];
	return g[0] * x + g[1] * y;
}

export function createNoise(seed) {
	const next = random(seed);
	const order = Array.from({ length: 256 }, (_, i) => i);

	for (let i = 255; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		[order[i], order[j]] = [order[j], order[i]];
	}

	const perm = new Uint8Array(512);

	for (let i = 0; i < 512; i++) {
		perm[i] = order[i & 255];
	}

	return (x, y) => {
		const xi = Math.floor(x);
		const yi = Math.floor(y);
		const xf = x - xi;
		const yf = y - yi;
		const X = xi & 255;
		const Y = yi & 255;
		const u = fade(xf);
		const v = fade(yf);
		const a = corner(perm[X + perm[Y]], xf, yf);
		const b = corner(perm[X + 1 + perm[Y]], xf - 1, yf);
		const c = corner(perm[X + perm[Y + 1]], xf, yf - 1);
		const d = corner(perm[X + 1 + perm[Y + 1]], xf - 1, yf - 1);
		const top = a + (b - a) * u;
		const bottom = c + (d - c) * u;
		return top + (bottom - top) * v;
	};
}

export function fractal(noise, x, y, octaves) {
	let sum = 0;
	let amplitude = 1;
	let total = 0;
	let frequency = 1;

	for (let o = 0; o < octaves; o++) {
		sum += noise(x * frequency, y * frequency) * amplitude;
		total += amplitude;
		amplitude *= 0.5;
		frequency *= 2;
	}

	return sum / total;
}

export function ridged(noise, x, y, octaves) {
	let sum = 0;
	let amplitude = 1;
	let total = 0;
	let frequency = 1;

	for (let o = 0; o < octaves; o++) {
		const crest = 1 - Math.min(1, Math.abs(noise(x * frequency + 17 * o, y * frequency - 9 * o)) * 1.6);
		sum += crest * crest * amplitude;
		total += amplitude;
		amplitude *= 0.5;
		frequency *= 2.1;
	}

	return sum / total;
}
