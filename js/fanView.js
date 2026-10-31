const BACKGROUND = [12, 22, 31];

function niceStep(span, count) {
	const raw = span / count;
	const power = 10 ** Math.floor(Math.log10(raw));
	return [1, 2, 5, 10].map((m) => m * power).find((step) => step >= raw);
}

export class FanView {
	constructor(canvas, onHover, onResize) {
		this.canvas = canvas;
		this.ctx = canvas.getContext('2d');
		this.key = '';

		canvas.addEventListener('pointermove', (event) => {
			if (!this.radius) {
				return;
			}

			const rect = canvas.getBoundingClientRect();
			const place = this.toPolar((event.clientX - rect.left) * this.dpr, (event.clientY - rect.top) * this.dpr);
			onHover(place);
		});

		canvas.addEventListener('pointerleave', () => onHover(null));
		new ResizeObserver(() => {
			this.key = '';
			onResize();
		}).observe(canvas);
	}

	layout(sonar) {
		const dpr = window.devicePixelRatio || 1;
		const width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
		const height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
		const key = [width, height, sonar.hfov, sonar.maxRange].join();

		if (key === this.key) {
			return;
		}

		this.key = key;
		this.dpr = dpr;
		this.canvas.width = width;
		this.canvas.height = height;
		this.half = sonar.hfov / 2;
		this.maxRange = sonar.maxRange;

		const top = 26 * dpr;
		const bottom = 14 * dpr;
		const sides = 14 * dpr;
		const room = height - top - bottom;
		this.radius = Math.min((width - 2 * sides) / (2 * Math.sin(Math.min(this.half, Math.PI / 2))), room);
		this.apexX = width / 2;
		this.apexY = top + this.radius + (room - this.radius) / 2;
		this.image = this.ctx.createImageData(width, height);
		this.beamAt = new Float32Array(width * height);
		this.rangeAt = new Float32Array(width * height);

		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const p = y * width + x;
				const place = this.toPolar(x, y);
				this.beamAt[p] = place ? (place.theta + this.half) / sonar.hfov * sonar.beams - 0.5 : -1;
				this.rangeAt[p] = place ? place.range / sonar.maxRange * sonar.rangeBins - 0.5 : -1;
			}
		}
	}

	toPolar(x, y) {
		const dx = x - this.apexX;
		const dy = this.apexY - y;
		const theta = Math.atan2(dx, dy);
		const range = Math.sqrt(dx * dx + dy * dy) / this.radius * this.maxRange;

		if (Math.abs(theta) > this.half || range > this.maxRange) {
			return null;
		}

		return { theta, range };
	}

	toScreen(theta, range) {
		const r = range / this.maxRange * this.radius;
		return [this.apexX + Math.sin(theta) * r, this.apexY - Math.cos(theta) * r];
	}

	draw(sonar, colors, selection) {
		this.layout(sonar);

		const data = this.image.data;
		const beams = sonar.beams;
		const bins = sonar.rangeBins;

		for (let p = 0; p < this.beamAt.length; p++) {
			const o = p * 4;
			const b = this.beamAt[p];

			if (b === -1) {
				data[o] = BACKGROUND[0];
				data[o + 1] = BACKGROUND[1];
				data[o + 2] = BACKGROUND[2];
				data[o + 3] = 255;
				continue;
			}

			const r = Math.min(Math.max(this.rangeAt[p], 0), bins - 1);
			const bc = Math.min(Math.max(b, 0), beams - 1);
			const b0 = Math.min(Math.floor(bc), beams - 2);
			const r0 = Math.min(Math.floor(r), bins - 2);
			const fb = bc - b0;
			const fr = r - r0;
			const i00 = (b0 * bins + r0) * 3;
			const i01 = i00 + 3;
			const i10 = i00 + bins * 3;
			const i11 = i10 + 3;

			for (let c = 0; c < 3; c++) {
				const near = colors[i00 + c] + (colors[i01 + c] - colors[i00 + c]) * fr;
				const far = colors[i10 + c] + (colors[i11 + c] - colors[i10 + c]) * fr;
				data[o + c] = near + (far - near) * fb;
			}

			data[o + 3] = 255;
		}

		this.ctx.putImageData(this.image, 0, 0);
		this.drawGrid();

		if (selection) {
			this.drawSelection(selection);
		}
	}

	drawGrid() {
		const ctx = this.ctx;
		const dpr = this.dpr;
		const step = niceStep(this.maxRange, 5);
		const angleStep = this.half * 2 > 80 ? 30 : 15;

		ctx.save();
		ctx.lineWidth = dpr;
		ctx.strokeStyle = 'rgba(214, 228, 240, 0.18)';
		ctx.fillStyle = 'rgba(214, 228, 240, 0.7)';
		ctx.font = `${11 * dpr}px "Atkinson Hyperlegible", system-ui, sans-serif`;
		ctx.textAlign = 'center';

		for (let range = step; range < this.maxRange - 1e-6; range += step) {
			const r = range / this.maxRange * this.radius;
			ctx.beginPath();
			ctx.arc(this.apexX, this.apexY, r, -Math.PI / 2 - this.half, -Math.PI / 2 + this.half);
			ctx.stroke();
			const [x, y] = this.toScreen(this.half, range);
			ctx.fillText(`${range} m`, x + 16 * dpr * Math.cos(this.half), y + 4 * dpr);
		}

		for (let degrees = -180; degrees <= 180; degrees += angleStep) {
			const theta = degrees * Math.PI / 180;

			if (Math.abs(theta) > this.half + 1e-6) {
				continue;
			}

			const [x, y] = this.toScreen(theta, this.maxRange);
			ctx.beginPath();
			ctx.moveTo(this.apexX, this.apexY);
			ctx.lineTo(x, y);
			ctx.stroke();
			ctx.fillText(`${degrees}°`, x + Math.sin(theta) * 12 * dpr, y - Math.cos(theta) * 10 * dpr + 4 * dpr);
		}

		ctx.restore();
	}

	drawSelection(selection) {
		const ctx = this.ctx;
		const dpr = this.dpr;
		const inside = Math.abs(selection.theta) <= this.half && selection.range <= this.maxRange;

		if (!inside) {
			return;
		}

		const [x, y] = this.toScreen(selection.theta, selection.range);
		ctx.save();
		ctx.lineWidth = 2 * dpr;
		ctx.strokeStyle = '#ffffff';
		ctx.beginPath();
		ctx.arc(x, y, 7 * dpr, 0, Math.PI * 2);
		ctx.stroke();
		ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
		ctx.lineWidth = dpr;
		ctx.beginPath();
		ctx.arc(x, y, 9 * dpr, 0, Math.PI * 2);
		ctx.stroke();
		ctx.restore();
	}
}
