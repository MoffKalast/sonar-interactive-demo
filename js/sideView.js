import { CATEGORY } from './scene.js';

const WATER = [15, 36, 51];
const FILL = {
	[CATEGORY.seabed]: [150, 122, 84],
	[CATEGORY.weeds]: [62, 128, 70],
	[CATEGORY.object]: [200, 205, 214],
	[CATEGORY.fish]: [232, 184, 74]
};

export class SideView {
	constructor(canvas, onHover, onResize) {
		this.canvas = canvas;
		this.ctx = canvas.getContext('2d');
		this.backdrop = document.createElement('canvas');
		this.dirty = true;

		canvas.addEventListener('pointermove', (event) => {
			if (!this.scale) {
				return;
			}

			const rect = canvas.getBoundingClientRect();
			onHover(this.toWorld(event.clientX - rect.left, event.clientY - rect.top));
		});

		canvas.addEventListener('pointerleave', () => onHover(null));
		new ResizeObserver(() => {
			this.dirty = true;
			onResize();
		}).observe(canvas);
	}

	slice(sonar, x, y, z) {
		return [(x - sonar.origin[0]) * sonar.heading[0] + (z - sonar.origin[2]) * sonar.heading[2], y];
	}

	frame(world, sonar) {
		const width = this.canvas.clientWidth;
		const height = this.canvas.clientHeight;
		const half = sonar.vfov / 2;
		let aMin = -1;
		let aMax = 1;
		let yMin = sonar.origin[1] - 1;
		let yMax = sonar.origin[1] + 1;

		for (let k = 0; k <= 8; k++) {
			sonar.aim(0, -half + sonar.vfov * k / 8);
			const [a, y] = this.slice(sonar, sonar.origin[0] + sonar.dx * sonar.maxRange, sonar.origin[1] + sonar.dy * sonar.maxRange, sonar.origin[2] + sonar.dz * sonar.maxRange);
			aMin = Math.min(aMin, a);
			aMax = Math.max(aMax, a);
		}

		for (let a = aMin; a <= aMax; a += 0.5) {
			const ground = world.height(sonar.origin[0] + a * sonar.heading[0], sonar.origin[2] + a * sonar.heading[2]);
			yMin = Math.min(yMin, ground - 1);
			yMax = Math.max(yMax, ground + 1);
		}

		aMin -= 1;
		aMax += 1;
		this.sonar = sonar;
		this.scale = Math.min(width / (aMax - aMin), height / (yMax - yMin));
		this.left = (width - (aMax - aMin) * this.scale) / 2 - aMin * this.scale;
		this.bottom = height - (height - (yMax - yMin) * this.scale) / 2 + yMin * this.scale;
		this.width = width;
		this.height = height;
	}

	toScreen(a, y) {
		return [this.left + a * this.scale, this.bottom - y * this.scale];
	}

	project(x, y, z) {
		return this.toScreen(...this.slice(this.sonar, x, y, z));
	}

	toWorld(sx, sy) {
		const a = (sx - this.left) / this.scale;
		const [ox, , oz] = this.sonar.origin;
		return [ox + a * this.sonar.heading[0], (this.bottom - sy) / this.scale, oz + a * this.sonar.heading[2]];
	}

	paintBackdrop(world) {
		const width = Math.max(1, Math.round(this.width));
		const height = Math.max(1, Math.round(this.height));
		this.backdrop.width = width;
		this.backdrop.height = height;
		const bctx = this.backdrop.getContext('2d');
		const image = bctx.createImageData(width, height);
		const data = image.data;

		for (let py = 0; py < height; py++) {
			for (let px = 0; px < width; px++) {
				const [x, y, z] = this.toWorld(px + 0.5, py + 0.5);
				const material = world.materialAt(x, y, z);
				const o = (py * width + px) * 4;
				let rgb = FILL[material] ?? WATER;

				if (material === -1 && world.clouds.length) {
					const fog = Math.min(1, world.bubbleDensity(x, y, z) * 0.9);
					rgb = WATER.map((c) => c + (235 - c) * fog);
				}

				data[o] = rgb[0];
				data[o + 1] = rgb[1];
				data[o + 2] = rgb[2];
				data[o + 3] = 255;
			}
		}

		bctx.putImageData(image, 0, 0);
	}

	draw(world, sonar, colors, arc) {
		const dpr = window.devicePixelRatio || 1;
		const pixelWidth = Math.round(this.canvas.clientWidth * dpr);
		const pixelHeight = Math.round(this.canvas.clientHeight * dpr);

		if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
			this.canvas.width = pixelWidth;
			this.canvas.height = pixelHeight;
			this.dirty = true;
		}

		if (this.dirty) {
			this.frame(world, sonar);
			this.paintBackdrop(world);
			this.dirty = false;
		}

		const ctx = this.ctx;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.imageSmoothingEnabled = false;
		ctx.drawImage(this.backdrop, 0, 0, this.width, this.height);
		this.drawOutline(sonar);
		this.drawSound(sonar, colors);

		if (arc) {
			this.drawArc(arc);
		}

		this.drawSonar(sonar);
	}

	reach(sonar, phi, range) {
		sonar.aim(0, phi);
		return this.project(sonar.origin[0] + sonar.dx * range, sonar.origin[1] + sonar.dy * range, sonar.origin[2] + sonar.dz * range);
	}

	drawOutline(sonar) {
		const ctx = this.ctx;
		const origin = this.project(...sonar.origin);
		const half = sonar.vfov / 2;

		ctx.save();
		ctx.strokeStyle = 'rgba(242, 165, 65, 0.6)';
		ctx.setLineDash([4, 4]);
		ctx.beginPath();
		ctx.moveTo(...origin);

		for (let k = 0; k <= 24; k++) {
			ctx.lineTo(...this.reach(sonar, -half + sonar.vfov * k / 24, sonar.maxRange));
		}

		ctx.closePath();
		ctx.stroke();
		ctx.restore();
	}

	drawSound(sonar, colors) {
		const ctx = this.ctx;
		const origin = this.project(...sonar.origin);
		const column = (sonar.azimuthRays / 2) * sonar.elevationRays;
		const ends = [];

		for (let j = 0; j < sonar.elevationRays; j++) {
			const k = column + j;
			ends.push({ point: this.project(sonar.hitX[k], sonar.hitY[k], sonar.hitZ[k]), t: sonar.rayT[k], color: `rgb(${colors[k * 3] * 255}, ${colors[k * 3 + 1] * 255}, ${colors[k * 3 + 2] * 255})` });
		}

		ctx.save();
		ctx.globalAlpha = 0.28;

		for (let j = 0; j + 1 < ends.length; j++) {
			ctx.fillStyle = ends[j].color;
			ctx.beginPath();
			ctx.moveTo(...origin);
			ctx.lineTo(...ends[j].point);
			ctx.lineTo(...ends[j + 1].point);
			ctx.closePath();
			ctx.fill();
		}

		ctx.globalAlpha = 1;
		ctx.lineWidth = 2.5;
		ctx.lineCap = 'round';

		for (let j = 0; j + 1 < ends.length; j++) {
			const a = ends[j];
			const b = ends[j + 1];

			if (a.t <= 0 || b.t <= 0 || Math.abs(a.t - b.t) > 1.5) {
				continue;
			}

			ctx.strokeStyle = a.color;
			ctx.beginPath();
			ctx.moveTo(...a.point);
			ctx.lineTo(...b.point);
			ctx.stroke();
		}

		ctx.restore();
	}

	drawArc(arc) {
		const ctx = this.ctx;
		const count = arc.states.length;

		ctx.save();
		ctx.lineWidth = 2;

		for (let k = 1; k < count; k++) {
			const state = arc.states[k];
			ctx.strokeStyle = state === -2 ? 'rgba(120, 128, 140, 0.9)' : state === CATEGORY.bubbles ? '#ffffff' : 'rgba(140, 200, 255, 0.95)';
			ctx.beginPath();
			ctx.moveTo(...this.project(arc.positions[k * 3 - 3], arc.positions[k * 3 - 2], arc.positions[k * 3 - 1]));
			ctx.lineTo(...this.project(arc.positions[k * 3], arc.positions[k * 3 + 1], arc.positions[k * 3 + 2]));
			ctx.stroke();
		}

		for (const point of arc.points) {
			const [x, y] = this.project(point.x, point.y, point.z);
			ctx.fillStyle = '#ffffff';
			ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
			ctx.beginPath();
			ctx.arc(x, y, 4.5, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
		}

		ctx.restore();
	}

	drawSonar(sonar) {
		const ctx = this.ctx;
		const [x, y] = this.project(...sonar.origin);
		const along = sonar.forward[0] * sonar.heading[0] + sonar.forward[2] * sonar.heading[2];

		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(Math.atan2(-sonar.forward[1], along));
		ctx.fillStyle = '#2b3440';
		ctx.fillRect(-9, -5, 12, 10);
		ctx.fillStyle = '#f2a541';
		ctx.fillRect(3, -4, 3, 8);
		ctx.restore();
	}
}
