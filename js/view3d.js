import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { LAYOUT, CATEGORY } from './scene.js';
import { EXTENT } from './terrain.js';
import { random } from './noise.js';

const BACKGROUND = 0x0f2433;
const CELL = 0.3;
const ARC_COLORS = { water: [0.55, 0.78, 1], shadow: [0.32, 0.34, 0.4], bubbles: [1, 1, 1] };
const SAND = [0.76, 0.66, 0.5];
const ROCK = [0.56, 0.53, 0.48];
const WEED = [0.2, 0.36, 0.17];

function dotTexture() {
	const canvas = document.createElement('canvas');
	canvas.width = 64;
	canvas.height = 64;
	const ctx = canvas.getContext('2d');
	ctx.beginPath();
	ctx.arc(32, 32, 28, 0, Math.PI * 2);
	ctx.fillStyle = '#fff';
	ctx.fill();
	return new THREE.CanvasTexture(canvas);
}

function dynamicGeometry(capacity) {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
	geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
	geometry.setDrawRange(0, 0);
	return geometry;
}

export class View3D {
	constructor(container, onHover, onPose) {
		this.container = container;
		this.renderer = new THREE.WebGLRenderer({ antialias: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		container.append(this.renderer.domElement);

		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color(BACKGROUND);
		this.scene.fog = new THREE.Fog(BACKGROUND, 50, 140);
		this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
		this.camera.position.set(-16, 17, 17);
		this.controls = new OrbitControls(this.camera, this.renderer.domElement);
		this.controls.target.set(13, 0, 0);
		this.controls.enableDamping = true;
		this.controls.maxPolarAngle = Math.PI * 0.495;

		this.scene.add(new THREE.HemisphereLight(0xd6ecff, 0x3b3020, 1.3));
		const sun = new THREE.DirectionalLight(0xffffff, 1.6);
		sun.position.set(12, 30, 18);
		this.scene.add(sun);

		this.dot = dotTexture();
		this.buildSeabed();
		this.buildSolids();
		this.buildFish();
		this.buildSonar();
		this.buildPoints();
		this.buildSelection();
		this.anchor = null;
		this.weeds = null;
		this.clouds = new THREE.Group();
		this.scene.add(this.clouds);
		this.buildHandle(onPose);

		const raycaster = new THREE.Raycaster();
		const pointer = new THREE.Vector2();
		const canvas = this.renderer.domElement;

		canvas.addEventListener('pointermove', (event) => {
			if (event.buttons !== 0) {
				return;
			}

			const rect = canvas.getBoundingClientRect();
			pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
			raycaster.setFromCamera(pointer, this.camera);
			onHover(raycaster.ray);
		});

		canvas.addEventListener('pointerleave', () => onHover(null));
		new ResizeObserver(() => this.resize()).observe(container);
		this.resize();
	}

	resize() {
		const width = this.container.clientWidth;
		const height = this.container.clientHeight;
		this.renderer.setSize(width, height);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
	}

	buildSeabed() {
		const size = EXTENT.max - EXTENT.min;
		const cells = Math.round(size / CELL);
		const geometry = new THREE.PlaneGeometry(size, size, cells, cells);
		geometry.rotateX(-Math.PI / 2);
		geometry.translate((EXTENT.min + EXTENT.max) / 2, 0, (EXTENT.min + EXTENT.max) / 2);
		geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3), 3));
		const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
		this.seabed = new THREE.Mesh(geometry, material);
		this.scene.add(this.seabed);
	}

	buildSolids() {
		this.objectMaterial = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.6, metalness: 0.1 });
		this.boulderMaterial = new THREE.MeshStandardMaterial({ color: 0x8a8379, roughness: 0.95, flatShading: true });
		this.objects = new THREE.Group();
		this.scene.add(this.objects);
	}

	buildFish() {
		const material = new THREE.MeshStandardMaterial({ color: 0xe8b84a, roughness: 0.5 });
		const count = LAYOUT.schools.reduce((sum, school) => sum + school.members.length, 0);
		const body = new THREE.SphereGeometry(1, 14, 10).scale(0.5, 0.14, 0.1);
		const tail = new THREE.ConeGeometry(0.14, 0.3, 4).rotateZ(-Math.PI / 2).scale(1, 1, 0.3).translate(-0.6, 0, 0);
		this.fishBodies = new THREE.InstancedMesh(body, material, count);
		this.fishTails = new THREE.InstancedMesh(tail, material, count);
		this.scene.add(this.fishBodies, this.fishTails);
	}

	buildSonar() {
		this.sonar = new THREE.Group();
		const housing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.42), new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.4 }));
		const face = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.36), new THREE.MeshStandardMaterial({ color: 0xf2a541, emissive: 0x6b3d0c }));
		face.position.x = 0.27;
		this.sonar.add(housing, face);

		this.frustumLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xf2a541, transparent: true, opacity: 0.75 }));
		this.frustumSheets = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xf2a541, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false }));
		this.sonar.add(this.frustumLines, this.frustumSheets);
		this.scene.add(this.sonar);
	}

	buildHandle(onPose) {
		this.handle = new THREE.Object3D();
		this.dragging = false;
		this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
		this.gizmo.setSize(1);
		this.gizmo.attach(this.handle);
		this.scene.add(this.handle, this.gizmo);

		this.gizmo.addEventListener('dragging-changed', (event) => {
			this.dragging = event.value;
			this.controls.enabled = !event.value;

			if (!event.value) {
				this.syncHandle();
			}
		});

		this.gizmo.addEventListener('objectChange', () => {
			if (!this.dragging) {
				return;
			}

			const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(this.handle.quaternion);
			const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.handle.quaternion);
			onPose(this.handle.position.toArray(), forward.toArray(), up.toArray());
		});

		this.setHandle('translate');
	}

	setHandle(mode) {
		this.gizmo.visible = Boolean(mode);
		this.gizmo.enabled = Boolean(mode);

		if (mode) {
			this.gizmo.setMode(mode);
			this.gizmo.setSpace(mode === 'rotate' ? 'local' : 'world');
		}
	}

	syncHandle() {
		this.handle.position.copy(this.sonar.position);
		this.handle.quaternion.copy(this.sonar.quaternion);
	}

	buildPoints() {
		this.hits = new THREE.Points(dynamicGeometry(256 * 256), new THREE.PointsMaterial({ size: 0.11, vertexColors: true, map: this.dot, alphaTest: 0.5 }));
		this.hits.frustumCulled = false;
		this.scene.add(this.hits);
	}

	buildSelection() {
		this.arcLine = new THREE.Line(dynamicGeometry(512), new THREE.LineBasicMaterial({ vertexColors: true }));
		this.arcPoints = new THREE.Points(dynamicGeometry(64), new THREE.PointsMaterial({ size: 13, sizeAttenuation: false, color: 0xffffff, map: this.dot, alphaTest: 0.5, depthTest: false }));
		this.probe = new THREE.Line(dynamicGeometry(2), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.3, gapSize: 0.2 }));
		this.arcPoints.renderOrder = 2;

		for (const object of [this.arcLine, this.arcPoints, this.probe]) {
			object.frustumCulled = false;
		}

		this.scene.add(this.arcLine, this.arcPoints, this.probe);
	}

	updateWorld(world) {
		const geometry = this.seabed.geometry;
		const positions = geometry.attributes.position.array;
		const colors = geometry.attributes.color.array;

		for (let i = 0; i < positions.length; i += 3) {
			const x = positions[i];
			const z = positions[i + 2];
			const weed = world.weed(x, z);
			const rock = world.rockiness(x, z);
			positions[i + 1] = world.height(x, z);

			for (let c = 0; c < 3; c++) {
				const ground = SAND[c] + (ROCK[c] - SAND[c]) * rock;
				colors[i + c] = ground + (WEED[c] - ground) * weed;
			}
		}

		geometry.attributes.position.needsUpdate = true;
		geometry.attributes.color.needsUpdate = true;
		geometry.computeVertexNormals();

		this.updateObjects(world);
		this.updateWeeds(world);
		this.updateClouds(world);
		this.updateFish(world);
	}

	updateObjects(world) {
		for (const child of [...this.objects.children]) {
			child.geometry.dispose();
			this.objects.remove(child);
		}

		for (const solid of world.solids) {
			const layout = solid.layout;
			const tall = layout.height + solid.sink;
			const geometry = layout.kind === 'box' ? new THREE.BoxGeometry(layout.width, tall, layout.depth) : new THREE.CylinderGeometry(layout.radius, layout.radius, tall, 6);
			const mesh = new THREE.Mesh(geometry, this.objectMaterial);
			mesh.position.set(solid.x, solid.y + (layout.height - solid.sink) / 2, solid.z);
			mesh.rotation.y = solid.yaw;
			this.objects.add(mesh);
		}

		for (const boulder of world.boulders) {
			const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), this.boulderMaterial);
			mesh.position.set(boulder.x, boulder.y, boulder.z);
			mesh.scale.set(boulder.ax, boulder.ay, boulder.az);
			mesh.rotation.y = boulder.yaw;
			this.objects.add(mesh);
		}
	}

	updateWeeds(world) {
		if (this.weeds) {
			this.scene.remove(this.weeds);
			this.weeds.geometry.dispose();
			this.weeds = null;
		}

		if (!world.weedsOn) {
			return;
		}

		const next = random(7);
		const matrices = [];
		const matrix = new THREE.Matrix4();
		const rotation = new THREE.Quaternion();
		const euler = new THREE.Euler();

		for (const patch of LAYOUT.weeds) {
			for (let n = 0; n < patch.radius * patch.radius * 80; n++) {
				const x = patch.x + (next() * 2 - 1) * patch.radius * 1.2;
				const z = patch.z + (next() * 2 - 1) * patch.radius * 1.2;

				if (world.weed(x, z) < 0.5 || next() > 0.5) {
					continue;
				}

				euler.set((next() - 0.5) * 0.5, next() * Math.PI * 2, (next() - 0.5) * 0.5);
				rotation.setFromEuler(euler);
				const scale = 0.6 + next() * 0.8;
				matrix.compose(new THREE.Vector3(x, world.height(x, z), z), rotation, new THREE.Vector3(1, scale, 1));
				matrices.push(matrix.clone());
			}
		}

		const blade = new THREE.ConeGeometry(0.05, 0.6, 3).translate(0, 0.3, 0);
		this.weeds = new THREE.InstancedMesh(blade, new THREE.MeshStandardMaterial({ color: 0x3f8f4a, roughness: 0.9 }), matrices.length);
		matrices.forEach((m, i) => this.weeds.setMatrixAt(i, m));
		this.scene.add(this.weeds);
	}

	updateClouds(world) {
		for (const child of [...this.clouds.children]) {
			child.geometry.dispose();
			this.clouds.remove(child);
		}

		const next = random(11);
		const material = new THREE.PointsMaterial({ size: 0.14, color: 0xeaf6ff, map: this.dot, alphaTest: 0.5 });

		for (const cloud of world.clouds) {
			const positions = [];

			while (positions.length < 4500) {
				const x = cloud.x + (next() * 2 - 1) * cloud.radius;
				const y = cloud.y + (next() * 2 - 1) * cloud.radius;
				const z = cloud.z + (next() * 2 - 1) * cloud.radius;

				if (next() * cloud.density < world.cloudDensity(cloud, x, y, z)) {
					positions.push(x, y, z);
				}
			}

			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
			this.clouds.add(new THREE.Points(geometry, material));
		}
	}

	updateFish(world) {
		const matrix = new THREE.Matrix4();
		const turn = new THREE.Quaternion();
		const up = new THREE.Vector3(0, 1, 0);
		let count = 0;

		for (const school of world.schools) {
			for (const fish of school.fish) {
				const length = fish.ax * 2;
				turn.setFromAxisAngle(up, fish.yaw);
				matrix.compose(new THREE.Vector3(fish.x, fish.y, fish.z), turn, new THREE.Vector3(length, length, length));
				this.fishBodies.setMatrixAt(count, matrix);
				this.fishTails.setMatrixAt(count, matrix);
				count++;
			}
		}

		for (const mesh of [this.fishBodies, this.fishTails]) {
			mesh.count = count;
			mesh.instanceMatrix.needsUpdate = true;
			mesh.computeBoundingSphere();
		}
	}

	updateSonar(sonar) {
		if (this.anchor && !this.dragging) {
			const shift = new THREE.Vector3(sonar.origin[0] - this.anchor[0], 0, sonar.origin[2] - this.anchor[2]);
			this.camera.position.add(shift);
			this.controls.target.add(shift);
		}

		this.anchor = sonar.origin;
		const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...sonar.forward), new THREE.Vector3(...sonar.up), new THREE.Vector3(...sonar.side));
		this.sonar.position.set(...sonar.origin);
		this.sonar.quaternion.setFromRotationMatrix(basis);

		if (!this.dragging) {
			this.syncHandle();
		}

		const h = sonar.hfov / 2;
		const v = sonar.vfov / 2;
		const r = sonar.maxRange;
		const local = (theta, phi, range) => [Math.cos(phi) * Math.cos(theta) * range, Math.sin(phi) * range, Math.cos(phi) * Math.sin(theta) * range];
		const lines = [];
		const sheets = [];
		const steps = 48;

		for (const theta of [-h, h]) {
			for (const phi of [-v, v]) {
				lines.push(0, 0, 0, ...local(theta, phi, r));
			}

			for (let k = 0; k < 12; k++) {
				lines.push(...local(theta, -v + 2 * v * k / 12, r), ...local(theta, -v + 2 * v * (k + 1) / 12, r));
			}
		}

		for (const phi of [-v, v]) {
			for (let k = 0; k < steps; k++) {
				const a = -h + 2 * h * k / steps;
				const b = -h + 2 * h * (k + 1) / steps;
				lines.push(...local(a, phi, r), ...local(b, phi, r));
				sheets.push(0, 0, 0, ...local(a, phi, r), ...local(b, phi, r));
			}
		}

		this.frustumLines.geometry.dispose();
		this.frustumLines.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
		this.frustumSheets.geometry.dispose();
		this.frustumSheets.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(sheets, 3));
	}

	updatePoints(sonar, colors, settings) {
		const [ox, oy, oz] = sonar.origin;
		const positions = this.hits.geometry.attributes.position.array;
		const tints = this.hits.geometry.attributes.color.array;
		let hits = 0;

		for (let k = 0; k < sonar.rayT.length; k++) {
			const t = sonar.rayT[k];

			if (t <= 0) {
				continue;
			}

			const pull = 0.03 / t;
			const o = hits * 3;
			positions[o] = sonar.hitX[k] + (ox - sonar.hitX[k]) * pull;
			positions[o + 1] = sonar.hitY[k] + (oy - sonar.hitY[k]) * pull;
			positions[o + 2] = sonar.hitZ[k] + (oz - sonar.hitZ[k]) * pull;
			tints[o] = colors[k * 3];
			tints[o + 1] = colors[k * 3 + 1];
			tints[o + 2] = colors[k * 3 + 2];
			hits++;
		}

		this.hits.geometry.setDrawRange(0, hits);
		this.hits.geometry.attributes.position.needsUpdate = true;
		this.hits.geometry.attributes.color.needsUpdate = true;
		this.hits.visible = settings.showHits;
		this.frustumLines.visible = settings.showFrustum;
		this.frustumSheets.visible = settings.showFrustum;
	}

	setSelection(sonar, arc, point) {
		this.arcLine.visible = Boolean(arc);
		this.arcPoints.visible = Boolean(arc);
		this.probe.visible = Boolean(point);

		if (arc) {
			const count = arc.states.length;
			const colors = this.arcLine.geometry.attributes.color.array;
			this.arcLine.geometry.attributes.position.array.set(arc.positions);

			for (let k = 0; k < count; k++) {
				const state = arc.states[k];
				colors.set(state === -2 ? ARC_COLORS.shadow : state === CATEGORY.bubbles ? ARC_COLORS.bubbles : ARC_COLORS.water, k * 3);
			}

			this.arcLine.geometry.setDrawRange(0, count);
			this.arcLine.geometry.attributes.position.needsUpdate = true;
			this.arcLine.geometry.attributes.color.needsUpdate = true;

			const marks = this.arcPoints.geometry.attributes.position.array;
			const shown = Math.min(arc.points.length, 64);

			for (let n = 0; n < shown; n++) {
				marks.set([arc.points[n].x, arc.points[n].y, arc.points[n].z], n * 3);
			}

			this.arcPoints.geometry.setDrawRange(0, shown);
			this.arcPoints.geometry.attributes.position.needsUpdate = true;
		}

		if (point) {
			this.probe.geometry.attributes.position.array.set([...sonar.origin, ...point]);
			this.probe.geometry.setDrawRange(0, 2);
			this.probe.geometry.attributes.position.needsUpdate = true;
			this.probe.computeLineDistances();
		}
	}

	render() {
		this.controls.update();
		this.renderer.render(this.scene, this.camera);
	}
}
