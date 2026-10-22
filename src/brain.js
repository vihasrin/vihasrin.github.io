// Interactive brain for the About section.
// Source for assets/brain.js. Rebuild after editing:
//   npx esbuild src/brain.js --bundle --minify --format=esm --outfile=assets/brain.js
// The page works without this file: the region list in index.html is the fallback.

import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Group,
  Mesh,
  IcosahedronGeometry,
  CylinderGeometry,
  BufferAttribute,
  ShaderMaterial,
  Raycaster,
  Vector2,
  Vector3,
  DoubleSide,
} from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Region ids. They match the data-region values on the buttons in index.html.
const PREFRONTAL = 1;
const MOTOR = 2;
const PARIETAL = 3;
const TEMPORAL = 4;
const OCCIPITAL = 5;
const CEREBELLUM = 6;
const STEM = 7;

// ---------------------------------------------------------------------------
// Math helpers

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

function smooth(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function bell(x, mid, width) {
  const d = (x - mid) / width;
  return Math.exp(-d * d);
}

// 3D simplex noise. This is a line-for-line port of the GLSL version in the
// fragment shader below (Ashima Arts / Stefan Gustavson, MIT), so the grooves
// carved into the mesh here line up with the lines the shader draws.
function mod289(x) {
  return x - Math.floor(x / 289) * 289;
}
function permute(x) {
  return mod289((x * 34 + 1) * x);
}
function stepf(edge, x) {
  return x < edge ? 0 : 1;
}

function snoise(vx, vy, vz) {
  const s = (vx + vy + vz) / 3;
  let ix = Math.floor(vx + s);
  let iy = Math.floor(vy + s);
  let iz = Math.floor(vz + s);
  const t = (ix + iy + iz) / 6;
  const x0 = vx - ix + t;
  const y0 = vy - iy + t;
  const z0 = vz - iz + t;

  const gx = stepf(y0, x0);
  const gy = stepf(z0, y0);
  const gz = stepf(x0, z0);
  const i1x = Math.min(gx, 1 - gz);
  const i1y = Math.min(gy, 1 - gx);
  const i1z = Math.min(gz, 1 - gy);
  const i2x = Math.max(gx, 1 - gz);
  const i2y = Math.max(gy, 1 - gx);
  const i2z = Math.max(gz, 1 - gy);

  ix = mod289(ix);
  iy = mod289(iy);
  iz = mod289(iz);

  // Corner offsets: 0, i1, i2, 1
  return 42 * (
    corner(x0, y0, z0, ix, iy, iz) +
    corner(x0 - i1x + 1 / 6, y0 - i1y + 1 / 6, z0 - i1z + 1 / 6, ix + i1x, iy + i1y, iz + i1z) +
    corner(x0 - i2x + 1 / 3, y0 - i2y + 1 / 3, z0 - i2z + 1 / 3, ix + i2x, iy + i2y, iz + i2z) +
    corner(x0 - 0.5, y0 - 0.5, z0 - 0.5, ix + 1, iy + 1, iz + 1)
  );
}

// One corner of the simplex: hash the lattice point the same way the shader
// does, turn the hash into a gradient, and weight it by distance.
function corner(x, y, z, cx, cy, cz) {
  let m = 0.6 - (x * x + y * y + z * z);
  if (m <= 0) return 0;
  const p = permute(permute(permute(cz) + cy) + cx);
  const ns = 1 / 7;
  const j = p - 49 * Math.floor(p * ns * ns);
  const xq = Math.floor(j * ns);
  const yq = Math.floor(j - 7 * xq);
  let gxv = xq * (2 / 7) + (0.5 / 7 - 1);
  let gyv = yq * (2 / 7) + (0.5 / 7 - 1);
  const h = 1 - Math.abs(gxv) - Math.abs(gyv);
  if (h <= 0) {
    gxv -= Math.floor(gxv) * 2 + 1;
    gyv -= Math.floor(gyv) * 2 + 1;
  }
  const norm = 1.79284291400159 - 0.85373472095314 * (gxv * gxv + gyv * gyv + h * h);
  m *= m;
  return m * m * norm * (gxv * x + gyv * y + h * z);
}

// ---------------------------------------------------------------------------
// Brain shape. Object space: +x is the right side, +y is up, +z is the front.
// The same landmarks are repeated in GLSL below; keep the two in step.

function sylvianY(z) {
  return -0.07 + (0.42 - z) * 0.3;
}

function centralZ(y) {
  return 0.04 - 0.22 * y;
}

function cerebrumRegion(x, y, z) {
  const side = x - 0.03;
  if (z < -0.56 + 0.12 * y) return OCCIPITAL;
  if (y < sylvianY(z) && z < 0.58 && side > 0.12) return TEMPORAL;
  const zc = centralZ(y);
  if (z > zc + 0.17) return PREFRONTAL;
  if (z > zc) return MOTOR;
  return PARIETAL;
}

// Folds follow the zero lines of a noise field. The field is warped a little so
// the grooves meander instead of closing into small rings.
const FOLD_SCALE = 3.7;
const WARP = 0.6;

function foldPoint(x, y, z, seed, out) {
  const px = x * FOLD_SCALE + seed;
  const py = y * FOLD_SCALE * 1.2;
  const pz = z * FOLD_SCALE;
  out[0] = px + WARP * snoise(px * 0.45 + 11.3, py * 0.45, pz * 0.45);
  out[1] = py + WARP * snoise(px * 0.45, py * 0.45 + 4.1, pz * 0.45 - 7.7);
  out[2] = pz + WARP * snoise(px * 0.45 - 3.9, py * 0.45, pz * 0.45 + 2.6);
  return out;
}

// Attributes shared by every part:
//   aPos0  position before the folds were carved (used for region edges and fissures)
//   aFold  where to sample the fold noise
//   aMeta  (kind, fissure weight, central sulcus weight, fold weight)
//          kind: 0 cerebrum, 6 cerebellum, 7 brain stem
//   aRegion region id per vertex, used for hit testing
function addAttributes(geo, pos0, fold, meta, regions) {
  geo.setAttribute('aPos0', new BufferAttribute(pos0, 3));
  geo.setAttribute('aFold', new BufferAttribute(fold, 3));
  geo.setAttribute('aMeta', new BufferAttribute(meta, 4));
  geo.setAttribute('aRegion', new BufferAttribute(regions, 1));
}

// One hemisphere, built as the right one. The left one is mirrored with
// mesh.scale.x = -1 and uses a different seed, so the folds are not identical.
// An evenly tessellated unit sphere. Even triangles matter here: a UV sphere
// stretches into slivers where the temporal lobe bends and the folds shade as a sawtooth.
function icosphere(detail) {
  const raw = new IcosahedronGeometry(1, detail);
  raw.deleteAttribute('normal');
  raw.deleteAttribute('uv');
  return mergeVertices(raw, 1e-5);
}

function hemisphere(seed, detail, carve) {
  const geo = icosphere(detail);
  const pos = geo.attributes.position;
  const count = pos.count;
  const pos0 = new Float32Array(count * 3);
  const fold = new Float32Array(count * 3);
  const meta = new Float32Array(count * 4);
  const regions = new Float32Array(count);
  const dir = new Vector3();
  const fp = [0, 0, 0];

  for (let i = 0; i < count; i++) {
    const sx = pos.getX(i);
    const sy = pos.getY(i);
    const sz = pos.getZ(i);

    // Base ellipsoid with a flat inner wall, leaving a gap at the midline.
    const outward = Math.max(sx, 0);
    let x = 0.03 + outward * 0.7 + Math.min(sx, 0) * 0.02;
    let z = sz * 0.88;
    let y;
    if (sy > 0) {
      y = sy * 0.62 * (1 - 0.1 * sz * sz);
    } else {
      y = sy * 0.3;
      // The underside of the frontal lobe rises toward the front.
      y += 0.12 * smooth(0.35, 0.95, sz) * -sy;
    }

    // The back narrows into the occipital pole.
    const back = smooth(-0.45, -1.0, sz);
    x = 0.03 + (x - 0.03) * (1 - 0.24 * back);
    y *= 1 - 0.12 * back;

    // The temporal lobe hangs below the lateral fissure.
    const temporal = bell(sz, 0.08, 0.38) * smooth(0.15, -0.7, sy) * smooth(0.1, 0.75, sx);
    y -= 0.27 * temporal;
    x += 0.06 * temporal;

    pos0[i * 3] = x;
    pos0[i * 3 + 1] = y;
    pos0[i * 3 + 2] = z;
    regions[i] = cerebrumRegion(x, y, z);

    const side = x - 0.03;
    const ds = y - sylvianY(z);
    const dc = z - centralZ(y);
    const wSylvian = smooth(0.18, 0.4, side) * smooth(-0.45, -0.3, z) * smooth(0.66, 0.54, z);
    const wCentral = smooth(0.0, 0.06, ds) * smooth(-0.15, 0.05, sy) * smooth(-0.15, 0.05, sx);
    // No fold lines on the inner wall, which only shows through the gap.
    const wFold = smooth(-0.45, -0.25, sx);

    foldPoint(x, y, z, seed, fp);
    fold[i * 3] = fp[0];
    fold[i * 3 + 1] = fp[1];
    fold[i * 3 + 2] = fp[2];
    meta[i * 4] = 0;
    meta[i * 4 + 1] = wSylvian * wFold;
    meta[i * 4 + 2] = wCentral * wFold;
    meta[i * 4 + 3] = wFold;

    if (carve) {
      const f = snoise(fp[0], fp[1], fp[2]);
      const bump = snoise(fp[0] * 2.3, fp[1] * 2.3, fp[2] * 2.3);
      let d =
        -0.03 * Math.exp(-((f / 0.2) ** 2)) +
        0.006 * bump -
        0.05 * wSylvian * Math.exp(-((ds / 0.05) ** 2)) -
        0.032 * wCentral * Math.exp(-((dc / 0.035) ** 2));
      d *= 0.25 + 0.75 * wFold;
      // Push along the approximate surface normal of the ellipsoid.
      dir.set(side / 0.49, y / (y > 0 ? 0.38 : 0.12), z / 0.77).normalize();
      x += dir.x * d;
      y += dir.y * d;
      z += dir.z * d;
    }
    pos.setXYZ(i, x, y, z);
  }

  geo.computeVertexNormals();
  addAttributes(geo, pos0, fold, meta, regions);
  return geo;
}

function cerebellumBand(sx, sy, sz) {
  return Math.sin(sy * 22 + snoise(sx * 2.2, sy * 2.2, sz * 2.2) * 1.6 + Math.abs(sx) * 1.5);
}

function cerebellum(detail, carve) {
  const geo = icosphere(detail);
  const pos = geo.attributes.position;
  const count = pos.count;
  const pos0 = new Float32Array(count * 3);
  const fold = new Float32Array(count * 3);
  const meta = new Float32Array(count * 4);
  const regions = new Float32Array(count).fill(CEREBELLUM);
  const dir = new Vector3();

  for (let i = 0; i < count; i++) {
    const sx = pos.getX(i);
    const sy = pos.getY(i);
    const sz = pos.getZ(i);
    let x = sx * 0.5;
    let y = sy * 0.19;
    let z = sz * 0.27;
    // A shallow groove down the middle (the vermis).
    y -= 0.035 * Math.exp(-((x / 0.07) ** 2)) * Math.max(sy, 0);
    pos0[i * 3] = x;
    pos0[i * 3 + 1] = y;
    pos0[i * 3 + 2] = z;
    fold[i * 3] = sx;
    fold[i * 3 + 1] = sy;
    fold[i * 3 + 2] = sz;
    meta[i * 4] = CEREBELLUM;
    meta[i * 4 + 3] = 1;

    if (carve) {
      const band = cerebellumBand(sx, sy, sz);
      const d = -0.01 * Math.exp(-((band / 0.3) ** 2));
      dir.set(x, y * 4, z * 2).normalize();
      x += dir.x * d;
      y += dir.y * d;
      z += dir.z * d;
    }
    pos.setXYZ(i, x, y, z);
  }

  geo.computeVertexNormals();
  addAttributes(geo, pos0, fold, meta, regions);
  return geo;
}

function brainStem() {
  const geo = new CylinderGeometry(0.095, 0.068, 0.5, 48, 16, true);
  const pos = geo.attributes.position;
  const count = pos.count;
  const pos0 = new Float32Array(count * 3);
  const fold = new Float32Array(count * 3);
  const meta = new Float32Array(count * 4);
  const regions = new Float32Array(count).fill(STEM);

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // The pons bulges forward near the top.
    const pons = 1 + 0.3 * bell(y, 0.1, 0.1) * (z > 0 ? 1 : 0.35);
    pos.setXYZ(i, x * pons, y, z * pons);
    pos0[i * 3] = x;
    pos0[i * 3 + 1] = y;
    pos0[i * 3 + 2] = z;
    fold[i * 3] = Math.atan2(z, x);
    fold[i * 3 + 1] = y;
    meta[i * 4] = STEM;
    meta[i * 4 + 3] = 1;
  }

  geo.computeVertexNormals();
  addAttributes(geo, pos0, fold, meta, regions);
  return geo;
}

// ---------------------------------------------------------------------------
// Shading: grayscale like a plaster study, with ink lines in the folds.
// The highlighted region turns to ink and its lines go pale.

const vertexShader = /* glsl */ `
  attribute vec3 aPos0;
  attribute vec3 aFold;
  attribute vec4 aMeta;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos0;
  varying vec3 vFold;
  varying vec4 vMeta;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    vNormal = normalize(normalMatrix * normal);
    vPos0 = aPos0;
    vFold = aFold;
    vMeta = aMeta;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uHi;
  uniform float uRegion;
  uniform float uPx;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos0;
  varying vec3 vFold;
  varying vec4 vMeta;

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0)) +
      i.y + vec4(0.0, i1.y, i2.y, 1.0)) +
      i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }

  float sylvianY(float z) { return -0.07 + (0.42 - z) * 0.3; }
  float centralZ(float y) { return 0.04 - 0.22 * y; }

  float cerebrumRegion(vec3 p) {
    float side = p.x - 0.03;
    if (p.z < -0.56 + 0.12 * p.y) return 5.0;
    if (p.y < sylvianY(p.z) && p.z < 0.58 && side > 0.12) return 4.0;
    float zc = centralZ(p.y);
    if (p.z > zc + 0.17) return 1.0;
    if (p.z > zc) return 2.0;
    return 3.0;
  }

  float inkLine(float v, float halfWidth) {
    float d = abs(v) / max(fwidth(v), 1e-5);
    return 1.0 - smoothstep(halfWidth, halfWidth + 1.0, d);
  }

  void main() {
    float kind = vMeta.x;
    float region;
    float line = 0.0;
    float crease = 0.0;

    if (kind < 0.5) {
      region = cerebrumRegion(vPos0);
      float f = snoise(vFold);
      float ds = (vPos0.y - sylvianY(vPos0.z)) * 6.0;
      float dc = (vPos0.z - centralZ(vPos0.y)) * 6.0;
      line = max(inkLine(f, 0.5 * uPx) * vMeta.w,
             max(inkLine(ds, 0.95 * uPx) * vMeta.y, inkLine(dc, 0.8 * uPx) * vMeta.z));
      crease = exp(-pow(f / 0.22, 2.0)) * vMeta.w;
    } else if (kind < 6.5) {
      region = 6.0;
      vec3 s = vFold;
      float band = sin(s.y * 22.0 + snoise(s * 2.2) * 1.6 + abs(s.x) * 1.5) * 0.5;
      line = inkLine(band, 0.45 * uPx) * 0.85;
      crease = exp(-pow(band / 0.2, 2.0)) * 0.6;
    } else {
      region = 7.0;
      line = inkLine(sin(vFold.x * 5.0) * 0.2, 0.35 * uPx) * 0.25;
    }

    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(vView);
    vec3 light = normalize(vec3(-0.45, 0.75, 0.55));
    float lit = clamp(dot(n, light), 0.0, 1.0);
    float rim = 1.0 - clamp(dot(n, v), 0.0, 1.0);

    float shade = mix(0.56, 1.0, pow(lit, 0.8));
    shade *= 1.0 - 0.3 * rim * rim;
    shade *= 1.0 - 0.14 * crease;

    float hi = (abs(region - uRegion) < 0.5 ? 1.0 : 0.0) * uHi;
    vec3 paper = vec3(shade);
    vec3 dark = vec3(0.07 + 0.17 * lit) * (1.0 - 0.25 * crease);
    vec3 base = mix(paper, dark, hi);
    vec3 ink = mix(vec3(0.14), vec3(0.88), hi);
    vec3 color = mix(base, ink, line * mix(0.62, 0.5, hi));
    gl_FragColor = vec4(color, 1.0);
  }
`;

// ---------------------------------------------------------------------------

const CAMERA_Z = 3.7;

function init(root) {
  const stage = root.querySelector('.brain-stage');
  const canvas = root.querySelector('.brain-canvas');
  const panel = root.querySelector('.brain-panel');
  const nameEl = panel.querySelector('.brain-name');
  const roleEl = panel.querySelector('.brain-role');
  const detailEl = panel.querySelector('.brain-detail');
  const leader = root.querySelector('.brain-leader');
  const leaderPath = leader.querySelector('path');
  const leaderDot = leader.querySelector('circle');
  const buttons = Array.from(root.querySelectorAll('[data-region]'));

  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch (err) {
    root.classList.add('brain-fallback');
    return;
  }
  renderer.setClearColor(0xffffff, 0);
  root.classList.add('brain-ready');

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wide = window.matchMedia('(min-width: 860px)');

  // Copy for each region comes straight from the buttons in the HTML.
  const copy = {};
  for (const button of buttons) {
    copy[button.dataset.region] = {
      name: button.querySelector('.r-name').textContent,
      role: button.querySelector('.r-role').textContent,
      detail: button.querySelector('.r-detail').textContent,
    };
  }
  const defaultCopy = {
    name: nameEl.textContent,
    role: roleEl.textContent,
    detail: detailEl.textContent,
  };

  const scene = new Scene();
  const camera = new PerspectiveCamera(27, 4 / 3, 0.1, 20);
  camera.position.set(0, 0.05, CAMERA_Z);
  camera.lookAt(0, -0.14, 0);

  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uHi: { value: 0 },
      uRegion: { value: 0 },
      uPx: { value: 1 },
    },
  });

  const brain = new Group();
  brain.position.x = 0.05;
  scene.add(brain);

  // Visible meshes, plus simpler copies used only for hit testing.
  const right = new Mesh(hemisphere(0, 72, true), material);
  const left = new Mesh(hemisphere(7.3, 72, true), material);
  left.scale.x = -1;
  const cereb = new Mesh(cerebellum(40, true), material);
  cereb.position.set(0, -0.31, -0.56);
  const stem = new Mesh(brainStem(), material);
  stem.position.set(0, -0.55, -0.24);
  stem.rotation.x = 0.32;
  brain.add(right, left, cereb, stem);

  const hitMaterial = material.clone();
  // Hit tests run on both faces so the mirrored left half is found too.
  hitMaterial.side = DoubleSide;
  const hitRight = new Mesh(hemisphere(0, 18, false), hitMaterial);
  const hitLeft = new Mesh(hitRight.geometry, hitMaterial);
  hitLeft.scale.x = -1;
  const hitCereb = new Mesh(cerebellum(12, false), hitMaterial);
  hitCereb.position.copy(cereb.position);
  for (const m of [hitRight, hitLeft, hitCereb]) {
    m.visible = false;
    brain.add(m);
  }
  const hitTargets = [hitRight, hitLeft, hitCereb, stem];

  // A point on the right side of each region where the callout line lands.
  const anchors = {};
  {
    const sums = {};
    const tmp = new Vector3();
    for (const mesh of [right, cereb, stem]) {
      mesh.updateMatrix();
      const p = mesh.geometry.attributes.position;
      const r = mesh.geometry.attributes.aRegion;
      for (let i = 0; i < p.count; i += 3) {
        tmp.fromBufferAttribute(p, i).applyMatrix4(mesh.matrix);
        if (tmp.x < 0.12 && mesh !== stem) continue;
        const id = r.getX(i);
        const s = sums[id] || (sums[id] = { v: new Vector3(), n: 0, pts: [] });
        s.v.add(tmp);
        s.n += 1;
        s.pts.push(tmp.clone());
      }
    }
    for (const id of Object.keys(sums)) {
      const s = sums[id];
      const mid = s.v.divideScalar(s.n);
      let best = s.pts[0];
      let bestScore = Infinity;
      for (const pt of s.pts) {
        // Close to the middle of the region, and toward the outside.
        const score = pt.distanceToSquared(mid) - 0.08 * pt.x;
        if (score < bestScore) {
          bestScore = score;
          best = pt;
        }
      }
      anchors[id] = best;
    }
  }

  // --- State
  let hoverRegion = 0;
  let pinnedRegion = 0;
  let listRegion = 0;
  let shownRegion = 0;
  let hiAmount = 0;
  let hoverPoint = null;
  let swayTime = 0;
  let yawOffset = 0;
  let pitch = 0.1;
  let dragging = false;
  let dragMoved = 0;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartYaw = 0;
  let dragStartPitch = 0;
  let pointer = null;
  let running = false;
  let lastTime = 0;
  let panelRegion = -1;

  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const tmpV = new Vector3();

  function targetRegion() {
    return hoverRegion || listRegion || pinnedRegion;
  }

  function updatePanel(id) {
    if (id === panelRegion) return;
    panelRegion = id;
    const c = id ? copy[id] : defaultCopy;
    panel.classList.toggle('is-active', Boolean(id));
    panel.classList.remove('is-swap');
    void panel.offsetWidth;
    panel.classList.add('is-swap');
    nameEl.textContent = c.name;
    roleEl.textContent = c.role;
    detailEl.textContent = c.detail;
    for (const button of buttons) {
      const bid = Number(button.dataset.region);
      button.classList.toggle('is-on', bid === id);
      button.setAttribute('aria-pressed', String(bid === pinnedRegion));
    }
  }

  function pick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(hitTargets, false);
    if (!hits.length) return null;
    const hit = hits[0];
    const id = hit.object.geometry.attributes.aRegion.getX(hit.face.a);
    return { id, point: brain.worldToLocal(hit.point.clone()) };
  }

  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Pull back on narrow, tall stages so the whole brain stays in frame.
    const aspect = w / h;
    camera.position.z = aspect < 1.3 ? CAMERA_Z * Math.min(1.45, 1.3 / aspect) : CAMERA_Z;
    camera.updateProjectionMatrix();
    material.uniforms.uPx.value = dpr;
  }

  function drawLeader(id) {
    if (!id) {
      leader.classList.remove('is-on');
      return;
    }
    const local = hoverRegion && hoverPoint ? hoverPoint : anchors[id];
    if (!local) return;
    tmpV.copy(local);
    brain.localToWorld(tmpV);
    tmpV.project(camera);
    const rootRect = root.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const x = stageRect.left - rootRect.left + ((tmpV.x + 1) / 2) * stageRect.width;
    const y = stageRect.top - rootRect.top + ((1 - tmpV.y) / 2) * stageRect.height;
    leaderDot.setAttribute('cx', x.toFixed(1));
    leaderDot.setAttribute('cy', y.toFixed(1));
    if (wide.matches) {
      const nameRect = nameEl.getBoundingClientRect();
      const endX = nameRect.left - rootRect.left - 18;
      const endY = nameRect.top - rootRect.top + nameRect.height * 0.55;
      const elbowX = Math.max(x + 24, endX - 48);
      leaderPath.setAttribute('d', `M${x.toFixed(1)} ${y.toFixed(1)} L${elbowX.toFixed(1)} ${endY.toFixed(1)} L${endX.toFixed(1)} ${endY.toFixed(1)}`);
    } else {
      leaderPath.setAttribute('d', '');
    }
    leader.classList.add('is-on');
  }

  function frame(time) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (time - lastTime) / 1000 || 0);
    lastTime = time;

    if (pointer && !dragging) {
      const hit = pick(pointer.x, pointer.y);
      hoverRegion = hit ? hit.id : 0;
      hoverPoint = hit ? hit.point : null;
      canvas.style.cursor = hit ? 'pointer' : 'grab';
      pointer = null;
    }

    const target = targetRegion();
    updatePanel(target);

    // Fade the old highlight out before switching to the new region.
    if (shownRegion !== target) {
      hiAmount = reduceMotion ? 0 : Math.max(0, hiAmount - dt * 9);
      if (hiAmount === 0) {
        shownRegion = target;
        material.uniforms.uRegion.value = shownRegion;
      }
    } else if (shownRegion) {
      hiAmount = reduceMotion ? 1 : Math.min(1, hiAmount + dt * 6);
    }
    material.uniforms.uHi.value = hiAmount * hiAmount * (3 - 2 * hiAmount);

    // Slow sway, paused while someone is looking at a region.
    if (!reduceMotion && !hoverRegion && !dragging) swayTime += dt;
    const sway = reduceMotion ? 0 : 0.34 * Math.sin(swayTime * 0.32);
    brain.rotation.y = -Math.PI / 2 + 0.42 + sway + yawOffset;
    brain.rotation.x = pitch;
    brain.position.y = reduceMotion ? 0 : 0.012 * Math.sin(swayTime * 0.7);

    renderer.render(scene, camera);
    drawLeader(shownRegion && hiAmount > 0.05 ? shownRegion : 0);
  }

  function start() {
    if (running) return;
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
  }

  // --- Events
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      dragMoved = Math.max(dragMoved, Math.abs(dx) + Math.abs(dy));
      yawOffset = dragStartYaw + dx * 0.008;
      pitch = Math.min(0.55, Math.max(-0.35, dragStartPitch + dy * 0.004));
      return;
    }
    if (e.pointerType === 'mouse') pointer = { x: e.clientX, y: e.clientY };
  });

  canvas.addEventListener('pointerleave', () => {
    pointer = null;
    if (!dragging) {
      hoverRegion = 0;
      hoverPoint = null;
    }
  });

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    dragMoved = 0;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartYaw = yawOffset;
    dragStartPitch = pitch;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    canvas.style.cursor = 'grab';
    if (dragMoved < 6) {
      // A click or tap pins a region, or unpins it.
      const hit = pick(e.clientX, e.clientY);
      const id = hit ? hit.id : 0;
      pinnedRegion = id && id !== pinnedRegion ? id : 0;
      panelRegion = -1;
      if (e.pointerType !== 'mouse') {
        hoverRegion = 0;
        hoverPoint = pinnedRegion && hit ? hit.point : null;
      }
    }
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  for (const button of buttons) {
    const id = Number(button.dataset.region);
    button.addEventListener('mouseenter', () => { listRegion = id; });
    button.addEventListener('mouseleave', () => { listRegion = 0; });
    button.addEventListener('focus', () => { listRegion = id; });
    button.addEventListener('blur', () => { listRegion = 0; });
    button.addEventListener('click', () => {
      pinnedRegion = pinnedRegion === id ? 0 : id;
      hoverPoint = null;
      panelRegion = -1;
    });
  }

  new ResizeObserver(resize).observe(stage);
  resize();

  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && !document.hidden) start();
      else stop();
    }
  }, { rootMargin: '120px' });
  io.observe(stage);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (stage.getBoundingClientRect().top < window.innerHeight) start();
  });

  // Draw once right away so the stage is never blank.
  renderer.render(scene, camera);
}

const root = document.querySelector('[data-brain]');
if (root) init(root);
