<script>
  import { onMount, onDestroy } from "svelte";
  import * as THREE from "three";
  import { createRenderer } from "./threeRenderer.js";

  export let voxelOffset = 6;
  export let voxelSize = 5;
  export let isExploded = false;

  let canvas;
  let renderer, scene, camera, instancedMesh;
  let rafId;

  // Colors match CSS
  // Top #ffaa44, Bottom #cc6600, Right #e67e1a, Left #994d00, Front #f99126, Back #cc6600
  // Three.js BoxGeometry faces: 0:right, 1:left, 2:top, 3:bottom, 4:front, 5:back
  const materials = [
    new THREE.MeshBasicMaterial({ color: 0xe67e1a }), // Right
    new THREE.MeshBasicMaterial({ color: 0x994d00 }), // Left
    new THREE.MeshBasicMaterial({ color: 0xffaa44 }), // Top
    new THREE.MeshBasicMaterial({ color: 0xcc6600 }), // Bottom
    new THREE.MeshBasicMaterial({ color: 0xf99126 }), // Front
    new THREE.MeshBasicMaterial({ color: 0xcc6600 }), // Back
  ];

  const coords = [-1.5, -0.5, 0.5, 1.5];
  const voxels = [];
  for (let x of coords) {
    for (let y of coords) {
      for (let z of coords) {
        voxels.push({
          x,
          y,
          z,
          ex: x * (2 + Math.random() * 2) + (Math.random() - 0.5) * 4,
          ey: y * (2 + Math.random() * 2) + (Math.random() - 0.5) * 4,
          ez: z * (2 + Math.random() * 2) + (Math.random() - 0.5) * 4,
          randRot: Math.random() * Math.PI * 4 - Math.PI * 2,
          randScale: Math.random() * 0.5,
        });
      }
    }
  }

  let explosionProgress = 0;
  let rotationAngle = 0;

  let destroyed = false;

  onMount(() => {
    init();
  });

  async function init() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.z = 300; // Matches CSS perspective: 300px

    const result = await createRenderer({ canvas, alpha: true, antialias: true });
    if (destroyed) {
      result.renderer.dispose?.();
      return;
    }
    renderer = result.renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    
    // Set initial size
    const width = canvas.clientWidth || 250;
    const height = canvas.clientHeight || 250;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = 2 * Math.atan((height / 2) / 300) * (180 / Math.PI);
    camera.updateProjectionMatrix();

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    instancedMesh = new THREE.InstancedMesh(geometry, materials, voxels.length);
    scene.add(instancedMesh);

    let lastTime = performance.now();
    const dummy = new THREE.Object3D();

    const animate = (time) => {
      rafId = requestAnimationFrame(animate);
      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      // Handle explosion progress
      if (isExploded) {
        explosionProgress += dt / 0.4; // 0.4s ease out
        if (explosionProgress > 1) explosionProgress = 1;
      } else {
        explosionProgress -= dt / 0.8; // 0.8s ease in
        if (explosionProgress < 0) explosionProgress = 0;
      }

      // Smooth step for explosion
      const t = explosionProgress < 0.5
          ? 2 * explosionProgress * explosionProgress
          : 1 - Math.pow(-2 * explosionProgress + 2, 2) / 2;

      // Rotation speed matching CSS: 360deg in 4s = 90deg/s for slow, 360deg in 2s = 180deg/s for fast
      const speed = isExploded ? Math.PI : Math.PI / 2;
      rotationAngle += speed * dt;

      instancedMesh.rotation.x = rotationAngle;
      instancedMesh.rotation.y = rotationAngle;

      for (let i = 0; i < voxels.length; i++) {
        const v = voxels[i];

        // Base position
        let bx = v.x * voxelOffset;
        let by = v.y * voxelOffset;
        let bz = v.z * voxelOffset;

        // Exploded position
        let tx = bx + v.ex * voxelOffset * t;
        let ty = by + v.ey * voxelOffset * t;
        let tz = bz + v.ez * voxelOffset * t;

        dummy.position.set(tx, ty, tz);

        // Rotation
        if (t > 0) {
          dummy.rotation.set(v.randRot * t, v.randRot * t, 0);
        } else {
          dummy.rotation.set(0, 0, 0);
        }

        // Scale
        // The original CSS voxel base size is handled by scale here.
        // We multiply by voxelSize which gives us the correct width/height/depth.
        const s = voxelSize * (1 + v.randScale * t);
        dummy.scale.set(s, s, s);

        dummy.updateMatrix();
        instancedMesh.setMatrixAt(i, dummy.matrix);
      }

      instancedMesh.instanceMatrix.needsUpdate = true;

      // Update camera aspect in case of resize
      const curWidth = canvas.clientWidth;
      const curHeight = canvas.clientHeight;
      if (curWidth && curHeight && (renderer.domElement.width !== curWidth * renderer.getPixelRatio() || renderer.domElement.height !== curHeight * renderer.getPixelRatio())) {
        renderer.setSize(curWidth, curHeight, false);
        camera.aspect = curWidth / curHeight;
        camera.fov = 2 * Math.atan((curHeight / 2) / 300) * (180 / Math.PI);
        camera.updateProjectionMatrix();
      }

      renderer.render(scene, camera);
    };

    rafId = requestAnimationFrame(animate);
  }

  onDestroy(() => {
    destroyed = true;
    if (rafId) cancelAnimationFrame(rafId);
    if (renderer) renderer.dispose();
    if (instancedMesh) instancedMesh.dispose();
  });
</script>

<canvas bind:this={canvas} style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 250px; height: 250px; pointer-events: none; z-index: 10; display: block;"></canvas>
