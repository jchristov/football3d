import * as THREE from 'three';
import { PITCH, GOAL, MATCH } from './constants.js';

const rand = (a, b) => a + Math.random() * (b - a);

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Pitch markings for the current pitch. The painted area is the pitch plus a 5 m run-off all round.
export const RUNOFF = 5;
function pitchTexture() {
  const S = PITCH.s, W = PITCH.hl * 2 + RUNOFF * 2, H = PITCH.hw * 2 + RUNOFF * 2;
  const PPM = Math.min(32, 3072 / W); // keep the canvas below ~3000 px for the big pitches
  return canvasTex(Math.round(W * PPM), Math.round(H * PPM), (g, w, h) => {
    const X = (x) => (x + W / 2) * PPM, Z = (z) => (z + H / 2) * PPM;
    // mowing stripes
    const stripes = Math.ceil(W / 5);
    for (let i = 0; i < stripes; i++) {
      g.fillStyle = i % 2 ? '#2f8f3f' : '#2a8138';
      g.fillRect(X(-W / 2 + i * 5), 0, 5 * PPM + 1, h);
    }
    // run-off area
    g.fillStyle = 'rgba(20,60,30,.35)';
    g.fillRect(0, 0, w, Z(-PITCH.hw));
    g.fillRect(0, Z(PITCH.hw), w, h - Z(PITCH.hw));
    g.fillRect(0, 0, X(-PITCH.hl), h);
    g.fillRect(X(PITCH.hl), 0, w - X(PITCH.hl), h);

    g.strokeStyle = '#f4fff4';
    g.fillStyle = '#f4fff4';
    g.lineWidth = 4;
    g.strokeRect(X(-PITCH.hl), Z(-PITCH.hw), PITCH.hl * 2 * PPM, PITCH.hw * 2 * PPM);
    g.beginPath(); g.moveTo(X(0), Z(-PITCH.hw)); g.lineTo(X(0), Z(PITCH.hw)); g.stroke();
    g.beginPath(); g.arc(X(0), Z(0), 4.5 * S * PPM, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(X(0), Z(0), 0.25 * PPM, 0, Math.PI * 2); g.fill();
    for (const s of [-1, 1]) {
      const gx = s * PITCH.hl;
      const bd = 6 * S, bw = 7 * S, gd = 2.4 * S, gw = 4.2 * S, sp = 4.5 * S;
      g.strokeRect(s < 0 ? X(gx) : X(gx - bd), Z(-bw), bd * PPM, bw * 2 * PPM);
      g.strokeRect(s < 0 ? X(gx) : X(gx - gd), Z(-gw), gd * PPM, gw * 2 * PPM);
      g.beginPath(); g.arc(X(gx - s * sp), Z(0), 0.2 * PPM, 0, Math.PI * 2); g.fill();
      g.beginPath();
      const ang = Math.acos(Math.min(1, (bd - sp) / (4 * S))); // the arc outside the box
      g.arc(X(gx - s * sp), Z(0), 4 * S * PPM, s < 0 ? -ang : Math.PI - ang, s < 0 ? ang : Math.PI + ang);
      g.stroke();
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const a0 = sx < 0 ? (sz < 0 ? 0 : -Math.PI / 2) : (sz < 0 ? Math.PI / 2 : Math.PI);
      g.beginPath(); g.arc(X(sx * PITCH.hl), Z(sz * PITCH.hw), 1 * PPM, a0, a0 + Math.PI / 2); g.stroke();
    }
  });
}

// Stadium looks: stands, crowd colours and advertising boards
export const STADIUM_LOOKS = {
  arena: {
    label: 'Arena', concrete: 0x3a4152, crowd: [0xe4002b, 0x1e6bff, 0xffffff, 0xffd21e, 0x222222, 0x14b85a, 0xff8a00, 0x9b4dff],
    ads: [['TURBO COLA', '#e4002b'], ['FOOTBALL 3D', '#0a3d91'], ['KICKSTART', '#ff9f00'], ['GOALTECH', '#00a86b'], ['SUPER STRIKE', '#6a1b9a']],
  },
  classic: {
    label: 'Classic', concrete: 0x7a6a58, crowd: [0xb22222, 0xf2ece0, 0xb22222, 0xf2ece0, 0x2b3a67, 0xd8b04a, 0x1d1d1d],
    ads: [['BRAUEREI', '#7a1f1f'], ['STADTWERKE', '#1d3b6e'], ['SPARKASSE', '#b8921a'], ['FUSSBALL', '#2e6b3a'], ['KICKER', '#4a4a4a']],
  },
  neon: {
    label: 'Neon', concrete: 0x171a30, crowd: [0x00e5ff, 0xff2bd6, 0xffffff, 0x7c4dff, 0x39ff14, 0x111111, 0xffee00],
    ads: [['NEON LEAGUE', '#c2188f'], ['CYBER COLA', '#00899e'], ['HYPERBOOST', '#5b2fd6'], ['VOLT', '#1f9a0a'], ['PIXEL', '#d85a00']],
  },
};
let LOOK = STADIUM_LOOKS.arena;

function boardTexture() {
  const ads = LOOK.ads;
  return canvasTex(2560, 128, (g, w, h) => {
    const cw = w / ads.length;
    ads.forEach(([t, c], i) => {
      g.fillStyle = c; g.fillRect(i * cw, 0, cw, h);
      g.fillStyle = '#fff'; g.font = 'italic 900 78px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(t, i * cw + cw / 2, h / 2 + 4);
    });
  });
}

function netTexture() {
  return canvasTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 3;
    g.strokeRect(0, 0, w, h);
  });
}

function buildGoal(sign) {
  const grp = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
  const mk = (geo, x, y, z, rot) => {
    const m = new THREE.Mesh(geo, white);
    m.position.set(x, y, z);
    if (rot) m.rotation.set(...rot);
    m.castShadow = true;
    grp.add(m);
  };
  const r = 0.07, hl = PITCH.hl, { hw, h, d } = GOAL;
  for (const z of [-hw, hw]) {
    mk(new THREE.CylinderGeometry(r, r, h, 10), hl, h / 2, z);
    mk(new THREE.CylinderGeometry(r * 0.8, r * 0.8, h, 8), hl + d, h / 2, z);
    mk(new THREE.CylinderGeometry(r * 0.7, r * 0.7, d, 8), hl + d / 2, h, z, [0, 0, Math.PI / 2]);
  }
  mk(new THREE.CylinderGeometry(r, r, hw * 2 + r * 2, 10), hl, h, 0, [Math.PI / 2, 0, 0]);
  mk(new THREE.CylinderGeometry(r * 0.8, r * 0.8, hw * 2, 8), hl + d, h, 0, [Math.PI / 2, 0, 0]);

  const tex = netTexture();
  const net = (w, hh, rx, ry) => {
    const t = tex.clone(); t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(w / 0.35, hh / 0.35);
    return new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.8 });
  };
  const back = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, h), net(hw * 2, h));
  back.position.set(hl + d, h / 2, 0); back.rotation.y = Math.PI / 2; grp.add(back);
  for (const z of [-hw, hw]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(d, h), net(d, h));
    s.position.set(hl + d / 2, h / 2, z); grp.add(s);
  }
  const top = new THREE.Mesh(new THREE.PlaneGeometry(d, hw * 2), net(d, hw * 2));
  top.position.set(hl + d / 2, h, 0); top.rotation.x = Math.PI / 2; grp.add(top);

  if (sign < 0) grp.scale.x = -1;
  return grp;
}

function buildCrowd(scene) {
  const rows = 10, step = 1.15;
  const stands = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: LOOK.concrete, roughness: 0.9 });
  const spots = [];

  const longLen = PITCH.hl * 2 + 22, endLen = PITCH.hw * 2 + 4;
  for (const s of [-1, 1]) {
    for (let r = 0; r < rows; r++) {
      const baseY = 0.7 + r * 0.85;
      const z = s * (PITCH.hw + 3.8 + r * step);
      const m = new THREE.Mesh(new THREE.BoxGeometry(longLen, baseY, step), concrete);
      m.position.set(0, baseY / 2, z); m.receiveShadow = true; stands.add(m);
      for (let x = -longLen / 2 + 1; x < longLen / 2 - 0.5; x += 0.85) spots.push([x + rand(-0.1, 0.1), baseY, z, 0]);

      const ex = s * (PITCH.hl + 6 + r * step);
      const e = new THREE.Mesh(new THREE.BoxGeometry(step, baseY, endLen), concrete);
      e.position.set(ex, baseY / 2, 0); e.receiveShadow = true; stands.add(e);
      for (let zz = -endLen / 2 + 1; zz < endLen / 2 - 0.5; zz += 0.85) spots.push([ex, baseY, zz + rand(-0.1, 0.1), Math.PI / 2]);
    }
  }
  scene.add(stands);

  const geo = new THREE.BoxGeometry(0.5, 0.85, 0.4);
  const mat = new THREE.MeshLambertMaterial();
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  const palette = LOOK.crowd;
  const col = new THREE.Color();
  const dummy = new THREE.Object3D();
  const phase = new Float32Array(spots.length);
  spots.forEach((sp, i) => {
    col.setHex(palette[Math.floor(Math.random() * palette.length)]);
    col.offsetHSL(0, 0, rand(-0.08, 0.08));
    mesh.setColorAt(i, col);
    phase[i] = Math.random() * 6.28;
    dummy.position.set(sp[0], sp[1] + 0.42, sp[2]);
    dummy.rotation.y = sp[3];
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  scene.add(mesh);

  let wasActive = false;
  return {
    mesh, stands, geo, mat, concrete,
    update(t, excite) {
      const active = excite > 0.02;
      if (!active && !wasActive) return;
      wasActive = active;
      for (let i = 0; i < spots.length; i++) {
        const sp = spots[i];
        const j = active ? Math.abs(Math.sin(t * 9 + phase[i])) * 0.5 * excite : 0;
        dummy.position.set(sp[0], sp[1] + 0.42 + j, sp[2]);
        dummy.rotation.y = sp[3];
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

function buildConfetti(scene) {
  const N = 400;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), vel = new Float32Array(N * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.3, vertexColors: true, depthWrite: false }));
  pts.frustumCulled = false;
  pts.visible = false;
  scene.add(pts);
  let life = 0;
  const c = new THREE.Color();
  return {
    burst(x, z) {
      life = 4;
      pts.visible = true;
      for (let i = 0; i < N; i++) {
        pos[i * 3] = x + rand(-3, 3); pos[i * 3 + 1] = rand(1, 3); pos[i * 3 + 2] = z + rand(-3, 3);
        vel[i * 3] = rand(-6, 6); vel[i * 3 + 1] = rand(6, 16); vel[i * 3 + 2] = rand(-6, 6);
        c.setHSL(Math.random(), 0.9, 0.6);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      geo.attributes.color.needsUpdate = true;
    },
    update(dt) {
      if (life <= 0) return;
      life -= dt;
      if (life <= 0) { pts.visible = false; return; }
      for (let i = 0; i < N; i++) {
        vel[i * 3 + 1] -= 14 * dt;
        vel[i * 3] *= 0.99; vel[i * 3 + 2] *= 0.99;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (pos[i * 3 + 1] < 0.05) { pos[i * 3 + 1] = 0.05; vel[i * 3 + 1] = 0; vel[i * 3] = vel[i * 3 + 2] = 0; }
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// The pitch after heavy rain: the same markings with a brown tint and dark, churned-up patches at the goals, the centre
// spot and along the touchlines
function mudTexture(base) {
  const src = base.image, c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = 'rgba(150,118,80,0.55)'; g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'source-over';
  const W = PITCH.hl * 2 + RUNOFF * 2, H = PITCH.hw * 2 + RUNOFF * 2;
  const u = (x) => ((x + W / 2) / W) * c.width, v = (z) => ((z + H / 2) / H) * c.height, k = c.width / W;
  let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const patch = (cx, cz, spread, n, size) => {
    for (let i = 0; i < n; i++) {
      const x = u(cx + (rnd() - 0.5) * spread), y = v(cz + (rnd() - 0.5) * spread * 0.8), r = (0.5 + rnd()) * size * k;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(70,45,22,0.75)'); gr.addColorStop(1, 'rgba(70,45,22,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  };
  for (const s of [-1, 1]) patch(s * (PITCH.hl - 4 * PITCH.s), 0, 12 * PITCH.s, 26, 2.6); // the goal mouths
  patch(0, 0, 8 * PITCH.s, 14, 2.2); // the centre spot
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) patch((i - 1.5) * (PITCH.hl * 0.55), s * (PITCH.hw - 1.5), 8 * PITCH.s, 7, 2); // the flanks
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = base.anisotropy;
  return t;
}

// Everything that depends on the size of the pitch lives in one group, so it can be thrown away and rebuilt
function buildStadium(group) {
  const pitchTex = pitchTexture();
  const pw = PITCH.hl * 2 + RUNOFF * 2, ph = PITCH.hw * 2 + RUNOFF * 2;
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshStandardMaterial({ map: pitchTex, roughness: 0.95 }));
  pitch.rotation.x = -Math.PI / 2; pitch.receiveShadow = true;
  group.add(pitch);

  // translucent white sheet that fades in for snowy weather
  const snowSheet = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 1, transparent: true, opacity: 0, depthWrite: false }));
  snowSheet.rotation.x = -Math.PI / 2; snowSheet.position.y = 0.012; snowSheet.receiveShadow = true;
  group.add(snowSheet);

  // advertising boards
  const bt = boardTexture();
  bt.wrapS = THREE.RepeatWrapping;
  const boardMat = new THREE.MeshStandardMaterial({ map: bt, emissiveMap: bt, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.5 });
  const board = (w, h, x, z, rotY = 0) => {
    const g = new THREE.BoxGeometry(w, 1.0, 0.2);
    const uv = g.attributes.uv;
    const rep = w / 60;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * rep);
    const m = new THREE.Mesh(g, boardMat);
    m.position.set(x, 0.5, z); m.rotation.y = rotY; m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  };
  const bo = PITCH.hw + 0.1;
  board(PITCH.hl * 2 + 0.4, 1, 0, -bo);
  board(PITCH.hl * 2 + 0.4, 1, 0, bo);
  const segLen = PITCH.hw - GOAL.hw;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    board(segLen, 1, sx * (PITCH.hl + 0.1), sz * (GOAL.hw + segLen / 2), Math.PI / 2);
  }

  group.add(buildGoal(1), buildGoal(-1));

  // floodlight towers: taller and further out on bigger pitches
  const S = PITCH.s, poleH = 26 * Math.max(1, Math.pow(S, 0.6));
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x555b66 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfffbe0 });
  const spots = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (PITCH.hl + 15), z = sz * (PITCH.hw + 14);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, poleH, 8), poleMat);
    pole.position.set(x, poleH / 2, z); group.add(pole);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 0.4), lampMat);
    lamp.position.set(x, poleH + 1, z); lamp.lookAt(0, 10, 0); group.add(lamp);
    const spot = new THREE.SpotLight(0xfff1d0, 0, 140 * Math.max(1, S), 0.75, 0.7, 2);
    spot.position.set(x, poleH + 1, z);
    spot.target.position.set(sx * -6 * S, 0, sz * -4 * S);
    group.add(spot, spot.target);
    spots.push(spot);
  }
  const crowd = buildCrowd(group);
  let mud = null;
  const setMud = (on) => {
    if (on && !mud) mud = mudTexture(pitchTex);
    pitch.material.map = on ? mud : pitchTex;
    pitch.material.needsUpdate = true;
  };
  return { pitch, snowSheet, lampMat, spots, crowd, setMud, dispose: () => { pitchTex.dispose(); mud?.dispose(); } };
}

const disposeGroup = (group) => {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) { if (m.map) m.map.dispose(); if (m.emissiveMap) m.emissiveMap.dispose(); m.dispose(); }
  });
};

export function buildWorld(scene) {
  scene.background = canvasTex(4, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#050a1c'); gr.addColorStop(0.55, '#14224a'); gr.addColorStop(1, '#3a3a6a');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog(0x14224a, 90, 190);

  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x24402a, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3dd, 2.2);
  sun.position.set(-18, 42, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true;
  scene.add(ground);

  // The crowd object stays the same across rebuilds (others hold on to it); only its contents change
  const crowd = {
    animate: true, inner: null,
    update(t, excite) { if (this.animate) this.inner?.update(t, excite); },
  };
  const confetti = buildConfetti(scene);

  const world = { crowd, confetti, hemi, sun, ground, pitch: null, snowSheet: null, lampMat: null, spots: [], group: null, pitchScale: 1 };

  world.builtFor = null;
  world.look = 'arena'; world.mud = false;
  world.setMud = (on) => { world.mud = !!on; world.applyMud?.(world.mud); };
  // switch the stadium look (stands, crowd colours, boards): rebuilds the stadium group
  world.setLook = (key) => {
    const look = STADIUM_LOOKS[key] ? key : 'arena';
    if (look === world.look) return;
    world.look = look; LOOK = STADIUM_LOOKS[look];
    world.rebuild(true);
  };
  world.rebuild = (force = false) => {
    if (!force && world.builtFor === MATCH.size) return; // already the right size
    world.builtFor = MATCH.size;
    if (world.group) { scene.remove(world.group); world.disposeTextures?.(); disposeGroup(world.group); }
    const group = (world.group = new THREE.Group());
    scene.add(group);
    const built = buildStadium(group);
    Object.assign(world, { pitch: built.pitch, snowSheet: built.snowSheet, lampMat: built.lampMat, spots: built.spots });
    world.applyMud = built.setMud;
    world.disposeTextures = built.dispose;
    built.setMud(world.mud);
    crowd.inner = built.crowd;
    const S = (world.pitchScale = PITCH.s);
    // shadows must cover the whole pitch
    const sc = sun.shadow.camera;
    sc.left = -(PITCH.hl + 11); sc.right = PITCH.hl + 11; sc.top = PITCH.hw + 10; sc.bottom = -(PITCH.hw + 10);
    sc.near = 10; sc.far = 110 * Math.max(1, S) + 40; sc.updateProjectionMatrix();
    ground.scale.set(1, 1, 1);
  };
  world.rebuild();
  return world;
}
