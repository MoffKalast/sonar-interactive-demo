import { wrap } from './pose.js';
import { clampSetting } from './controls.js';

const DEG = Math.PI / 180;
const KEYS = {
	KeyW: ['forward', 1],
	KeyS: ['forward', -1],
	KeyD: ['strafe', 1],
	KeyA: ['strafe', -1],
	KeyR: ['rise', 1],
	KeyF: ['rise', -1],
	KeyL: ['yaw', 1],
	KeyJ: ['yaw', -1],
	KeyI: ['tilt', 1],
	KeyK: ['tilt', -1],
	KeyO: ['roll', 1],
	KeyU: ['roll', -1]
};
const SPEED = { forward: 4, strafe: 4, rise: 2, yaw: 45, tilt: 45, roll: 45 };

export function createPilot() {
	const held = new Set();
	let fast = false;

	window.addEventListener('keydown', (event) => {
		fast = event.shiftKey;

		if (event.ctrlKey || event.metaKey || event.altKey || !KEYS[event.code]) {
			return;
		}

		held.add(event.code);
		event.preventDefault();
	});

	window.addEventListener('keyup', (event) => {
		fast = event.shiftKey;
		held.delete(event.code);
	});

	window.addEventListener('blur', () => held.clear());

	return (settings, dt) => {
		if (!held.size) {
			return false;
		}

		const push = { forward: 0, strafe: 0, rise: 0, yaw: 0, tilt: 0, roll: 0 };

		for (const code of held) {
			const [axis, sign] = KEYS[code];
			push[axis] += sign * SPEED[axis] * dt * (fast ? 3 : 1);
		}

		const heading = settings.yaw * DEG;
		settings.x = clampSetting('x', settings.x + Math.cos(heading) * push.forward - Math.sin(heading) * push.strafe);
		settings.y = clampSetting('y', settings.y + Math.sin(heading) * push.forward + Math.cos(heading) * push.strafe);
		settings.height = clampSetting('height', settings.height + push.rise);
		settings.yaw = wrap(settings.yaw + push.yaw);
		settings.tilt = wrap(settings.tilt + push.tilt);
		settings.roll = wrap(settings.roll + push.roll);
		return true;
	};
}
