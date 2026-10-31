import { DEG, CATEGORY } from './scene.js';
import { random } from './noise.js';
import { frame } from './pose.js';

export const BEAMS = 128;
export const AZIMUTH_RAYS = 128;
export const ELEVATION_RAYS = 128;
export const RANGE_BINS = 320;

const BUBBLE_BACKSCATTER = 0.5;
const MAX_FOOTPRINT = 2;
const ARC_SAMPLES = 241;

export class Sonar {
	constructor() {
		const count = AZIMUTH_RAYS * ELEVATION_RAYS;
		const next = random(5);

		this.beams = BEAMS;
		this.azimuthRays = AZIMUTH_RAYS;
		this.elevationRays = ELEVATION_RAYS;
		this.rangeBins = RANGE_BINS;
		this.energy = new Float32Array(BEAMS * RANGE_BINS);
		this.phiSum = new Float32Array(BEAMS * RANGE_BINS);
		this.hitX = new Float32Array(count);
		this.hitY = new Float32Array(count);
		this.hitZ = new Float32Array(count);
		this.rayT = new Float32Array(count);
		this.rayShade = new Float32Array(count);
		this.jitterTheta = Float32Array.from({ length: count }, () => next() - 0.5);
		this.jitterPhi = Float32Array.from({ length: count }, () => next() - 0.5);
		this.dx = 0;
		this.dy = 0;
		this.dz = 0;
	}

	configure(settings, world) {
		const pose = frame(settings.yaw, settings.tilt, settings.roll);
		this.heading = pose.heading;
		this.forward = pose.forward;
		this.up = pose.up;
		this.side = pose.side;
		this.origin = [settings.x, world.height(settings.x, settings.y) + settings.height, settings.y];
		this.hfov = settings.hfov * DEG;
		this.vfov = settings.vfov * DEG;
		this.maxRange = settings.maxRange;
		this.binSize = this.maxRange / this.rangeBins;
	}

	thetaOf(i) {
		return -this.hfov / 2 + (i + 0.5) * this.hfov / this.azimuthRays;
	}

	aim(theta, phi) {
		const f = this.forward;
		const s = this.side;
		const u = this.up;
		const a = Math.cos(phi) * Math.cos(theta);
		const b = Math.cos(phi) * Math.sin(theta);
		const c = Math.sin(phi);
		this.dx = f[0] * a + s[0] * b + u[0] * c;
		this.dy = f[1] * a + s[1] * b + u[1] * c;
		this.dz = f[2] * a + s[2] * b + u[2] * c;
	}

	trace(world) {
		this.energy.fill(0);
		this.phiSum.fill(0);

		const [ox, oy, oz] = this.origin;
		const step = this.vfov / this.elevationRays;
		const hit = world.hit;

		for (let i = 0; i < this.azimuthRays; i++) {
			const beam = Math.floor(i * this.beams / this.azimuthRays);

			for (let j = 0; j < this.elevationRays; j++) {
				const k = i * this.elevationRays + j;
				const theta = this.thetaOf(i + this.jitterTheta[k]);
				const shade = (j + 0.5 + this.jitterPhi[k]) / this.elevationRays;
				const phi = (shade - 0.5) * this.vfov;

				this.aim(theta, phi + Math.PI / 2);
				const ux = this.dx;
				const uy = this.dy;
				const uz = this.dz;
				this.aim(theta, phi);
				const { dx, dy, dz } = this;

				const found = world.intersect(ox, oy, oz, dx, dy, dz, this.maxRange);
				const end = found ? hit.t : this.maxRange;
				const outgoing = Math.exp(-4 * Math.LN2 * (phi / this.vfov) ** 2) * step;
				const transmission = this.scatterVolume(world, beam, dx, dy, dz, end, outgoing, shade);

				this.hitX[k] = ox + dx * end;
				this.hitY[k] = oy + dy * end;
				this.hitZ[k] = oz + dz * end;
				this.rayT[k] = found ? end : -1;
				this.rayShade[k] = shade;

				if (!found) {
					continue;
				}

				const facing = Math.max(1e-3, -(dx * hit.nx + dy * hit.ny + dz * hit.nz));
				const strength = outgoing * transmission * hit.reflectivity * facing;
				const spread = Math.abs(ux * hit.nx + uy * hit.ny + uz * hit.nz) / facing;
				const footprint = Math.min(MAX_FOOTPRINT, Math.max(this.binSize, end * step * spread));

				this.deposit(beam, end - footprint / 2, footprint, strength, shade);
			}
		}
	}

	scatterVolume(world, beam, dx, dy, dz, end, outgoing, shade) {
		const [ox, oy, oz] = this.origin;
		let transmission = 1;

		for (const cloud of world.clouds) {
			if (!world.cloudSpan(cloud, ox, oy, oz, dx, dy, dz)) {
				continue;
			}

			const start = Math.max(0, world.spanNear);
			const stop = Math.min(end, world.spanFar);
			const steps = Math.ceil((stop - start) / this.binSize);

			if (steps <= 0) {
				continue;
			}

			const ds = (stop - start) / steps;

			for (let s = 0; s < steps; s++) {
				const t = start + (s + 0.5) * ds;
				const density = world.cloudDensity(cloud, ox + dx * t, oy + dy * t, oz + dz * t);
				const pass = Math.exp(-density * ds);
				this.deposit(beam, t - ds / 2, ds, outgoing * transmission * transmission * (1 - pass) * BUBBLE_BACKSCATTER, shade);
				transmission *= pass;
			}
		}

		return transmission * transmission;
	}

	deposit(beam, start, length, amount, shade) {
		const base = beam * this.rangeBins;
		const first = Math.max(0, Math.floor(start / this.binSize));
		const last = Math.min(this.rangeBins - 1, Math.floor((start + length) / this.binSize));

		for (let r = first; r <= last; r++) {
			const overlap = Math.min(start + length, (r + 1) * this.binSize) - Math.max(start, r * this.binSize);

			if (overlap <= 0) {
				continue;
			}

			const share = amount * overlap / length;
			const index = base + r;
			this.energy[index] += share;
			this.phiSum[index] += share * shade;
		}
	}

	locate(x, y, z) {
		const vx = x - this.origin[0];
		const vy = y - this.origin[1];
		const vz = z - this.origin[2];
		const range = Math.hypot(vx, vy, vz);
		const f = vx * this.forward[0] + vy * this.forward[1] + vz * this.forward[2];
		const s = vx * this.side[0] + vy * this.side[1] + vz * this.side[2];
		const u = vx * this.up[0] + vy * this.up[1] + vz * this.up[2];
		return { range, theta: Math.atan2(s, f), phi: Math.asin(Math.max(-1, Math.min(1, u / range))) };
	}

	inspect(world, x, y, z) {
		const place = this.locate(x, y, z);
		const [ox, oy, oz] = this.origin;
		const tolerance = Math.max(0.05, place.range * 0.005);
		const found = world.intersect(ox, oy, oz, (x - ox) / place.range, (y - oy) / place.range, (z - oz) / place.range, place.range + tolerance);
		let status = 'lit';

		if (place.range > this.maxRange) {
			status = 'beyondRange';
		} else if (Math.abs(place.theta) > this.hfov / 2) {
			status = 'outsideFan';
		} else if (Math.abs(place.phi) > this.vfov / 2) {
			status = place.phi > 0 ? 'aboveBeam' : 'belowBeam';
		} else if (found && world.hit.t < place.range - tolerance) {
			status = 'shadowed';
		}

		return { ...place, status, blocker: status === 'shadowed' ? world.hit.category : -1 };
	}

	arc(world, theta, range) {
		const [ox, oy, oz] = this.origin;
		const positions = new Float32Array(ARC_SAMPLES * 3);
		const states = new Int8Array(ARC_SAMPLES);
		const candidates = [];
		const hit = world.hit;
		let previous = null;

		for (let k = 0; k < ARC_SAMPLES; k++) {
			const phi = -this.vfov / 2 + this.vfov * k / (ARC_SAMPLES - 1);
			this.aim(theta, phi);
			const { dx, dy, dz } = this;
			const x = ox + dx * range;
			const y = oy + dy * range;
			const z = oz + dz * range;
			const found = world.intersect(ox, oy, oz, dx, dy, dz, range + 2);
			const current = found ? { k, t: hit.t, id: hit.id, category: hit.category, x: ox + dx * hit.t, y: oy + dy * hit.t, z: oz + dz * hit.t, phi } : null;

			positions.set([x, y, z], k * 3);

			if (current && current.t < range) {
				states[k] = -2;
			} else {
				states[k] = world.bubbleDensity(x, y, z) > 0.05 ? CATEGORY.bubbles : -1;
			}

			if (current && Math.abs(current.t - range) <= this.binSize) {
				candidates.push({ ...current, miss: Math.abs(current.t - range) });
			}

			if (current && previous && current.id === previous.id && (previous.t - range) * (current.t - range) < 0 && Math.abs(current.t - previous.t) < 1.5) {
				const f = (range - previous.t) / (current.t - previous.t);
				candidates.push({ k, id: current.id, category: current.category, x: previous.x + (current.x - previous.x) * f, y: previous.y + (current.y - previous.y) * f, z: previous.z + (current.z - previous.z) * f, phi: previous.phi + (current.phi - previous.phi) * f, miss: 0 });
			}

			previous = current;
		}

		const points = [];

		for (const candidate of candidates) {
			const last = points[points.length - 1];

			if (last && last.id === candidate.id && candidate.k - last.k <= 1) {
				points[points.length - 1] = candidate.miss < last.miss ? candidate : { ...last, k: candidate.k };
				continue;
			}

			points.push(candidate);
		}

		return { theta, range, positions, states, points, bubbles: states.includes(CATEGORY.bubbles) };
	}
}
