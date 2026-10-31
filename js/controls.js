export const CONTROLS = [
	{
		title: 'Sonar position',
		items: [
			{ key: 'x', label: 'Position X', min: -60, max: 60, step: 0.5, value: 0, unit: ' m' },
			{ key: 'y', label: 'Position Y', min: -60, max: 60, step: 0.5, value: 0, unit: ' m' },
			{ key: 'height', label: 'Height above seabed', min: 0.3, max: 15, step: 0.1, value: 3, unit: ' m' }
		]
	},
	{
		title: 'Sonar orientation',
		items: [
			{ key: 'yaw', label: 'Yaw (turn right)', min: -180, max: 180, step: 1, value: 0, unit: '°' },
			{ key: 'tilt', label: 'Pitch (tilt down)', min: -180, max: 180, step: 1, value: 15, unit: '°' },
			{ key: 'roll', label: 'Roll (right side down)', min: -180, max: 180, step: 1, value: 0, unit: '°' }
		]
	},
	{
		title: 'Sonar coverage',
		items: [
			{ key: 'hfov', label: 'Horizontal field of view', min: 20, max: 130, step: 1, value: 120, unit: '°' },
			{ key: 'vfov', label: 'Vertical aperture', min: 2, max: 40, step: 1, value: 12, unit: '°' },
			{ key: 'maxRange', label: 'Maximum range', min: 5, max: 50, step: 1, value: 25, unit: ' m' }
		]
	},
	{
		title: 'Seabed',
		items: [
			{ key: 'slope', label: 'Slope', min: -25, max: 25, step: 0.5, value: 0, unit: '°' },
			{ key: 'slopeDirection', label: 'Uphill direction (0° is along X)', min: -180, max: 180, step: 5, value: 0, unit: '°' },
			{ key: 'undulation', label: 'Rolling hills', min: 0, max: 5, step: 0.05, value: 1, unit: ' m' },
			{ key: 'rocks', label: 'Rocks', min: 0, max: 1, step: 0.01, value: 0.3, unit: ' m' },
			{ key: 'ripples', label: 'Sand ripples', min: 0, max: 0.1, step: 0.005, value: 0, unit: ' m' },
			{ key: 'mound', label: 'Mound', type: 'toggle', value: true }
		]
	},
	{
		title: 'Things in the scene',
		items: [
			{ key: 'objects', label: 'Blocks and boulders', type: 'toggle', value: true },
			{ key: 'fish', label: 'Fish schools', type: 'toggle', value: true },
			{ key: 'weeds', label: 'Weed patches', type: 'toggle', value: true },
			{ key: 'bubbles', label: 'Bubble clouds', type: 'toggle', value: false }
		]
	},
	{
		title: 'Display',
		items: [
			{ key: 'gain', label: 'Gain', min: -10, max: 40, step: 1, value: 8, unit: ' dB' },
			{ key: 'dynamicRange', label: 'Dynamic range', min: 10, max: 60, step: 1, value: 20, unit: ' dB' },
			{ key: 'showFrustum', label: 'Coverage outline', type: 'toggle', value: true },
			{ key: 'showHits', label: 'Where the sound lands', type: 'toggle', value: true }
		]
	}
];

export function defaultSettings() {
	const settings = {};

	for (const group of CONTROLS) {
		for (const item of group.items) {
			settings[item.key] = item.value;
		}
	}

	return settings;
}

function formatValue(item, value) {
	const decimals = item.step < 0.01 ? 3 : item.step < 0.1 ? 2 : item.step < 1 ? 1 : 0;
	return `${Number(value).toFixed(decimals)}${item.unit}`;
}

export function clampSetting(key, value) {
	for (const group of CONTROLS) {
		const item = group.items.find((candidate) => candidate.key === key);

		if (item) {
			return Math.min(item.max, Math.max(item.min, value));
		}
	}

	return value;
}

export function buildControls(container, settings, onChange) {
	const refreshers = [];

	for (const group of CONTROLS) {
		const section = document.createElement('fieldset');
		const legend = document.createElement('legend');
		legend.textContent = group.title;
		section.append(legend);

		for (const item of group.items) {
			const [row, refresh] = buildItem(item, settings, onChange);
			section.append(row);
			refreshers.push(refresh);
		}

		container.append(section);
	}

	return () => refreshers.forEach((refresh) => refresh());
}

function buildItem(item, settings, onChange) {
	const row = document.createElement('label');
	const id = `control-${item.key}`;
	row.htmlFor = id;

	if (item.type === 'toggle') {
		row.className = 'control toggle';
		const input = document.createElement('input');
		input.type = 'checkbox';
		input.id = id;
		input.checked = settings[item.key];
		input.addEventListener('change', () => {
			settings[item.key] = input.checked;
			onChange(item.key);
		});
		row.append(input, document.createTextNode(item.label));
		return [row, () => {
			input.checked = settings[item.key];
		}];
	}

	row.className = 'control slider';
	const name = document.createElement('span');
	const output = document.createElement('output');
	const input = document.createElement('input');
	name.textContent = item.label;
	input.type = 'range';
	input.id = id;
	input.min = item.min;
	input.max = item.max;
	input.step = item.step;
	input.addEventListener('input', () => {
		settings[item.key] = Number(input.value);
		output.textContent = formatValue(item, input.value);
		onChange(item.key);
	});
	row.append(name, output, input);

	const refresh = () => {
		input.value = settings[item.key];
		output.textContent = formatValue(item, settings[item.key]);
	};

	refresh();
	return [row, refresh];
}
