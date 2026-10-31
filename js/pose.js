const DEG = Math.PI / 180;

export function wrap(degrees) {
	return ((degrees + 180) % 360 + 360) % 360 - 180;
}

function dot(a, b) {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function blend(a, b, ca, cb) {
	return a.map((value, i) => value * ca + b[i] * cb);
}

export function frame(yaw, tilt, roll) {
	const a = yaw * DEG;
	const t = tilt * DEG;
	const r = roll * DEG;
	const heading = [Math.cos(a), 0, Math.sin(a)];
	const across = [-Math.sin(a), 0, Math.cos(a)];
	const forward = blend(heading, [0, 1, 0], Math.cos(t), -Math.sin(t));
	const level = blend(heading, [0, 1, 0], Math.sin(t), Math.cos(t));
	return { heading, forward, up: blend(level, across, Math.cos(r), Math.sin(r)), side: blend(across, level, Math.cos(r), -Math.sin(r)) };
}

export function angles(forward, up, previous) {
	const tilt = Math.asin(Math.min(1, Math.max(-1, -forward[1]))) / DEG;
	const yaw = Math.abs(Math.cos(tilt * DEG)) > 1e-4 ? Math.atan2(forward[2], forward[0]) / DEG : previous.yaw;
	const base = frame(yaw, tilt, 0);
	const roll = Math.atan2(dot(up, base.side), dot(up, base.up)) / DEG;
	const before = [previous.yaw, previous.tilt, previous.roll];
	const options = [[yaw, tilt, roll], [yaw + 180, 180 - tilt, roll + 180]].map((option) => option.map(wrap));
	const distance = (option) => option.reduce((sum, value, i) => sum + Math.abs(wrap(value - before[i])), 0);
	const [bestYaw, bestTilt, bestRoll] = distance(options[0]) <= distance(options[1]) ? options[0] : options[1];
	return { yaw: bestYaw, tilt: bestTilt, roll: bestRoll };
}

