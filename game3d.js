/* The machine the player is actually driving, in three dimensions.

   It is the same teaching model as the exploded view and the side-by-side: one
   pole pair, six coils, each lit by the current its controller is commanding.
   Here the controller is the person. Aim well and the coils light in a neat
   rotating pattern; aim badly and you can see yourself energising the wrong
   ones, which is the thing the whole page is about. */

import * as THREE from './vendor/three.module.js';
import { buildFocMachine, labelSprite } from './focmachine.js';

let renderer, scene, camera, host, machine, clock;
let state = { theta: 0, err: 0, amplitude: 1, heat: 0 };
const orbit = { yaw: .5, pitch: .35, zoom: 1, drag: null };

// While a round is running the pointer aims the current on the machine itself,
// which is the whole appeal of having it in three dimensions. Between rounds the
// same drag turns the view instead, so the model can still be looked at.
let aiming = false, onAim = null;
const raycaster = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.062);
const hit = new THREE.Vector3();

export function setAiming(on) {
  aiming = !!on;
  if (host) host.style.cursor = aiming ? 'crosshair' : 'grab';
}

export function setAimHandler(fn) { onAim = fn; }

// Screen position to an angle round the shaft: cast a ray through the pointer
// and see where it crosses the plane the vectors live in.
function aimFrom(event) {
  if (!onAim || !camera) return;
  const rect = host.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1), camera);
  if (!raycaster.ray.intersectPlane(aimPlane, hit)) return;
  if (Math.hypot(hit.x, hit.y) < .004) return;    // too near the shaft to mean anything
  onAim(Math.atan2(hit.y, hit.x));
}

export function init(container) {
  host = container;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f16);
  camera = new THREE.PerspectiveCamera(42, 2, .01, 20);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.innerHTML = '';
  container.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x20262f, .75));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(.5, 1, .9); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = .1; key.shadow.camera.far = 3;
  key.shadow.camera.left = -.4; key.shadow.camera.right = .4;
  key.shadow.camera.top = .4; key.shadow.camera.bottom = -.4;
  key.shadow.bias = -.0012;
  scene.add(key);

  machine = buildFocMachine(THREE, { labelScale: .9, glow: 2.3 });
  machine.setExplode(.3);
  scene.add(machine.group);
  scene.traverse(object => {
    if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; }
  });

  const note = labelSprite(THREE, 'the coils you are lighting', '#9aa5b1', .13);
  note.position.set(0, -.115, .06); scene.add(note);

  // Draggable, like every other 3D view here.
  const pointer = e => {
    if (aiming) { aimFrom(e); return; }           // playing: the pointer is the current
    if (e.type === 'pointerdown') orbit.drag = { x: e.clientX, y: e.clientY };
    else if (e.type === 'pointerup' || e.type === 'pointerleave') orbit.drag = null;
    else if (orbit.drag) {
      orbit.yaw -= (e.clientX - orbit.drag.x) * .006;
      orbit.pitch = Math.max(-.2, Math.min(1, orbit.pitch + (e.clientY - orbit.drag.y) * .004));
      orbit.drag = { x: e.clientX, y: e.clientY };
    }
  };
  for (const t of ['pointerdown', 'pointerup', 'pointermove', 'pointerleave'])
    container.addEventListener(t, pointer);
  // A finger dragging on the model should aim, not scroll the page away.
  container.addEventListener('touchmove', e => { if (aiming) e.preventDefault(); },
    { passive: false });
  container.addEventListener('wheel', e => {
    e.preventDefault();
    orbit.zoom = Math.max(.5, Math.min(2, orbit.zoom * (1 + Math.sign(e.deltaY) * .12)));
  }, { passive: false });

  resize();
  addEventListener('resize', resize);
  clock = new THREE.Clock();
  renderer.setAnimationLoop(frame);
  return true;
}

export function update(next) { Object.assign(state, next); }

function resize() {
  if (!host || !host.clientWidth) return;
  renderer.setSize(host.clientWidth, host.clientHeight, false);
  camera.aspect = host.clientWidth / Math.max(host.clientHeight, 1);
  camera.updateProjectionMatrix();
}

function frame() {
  machine.update({
    theta: state.theta, err: state.err,
    amplitude: state.amplitude, heat: state.heat,
  });
  // Beside the dial the view is taller than it is wide, so the horizontal field
  // is the binding one: back off enough that the machine still fits across.
  const dist = .30 * orbit.zoom / Math.min(1, camera.aspect);
  camera.position.set(
    Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * dist,
    Math.sin(orbit.pitch) * dist,
    Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * dist);
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
}

export function stop() {
  if (renderer) renderer.setAnimationLoop(null);
}
