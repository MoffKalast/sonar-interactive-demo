import { createNoise, fractal, ridged } from './noise.js';

export const EXTENT = { min: -75, max: 75 };
export const STEP = 0.15;

const COUNT = Math.round((EXTENT.max - EXTENT.min) / STEP) + 1;
const BLOCK = 10;
const BLOCKS = Math.ceil((COUNT - 1) / BLOCK);
const REGION = 4;
const REGIONS = Math.ceil(BLOCKS / REGION);

export const BLOCK_SIZE = BLOCK * STEP;
export const REGION_SIZE = REGION * BLOCK_SIZE;

function smoothstep(a, b, x) {
	const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
	return t * t * (3 - 2 * t);
}

export class Terrain {
	constructor(mound, weedPatches) {
		const size = COUNT * COUNT;
		const noise = createNoise(3);

		this.undulation = new Float32Array(size);
		this.rocks = new Float32Array(size);
		this.ripples = new Float32Array(size);
		this.mound = new Float32Array(size);
		this.weeds = new Float32Array(size);
		this.relief = new Float32Array(size);
		this.blockMax = new Float32Array(BLOCKS * BLOCKS);
		this.regionMax = new Float32Array(REGIONS * REGIONS).fill(-Infinity);
		this.key = '';

		for (let iz = 0; iz < COUNT; iz++) {
			for (let ix = 0; ix < COUNT; ix++) {
				const i = iz * COUNT + ix;
				const x = EXTENT.min + ix * STEP;
				const z = EXTENT.min + iz * STEP;
				const mask = smoothstep(0.02, 0.25, fractal(noise, x / 11 + 31.7, z / 11 - 12.3, 3));
				const dx = x - mound.x;
				const dz = z - mound.z;

				this.undulation[i] = fractal(noise, x / 14, z / 14, 4) * 1.6;
				this.rocks[i] = mask * Math.max(0, ridged(noise, x / 1.6 + 50, z / 1.6 + 50, 4) - 0.2) / 0.8;
				this.ripples[i] = Math.sin((x * 0.94 + z * 0.34) * 2 * Math.PI / 0.75 + 4 * noise(x / 6 + 9, z / 6 + 9)) * (1 - mask);
				this.mound[i] = Math.exp(-(dx * dx + dz * dz) / (2 * mound.width * mound.width));
			}
		}

		for (const patch of weedPatches) {
			const reach = patch.radius * 1.3;
			const ix0 = Math.max(0, Math.floor((patch.x - reach - EXTENT.min) / STEP));
			const ix1 = Math.min(COUNT - 1, Math.ceil((patch.x + reach - EXTENT.min) / STEP));
			const iz0 = Math.max(0, Math.floor((patch.z - reach - EXTENT.min) / STEP));
			const iz1 = Math.min(COUNT - 1, Math.ceil((patch.z + reach - EXTENT.min) / STEP));

			for (let iz = iz0; iz <= iz1; iz++) {
				for (let ix = ix0; ix <= ix1; ix++) {
					const x = EXTENT.min + ix * STEP;
					const z = EXTENT.min + iz * STEP;
					const r = Math.sqrt((x - patch.x) ** 2 + (z - patch.z) ** 2) / patch.radius + 0.18 * noise(x * 0.7, z * 0.7);
					const i = iz * COUNT + ix;
					this.weeds[i] = Math.max(this.weeds[i], 1 - smoothstep(0.75, 1, r));
				}
			}
		}
	}

	combine(undulation, rocks, ripples, mound) {
		const key = [undulation, rocks, ripples, mound].join();

		if (key === this.key) {
			return;
		}

		this.key = key;

		for (let i = 0; i < this.relief.length; i++) {
			this.relief[i] = undulation * this.undulation[i] + rocks * this.rocks[i] + ripples * this.ripples[i] + mound * this.mound[i];
		}

		this.top = -Infinity;
		this.bottom = Infinity;

		for (const value of this.relief) {
			this.top = Math.max(this.top, value);
			this.bottom = Math.min(this.bottom, value);
		}

		for (let bz = 0; bz < BLOCKS; bz++) {
			for (let bx = 0; bx < BLOCKS; bx++) {
				let top = -Infinity;

				for (let iz = bz * BLOCK; iz <= Math.min(COUNT - 1, (bz + 1) * BLOCK); iz++) {
					for (let ix = bx * BLOCK; ix <= Math.min(COUNT - 1, (bx + 1) * BLOCK); ix++) {
						top = Math.max(top, this.relief[iz * COUNT + ix]);
					}
				}

				this.blockMax[bz * BLOCKS + bx] = top;
			}
		}

		this.regionMax.fill(-Infinity);

		for (let bz = 0; bz < BLOCKS; bz++) {
			for (let bx = 0; bx < BLOCKS; bx++) {
				const r = Math.floor(bz / REGION) * REGIONS + Math.floor(bx / REGION);
				this.regionMax[r] = Math.max(this.regionMax[r], this.blockMax[bz * BLOCKS + bx]);
			}
		}
	}

	sample(grid, x, z) {
		const fx = Math.min(Math.max((x - EXTENT.min) / STEP, 0), COUNT - 1.000001);
		const fz = Math.min(Math.max((z - EXTENT.min) / STEP, 0), COUNT - 1.000001);
		const ix = Math.floor(fx);
		const iz = Math.floor(fz);
		const u = fx - ix;
		const v = fz - iz;
		const i = iz * COUNT + ix;
		const top = grid[i] + (grid[i + 1] - grid[i]) * u;
		const bottom = grid[i + COUNT] + (grid[i + COUNT + 1] - grid[i + COUNT]) * u;
		return top + (bottom - top) * v;
	}

	height(x, z) {
		return this.sample(this.relief, x, z);
	}

	weed(x, z) {
		return this.sample(this.weeds, x, z);
	}

	rockiness(x, z) {
		return Math.min(1, this.sample(this.rocks, x, z) * 2.5);
	}

	ceiling(x0, z0, x1, z1) {
		return this.peak(this.blockMax, BLOCKS, BLOCK_SIZE, x0, z0, x1, z1);
	}

	regionCeiling(x0, z0, x1, z1) {
		return this.peak(this.regionMax, REGIONS, REGION_SIZE, x0, z0, x1, z1);
	}

	peak(grid, count, size, x0, z0, x1, z1) {
		const cx0 = Math.min(Math.max(Math.floor((x0 - EXTENT.min) / size), 0), count - 1);
		const cx1 = Math.min(Math.max(Math.floor((x1 - EXTENT.min) / size), 0), count - 1);
		const cz0 = Math.min(Math.max(Math.floor((z0 - EXTENT.min) / size), 0), count - 1);
		const cz1 = Math.min(Math.max(Math.floor((z1 - EXTENT.min) / size), 0), count - 1);
		let top = -Infinity;

		for (let cz = cz0; cz <= cz1; cz++) {
			for (let cx = cx0; cx <= cx1; cx++) {
				top = Math.max(top, grid[cz * count + cx]);
			}
		}

		return top;
	}
}
