import { Terrain, STEP, BLOCK_SIZE, REGION_SIZE } from './terrain.js';
import { random } from './noise.js';

export const DEG = Math.PI / 180;

export const CATEGORY = { seabed: 0, weeds: 1, object: 2, fish: 3, bubbles: 4 };

const REFLECTIVITY = { seabed: 0.5, weeds: 0.03, object: 1.2, fish: 3 };
const SPREAD = 70;

function createLayout() {
	const next = random(21);
	const between = (low, high) => low + (high - low) * next();
	const spot = (clearance) => {
		let x = 0;
		let z = 0;

		do {
			x = between(-SPREAD, SPREAD);
			z = between(-SPREAD, SPREAD);
		} while (x * x + z * z < clearance * clearance);

		return { x, z, yaw: next() * 360 };
	};

	const solids = [
		{ kind: 'box', x: 12, z: -4, yaw: 25, width: 1.6, depth: 1.6, height: 1.6 },
		{ kind: 'hexagon', x: 18, z: 4.5, yaw: 10, radius: 1.3, height: 1.2 }
	];
	const boulders = [];
	const weeds = [];
	const schools = [];

	for (let n = 0; n < 60; n++) {
		const place = spot(4);
		const pick = next();

		if (pick < 0.35) {
			solids.push({ ...place, kind: 'box', width: between(0.4, 2.5), depth: between(0.4, 2.5), height: between(0.3, 2) });
		} else if (pick < 0.6) {
			solids.push({ ...place, kind: 'hexagon', radius: between(0.3, 1.5), height: between(0.3, 1.8) });
		} else {
			boulders.push({ ...place, length: between(0.5, 2.4), width: between(0.4, 1.8), height: between(0.3, 1.4) });
		}
	}

	for (let n = 0; n < 70; n++) {
		weeds.push({ ...spot(0), radius: 0.8 + 6 * next() ** 2 });
	}

	for (let n = 0; n < 40; n++) {
		const size = Math.round(3 + 37 * next() ** 2);
		const radius = 0.4 * Math.sqrt(size) * between(1, 1.8);
		const members = [];

		for (let m = 0; m < size; m++) {
			const angle = next() * Math.PI * 2;
			const distance = radius * Math.sqrt(next());
			members.push({ dx: Math.cos(angle) * distance, dz: Math.sin(angle) * distance, dy: between(-0.35, 0.35) * Math.sqrt(size) * 0.3, turn: between(-20, 20), scale: between(0.85, 1.15) });
		}

		schools.push({ ...spot(3), altitude: between(0.8, 4), length: between(0.25, 0.8), members });
	}

	return {
		mound: { x: 23, z: -3, height: 1.8, width: 3 },
		clouds: [
			{ x: 7, z: -5, altitude: 2, radius: 1.6, density: 1.4 },
			{ x: 20, z: -1, altitude: 2.8, radius: 2.2, density: 1 }
		],
		solids,
		boulders,
		weeds,
		schools
	};
}

export const LAYOUT = createLayout();

function boxPlanes(halfWidth, halfDepth, top, sink) {
	return [[1, 0, 0, halfWidth], [-1, 0, 0, halfWidth], [0, 0, 1, halfDepth], [0, 0, -1, halfDepth], [0, 1, 0, top], [0, -1, 0, sink]];
}

function hexagonPlanes(radius, top, sink) {
	const apothem = radius * Math.cos(30 * DEG);
	const planes = [];

	for (let k = 0; k < 6; k++) {
		const angle = (30 + 60 * k) * DEG;
		planes.push([Math.sin(angle), 0, Math.cos(angle), apothem]);
	}

	planes.push([0, 1, 0, top], [0, -1, 0, sink]);
	return planes;
}

function ellipsoid(id, category, x, y, z, yaw, ax, ay, az) {
	const angle = yaw * DEG;
	return { id, category, x, y, z, yaw: angle, cos: Math.cos(angle), sin: Math.sin(angle), ax, ay, az, reach: Math.max(ax, ay, az), reflectivity: REFLECTIVITY[category === CATEGORY.fish ? 'fish' : 'object'] };
}

export class World {
	constructor() {
		this.terrain = new Terrain(LAYOUT.mound, LAYOUT.weeds);
		this.solids = [];
		this.boulders = [];
		this.schools = [];
		this.clouds = [];
		this.weedsOn = false;
		this.hit = { t: 0, id: -1, category: 0, reflectivity: 0, nx: 0, ny: 1, nz: 0 };
		this.spanNear = 0;
		this.spanFar = 0;
	}

	configure(settings) {
		const slope = Math.tan(settings.slope * DEG);
		const direction = settings.slopeDirection * DEG;
		this.slopeX = slope * Math.cos(direction);
		this.slopeZ = slope * Math.sin(direction);
		this.terrain.combine(settings.undulation, settings.rocks, settings.ripples, settings.mound ? LAYOUT.mound.height : 0);
		this.weedsOn = settings.weeds;
		this.solids = settings.objects ? LAYOUT.solids.map((layout, index) => this.makeSolid(layout, index + 1)) : [];
		this.boulders = settings.objects ? LAYOUT.boulders.map((layout, index) => this.makeBoulder(layout, 1000 + index)) : [];
		this.schools = settings.fish ? LAYOUT.schools.map((layout, index) => this.makeSchool(layout, 10000 + index * 100)) : [];
		this.clouds = settings.bubbles ? LAYOUT.clouds.map((cloud) => ({ ...cloud, y: this.height(cloud.x, cloud.z) + cloud.altitude })) : [];
	}

	sinkDepth(x, z, reach) {
		const center = this.height(x, z);
		let lowest = center;

		for (let a = -reach; a <= reach; a += STEP) {
			for (let b = -reach; b <= reach; b += STEP) {
				lowest = Math.min(lowest, this.height(x + a, z + b));
			}
		}

		return center - lowest + 0.1;
	}

	makeSolid(layout, id) {
		const box = layout.kind === 'box';
		const reach = box ? Math.sqrt(layout.width * layout.width + layout.depth * layout.depth) / 2 : layout.radius;
		const sink = this.sinkDepth(layout.x, layout.z, reach);
		const planes = box ? boxPlanes(layout.width / 2, layout.depth / 2, layout.height, sink) : hexagonPlanes(layout.radius, layout.height, sink);
		const yaw = layout.yaw * DEG;
		const y = this.height(layout.x, layout.z);
		const halfHeight = (layout.height + sink) / 2;
		return { id, layout, sink, planes, yaw, x: layout.x, y, z: layout.z, cos: Math.cos(yaw), sin: Math.sin(yaw), centerY: y + layout.height - halfHeight, bound: Math.sqrt(reach * reach + halfHeight * halfHeight) };
	}

	makeBoulder(layout, id) {
		const ay = layout.height / 2;
		return ellipsoid(id, CATEGORY.object, layout.x, this.height(layout.x, layout.z) + ay * 0.4, layout.z, layout.yaw, layout.length / 2, ay, layout.width / 2);
	}

	makeSchool(layout, id) {
		const fish = layout.members.map((member, index) => {
			const x = layout.x + member.dx;
			const z = layout.z + member.dz;
			const length = layout.length * member.scale;
			return ellipsoid(id + index, CATEGORY.fish, x, this.height(x, z) + layout.altitude + member.dy, z, layout.yaw + member.turn, length / 2, length * 0.14, length * 0.1);
		});

		const center = ['x', 'y', 'z'].map((axis) => fish.reduce((sum, f) => sum + f[axis], 0) / fish.length);
		const bound = Math.max(...fish.map((f) => Math.sqrt((f.x - center[0]) ** 2 + (f.y - center[1]) ** 2 + (f.z - center[2]) ** 2) + f.ax));
		return { x: center[0], y: center[1], z: center[2], bound, fish };
	}

	height(x, z) {
		return this.slopeX * x + this.slopeZ * z + this.terrain.height(x, z);
	}

	rockiness(x, z) {
		return this.terrain.rockiness(x, z);
	}

	weed(x, z) {
		return this.weedsOn ? this.terrain.weed(x, z) : 0;
	}

	seabedNormal(x, z, out) {
		const gx = this.slopeX + (this.terrain.height(x + STEP, z) - this.terrain.height(x - STEP, z)) / (2 * STEP);
		const gz = this.slopeZ + (this.terrain.height(x, z + STEP) - this.terrain.height(x, z - STEP)) / (2 * STEP);
		const length = Math.sqrt(gx * gx + 1 + gz * gz);
		out.nx = -gx / length;
		out.ny = 1 / length;
		out.nz = -gz / length;
	}

	missesSphere(cx, cy, cz, radius, ox, oy, oz, dx, dy, dz) {
		const px = ox - cx;
		const py = oy - cy;
		const pz = oz - cz;
		const b = px * dx + py * dy + pz * dz;
		return b * b - (px * px + py * py + pz * pz - radius * radius) < 0 || -b - radius > this.hit.t;
	}

	intersect(ox, oy, oz, dx, dy, dz, tMax) {
		const hit = this.hit;
		hit.t = tMax;
		hit.id = -1;

		for (const solid of this.solids) {
			if (!this.missesSphere(solid.x, solid.centerY, solid.z, solid.bound, ox, oy, oz, dx, dy, dz)) {
				this.intersectSolid(solid, ox, oy, oz, dx, dy, dz);
			}
		}

		for (const boulder of this.boulders) {
			if (!this.missesSphere(boulder.x, boulder.y, boulder.z, boulder.reach, ox, oy, oz, dx, dy, dz)) {
				this.intersectEllipsoid(boulder, ox, oy, oz, dx, dy, dz);
			}
		}

		for (const school of this.schools) {
			if (this.missesSphere(school.x, school.y, school.z, school.bound, ox, oy, oz, dx, dy, dz)) {
				continue;
			}

			for (const fish of school.fish) {
				if (!this.missesSphere(fish.x, fish.y, fish.z, fish.ax, ox, oy, oz, dx, dy, dz)) {
					this.intersectEllipsoid(fish, ox, oy, oz, dx, dy, dz);
				}
			}
		}

		const t = this.marchSeabed(ox, oy, oz, dx, dy, dz, hit.t);

		if (t >= 0) {
			const x = ox + dx * t;
			const z = oz + dz * t;
			const weed = this.weed(x, z);
			hit.t = t;
			hit.id = 0;
			hit.category = weed > 0.5 ? CATEGORY.weeds : CATEGORY.seabed;
			hit.reflectivity = REFLECTIVITY.seabed + (REFLECTIVITY.weeds - REFLECTIVITY.seabed) * weed;
			this.seabedNormal(x, z, hit);
		}

		return hit.id >= 0;
	}

	marchSeabed(ox, oy, oz, dx, dy, dz, tMax) {
		const descent = dy - this.slopeX * dx - this.slopeZ * dz;
		const lift = oy - this.slopeX * ox - this.slopeZ * oz;
		let start = 0;
		let end = tMax;

		if (descent < 0) {
			start = Math.max(0, (lift - this.terrain.top) / -descent);
			end = Math.min(tMax, (lift - this.terrain.bottom) / -descent + 0.01);
		} else if (lift > this.terrain.top) {
			return -1;
		} else if (descent > 0) {
			end = Math.min(tMax, (this.terrain.top - lift) / descent);
		}

		for (let r0 = start; r0 < end; r0 += REGION_SIZE * 0.4) {
			const r1 = Math.min(end, r0 + REGION_SIZE * 0.4);

			if (this.above(ox, oy, oz, dx, dy, dz, r0, r1, true)) {
				continue;
			}

			for (let t0 = r0; t0 < r1; t0 += BLOCK_SIZE * 0.4) {
				const t1 = Math.min(r1, t0 + BLOCK_SIZE * 0.4);

				if (this.above(ox, oy, oz, dx, dy, dz, t0, t1, false)) {
					continue;
				}

				const t = this.refine(ox, oy, oz, dx, dy, dz, t0, t1);

				if (t >= 0) {
					return t;
				}
			}
		}

		return -1;
	}

	above(ox, oy, oz, dx, dy, dz, t0, t1, coarse) {
		const x0 = Math.min(ox + dx * t0, ox + dx * t1);
		const x1 = Math.max(ox + dx * t0, ox + dx * t1);
		const z0 = Math.min(oz + dz * t0, oz + dz * t1);
		const z1 = Math.max(oz + dz * t0, oz + dz * t1);
		const plane = this.slopeX * (this.slopeX > 0 ? x1 : x0) + this.slopeZ * (this.slopeZ > 0 ? z1 : z0);
		const relief = coarse ? this.terrain.regionCeiling(x0, z0, x1, z1) : this.terrain.ceiling(x0, z0, x1, z1);
		return Math.min(oy + dy * t0, oy + dy * t1) > plane + relief;
	}

	refine(ox, oy, oz, dx, dy, dz, start, end) {
		const least = 0.05 + 0.003 * start;
		const climb = Math.abs(dy) + 2;
		let before = start;
		let gap = oy + dy * start - this.height(ox + dx * start, oz + dz * start);

		if (gap <= 0) {
			return start;
		}

		while (before < end) {
			const after = Math.min(end, before + Math.max(least, gap / climb));
			const next = oy + dy * after - this.height(ox + dx * after, oz + dz * after);

			if (next <= 0) {
				return this.secant(ox, oy, oz, dx, dy, dz, before, gap, after, next);
			}

			before = after;
			gap = next;
		}

		return -1;
	}

	secant(ox, oy, oz, dx, dy, dz, low, above, high, below) {
		for (let i = 0; i < 3; i++) {
			const t = low + (high - low) * above / (above - below);
			const gap = oy + dy * t - this.height(ox + dx * t, oz + dz * t);

			if (Math.abs(gap) < 1e-4) {
				return t;
			}

			if (gap > 0) {
				low = t;
				above = gap;
			} else {
				high = t;
				below = gap;
			}
		}

		return low + (high - low) * above / (above - below);
	}

	intersectSolid(solid, ox, oy, oz, dx, dy, dz) {
		const px = ox - solid.x;
		const py = oy - solid.y;
		const pz = oz - solid.z;
		const lx = solid.cos * px - solid.sin * pz;
		const lz = solid.sin * px + solid.cos * pz;
		const vx = solid.cos * dx - solid.sin * dz;
		const vz = solid.sin * dx + solid.cos * dz;
		let near = -Infinity;
		let far = Infinity;
		let plane = null;

		for (const p of solid.planes) {
			const along = p[0] * vx + p[1] * dy + p[2] * vz;
			const room = p[3] - (p[0] * lx + p[1] * py + p[2] * lz);

			if (Math.abs(along) < 1e-12) {
				if (room < 0) {
					return;
				}

				continue;
			}

			const t = room / along;

			if (along < 0) {
				if (t > near) {
					near = t;
					plane = p;
				}
			} else if (t < far) {
				far = t;
			}
		}

		const hit = this.hit;

		if (near > far || near <= 1e-6 || near >= hit.t) {
			return;
		}

		hit.t = near;
		hit.id = solid.id;
		hit.category = CATEGORY.object;
		hit.reflectivity = REFLECTIVITY.object;
		hit.nx = solid.cos * plane[0] + solid.sin * plane[2];
		hit.ny = plane[1];
		hit.nz = -solid.sin * plane[0] + solid.cos * plane[2];
	}

	intersectEllipsoid(shape, ox, oy, oz, dx, dy, dz) {
		const px = ox - shape.x;
		const pz = oz - shape.z;
		const qx = (shape.cos * px - shape.sin * pz) / shape.ax;
		const qy = (oy - shape.y) / shape.ay;
		const qz = (shape.sin * px + shape.cos * pz) / shape.az;
		const vx = (shape.cos * dx - shape.sin * dz) / shape.ax;
		const vy = dy / shape.ay;
		const vz = (shape.sin * dx + shape.cos * dz) / shape.az;
		const a = vx * vx + vy * vy + vz * vz;
		const b = qx * vx + qy * vy + qz * vz;
		const c = qx * qx + qy * qy + qz * qz - 1;
		const disc = b * b - a * c;

		if (disc < 0) {
			return;
		}

		const t = (-b - Math.sqrt(disc)) / a;
		const hit = this.hit;

		if (t <= 1e-6 || t >= hit.t) {
			return;
		}

		const sx = (qx + vx * t) / shape.ax;
		const sy = (qy + vy * t) / shape.ay;
		const sz = (qz + vz * t) / shape.az;
		const nx = shape.cos * sx + shape.sin * sz;
		const nz = -shape.sin * sx + shape.cos * sz;
		const length = Math.sqrt(nx * nx + sy * sy + nz * nz);
		hit.t = t;
		hit.id = shape.id;
		hit.category = shape.category;
		hit.reflectivity = shape.reflectivity;
		hit.nx = nx / length;
		hit.ny = sy / length;
		hit.nz = nz / length;
	}

	cloudSpan(cloud, ox, oy, oz, dx, dy, dz) {
		const px = ox - cloud.x;
		const py = oy - cloud.y;
		const pz = oz - cloud.z;
		const b = px * dx + py * dy + pz * dz;
		const c = px * px + py * py + pz * pz - cloud.radius * cloud.radius;
		const disc = b * b - c;

		if (disc <= 0) {
			return false;
		}

		const root = Math.sqrt(disc);
		this.spanNear = -b - root;
		this.spanFar = -b + root;
		return this.spanFar > 0;
	}

	cloudDensity(cloud, x, y, z) {
		const dx = x - cloud.x;
		const dy = y - cloud.y;
		const dz = z - cloud.z;
		const r2 = (dx * dx + dy * dy + dz * dz) / (cloud.radius * cloud.radius);

		if (r2 >= 1) {
			return 0;
		}

		const falloff = (1 - r2) * (1 - r2);
		const texture = 0.6 + 0.4 * Math.sin(x * 3.1 + y * 1.3) * Math.sin(y * 2.7 - z * 1.9) * Math.sin(z * 2.3 + x * 1.1);
		return cloud.density * falloff * texture;
	}

	bubbleDensity(x, y, z) {
		let density = 0;

		for (const cloud of this.clouds) {
			density += this.cloudDensity(cloud, x, y, z);
		}

		return density;
	}

	insideEllipsoid(shape, x, y, z) {
		const px = x - shape.x;
		const pz = z - shape.z;
		const qx = (shape.cos * px - shape.sin * pz) / shape.ax;
		const qy = (y - shape.y) / shape.ay;
		const qz = (shape.sin * px + shape.cos * pz) / shape.az;
		return qx * qx + qy * qy + qz * qz <= 1;
	}

	materialAt(x, y, z) {
		for (const solid of this.solids) {
			const px = x - solid.x;
			const pz = z - solid.z;
			const ly = y - solid.y;

			if (px * px + pz * pz > solid.bound * solid.bound) {
				continue;
			}

			const lx = solid.cos * px - solid.sin * pz;
			const lz = solid.sin * px + solid.cos * pz;

			if (solid.planes.every((p) => p[0] * lx + p[1] * ly + p[2] * lz <= p[3])) {
				return CATEGORY.object;
			}
		}

		for (const boulder of this.boulders) {
			if (this.insideEllipsoid(boulder, x, y, z)) {
				return CATEGORY.object;
			}
		}

		for (const school of this.schools) {
			if ((x - school.x) ** 2 + (y - school.y) ** 2 + (z - school.z) ** 2 > school.bound * school.bound) {
				continue;
			}

			if (school.fish.some((fish) => this.insideEllipsoid(fish, x, y, z))) {
				return CATEGORY.fish;
			}
		}

		const ground = this.height(x, z);

		if (y < ground) {
			return y > ground - 0.25 && this.weed(x, z) > 0.5 ? CATEGORY.weeds : CATEGORY.seabed;
		}

		return -1;
	}
}
