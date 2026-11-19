<script>
  import { onMount, onDestroy } from "svelte";
  import * as THREE from "three";
  import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
  import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader";
  import { createRenderer } from "./threeRenderer.js";
  import { gsap } from "gsap";

  export let isActive = false;

  let canvas;
  let scene, camera, renderer;
  let modelGroup;
  let models = {};
  let animationMixer;
  let isDestroyed = false;

  let animationFrameId;
  let clock = new THREE.Clock();

  let isDraggingModel = false;
  let previousPointerPos = { x: 0, y: 0 };
  let orbitRotation = { x: 0.2, y: 0 };
  let currentGroupRotation = { x: 0.2, y: 0 };

  let currentActiveGroup = "chair"; // 'chair' or 'duck'
  let isTransitioning = false;

  let hasBeenActive = false;
  let wasActive = false;

  $: if (isActive && !wasActive) {
    wasActive = true;
    if (hasBeenActive) {
      next(); // Auto-toggle on re-entry with animation
    }
    hasBeenActive = true;
  } else if (!isActive && wasActive) {
    wasActive = false;
  }

  function next(e) {
    if (e) e.stopPropagation();
    if (isTransitioning) return;
    toggleModel();
  }

  function toggleModel() {
    if (!models.chairGroup || !models.duck) return;
    isTransitioning = true;

    const currentModel = currentActiveGroup === "chair" ? models.chairGroup : models.duck;
    const nextModelGroup = currentActiveGroup === "chair" ? "duck" : "chair";
    const nextModel = currentActiveGroup === "chair" ? models.duck : models.chairGroup;

    // Scale down current model
    gsap.to(currentModel.scale, {
      x: 0, y: 0, z: 0,
      duration: 0.4,
      ease: "back.in(1.7)",
      onComplete: () => {
        currentModel.visible = false;
        
        // Show and scale up next model
        currentActiveGroup = nextModelGroup;
        nextModel.visible = true;
        nextModel.scale.set(0, 0, 0);

        const targetScale = nextModel.userData.originalScale || 1;
        gsap.to(nextModel.scale, {
          x: targetScale, y: targetScale, z: targetScale,
          duration: 0.6,
          ease: "back.out(1.7)",
          onComplete: () => {
            isTransitioning = false;
          }
        });
      }
    });
  }

  const MODEL_CONFIG = {
    shubaDuck: {
      baseRot: Math.PI + 150 * (Math.PI / 180),
      pos: [0, -1.0, 0],
      scaleMul: 0.8,
    },
    gamingChair: { scaleMul: 0.9 },
    macbook: { pos: [0.3, -0.8, 2.2], scaleMul: 0.4 },
  };

  // Keep a single loader reference
  let gltfLoader;
  function getSharedLoader() {
    if (!gltfLoader) {
      gltfLoader = new GLTFLoader();
      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath(
        "https://www.gstatic.com/draco/versioned/decoders/1.5.6/",
      );
      gltfLoader.setDRACOLoader(dracoLoader);
    }
    return gltfLoader;
  }

  function loadSingleModel(key, path) {
    return new Promise((resolve, reject) => {
      const loader = getSharedLoader();
      loader.load(
        path,
        (gltf) => {
          const model = gltf.scene;
          
          model.traverse((child) => {
            if (child.isMesh) {
              if (child.material.normalMap && !child.geometry.attributes.tangent) {
                if (child.geometry.attributes.uv) child.geometry.computeTangents();
                else child.material.normalMap = null;
              }
              child.frustumCulled = true;
            }
          });

          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);

          const pivotContainer = new THREE.Group();
          pivotContainer.add(model);

          const box2 = new THREE.Box3().setFromObject(model);
          const center2 = box2.getCenter(new THREE.Vector3());

          model.position.x = -center2.x;
          model.position.y = -center2.y;
          model.position.z = -center2.z;

          const targetSize = 3.5;
          const scale = targetSize / maxDim;
          let finalScale = scale;

          const cfg = MODEL_CONFIG[key];
          if (cfg) {
            if (cfg.baseRot !== undefined) pivotContainer.rotation.y = cfg.baseRot;
            else pivotContainer.rotation.y = Math.PI;

            if (cfg.pos) {
              pivotContainer.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
            }
            if (cfg.scaleMul) {
              finalScale = scale * cfg.scaleMul;
            }
          }
          
          pivotContainer.scale.setScalar(finalScale);
          pivotContainer.userData.originalScale = finalScale;

          if (gltf.animations && gltf.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(model);
            let clip = THREE.AnimationClip.findByName(gltf.animations, "Take 01");
            if (!clip) clip = gltf.animations[0];
            if (clip) {
              const action = mixer.clipAction(clip);
              action.play();
              if (key === "shubaDuck") {
                animationMixer = mixer;
              }
            }
          }

          resolve(pivotContainer);
        },
        undefined,
        reject
      );
    });
  }

  async function initScene() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 7;

    const result = await createRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    renderer = result.renderer;

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.8);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(2, 5, 5);
    scene.add(dirLight);

    const rightLight = new THREE.DirectionalLight(0xffffff, 1.0);
    rightLight.position.set(5, 5, 2);
    scene.add(rightLight);

    modelGroup = new THREE.Group();
    scene.add(modelGroup);

    // Load models
    try {
      const [chair, macbook, duck] = await Promise.all([
        loadSingleModel("gamingChair", "/models/3dmodel/gaming_chair.glb"),
        loadSingleModel("macbook", "/models/3dmodel/macbook.glb"),
        loadSingleModel("shubaDuck", "/models/3dmodel/shuba_duck.glb")
      ]);

      models.chairGroup = new THREE.Group();
      models.chairGroup.userData.originalScale = 1;
      models.chairGroup.add(chair);
      models.chairGroup.add(macbook);

      models.duck = duck;

      modelGroup.add(models.chairGroup);
      modelGroup.add(models.duck);

      // Setup initial visibility
      models.chairGroup.visible = true;
      models.duck.visible = false;

      // Handle the case where it might be active immediately upon load
      if (isActive) {
        wasActive = true;
        hasBeenActive = true;
      }

      onResize();
      animate();
    } catch (e) {
      console.error("Failed to load models for carousel", e);
    }
  }

  function handlePointerDown(e) {
    isDraggingModel = true;
    previousPointerPos = { x: e.clientX, y: e.clientY };
  }

  function handlePointerMove(e) {
    if (isDraggingModel && isActive) {
      const deltaX = e.clientX - previousPointerPos.x;
      const deltaY = e.clientY - previousPointerPos.y;
      orbitRotation.y += deltaX * 0.005;
      orbitRotation.x += deltaY * 0.005;
      orbitRotation.x = Math.max(0, Math.min(Math.PI / 3, orbitRotation.x));
      previousPointerPos = { x: e.clientX, y: e.clientY };
    }
  }

  function handlePointerUp() {
    isDraggingModel = false;
  }

  function animate() {
    if (isDestroyed) return;
    animationFrameId = requestAnimationFrame(animate);

    if (!isActive) return;

    const delta = clock.getDelta();

    if (animationMixer && models.duck && models.duck.visible) {
      animationMixer.update(delta);
    }

    if (modelGroup) {
      currentGroupRotation.x += (orbitRotation.x - currentGroupRotation.x) * 0.1;
      currentGroupRotation.y += (orbitRotation.y - currentGroupRotation.y) * 0.1;
      modelGroup.rotation.x = currentGroupRotation.x;
      modelGroup.rotation.y = currentGroupRotation.y;
    }

    // Give chair group a slight spin if not dragged
    if (!isDraggingModel && models.chairGroup && models.chairGroup.visible) {
      models.chairGroup.rotation.y += 0.005;
    }
    // Give duck a slight spin if not dragged
    if (!isDraggingModel && models.duck && models.duck.visible) {
        models.duck.rotation.y += 0.005;
    }

    if (renderer && scene && camera) {
      renderer.render(scene, camera);
    }
  }

  function onResize() {
    if (!canvas || !renderer || !camera) return;
    const parent = canvas.parentElement;
    if (parent) {
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      
      const isMobile = width < 768;
      if (modelGroup) {
        if (isMobile) {
            modelGroup.position.y = -1;
            camera.position.z = 10;
        } else {
            modelGroup.position.y = -0.5;
            camera.position.z = 8;
        }
      }
    }
  }

  onMount(() => {
    initScene();
    window.addEventListener("resize", onResize);
    return () => {
      isDestroyed = true;
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", onResize);
      if (renderer) renderer.dispose();
    };
  });

  // Re-trigger resize when becoming active to ensure correct sizing
  $: if (isActive && canvas) {
    // Slight delay to allow DOM to settle
    setTimeout(onResize, 50);
  }
</script>

<div 
  class="w-full h-full relative" 
  on:pointerdown={handlePointerDown}
  on:pointermove={handlePointerMove}
  on:pointerup={handlePointerUp}
  on:pointercancel={handlePointerUp}
  on:mouseleave={handlePointerUp}
>
  <canvas 
    bind:this={canvas} 
    class="w-full h-full block cursor-grab active:cursor-grabbing outline-none"
    style="touch-action: none;"
  ></canvas>

  <div class="absolute bottom-4 left-0 right-0 flex justify-center pointer-events-none z-10">
    <div class="bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 text-white/80 text-xs font-semibold flex items-center gap-2">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"></path>
      </svg>
      Arraste para rotacionar
    </div>
  </div>

  <!-- Navigation Arrows -->
  <button
    on:click|stopPropagation={(e) => next(e)}
    on:pointerdown|stopPropagation
    class="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 md:w-10 md:h-10 rounded-full bg-black/30 backdrop-blur-md border border-white/20 flex items-center justify-center hover:bg-white/20 hover:scale-110 transition-all opacity-50 hover:opacity-100 shadow-lg z-20 pointer-events-auto"
    aria-label="Previous model"
  >
    <svg class="w-4 h-4 md:w-5 md:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
    </svg>
  </button>
  <button
    on:click|stopPropagation={(e) => next(e)}
    on:pointerdown|stopPropagation
    class="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 md:w-10 md:h-10 rounded-full bg-black/30 backdrop-blur-md border border-white/20 flex items-center justify-center hover:bg-white/20 hover:scale-110 transition-all opacity-50 hover:opacity-100 shadow-lg z-20 pointer-events-auto"
    aria-label="Next model"
  >
    <svg class="w-4 h-4 md:w-5 md:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
    </svg>
  </button>
</div>
