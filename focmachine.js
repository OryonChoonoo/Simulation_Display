/* One motor, built once, used by every 3D exhibit.

   It is a teaching model of a single pole pair: six coils, two per phase, a
   two-pole rotor, and the vectors that explain field-oriented control. The real
   BM1109 has three pole pairs, so one turn of this model is a third of a shaft
   turn. Every exhibit that uses it says so on screen.

   What it shows that a picture of a motor does not: each coil is lit by the
   current the controller is commanding for that coil, so the lit pattern IS the
   stator field. Watching it stay 90 electrical degrees ahead of the magnets is
   watching field-oriented control work. */

export const PHASE_COLOUR = [0x34d399, 0xf0b429, 0x7aa2f7];
export const PHASE_NAME = ['A', 'B', 'C'];

// A soft disc, drawn once and shared, used additively so a lit coil reads as
// glowing rather than merely being a brighter colour.
let glowTexture = null;
function glowMap(THREE) {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(.35, 'rgba(255,255,255,.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

export function labelSprite(THREE, text, colour, width) {
  // The canvas is sized to the text so long labels are not squashed or clipped.
  const c = document.createElement('canvas');
  const font = 'bold 44px system-ui';
  const measure = c.getContext('2d');
  measure.font = font;
  c.width = Math.ceil(measure.measureText(text).width) + 28;
  c.height = 72;
  const g = c.getContext('2d');
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 7; g.strokeStyle = 'rgba(8,11,16,.92)'; g.strokeText(text, c.width / 2, 38);
  g.fillStyle = colour; g.fillText(text, c.width / 2, 38);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: false, depthWrite: false }));
  sprite.scale.set(width, width * c.height / c.width, 1);
  sprite.renderOrder = 10;
  return sprite;
}

// A floating note: wrapped text on a panel, with a thin leader line back to the
// thing it is talking about. Returns setText so a note can change as the state
// changes without rebuilding the scene.
export function calloutSprite(THREE, text, colour, width, opts = {}) {
  const { maxChars = 34, align = 'left' } = opts;
  const canvas = document.createElement('canvas');
  const font = '30px system-ui';
  const lineHeight = 38, pad = 18;

  function paint(message) {
    const measure = canvas.getContext('2d');
    measure.font = font;
    const words = String(message).split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? line + ' ' + word : word;
      if (candidate.length > maxChars && line) { lines.push(line); line = word; }
      else line = candidate;
    }
    if (line) lines.push(line);
    const widest = Math.max(...lines.map(l => measure.measureText(l).width));
    canvas.width = Math.ceil(widest) + pad * 2;
    canvas.height = lines.length * lineHeight + pad * 2;
    const g = canvas.getContext('2d');
    g.fillStyle = 'rgba(13,17,23,.82)';
    g.strokeStyle = colour; g.lineWidth = 3;
    const r = 14, w = canvas.width, h = canvas.height;
    g.beginPath();
    g.moveTo(r, 1.5); g.arcTo(w - 1.5, 1.5, w - 1.5, h - 1.5, r);
    g.arcTo(w - 1.5, h - 1.5, 1.5, h - 1.5, r); g.arcTo(1.5, h - 1.5, 1.5, 1.5, r);
    g.arcTo(1.5, 1.5, w - 1.5, 1.5, r); g.closePath();
    g.fill(); g.stroke();
    g.font = font; g.textBaseline = 'middle'; g.fillStyle = '#e8eaed';
    g.textAlign = align === 'center' ? 'center' : 'left';
    lines.forEach((l, k) => {
      g.fillText(l, align === 'center' ? w / 2 : pad, pad + lineHeight * (k + .5));
    });
    return lines.length;
  }

  paint(text);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: false, depthWrite: false }));
  sprite.renderOrder = 11;
  const fit = () => sprite.scale.set(width, width * canvas.height / canvas.width, 1);
  fit();

  let current = text;
  sprite.userData.setText = message => {
    if (message === current) return;
    current = message;
    paint(message);
    texture.dispose();
    const next = new THREE.CanvasTexture(canvas);
    next.colorSpace = THREE.SRGBColorSpace;
    sprite.material.map = next;
    sprite.material.needsUpdate = true;
    fit();
  };
  return sprite;
}

// A thin line from a note back to the part it describes.
export function leader(THREE, from, to, colour) {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...from), new THREE.Vector3(...to)]),
    new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: .55 }));
}

function arcLine(THREE, radius, from, to, colour, z) {
  const points = [];
  const steps = Math.max(8, Math.round(Math.abs(to - from) * 24));
  for (let k = 0; k <= steps; k++) {
    const a = from + (to - from) * k / steps;
    points.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, z));
  }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: .9 }));
}

function arrow(THREE, colour, length = .07) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: colour, emissive: colour, emissiveIntensity: .35, roughness: .4 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.0045, .0045, length, 10), mat);
  shaft.position.y = length / 2; g.add(shaft);
  const head = new THREE.Mesh(new THREE.ConeGeometry(.014, .028, 14), mat);
  head.position.y = length + .014; g.add(head);
  return g;
}

export function buildFocMachine(THREE, opts = {}) {
  const { withLabels = true, labelScale = 1, detailed = false } = opts;
  const group = new THREE.Group();

  const rotorGroup = new THREE.Group();
  rotorGroup.userData.explode = .055;
  group.add(rotorGroup);
  const statorGroup = new THREE.Group();
  statorGroup.userData.explode = -.075;
  group.add(statorGroup);
  const vectors = new THREE.Group();
  vectors.position.z = .062;
  group.add(vectors);

  const mesh = (geometry, colour, parent, extra = {}) => {
    const m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial(
      Object.assign({ color: colour, roughness: .5, metalness: .4 }, extra)));
    parent.add(m); return m;
  };
  const boxAt = (w, h, d, colour, x, y, z, parent, extra) => {
    const m = mesh(new THREE.BoxGeometry(w, h, d), colour, parent, extra);
    m.position.set(x, y, z); return m;
  };
  const cylAt = (r, len, colour, z, parent, seg = 28, extra) => {
    const m = mesh(new THREE.CylinderGeometry(r, r, len, seg), colour, parent, extra);
    m.rotation.x = Math.PI / 2; m.position.z = z; return m;
  };
  const ringAt = (r, len, colour, z, parent, seg = 36, extra) => {
    const m = mesh(new THREE.CylinderGeometry(r, r, len, seg, 1, true), colour, parent,
      Object.assign({ side: THREE.DoubleSide }, extra));
    m.rotation.x = Math.PI / 2; m.position.z = z; return m;
  };

  // ---- rotor -------------------------------------------------------------------
  cylAt(.014, .18, 0x6c7787, 0, rotorGroup, 20);                     // shaft
  cylAt(.028, .1, 0x39414d, 0, rotorGroup, 30);                      // back iron
  for (const [k, colour] of [[0, 0xef4444], [1, 0x5b6b7f]]) {
    const magnet = mesh(new THREE.CylinderGeometry(.032, .032, .096, 24, 1, false,
      k * Math.PI + .05, Math.PI - .1), colour, rotorGroup, { roughness: .45 });
    magnet.rotation.x = Math.PI / 2;
  }
  const sleeve = ringAt(.0332, .098, 0x9aa5b1, 0, rotorGroup, 36,
    { transparent: true, opacity: .3 });
  for (const bz of [-.054, .054]) {                                  // bearings
    cylAt(.0105, .011, 0x8d97a4, bz, rotorGroup, 20);
    ringAt(.019, .011, 0x8d97a4, bz, rotorGroup, 24);
    for (let b = 0; b < 9; b++) {
      const a = b / 9 * Math.PI * 2;
      const ball = mesh(new THREE.SphereGeometry(.0035, 10, 8), 0xd7dde5, rotorGroup,
        { roughness: .25, metalness: .85 });
      ball.position.set(Math.cos(a) * .0145, Math.sin(a) * .0145, bz);
    }
  }
  boxAt(.004, .004, .022, 0x7d8896, 0, .015, .066, rotorGroup);      // shaft key
  const balance = boxAt(.01, .004, .006, 0xb9c2cd, .026, 0, .047, rotorGroup);  // balance weight

  // ---- stator ------------------------------------------------------------------
  ringAt(.050, .09, 0x4e5866, 0, statorGroup, 48);                   // back iron
  for (let lam = 0; lam < 9; lam++)                                   // lamination stripes
    ringAt(.0505, .002, 0x3c4450, -.04 + lam * .01, statorGroup, 48);

  const coils = [];
  for (let k = 0; k < 6; k++) {
    const phase = k % 3, sign = k < 3 ? 1 : -1;
    const a = phase * 2 * Math.PI / 3 + (sign > 0 ? 0 : Math.PI);
    const tooth = boxAt(.016, .020, .088, 0x707b89,
      Math.cos(a) * .036, Math.sin(a) * .036, 0, statorGroup);
    tooth.rotation.z = a;
    const shoe = boxAt(.022, .006, .088, 0x707b89,
      Math.cos(a) * .0275, Math.sin(a) * .0275, 0, statorGroup);
    shoe.rotation.z = a;                                             // pole shoe
    const coil = boxAt(.020, .030, .070, PHASE_COLOUR[phase],
      Math.cos(a) * .0415, Math.sin(a) * .0415, 0, statorGroup,
      { emissive: PHASE_COLOUR[phase], emissiveIntensity: 0, metalness: .25, roughness: .5 });
    coil.rotation.z = a;
    for (const turn of [-.022, -.011, 0, .011, .022]) {               // visible turns
      const wire = boxAt(.021, .0022, .0045, 0x1b2430,
        Math.cos(a) * .0425, Math.sin(a) * .0425, turn, statorGroup);
      wire.rotation.z = a;
    }
    const liner = boxAt(.0022, .030, .074, 0xc8a06a,
      Math.cos(a) * .0415, Math.sin(a) * .0415, 0, statorGroup,
      { roughness: .85, metalness: .05 });
    liner.rotation.z = a;                                            // slot insulation

    // The classic dot and cross: which way the current is going in that coil.
    let dot = null, cross = null;
    if (withLabels) {
      dot = labelSprite(THREE, '⊙', '#e8eaed', .024 * labelScale);
      cross = labelSprite(THREE, '⊗', '#e8eaed', .024 * labelScale);
      for (const sprite of [dot, cross]) {
        sprite.position.set(Math.cos(a) * .0415, Math.sin(a) * .0415, .042);
        statorGroup.add(sprite);
      }
      const tag = labelSprite(THREE, PHASE_NAME[phase] + (sign > 0 ? '+' : '−'),
        '#' + PHASE_COLOUR[phase].toString(16).padStart(6, '0'), .028 * labelScale);
      tag.position.set(Math.cos(a) * .066, Math.sin(a) * .066, .046);
      statorGroup.add(tag);
    }
    // The glow that makes a lit coil look lit.
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowMap(THREE), color: PHASE_COLOUR[phase], transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.set(.055, .055, 1);
    glow.position.set(Math.cos(a) * .0415, Math.sin(a) * .0415, .03);
    statorGroup.add(glow);
    coils.push({ mesh: coil, phase, sign, angle: a, dot, cross, glow,
                 base: new THREE.Color(PHASE_COLOUR[phase]) });
  }
  for (const ez of [-.048, .048])                                     // end windings
    ringAt(.0455, .012, 0xb87333, ez, statorGroup, 32);
  // Three leads leaving the stator, which is all a motor cable ever is.
  for (let phase = 0; phase < 3; phase++) {
    const lead = boxAt(.004, .004, .05, PHASE_COLOUR[phase],
      -.052 + phase * .006, -.044, -.07, statorGroup);
    lead.material.emissive = new THREE.Color(PHASE_COLOUR[phase]);
    lead.material.emissiveIntensity = .25;
  }

  // ---- air-gap flux: where the stator is pulling, right now --------------------
  const fluxArrows = [];
  for (let k = 0; k < 12; k++) {
    const a = k / 12 * Math.PI * 2;
    const f = mesh(new THREE.ConeGeometry(.0045, .013, 10), 0x34d399, statorGroup,
      { emissive: 0x34d399, emissiveIntensity: .6, transparent: true, opacity: 0 });
    f.position.set(Math.cos(a) * .0345, Math.sin(a) * .0345, .02);
    f.rotation.z = -a - Math.PI / 2;
    fluxArrows.push({ mesh: f, angle: a });
  }

  // ---- the vectors --------------------------------------------------------------
  const dArrow = arrow(THREE, 0xef4444);
  const qArrow = arrow(THREE, 0x34d399);
  const estimateArrow = arrow(THREE, 0xf0b429);
  for (const a of [dArrow, qArrow, estimateArrow]) vectors.add(a);
  estimateArrow.visible = false;

  const quadMarker = new THREE.Group(); vectors.add(quadMarker);
  quadMarker.add(arcLine(THREE, .072, 0, Math.PI / 2, 0x34d399, 0));

  const angleGroup = new THREE.Group(); vectors.add(angleGroup);
  angleGroup.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(
      [new THREE.Vector3(0, 0, 0), new THREE.Vector3(.085, 0, 0)]),
    new THREE.LineBasicMaterial({ color: 0x5b6b7f })));
  let thetaArc = null;

  if (withLabels) {
    const dTag = labelSprite(THREE, 'd · magnets', '#ef4444', .062 * labelScale);
    dTag.position.set(0, .118, 0); dArrow.add(dTag);
    const qTag = labelSprite(THREE, 'q · stator field', '#34d399', .072 * labelScale);
    qTag.position.set(0, .118, 0); qArrow.add(qTag);
    const eTag = labelSprite(THREE, 'where it thinks', '#f0b429', .07 * labelScale);
    eTag.position.set(0, .118, 0); estimateArrow.add(eTag);
    const quadTag = labelSprite(THREE, '90°', '#34d399', .036 * labelScale);
    quadTag.position.set(.055, .055, 0); quadMarker.add(quadTag);
    const thetaTag = labelSprite(THREE, 'θe', '#f0b429', .03 * labelScale);
    thetaTag.position.set(.098, -.012, 0); angleGroup.add(thetaTag);
  }

  if (detailed) {
    // The housing comes off forward, so the stator is seen to live inside it.
    const housing = new THREE.Group();
    housing.userData.explode = .17;
    group.add(housing);
    const shell = ringAt(.056, .132, 0x8b97a6, 0, housing, 44,
      { transparent: true, opacity: .20, side: THREE.DoubleSide });
    shell.material.metalness = .6;
    for (let f = 0; f < 18; f++) {                                   // cooling fins
      const a = f / 18 * Math.PI * 2;
      const fin = boxAt(.006, .012, .12, 0x7d8896,
        Math.cos(a) * .059, Math.sin(a) * .059, 0, housing,
        { transparent: true, opacity: .45 });
      fin.rotation.z = a;
    }
    if (withLabels) {
      const tag = labelSprite(THREE, 'housing', '#8b97a6', .05 * labelScale);
      tag.position.set(0, .075, 0); housing.add(tag);
    }

    // The front cap and its bearing boss come off further forward still.
    const frontCap = new THREE.Group();
    frontCap.userData.explode = .25;
    group.add(frontCap);
    ringAt(.052, .012, 0x6c7787, 0, frontCap, 32);
    cylAt(.052, .010, 0x7d8896, -.004, frontCap, 32);
    cylAt(.021, .016, 0x6c7787, .012, frontCap, 20);                 // bearing boss
    cylAt(.0115, .018, 0x0d1117, .013, frontCap, 16);                // shaft hole
    for (let b = 0; b < 4; b++) {
      const a = Math.PI / 4 + b / 4 * Math.PI * 2;
      cylAt(.004, .006, 0x4e5866,
        .009, frontCap, 8).position.set(Math.cos(a) * .042, Math.sin(a) * .042, .009);
    }
    if (withLabels) {
      const tag = labelSprite(THREE, 'front cap and bearing', '#9aa5b1', .085 * labelScale);
      tag.position.set(0, .068, .012); frontCap.add(tag);
    }

    // A dashed centreline, the way an exploded drawing is always set out: it says
    // these pieces go back together along one axis, in this order.
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, -.30), new THREE.Vector3(0, 0, .34)]),
      new THREE.LineDashedMaterial({ color: 0x4a545f, dashSize: .012, gapSize: .01,
        transparent: true, opacity: .8 }));
    line.computeLineDistances();
    group.add(line);

    // N and S on the magnets, so the poles can be named while they turn.
    if (withLabels) {
      const north = labelSprite(THREE, 'N', '#ffffff', .03 * labelScale);
      north.position.set(0, .021, .052); rotorGroup.add(north);
      const south = labelSprite(THREE, 'S', '#ffffff', .03 * labelScale);
      south.position.set(0, -.021, .052); rotorGroup.add(south);

      // The air gap: a millimetre or so of nothing, and the reason the whole
      // machine has to be built accurately.
      const gap = labelSprite(THREE, 'air gap', '#6b7684', .05 * labelScale);
      gap.position.set(.058, .030, .048); statorGroup.add(gap);
      statorGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(.0335, .0335, .048), new THREE.Vector3(.050, .026, .048)]),
        new THREE.LineBasicMaterial({ color: 0x6b7684, transparent: true, opacity: .7 })));
    }
  }

  // ---- behaviour -----------------------------------------------------------------
  function setExplode(factor) {
    for (const child of group.children) {
      if (child.userData && child.userData.explode !== undefined) {
        child.position.z = child.userData.explode * factor;
      }
    }
  }

  const HOT = new THREE.Color(0xff5a2a);

  function update(state) {
    const { theta = 0, err = 0, amplitude = 1, showEstimate = false, heat = 0 } = state;
    const fieldAngle = theta + Math.PI / 2 + err;

    dArrow.rotation.z = theta;
    qArrow.rotation.z = fieldAngle;
    estimateArrow.rotation.z = theta + Math.PI / 2;
    estimateArrow.visible = showEstimate;
    quadMarker.rotation.z = theta;
    // Red when the current is so far off that it is fighting the magnets.
    const bad = Math.abs(err) > Math.PI / 3;
    qArrow.traverse(m => { if (m.material && m.material.emissive) m.material.color.setHex(bad ? 0xef4444 : 0x34d399); });

    // Copper that is working gets hot, and hot copper is not green. The coil
    // colour runs toward a dull orange as the loss climbs, which is the same
    // number the heat bars under the view are showing.
    const warmth = Math.min(Math.max(heat, 0), 1);
    for (const coil of coils) {
      const current = Math.cos(fieldAngle - coil.phase * 2 * Math.PI / 3) * amplitude;
      const lit = coil.sign * current;                 // this coil's own current
      coil.mesh.material.emissiveIntensity = Math.max(0, lit) * 1.6;
      coil.mesh.material.emissive.copy(coil.base).lerp(HOT, warmth * .85);
      coil.mesh.material.color.copy(coil.base).lerp(HOT, warmth * .55);
      coil.glow.material.opacity = Math.max(0, lit) * (.55 + .35 * warmth);
      coil.glow.material.color.copy(coil.base).lerp(HOT, warmth * .85);
      coil.glow.scale.setScalar(.05 + .022 * Math.max(0, lit) + .012 * warmth);
      if (coil.dot) {
        coil.dot.visible = lit > .02;
        coil.cross.visible = lit < -.02;
        coil.dot.material.opacity = Math.min(Math.abs(lit) * 1.6, 1);
        coil.cross.material.opacity = Math.min(Math.abs(lit) * 1.6, 1);
      }
    }
    for (const f of fluxArrows) {
      const pull = Math.cos(f.angle - fieldAngle) * amplitude;
      f.mesh.material.opacity = Math.min(Math.abs(pull), 1) * .9;
      f.mesh.scale.setScalar(.6 + Math.abs(pull) * .8);
      f.mesh.rotation.z = -f.angle - (pull >= 0 ? Math.PI / 2 : -Math.PI / 2);
    }

    const wrapped = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (thetaArc) { angleGroup.remove(thetaArc); thetaArc.geometry.dispose(); }
    thetaArc = arcLine(THREE, .062, 0, wrapped, 0xf0b429, 0);
    angleGroup.add(thetaArc);
  }

  update({ theta: 0 });
  return { group, rotorGroup, statorGroup, vectors, coils, setExplode, update };
}
