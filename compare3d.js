/* Two machines, side by side, under the same speed and the same load.

   The left one is told the rotor angle by an encoder. The right one has to work
   it out from the voltage the spinning magnets generate. Everything else about
   them is identical, so whatever you can see between them is the cost of not
   having a sensor.

   Both are the same teaching model as the exploded view: one pole pair, six
   coils, each lit by the current its controller is commanding. The lit pattern
   is the stator field, so the right-hand machine visibly energises the wrong
   coils at low speed, which is the thing the whole investigation is about. */

import * as THREE from './vendor/three.module.js';
import { buildFocMachine, labelSprite } from './focmachine.js';

let renderer, scene, camera, clock, host, left, right, raf = 0;
let state = { rpm: 400, err: 0, amplitude: 1, limited: false };
let spin = 0;

export function init(container) {
  host = container;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11161f);
  camera = new THREE.PerspectiveCamera(40, 2, .01, 20);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.innerHTML = '';
  container.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x20262f, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(.5, 1, .9); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9ec1ff, .35); rim.position.set(-.8, .4, -.7); scene.add(rim);

  left = buildFocMachine(THREE, { labelScale: .85 });
  right = buildFocMachine(THREE, { labelScale: .85 });
  left.group.position.set(-.155, 0, 0);
  right.group.position.set(.155, 0, 0);
  scene.add(left.group, right.group);
  left.setExplode(.35); right.setExplode(.35);     // just enough to see inside

  const heading = (text, colour, x, width) => {
    const sprite = labelSprite(THREE, text, colour, width);
    sprite.position.set(x, .135, .05); scene.add(sprite);
  };
  heading('ENCODER · angle measured', '#34d399', -.155, .20);
  heading('ESTIMATE · angle worked out', '#f0b429', .155, .21);

  const divider = new THREE.Mesh(new THREE.PlaneGeometry(.001, .30),
    new THREE.MeshBasicMaterial({ color: 0x26303c, transparent: true, opacity: .8 }));
  divider.position.set(0, 0, -.02); scene.add(divider);

  const note = labelSprite(THREE,
    'one pole pair shown · the motor has three', '#5b6b7f', .20);
  note.position.set(0, -.175, .05); scene.add(note);

  resize();
  addEventListener('resize', resize);
  clock = new THREE.Clock();
  renderer.setAnimationLoop(frame);
  return true;
}

export function update(next) {
  Object.assign(state, next);
}

function resize() {
  if (!host || !host.clientWidth) return;
  renderer.setSize(host.clientWidth, host.clientHeight, false);
  camera.aspect = host.clientWidth / Math.max(host.clientHeight, 1);
  camera.updateProjectionMatrix();
}

function frame() {
  const dt = Math.min(clock.getDelta(), .05);
  // Slowed heavily: at real speed the field is a blur and nothing can be read.
  spin += dt * (state.rpm * 2 * Math.PI / 60) * .035;

  left.update({ theta: spin, err: 0, amplitude: 1 });
  right.update({ theta: spin, err: state.err, amplitude: Math.min(state.amplitude, 1), showEstimate: true });

  const dist = .62;
  camera.position.set(Math.cos(.45) * dist * .55, .22, dist);
  camera.lookAt(0, -.01, 0);
  renderer.render(scene, camera);
  raf = 1;
}

export function stop() {
  if (renderer) renderer.setAnimationLoop(null);
}
