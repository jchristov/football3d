import * as THREE from 'three';
import { Player } from './player.js';

// A tiny stand-alone 3D view of one player (used by the squad editor and the "player looks" sheet).
export class LookPreview {
  constructor(canvas, { width = 220, height = 280, mode = 'bust' } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, width / height, 0.1, 50);
    this.scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x556655, 1.6));
    const key = new THREE.DirectionalLight(0xfff3dd, 3.0);
    key.position.set(-1.5, 3, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9db4ff, 0.9);
    rim.position.set(2, 2, -3);
    this.scene.add(rim);
    this.player = new Player(0, { role: 'MID', lx: 0, lz: 0 }, 0);
    this.scene.add(this.player.mesh);
    this.yaw = 0.35;
    this.setMode(mode);
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'bust') { this.camera.position.set(0, 1.93, 2.0); this.camera.lookAt(0, 1.84, 0); this.camera.fov = 26; }
    else { this.camera.position.set(0, 1.25, 4.2); this.camera.lookAt(0, 0.98, 0); this.camera.fov = 30; }
    this.camera.updateProjectionMatrix();
  }

  // squad: { num, name, look, captain }; kit: as given to Player.setKit
  show({ kit, num, name, look, captain, gk = false }) {
    const p = this.player;
    p.isGK = gk;
    p.setKit(kit);
    p.setIdentity(num, name, look, captain);
    this.render();
  }

  render(yaw = this.yaw) {
    const p = this.player;
    p.facing = Math.PI / 2 - yaw;
    p.syncMesh(1, 0);
    p.syncMesh(1, 0);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() { this.renderer.dispose(); }
}
