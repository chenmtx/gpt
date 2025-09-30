import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.161/build/three.module.js";
import { ImprovedNoise } from "https://cdn.jsdelivr.net/npm/three@0.161/examples/jsm/math/ImprovedNoise.js";

const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 80, 220);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 400);
scene.add(camera);

const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(80, 120, 40);
sun.castShadow = true;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 400;
sun.shadow.camera.left = -120;
sun.shadow.camera.right = 120;
sun.shadow.camera.top = 120;
sun.shadow.camera.bottom = -120;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

const ambient = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(ambient);

const BLOCK_DEFS = {
  grass: {
    id: "grass",
    name: "草方块",
    color: 0x6aa84f,
  },
  dirt: {
    id: "dirt",
    name: "泥土",
    color: 0x7f5f3a,
  },
  stone: {
    id: "stone",
    name: "圆石",
    color: 0x888888,
  },
  sand: {
    id: "sand",
    name: "沙子",
    color: 0xe5d8a0,
  },
  log: {
    id: "log",
    name: "橡木原木",
    color: 0x8b5a2b,
  },
  leaves: {
    id: "leaves",
    name: "树叶",
    color: 0x2f8f2f,
    transparent: true,
    opacity: 0.75,
  },
  planks: {
    id: "planks",
    name: "木板",
    color: 0xcfa976,
  },
  glass: {
    id: "glass",
    name: "玻璃",
    color: 0xbbe5f2,
    transparent: true,
    opacity: 0.35,
  },
  brick: {
    id: "brick",
    name: "红砖",
    color: 0xb85442,
  },
  water: {
    id: "water",
    name: "水",
    color: 0x3d80c2,
    transparent: true,
    opacity: 0.55,
    solid: false,
  },
};

const HOTBAR = ["grass", "dirt", "stone", "sand", "planks", "log", "leaves", "glass", "brick"];

const MATERIALS = new Map();
const baseGeometry = new THREE.BoxGeometry(1, 1, 1);

function getMaterial(type) {
  if (!MATERIALS.has(type)) {
    const def = BLOCK_DEFS[type];
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(def.color),
      roughness: type === "glass" || type === "water" ? 0.05 : 0.7,
      metalness: 0,
      flatShading: true,
      transparent: Boolean(def.transparent),
      opacity: def.opacity ?? 1,
      depthWrite: !(def.transparent && type !== "glass"),
    });
    MATERIALS.set(type, material);
  }
  return MATERIALS.get(type);
}

const worldBlocks = new Map();
const blockMeshes = new Map();
const heightMap = new Map();

function blockKey(x, y, z) {
  return `${x},${y},${z}`;
}

function columnKey(x, z) {
  return `${x},${z}`;
}

function addBlock(x, y, z, type, updateHeight = true) {
  const key = blockKey(x, y, z);
  if (worldBlocks.has(key)) return false;
  const mesh = new THREE.Mesh(baseGeometry, getMaterial(type));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
  mesh.userData = { position: { x, y, z }, key, type };
  scene.add(mesh);
  worldBlocks.set(key, type);
  blockMeshes.set(key, mesh);
  if (updateHeight) updateHeightMapOnPlace(x, y, z, type);
  return true;
}

function removeBlock(x, y, z, updateHeight = true) {
  const key = blockKey(x, y, z);
  const mesh = blockMeshes.get(key);
  if (!mesh) return false;
  scene.remove(mesh);
  blockMeshes.delete(key);
  const type = worldBlocks.get(key);
  worldBlocks.delete(key);
  if (updateHeight) updateHeightMapOnBreak(x, y, z, type);
  return true;
}

function getBlock(x, y, z) {
  return worldBlocks.get(blockKey(x, y, z));
}

function isSolid(type) {
  const def = BLOCK_DEFS[type];
  if (!def) return true;
  return def.solid !== false;
}

function updateHeightMapOnPlace(x, y, z, type) {
  if (!isSolid(type)) return;
  const column = columnKey(x, z);
  const current = heightMap.get(column);
  if (current === undefined || y > current) {
    heightMap.set(column, y);
  }
}

function updateHeightMapOnBreak(x, y, z, removedType) {
  if (!isSolid(removedType)) return;
  const column = columnKey(x, z);
  const current = heightMap.get(column);
  if (current === undefined) return;
  if (y < current) return;
  for (let yy = y; yy >= -16; yy -= 1) {
    const neighborType = worldBlocks.get(blockKey(x, yy, z));
    if (neighborType && isSolid(neighborType)) {
      heightMap.set(column, yy);
      return;
    }
  }
  heightMap.delete(column);
}

function getColumnTopY(x, z) {
  return heightMap.get(columnKey(x, z)) ?? -Infinity;
}

function recalcColumnHeight(x, z, minY = -16, maxY = 96) {
  const column = columnKey(x, z);
  for (let y = maxY; y >= minY; y--) {
    const type = worldBlocks.get(blockKey(x, y, z));
    if (type && isSolid(type)) {
      heightMap.set(column, y);
      return;
    }
  }
  heightMap.delete(column);
}

const WORLD_SETTINGS = {
  chunkSize: 16,
  radius: 3,
  baseHeight: 12,
  amplitude: 9,
  waterLevel: 10,
};

const seed = Math.random() * 100000;
const noise = new ImprovedNoise();

function noise2D(x, z) {
  return noise.noise(x, 0, z);
}

function seededRandom(x, z) {
  const s = Math.sin(x * 374761393 + z * 668265263 + seed * 1.12357) * 43758.5453123;
  return s - Math.floor(s);
}

function generateChunk(cx, cz) {
  const size = WORLD_SETTINGS.chunkSize;
  for (let dx = 0; dx < size; dx++) {
    for (let dz = 0; dz < size; dz++) {
      const wx = cx * size + dx;
      const wz = cz * size + dz;
      const heightValue = noise2D(wx * 0.06, wz * 0.06) * WORLD_SETTINGS.amplitude;
      const hillValue = noise2D(wx * 0.02, wz * 0.02) * 4;
      const height = Math.floor(WORLD_SETTINGS.baseHeight + heightValue + hillValue);
      for (let y = -4; y <= height; y++) {
        if (y === height) {
          addBlock(wx, y, wz, y < WORLD_SETTINGS.waterLevel ? "sand" : "grass");
        } else if (y > height - 4) {
          addBlock(wx, y, wz, "dirt");
        } else {
          addBlock(wx, y, wz, "stone");
        }
      }
      if (height < WORLD_SETTINGS.waterLevel) {
        for (let y = height + 1; y <= WORLD_SETTINGS.waterLevel; y++) {
          addBlock(wx, y, wz, "water");
        }
      }
      const treeChance = seededRandom(wx, wz);
      if (treeChance > 0.86 && height > WORLD_SETTINGS.waterLevel && height < 28) {
        generateTree(wx, height + 1, wz, treeChance);
      }
    }
  }
}

function generateTree(x, y, z, randomValue) {
  const height = 4 + Math.floor(randomValue * 2);
  for (let i = 0; i < height; i++) {
    if (!addBlock(x, y + i, z, "log")) return;
  }
  const leafRadius = 2;
  for (let dx = -leafRadius; dx <= leafRadius; dx++) {
    for (let dy = -leafRadius; dy <= leafRadius; dy++) {
      for (let dz = -leafRadius; dz <= leafRadius; dz++) {
        const dist = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
        if (dist <= 4 && dy >= -1) {
          if (!getBlock(x + dx, y + height - 2 + dy, z + dz)) {
            addBlock(x + dx, y + height - 2 + dy, z + dz, "leaves");
          }
        }
      }
    }
  }
}

function generateWorld() {
  for (let cx = -WORLD_SETTINGS.radius; cx <= WORLD_SETTINGS.radius; cx++) {
    for (let cz = -WORLD_SETTINGS.radius; cz <= WORLD_SETTINGS.radius; cz++) {
      generateChunk(cx, cz);
    }
  }
}

generateWorld();

const player = {
  position: new THREE.Vector3(0, 50, 0),
  velocity: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
};

const EYE_HEIGHT = 1.62;
const PLAYER_HEIGHT = 1.8;
const PLAYER_RADIUS = 0.35;

function findSpawnPoint() {
  let bestY = -Infinity;
  for (let [colKey, y] of heightMap.entries()) {
    if (y > bestY) {
      const [x, z] = colKey.split(",").map(Number);
      if (getBlock(x, y, z) !== "water") {
        bestY = y;
        player.position.set(x + 0.5, y + EYE_HEIGHT + 0.1, z + 0.5);
      }
    }
  }
  if (bestY === -Infinity) {
    player.position.set(0.5, WORLD_SETTINGS.baseHeight + EYE_HEIGHT + 2, 0.5);
  }
  player.velocity.set(0, 0, 0);
  player.yaw = Math.PI;
  player.pitch = 0;
  updateCameraRotation();
}

findSpawnPoint();

const toolbar = document.getElementById("toolbar");
const slots = [];
let selectedSlot = 0;

HOTBAR.forEach((id, index) => {
  const slot = document.createElement("div");
  slot.className = "hotbar-slot";
  slot.dataset.block = id;
  slot.textContent = BLOCK_DEFS[id].name;
  slot.addEventListener("click", () => {
    selectedSlot = index;
    refreshHotbar();
  });
  toolbar.appendChild(slot);
  slots.push(slot);
});

function refreshHotbar() {
  slots.forEach((slot, i) => {
    slot.classList.toggle("active", i === selectedSlot);
  });
}

refreshHotbar();

const pointerState = {
  locked: false,
  mouseSensitivity: 0.0025,
};

canvas.addEventListener("click", () => {
  if (!isTouchDevice()) {
    canvas.requestPointerLock();
  }
});

document.addEventListener("pointerlockchange", () => {
  pointerState.locked = document.pointerLockElement === canvas;
});

document.addEventListener("mousemove", (event) => {
  if (!pointerState.locked) return;
  rotateCamera(event.movementX, event.movementY);
});

function rotateCamera(deltaX, deltaY) {
  player.yaw -= deltaX * pointerState.mouseSensitivity;
  player.pitch -= deltaY * pointerState.mouseSensitivity;
  const limit = Math.PI / 2 - 0.05;
  player.pitch = THREE.MathUtils.clamp(player.pitch, -limit, limit);
  updateCameraRotation();
}

function updateCameraRotation() {
  camera.rotation.set(player.pitch, player.yaw, 0, "YXZ");
}

const moveState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
};

const keyBindings = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "backward",
  ArrowDown: "backward",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
};

document.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  if (keyBindings[event.code] !== undefined) {
    moveState[keyBindings[event.code]] = true;
  }
  if (event.code === "Space") {
    tryJump();
  }
  if (event.code.startsWith("Digit")) {
    const index = parseInt(event.code.replace("Digit", ""), 10) - 1;
    if (index >= 0 && index < HOTBAR.length) {
      selectedSlot = index;
      refreshHotbar();
    }
  }
});

document.addEventListener("keyup", (event) => {
  if (keyBindings[event.code] !== undefined) {
    moveState[keyBindings[event.code]] = false;
  }
});

document.addEventListener("contextmenu", (event) => event.preventDefault());

document.addEventListener("mousedown", (event) => {
  if (event.button === 0) {
    handleBreakAction();
  } else if (event.button === 2) {
    handlePlaceAction();
  }
});

window.addEventListener("wheel", (event) => {
  const direction = event.deltaY > 0 ? 1 : -1;
  selectedSlot = (selectedSlot + direction + HOTBAR.length) % HOTBAR.length;
  refreshHotbar();
});

function handleBreakAction() {
  const hit = raycastBlock();
  if (!hit) return;
  const { blockPosition, type } = hit;
  if (type === "water") return;
  removeBlock(blockPosition.x, blockPosition.y, blockPosition.z);
}

function handlePlaceAction() {
  const hit = raycastBlock();
  if (!hit) return;
  const blockId = HOTBAR[selectedSlot];
  if (!blockId) return;
  const { blockPosition, faceNormal, type } = hit;
  if (type === "water") return;
  const placePosition = {
    x: blockPosition.x + Math.round(faceNormal.x),
    y: blockPosition.y + Math.round(faceNormal.y),
    z: blockPosition.z + Math.round(faceNormal.z),
  };
  if (wouldCollideWithPlayer(placePosition.x, placePosition.y, placePosition.z)) return;
  addBlock(placePosition.x, placePosition.y, placePosition.z, blockId);
}

function wouldCollideWithPlayer(x, y, z) {
  const blockMin = new THREE.Vector3(x, y, z);
  const blockMax = new THREE.Vector3(x + 1, y + 1, z + 1);
  const playerMin = new THREE.Vector3(
    player.position.x - PLAYER_RADIUS,
    player.position.y - EYE_HEIGHT,
    player.position.z - PLAYER_RADIUS
  );
  const playerMax = new THREE.Vector3(
    player.position.x + PLAYER_RADIUS,
    player.position.y - EYE_HEIGHT + PLAYER_HEIGHT,
    player.position.z + PLAYER_RADIUS
  );
  return (
    playerMin.x < blockMax.x &&
    playerMax.x > blockMin.x &&
    playerMin.y < blockMax.y &&
    playerMax.y > blockMin.y &&
    playerMin.z < blockMax.z &&
    playerMax.z > blockMin.z
  );
}

const raycaster = new THREE.Raycaster();

function raycastBlock() {
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const direction = camera.getWorldDirection(new THREE.Vector3());
  raycaster.set(origin, direction);
  raycaster.far = 6;
  const objects = Array.from(blockMeshes.values()).filter((mesh) => {
    const type = mesh.userData.type;
    return isSolid(type) && mesh.material.opacity > 0;
  });
  const intersections = raycaster.intersectObjects(objects, false);
  if (!intersections.length) return null;
  const intersection = intersections[0];
  const blockPosition = intersection.object.userData.position;
  return {
    blockPosition,
    faceNormal: intersection.face.normal,
    type: intersection.object.userData.type,
  };
}

function isTouchDevice() {
  return window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
}

const joystick = document.getElementById("joystick");
const joystickHandle = document.getElementById("joystick-handle");
const jumpButton = document.getElementById("jump-btn");
const buildButton = document.getElementById("build-btn");
const breakButton = document.getElementById("break-btn");

let joystickTouchId = null;
let joystickVector = { x: 0, y: 0 };

function setJoystickVector(x, y) {
  joystickVector = { x, y };
  const radius = 60;
  joystickHandle.style.transform = `translate(${x * radius}px, ${y * radius}px)`;
}

function handleJoystickStart(event) {
  const touch = event.changedTouches[0];
  joystickTouchId = touch.identifier;
  updateJoystick(touch);
}

function handleJoystickMove(event) {
  for (const touch of event.changedTouches) {
    if (touch.identifier === joystickTouchId) {
      updateJoystick(touch);
      break;
    }
  }
}

function handleJoystickEnd(event) {
  for (const touch of event.changedTouches) {
    if (touch.identifier === joystickTouchId) {
      joystickTouchId = null;
      setJoystickVector(0, 0);
      break;
    }
  }
}

function updateJoystick(touch) {
  const rect = joystick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = touch.clientX - cx;
  const dy = touch.clientY - cy;
  const maxDist = rect.width / 2;
  const distance = Math.min(Math.sqrt(dx * dx + dy * dy), maxDist);
  const angle = Math.atan2(dy, dx);
  const nx = Math.cos(angle) * (distance / maxDist);
  const ny = Math.sin(angle) * (distance / maxDist);
  setJoystickVector(nx, ny);
}

if (isTouchDevice()) {
  joystick.addEventListener("touchstart", (event) => {
    event.preventDefault();
    handleJoystickStart(event);
  });
  joystick.addEventListener("touchmove", (event) => {
    event.preventDefault();
    handleJoystickMove(event);
  });
  joystick.addEventListener("touchend", (event) => {
    event.preventDefault();
    handleJoystickEnd(event);
  });
  joystick.addEventListener("touchcancel", (event) => {
    event.preventDefault();
    handleJoystickEnd(event);
  });

  jumpButton.addEventListener("touchstart", (event) => {
    event.preventDefault();
    tryJump();
  });
  buildButton.addEventListener("touchstart", (event) => {
    event.preventDefault();
    handlePlaceAction();
  });
  breakButton.addEventListener("touchstart", (event) => {
    event.preventDefault();
    handleBreakAction();
  });
} else {
  document.getElementById("touch-controls").style.display = "none";
}

let lookTouchId = null;
let lastLookPoint = { x: 0, y: 0 };

function handleLookTouchStart(event) {
  for (const touch of event.changedTouches) {
    if (touch.target.closest && touch.target.closest("#joystick, #buttons")) {
      continue;
    }
    lookTouchId = touch.identifier;
    lastLookPoint = { x: touch.clientX, y: touch.clientY };
    return true;
  }
  return false;
}

function handleLookTouchMove(event) {
  for (const touch of event.changedTouches) {
    if (touch.identifier === lookTouchId) {
      const dx = touch.clientX - lastLookPoint.x;
      const dy = touch.clientY - lastLookPoint.y;
      lastLookPoint = { x: touch.clientX, y: touch.clientY };
      rotateCamera(dx, dy);
      return true;
    }
  }
  return false;
}

function handleLookTouchEnd(event) {
  for (const touch of event.changedTouches) {
    if (touch.identifier === lookTouchId) {
      lookTouchId = null;
      return true;
    }
  }
  return false;
}

if (isTouchDevice()) {
  document.body.addEventListener("touchstart", (event) => {
    if (!event.target.closest || !event.target.closest("#joystick, #buttons")) {
      if (handleLookTouchStart(event)) {
        event.preventDefault();
      }
    }
  }, { passive: false });
  document.body.addEventListener("touchmove", (event) => {
    if (!event.target.closest || !event.target.closest("#joystick, #buttons")) {
      if (handleLookTouchMove(event)) {
        event.preventDefault();
      }
    }
  }, { passive: false });
  document.body.addEventListener("touchend", (event) => {
    if (handleLookTouchEnd(event)) {
      event.preventDefault();
    }
  });
  document.body.addEventListener("touchcancel", handleLookTouchEnd);
}

const clock = new THREE.Clock();
let grounded = false;

function tryJump() {
  if (grounded) {
    player.velocity.y = 7;
    grounded = false;
  }
}

function updatePlayer(delta) {
  const forwardInput = (moveState.forward ? 1 : 0) - (moveState.backward ? 1 : 0) - joystickVector.y;
  const strafeInput = (moveState.right ? 1 : 0) - (moveState.left ? 1 : 0) + joystickVector.x;

  const inputVector = new THREE.Vector2(strafeInput, forwardInput);
  if (inputVector.length() > 1) {
    inputVector.normalize();
  }

  const speed = grounded ? 6 : 4;
  const acceleration = 18;
  const damping = 10;

  const forward = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw)).negate();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));

  const desiredVelocity = new THREE.Vector3();
  desiredVelocity.addScaledVector(forward, inputVector.y * speed);
  desiredVelocity.addScaledVector(right, inputVector.x * speed);

  player.velocity.x = THREE.MathUtils.damp(player.velocity.x, desiredVelocity.x, damping, delta);
  player.velocity.z = THREE.MathUtils.damp(player.velocity.z, desiredVelocity.z, damping, delta);

  player.velocity.y -= 24 * delta;

  moveWithCollisions(delta);

  camera.position.copy(player.position);
}

function moveWithCollisions(delta) {
  const nextPosition = player.position.clone();

  nextPosition.x += player.velocity.x * delta;
  resolveAxisCollision(nextPosition, "x");
  player.position.x = nextPosition.x;

  nextPosition.z = player.position.z + player.velocity.z * delta;
  resolveAxisCollision(nextPosition, "z");
  player.position.z = nextPosition.z;

  nextPosition.y = player.position.y + player.velocity.y * delta;
  const collidedY = resolveAxisCollision(nextPosition, "y");
  player.position.y = nextPosition.y;

  if (collidedY < 0 && player.velocity.y < 0) {
    grounded = true;
    player.velocity.y = 0;
  } else if (collidedY > 0 && player.velocity.y > 0) {
    player.velocity.y = 0;
  } else if (!collidedY) {
    grounded = false;
  }
}

function resolveAxisCollision(candidatePosition, axis) {
  const playerMin = new THREE.Vector3(
    candidatePosition.x - PLAYER_RADIUS,
    candidatePosition.y - EYE_HEIGHT,
    candidatePosition.z - PLAYER_RADIUS
  );
  const playerMax = new THREE.Vector3(
    candidatePosition.x + PLAYER_RADIUS,
    candidatePosition.y - EYE_HEIGHT + PLAYER_HEIGHT,
    candidatePosition.z + PLAYER_RADIUS
  );

  const minX = Math.floor(playerMin.x);
  const maxX = Math.floor(playerMax.x);
  const minY = Math.floor(playerMin.y);
  const maxY = Math.floor(playerMax.y);
  const minZ = Math.floor(playerMin.z);
  const maxZ = Math.floor(playerMax.z);

  let collisionDirection = 0;

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        const type = worldBlocks.get(blockKey(x, y, z));
        if (!type || !isSolid(type)) continue;
        const blockMin = new THREE.Vector3(x, y, z);
        const blockMax = new THREE.Vector3(x + 1, y + 1, z + 1);
        if (
          playerMin.x < blockMax.x &&
          playerMax.x > blockMin.x &&
          playerMin.y < blockMax.y &&
          playerMax.y > blockMin.y &&
          playerMin.z < blockMax.z &&
          playerMax.z > blockMin.z
        ) {
          if (axis === "x") {
            if (player.velocity.x > 0) {
              candidatePosition.x = blockMin.x - PLAYER_RADIUS;
            } else if (player.velocity.x < 0) {
              candidatePosition.x = blockMax.x + PLAYER_RADIUS;
            }
            player.velocity.x = 0;
          } else if (axis === "z") {
            if (player.velocity.z > 0) {
              candidatePosition.z = blockMin.z - PLAYER_RADIUS;
            } else if (player.velocity.z < 0) {
              candidatePosition.z = blockMax.z + PLAYER_RADIUS;
            }
            player.velocity.z = 0;
          } else if (axis === "y") {
            if (player.velocity.y > 0) {
              candidatePosition.y = blockMin.y - (PLAYER_HEIGHT - (EYE_HEIGHT));
              collisionDirection = 1;
            } else if (player.velocity.y < 0) {
              candidatePosition.y = blockMax.y + EYE_HEIGHT;
              collisionDirection = -1;
            }
            player.velocity.y = 0;
          }
        }
      }
    }
  }
  return collisionDirection;
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  updatePlayer(delta);
  renderer.render(scene, camera);
}

animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});
