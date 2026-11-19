<script>
  import { onMount, onDestroy } from "svelte";
  import * as THREE from "three";
  import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
  import { createRenderer } from "./threeRenderer.js";

  export let isActive = false;

  let canvasEl;
  let renderer, scene, camera, phoneGroup, screenCube;
  let animationId;
  let isDestroyed = false;
  let resizeObserver;

  // Mouse / gyroscope tracking
  let targetRotX = 0.1;
  let targetRotY = 0;
  let currentRotX = 0.1;
  let currentRotY = 0;
  let hasGyroscope = false;

  onMount(() => {
    // Defer init until layout is settled
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!isDestroyed) initScene();
      });
    });
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("deviceorientation", onDeviceOrientation);
  });

  onDestroy(() => {
    isDestroyed = true;
    if (animationId) {
      if (typeof window !== "undefined") cancelAnimationFrame(animationId);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("deviceorientation", onDeviceOrientation);
    }
    if (resizeObserver) resizeObserver.disconnect();
    
    if (scene) {
      scene.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          if (child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(m => m.dispose());
          }
        }
      });
    }

    if (renderer) {
      renderer.dispose?.();
      renderer.forceContextLoss?.();
      renderer = null;
    }
  });

  $: if (isActive && renderer && !animationId) {
    animate();
  }
  $: if (!isActive && animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  function onMouseMove(e) {
    if (hasGyroscope) return;
    const nx = (e.clientX / window.innerWidth - 0.5) * 2;
    const ny = (e.clientY / window.innerHeight - 0.5) * 2;
    targetRotY = nx * 0.4;
    targetRotX = 0.1 + ny * 0.25;
  }

  function onDeviceOrientation(e) {
    if (e.gamma === null || e.beta === null) return;
    hasGyroscope = true;
    targetRotY = (e.gamma / 90) * 0.5;
    targetRotX = 0.1 + ((e.beta - 45) / 90) * 0.3;
  }

  async function initScene() {
    if (!canvasEl) return;

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0, 5.5);
    camera.lookAt(0, 0, 0);

    const result = await createRenderer({
      canvas: canvasEl,
      antialias: true,
      alpha: true,
    });
    if (isDestroyed) {
      result.renderer.dispose?.();
      return;
    }
    renderer = result.renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffeedd, 1.2);
    keyLight.position.set(3, 4, 5);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x88aaff, 0.5);
    rimLight.position.set(-3, 2, -3);
    scene.add(rimLight);

    // Build the phone
    phoneGroup = new THREE.Group();
    buildPhone(phoneGroup);
    phoneGroup.rotation.x = 0.1;
    phoneGroup.rotation.z = -0.05;
    scene.add(phoneGroup);

    // ResizeObserver for reliable sizing
    const wrapper = canvasEl.parentElement;
    if (wrapper) {
      resizeObserver = new ResizeObserver(() => updateSize());
      resizeObserver.observe(wrapper);
    }
    updateSize();

    if (isActive) {
      animate();
    } else {
      renderer.render(scene, camera);
    }
  }

  function buildPhone(group) {
    const bodyWidth = 1.4;
    const bodyHeight = 2.9;
    const bodyDepth = 0.16;
    const cornerRadius = 0.18;

    // Body (titanium frame)
    const bodyGeo = new RoundedBoxGeometry(bodyWidth, bodyHeight, bodyDepth, 4, cornerRadius);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a2e,
      metalness: 0.85,
      roughness: 0.25,
    });
    group.add(new THREE.Mesh(bodyGeo, bodyMat));

    // Screen (matte dark, no glare)
    const screenWidth = bodyWidth - 0.12;
    const screenHeight = bodyHeight - 0.14;
    const screenGeo = new RoundedBoxGeometry(screenWidth, screenHeight, 0.02, 4, 0.12);
    const screenMat = new THREE.MeshStandardMaterial({
      color: 0x111118,
      metalness: 0.0,
      roughness: 0.6,
      emissive: 0x050510,
      emissiveIntensity: 0.3,
    });
    const screenMesh = new THREE.Mesh(screenGeo, screenMat);
    screenMesh.position.z = bodyDepth / 2 + 0.005;
    group.add(screenMesh);

    // Orange cube on the screen
    const cubeGeo = new THREE.BoxGeometry(0.45, 0.45, 0.45);
    const cubeMat = new THREE.MeshStandardMaterial({
      color: 0xf99126,
      metalness: 0.3,
      roughness: 0.4,
      emissive: 0xf99126,
      emissiveIntensity: 0.15,
    });
    screenCube = new THREE.Mesh(cubeGeo, cubeMat);
    screenCube.position.set(0, 0, bodyDepth / 2 + 0.25);
    group.add(screenCube);


    // Side buttons
    const btnMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3e, metalness: 0.9, roughness: 0.2 });
    const pwrBtn = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.25, 0.06), btnMat);
    pwrBtn.position.set(bodyWidth / 2 + 0.01, 0.4, 0);
    group.add(pwrBtn);

    const volGeo = new THREE.BoxGeometry(0.02, 0.15, 0.06);
    const volUp = new THREE.Mesh(volGeo, btnMat);
    volUp.position.set(-bodyWidth / 2 - 0.01, 0.6, 0);
    group.add(volUp);
    const volDown = new THREE.Mesh(volGeo.clone(), btnMat);
    volDown.position.set(-bodyWidth / 2 - 0.01, 0.35, 0);
    group.add(volDown);

    // Back camera module
    const camModuleGeo = new RoundedBoxGeometry(0.45, 0.45, 0.05, 4, 0.08);
    const camModuleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, metalness: 0.8, roughness: 0.3 });
    const camModule = new THREE.Mesh(camModuleGeo, camModuleMat);
    camModule.position.set(-0.35, 0.95, -bodyDepth / 2 - 0.025);
    group.add(camModule);

    const backLensGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.02, 16);
    const backLensMat = new THREE.MeshStandardMaterial({ color: 0x0a0a1a, metalness: 0.6, roughness: 0.1 });
    const positions = [[-0.45, 1.05], [-0.25, 1.05], [-0.45, 0.85]];
    positions.forEach(([x, y]) => {
      const lens = new THREE.Mesh(backLensGeo, backLensMat);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(x, y, -bodyDepth / 2 - 0.05);
      group.add(lens);
      const ringGeo = new THREE.TorusGeometry(0.075, 0.008, 8, 24);
      const ringMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4e, metalness: 0.9, roughness: 0.15 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(lens.position);
      ring.position.z -= 0.005;
      group.add(ring);
    });
  }

  function updateSize() {
    if (!canvasEl || !renderer || !camera) return;
    const wrapper = canvasEl.parentElement;
    if (!wrapper) return;
    const w = wrapper.clientWidth;
    const h = wrapper.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Re-render immediately after resize to avoid blank frame
    if (scene && camera) renderer.render(scene, camera);
  }

  function animate() {
    if (isDestroyed || !renderer || !isActive) {
      animationId = null;
      return;
    }

    const time = performance.now() * 0.001;

    // Smooth interpolation toward target rotation (mouse/gyro)
    const lerp = 0.06;
    currentRotX += (targetRotX - currentRotX) * lerp;
    currentRotY += (targetRotY - currentRotY) * lerp;

    if (phoneGroup) {
      phoneGroup.rotation.x = currentRotX;
      phoneGroup.rotation.y = currentRotY;
    }

    // Rotate the orange cube on the screen
    if (screenCube) {
      screenCube.rotation.x = time * 0.8;
      screenCube.rotation.y = time * 1.2;
    }

    renderer.render(scene, camera);
    animationId = requestAnimationFrame(animate);
  }
</script>

<div class="phone-canvas-wrapper">
  <canvas bind:this={canvasEl}></canvas>
</div>

<style>
  .phone-canvas-wrapper {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .phone-canvas-wrapper canvas {
    width: 100% !important;
    height: 100% !important;
    display: block;
  }
</style>
