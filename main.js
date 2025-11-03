import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js";

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 320);
scene.add(camera);

const ambient = new THREE.AmbientLight(0xf0f6ff, 0.55);
scene.add(ambient);

const sunLight = new THREE.DirectionalLight(0xffffff, 1.05);
sunLight.position.set(-40, 80, -20);
sunLight.castShadow = true;
sunLight.shadow.camera.left = -80;
sunLight.shadow.camera.right = 80;
sunLight.shadow.camera.top = 80;
sunLight.shadow.camera.bottom = -80;
scene.add(sunLight);

const sun = new THREE.Mesh(
  new THREE.SphereGeometry(6, 24, 24),
  new THREE.MeshBasicMaterial({ color: 0xfff3a1 })
);
sun.position.copy(sunLight.position.clone().multiplyScalar(1.4));
scene.add(sun);

const clouds = new THREE.Group();
scene.add(clouds);
for (let i = 0; i < 14; i++) {
  const cloud = new THREE.Mesh(
    new THREE.BoxGeometry(8 + Math.random() * 8, 3 + Math.random() * 1.5, 6 + Math.random() * 4),
    new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.82 })
  );
  cloud.position.set((Math.random() - 0.5) * 180, 40 + Math.random() * 15, (Math.random() - 0.5) * 180);
  clouds.add(cloud);
}

const water = new THREE.Mesh(
  new THREE.PlaneGeometry(300, 300, 1, 1),
  new THREE.MeshPhongMaterial({ color: 0x3ba6ff, transparent: true, opacity: 0.4, shininess: 90 })
);
water.rotation.x = -Math.PI / 2;
water.position.y = 2.5;
water.receiveShadow = true;
scene.add(water);

const blockSize = 1;
const worldSize = 64;
const halfWorld = worldSize / 2;
const terrainHeightMap = new Map();
const blockGeometry = new THREE.BoxGeometry(blockSize, blockSize, blockSize);

const materials = {
  grass: new THREE.MeshLambertMaterial({ color: 0x6cbc43 }),
  dirt: new THREE.MeshLambertMaterial({ color: 0xb77b4b }),
  stone: new THREE.MeshLambertMaterial({ color: 0x8c8c8c }),
  sand: new THREE.MeshLambertMaterial({ color: 0xe3d7a1 })
};

const blockBuckets = {
  grass: [],
  dirt: [],
  stone: [],
  sand: []
};

const simplex = new SimplexNoise(2024);

for (let x = -halfWorld; x <= halfWorld; x++) {
  for (let z = -halfWorld; z <= halfWorld; z++) {
    const height = sampleHeight(x, z);
    const topKey = `${x},${z}`;
    terrainHeightMap.set(topKey, height);
    const surfaceMaterial = height <= 3 ? "sand" : "grass";

    for (let y = -2; y <= height; y++) {
      let bucket = "stone";
      if (y === height) {
        bucket = surfaceMaterial;
      } else if (y >= height - 3) {
        bucket = "dirt";
      }
      blockBuckets[bucket].push([x, y, z]);
    }
  }
}

buildInstancedMesh(blockBuckets.grass, materials.grass);
buildInstancedMesh(blockBuckets.dirt, materials.dirt);
buildInstancedMesh(blockBuckets.stone, materials.stone);
buildInstancedMesh(blockBuckets.sand, materials.sand);

document.getElementById("loading").style.display = "none";

const player = {
  position: new THREE.Vector3(0, 25, 0),
  velocity: new THREE.Vector3(),
  yaw: Math.PI,
  pitch: 0,
  onGround: false
};

const eyeHeight = 1.62;
resetPlayerHeight();

const joystickInput = new THREE.Vector2();
const keyboardInput = new THREE.Vector2();

const keys = {};
window.addEventListener("keydown", (event) => {
  if (["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
    event.preventDefault();
  }
  keys[event.code] = true;
});
window.addEventListener("keyup", (event) => {
  keys[event.code] = false;
});

const joystick = document.getElementById("joystick");
const stick = document.getElementById("stick");
let joystickPointer = null;

joystick.addEventListener("pointerdown", (event) => {
  joystickPointer = event.pointerId;
  joystick.setPointerCapture(joystickPointer);
  event.preventDefault();
  updateJoystick(event);
});

joystick.addEventListener("pointermove", (event) => {
  if (event.pointerId !== joystickPointer) return;
  event.preventDefault();
  updateJoystick(event);
});

["pointerup", "pointercancel", "pointerleave"].forEach((type) => {
  joystick.addEventListener(type, (event) => {
    if (event.pointerId !== joystickPointer) return;
    joystick.releasePointerCapture(joystickPointer);
    joystickPointer = null;
    joystickInput.set(0, 0);
    stick.style.transform = "translate(0px, 0px)";
  });
});

const lookPad = document.getElementById("lookPad");
let lookPointer = null;
let lastLook = null;
const lookSensitivity = 0.0035;

lookPad.addEventListener("pointerdown", (event) => {
  lookPointer = event.pointerId;
  lookPad.setPointerCapture(lookPointer);
  lastLook = { x: event.clientX, y: event.clientY };
  event.preventDefault();
});

lookPad.addEventListener("pointermove", (event) => {
  if (event.pointerId !== lookPointer) return;
  const dx = event.clientX - lastLook.x;
  const dy = event.clientY - lastLook.y;
  lastLook = { x: event.clientX, y: event.clientY };
  rotateCamera(dx * lookSensitivity, dy * lookSensitivity);
  event.preventDefault();
});

["pointerup", "pointercancel", "pointerleave"].forEach((type) => {
  lookPad.addEventListener(type, (event) => {
    if (event.pointerId !== lookPointer) return;
    lookPad.releasePointerCapture(lookPointer);
    lookPointer = null;
    lastLook = null;
  });
});

let mouseLook = false;
let lastMouse = null;
window.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  mouseLook = true;
  lastMouse = { x: event.clientX, y: event.clientY };
});
window.addEventListener("mouseup", () => {
  mouseLook = false;
  lastMouse = null;
});
window.addEventListener("mousemove", (event) => {
  if (!mouseLook) return;
  if (!lastMouse) {
    lastMouse = { x: event.clientX, y: event.clientY };
    return;
  }
  const dx = event.clientX - lastMouse.x;
  const dy = event.clientY - lastMouse.y;
  lastMouse = { x: event.clientX, y: event.clientY };
  rotateCamera(dx * lookSensitivity, dy * lookSensitivity);
});

const jumpBtn = document.getElementById("jumpBtn");
jumpBtn.addEventListener("click", () => jump());
window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    jump();
  }
});

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

window.addEventListener("contextmenu", (event) => event.preventDefault());

let previousTime = performance.now();
function animate(time) {
  const delta = Math.min((time - previousTime) / 1000, 0.05);
  previousTime = time;

  updateKeyboardInput();
  updatePlayer(delta);
  camera.rotation.set(player.pitch, player.yaw, 0, "YXZ");
  camera.position.copy(player.position);

  clouds.rotation.y += delta * 0.02;
  water.position.y = 2.5 + Math.sin(time * 0.0008) * 0.3;

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

function updateKeyboardInput() {
  const forward = (keys["KeyW"] ? 1 : 0) + (keys["ArrowUp"] ? 1 : 0) - (keys["KeyS"] ? 1 : 0) - (keys["ArrowDown"] ? 1 : 0);
  const right = (keys["KeyD"] ? 1 : 0) + (keys["ArrowRight"] ? 1 : 0) - (keys["KeyA"] ? 1 : 0) - (keys["ArrowLeft"] ? 1 : 0);
  keyboardInput.set(right, forward);
}

function updatePlayer(delta) {
  const inputX = THREE.MathUtils.clamp(keyboardInput.x + joystickInput.x, -1, 1);
  const inputZ = THREE.MathUtils.clamp(keyboardInput.y + joystickInput.y, -1, 1);

  const direction = new THREE.Vector3();
  const forward = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, player.yaw, 0));
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

  direction.addScaledVector(forward, inputZ);
  direction.addScaledVector(right, inputX);

  if (direction.lengthSq() > 1) {
    direction.normalize();
  }

  const targetSpeed = player.onGround ? 6 : 4;
  const horizontalVelocity = new THREE.Vector3(player.velocity.x, 0, player.velocity.z);
  const desiredVelocity = direction.multiplyScalar(targetSpeed);
  horizontalVelocity.lerp(desiredVelocity, player.onGround ? 0.25 : 0.08);
  player.velocity.x = horizontalVelocity.x;
  player.velocity.z = horizontalVelocity.z;

  player.velocity.y -= 30 * delta;

  const nextPosition = player.position.clone().addScaledVector(player.velocity, delta);
  const boundary = halfWorld - 2;
  nextPosition.x = THREE.MathUtils.clamp(nextPosition.x, -boundary, boundary);
  nextPosition.z = THREE.MathUtils.clamp(nextPosition.z, -boundary, boundary);

  const ground = groundHeight(nextPosition.x, nextPosition.z);
  const feet = nextPosition.y - eyeHeight;

  if (feet <= ground) {
    nextPosition.y = ground + eyeHeight;
    player.velocity.y = Math.max(0, player.velocity.y);
    player.onGround = true;
  } else {
    player.onGround = false;
  }

  player.position.copy(nextPosition);
}

function rotateCamera(deltaYaw, deltaPitch) {
  player.yaw -= deltaYaw;
  player.pitch -= deltaPitch;
  const limit = Math.PI / 2 - 0.05;
  player.pitch = THREE.MathUtils.clamp(player.pitch, -limit, limit);
}

function jump() {
  if (!player.onGround) return;
  player.velocity.y = 10.5;
  player.onGround = false;
}

function updateJoystick(event) {
  const rect = joystick.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = event.clientX - centerX;
  const dy = event.clientY - centerY;
  const maxDistance = rect.width / 2;

  const distance = Math.min(Math.hypot(dx, dy), maxDistance);
  const angle = Math.atan2(dy, dx);
  const offsetX = Math.cos(angle) * distance;
  const offsetY = Math.sin(angle) * distance;

  stick.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
  joystickInput.set(offsetX / maxDistance, -offsetY / maxDistance);
}

function groundHeight(x, z) {
  const cx = Math.round(x);
  const cz = Math.round(z);
  if (Math.abs(cx) > halfWorld || Math.abs(cz) > halfWorld) {
    return 2.5;
  }
  const top = terrainHeightMap.get(`${cx},${cz}`);
  if (top === undefined) return 2.5;
  return top + blockSize / 2;
}

function resetPlayerHeight() {
  const startHeight = groundHeight(player.position.x, player.position.z);
  player.position.set(0, startHeight + eyeHeight + 2, 0);
}

function buildInstancedMesh(positions, material) {
  if (!positions.length) return;
  const mesh = new THREE.InstancedMesh(blockGeometry, material, positions.length);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const dummy = new THREE.Object3D();
  positions.forEach((pos, index) => {
    dummy.position.set(pos[0], pos[1], pos[2]);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  });
  scene.add(mesh);
}

function sampleHeight(x, z) {
  const scale = 0.07;
  const n = simplex.noise2D(x * scale, z * scale) * 8;
  const n2 = simplex.noise2D((x + 100) * scale * 0.5, (z - 100) * scale * 0.5) * 4;
  const height = Math.floor(5 + n + n2);
  return Math.max(2, Math.min(height, 18));
}

function SimplexNoise(seed = Math.random() * 65536) {
  const perm = new Uint8Array(512);
  const grad2 = new Float32Array([
    1, 1,
    -1, 1,
    1, -1,
    -1, -1,
    1, 0,
    -1, 0,
    0, 1,
    0, -1
  ]);

  const random = mulberry32(typeof seed === "number" ? seed : hashCode(seed));
  for (let i = 0; i < 256; i++) {
    perm[i] = i;
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) {
    perm[i + 256] = perm[i];
  }

  this.noise2D = function (x, y) {
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;
    let n0 = 0,
      n1 = 0,
      n2 = 0;

    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = x - X0;
    const y0 = y - Y0;

    let i1, j1;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;

    const gi0 = perm[ii + perm[jj]] % 8;
    const gi1 = perm[ii + i1 + perm[jj + j1]] % 8;
    const gi2 = perm[ii + 1 + perm[jj + 1]] % 8;

    const t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const t0sq = t0 * t0;
      n0 = t0sq * t0sq * (grad2[gi0 * 2] * x0 + grad2[gi0 * 2 + 1] * y0);
    }

    const t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const t1sq = t1 * t1;
      n1 = t1sq * t1sq * (grad2[gi1 * 2] * x1 + grad2[gi1 * 2 + 1] * y1);
    }

    const t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const t2sq = t2 * t2;
      n2 = t2sq * t2sq * (grad2[gi2 * 2] * x2 + grad2[gi2 * 2 + 1] * y2);
    }

    return 70 * (n0 + n1 + n2);
  };
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
