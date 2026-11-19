<script>
  import { onMount, onDestroy } from "svelte";
  import * as THREE from "three";
  import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
  import { Octree } from "three/examples/jsm/math/Octree.js";
  import { Capsule } from "three/examples/jsm/math/Capsule.js";
  import { gsap } from "gsap";
  import Spinner from "./Spinner.svelte";
  import {
    contactModalState,
    portfolioModalState,
    hasSeenSplashScreen,
    globalLoading,
  } from "$lib/modalStore.js";
  import { gameProjects } from "./portfolioData.js";
  import ContactModal from "./ContactModal.svelte";
  import { registerRenderer, unregisterRenderer } from "./debugStore.js";
  import { createRenderer, captureCanvas } from "./threeRenderer.js";
  import { createBirdFlock, boundsFromPlayArea } from "./birdFlock.js";

  let canvas;
  let scene, camera, renderer;
  let model, mixer;
  let dirLight; // Global light for updates
  let actions = {};
  let activeAction, previousAction;
  let clock = new THREE.Clock();
  let isLoading = true;
  let loadingProgress = 0;
  let isDestroyed = false; // Flag to prevent animation after destroy
  let animationId; // Track animation frame to cancel it properly

  // WebGPU: renderer.compileAsync() cria os pipelines com createRenderPipelineAsync
  // e já os coloca no cache ANTES de ficarem prontos. Se renderer.render() rodar
  // nesse intervalo, o backend chama setPipeline(undefined), o render lança
  // exceção a cada frame e o canvas congela (mapa parado, pássaros parados,
  // cartuchos que carregaram depois nunca aparecem). Por isso todo pré-compile
  // passa por warmCompile() e o loop não renderiza enquanto houver compile pendente.
  let pendingCompiles = 0;
  let renderErrorCount = 0;

  // Se o GPUDevice cair (driver resetou, processo de GPU do navegador reiniciou,
  // notebook trocou de GPU…) o three para de renderizar em silêncio e o canvas
  // fica congelado com o jogo rodando por trás. Aqui recriamos o renderer no
  // mesmo canvas (device novo) e, se não der, recarregamos a página.
  let recoveringRenderer = false;

  function watchDeviceLost(r) {
    if (!r) return;
    r.onDeviceLost = (info) => {
      console.warn("[Jogos] GPU perdida, recriando renderer:", info?.message || info);
      if (r === renderer) recoverRenderer();
    };
  }

  async function recoverRenderer() {
    if (recoveringRenderer || isDestroyed) return;
    recoveringRenderer = true;
    const old = renderer;
    const pixelRatio = old?.getPixelRatio?.() ?? 1;
    const shadowsOn = old?.shadowMap?.enabled ?? true;
    const shadowType = old?.shadowMap?.type ?? THREE.PCFShadowMap;
    renderer = null; // o loop para de renderizar enquanto troca
    try {
      old?.dispose?.();
    } catch {
      /* device já perdido */
    }
    try {
      const result = await createRenderer({ canvas, antialias: true, alpha: true });
      if (isDestroyed) {
        result.renderer.dispose?.();
        return;
      }
      const r = result.renderer;
      r.setSize(window.innerWidth, window.innerHeight);
      r.setPixelRatio(pixelRatio);
      r.shadowMap.enabled = shadowsOn;
      r.shadowMap.type = shadowType;
      renderer = r;
      registerRenderer(r, result.currentRenderer);
      watchDeviceLost(r);
      renderErrorCount = 0;
      console.info("[Jogos] Renderer recriado:", result.currentRenderer);
    } catch (e) {
      console.error("[Jogos] Não deu pra recriar o renderer, recarregando a página:", e);
      if (!isDestroyed) window.location.reload();
    } finally {
      recoveringRenderer = false;
    }
  }

  function warmCompile(object, targetScene = null) {
    if (!renderer || !camera) return Promise.resolve();
    const compileFn = renderer.compileAsync || renderer.compile;
    if (typeof compileFn !== "function") return Promise.resolve();
    pendingCompiles++;
    let result;
    try {
      result = compileFn.call(renderer, object, camera, targetScene);
    } catch (e) {
      result = Promise.reject(e);
    }
    return Promise.resolve(result)
      .catch((e) => console.warn("[Jogos] Pré-compilação falhou:", e?.message || e))
      .finally(() => {
        pendingCompiles = Math.max(0, pendingCompiles - 1);
      });
  }
  let cubes = []; // Now cartouches
  let sphere; // Now Miku
  let mikuMixer; // Separate mixer for Miku
  let mikuAction;
  let clown; // Clown character
  let clownMixer; // Separate mixer for Clown
  let clownActions = {}; // Clown animations
  let zombie; // Zombie character
  let zombieMixer;
  let zombieAction;
  let zombieRisingAction; // Rising animation

  // Game Constants
  const FIREBALL_COOLDOWN = 1; // 1 second
  const THUNDER_COOLDOWN = 30.0; // 30 seconds
  const ZOMBIE_RESPAWN_TIME = 30.0; // 30 seconds (Subsequent spawns)
  const INITIAL_ZOMBIE_SPAWN_TIME = 30.0; // 30 seconds (First spawn)

  let zombieIdleAction; // Idle animation
  let zombieLoadStarted = false; // zumbi é carregado depois do loading principal

  let zombieWalkAction; // Walk animation
  let isZombieRising = false; // Track if zombie is currently rising
  let zombieRespawnTimer = INITIAL_ZOMBIE_SPAWN_TIME; // Start with longer countdown
  let playerMaxHp = 100;
  let playerHp = 100;
  let isZombieChasing = false; // Track chasing state
  let zombieCollider = new Capsule(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 1, 0),
    0.35,
  );
  let zombieVelocity = new THREE.Vector3();
  let zombieOnFloor = false;
  let zombieFinalY = 0; // Store final Y position after rising
  let welcomeSign; // Welcome sign model
  let portfolioCartouche; // Portfolio cartouche model
  let portfolioModalOpen = false; // Local tracker for isPaused
  let destinationMarker; // Visual marker for click destination
  let markerRipple; // Animated ripple effect
  let textLabels = []; // 3D text labels for cartouches and characters
  let environmentalModels = []; // Environmental decorations (trees, rocks, bushes, etc.)
  let collisionObstacles = []; // Collision spheres for individual meshes

  let clouds = [];
  let floatingTexts = []; // Store floating damage numbers

  // Pássaros na escala do nosso mapa (unrender_forest.glb, clareira ~29x30):
  //  - skyFlock: bando alto sobre a clareira/falésias; projeta sombra no chão,
  //    então mesmo na câmera de cima dá pra ver as sombras passando.
  //  - lowFlock: grupinho baixo, acima das copas, que cruza a visão padrão.
  let skyFlock = null;
  let lowFlock = null;
  const MAP_AREA_FALLBACK = { xmin: -12.5, xmax: 16.5, zmin: -14, zmax: 16 };

  // Vetores reutilizáveis (física do zumbi/projéteis) — evita GC por frame
  const _diff = new THREE.Vector3();
  const _vector = new THREE.Vector3();

  // Cartouche data with comprehensive portfolio information (Imported from portfolioData.js)
  const cartoucheData = gameProjects;
  let selectedCartouche = null; // Track which cartouche was clicked
  let currentImageIndex = 0; // Track current image in carousel

  // Game State
  let targetPosition = null;
  let targetObject = null;
  let showModal = false;
  let currentProject = null; // Store current project data for modal
  let showDialogue = false;
  let isMoving = false;
  let isInDialogue = false;

  // Dialogue State
  let displayedText = "";
  let fullText = "Greetings, traveler! Do you wish to continue your journey?";
  let typingInterval;
  let showButtons = false;
  let currentNPC = null; // Track which NPC is being talked to
  let showTextInput = false; // For clown's joke input
  let playerJoke = ""; // Store player's joke input
  let showCloseButton = false; // For clown's close button after response

  // Interaction Hint State
  let interactionHint = {
    visible: false,
    x: 0,
    y: 0,
    text: "",
    isMobile: false,
  };
  let activeInteractiveObject = null;

  // Selfie State
  let isTakingSelfie = false;
  let showFlash = false;

  // Audio State
  let typeSounds = [];
  let stepSounds = [];
  let jumpSound;
  let okSound;
  let byebyeSound;
  let shutterSound1;
  let shutterSound2;
  // New Sounds
  let zombieIdleSound;
  let zombieHitSound;
  let zombieDieSound;
  let fireballThrowSound;
  let fireballHitSound;
  let thunderSound;

  let bgMusic;
  let isMusicPlaying = true; // Default to true

  // Audio Mixer State
  let volBgMusic = 0.1;
  let volType = 0.2;
  let volStep = 0.1;
  let volJump = 0.2;
  let volOk = 0.2;
  let volBye = 0.2;
  let volShutter = 0.2;
  let volFireball = 0.1;
  let volThunder = 0.1;
  let volZombie = 0.2; // New Zombie volume
  let volMaster = 1.0; // Global Master Volume

  let showAudioMixer = false; // Hidden by default
  let showVolumeSlider = false; // Legacy slider visibility

  let attackMode = null; // 'fireball' or 'thunder'
  let projectiles = []; // Store active projectiles
  let effects = []; // Store active visual effects
  let dustParticles = []; // Store dust effect particles

  // Power Cooldowns
  let fireballCooldown = 0; // Current cooldown time remaining
  let thunderCooldown = 0;
  // Constants moved to top
  let currentStep = 0;

  // Pause State
  let manuallyPaused = false;
  let contactModalOpen = false;
  let lastPauseExitTime = 0;
  let showConfigModal = false;

  // Subscribe to contactModalState to track its opening
  const unsubContactModal = contactModalState.subscribe((state) => {
    const wasOpen = contactModalOpen;
    contactModalOpen = !!state.isOpen;
    if (wasOpen && !contactModalOpen) {
      manuallyPaused = false;
      if (typeof window !== "undefined" && !isMobile && isFirstPerson && renderer && document.pointerLockElement !== document.body) {
        document.body.requestPointerLock().catch(() => {});
      }
    }
  });

  const unsubPortfolioModal = portfolioModalState.subscribe((state) => {
    const wasOpen = portfolioModalOpen;
    portfolioModalOpen = !!state.isOpen;
    if (wasOpen && !portfolioModalOpen) {
      manuallyPaused = false;
      if (typeof window !== "undefined" && !isMobile && isFirstPerson && renderer && document.pointerLockElement !== document.body) {
        document.body.requestPointerLock().catch(() => {});
      }
    }
  });

  // Reactive Pause Logic: Game is paused if ANY modal is open OR manually paused
  $: isPaused =
    manuallyPaused ||
    showModal ||
    portfolioModalOpen ||
    showConfigModal ||
    contactModalOpen ||
    showGameOverModal ||
    $globalLoading;

  // Reactive side effects for pausing/resuming
  $: {
    if (isPaused) {
      // Force Zombie to Idle Animation (unless currently rising from ground)
      if (zombie && !zombie.userData.isDead && !isZombieRising) {
        if (typeof fadeToActionZombie === "function") {
          fadeToActionZombie(zombieIdleAction, 0.2);
        }
      }
    } else {
      // When resuming
      if (clock) {
        clock.getDelta(); // Reset clock delta
      }
      lastPauseExitTime = Date.now(); // Record when we resumed to prevent immediate re-trigger
    }
  }

  // Graphics Settings
  let graphicsSettings = {
    shadows: "médio", // 'off', 'low', 'high' -> now matches UI keys
    resolution: 0.65, // 0.5 to 1.0 (Pixel Ratio)
    antialiasing: true, // MSAA
  };

  let tempGraphicsSettings = { ...graphicsSettings };

  // Joystick State
  let isMobile = false;
  let joystickActive = false;
  let joystickData = { x: 0, y: 0, originX: 0, originY: 0 };
  let joystickBase;
  let joystickStick;

  function toggleConfig() {
    showConfigModal = !showConfigModal;
    if (showConfigModal) {
      // Create a fresh copy when opening
      tempGraphicsSettings = { ...graphicsSettings };
    }
  }

  function saveGraphicsSettings() {
    isLoading = true; // Show full screen spinner
    // Aplica no próximo frame (antes havia 1 s de espera artificial)
    setTimeout(() => {
      graphicsSettings = { ...tempGraphicsSettings };
      applyGraphicsSettings();
      globalLoading.set(false);
      isLoading = false;
      showConfigModal = false;
    }, 60);
  }

  function applyGraphicsSettings() {
    if (!renderer) return;

    // 1. Resolution (FSR Simulation)
    // Adjust pixel ratio. Standard usage is window.devicePixelRatio (usually 1 or more).
    // We will scale it.
    const baseRatio = Math.min(window.devicePixelRatio || 1, 2);
    const targetRatio = baseRatio * graphicsSettings.resolution;
    renderer.setPixelRatio(targetRatio);

    // 2. Shadows
    // 2. Shadows
    switch (graphicsSettings.shadows) {
      case "off":
        renderer.shadowMap.enabled = false;
        break;
      case "baixo": // Low
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.BasicShadowMap;
        break;
      case "médio": // Medium (was 'high' logic)
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        break;
      case "alto": // High (was 'crisp' logic)
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Soft seems better for high
        // updateShadowCamera(200, 4096);
        break;
      case "ultra": // Kept for potential compatibility or if added back
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        updateShadowCamera(150, 4096); // Tighter bounds = Higher Res
        break;
      case "epic":
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        updateShadowCamera(150, 8192); // 8K Texture
        break;
      case "∞": // Nightmare
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        updateShadowCamera(100, 8192); // 8K + Tight Bounds = Extreme Density
        break;
      // Fallback for internal default state potentially being "high" from old code
      case "high":
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        break;
    }

    // 3. Antialiasing

    // WebGLRenderer constructor 'antialias' is fixed at creation.
    // We cannot toggle native MSAA at runtime easily without recreating renderer.
    // So we might skip this for now or use post-processing if we had it.
    // For now, let's just log it or handle it if we have a pass.
    console.log("Applied Graphics Settings:", graphicsSettings);

    // Re-render immediately to show changes
    // scene.traverse helps update shadow materials
    scene.traverse((child) => {
      if (child.material) {
        if (child.material.isMaterial) child.material.needsUpdate = true;
      }
    });
  }

  function togglePause() {
    if (showGameOverModal) return;
    manuallyPaused = !manuallyPaused;
  }
  // VFX Pools - Pre-created to avoid shader compilation stutter
  let fireballGeometry = null;
  let fireballMaterial = null;
  let thunderMaterial = null;
  let thunderGlowMaterial = null;

  // Object Pools
  const POOL_SIZE = 10;
  let fireballPool = [];
  let thunderMeshPool = [];
  let thunderGlowPool = [];
  let lightPool = [];
  
  // Instanced Meshes for Particles
  const MAX_PARTICLES = 200;
  let dustParticleInstancedMesh;
  let explosionParticleInstancedMesh;
  let activeDustData = []; // Store life, rotation, velocity
  let activeExplosionData = [];

  let lastStepTime = 0;
  const STEP_INTERVAL = 0.3; // Seconds between steps

  // Keyboard State
  const keys = {
    w: false,
    a: false,
    s: false,
    d: false,
    space: false,
    shift: false,
  };

  // Physics/Movement Config
  const GRAVITY = 30;
  const JUMP_FORCE = 5; // Reduced from 15
  const MOVE_SPEED = 20;
  const ROTATION_SPEED = 10;
  const ARRIVAL_THRESHOLD = 0.2;

  // --- Mapa (static/models/map/unrender_forest.glb) ---
  // Gerado por tools/generate-forest-map.mjs. O mapa já vem cercado naturalmente
  // (falésias + floresta), então não geramos mais paredes/pedras em runtime.
  const MAP_URL = "/models/map/unrender_forest.glb";
  // Malhas do GLB que entram na física (octree). Folhagem fica de fora: as
  // árvores colidem pelos troncos que vêm na malha "colliders".
  const MAP_COLLISION_MESHES = new Set(["terrain", "rocks", "colliders"]);
  const MAP_NO_SHADOW_CAST = new Set(["paths", "trees_far", "terrain_far"]);
  // Posições fixas – MANTER EM SINCRONIA com POIS em tools/generate-forest-map.mjs
  // (o gerador deixa essas áreas livres de árvores e pedras).
  const MAP_POI = {
    spawn: { x: -0.65, z: 3.62 },
    contato: { x: -1.4, z: -0.4 },
    portfolio: { x: 3.0, z: 0.9 },
    clown: { x: -5.2, z: 2.6 },
    miku: { x: 1.4, z: 7.3 },
    welcome: { x: 3.0, z: 4.4 },
    zombie: { x: 6.2, z: -2.8 },
  };
  // Contorno da clareira (extras.playArea do GLB). Trava de segurança: se algo
  // atravessar a falésia (lag / fps muito baixo), volta pra última posição válida.
  let playAreaPolygon = null;
  const _lastSafePlayerPos = new THREE.Vector3(MAP_POI.spawn.x, 0.33, MAP_POI.spawn.z);
  const _lastSafeZombiePos = new THREE.Vector3();
  let hasSafeZombiePos = false;
  const _safeDelta = new THREE.Vector3();

  function isInsidePlayArea(x, z) {
    const poly = playAreaPolygon;
    if (!poly) return true;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], zi = poly[i][1];
      const xj = poly[j][0], zj = poly[j][1];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  // Physics State
  const worldOctree = new Octree();
  const playerCollider = new Capsule(
    new THREE.Vector3(-0.65, 0.33, 3.62), // Start (adjusted for -0.02 ground level: 0.33 - 0.35 = -0.02)
    new THREE.Vector3(-0.65, 1.33, 3.62), // End (height 1.0)
    0.35,
  );

  let playerVelocity = new THREE.Vector3();
  let playerDirection = new THREE.Vector3();
  let playerOnFloor = false;
  let isGrounded = false; // Keep for compatibility with animation logic

  let hasPlayedLandingSound = false;
  let isPlayingOneShotAnimation = false;

  // Position Capture HUD
  let playerPosition = { x: 0, y: 0, z: 0 };
  let showHud = false; // Hidden by default
  let isFirstPerson = false;
  let cameraRotation = { x: 0, y: 0 };

  // Player specific state
  let playerHealth = 100;
  let playerGold = 0;
  let inSafeZone = true;
  let showDamageOverlay = false;
  let playerImmunityTimer = 0;
  let isPlayerImmune = false;
  let immunityBlinkTimer = 0;

  // Reusable variables for Zombie Physics
  const _zombieDirection = new THREE.Vector3();
  const _zombieQuat = new THREE.Quaternion();
  const _zombieAxis = new THREE.Vector3(0, 1, 0);
  const _particlePos = new THREE.Vector3();

  let showGameOverModal = false;

  function copyPosition() {
    const posStr = `x: ${playerPosition.x}, y: ${playerPosition.y}, z: ${playerPosition.z}`;
    const posCode = `position.set(${playerPosition.x}, ${playerPosition.y}, ${playerPosition.z})`;
    navigator.clipboard.writeText(posCode).then(() => {
      console.log("Copied position:", posCode);
      // Optional: Visual feedback
      const btn = document.querySelector(".hud-copy-btn");
      if (btn) {
        const originalText = btn.innerText;
        btn.innerText = "COPIED!";
        setTimeout(() => (btn.innerText = originalText), 1000);
      }
    });
  }

  function copyAudioDefaults() {
    const defaults = `
    let volBgMusic = ${volBgMusic};
    let volType = ${volType};
    let volStep = ${volStep};
    let volJump = ${volJump};
    let volOk = ${volOk};
    let volBye = ${volBye};
    let volShutter = ${volShutter};
    let volZombie = ${volZombie};
    `.trim();

    navigator.clipboard.writeText(defaults).then(() => {
      console.log("Copied audio defaults:", defaults);
      const btn = document.querySelector(".hud-copy-audio-btn");
      if (btn) {
        const originalText = btn.innerText;
        btn.innerText = "COPIED!";
        setTimeout(() => (btn.innerText = originalText), 1000);
      }
    });
  }

  function updateChannelVolume(channel, value) {
    // Ensure value is float
    value = parseFloat(value);

    switch (channel) {
      case "music":
        volBgMusic = value;
        if (bgMusic) bgMusic.volume = volBgMusic * volMaster;
        break;
      case "type":
        volType = value;
        typeSounds.forEach((s) => (s.volume = volType * volMaster));
        if (typeSounds[0] && Math.random() > 0.8) {
          typeSounds[0].currentTime = 0;
          typeSounds[0].play().catch(() => {});
        }
        break;
      case "step":
        volStep = value;
        stepSounds.forEach((s) => (s.volume = volStep * volMaster));
        if (stepSounds[0] && Math.random() > 0.8) {
          stepSounds[0].currentTime = 0;
          stepSounds[0].play().catch(() => {});
        }
        break;
      case "jump":
        volJump = value;
        if (jumpSound) {
          jumpSound.volume = volJump * volMaster;
          if (Math.random() > 0.8) {
            jumpSound.currentTime = 0;
            jumpSound.play().catch(() => {});
          }
        }
        break;
      case "ok":
        volOk = value;
        if (okSound) {
          okSound.volume = volOk * volMaster;
          if (Math.random() > 0.8) {
            okSound.currentTime = 0;
            okSound.play().catch(() => {});
          }
        }
        break;
      case "bye":
        volBye = value;
        if (byebyeSound) {
          byebyeSound.volume = volBye * volMaster;
          if (Math.random() > 0.8) {
            byebyeSound.currentTime = 0;
            byebyeSound.play().catch(() => {});
          }
        }
        break;
      case "shutter":
        volShutter = value;
        if (shutterSound1) {
          shutterSound1.volume = volShutter * volMaster;
          if (Math.random() > 0.8) {
            shutterSound1.currentTime = 0;
            shutterSound1.play().catch(() => {});
          }
        }
        break;
      case "fireball":
        volFireball = value;
        if (fireballThrowSound)
          fireballThrowSound.volume = volFireball * volMaster;
        if (fireballHitSound) fireballHitSound.volume = volFireball * volMaster;
        break;
      case "thunder":
        volThunder = value;
        if (thunderSound) thunderSound.volume = volThunder * volMaster;
        break;
      case "zombie":
        volZombie = value;
        if (zombieIdleSound) zombieIdleSound.volume = volZombie * volMaster;
        if (zombieHitSound) zombieHitSound.volume = volZombie * volMaster;
        if (zombieDieSound) zombieDieSound.volume = volZombie * volMaster;
        break;
    }
  }

  function updateShadowCamera(size, mapSize) {
    if (!dirLight) return;

    // WebGPURenderer redimensiona o shadow map sozinho quando mapSize muda

    dirLight.shadow.camera.top = size;
    dirLight.shadow.camera.bottom = -size;
    dirLight.shadow.camera.left = -size;
    dirLight.shadow.camera.right = size;
    dirLight.shadow.mapSize.width = mapSize;
    dirLight.shadow.mapSize.height = mapSize;
    dirLight.shadow.camera.updateProjectionMatrix();

    // Force updates
    if (renderer) renderer.shadowMap.needsUpdate = true;
  }

  // Shader Code

  onMount(() => {
    const setup = async () => {
      globalLoading.set(true);
      await init();
      animate();
    };
    setup();

    // Welcome Modal will be opened after loading completes.

    const handleWindowResize = () => {
      isMobile = window.innerWidth < 768;
      onWindowResize();
    };

    if (typeof window !== "undefined") {
      isMobile = window.innerWidth < 768;
      window.addEventListener("resize", handleWindowResize);
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      document.addEventListener("mousemove", onMouseMove);
    }

    // Load Sounds
    typeSounds = [
      new Audio("/audio/npc-type1.mp3"),
      new Audio("/audio/npc-type2.mp3"),
      new Audio("/audio/npc-type3.mp3"),
    ];

    stepSounds = [new Audio("/audio/step1.mp3"), new Audio("/audio/step2.mp3")];

    jumpSound = new Audio("/audio/jump1.mp3");
    okSound = new Audio("/audio/ok.mp3");
    byebyeSound = new Audio("/audio/byebye.mp3");
    shutterSound1 = new Audio("/audio/click.wav");
    shutterSound2 = new Audio("/audio/click2.wav");

    // Sons de combate: só baixam depois que o jogo carregou (ver warmDeferredAudio)
    const lazyAudio = (url) => {
      const a = new Audio();
      a.preload = "none";
      a.src = url;
      return a;
    };
    zombieIdleSound = lazyAudio("/audio/zombie-idle.m4a");
    zombieHitSound = lazyAudio("/audio/zombie-hit.m4a");
    zombieDieSound = lazyAudio("/audio/zombie-die.m4a");
    fireballThrowSound = lazyAudio("/audio/fireball-trow.wav");
    fireballHitSound = lazyAudio("/audio/fireball-hit.wav");
    thunderSound = lazyAudio("/audio/thunder.m4a");

    // 8 MB: nunca pré-carrega, faz streaming quando o play() acontece
    bgMusic = lazyAudio("/audio/conker-windy-theme.mp3");
    bgMusic.loop = true;
    bgMusic.volume = volBgMusic; // Low background music

    // Audio Warmup on Interaction
    window.addEventListener("click", onFirstInteraction, { once: true });
    window.addEventListener("keydown", onFirstInteraction, { once: true });

    // Set volumes
    typeSounds.forEach((s) => {
      s.load();
      s.volume = volType;
    });
    stepSounds.forEach((s) => {
      s.load();
      s.volume = volStep;
    });
    jumpSound.load();
    jumpSound.volume = volJump;
    okSound.load();
    okSound.volume = volOk;
    byebyeSound.load();
    byebyeSound.volume = volBye;
    shutterSound1.load();
    shutterSound1.volume = volShutter;
    shutterSound2.load();
    shutterSound2.volume = volShutter;

    zombieIdleSound.volume = volZombie;
    zombieHitSound.volume = volZombie;
    zombieDieSound.volume = volZombie;
    fireballThrowSound.volume = volFireball;
    fireballHitSound.volume = volFireball;
    thunderSound.volume = volThunder;
    shutterSound2.volume = volShutter;

    // Global Singleton Pattern to prevent duplicates
    if (window.globalBgMusic) {
      window.globalBgMusic.pause();
      window.globalBgMusic = null;
    }
    window.globalBgMusic = bgMusic;

    // Preload sounds
    typeSounds.forEach((s) => s.load());
    stepSounds.forEach((s) => s.load());
    jumpSound.load();
    okSound.load();
    byebyeSound.load();
    shutterSound1.load();
    shutterSound2.load();

    // Try to play music immediately, but muted if still loading
    if (bgMusic) {
      const originalMuted = bgMusic.muted;
      if (isLoading) bgMusic.muted = true;
      
      bgMusic.play().then(() => {
        // If it plays, and we are still loading, keep it muted
        // It will be unmuted when loading finishes or on interaction
      }).catch((e) => {
        console.log("Autoplay prevented:", e);
        isMusicPlaying = false; // Reset state if autoplay fails
      });
    }

    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get("developer") === "gustavodslara") {
        console.log("Developer Mode Enabled");
        showHud = true;
        showAudioMixer = true;
      }
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", handleWindowResize);
      }
    };
  });

  onDestroy(() => {
    isDestroyed = true;
    unsubContactModal?.();
    unsubPortfolioModal?.();
    if (animationId) cancelAnimationFrame(animationId); // Stop the loop immediately
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousemove", onMouseMove);
    }
    
    unregisterRenderer();

    // Stop music
    if (bgMusic) {
      bgMusic.pause();
      bgMusic = null;
    }
    if (typeof window !== "undefined" && window.globalBgMusic === bgMusic) {
      window.globalBgMusic = null;
    }

    if (scene) {
      scene.traverse(disposeNode);
    }

    // Dispose Mixers
    if (mixer) mixer.stopAllAction();
    if (mikuMixer) mikuMixer.stopAllAction();
    if (clownMixer) clownMixer.stopAllAction();
    if (zombieMixer) zombieMixer.stopAllAction();

    skyFlock?.dispose();
    lowFlock?.dispose();
    skyFlock = lowFlock = null;
    clouds = [];
    projectiles = [];
    effects = [];

    if (renderer) {
      renderer.dispose?.();
      renderer.forceContextLoss?.();
      renderer.domElement = null;
      renderer = null;
    }

    portfolioModalState.update((s) => ({ ...s, isOpen: false }));
  });

  function disposeNode(node) {
    if (node instanceof THREE.Mesh) {
      if (node.geometry) {
        node.geometry.dispose();
      }
      if (node.material) {
        if (Array.isArray(node.material)) {
          node.material.forEach((m) => m.dispose());
        } else {
          node.material.dispose();
        }
      }
    }
  }

  async function init() {
    if (typeof window === "undefined") return;
    // Scene
    scene = new THREE.Scene();

    const textureLoader = new THREE.TextureLoader(); // Kept for other textures but not skybox

    // Skybox - Plain Blue (Optimized/Visual Upgrade)
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 3000, 4900);

    // Camera
    camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.01, // Reduced near plane to prevent clipping when close to models
      5000,
    );
    camera.position.set(MAP_POI.spawn.x, 5, MAP_POI.spawn.z + 5);
    camera.lookAt(MAP_POI.spawn.x, 0, MAP_POI.spawn.z);

    // Renderer
    // WebGPU sempre (WebGL só se o WebGPU falhar). A selfie usa captureCanvas(),
    // então não precisamos de preserveDrawingBuffer (que custa caro no WebGL).
    const result = await createRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    if (isDestroyed) {
      result.renderer.dispose?.();
      return;
    }
    renderer = result.renderer;
    const currentRenderer = result.currentRenderer;

    renderer.setSize(window.innerWidth, window.innerHeight);
    // DPR travado: telas 3x/4x renderizavam 9–16x pixels sem ganho visual
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? 1.25 : 1.75),
    );
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    // Register renderer for global debug overlay
    registerRenderer(renderer, currentRenderer);
    watchDeviceLost(renderer);

    // Lights (Optimized for Sunny Look)
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x606060, 2.0);
    hemiLight.position.set(0, 200, 0);
    scene.add(hemiLight);

    dirLight = new THREE.DirectionalLight(0xfffbdd, 3.5);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.bias = -0.0001;
    dirLight.shadow.normalBias = 0.0;
    // 2048 cobre bem o frustum de ±40 (o 4096 padrão custava 4x mais por frame)
    const initialShadowSize = window.innerWidth < 768 ? 1024 : 2048;
    dirLight.shadow.mapSize.width = initialShadowSize;
    dirLight.shadow.mapSize.height = initialShadowSize;
    dirLight.shadow.camera.top = 40;
    dirLight.shadow.camera.bottom = -40;
    dirLight.shadow.camera.left = -40;
    dirLight.shadow.camera.right = 40;
    scene.add(dirLight);

    // Initialize VFX pools (including 2 reusable PointLights) upfront before scene compilation
    initVFXPools();

    createClouds();
    createBirds(MAP_AREA_FALLBACK);

    // --- Loading Manager (Synchronize Map + Player) ---
    const manager = new THREE.LoadingManager();
    // Add a manual lock so manager does not complete prematurely before dynamic loaders start
    manager.itemStart("waitForDynamicLoaders");
    manager.onProgress = function (url, itemsLoaded, itemsTotal) {
      loadingProgress = itemsLoaded / itemsTotal;
    };

    manager.onError = function (url) {
      console.error("Erro ao carregar recurso: " + url);
      // Evita o congelamento eterno se um arquivo falhar
      isLoading = false;
      globalLoading.set(false);
    };

    manager.onLoad = function () {
      console.log("Loading complete!");

      // O zumbi só aparece depois de 30 s: baixa depois do jogo abrir (–1 MB no loading)
      if (!zombieLoadStarted) {
        zombieLoadStarted = true;
        createZombie(null);
        warmDeferredAudio();
      }

      isLoading = false;
      if (bgMusic) bgMusic.muted = false;

      // Ensure at least one frame is rendered before hiding global loader
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!isDestroyed) {
            globalLoading.set(false);
          }
        });
      });
    };

    // Map
    const mapLoader = new GLTFLoader(manager);
    mapLoader.load(MAP_URL, (gltf) => {
      const map = gltf.scene;
      map.name = "map_root";
      map.updateMatrixWorld(true);
      playAreaPolygon = map.userData.playArea || null;
      if (playAreaPolygon) {
        const area = boundsFromPlayArea(playAreaPolygon);
        skyFlock?.setBounds({ xmin: area.xmin - 10, xmax: area.xmax + 10, zmin: area.zmin - 10, zmax: area.zmax + 10 });
        lowFlock?.setBounds({ xmin: area.xmin + 2, xmax: area.xmax - 2, zmin: area.zmin + 2, zmax: area.zmax - 2 });
      }

      // Um único material barato para o mapa inteiro: cor por vértice + flat
      // shading (visual low poly igual ao atlas do mapa antigo, sem especular).
      const mapMaterial = new THREE.MeshLambertMaterial({
        vertexColors: true,
        flatShading: true,
      });

      // Física: só chão/falésias, pedras e colisores simples (troncos + cerca
      // invisível no topo das falésias). Nunca vai pra cena = nunca renderiza
      // nem atrapalha o raycast de clique.
      const collisionRoot = new THREE.Group();
      const helperMeshes = [];

      map.traverse((child) => {
        if (!child.isMesh) return;
        const meshName = child.name;

        if (MAP_COLLISION_MESHES.has(meshName)) {
          const physicsMesh = new THREE.Mesh(child.geometry);
          physicsMesh.applyMatrix4(child.matrixWorld);
          collisionRoot.add(physicsMesh);
        }

        if (meshName === "colliders") {
          helperMeshes.push(child);
          return;
        }

        // Normais só pro offset de sombra; o shading é flat (derivadas)
        child.geometry.computeVertexNormals();
        child.material = mapMaterial;
        child.castShadow = !MAP_NO_SHADOW_CAST.has(meshName);
        child.receiveShadow = true;
        child.matrixAutoUpdate = false; // mapa é estático
        child.userData.mapPart = meshName;
        // Identifica como ambiente (clique pra andar / placeObjectOnGround)
        child.name = "environment_mesh";
      });
      helperMeshes.forEach((m) => m.parent.remove(m));

      scene.add(map);

      // --- Physics: Populate Octree ---
      // IMPORTANT: Populate Octree immediately when map loads
      worldOctree.fromGraphNode(collisionRoot);

      // Initialize characters and interactive elements AFTER map is loaded
      createCartouches(manager);
      createMiku(manager);
      createClown(manager);
      createWelcomeSign(manager);
      createPortfolioCartouche(manager);
      // createZombie() roda no manager.onLoad (carregamento adiado)
      // createWelcomeSign(); // Removed duplicate
      createDestinationMarker();

      // Release the lock now that dynamically added loaders have started
      manager.itemEnd("waitForDynamicLoaders");
    });

    // Load Player Model
    const loader = new GLTFLoader(manager);
    loader.load(
      "/models/p1.glb",
      (gltf) => {
        model = gltf.scene;
        model.scale.set(0.66, 0.66, 0.66); // Reduced scale to match map (1/3 smaller)
        model.position.set(MAP_POI.spawn.x, -0.02, MAP_POI.spawn.z);
        scene.add(model);
        if (camera) {
          camera.position.set(MAP_POI.spawn.x, 5, MAP_POI.spawn.z + 5);
          camera.lookAt(model.position);
        }

        model.traverse((object) => {
          if (object.isMesh) object.castShadow = true;
        });

        // Animations
        mixer = new THREE.AnimationMixer(model);

        mixer.addEventListener("finished", (e) => {
          if (
            e.action === actions["Agree"] ||
            e.action === actions["Disagree"]
          ) {
            endDialogue();
          }
        });

        const idleAnim =
          gltf.animations.find((a) => a.name.toLowerCase().includes("idle")) ||
          gltf.animations[0];
        const walkAnim =
          gltf.animations.find((a) => a.name.toLowerCase().includes("walk")) ||
          gltf.animations[1];
        const fallAnim =
          gltf.animations.find((a) => a.name.toLowerCase().includes("fall")) ||
          gltf.animations[2];
        const agreeAnim = gltf.animations.find((a) =>
          a.name.toLowerCase().includes("agree"),
        );
        const disagreeAnim = gltf.animations.find((a) =>
          a.name.toLowerCase().includes("disagree"),
        );
        const hitAnim = gltf.animations.find((a) =>
          a.name.toLowerCase().includes("hit"),
        );
        const curseAnim = gltf.animations.find((a) =>
          a.name.toLowerCase().includes("curse"),
        );

        if (idleAnim) actions["Idle"] = mixer.clipAction(idleAnim);
        if (walkAnim) {
          actions["Walking"] = mixer.clipAction(walkAnim);
          actions["Walking"].timeScale = 1.4;
        }
        if (fallAnim) actions["Fall"] = mixer.clipAction(fallAnim);
        if (agreeAnim) actions["Agree"] = mixer.clipAction(agreeAnim);
        if (disagreeAnim) actions["Disagree"] = mixer.clipAction(disagreeAnim);
        if (hitAnim) actions["Hit"] = mixer.clipAction(hitAnim);
        if (curseAnim) actions["Curse"] = mixer.clipAction(curseAnim);

        activeAction = actions["Idle"];
        if (activeAction) activeAction.play();

        // Removed individual isLoading = false
      },
      undefined,
      (e) => {
        console.error(e);
        // Error handling if player fails?
      },
    );
  }

  function placeObjectOnGround(object, x, z, yOffset = 0) {
    const raycaster = new THREE.Raycaster();
    const start = new THREE.Vector3(x, 50, z);
    const dir = new THREE.Vector3(0, -1, 0);
    raycaster.set(start, dir);
    raycaster.camera = camera; // Fix for sprites

    // Intersect with everything in scene
    const intersects = raycaster.intersectObjects(scene.children, true);

    // Find the ground (environment mesh)
    const ground = intersects.find(
      (i) =>
        i.object.name === "environment_mesh" ||
        i.object.name === "map_root" ||
        i.object.name === "floor", // Keep for backward compatibility if needed
    );

    if (ground) {
      console.log(
        `Placed ${object.name || "object"} at ${x}, ${ground.point.y + yOffset}, ${z}`,
      );
      object.position.set(x, ground.point.y + yOffset, z);
    } else {
      console.warn(
        `Could not find ground for ${object.name || "object"} at ${x}, ${z}. Using default Y.`,
      );
      // Fallback
      object.position.set(x, yOffset, z);
    }
  }

  function onFirstInteraction() {
    window.removeEventListener("click", onFirstInteraction);
    window.removeEventListener("keydown", onFirstInteraction);
    
    // Ensure background music starts playing and is unmuted if loading is finished
    if (bgMusic) {
      if (!isLoading) bgMusic.muted = false;
      bgMusic.play().catch(() => {});
      isMusicPlaying = true;
    }
  }


  // Baixa os sons de combate em segundo plano, depois que o jogo já abriu
  function warmDeferredAudio() {
    const run = () => {
      [zombieIdleSound, zombieHitSound, zombieDieSound, fireballThrowSound, fireballHitSound, thunderSound]
        .filter(Boolean)
        .forEach((a) => {
          a.preload = "auto";
          a.load();
        });
    };
    if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 4000 });
    else setTimeout(run, 1500);
  }

  function initVFXPools() {
    console.log("Initializing VFX Pools...");

    // 1. Materials & Geometries
    fireballGeometry = new THREE.IcosahedronGeometry(0.2, 0);
    fireballMaterial = new THREE.MeshLambertMaterial({
      color: 0xff4500,
      flatShading: true,
      emissive: 0xff0000,
      emissiveIntensity: 0.5,
    });

    const tubeGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0,0,0), new THREE.Vector3(0,1,0)]), 10, 0.08, 8, false);
    const glowGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0,0,0), new THREE.Vector3(0,1,0)]), 10, 0.2, 8, false);
    
    thunderMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    thunderGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.5,
    });

    const particleMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff, // Color set via instanceColor
      transparent: true,
      opacity: 0.8,
    });
    const particleGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);

    // 2. Build Pools
    fireballPool = [];
    thunderMeshPool = [];
    lightPool = [];
    activeDustData = [];
    activeExplosionData = [];

    for (let i = 0; i < POOL_SIZE; i++) {
      // Fireballs
      const fb = new THREE.Mesh(fireballGeometry, fireballMaterial);
      fb.visible = false;
      scene.add(fb);
      fireballPool.push({ mesh: fb, active: false });

      // Thunder
      const tc = new THREE.Mesh(tubeGeo, thunderMaterial);
      const tg = new THREE.Mesh(glowGeo, thunderGlowMaterial);
      tc.visible = false;
      tg.visible = false;
      scene.add(tc);
      scene.add(tg);
      thunderMeshPool.push({ core: tc, glow: tg, active: false });
    }

    // Keep PointLight pool small (2 lights max) so fragment shaders stay lightweight
    const LIGHT_POOL_SIZE = 2;
    for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
      const light = new THREE.PointLight(0xffaa00, 0, 10);
      light.position.set(0, -100, 0);
      scene.add(light);
      lightPool.push({ light: light, active: false });
    }

    // 3. Instanced Meshes for Particles
    dustParticleInstancedMesh = new THREE.InstancedMesh(particleGeo, particleMaterial.clone(), MAX_PARTICLES);
    explosionParticleInstancedMesh = new THREE.InstancedMesh(particleGeo, particleMaterial.clone(), MAX_PARTICLES);
    
    dustParticleInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    explosionParticleInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Initialize invisible
    const dummyMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    const defaultColor = new THREE.Color(0xffffff);
    for (let i = 0; i < MAX_PARTICLES; i++) {
        dustParticleInstancedMesh.setMatrixAt(i, dummyMatrix);
        dustParticleInstancedMesh.setColorAt(i, defaultColor);
        explosionParticleInstancedMesh.setMatrixAt(i, dummyMatrix);
        explosionParticleInstancedMesh.setColorAt(i, defaultColor);
        activeDustData.push({ active: false });
        activeExplosionData.push({ active: false });
    }

    scene.add(dustParticleInstancedMesh);
    scene.add(explosionParticleInstancedMesh);

    console.log("VFX Pools initialized");
  }

  function createCartouches(manager) {
    const loader = manager ? new GLTFLoader(manager) : new GLTFLoader();
    loader.load("/models/cartouche_n64.glb", (gltf) => {
      const model = gltf.scene;
      model.scale.set(0.083, 0.083, 0.083); // Scaled to 1/3 of previous size (0.25 / 3)

      const clone = model.clone();

      // Random Color
      clone.traverse((child) => {
        if (child.isMesh) {
          child.material = child.material.clone();
          child.material.color.setHex(Math.random() * 0xffffff);
          child.castShadow = true;
          child.receiveShadow = true;
          // Fix disappearing at edges
          child.frustumCulled = false;
        }
      });

      // Fixed Position: Cartouche (Contato)
      placeObjectOnGround(clone, MAP_POI.contato.x, MAP_POI.contato.z, 0.5);

      // Add custom property for floating animation
      clone.userData = {
        initialY: clone.position.y,
        floatSpeed: 1 + Math.random(),
        floatOffset: Math.random() * Math.PI * 2,
        cartoucheIndex: 2,
      };

      clone.name = "interactive_cube";
      scene.add(clone);
      addDynamicHitbox(clone, 0.2); // Add hitbox with padding
      cubes.push(clone);

      // Calculate precise top position for label
      const box = new THREE.Box3().setFromObject(clone);
      const center = new THREE.Vector3();
      box.getCenter(center);
      const topY = box.max.y;

      // Position just above the model
      const labelPos = new THREE.Vector3(center.x, topY + 0.3, center.z);
      createTextLabel("Contato", labelPos);

      // Add to collision system
      collisionObstacles.push({
        position: clone.position,
        radius: 0.25, // Tighter collision to allow interaction
      });

      // Store for pumpkins (legacy)
      window.cartouchePositions = [
        { x: clone.position.x, z: clone.position.z, angle: 0 },
      ];
    });
  }

  function createMiku(manager) {
    const loader = manager ? new GLTFLoader(manager) : new GLTFLoader();
    loader.load("/models/miku-br.glb", (gltf) => {
      const mikuMesh = gltf.scene;

      // 1. Setup inner mesh (Pose & Scale)
      mikuMesh.scale.set(0.176, 0.176, 0.176); // 80% scale
      mikuMesh.rotation.x = 0.115; // Tilt forward (Michael Jackson style)

      mikuMesh.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          // Fix disappearing at edges
          child.frustumCulled = false;
        }
      });

      // 2. Setup Container (Position & Tracking)
      sphere = new THREE.Group();
      sphere.name = "interactive_sphere";
      sphere.add(mikuMesh);

      // Fixed Position: Miku Container
      sphere.position.set(MAP_POI.miku.x, -0.05, MAP_POI.miku.z);

      scene.add(sphere);

      // 3. Setup Hitbox on Container
      // Removed hardcoded hitbox
      addDynamicHitbox(sphere, 0.5); // Dynamic hitbox
      // Fix for addDynamicHitbox finding 'hitbox' tag on self:
      // The function looks recursively, so it will find internal meshes.
      sphere.name = "interactive_sphere";

      // Add collision
      collisionObstacles.push({
        position: sphere.position,
        radius: 0.25, // Tighter collision for Miku (thin model)
      });

      // 4. Setup Animation on INNER mesh
      mikuMixer = new THREE.AnimationMixer(mikuMesh);
      const action =
        gltf.animations.find((a) => a.name === "ArmatureAction") ||
        gltf.animations[0];
      if (action) {
        mikuAction = mikuMixer.clipAction(action);
        mikuAction.play();
      }
    });
  }

  function createClown(manager) {
    const loader = manager ? new GLTFLoader(manager) : new GLTFLoader();
    loader.load("/models/clown.glb", (gltf) => {
      clown = gltf.scene;

      // Log animations for reference
      if (gltf.animations) {
        console.group("[Clown] Animations Found");
        gltf.animations.forEach((anim, i) => {
          console.log(`Index ${i}: "${anim.name}" duration: ${anim.duration.toFixed(2)}s`);
        });
        console.groupEnd();
      }

      // Fixed Position: Clown
      placeObjectOnGround(clown, MAP_POI.clown.x, MAP_POI.clown.z, 0);
      clown.scale.set(0.5, 0.5, 0.5);

      clown.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = false; // Otimização
          
          if (child.geometry) {
            child.geometry.computeBoundingSphere();
            if (child.geometry.boundingSphere) {
              child.geometry.boundingSphere.radius *= 2; 
            }
          }
        }
      });

      clown.name = "interactive_clown";
      scene.add(clown);

      const hitboxGeo = new THREE.BoxGeometry(2, 4, 2);
      const hitboxMat = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
      hitbox.position.y = 2;
      hitbox.name = "hitbox";
      //clown.add(hitbox); // Remove hardcoded
      addDynamicHitbox(clown, 0.5);

      // Add collision
      collisionObstacles.push({
        position: clown.position,
        radius: 0.35, // Tighter collision for Clown
      });

      clownMixer = new THREE.AnimationMixer(clown);
      const happyAnim = gltf.animations.find((a) =>
        a.name.toLowerCase().includes("happy"),
      );
      const wavingAnim = gltf.animations.find((a) =>
        a.name.toLowerCase().includes("wav"),
      );
      const laughingAnim = gltf.animations.find((a) =>
        a.name.toLowerCase().includes("laugh"),
      );
      const idleAnim = gltf.animations.find((a) =>
        a.name.toLowerCase().includes("idle"),
      );

      if (happyAnim) clownActions["happy"] = clownMixer.clipAction(happyAnim);
      if (wavingAnim)
        clownActions["waving"] = clownMixer.clipAction(wavingAnim);
      if (laughingAnim)
        clownActions["laughing"] = clownMixer.clipAction(laughingAnim);
      if (idleAnim) clownActions["idle"] = clownMixer.clipAction(idleAnim);

      if (clownActions["happy"]) {
        clownActions["happy"].play();
      } else if (gltf.animations[0]) {
        const fallbackAction = clownMixer.clipAction(gltf.animations[0]);
        fallbackAction.play();
        clownActions["happy"] = fallbackAction;
      }

      clownMixer.addEventListener("finished", (e) => {
        if (e.action === clownActions["waving"]) {
          if (clownActions["happy"]) {
            clownActions["happy"].reset().fadeIn(0.3).play();
          }
        }
      });
    });
  }

  function createWelcomeSign(manager) {
    const loader = manager ? new GLTFLoader(manager) : new GLTFLoader();
    loader.load("/models/map/psx_welcome_sign.glb", (gltf) => {
      welcomeSign = gltf.scene;
      // Moved Position: Welcome Sign (more to the right and bottom/back)
      placeObjectOnGround(welcomeSign, MAP_POI.welcome.x, MAP_POI.welcome.z, 0);
      welcomeSign.scale.set(0.56, 0.56, 0.56);
      welcomeSign.rotation.y = Math.PI * 2;

      welcomeSign.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          // Fix disappearing at edges
          child.frustumCulled = false;
        }
      });

      welcomeSign.name = "interactive_welcome";
      scene.add(welcomeSign);
      addDynamicHitbox(welcomeSign, 0.2);

      collisionObstacles.push({
        position: welcomeSign.position.clone(),
        radius: 0.3,
      });

      // Calculate precise top position
      welcomeSign.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(welcomeSign);
      const center = new THREE.Vector3();
      box.getCenter(center);
      const topY = box.max.y;

      const labelPos = new THREE.Vector3(center.x, topY + 0.4, center.z);

      createMultiLineTextLabel(["Informações"], labelPos);
    });
  }

  function createPortfolioCartouche(manager) {
    const loader = manager ? new GLTFLoader(manager) : new GLTFLoader();
    loader.load("/models/cartouche_n64.glb", (gltf) => {
      portfolioCartouche = gltf.scene;
      portfolioCartouche.scale.set(0.083, 0.083, 0.083);

      portfolioCartouche.traverse((child) => {
        if (child.isMesh) {
          child.material = child.material.clone();
          child.material.color.setHex(0x6fa3ff); // Blue portfolio color
          child.castShadow = true;
          child.receiveShadow = true;
          child.frustumCulled = false;
        }
      });

      placeObjectOnGround(portfolioCartouche, MAP_POI.portfolio.x, MAP_POI.portfolio.z, 0.5);

      portfolioCartouche.userData = {
        initialY: portfolioCartouche.position.y,
        floatSpeed: 1.2,
        floatOffset: 0,
        isPortfolio: true,
      };

      portfolioCartouche.name = "interactive_portfolio";
      scene.add(portfolioCartouche);
      addDynamicHitbox(portfolioCartouche, 0.2);
      cubes.push(portfolioCartouche);

      collisionObstacles.push({
        position: portfolioCartouche.position.clone(),
        radius: 0.3,
      });

      // Label
      portfolioCartouche.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(portfolioCartouche);
      const center = new THREE.Vector3();
      box.getCenter(center);
      const topY = box.max.y;

      const labelPos = new THREE.Vector3(center.x, topY + 0.3, center.z);
      createTextLabel("Portfólio", labelPos);
    });
  }

  function createZombie(manager) {
    console.log("[Zombie] createZombie called. Loading model...");
    const loader = manager ? new GLTFLoader(manager) : new GLTFLoader();
    loader.load("/models/hl1-zombie.glb", (gltf) => {
      const zombieModel = gltf.scene;

      // Log animations for reference
      if (gltf.animations) {
        console.group("[Zombie] Animations Found");
        gltf.animations.forEach((anim, i) => {
          console.log(`Index ${i}: "${anim.name}" duration: ${anim.duration.toFixed(2)}s`);
        });
        console.groupEnd();
      }

      // Initialize Game State
      zombieModel.userData = {
        hp: 10,
        maxHp: 10,
        isDead: true, // Start DEAD
        lastHitAnim: null,
        gltf: gltf, // Store for accessing animations later
        attackCooldown: 0,
        isAttacking: false,
      };

      zombieModel.scale.set(0.015, 0.015, 0.015);

      // Position: clareira própria, longe do spawn e dos NPCs
      placeObjectOnGround(zombieModel, MAP_POI.zombie.x, MAP_POI.zombie.z);

      // Store the final Y position (ground level)
      zombieFinalY = zombieModel.position.y;

      // Start zombie underground
      const undergroundOffset = -2.0;
      zombieModel.position.y = zombieFinalY + undergroundOffset;

      zombieModel.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = false; // Otimização pesada de FPS
          
          // Corrige o bug de sumir nas bordas da tela sem matar a performance (frustumCulled = false mata a CPU/GPU)
          if (child.geometry) {
            child.geometry.computeBoundingSphere();
            if (child.geometry.boundingSphere) {
              child.geometry.boundingSphere.radius *= 2; // Expande a área visível
            }
          }
        }
      });

      zombieModel.name = "interactive_zombie";
      zombieModel.visible = false; // Start INVISIBLE
      scene.add(zombieModel);

      // Store reference
      zombie = zombieModel;

      // Compila os pipelines do zumbi agora (async), não no primeiro spawn
      // (o loop de render pausa até terminar, ver warmCompile)
      if (renderer && camera) {
        const wasVisible = zombieModel.visible;
        zombieModel.visible = true;
        warmCompile(zombieModel, scene).finally(() => {
          if (zombieModel.userData.isDead) zombieModel.visible = wasVisible;
        });
      }

      // STRONG STYLE: Disable auto matrix update to prevent mixer from overriding position
      // We will manually update matrix in animate loop if needed, or rely on position writes
      // Actually, mixer updates position/quaternion properties, then updateMatrix calls happen before render.
      // But if we remove tracks, mixer won't touch position.
      // MatrixAutoUpdate should stay true so our manual position updates propagate.
      // But we can ensure position is strictly controlled.

      // Safety: Ensure it renders
      zombie.matrixAutoUpdate = true;

      // Hitbox
      addDynamicHitbox(zombieModel, 0.5);

      // Collision System
      collisionObstacles.push({
        object: zombieModel, // Referência para checar se está vivo ou morto
        position: zombieModel.position,
        radius: 0.35,
      });

      // Initialize Collider to match model position (even if underground initially)
      zombieCollider.start.set(
        zombieModel.position.x,
        zombieModel.position.y + 0.35,
        zombieModel.position.z,
      );
      zombieCollider.end.set(
        zombieModel.position.x,
        zombieModel.position.y + 1.35,
        zombieModel.position.z,
      );

      // Animation Setup
      zombieMixer = new THREE.AnimationMixer(zombieModel);

      // Get animations
      if (gltf.animations.length > 19) {
        zombieRisingAction = zombieMixer.clipAction(gltf.animations[10]);
        zombieIdleAction = zombieMixer.clipAction(gltf.animations[13]);

        // Sanitize Walking Animation: Remove Position Tracks (Root Motion)
        // This prevents the animation from moving the mesh, which fights with our physics
        const walkClip = gltf.animations[19].clone();
        walkClip.tracks = walkClip.tracks.filter(
          (t) => !t.name.includes(".position"),
        );

        zombieWalkAction = zombieMixer.clipAction(walkClip); // Walking
        zombieWalkAction.setEffectiveTimeScale(2.0); // 2.0x speed

        // Sanitize Attack Animations: Remove Position Tracks (Root Motion)
        const attackClip0 = gltf.animations[0].clone();
        attackClip0.tracks = attackClip0.tracks.filter(
          (t) => !t.name.includes(".position"),
        );
        
        const attackClip1 = gltf.animations[1].clone();
        attackClip1.tracks = attackClip1.tracks.filter(
          (t) => !t.name.includes(".position"),
        );

        zombieModel.userData.attackClips = [attackClip0, attackClip1];

        // Configure animations
        zombieRisingAction.setLoop(THREE.LoopOnce, 1);
        zombieRisingAction.clampWhenFinished = true;

        // DO NOT Start rising animation. Wait for timer (respawnZombie handles rising & listener).
        console.log("[Zombie] Zombie loaded. Waiting for initial countdown.");
        isZombieChasing = false;
        zombieAction = zombieRisingAction;
      }
    });
  }

  // --- Damage System Visuals ---

  function createDamageNumber(position, amount, color = 0xff0000) {
    const div = document.createElement("div");
    div.textContent = amount > 0 ? `-${amount}` : `${amount}`;
    div.style.color = color === 0xff0000 ? "#ff4444" : "#4444ff";
    div.style.fontWeight = "bold";
    div.style.fontSize = "24px";
    div.style.fontFamily = "'Press Start 2P', cursive";
    div.style.textShadow = "2px 2px 0 #000";
    div.style.position = "absolute";
    div.style.pointerEvents = "none";
    div.style.userSelect = "none";

    // Initial position off-screen, updated in animate
    div.style.left = "-1000px";
    div.style.top = "-1000px";

    const container = document.body; // Or specific game container
    container.appendChild(div);

    floatingTexts.push({
      element: div,
      worldPos: position.clone().add(new THREE.Vector3(0, 2.0, 0)), // Start visible above head
      life: 1.0, // 1 second duration
      velocity: new THREE.Vector3(0, 1.0 + Math.random() * 0.5, 0), // Float up
    });
  }

  function flashModel(model, colorHex) {
    const originalEmissives = new Map();

    model.traverse((child) => {
      if (child.isMesh && child.material) {
        // Store original
        if (child.material.emissive) {
          originalEmissives.set(child.uuid, {
            color: child.material.emissive.clone(),
            intensity: child.material.emissiveIntensity,
          });

          // Apply Flash
          // child.material = child.material.clone(); // Clone to avoid affecting shared materials permanently?
          // Better: Just modify and restore.
          // Note: If materials are shared across instances, cloning might be needed.
          // But here we likely have unique instances or it's okay to flash all of type.
          // Let's assume unique or okay to flash.

          child.material.emissive.setHex(colorHex);
          child.material.emissiveIntensity = 0.8;
        }
      }
    });

    // Restore after 200ms
    setTimeout(() => {
      model.traverse((child) => {
        if (child.isMesh && child.material && child.material.emissive) {
          const orig = originalEmissives.get(child.uuid);
          if (orig) {
            child.material.emissive.copy(orig.color);
            child.material.emissiveIntensity = orig.intensity;
          } else {
            child.material.emissive.setHex(0x000000);
            child.material.emissiveIntensity = 0;
          }
        }
      });
    }, 200);
  }

  function takeDamage(target, amount, type) {
    if (!target || !target.userData || target.userData.isDead) return;

    // 1. Deduct HP
    target.userData.hp -= amount;

    // 2. Visual Feedback
    const flashColor = type === "fireball" ? 0xff0000 : 0x00ffff; // Red or Blue
    flashModel(target, flashColor);
    if (type === "thunder") {
      // Double flash for electrocution effect
      setTimeout(() => {
        if (target && target.userData && !target.userData.isDead) {
          flashModel(target, flashColor);
        }
      }, 250);
    }
    createDamageNumber(target.position, amount, flashColor);
    playZombieHit();

    // 3. Play Hit Animation (Random Non-Repeating)
    if (zombieMixer && !isZombieRising) {
      // Stop current
      if (zombieAction) zombieAction.stop();

      // FIX: Reset attacking flag if we interrupted an attack!
      if (target.userData.isAttacking) {
        console.log(
          "[Zombie] Attack interrupted by damage. Resetting isAttacking flag.",
        );
        target.userData.isAttacking = false;
      }

      // Available Hit Anims: 11, 14, 15, 16
      // If we simply use 14, 15, 16 as user listed "The hit by fireball animations are [11] [14] [15] [16]"
      // Wait, [11] is also listed.
      const hitAnims = [11, 14, 15, 16];

      // Filter out last hit
      const available = hitAnims.filter(
        (i) => i !== target.userData.lastHitAnim,
      );

      // Pick random
      const nextAnimIndex =
        available[Math.floor(Math.random() * available.length)];
      target.userData.lastHitAnim = nextAnimIndex;

      // Play
      const clip = zombie.userData.gltf.animations[nextAnimIndex];
      if (clip) {
        const action = zombieMixer.clipAction(clip);
        action.reset();
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
        zombieAction = action;

        // Return to Idle after hit
        const onHitFinished = (e) => {
          if (e.action === action) {
            zombieMixer.removeEventListener("finished", onHitFinished);
            if (!target.userData.isDead) {
              zombieIdleAction?.reset().fadeIn(0.2).play();
              zombieAction = zombieIdleAction;
            }
          }
        };
        zombieMixer.addEventListener("finished", onHitFinished);
      }
    }

    // 4. Check Death
    if (target.userData.hp <= 0) {
      handleDeath(target, type);
    }
  }

  function handleDeath(target, type) {
    target.userData.isDead = true;

    let deathAnimIndex = 0;

    // Select Animation based on Damage Type
    if (type === "thunder") {
      deathAnimIndex = 5; // Instantly from thunder
    } else {
      // Fireball or others: Random [3, 4, 6, 7]
      const pool = [3, 4, 6, 7];
      deathAnimIndex = pool[Math.floor(Math.random() * pool.length)];
    }

    const deathAnim = target.userData.gltf.animations[deathAnimIndex];

    if (deathAnim) {
      if (zombieAction) zombieAction.stop();
      const action = zombieMixer.clipAction(deathAnim);
      action.reset();
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      zombieAction = action;

      // Keep body on the ground after death
      const onDeathFinished = (e) => {
        if (e.action === action) {
          zombieMixer.removeEventListener("finished", onDeathFinished);
        }
      };
      zombieMixer.addEventListener("finished", onDeathFinished);

      // Make the zombie fall like a tree/toy soldier (face plant)
      gsap.to(target.rotation, {
        x: target.rotation.x + Math.PI / 2,
        duration: action.getClip().duration || 1.0,
        ease: "power2.in",
        onComplete: () => {
          // Stay on the floor for 1 second, then disappear
          setTimeout(() => {
            if (target.userData.isDead) {
              target.visible = false;
            }
          }, 1000);
        }
      });
    } else {
      console.log("Death animation not found, hiding instantly.");
      target.visible = false;
    }

    // Disable collision
    const idx = collisionObstacles.findIndex(
      (o) => o.position === target.position,
    );
    if (idx !== -1) collisionObstacles.splice(idx, 1);

    // Schedule Respawn via Timer
    zombieRespawnTimer = ZOMBIE_RESPAWN_TIME;
    console.log(`[Zombie] Death handled. Respawn in ${ZOMBIE_RESPAWN_TIME}s`);
  }

  function respawnZombie(target) {
    console.log("[Zombie] respawnZombie TRIGGERED! Resetting zombie.");
    // Reset State
    target.userData.hp = target.userData.maxHp;
    target.userData.isDead = false;
    target.userData.lastHitAnim = null;
    target.visible = true; // Make visible again
    target.rotation.x = 0; // Reset rotation so he stands up!

    // Position
    // Sempre levanta no ponto de spawn (longe do spawn do player e dos NPCs)
    // Reuse existing zombieFinalY
    target.position.x = MAP_POI.zombie.x;
    target.position.z = MAP_POI.zombie.z;
    target.position.y = zombieFinalY - 2.0; // Start underground again

    // Enable collision again?
    // Actually we just pushed the position reference, so if we didn't remove the object reference...
    // Wait, splice(idx, 1) removed the object from the array. We need to re-add.
    collisionObstacles.push({
      object: target,
      position: target.position,
      radius: 0.35,
    });

    // Animation
    if (zombieAction) zombieAction.stop();
    
    if (zombieRisingAction) {
      zombieRisingAction.reset().play();
      zombieAction = zombieRisingAction;
      isZombieRising = true;

      const onRisingFinished = (e) => {
        if (e.action === zombieRisingAction) {
          zombieMixer.removeEventListener("finished", onRisingFinished);
          isZombieRising = false;
          playZombieIdle();
          if (zombieIdleAction) {
            zombieIdleAction.reset().play();
            zombieAction = zombieIdleAction;
          }

          // Sync collider here too!
          zombieVelocity.set(0, 0, 0);
          zombieCollider.start.set(
            target.position.x,
            target.position.y + 0.35,
            target.position.z,
          );
          zombieCollider.end.set(
            target.position.x,
            target.position.y + 1.35,
            target.position.z,
          );
          console.log(`[Zombie] Respawn Rising finished. Collider synced.`);
        }
      };
      zombieMixer.addEventListener("finished", onRisingFinished);
    } else {
      isZombieRising = false;
      target.position.y = zombieFinalY;
      playZombieIdle();
      if (zombieIdleAction) {
        zombieIdleAction.reset().play();
        zombieAction = zombieIdleAction;
      }
      zombieVelocity.set(0, 0, 0);
      zombieCollider.start.set(
        target.position.x,
        target.position.y + 0.35,
        target.position.z,
      );
      zombieCollider.end.set(
        target.position.x,
        target.position.y + 1.35,
        target.position.z,
      );
    }
  }

  function zombieAttack(target) {
    if (
      !zombie ||
      zombie.userData.attackCooldown > 0 ||
      zombie.userData.isDead ||
      zombie.userData.isAttacking
    )
      return;
    // Allow attacking even if player is immune (visual only), damage check is later

    // zombie.userData.isAttacking set inside if(attackAnim) check now for safety
    // zombie.userData.attackCooldown set inside too

    // Face Player
    const lookTarget = target.position.clone();
    lookTarget.y = zombie.position.y;
    zombie.lookAt(lookTarget);

    // Select Attack Anim [0] or [1]
    const attackIndex = Math.random() < 0.5 ? 0 : 1;
    const attackAnim = zombie.userData.attackClips[attackIndex];

    if (attackAnim) {
      zombie.userData.isAttacking = true;
      zombie.userData.attackCooldown = 2.0;

      if (zombieAction) zombieAction.stop();
      const action = zombieMixer.clipAction(attackAnim);
      action.reset();
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.timeScale = 1.15; // 15% Faster
      action.play();
      zombieAction = action;

      // Delay damage impact (approx 0.5s into animation / 1.15 speed = ~0.43s)
      setTimeout(() => {
        // Re-check distance and state before applying damage
        // Safety: Don't apply damage if game paused or ended during the swing
        if (isPaused || showGameOverModal) return;

        if (zombie && !zombie.userData.isDead && model) {
          // Attack range slighty larger than collision (0.35 + arm reach ~0.5 = 0.85)
          const dist = zombie.position.distanceTo(model.position);
          // Hit range must be >= stop range (0.9)
          if (dist < 1.2) {
            // Tighter range
            damagePlayer(1);
          }
        }
      }, 400);

      const onAttackFinished = (e) => {
        if (e.action === action) {
          zombieMixer.removeEventListener("finished", onAttackFinished);
          zombie.userData.isAttacking = false;
          console.log("[Zombie] Attack animation finished.");
          if (!zombie.userData.isDead) {
            zombieIdleAction?.reset().fadeIn(0.2).play();
            zombieAction = zombieIdleAction;
          }
        }
      };
      zombieMixer.addEventListener("finished", onAttackFinished);

      // Failsafe: Force clear flag after duration + buffer
      const duration = action.getClip().duration / 1.15; // timescale
      setTimeout(
        () => {
          if (zombie && zombie.userData.isAttacking) {
            // Failsafe clear
          }
        },
        duration * 1000 + 500,
      );
    } else {
      // Missing animation fallback
      zombie.userData.isAttacking = true;
      zombie.userData.attackCooldown = 2.0;
      
      // Delay damage impact manually
      setTimeout(() => {
        if (isPaused || showGameOverModal) return;
        if (zombie && !zombie.userData.isDead && model) {
          const dist = zombie.position.distanceTo(model.position);
          if (dist < 1.3) {
            damagePlayer(1);
          }
        }
        
        // Reset attack state slightly after damage is dealt
        setTimeout(() => {
           if (zombie) zombie.userData.isAttacking = false;
        }, 100);
      }, 400);
    }

  }

  function damagePlayer(amount) {
    if (isPlayerImmune) return;

    playerHp = Math.max(0, playerHp - amount);
    createDamageNumber(model.position, amount, 0xff0000); // Red text on player

    if (playerHp <= 0) {
      showGameOverModal = true;
    }

    // Immunity
    isPlayerImmune = true;
    playerImmunityTimer = 3.0; // 3 seconds

    console.log(`Player hit! HP: ${playerHp}`);
  }

  function resetGame() {
    // Reset Player State
    playerHp = playerMaxHp;
    showGameOverModal = false;
    isPlayerImmune = false;

    if (model) {
      model.visible = true;
      // Reset Position to initial spawn
      model.position.set(-0.65, 0, 3.62);

      // Reset Collider
      playerCollider.start.set(-0.65, 0.33, 3.62);
      playerCollider.end.set(-0.65, 1.33, 3.62);

      // Reset Physics/Movement
      playerVelocity.set(0, 0, 0);
      isMoving = false;
      targetPosition = null;
      targetObject = null;
      hideDestinationMarker();

      // Face default direction (towards sign)
      model.rotation.set(0, 0, 0);
    }

    // Reset Zombie to Countdown Mode
    zombieRespawnTimer = INITIAL_ZOMBIE_SPAWN_TIME;
    if (zombie) {
      zombie.visible = false;
      zombie.userData.isDead = true;
      zombie.userData.hp = zombie.userData.maxHp;
      if (zombieAction) zombieAction.stop();
      isZombieRising = false;
      isZombieChasing = false;
      // respawnZombie(zombie); // Do NOT spawn immediately
    }
  }

  function createMultiLineTextLabel(lines, position) {
    // Create canvas for text texture
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    // High resolution for crisp apple look
    const fontSize = 48;
    const padding = 40;
    const lineHeight = 64;

    // Calculate required size
    context.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
    let maxWidth = 0;
    lines.forEach((line) => {
      const w = context.measureText(line).width;
      if (w > maxWidth) maxWidth = w;
    });

    canvas.width = maxWidth + padding * 2;
    canvas.height = lines.length * lineHeight + padding * 1.5;

    // Redraw because resizing clears canvas
    // Re-set font
    context.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";

    // 1. Draw Liquid Glass Background
    // Rounded Rectangle
    const radius = 30;
    const x = 0;
    const y = 0;
    const w = canvas.width;
    const h = canvas.height;

    // Gradient fill (Glassy)
    const gradient = context.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.25)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0.1)");

    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + w - radius, y);
    context.quadraticCurveTo(x + w, y, x + w, y + radius);
    context.lineTo(x + w, y + h - radius);
    context.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    context.lineTo(x + radius, y + h);
    context.quadraticCurveTo(x, y + h, x, y + h - radius);
    context.lineTo(x, y + radius);
    context.quadraticCurveTo(x, y, x + radius, y);
    context.closePath();

    // Shadow for depth
    context.shadowColor = "rgba(0, 0, 0, 0.15)";
    context.shadowBlur = 15;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 5;

    context.fillStyle = gradient;
    context.fill();

    // Border (Frosty edge)
    context.shadowColor = "transparent"; // clear shadow for border
    context.strokeStyle = "rgba(255, 255, 255, 0.4)";
    context.lineWidth = 2;
    context.stroke();

    // 2. Draw Text
    context.shadowColor = "rgba(0,0,0,0.2)";
    context.shadowBlur = 4;
    context.fillStyle = "#ffffff";

    const startY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, index) => {
      context.fillText(line, canvas.width / 2, startY + index * lineHeight);
    });

    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(material);

    // Position
    sprite.position.copy(position);

    // Scale down - "Small and very little"
    // Maintain aspect ratio
    const scaleFactor = 0.0025; // Scale pixels to world units (very small)
    sprite.scale.set(
      canvas.width * scaleFactor,
      canvas.height * scaleFactor,
      1,
    );

    scene.add(sprite);
    textLabels.push(sprite);

    return sprite;
  }

  function createTextLabel(text, position) {
    // Determine canvas size based on text length
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    // Config
    const fontSize = 48;
    const paddingH = 50;
    const paddingV = 25;

    context.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
    const textWidth = context.measureText(text).width;

    canvas.width = textWidth + paddingH * 2;
    canvas.height = fontSize + paddingV * 2;

    // Reset Context after resize
    context.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";

    // 1. Draw Liquid Glass Background
    const radius = 25; // Fully rounded sides if height is close? Or just rounded rect
    const w = canvas.width;
    const h = canvas.height;

    // Gradient
    const gradient = context.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.25)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0.1)");

    context.beginPath();
    // RoundRect
    if (context.roundRect) {
      context.roundRect(0, 0, w, h, radius);
    } else {
      // Fallback for browsers not supporting roundRect
      context.moveTo(radius, 0);
      context.lineTo(w - radius, 0);
      context.quadraticCurveTo(w, 0, w, radius);
      context.lineTo(w, h - radius);
      context.quadraticCurveTo(w, h, w - radius, h);
      context.lineTo(radius, h);
      context.quadraticCurveTo(0, h, 0, h - radius);
      context.lineTo(0, radius);
      context.quadraticCurveTo(0, 0, radius, 0);
    }

    // Shadow
    context.shadowColor = "rgba(0, 0, 0, 0.15)";
    context.shadowBlur = 10;
    context.shadowOffsetY = 4;

    context.fillStyle = gradient;
    context.fill();

    // Border
    context.shadowColor = "transparent";
    context.strokeStyle = "rgba(255, 255, 255, 0.4)";
    context.lineWidth = 2;
    context.stroke();

    // 2. Draw Text
    context.fillStyle = "#ffffff";
    context.shadowColor = "rgba(0,0,0,0.2)";
    context.shadowBlur = 4;
    context.fillText(text, w / 2, h / 2 + 2); // Slight offset for baseline adjustment

    // Create texture
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(material);

    // Position
    sprite.position.copy(position);

    // Scale - small
    const scaleFactor = 0.0025;
    sprite.scale.set(
      canvas.width * scaleFactor,
      canvas.height * scaleFactor,
      1,
    );

    scene.add(sprite);
    textLabels.push(sprite);

    return sprite;
  }

  function createDestinationMarker() {
    // Permanent circular marker
    const markerGeometry = new THREE.RingGeometry(0.2, 0.3, 32);
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });
    destinationMarker = new THREE.Mesh(markerGeometry, markerMaterial);
    destinationMarker.rotation.x = -Math.PI / 2;
    destinationMarker.position.y = 0.05; // Slightly above floor
    destinationMarker.visible = false;
    scene.add(destinationMarker);

    // Animated ripple effect
    const rippleGeometry = new THREE.RingGeometry(0.15, 0.25, 32);
    const rippleMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1.0,
    });
    markerRipple = new THREE.Mesh(rippleGeometry, rippleMaterial);
    markerRipple.rotation.x = -Math.PI / 2;
    markerRipple.position.y = 0.1; // Slightly above marker
    markerRipple.visible = false;
    markerRipple.userData = {
      animationTime: 0,
      isAnimating: false,
    };
    scene.add(markerRipple);
  }

  // createEnvironmentalModels removed

  function checkInteraction() {
    // Exhaustive guards: Exit if ANY pause state is active
    if (isPaused || showGameOverModal || isLoading || !model) return;

    // Use a larger proximity threshold for "being near something"
    // But check actual distance to the HITBOX surface for interaction
    const searchRadius = 3.0;
    const playerPos = model.position.clone();

    // Helper to check distance to an object's hitbox
    const isTouching = (obj, distanceThreshold = 0.8) => {
      if (!obj) return false;
      const hitbox = obj.getObjectByName("hitbox");
      if (!hitbox) {
        // Fallback to center distance if no hitbox
        const d = new THREE.Vector2(obj.position.x, obj.position.z).distanceTo(
          new THREE.Vector2(playerPos.x, playerPos.z),
        );
        return d < distanceThreshold;
      }

      // Update matrices to ensure world bounds are correct
      hitbox.updateWorldMatrix(true, false);
      const box = new THREE.Box3().setFromObject(hitbox);

      // Expand box slightly for interaction zone? Or just measure distance
      // distanceToPoint returns 0 if inside
      const dist = box.distanceToPoint(playerPos);
      return dist < distanceThreshold;
    };

    // Check Cartouches
    for (const cube of cubes) {
      if (cube === portfolioCartouche) continue; // Skip portfolio cartouche in general loop
      if (isTouching(cube, 0.8)) {
        // Cooldown check for proximity triggers to prevent re-opening immediately after closing
        if (Date.now() - lastPauseExitTime < 1500) return;
        // 0.8 meter reach
        // Stop movement
        isMoving = false;
        targetPosition = null;
        targetObject = null;
        hideDestinationMarker();
        if (activeAction !== actions["Idle"] && !isPlayingOneShotAnimation) {
          fadeToAction("Idle", 0.2);
        }

        contactModalState.set({ isOpen: true, title: "Jogos" });
        return;
      }
    }

    // Check Miku
    if (isTouching(sphere, 1.2)) {
      isMoving = false;
      targetPosition = null;
      targetObject = null;
      hideDestinationMarker();
      if (activeAction !== actions["Idle"] && !isPlayingOneShotAnimation) {
        fadeToAction("Idle", 0.2);
      }

      // Face Miku
      const direction = new THREE.Vector3()
        .subVectors(sphere.position, model.position)
        .normalize();
      const targetRotation = Math.atan2(direction.x, direction.z);
      const q = new THREE.Quaternion();
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetRotation);
      model.quaternion.copy(q);

      startDialogue("miku");
      return;
    }

    // Check Clown
    if (isTouching(clown, 1.2)) {
      isMoving = false;
      targetPosition = null;
      targetObject = null;
      hideDestinationMarker();
      if (activeAction !== actions["Idle"] && !isPlayingOneShotAnimation) {
        fadeToAction("Idle", 0.2);
      }

      // Face Clown
      const direction = new THREE.Vector3()
        .subVectors(clown.position, model.position)
        .normalize();
      const targetRotation = Math.atan2(direction.x, direction.z);
      const q = new THREE.Quaternion();
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetRotation);
      model.quaternion.copy(q);

      startDialogue("clown");
      return;
    }

    // Check Welcome Sign
    if (isTouching(welcomeSign, 1.2)) {
      // Cooldown check for proximity triggers
      if (Date.now() - lastPauseExitTime < 1500) return;
      isMoving = false;
      targetPosition = null;
      targetObject = null;
      hideDestinationMarker();
      if (activeAction !== actions["Idle"] && !isPlayingOneShotAnimation) {
        fadeToAction("Idle", 0.2);
      }

      // Face Sign
      const direction = new THREE.Vector3()
        .subVectors(welcomeSign.position, model.position)
        .normalize();
      const targetRotation = Math.atan2(direction.x, direction.z);
      const q = new THREE.Quaternion();
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetRotation);
      model.quaternion.copy(q);

      portfolioModalState.set({ isOpen: true, activeTab: "welcome" });
      return;
    }

    // Check Portfolio Cartouche (explicit, not part of the generic cubes loop)
    if (portfolioCartouche) {
      // Use simpler 2D distance check - floating cartouche hitbox can be unreliable
      const dx = model.position.x - portfolioCartouche.position.x;
      const dz = model.position.z - portfolioCartouche.position.z;
      const dist2D = Math.sqrt(dx * dx + dz * dz);
      if (dist2D < 1.3) {
        if (Date.now() - lastPauseExitTime < 1500) return;
        isMoving = false;
        targetPosition = null;
        targetObject = null;
        hideDestinationMarker();
        if (activeAction !== actions["Idle"] && !isPlayingOneShotAnimation) {
          fadeToAction("Idle", 0.2);
        }

        // Face Cartouche
        const direction = new THREE.Vector3()
          .subVectors(portfolioCartouche.position, model.position)
          .normalize();
        const targetRotation = Math.atan2(direction.x, direction.z);
        const q = new THREE.Quaternion();
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetRotation);
        model.quaternion.copy(q);

        portfolioModalState.set({ isOpen: true, activeTab: "jogos" });
        return;
      }
    }
  }

  function updateInteractionHint() {
    if (showModal || showDialogue || !model || !camera) {
      interactionHint.visible = false;
      return;
    }

    const playerPos = model.position.clone();
    let closestDist = Infinity;
    let closestObj = null;
    let hintText = "";

    // Candidate objects
    const candidates = [
      { obj: sphere, name: "Miku", radius: 1.3 }, // Reduced from 2.0 to match trigger (1.2)
      { obj: clown, name: "Paiaço", radius: 1.3 },
      { obj: welcomeSign, name: "Bem Vindo", radius: 1.3 },
      { obj: portfolioCartouche, name: "Portfólio", radius: 1.3 }, // Explicit portfolio candidate
      ...cubes
        .filter((c) => c !== portfolioCartouche)
        .map((c) => ({ obj: c, name: "Cartouche", radius: 1.0 })),
    ];

    for (const item of candidates) {
      if (!item.obj) continue;

      // Simple distance check to object position
      // For cartouches, they are small, so center distance is fine.
      // For characters, they are also roughly 1 unit wide.
      const dist = new THREE.Vector2(
        item.obj.position.x,
        item.obj.position.z,
      ).distanceTo(new THREE.Vector2(playerPos.x, playerPos.z));

      if (dist < item.radius && dist < closestDist) {
        closestDist = dist;
        closestObj = item;
      }
    }

    if (closestObj) {
      activeInteractiveObject = closestObj.obj;

      // Calculate screen position
      // We want the hint slightly above the object
      const hintPos = closestObj.obj.position.clone();
      hintPos.y += 2.0; // Adjust height based on object type if needed

      // Project to 2D
      hintPos.project(camera);

      const x = (hintPos.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-(hintPos.y * 0.5) + 0.5) * window.innerHeight;

      interactionHint.visible = true;
      interactionHint.x = x;
      interactionHint.y = y;

      const keyText = isMobile ? "" : "Espaço";
      interactionHint.text = isMobile
        ? "Interagir"
        : `Pressione Espaço para Interagir`;
      interactionHint.isMobile = isMobile;
    } else {
      interactionHint.visible = false;
      activeInteractiveObject = null;
    }
  }

  function closeModal() {
    showModal = false;
    currentProject = null;
    currentImageIndex = 0;
  }

  function nextImage() {
    if (currentProject && currentProject.images) {
      currentImageIndex =
        (currentImageIndex + 1) % currentProject.images.length;
    }
  }

  function prevImage() {
    if (currentProject && currentProject.images) {
      currentImageIndex =
        (currentImageIndex - 1 + currentProject.images.length) %
        currentProject.images.length;
    }
  }

  function goToImage(index) {
    currentImageIndex = index;
  }

  function onWindowResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function onKeyDown(event) {
    if (
      document.activeElement.tagName === "INPUT" ||
      document.activeElement.tagName === "TEXTAREA"
    ) {
      return;
    }

    switch (event.key.toLowerCase()) {
      case "w":
        keys.w = true;
        break;
      case "a":
        keys.a = true;
        break;
      case "s":
        keys.s = true;
        break;
      case "d":
        keys.d = true;
        break;
      case " ":
        if (activeInteractiveObject) {
          // If near an object, Space interacts (stop moving first)
          isMoving = false;
          targetPosition = null;
          targetObject = null;
          checkInteraction();
        } else {
          // Otherwise, Jump
          keys.space = true;
        }
        break;
      case "shift":
        keys.shift = true;
        break;
      case "e":
      case "enter":
        checkInteraction();
        break;
      case "1":
        toggleFireballMode();
        break;
      case "2":
        toggleThunderMode();
        break;
      case "f3":
        toggleFirstPerson();
        break;
    }
  }

  function toggleFirstPerson() {
    isFirstPerson = !isFirstPerson;
    if (isFirstPerson) {
      document.body.requestPointerLock();
    } else {
      document.exitPointerLock();
    }
  }

  function onMouseMove(event) {
    if (isFirstPerson && document.pointerLockElement === document.body) {
      cameraRotation.y -= event.movementX * 0.002;
      cameraRotation.x -= event.movementY * 0.002;
      // Clamp pitch to avoid flipping
      cameraRotation.x = Math.max(
        -Math.PI / 2,
        Math.min(Math.PI / 2, cameraRotation.x),
      );
    }
  }

  function toggleFireballMode() {
    attackMode = attackMode === "fireball" ? null : "fireball";
  }

  function toggleThunderMode() {
    attackMode = attackMode === "thunder" ? null : "thunder";
  }

  function onKeyUp(event) {
    if (
      document.activeElement.tagName === "INPUT" ||
      document.activeElement.tagName === "TEXTAREA"
    ) {
      return;
    }

    switch (event.key.toLowerCase()) {
      case "w":
        keys.w = false;
        break;
      case "a":
        keys.a = false;
        break;
      case "s":
        keys.s = false;
        break;
      case "d":
        keys.d = false;
        break;
      case " ":
        keys.space = false;
        break;
      case "shift":
        keys.shift = false;
        break;
    }
  }

  function addDynamicHitbox(object, padding = 0) {
    // Store original transforms
    const originalPosition = object.position.clone();
    const originalQuaternion = object.quaternion.clone();
    const originalScale = object.scale.clone();

    // Reset transform to Identity to get Local Axis-Aligned Bounding Box
    // This allows us to create a hitbox that fits the object's contents
    // and is attached TO the object, automatically handling future rotation/scaling.
    object.position.set(0, 0, 0);
    object.quaternion.set(0, 0, 0, 1);
    object.scale.set(1, 1, 1);
    object.updateWorldMatrix(true, true);

    const box = new THREE.Box3();
    box.setFromObject(object);

    // Restore transforms
    object.position.copy(originalPosition);
    object.quaternion.copy(originalQuaternion);
    object.scale.copy(originalScale);
    object.updateWorldMatrix(true, true); // Restore matrix

    // If box is empty, fallback or return
    if (box.isEmpty()) return;

    // Get dimensions (Since object was 1,1,1, this is the unscaled local size)
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    // Apply padding (relative to unscaled size)
    size.addScalar(padding);

    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });

    // Check for existing hitbox
    const old = object.getObjectByName("hitbox");
    if (old) object.remove(old);

    const hitbox = new THREE.Mesh(geometry, material);
    hitbox.name = "hitbox";
    hitbox.userData.isHitbox = true;

    // Position current center matches the box center
    hitbox.position.copy(center);

    object.add(hitbox);
  }

  function handleCanvasClick(event) {
    if (showModal || showDialogue) return;

    const mouse = new THREE.Vector2();
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    // Filter out sprites
    const eligibleObjects = scene.children.filter(
      (child) => !(child instanceof THREE.Sprite),
    );
    const intersects = raycaster.intersectObjects(eligibleObjects, true);

    if (intersects.length > 0) {
      const hit = intersects[0];
      let object = hit.object;

      // Direct Hitbox Check
      if (object.name === "hitbox") {
        object = object.parent;
      }

      // Traverse up to find the interactive object
      while (
        object.parent &&
        object.name !== "interactive_zombie" &&
        object.name !== "interactive_cube" &&
        object.name !== "interactive_sphere" &&
        object.name !== "interactive_clown" &&
        object.name !== "interactive_welcome" &&
        object.name !== "interactive_portfolio" &&
        object.name !== "floor" &&
        object.name !== "environment_mesh"
      ) {
        object = object.parent;
      }

      // Add visual feedback for interactive objects
      if (
        object.name === "interactive_cube" ||
        object.name === "interactive_sphere" ||
        object.name === "interactive_clown" ||
        object.name === "interactive_welcome" ||
        object.name === "interactive_portfolio"
      ) {
        addClickFeedback(object, hit.point);
      }

      // Handle Map Click (Movement or Attack)
      if (
        object.name === "floor" ||
        object.name === "environment_mesh" ||
        object.name === "map_root"
      ) {
        if (attackMode) {
          performAttack(hit.point);
        } else {
          targetPosition = hit.point;
          targetObject = null;
          isMoving = true;
          showDestinationMarker(hit.point);
        }
      }
      // Handle Interactive Objects
      else if (object.name === "interactive_zombie") {
        if (attackMode) {
          performAttack(hit.point);
        }
      } else if (object.name === "interactive_cube") {
        // Walk to cartouche like Miku/Clown
        const direction = new THREE.Vector3()
          .subVectors(object.position, model.position)
          .normalize();
        targetPosition = object.position
          .clone()
          .sub(direction.multiplyScalar(0.7)); // Closer
        // Don't force Y=0, let gravity handle it
        // targetPosition.y = 0;

        targetObject = object;
        isMoving = true;
        showDestinationMarker(targetPosition);
      } else if (object.name === "interactive_sphere") {
        const direction = new THREE.Vector3()
          .subVectors(object.position, model.position)
          .normalize();
        targetPosition = object.position
          .clone()
          .sub(direction.multiplyScalar(0.8)); // Closer
        // targetPosition.y = 0;

        targetObject = object;
        isMoving = true;
        showDestinationMarker(targetPosition);
      } else if (object.name === "interactive_clown") {
        const direction = new THREE.Vector3()
          .subVectors(object.position, model.position)
          .normalize();
        targetPosition = object.position
          .clone()
          .sub(direction.multiplyScalar(0.8)); // Closer
        // targetPosition.y = 0;

        targetObject = object;
        isMoving = true;
        showDestinationMarker(targetPosition);
      } else if (
        object.name === "interactive_welcome" ||
        object.name === "interactive_portfolio"
      ) {
        // Walk to welcome sign or portfolio cartouche
        const direction = new THREE.Vector3()
          .subVectors(object.position, model.position)
          .normalize();
        targetPosition = object.position
          .clone()
          .sub(direction.multiplyScalar(0.9)); // Closer
        // targetPosition.y = 0;

        targetObject = object;
        isMoving = true;
        showDestinationMarker(targetPosition);
      }
    }
  }

  function addClickFeedback(object, clickPoint) {
    // Add outline effect to the object
    object.traverse((child) => {
      if (child.isMesh && child.name !== "hitbox") {
        // Ignore hitbox
        // Store original emissive color on the MATERIAL to handle shared materials
        if (!child.material.userData.originalEmissive) {
          child.material.userData.originalEmissive = child.material.emissive
            ? child.material.emissive.clone()
            : new THREE.Color(0x000000);
          child.material.userData.originalEmissiveIntensity =
            child.material.emissiveIntensity !== undefined
              ? child.material.emissiveIntensity
              : 0;
        }

        // Flash emissive color
        if (child.material.emissive) {
          child.material.emissive.setHex(0xffffff);
          child.material.emissiveIntensity = 0.5;
        }
      }
    });

    // Reset emissive after a short delay
    setTimeout(() => {
      object.traverse((child) => {
        if (child.isMesh && child.name !== "hitbox") {
          // Restore from MATERIAL userData
          if (child.material.userData.originalEmissive) {
            if (child.material.emissive) {
              child.material.emissive.copy(
                child.material.userData.originalEmissive,
              );
              child.material.emissiveIntensity =
                child.material.userData.originalEmissiveIntensity;
            }
          }
        }
      });
    }, 300);
  }
  function fadeToAction(name, duration) {
    previousAction = activeAction;
    activeAction = actions[name];

    if (previousAction !== activeAction) {
      previousAction.fadeOut(duration);
      activeAction.reset().fadeIn(duration).play();
    }
  }

  function handleJoystickStart(e) {
    if (!isMobile) return;
    const touch = e.changedTouches[0];
    joystickActive = true;
    joystickData.originX = touch.clientX;
    joystickData.originY = touch.clientY;
    joystickData.x = 0;
    joystickData.y = 0;
  }

  function handleJoystickMove(e) {
    if (!joystickActive) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - joystickData.originX;
    const dy = touch.clientY - joystickData.originY;
    const maxDist = 50; // Max radius
    const dist = Math.min(Math.sqrt(dx * dx + dy * dy), maxDist);
    const angle = Math.atan2(dy, dx);

    const stickX = Math.cos(angle) * dist;
    const stickY = Math.sin(angle) * dist;

    // Normalize input -1 to 1
    joystickData.x = stickX / maxDist;
    joystickData.y = stickY / maxDist;

    // Update UI
    if (joystickStick) {
      joystickStick.style.transform = `translate(${stickX}px, ${stickY}px)`;
    }
  }

  function handleJoystickEnd(e) {
    joystickActive = false;
    joystickData.x = 0;
    joystickData.y = 0;
    if (joystickStick) {
      joystickStick.style.transform = `translate(0px, 0px)`;
    }
  }

  function updatePlayer(delta) {
    if (isLoading || isInDialogue || showModal || !model) return;

    // 1. Input Handling
    const inputVector = new THREE.Vector3();

    // WASD Input
    // WASD Input OR Joystick
    const moveActive =
      keys.w ||
      keys.s ||
      keys.a ||
      keys.d ||
      joystickData.x !== 0 ||
      joystickData.y !== 0;

    if (moveActive) {
      // Cancel Click-Move
      if (targetPosition || isMoving) {
        targetPosition = null;
        isMoving = false;
        targetObject = null;
        hideDestinationMarker();
      }

      let dx = 0;
      let dz = 0;

      if (keys.w) dz -= 1;
      if (keys.s) dz += 1;
      if (keys.a) dx -= 1;
      if (keys.d) dx += 1;

      // Add Joystick Input (Scale if needed)
      dx += joystickData.x;
      dz += joystickData.y;

      inputVector.set(dx, 0, dz);

      // Clamp to length 1
      if (inputVector.lengthSq() > 1) inputVector.normalize();
    }
    // Click-Move Input
    else if (targetPosition && isMoving) {
      const playerPosFlat = new THREE.Vector3(
        model.position.x,
        0,
        model.position.z,
      );
      const targetPosFlat = new THREE.Vector3(
        targetPosition.x,
        0,
        targetPosition.z,
      );

      if (playerPosFlat.distanceTo(targetPosFlat) < 0.2) {
        isMoving = false;
        targetPosition = null;
        hideDestinationMarker();
        if (targetObject) {
          if (targetObject.name === "interactive_cube")
            contactModalState.set({ isOpen: true, title: "Jogos" });
          else if (targetObject.name === "interactive_sphere")
            startDialogue("miku");
          else if (targetObject.name === "interactive_clown")
            startDialogue("clown");
          else if (targetObject.name === "interactive_welcome")
            portfolioModalState.set({ isOpen: true, activeTab: "welcome" });
          else if (targetObject.name === "interactive_portfolio")
            portfolioModalState.set({ isOpen: true, activeTab: "jogos" });

          const dir = new THREE.Vector3()
            .subVectors(targetObject.position, model.position)
            .normalize();
          dir.y = 0;
          if (dir.lengthSq() > 0) {
            const q = new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 1, 0),
              Math.atan2(dir.x, dir.z),
            );
            model.quaternion.copy(q);
          }
          targetObject = null;
        }
      } else {
        inputVector.subVectors(targetPosFlat, playerPosFlat).normalize();
      }
    }

    // 2. Friction / Damping (Ground vs Air)
    let damping = Math.exp(-4 * delta) - 1;

    if (playerOnFloor) {
      if (inputVector.lengthSq() === 0) {
        // High friction when stopping (Anti-Ice)
        damping = Math.exp(-15 * delta) - 1;

        // Trigger Dust if stopping from speed
        if (playerVelocity.lengthSq() > 5) {
          createDust(model.position);
        }
      }
    } else {
      playerVelocity.y -= GRAVITY * delta;
      damping *= 0.1; // Less friction in air
    }

    playerVelocity.addScaledVector(playerVelocity, damping);

    // 3. Acceleration
    if (inputVector.lengthSq() > 0) {
      inputVector.normalize();
      playerDirection.copy(inputVector);

      const targetRotation = Math.atan2(playerDirection.x, playerDirection.z);
      const q = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        targetRotation,
      );
      model.quaternion.slerp(q, ROTATION_SPEED * delta);

      const speed = playerOnFloor ? MOVE_SPEED : MOVE_SPEED * 0.2;
      playerVelocity.add(inputVector.multiplyScalar(speed * delta));
    }

    // 4. Apply Velocity to Collider
    const deltaPosition = playerVelocity.clone().multiplyScalar(delta);
    playerCollider.translate(deltaPosition);

    // 5. Collision Resolution
    playerCollisions();
    keepPlayerInPlayArea();

    // 6. Sync Model
    model.position.copy(playerCollider.start);
    model.position.y -= 0.35;

    // 7. Logic Updates
    if (playerOnFloor) {
      // Just Landed
      if (!isGrounded && playerVelocity.y < -2.0) {
        createDust(model.position);
      }

      if (keys.space) {
        playerVelocity.y = JUMP_FORCE;
        playerOnFloor = false;
        playJumpSound();
      }
    }

    isGrounded = playerOnFloor;
    updateAnimations(inputVector);
  }

  function playerCollisions() {
    // Mapa inteiro (chão, falésias, pedras, troncos) está num único octree
    const result1 = worldOctree.capsuleIntersect(playerCollider);

    playerOnFloor = false;

    if (result1) {
      playerOnFloor = result1.normal.y > 0.35;
      if (!playerOnFloor) {
        playerVelocity.addScaledVector(
          result1.normal,
          -result1.normal.dot(playerVelocity),
        );
      }
      playerCollider.translate(result1.normal.multiplyScalar(result1.depth));
    }

    // Original single-check logic removal
    // if (result) { ... }

    // --- Dynamic Obstacle Collision (Spheres vs Player Capsule) ---
    // We treat obstacles as infinite vertical cylinders for movement, OR valid spheres.
    // Given the requirement "can't be running through their meshes", and they are standing on ground...
    // simpler 2D distance check (or 3D sphere vs Capsule) works.
    // Let's use 3D Sphere vs Capsule for robustness, assuming obstacles are roughly player height.

    for (const obstacle of collisionObstacles) {
      // Ignorar colisão de entidades mortas (ex: zombie)
      if (obstacle.object && obstacle.object.userData?.isDead) continue;

      // Find closest point on capsule line segment to obstacle center
      _vector.copy(obstacle.position); // Obstacle center
      // Obstacle Y might be 0 (ground). If it's 0, sphere is half-buried.
      // Let's adjust obstacle center to be "body height" if it's too low.
      // Most pivots are at feet. So effectively we want a cylinder check.
      // We can clamp the obstacle Y to be within the player's vertical range for the distance check.

      const playerBottom = playerCollider.start.y;
      const playerTop = playerCollider.end.y;

      // Clamp obstacle Y to be within player's height range (effectively a cylinder check)
      // center.y is modified just for the distance calculation
      const clampedY = Math.max(
        playerBottom,
        Math.min(playerTop, obstacle.position.y + 1.0), // Assume body center ~ 1m up if pivot is 0
      );
      // Actually, if we want strict cylinder, we just ignore Y completely (2D distance).
      // Let's do 2D distance for robust "blocking".
      // ... But we might want to jump OVER things?
      // Miku is tall, Cartouche is floating.
      // Let's use the explicit radius.

      // Hybrid: Check 2D distance first.
      const distSq =
        (playerCollider.start.x - obstacle.position.x) ** 2 +
        (playerCollider.start.z - obstacle.position.z) ** 2;

      const combinedRadius = playerCollider.radius + obstacle.radius;

      if (distSq < combinedRadius * combinedRadius) {
        // Collision detected (2D projection)
        const dist = Math.sqrt(distSq);
        const overlap = combinedRadius - dist;

        // Normal vector pointing AWAY from obstacle
        _diff
          .set(
            playerCollider.start.x - obstacle.position.x,
            0,
            playerCollider.start.z - obstacle.position.z,
          )
          .normalize();

        // If centers are exactly same (rare), pick random direction
        if (dist < 0.001) _diff.set(1, 0, 0);

        // Displace player
        // We assume massive obstacles (player moves, obstacle stays)
        const displacement = _diff.multiplyScalar(overlap);
        playerCollider.translate(displacement);

        // Kill velocity into the obstacle
        // Project velocity onto normal
        const vDotN = playerVelocity.dot(_diff);
        if (vDotN < 0) {
          // Moving towards obstacle
          // Remove that component
          _vector.copy(_diff).multiplyScalar(vDotN);
          playerVelocity.sub(_vector);
        }
      }
    }
  }

  function keepPlayerInPlayArea() {
    const p = playerCollider.start;

    // Caiu do mapa (não deveria acontecer): volta pro spawn
    if (p.y < -10) {
      playerCollider.start.set(MAP_POI.spawn.x, 0.33, MAP_POI.spawn.z);
      playerCollider.end.set(MAP_POI.spawn.x, 1.33, MAP_POI.spawn.z);
      playerVelocity.set(0, 0, 0);
      _lastSafePlayerPos.copy(playerCollider.start);
      return;
    }

    if (isInsidePlayArea(p.x, p.z)) {
      _lastSafePlayerPos.copy(p);
      return;
    }

    // Atravessou a falésia: desfaz o movimento horizontal
    _safeDelta.subVectors(_lastSafePlayerPos, p);
    _safeDelta.y = Math.max(0, _safeDelta.y);
    playerCollider.translate(_safeDelta);
    playerVelocity.x = 0;
    playerVelocity.z = 0;
    if (isMoving) {
      isMoving = false;
      targetPosition = null;
      targetObject = null;
      hideDestinationMarker();
    }
  }

  // Backward compatibility alias
  // Backward compatibility alias
  const updateMovement = updatePlayer;

  function updateAnimations(inputVector) {
    if (!isGrounded && playerVelocity.y < -2) {
      if (activeAction !== actions["Fall"]) fadeToAction("Fall", 0.1);
      return;
    }
    if (inputVector.lengthSq() > 0.01) {
      if (activeAction !== actions["Walking"]) fadeToAction("Walking", 0.2);
      if (isGrounded) {
        const currentTime = clock.getElapsedTime();
        if (currentTime - lastStepTime > 0.3) {
          playStepSound();
          lastStepTime = currentTime;
        }
      }
    } else {
      if (activeAction !== actions["Idle"] && !isPlayingOneShotAnimation) {
        fadeToAction("Idle", 0.2);
      }
    }
  }

  function updateCamera() {
    if (!model) return;

    if (isTakingSelfie && sphere) {
      const pToM = new THREE.Vector3()
        .subVectors(sphere.position, model.position)
        .normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(pToM, up).normalize();
      const isMobile = window.innerWidth < 768;
      const topViewOffset = 0.5; // Slight top-down view
      // User requested "much closer and low"
      // Previous: distance 4.0, y + 2.2
      // New: distance 1.8, y + 1.2
      const cameraDistance = isMobile ? 2.0 : 1.8;
      const selfieCamPos = sphere.position
        .clone()
        .add(pToM.multiplyScalar(cameraDistance))
        // Move camera slightly to the side (right) to frame both better?
        // Original: right * -1.8. Let's keep it but maybe reduce if we are closer
        .add(right.multiplyScalar(-0.6)); // Reduced side offset since we are closer

      selfieCamPos.y = sphere.position.y + 0.8; // Much lower (approx Miku's eye level or lower)
      camera.position.lerp(selfieCamPos, 0.1);

      // Look at a point between them?
      // User said "Miku selfie camera...".
      // Usually a selfie is high-up looking down, but user said "low".
      // Let's target Miku's face height.
      const lookAtPos = sphere.position
        .clone()
        .add(new THREE.Vector3(0, 0.8, 0)); // Look at Miku's head height
      camera.lookAt(lookAtPos);
    } else if (isInDialogue) {
      // Unified Over-the-Shoulder Camera for NPCs (Miku & Clown)
      if (currentNPC === "miku" || currentNPC === "clown") {
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(
          model.quaternion,
        );
        const back = new THREE.Vector3(0, 0, 1).applyQuaternion(
          model.quaternion,
        );
        const shoulderPos = model.position
          .clone()
          .add(right.multiplyScalar(0.7)) // 0.7m right
          .add(back.multiplyScalar(-1.3)) // -1.3m back (Over shoulder)
          .add(new THREE.Vector3(0, 0.1, 0)); // Slightly up

        camera.position.lerp(shoulderPos, 0.1);

        // Determine Look At Target
        let targetPos = null;
        if (currentNPC === "miku" && sphere) {
          // Miku head offset
          targetPos = sphere.position.clone().add(new THREE.Vector3(0, 0.7, 0));
        } else if (currentNPC === "clown" && clown) {
          // Clown head offset (Clown is scaled 0.6, roughly similar height or slightly shorter)
          targetPos = clown.position.clone().add(new THREE.Vector3(0, 0.8, 0));
        }

        if (targetPos) {
          camera.lookAt(targetPos);
        }
      } else {
        // Fallback/Standard dialogue camera (Front view) for others (e.g. Welcome Sign)
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(
          model.quaternion,
        );
        const back = new THREE.Vector3(0, 0, 1).applyQuaternion(
          model.quaternion,
        );
        const dialogueCamPos = model.position
          .clone()
          .add(right.multiplyScalar(2.5))
          .sub(back.multiplyScalar(4.0))
          .add(new THREE.Vector3(0, 2.0, 0));
        const lookAtPos = model.position
          .clone()
          .add(new THREE.Vector3(0, 1.3, 0));
        camera.position.lerp(dialogueCamPos, 0.05);

        const currentLookAt = new THREE.Vector3();
        camera.getWorldDirection(currentLookAt);
        currentLookAt.multiplyScalar(10).add(camera.position);
        currentLookAt.lerp(lookAtPos, 0.05);
        camera.lookAt(currentLookAt);
      }
    } else if (isFirstPerson) {
      // First Person View
      const headOffset = new THREE.Vector3(0, 1.6, 0); // Head height
      const targetCamPos = model.position.clone().add(headOffset);
      camera.position.copy(targetCamPos);

      // Apply rotation
      const euler = new THREE.Euler(0, 0, 0, "YXZ");
      euler.x = cameraRotation.x;
      euler.y = cameraRotation.y;
      camera.quaternion.setFromEuler(euler);
    } else {
      const offset = new THREE.Vector3(0, 5, 5);
      const targetCamPos = model.position.clone().add(offset);
      camera.position.lerp(targetCamPos, 0.05);
      camera.lookAt(model.position);
    }
  }

  function startDialogue(npc) {
    currentNPC = npc;
    isInDialogue = true;
    showDialogue = true;
    showButtons = false;
    showTextInput = false;
    displayedText = "";
    playerJoke = "";

    if (npc === "miku") {
      fullText = "Eai mano, tô tirando uma selfie, quer entrar tambem?";
    } else if (npc === "clown") {
      fullText = "Eu num... hihi... tô fazendo nada, mim conta uma piada?";
      // Play waving animation
      if (clownActions["waving"]) {
        if (clownActions["happy"]) clownActions["happy"].fadeOut(0.2);
        clownActions["waving"]
          .reset()
          .setLoop(THREE.LoopOnce, 1).clampWhenFinished = true;
        clownActions["waving"].play();
      }
    }

    typeEffect();
  }

  function typeEffect() {
    let i = 0;
    if (typingInterval) clearInterval(typingInterval);

    typingInterval = setInterval(() => {
      displayedText += fullText.charAt(i);
      playTypeSound();
      i++;
      if (i > fullText.length - 1) {
        clearInterval(typingInterval);
        if (currentNPC === "miku") {
          showButtons = true;
        } else if (currentNPC === "clown") {
          // Show text input only if we haven't received a joke yet
          if (!showCloseButton) {
            showTextInput = true;
          } else {
            // Show close button after clown's response
            showButtons = true;
          }
        }
      }
    }, 50);
  }

  function playTypeSound() {
    const soundIndex = Math.floor(Math.random() * typeSounds.length);
    const sound = typeSounds[soundIndex];
    if (sound) {
      sound.currentTime = 0;
      sound.volume = volType * volMaster;
      sound.play().catch(() => {});
    }
  }

  function playStepSound() {
    const sound = stepSounds[currentStep];
    if (sound) {
      sound.currentTime = 0;
      sound.volume = volStep * volMaster;
      sound.play().catch(() => {});
      currentStep = (currentStep + 1) % stepSounds.length;
    }
  }

  function playJumpSound() {
    if (jumpSound) {
      jumpSound.currentTime = 0;
      jumpSound.volume = volJump * volMaster;
      jumpSound.play().catch(() => {});
    }
  }

  function playOkSound() {
    if (okSound) {
      okSound.currentTime = 0;
      okSound.volume = volOk * volMaster;
      okSound.play().catch(() => {});
    }
  }

  function playByeByeSound() {
    if (byebyeSound) {
      byebyeSound.currentTime = 0;
      byebyeSound.volume = volBye * volMaster;
      byebyeSound.play().catch(() => {});
    }
  }

  function playShutterSound() {
    let s = Math.random() > 0.5 ? shutterSound1 : shutterSound2;
    if (s) {
      s.currentTime = 0;
      s.volume = volShutter * volMaster;
      s.play().catch(() => {});
    }
  }

  // --- NEW SOUND HELPERS ---
  function playZombieIdle() {
    if (zombieIdleSound && volZombie > 0) {
      zombieIdleSound.currentTime = 0;
      zombieIdleSound.volume = volZombie * volMaster;
      zombieIdleSound.play().catch(() => {});
    }
  }

  function playZombieHit() {
    if (zombieHitSound && volZombie > 0) {
      zombieHitSound.currentTime = 0;
      zombieHitSound.volume = volZombie * volMaster;
      zombieHitSound.play().catch(() => {});
    }
  }

  function playZombieDie() {
    if (zombieDieSound && volZombie > 0) {
      zombieDieSound.currentTime = 0;
      zombieDieSound.volume = volZombie * volMaster;
      zombieDieSound.play().catch(() => {});
    }
  }

  function playFireballThrow() {
    if (fireballThrowSound && volFireball > 0) {
      fireballThrowSound.currentTime = 0;
      fireballThrowSound.volume = volFireball * volMaster;
      fireballThrowSound.play().catch(() => {});
    }
  }

  function playFireballHit() {
    if (fireballHitSound && volFireball > 0) {
      fireballHitSound.currentTime = 0;
      fireballHitSound.volume = volFireball * volMaster;
      fireballHitSound.play().catch(() => {});
    }
  }

  function playThunderSound() {
    if (thunderSound && volThunder > 0) {
      thunderSound.currentTime = 0;
      thunderSound.volume = volThunder * volMaster;
      thunderSound.play().catch(() => {});
    }
  }

  let lastVolMaster = 1.0;

  // Helper to apply current master volume to ALL sounds
  function applyVolumes() {
    // Update Background Music
    if (bgMusic) bgMusic.volume = volBgMusic * volMaster;

    // Update Arrays of Sounds
    typeSounds.forEach((s) => (s.volume = volType * volMaster));
    stepSounds.forEach((s) => (s.volume = volStep * volMaster));

    // Update Single Sounds
    if (jumpSound) jumpSound.volume = volJump * volMaster;
    if (okSound) okSound.volume = volOk * volMaster;
    if (byebyeSound) byebyeSound.volume = volBye * volMaster;
    if (shutterSound1) shutterSound1.volume = volShutter * volMaster;
    if (shutterSound2) shutterSound2.volume = volShutter * volMaster;

    // Update New Sounds (Zombie, Powers)
    if (zombieIdleSound) zombieIdleSound.volume = volZombie * volMaster;
    if (zombieHitSound) zombieHitSound.volume = volZombie * volMaster;
    if (zombieDieSound) zombieDieSound.volume = volZombie * volMaster;

    if (fireballThrowSound) fireballThrowSound.volume = volFireball * volMaster;
    if (fireballHitSound) fireballHitSound.volume = volFireball * volMaster;
    if (thunderSound) thunderSound.volume = volThunder * volMaster;
  }

  function toggleMusic() {
    if (volMaster > 0) {
      // MUTE
      lastVolMaster = volMaster; // Save current volume
      volMaster = 0;
      applyVolumes();

      // Also pause music track to save resources/logic
      if (bgMusic) bgMusic.pause();
      isMusicPlaying = false;
    } else {
      // UNMUTE
      volMaster = lastVolMaster || 1.0; // Restore volume
      if (volMaster === 0) volMaster = 1.0; // Safety check
      applyVolumes();

      // Resume music
      if (bgMusic) bgMusic.play().catch(() => {});
      isMusicPlaying = true;
    }
  }

  function updateVolume(event) {
    volMaster = parseFloat(event.target.value);
    applyVolumes();

    // Auto-update specific mute state if slider dragged to 0
    if (volMaster === 0 && isMusicPlaying) {
      if (bgMusic) bgMusic.pause();
      isMusicPlaying = false;
    } else if (volMaster > 0 && !isMusicPlaying) {
      if (bgMusic) bgMusic.play().catch(() => {});
      isMusicPlaying = true;
    }
  }

  function handleYes() {
    playOkSound(); // Use the new sound function

    if (currentNPC === "miku") {
      takeSelfie();
      return;
    }

    if (actions["Agree"]) {
      // Stop previous action immediately instead of fading out
      if (activeAction && activeAction !== actions["Agree"]) {
        activeAction.stop();
      }

      const agreeAction = actions["Agree"];
      agreeAction.reset();
      agreeAction.setLoop(THREE.LoopOnce, 1);
      agreeAction.clampWhenFinished = true;
      agreeAction.timeScale = 1;
      agreeAction.play();

      activeAction = agreeAction;
      isPlayingOneShotAnimation = true;

      mixer.addEventListener("finished", function restoreIdle(e) {
        if (e.action === agreeAction) {
          mixer.removeEventListener("finished", restoreIdle);
          isPlayingOneShotAnimation = false;
          setTimeout(() => {
            endDialogue();
          }, 100);
        }
      });
    } else {
      endDialogue();
    }
  }

  function handleNo() {
    playByeByeSound(); // Use safe helper

    if (currentNPC === "miku") {
      endDialogue();
      return;
    }

    if (actions["Disagree"]) {
      // Stop previous action immediately instead of fading out
      if (activeAction && activeAction !== actions["Disagree"]) {
        activeAction.stop();
      }

      const disagreeAction = actions["Disagree"];
      disagreeAction.reset();
      disagreeAction.setLoop(THREE.LoopOnce, 1);
      disagreeAction.clampWhenFinished = true;
      disagreeAction.timeScale = 1;
      disagreeAction.play();

      activeAction = disagreeAction;
      isPlayingOneShotAnimation = true;

      mixer.addEventListener("finished", function restoreIdle(e) {
        if (e.action === disagreeAction) {
          mixer.removeEventListener("finished", restoreIdle);
          isPlayingOneShotAnimation = false;
          setTimeout(() => {
            endDialogue();
          }, 100);
        }
      });
    } else {
      endDialogue();
    }
  }

  function takeSelfie() {
    // 1. Hide dialogue UI
    showDialogue = false;

    // 2. Set selfie state to position camera and Miku
    isTakingSelfie = true;

    // 3. Wait for camera to move and Miku to rotate (give it a moment)
    setTimeout(() => {
      // 4. Flash effect
      showFlash = true;

      // Safe sound playback
      if (shutterSound1) {
        shutterSound1.currentTime = 0;
        shutterSound1.volume = volShutter * volMaster;
        shutterSound1.play().catch(() => {});
      }
      if (shutterSound2) {
        shutterSound2.currentTime = 0;
        shutterSound2.volume = volShutter * volMaster;
        shutterSound2.play().catch(() => {});
      }

      // 5. Take screenshot after a slight delay to ensure flash is visible or just before?
      // Actually, we want the screenshot of the scene, NOT the flash overlay.
      // So we take screenshot immediately, then show flash.
      // But we need to wait for the camera to be in position.

      // Let's render once manually to ensure frame is updated if needed,
      // but the animation loop is running so it should be fine.

      // Capture image
      try {
        const dataURL = captureCanvas(renderer, scene, camera);

        // Create download link
        const link = document.createElement("a");
        link.download = "miku-selfie.png";
        link.href = dataURL;
        link.click();
      } catch (e) {
        console.error("Failed to take screenshot:", e);
      }

      // Hide flash after animation
      setTimeout(() => {
        showFlash = false;
        isTakingSelfie = false;
        endDialogue();
      }, 500); // Flash duration
    }, 1000); // Wait 1 second for camera to settle
  }

  function endDialogue() {
    isInDialogue = false;
    showDialogue = false;
    showTextInput = false;
    showButtons = false;
    showCloseButton = false;

    // If closing clown dialogue, return clown to happy animation
    if (currentNPC === "clown" && clownActions && clownActions["happy"]) {
      if (clownActions["laughing"]) clownActions["laughing"].fadeOut(0.3);
      if (clownActions["idle"]) clownActions["idle"].fadeOut(0.3);
      clownActions["happy"].reset().fadeIn(0.5).play();
    }

    currentNPC = null;
    playerJoke = "";
    if (typingInterval) clearInterval(typingInterval);
    if (actions["Idle"]) {
      fadeToAction("Idle", 0.3);
    }
  }

  function handleJokeSubmit() {
    if (!playerJoke.trim()) return;

    // Random algorithm: 50% chance the joke is funny
    const isFunny = Math.random() > 0.5;

    showTextInput = false;
    displayedText = "";

    // Set flag to show close button after response
    showCloseButton = true;

    if (isFunny) {
      fullText = "HAHAHAHA";
      // Play laughing animation and keep it
      if (clownActions["laughing"]) {
        if (clownActions["waving"]) clownActions["waving"].stop();
        if (clownActions["happy"]) clownActions["happy"].fadeOut(0.2);
        const laughAction = clownActions["laughing"];
        laughAction.reset();
        laughAction.setLoop(THREE.LoopRepeat); // Loop the laughing
        laughAction.play();
      }
    } else {
      fullText = "Eu não faria uma piada com isso...";
      // Play idle animation and keep it
      if (clownActions["idle"]) {
        if (clownActions["waving"]) clownActions["waving"].stop();
        if (clownActions["happy"]) clownActions["happy"].fadeOut(0.2);
        const idleAction = clownActions["idle"];
        idleAction.reset();
        idleAction.setLoop(THREE.LoopRepeat); // Loop the idle
        idleAction.play();
      }
    }

    typeEffect();
  }

  function handleJokeKeydown(event) {
    if (event.key === "Enter") {
      handleJokeSubmit();
    }
  }

  function createClouds() {
    const cloudCount = 20;
    const geometry = new THREE.DodecahedronGeometry(1, 0);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.4,
      flatShading: true,
      roughness: 0.0,
      opacity: 0.85,
      transparent: true,
      side: THREE.DoubleSide,
    });

    for (let i = 0; i < cloudCount; i++) {
      const cloud = new THREE.Group();
      const x = (Math.random() - 0.5) * 800;
      const y = 50 + Math.random() * 50;
      const z = -100 + (Math.random() - 0.5) * 600;

      cloud.position.set(x, y, z);

      const scale = 8 + Math.random() * 8;
      cloud.scale.set(scale, scale * 0.6, scale);

      const puffCount = 5 + Math.floor(Math.random() * 4);
      for (let j = 0; j < puffCount; j++) {
        const puff = new THREE.Mesh(geometry, material);
        puff.position.set(
          (Math.random() - 0.5) * 2.0,
          (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 1.5,
        );
        const puffScale = 0.8 + Math.random() * 0.7;
        puff.scale.set(puffScale, puffScale, puffScale);
        puff.rotation.set(
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          Math.random() * Math.PI,
        );
        puff.castShadow = false;
        puff.receiveShadow = false;
        cloud.add(puff);
      }

      cloud.userData = {
        velocity: (0.2 + Math.random() * 1.0) * 0.1,
      };

      scene.add(cloud);
      clouds.push(cloud);
    }
  }

  function createBirds(area) {
    const mobile = window.innerWidth < 768;
    skyFlock = createBirdFlock(THREE, {
      count: mobile ? 26 : 48,
      bounds: { xmin: area.xmin - 10, xmax: area.xmax + 10, zmin: area.zmin - 10, zmax: area.zmax + 10 },
      minY: 11,
      maxY: 20,
      scale: 0.42,
      palette: "day",
      castShadow: true,
      seed: 11,
    });
    lowFlock = createBirdFlock(THREE, {
      count: mobile ? 7 : 12,
      bounds: { xmin: area.xmin + 2, xmax: area.xmax - 2, zmin: area.zmin + 2, zmax: area.zmax - 2 },
      // abaixo da câmera padrão (+5) e logo acima das copas da clareira (~4.2)
      minY: 4.45,
      maxY: 4.95,
      scale: 0.32,
      speed: 2.6,
      palette: "day",
      castShadow: true,
      seed: 23,
    });
    scene.add(skyFlock.object);
    scene.add(lowFlock.object);
  }

  function updateZombiePhysics(delta) {
    if (!zombie || zombie.userData.isDead || isZombieRising) return;

    // 1. Gravity
    zombieVelocity.y -= GRAVITY * delta;

    // 2. Chasing Logic (Velocity Setting)
    const distanceToPlayer = model.position.distanceTo(zombie.position);
    const CHASE_TRIGGER_DIST = 12.0;
    // Reduce stop distance to 1.0 (closer than hit range of 0.95-1.1) to ensure he can hit
    const ATTACK_RANGE = 0.9;
    const ZOMBIE_SPEED = 1.2;

    if (!isZombieChasing) {
      // Idle State Checks
      if (distanceToPlayer < CHASE_TRIGGER_DIST) {
        console.log(
          `[Zombie] Player detected! Distance: ${distanceToPlayer.toFixed(2)}. Switching to CHASE state.`,
        );
        isZombieChasing = true;
        // Switch animation
        if (zombieAction !== zombieWalkAction) {
          fadeToActionZombie(zombieWalkAction, 0.2);
        }
      } else {
        // Stop horizontal movement if idle
        zombieVelocity.x = 0;
        zombieVelocity.z = 0;
      }
    } else {
      // Chasing State Checks
      if (distanceToPlayer > CHASE_TRIGGER_DIST * 1.5) {
        // Give up if too far (optional, or keep chasing forever)
        // Let's keep chasing for now as per "chase player" instruction,
        // but maybe stop if waaaay far. For now, stick to user req: "follow player... like a zombie game AI"
      }

      // Move towards player
      if (distanceToPlayer > ATTACK_RANGE) {
        // Use module scoped variables for physics
        _zombieDirection.subVectors(model.position, zombie.position);
        _zombieDirection.y = 0;
        _zombieDirection.normalize();

        // Smooth Rotation
        const targetRotation = Math.atan2(_zombieDirection.x, _zombieDirection.z);
        _zombieQuat.setFromAxisAngle(_zombieAxis, targetRotation);
        zombie.quaternion.slerp(_zombieQuat, 5.0 * delta); // Slerp speed

        // Set Velocity (No momentum, constant speed)
        zombieVelocity.x = _zombieDirection.x * ZOMBIE_SPEED;
        zombieVelocity.z = _zombieDirection.z * ZOMBIE_SPEED;

        // Ensure walking anim
        if (zombieAction !== zombieWalkAction && !zombie.userData.isAttacking) {
          fadeToActionZombie(zombieWalkAction, 0.2);
        }
      } else {
        // Reached Player
        if (zombieVelocity.x !== 0 || zombieVelocity.z !== 0) {
          console.log(
            `[Zombie] Reached player (Distance: ${distanceToPlayer.toFixed(2)}). Stopping.`,
          );
        }
        zombieVelocity.x = 0;
        zombieVelocity.z = 0;

        // Switch to Idle
        if (zombieAction !== zombieIdleAction && !zombie.userData.isAttacking) {
          console.log("[Zombie] Transitioning to IDLE (Reached Player).");
          fadeToActionZombie(zombieIdleAction, 0.2);
        }

        // Trigger Attack if ready
        if (zombie.userData.attackCooldown <= 0) {
          console.log("[Zombie] Attack Cooldown ready. Attacking!");
          zombieAttack(model);
        }
      }
    }

    // 3. Apply Velocity to Collider
    const deltaPosition = zombieVelocity.clone().multiplyScalar(delta);
    zombieCollider.translate(deltaPosition);

    // 4. Terrain Collision Resolution
    zombieCollisions();

    // 5. Player Hard Collision (Stop on Contact)
    // Check overlap with player collider
    const r1 = zombieCollider.radius;
    const r2 = playerCollider.radius;
    const combinedRadius = r1 + r2;

    // 2D Distance check for movement blocking (Y handled by gravity/terrain)
    const dx = zombieCollider.start.x - playerCollider.start.x;
    const dz = zombieCollider.start.z - playerCollider.start.z;
    const distSq = dx * dx + dz * dz;

    if (distSq < combinedRadius * combinedRadius) {
      const dist = Math.sqrt(distSq);
      const overlap = combinedRadius - dist;

      if (dist > 0.001) {
        // Normal pointing from Player TO Zombie (Push zombie back)
        const nx = dx / dist;
        const nz = dz / dist;

        // Hard Stop: Push zombie out of player exactly by overlap amount
        const pushBack = new THREE.Vector3(nx * overlap, 0, nz * overlap);
        zombieCollider.translate(pushBack);

        // Kill velocity towards player
        const vDotN = zombieVelocity.x * nx + zombieVelocity.z * nz;
        if (vDotN < 0) {
          // Normalize impact of collision on velocity
          zombieVelocity.x -= vDotN * nx;
          zombieVelocity.z -= vDotN * nz;
        }
      } else {
        // Rare case: Exact center overlap
        // Push back arbitrary amount in arbitrary direction (e.g. +X) to separate them
        const pushBack = new THREE.Vector3(1.0, 0, 0);
        zombieCollider.translate(pushBack);
      }

      // CRITICAL: Re-run terrain collision to ensure we didn't push into a wall/floor
      zombieCollisions();
    }

    // Trava de segurança: zumbi nunca sai da clareira
    if (isInsidePlayArea(zombieCollider.start.x, zombieCollider.start.z)) {
      _lastSafeZombiePos.copy(zombieCollider.start);
      hasSafeZombiePos = true;
    } else if (hasSafeZombiePos) {
      _safeDelta.subVectors(_lastSafeZombiePos, zombieCollider.start);
      _safeDelta.y = Math.max(0, _safeDelta.y);
      zombieCollider.translate(_safeDelta);
      zombieVelocity.x = 0;
      zombieVelocity.z = 0;
    }

    // 6. Sync Mesh
    zombie.position.copy(zombieCollider.start);
    zombie.position.y -= 0.35; // Offset for collider center

    // Safety Fallback (Stronger check)
    if (zombie.position.y < -100) {
      if (!zombie.userData.isDead) {
        // Only respawn if alive-ish
        respawnZombie(zombie);
      }
    }
  }

  function zombieCollisions() {
    const result1 = worldOctree.capsuleIntersect(zombieCollider);

    zombieOnFloor = false;

    if (result1) {
      zombieOnFloor = result1.normal.y > 0.35;
      if (!zombieOnFloor) {
        zombieVelocity.addScaledVector(
          result1.normal,
          -result1.normal.dot(zombieVelocity),
        );
      }
      zombieCollider.translate(result1.normal.multiplyScalar(result1.depth));
    }

    // Grounding: If on floor, zero out falling speed to prevent accumulation
    if (zombieOnFloor) {
      zombieVelocity.y = Math.max(0, zombieVelocity.y);
    }
  }

  function fadeToActionZombie(action, duration) {
    if (zombieAction === action) return;
    const prev = zombieAction;
    zombieAction = action;
    if (prev) prev.fadeOut(duration);
    if (zombieAction) zombieAction.reset().fadeIn(duration).play();
  }

  async function animate() {
    if (isDestroyed) return;

    // Request next frame first
    animationId = requestAnimationFrame(animate);

    // Cap delta to prevent physics explosions during lag/loading
    // If delta is too high (e.g. tab backgrounded), clamp it to 0.1s (10/60 fps)
    const rawDelta = clock.getDelta();
    const delta = Math.min(rawDelta, 0.1);
    const time = clock.getElapsedTime();

    // Update Birds (delta-time, sem alocação)
    skyFlock?.update(delta, time);
    lowFlock?.update(delta, time);

    // Update Clouds
    clouds.forEach((cloud) => {
      cloud.position.x += cloud.userData.velocity;
      if (cloud.position.x > 300) {
        cloud.position.x = -300;
        cloud.position.z = (Math.random() - 0.5) * 600;
      }
    });

    if (mixer) mixer.update(delta);
    if (mikuMixer) mikuMixer.update(delta);
    if (clownMixer) clownMixer.update(delta);
    // Zombie mixer need to be updated always for idle animation?
    // User said: "animation etc ocnintue"
    if (zombieMixer && (!isPaused || !isZombieRising)) zombieMixer.update(delta);

    // --- PAUSABLE GAME LOGIC ---
    if (!isPaused && !showGameOverModal) {
      // Update Zombie Rising Animation
      if (isZombieRising && zombie) {
        // Move zombie upward smoothly
        const risingSpeed = 1.0; // Units per second
        zombie.position.y += risingSpeed * delta;

        // Clamp to final position (don't go above ground level)
        if (zombie.position.y >= zombieFinalY) {
          zombie.position.y = zombieFinalY;
        }

        // Spawn dirt particles continuously during rise
        // Spawn rate: ~30 particles per second for dramatic effect
        const particleSpawnChance = delta * 30;
        if (Math.random() < particleSpawnChance) {
          // Create dirt particle at zombie's current position without cloning
          _particlePos.copy(zombie.position);
          _particlePos.y += 0.2; // Slightly above ground
          _particlePos.x += (Math.random() - 0.5) * 0.5; // Random spread
          _particlePos.z += (Math.random() - 0.5) * 0.5;

          createDust(_particlePos);
        }
      }

      // Zombie AI Behavior (Physics & Logic)
      updateZombiePhysics(delta);

      // Cooldown Update
      if (zombie && zombie.userData.attackCooldown > 0) {
        zombie.userData.attackCooldown -= delta;
      }

      // Respawn Timer
      if (zombieRespawnTimer > 0) {
        zombieRespawnTimer -= delta;
        if (zombieRespawnTimer <= 0) {
          zombieRespawnTimer = 0;
          if (zombie) respawnZombie(zombie);
        }
      }

      // Player Immunity Blinking
      if (isPlayerImmune) {
        playerImmunityTimer -= delta;
        immunityBlinkTimer += delta;

        // Blink fast (every 0.1s)
        if (immunityBlinkTimer > 0.1) {
          model.visible = !model.visible;
          immunityBlinkTimer = 0;
        }

        if (playerImmunityTimer <= 0) {
          isPlayerImmune = false;
          model.visible = true; // Ensure visible at end
        }
      } else if (model) {
        model.visible = true;
      }

      // Update Power Cooldowns
      if (fireballCooldown > 0) {
        fireballCooldown = Math.max(0, fireballCooldown - delta);
      }
      if (thunderCooldown > 0) {
        thunderCooldown = Math.max(0, thunderCooldown - delta);
      }

      updateMovement(delta);
    } else {
      // Logic when PAUSED or GAME OVER
      // We might want to ensure things are in a safe state?
      // For now, simply skipping the updates freezes positions and logic.
    }
    // --- END PAUSABLE LOGIC ---

    // Miku faces player or camera

    // Miku faces player or camera
    if (sphere && model) {
      if (isTakingSelfie) {
        // Face the "camera" (which is in front of her)
        // Actually, if she takes a selfie, she should face the camera position.
        // We'll position the camera in front of her.
        // So she should look at the camera.
        // Or simply rotate 180 from player if player is behind?
        // The request says: "turn miku 180º So her back is p1.glb front"
        // This means she faces the SAME direction as the player (who is facing her back? No, player faces Miku).
        // If player faces Miku, and Miku turns 180, she shows her back to the player?
        // "So her back is p1.glb front" -> Player's front sees Miku's back?
        // "we will take a photo of by puttin a camera in miku front, pointing to p1.glb"
        // So Camera -> Miku (Front) -> Player (Front)
        // So Miku needs to face the Camera. Player needs to face Miku's back?
        // No, "Miku front, pointing to p1.glb".
        // If Camera points to P1, and Miku is in between...
        // Camera -> Miku -> Player.
        // So Miku faces Camera. Player faces Camera (over Miku's shoulder?).
        // Request: "turn miku 180º So her back is p1.glb front"
        // If Miku was facing player, turning 180 means she faces AWAY from player.
        // So Player sees Miku's back.
        // Camera is "in miku front". Miku's front is now facing AWAY from player.
        // So Camera is looking at Miku's Face and Player's Face (if player is behind her).
        // Yes, that's a selfie!

        // So Miku should look at the Camera position.
        // We'll calculate camera position in updateCamera and use it here?
        // Or just rotate her relative to player.

        // Let's just make her look AWAY from the player.
        const directionToPlayer = new THREE.Vector3().subVectors(
          model.position,
          sphere.position,
        );
        const targetPos = sphere.position.clone().sub(directionToPlayer); // Point away from player
        sphere.lookAt(targetPos);
      } else {
        // Face player (Y-axis only)
        // We construct a target at the same height as Miku to ensure no vertical tilt
        const target = model.position.clone();
        target.y = sphere.position.y;
        sphere.lookAt(target);
        // Correcting Miku's rotation: User requested "rotate her from her perspective a little bit to right"
        // to align face with player. Right = Clockwise (Negative Y).
        sphere.rotateY(-0.5);
      }
    }

    if (zombie && isZombieChasing && !zombie.userData.isDead) {
      if (!zombieWalkAction && !zombie.userData.isAttacking) {
         zombie.scale.y = 0.015 + Math.sin(time * 15) * 0.001; // Procedural walking bob
      } else if (!zombie.userData.gltf.animations[0] && zombie.userData.isAttacking) {
         zombie.scale.y = 0.015 + Math.sin(time * 30) * 0.002; // Procedural attack bob
      } else {
         zombie.scale.y = 0.015;
      }
    }

    // Clown faces player
    if (clown && model) {
      // Create a target position at the same height as the clown to ensure only horizontal rotation
      const targetPos = model.position.clone();
      targetPos.y = clown.position.y;

      clown.lookAt(targetPos);
      clown.rotateY(-Math.PI / 5); // Invert rotation offset
    }

    // Animate Cartouches
    cubes.forEach((cartouche) => {
      if (cartouche.userData) {
        cartouche.position.y =
          cartouche.userData.initialY +
          Math.abs(
            Math.sin(
              time * cartouche.userData.floatSpeed +
                cartouche.userData.floatOffset,
            ) * 0.15,
          );
        // cartouche.rotation.y += delta * 0.5; // Removed spinning
      }
    });

    // Animate destination marker ripple
    if (markerRipple && markerRipple.userData.isAnimating) {
      markerRipple.userData.animationTime += delta;
      const t = markerRipple.userData.animationTime;

      if (t < 0.5) {
        // Animation duration: 0.5 seconds
        const progress = t / 0.5;
        const scale = 1 + progress * 0.8; // Scale from 1 to 1.8
        markerRipple.scale.set(scale, scale, 1);
        markerRipple.material.opacity = 1 - progress; // Fade out
      } else {
        // Reset animation
        markerRipple.userData.isAnimating = false;
        markerRipple.visible = false;
        markerRipple.scale.set(1, 1, 1);
        markerRipple.material.opacity = 1;
      }
    }

    // Animate Projectiles and Effects
    // Should projectiles freeze? Usually yes.
    if (!isPaused && !showGameOverModal) {
      updateVFX(delta);
    }

    // Animate Plasma Shield

    // (Cooldowns moved inside main pause block above)

    // (updateMovement moved inside main pause block above)

    updateCamera(); // Camera should likely stay active for look-around if possible?
    // Actually updateCamera depends on model position, which is frozen.
    // So updateCamera is safe to run (it will just keep camera at same spot).
    // EXCEPT if it interpolates.
    // Let's keep camera active so user can look around if we implemented look controls.
    // Our updateCamera is mostly follow-cam. If model doesn't move, cam settles.

    updateInteractionHint();

    if (renderer && scene && camera && pendingCompiles === 0) {
      if (renderer.info) renderer.info.reset();

      // init() já foi aguardado: render síncrono (sem await por frame).
      // try/catch: um erro de render não pode derrubar o resto do frame (HUD, textos).
      try {
        renderer.render(scene, camera);
        renderErrorCount = 0;
      } catch (e) {
        renderErrorCount++;
        if (renderErrorCount === 1 || renderErrorCount % 300 === 0) {
          console.error(`[Jogos] Erro no render (x${renderErrorCount}):`, e);
        }
      }
    }

    // Update HUD
    if (model) {
      playerPosition = {
        x: parseFloat(model.position.x.toFixed(2)),
        y: parseFloat(model.position.y.toFixed(2)),
        z: parseFloat(model.position.z.toFixed(2)),
      };
    }

    // Update Floating Texts
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const ft = floatingTexts[i];
      ft.life -= delta;

      // Move up
      ft.worldPos.add(ft.velocity.clone().multiplyScalar(delta));

      // Project to Screen
      const screenPos = ft.worldPos.clone().project(camera);
      const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-(screenPos.y * 0.5) + 0.5) * window.innerHeight;

      ft.element.style.left = `${x}px`;
      ft.element.style.top = `${y}px`;
      ft.element.style.opacity = ft.life; // Fade out

      if (ft.life <= 0) {
        if (ft.element.parentNode)
          ft.element.parentNode.removeChild(ft.element);
        floatingTexts.splice(i, 1);
      }
    }
  }

  function performAttack(targetPoint) {
    if (!model) return;

    // Stop any ongoing movement to prevent getting stuck in walking animation
    isMoving = false;
    targetPosition = null;
    targetObject = null;
    hideDestinationMarker();

    // Face target
    const direction = new THREE.Vector3()
      .subVectors(targetPoint, model.position)
      .normalize();
    const targetRotation = Math.atan2(direction.x, direction.z);
    const q = new THREE.Quaternion();
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetRotation);
    model.quaternion.copy(q);

    if (attackMode === "fireball") {
      // Check cooldown
      if (fireballCooldown > 0) return;

      // Set cooldown
      fireballCooldown = FIREBALL_COOLDOWN;

      playOneShotAnimation("Hit");
      // Reduced delay to 100ms
      setTimeout(() => {
        // Calculate start position: Right hand side (Inverted logic as requested)
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(
          model.quaternion,
        );
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(
          model.quaternion,
        );
        const startPos = model.position
          .clone()
          .add(new THREE.Vector3(0, 0.9, 0)) // Height
          .add(right.multiplyScalar(-0.4)) // Move to the "true" right (inverted from previous)
          .add(forward.multiplyScalar(0.1)); // Forward offset (moved back from 0.5)

        createFireball(startPos, targetPoint);
        playFireballThrow();
      }, 100);
    } else if (attackMode === "thunder") {
      // Check cooldown
      if (thunderCooldown > 0) return;

      // Set cooldown
      thunderCooldown = THUNDER_COOLDOWN;

      playOneShotAnimation("Curse");
      // Reduced delay to 200ms
      setTimeout(() => {
        createThunder(targetPoint);
        playThunderSound();
      }, 200);
    }
  }

  function playOneShotAnimation(name) {
    if (actions[name]) {
      // Stop previous action immediately instead of fading out
      if (activeAction && activeAction !== actions[name]) {
        activeAction.stop();
      }

      const action = actions[name];
      action.reset();
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.timeScale = 1.0; // Ensure normal speed

      // Set flag to prevent interruption
      isPlayingOneShotAnimation = true;

      // Debug: Log animation info
      console.log(
        `Playing ${name} animation - Duration: ${action.getClip().duration}s`,
      );

      action.play();
      activeAction = action;

      mixer.addEventListener("finished", function restoreIdle(e) {
        if (e.action === action) {
          mixer.removeEventListener("finished", restoreIdle);
          console.log(`${name} animation finished`);
          // Clear flag before transitioning back to Idle
          isPlayingOneShotAnimation = false;
          // Wait a tiny bit before fading back to ensure full pose is seen
          setTimeout(() => {
            fadeToAction("Idle", 0.3);
          }, 100);
        }
      });
    } else {
      console.warn(`Animation "${name}" not found in actions`);
    }
  }

  function createFireball(start, end) {
    // 1. Get Fireball Mesh
    const fbPoolItem = fireballPool.find((item) => !item.active);
    if (!fbPoolItem) return; // Pool empty
    fbPoolItem.active = true;
    const fireball = fbPoolItem.mesh;

    fireball.position.copy(start);
    fireball.scale.set(0.3, 0.3, 0.3);
    fireball.visible = true;

    // 2. Get Light (if available)
    const lightPoolItem = lightPool.find((item) => !item.active);
    let light = null;
    if (lightPoolItem) {
      lightPoolItem.active = true;
      light = lightPoolItem.light;
      light.color.setHex(0xffaa00);
      light.intensity = 2;
      light.position.copy(start); // We'll move it manually instead of adding it as a child to avoid hierarchy rebuilds
    }

    const direction = new THREE.Vector3().subVectors(end, start).normalize();
    const speed = 8;

    projectiles.push({
      poolItem: fbPoolItem,
      lightPoolItem: lightPoolItem,
      direction: direction,
      speed: speed,
      target: end,
      type: "fireball",
    });
  }

  function createThunder(target) {
    const thunderPoolItem = thunderMeshPool.find((item) => !item.active);
    if (!thunderPoolItem) return; // Pool empty

    const startY = 20;
    const start = target.clone().setY(startY);
    const end = target.clone();

    const points = [];
    let current = start.clone();
    const segments = 10;
    const stepY = (startY - end.y) / segments;

    points.push(current.clone());

    for (let i = 0; i < segments; i++) {
        current.y -= stepY;
        if (i < segments - 1) {
            current.x += (Math.random() - 0.5) * 2.0;
            current.z += (Math.random() - 0.5) * 2.0;
        } else {
            current.copy(end);
        }
        points.push(current.clone());
    }

    // Update geometry in place (much faster than creating new mesh)
    const curve = new THREE.CatmullRomCurve3(points);
    // Important: disposing geometry here is okay because it's only geometry data, 
    // but the material and mesh stay. There is a way to reuse geometry array buffers but 
    // it's very complex for TubeGeometry. This is still 10x better than full recreation.
    thunderPoolItem.core.geometry.dispose();
    thunderPoolItem.glow.geometry.dispose();
    
    thunderPoolItem.core.geometry = new THREE.TubeGeometry(curve, segments, 0.08, 8, false);
    thunderPoolItem.glow.geometry = new THREE.TubeGeometry(curve, segments, 0.2, 8, false);

    thunderPoolItem.core.visible = true;
    thunderPoolItem.glow.visible = true;
    thunderPoolItem.active = true;

    // Get Light
    const lightPoolItem = lightPool.find((item) => !item.active);
    let light = null;
    if (lightPoolItem) {
        lightPoolItem.active = true;
        light = lightPoolItem.light;
        light.color.setHex(0x00ffff);
        light.intensity = 5;
        light.position.copy(target).add(new THREE.Vector3(0, 2, 0));
    }

    effects.push({
        poolItem: thunderPoolItem,
        lightPoolItem: lightPoolItem,
        life: 1.0,
        type: "thunder",
    });


    // 5. Area Damage
    if (zombie && !zombie.userData.isDead) {
      const dist = zombie.position.distanceTo(target);

      // ... damage logic ... (existing)
      // THIS CHUNK IS JUST CONTEXT TO FIND WHERE TO ADD ZOMBIE AI LOOP UPDATE
      // Actually, let's insert the Zombie AI logic in the main 'animate' function
      // searching for 'if (zombie) {' in animate seems safer.
    }

    // 5. Area Damage
    if (zombie && !zombie.userData.isDead) {
      const dist = zombie.position.distanceTo(target);

      let damage = 0;
      // "in the very place of thunder the damage will be 10"
      // "and gradually as the distance of the thunder area, it goes down to 5, and 2.5"

      // Let's define radii
      if (dist < 0.5) {
        damage = 10;
      } else if (dist < 1.0) {
        damage = 5;
      } else if (dist < 1.5) {
        damage = 2.5;
      }

      if (damage > 0) {
        // Delay damage slightly to match visual strike
        setTimeout(() => {
          takeDamage(zombie, damage, "thunder");
        }, 100);
      }
    }
  }

  function createInstancedParticle(position, colorHex, isExplosion = false) {
    if (!dustParticleInstancedMesh || !explosionParticleInstancedMesh) return;
    
    // Select correct array and instanced mesh
    const dataArray = isExplosion ? activeExplosionData : activeDustData;
    const instancedMesh = isExplosion ? explosionParticleInstancedMesh : dustParticleInstancedMesh;
    
    // Find free slot
    const index = dataArray.findIndex(p => !p.active);
    if (index === -1) return; // Pool full
    
    const pData = dataArray[index];
    pData.active = true;
    pData.life = isExplosion ? (0.3 + Math.random() * 0.3) : (0.5 + Math.random() * 0.5);
    pData.maxLife = pData.life; // Store for fading
    
    // Initial State
    pData.position = position.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * (isExplosion ? 0.0 : 1.0),
        isExplosion ? 0.0 : 0.1,
        (Math.random() - 0.5) * (isExplosion ? 0.0 : 1.0)
    ));
    
    const speed = isExplosion ? (5 + Math.random() * 5) : 1.0;
    pData.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        Math.random() * 2,
        (Math.random() - 0.5) * 2
    ).normalize().multiplyScalar(isExplosion ? speed : (1 + Math.random()));
    
    pData.rotation = new THREE.Euler(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
    );
    pData.rotationSpeed = new THREE.Vector3(
        Math.random() * (isExplosion ? 10 : 5),
        Math.random() * (isExplosion ? 10 : 5),
        Math.random() * (isExplosion ? 10 : 5)
    );
    pData.scale = 1.0;

    // Set initial instance data
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion().setFromEuler(pData.rotation);
    matrix.compose(pData.position, quaternion, new THREE.Vector3(1, 1, 1));
    
    instancedMesh.setMatrixAt(index, matrix);
    instancedMesh.setColorAt(index, new THREE.Color(colorHex));
    instancedMesh.instanceMatrix.needsUpdate = true;
    instancedMesh.instanceColor.needsUpdate = true;
  }

  function createDust(position) {
    if (!model) return;
    createInstancedParticle(position, 0xbc9e4a, false);
  }

  function createParticle(position, colorHex) {
    createInstancedParticle(position, colorHex, true);
  }


  function createExplosion(position) {
    // 1. Particle Burst
    const particleCount = 20;
    for (let i = 0; i < particleCount; i++) {
      createParticle(position, 0xffaa00); // Orange particles
    }

    // 2. Flash Light
    const lightPoolItem = lightPool.find((item) => !item.active);
    if (lightPoolItem) {
        lightPoolItem.active = true;
        const light = lightPoolItem.light;
        light.color.setHex(0xffaa00);
        light.intensity = 5;
        light.position.copy(position);

        effects.push({
            lightPoolItem: lightPoolItem,
            life: 0.2, // Very short flash
            type: "explosion_flash",
        });
    }
  }

  function updateVFX(delta) {
    // Update Projectiles
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      const mesh = p.poolItem.mesh;
      mesh.position.add(p.direction.clone().multiplyScalar(p.speed * delta));
      
      if (p.lightPoolItem) {
          p.lightPoolItem.light.position.copy(mesh.position);
      }

      // Rotate fireball
      if (p.type === "fireball") {
        mesh.rotation.x += delta * 10;
        mesh.rotation.z += delta * 10;
      }

      // Check Collision with Zombie
      let hit = false;
      if (zombie && !zombie.userData.isDead && p.type === "fireball") {
        const zombieCenter = zombie.position.clone().add(new THREE.Vector3(0, 1.0, 0));
        if (mesh.position.distanceTo(zombieCenter) < 1.0) {
          takeDamage(zombie, 5, "fireball");
          hit = true;
        }
      }

      // Check if reached target or hit
      if (hit || mesh.position.distanceTo(p.target) < 1.0 || mesh.position.y < 0) {
        createExplosion(mesh.position);
        playFireballHit();
        
        // Return to pool instead of dispose
        mesh.visible = false;
        p.poolItem.active = false;
        if (p.lightPoolItem) {
            p.lightPoolItem.light.intensity = 0;
            p.lightPoolItem.light.position.set(0,-100,0);
            p.lightPoolItem.active = false;
        }
        
        projectiles.splice(i, 1);
      }
    }

    // Update Effects
    for (let i = effects.length - 1; i >= 0; i--) {
        const e = effects[i];
        e.life -= delta;
        if (e.life <= 0) {
            if (e.poolItem) {
                e.poolItem.core.visible = false;
                e.poolItem.glow.visible = false;
                e.poolItem.active = false;
            }
            if (e.lightPoolItem) {
                e.lightPoolItem.light.intensity = 0;
                e.lightPoolItem.light.position.set(0,-100,0);
                e.lightPoolItem.active = false;
            }
            effects.splice(i, 1);
        } else {
            // Fade out
            if (e.poolItem && e.poolItem.glow.material) {
                e.poolItem.glow.material.opacity = (e.life / 1.0) * 0.5; // Max opacity is 0.5
            }
        }
    }

    // Update Instanced Particles
    const updateInstancedParticles = (dataArray, instancedMesh, isExplosion) => {
        if (!instancedMesh) return;
        let needsUpdate = false;
        const dummyMatrix = new THREE.Matrix4().makeScale(0,0,0);
        
        for (let i = 0; i < dataArray.length; i++) {
            const p = dataArray[i];
            if (!p.active) continue;
            
            p.life -= delta * (isExplosion ? 1.0 : 2.0);
            if (p.life <= 0) {
                p.active = false;
                instancedMesh.setMatrixAt(i, dummyMatrix); // Hide
                needsUpdate = true;
                continue;
            }
            
            p.position.add(p.velocity.clone().multiplyScalar(delta));
            p.scale *= 0.9;
            p.rotation.x += p.rotationSpeed.x * delta;
            p.rotation.y += p.rotationSpeed.y * delta;
            
            const matrix = new THREE.Matrix4();
            const quaternion = new THREE.Quaternion().setFromEuler(p.rotation);
            matrix.compose(p.position, quaternion, new THREE.Vector3(p.scale, p.scale, p.scale));
            instancedMesh.setMatrixAt(i, matrix);
            needsUpdate = true;
        }
        
        if (needsUpdate) {
            instancedMesh.instanceMatrix.needsUpdate = true;
        }
    };

    updateInstancedParticles(activeDustData, dustParticleInstancedMesh, false);
    updateInstancedParticles(activeExplosionData, explosionParticleInstancedMesh, true);
  }

  function showDestinationMarker(position) {
    if (!destinationMarker || !markerRipple) return;

    // Position permanent marker
    destinationMarker.position.x = position.x;
    destinationMarker.position.z = position.z;
    destinationMarker.visible = true;

    // Start ripple animation
    markerRipple.position.x = position.x;
    markerRipple.position.z = position.z;
    markerRipple.visible = true;
    markerRipple.scale.set(1, 1, 1);
    markerRipple.material.opacity = 1;
    markerRipple.userData.animationTime = 0;
    markerRipple.userData.isAnimating = true;
  }

  function hideDestinationMarker() {
    if (destinationMarker) destinationMarker.visible = false;
    if (markerRipple) {
      markerRipple.visible = false;
      markerRipple.userData.isAnimating = false;
    }
  }

  function createTerrainMaterial() {
    // Generate Biome Map (FBM Noise)
    const size = 512;
    const data = new Uint8Array(4 * size * size);
    const gridScale = 15.0; // Higher scale for detailed outer map

    // Value Noise 2D
    function noise(x, y) {
      const X = Math.floor(x);
      const Y = Math.floor(y);
      const fx = x - X;
      const fy = y - Y;

      function hash(n) {
        return Math.abs(Math.sin(n * 12.9898 + 78.233) * 43758.5453123) % 1;
      }
      function val(x, y) {
        const n = x + y * 57;
        return hash(n);
      }

      const v00 = val(X, Y);
      const v10 = val(X + 1, Y);
      const v01 = val(X, Y + 1);
      const v11 = val(X + 1, Y + 1);

      const ux = fx * fx * (3 - 2 * fx);
      const uy = fy * fy * (3 - 2 * fy);

      return (
        v00 * (1 - ux) * (1 - uy) +
        v10 * ux * (1 - uy) +
        v01 * (1 - ux) * uy +
        v11 * ux * uy
      );
    }

    // Fractal Brownian Motion
    function fbm(x, y, octaves) {
      let val = 0;
      let amp = 0.5;
      let freq = 1;
      for (let i = 0; i < octaves; i++) {
        val += noise(x * freq, y * freq) * amp;
        freq *= 2;
        amp *= 0.5;
      }
      return val;
    }

    function smoothstep(min, max, value) {
      var x = Math.max(0, Math.min(1, (value - min) / (max - min)));
      return x * x * (3 - 2 * x);
    }

    for (let i = 0; i < size * size; i++) {
      // UV Coordinates (0 to 1)
      const u = (i % size) / size;
      const v = Math.floor(i / size) / size;

      // Noise Coordinates
      const x = u * gridScale;
      const y = v * gridScale;

      // Distance from center (0.5, 0.5)
      const dx = u - 0.5;
      const dy = v - 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Procedural Noise for Outer World
      let nProcedural = fbm(x, y, 4);

      // Zone Noise (for organic boundaries)
      let nZone = fbm(x * 0.5, y * 0.5, 2);

      // Perturb distance
      const perturbedDist = dist + (nZone - 0.5) * 0.015;

      // --- ZONING LOGIC ---
      // Center (Grass): Radius < 0.02 (approx 40 units)
      // Ring (Dirt): Radius 0.02 - 0.05 (approx 40-100 units)
      // Outer (Procedural): Radius > 0.05

      let dirtWeight = 0;
      let stoneWeight = 0;

      if (perturbedDist < 0.02) {
        // CENTER: Pure Grass
        dirtWeight = 0;
        stoneWeight = 0;
      } else if (perturbedDist < 0.05) {
        // RING: Pure Dirt
        dirtWeight = 1.0;
        stoneWeight = 0;
      } else {
        // OUTER: Procedural Generation
        // Map noise to biomes:
        // 0.0 - 0.4: Grass
        // 0.4 - 0.7: Dirt
        // 0.7 - 1.0: Stone

        if (nProcedural < 0.4) {
          dirtWeight = 0;
          stoneWeight = 0;
        } else if (nProcedural < 0.7) {
          dirtWeight = 1.0;
          stoneWeight = 0;
        } else {
          dirtWeight = 0;
          stoneWeight = 1.0;
        }
      }

      // Write to texture
      data[i * 4] = Math.floor(dirtWeight * 255); // R: Dirt
      data[i * 4 + 1] = Math.floor(stoneWeight * 255); // G: Stone
      data[i * 4 + 2] = 0;
      data[i * 4 + 3] = 255;
    }

    const biomeMap = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    biomeMap.wrapS = THREE.RepeatWrapping;
    biomeMap.wrapT = THREE.RepeatWrapping;
    biomeMap.minFilter = THREE.LinearFilter;
    biomeMap.magFilter = THREE.LinearFilter;
    biomeMap.needsUpdate = true;

    // Load textures
    const textureLoader = new THREE.TextureLoader();

    // Get max anisotropy for smoother textures
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

    // Grass texture
    const grassTexture = textureLoader.load("/game/textures/grass-flower.jpg");
    grassTexture.wrapS = THREE.RepeatWrapping;
    grassTexture.wrapT = THREE.RepeatWrapping;
    grassTexture.repeat.set(400, 400);
    grassTexture.anisotropy = maxAnisotropy; // Smooth filtering
    grassTexture.minFilter = THREE.LinearMipmapLinearFilter; // Better mipmapping
    grassTexture.magFilter = THREE.LinearFilter;

    // Dirt texture
    const dirtTexture = textureLoader.load("/game/textures/dirt.jpg");
    dirtTexture.wrapS = THREE.RepeatWrapping;
    dirtTexture.wrapT = THREE.RepeatWrapping;
    dirtTexture.repeat.set(400, 400);
    dirtTexture.anisotropy = maxAnisotropy;
    dirtTexture.minFilter = THREE.LinearMipmapLinearFilter;
    dirtTexture.magFilter = THREE.LinearFilter;

    // Stone texture (using dark-grass as stone)
    const stoneTexture = textureLoader.load("/game/textures/dark-grass.jpg");
    stoneTexture.wrapS = THREE.RepeatWrapping;
    stoneTexture.wrapT = THREE.RepeatWrapping;
    stoneTexture.repeat.set(400, 400);
    stoneTexture.anisotropy = maxAnisotropy;
    stoneTexture.minFilter = THREE.LinearMipmapLinearFilter;
    stoneTexture.magFilter = THREE.LinearFilter;

    const material = new THREE.MeshStandardMaterial({
      roughness: 1,
      metalness: 0,
      map: biomeMap,
    });

    material.onBeforeCompile = (shader) => {
      // Textures instead of solid colors
      shader.uniforms.uTextureGrass = { value: grassTexture };
      shader.uniforms.uTextureDirt = { value: dirtTexture };
      shader.uniforms.uTextureStone = { value: stoneTexture };
      shader.uniforms.tBiome = { value: biomeMap };

      shader.fragmentShader =
        `
        uniform sampler2D uTextureGrass;
        uniform sampler2D uTextureDirt;
        uniform sampler2D uTextureStone;
        uniform sampler2D tBiome;
      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        `
        // Sample Biome Map
        vec4 biome = texture2D(tBiome, vMapUv);
        
        // Sample textures with tiled UVs
        vec2 tiledUV = vMapUv * 400.0; // Match the repeat value
        vec3 grassColor = texture2D(uTextureGrass, tiledUV).rgb;
        vec3 dirtColor = texture2D(uTextureDirt, tiledUV).rgb;
        vec3 stoneColor = texture2D(uTextureStone, tiledUV).rgb;
        
        // Base Color (Grass)
        vec3 finalColor = grassColor;
        
        // Mix Dirt
        // Red channel contains dirt weight
        float dirtFactor = smoothstep(0.4, 0.6, biome.r);
        finalColor = mix(finalColor, dirtColor, dirtFactor);

        // Mix Stone
        // Green channel contains stone weight
        float stoneFactor = smoothstep(0.4, 0.6, biome.g);
        finalColor = mix(finalColor, stoneColor, stoneFactor);

        // Apply to diffuseColor
        diffuseColor = vec4(finalColor, opacity);
        `,
      );
    };

    return material;
  }

  function portal(node) {
    let target = document.body;
    async function update() {
      target.appendChild(node);
      node.hidden = false;
    }
    update();
    return {
      destroy() {
        if (node.parentNode) node.parentNode.removeChild(node);
      },
    };
  }
</script>

<main class="fullscreen">
  <!-- ContactModal is rendered globally in Nav.svelte, so it's removed here -->
  <!-- PortfolioModal is rendered globally in Nav.svelte, so it's removed here -->

  <canvas
    bind:this={canvas}
    on:click={handleCanvasClick}
    on:contextmenu|preventDefault
    class:crosshair={attackMode !== null}
  ></canvas>

  {#if showFlash}
    <div class="flash-overlay"></div>
  {/if}

  {#if isMobile}
    <!-- Virtual Joystick (Left) -->
    <div
      class="fixed bottom-12 left-12 z-[100] w-32 h-32 bg-white/10 backdrop-blur-md rounded-full border border-white/20 touch-none flex items-center justify-center"
      bind:this={joystickBase}
      on:touchstart|preventDefault={handleJoystickStart}
      on:touchmove|preventDefault={handleJoystickMove}
      on:touchend|preventDefault={handleJoystickEnd}
    >
      <div
        class="w-12 h-12 bg-white/50 rounded-full shadow-lg pointer-events-none transition-transform duration-75"
        bind:this={joystickStick}
      ></div>
    </div>

    <!-- Jump Button (Right) -->
    <div
      class="fixed bottom-24 right-8 z-[100] w-20 h-20 bg-white/10 backdrop-blur-md rounded-full border border-white/20 touch-none flex items-center justify-center active:bg-white/30 transition-colors select-none outline-none overflow-hidden"
      style="-webkit-tap-highlight-color: transparent; transform: translateZ(0);"
      on:touchstart|preventDefault={() => {
        keys.space = true;
      }}
      on:touchend|preventDefault={() => {
        keys.space = false;
      }}
    >
      <i class="fas fa-arrow-up text-white text-2xl"></i>
    </div>
  {/if}

  <!-- Audio Control with Volume Slider -->
  <div
    class="fixed bottom-4 right-4 z-[100] flex items-center gap-3"
    role="group"
    aria-label="Audio"
    on:mouseenter={() => (showVolumeSlider = true)}
    on:mouseleave={() => (showVolumeSlider = false)}
  >
    <!-- Volume Slider (Legacy - Music Only) -->
    {#if showVolumeSlider}
      <div
        class="backdrop-blur-md bg-gradient-to-b from-white/30 to-white/10 border border-white/40 rounded-full px-4 py-2 shadow-lg transition-all duration-300 ease-in-out"
      >
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          bind:value={volMaster}
          on:input={updateVolume}
          aria-label="Volume"
          style="--value: {volMaster * 100}%"
          class="volume-slider w-24 h-2 bg-white/20 rounded-lg appearance-none cursor-pointer"
        />
      </div>
    {/if}

    <!-- Mute/Unmute Button -->
    <button
      class="backdrop-blur-md bg-gradient-to-b from-white/30 to-white/10 border border-white/40 hover:bg-white/20 text-white font-bold p-3 rounded-full shadow-lg transition-all duration-200"
      on:click={toggleMusic}
      aria-label={isMusicPlaying ? "Silenciar" : "Dessilenciar"}
    >
      <i
        class="fas {isMusicPlaying
          ? 'fa-volume-up'
          : 'fa-volume-mute'} text-xl drop-shadow-md"
      ></i>
    </button>
  </div>

  <!-- Pause Button -->
  <button
    class="fixed top-24 right-4 z-[100] p-3 rounded-full glass-panel text-white hover:bg-white/20 transition-all active:scale-95 {showGameOverModal
      ? 'opacity-50 cursor-not-allowed'
      : ''}"
    on:click={togglePause}
    disabled={showGameOverModal}
    aria-label={manuallyPaused ? "Resume Game" : "Pause Game"}
  >
    <i
      class="fas {manuallyPaused
        ? 'fa-play'
        : 'fa-pause'} text-xl w-6 h-6 flex items-center justify-center"
    ></i>
  </button>

  <!-- Config Button (Below Pause Button) -->
  <button
    class="fixed top-40 right-4 z-[100] p-3 rounded-full glass-panel text-white hover:bg-white/20 transition-all active:scale-95"
    on:click={toggleConfig}
    aria-label="Graphics Settings"
  >
    <i class="fas fa-cog text-xl w-6 h-6 flex items-center justify-center"></i>
  </button>

  <!-- Temp button removed to use GlobalFabs -->

  <!-- Configuration Modal -->
  {#if showConfigModal}
    <div
      use:portal
      class="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center"
      on:click|self={() => (showConfigModal = false)}
    >
      <div
        class="glass-panel w-full max-w-md p-6 rounded-2xl border border-white/20 shadow-2xl transform scale-100 animate-fadeIn"
      >
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-2xl font-bold text-white flex items-center gap-3">
            <i class="fas fa-desktop text-blue-400"></i>
            Gráficos
          </h2>
          <button
            class="text-white/60 hover:text-white transition-colors"
            on:click={() => (showConfigModal = false)}
          >
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>

        <div class="space-y-6">
          <!-- Resolution / FSR -->
          <div class="space-y-2">
            <div class="flex justify-between items-center text-white">
              <label class="font-medium flex items-center gap-2">
                <i class="fas fa-bolt text-yellow-400"></i>
                Escala de Resolução (FSR)
              </label>
              <span class="text-sm font-mono text-blue-300"
                >{Math.round(tempGraphicsSettings.resolution * 100)}%</span
              >
            </div>
            <input
              type="range"
              min="0.5"
              max="1.0"
              step="0.05"
              bind:value={tempGraphicsSettings.resolution}
              class="w-full volume-slider h-3 rounded-lg appearance-none cursor-pointer"
              style="--value: {(tempGraphicsSettings.resolution - 0.5) * 200}%"
            />
            <p class="text-xs text-white/50">
              Reduzir a resolução melhora significativamente a performance.
            </p>
          </div>

          <!-- Shadow Quality -->
          <div class="space-y-3">
            <label class="font-medium text-white flex items-center gap-2">
              <i class="fas fa-sun text-yellow-400"></i>
              Sombra
            </label>
            <div class="grid grid-cols-7 gap-2">
              {#each ["off", "baixo", "médio", "alto", "ultra", "epic", "∞"] as mode}
                <button
                  class="px-1 py-2 rounded-lg border text-[8px] font-bold transition-all uppercase tracking-tighter
                  {tempGraphicsSettings.shadows === mode
                    ? 'bg-blue-600/50 border-blue-400 text-white shadow-[0_0_15px_rgba(59,130,246,0.5)]'
                    : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'}"
                  on:click={() => {
                    tempGraphicsSettings.shadows = mode;
                  }}
                >
                  {mode.toUpperCase()}
                </button>
              {/each}
            </div>
          </div>
        </div>

        <div class="mt-8 pt-4 border-t border-white/10 flex justify-end">
          <button
            class="px-4 py-2 text-white/70 hover:text-white font-medium transition-colors mr-2"
            on:click={() => (showConfigModal = false)}
          >
            Cancelar
          </button>
          <button
            class="px-6 py-2 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold rounded-xl shadow-lg transition-all transform hover:scale-105"
            on:click={saveGraphicsSettings}
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if isPaused}
    <div
      class="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px] flex items-center justify-center pointer-events-none"
    >
      <div
        class="glass-panel px-8 py-4 rounded-xl border border-white/30 shadow-[0_0_30px_rgba(0,0,0,0.5)] transform scale-100 animate-pulse"
      >
        <h2
          class="text-4xl font-black text-white tracking-[0.2em] drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)]"
        >
          PAUSADO
        </h2>
      </div>
    </div>
  {/if}

  <!-- Power Cooldown Indicators -->
  <!-- Power Cooldown Indicators -->
  <div
    class="fixed left-4 z-50 flex flex-col gap-3 transition-all duration-300 {isMobile
      ? 'bottom-80'
      : 'bottom-4'}"
  >
    <!-- Fireball Power (1) -->
    <button
      class="relative w-16 h-16 rounded-2xl backdrop-blur-md bg-gradient-to-b from-white/30 to-white/10 border border-white/40 shadow-lg flex items-center justify-center transition-transform hover:scale-105"
      class:ring-2={attackMode === "fireball"}
      class:ring-orange-400={attackMode === "fireball"}
      on:click={toggleFireballMode}
      aria-label="Toggle Fireball (Press 1)"
    >
      <!-- Icon Wrapper -->
      <div class="relative w-full h-full flex items-center justify-center">
        <!-- Background Ghost Icon -->
        <i class="fa-solid fa-fire text-white/30 text-3xl absolute"></i>

        <!-- Foreground Filled Icon (Clipped) -->
        <div
          class="absolute bottom-0 left-0 right-0 overflow-hidden flex items-end justify-center pointer-events-none"
          style="height: {(1 - fireballCooldown / FIREBALL_COOLDOWN) *
            100}%; transition: height 0.1s linear;"
        >
          <!-- Inner Container to keep icon centered relative to button, not clipper -->
          <div class="w-16 h-16 flex items-center justify-center">
            <i
              class="fa-solid fa-fire text-red-500 text-3xl drop-shadow-[0_0_10px_rgba(239,68,68,0.8)]"
            ></i>
          </div>
        </div>
      </div>
    </button>

    <!-- Thunder Power (2) -->
    <button
      class="relative w-16 h-16 rounded-2xl backdrop-blur-md bg-gradient-to-b from-white/30 to-white/10 border border-white/40 shadow-lg flex items-center justify-center transition-transform hover:scale-105"
      class:ring-2={attackMode === "thunder"}
      class:ring-cyan-400={attackMode === "thunder"}
      on:click={toggleThunderMode}
      aria-label="Toggle Thunder (Press 2)"
    >
      <!-- Icon Wrapper -->
      <div class="relative w-full h-full flex items-center justify-center">
        <!-- Background Ghost Icon -->
        <i class="fa-solid fa-cloud-bolt text-white/30 text-3xl absolute"></i>

        <!-- Foreground Filled Icon (Clipped) -->
        <div
          class="absolute bottom-0 left-0 right-0 overflow-hidden flex items-end justify-center pointer-events-none"
          style="height: {(1 - thunderCooldown / THUNDER_COOLDOWN) *
            100}%; transition: height 0.1s linear;"
        >
          <!-- Inner Container -->
          <div class="w-16 h-16 flex items-center justify-center">
            <i
              class="fa-solid fa-cloud-bolt text-cyan-400 text-3xl drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]"
            ></i>
          </div>
        </div>
      </div>
    </button>
  </div>

  <!-- Health HUD -->
  <div
    class="fixed top-24 left-4 z-50 flex items-center gap-3 glass-panel p-3 rounded-2xl"
  >
    <div class="relative w-10 h-10 flex items-center justify-center">
      <i
        class="fa-solid fa-heart text-red-500 text-2xl drop-shadow-[0_0_10px_rgba(239,68,68,0.6)]"
      ></i>
    </div>
    <div class="flex flex-col">
      <span class="text-xs text-white/70 font-bold uppercase tracking-wider"
        >Vida</span
      >
      <span class="text-xl text-white font-black leading-none"
        >{playerHp} / {playerMaxHp}</span
      >
    </div>
  </div>

  <!-- Zombie Respawn HUD -->
  {#if zombieRespawnTimer > 0}
    <div
      class="fixed z-50 flex items-center gap-3 glass-panel p-3 rounded-2xl animate-pulse transition-all duration-300 top-40 left-4"
      style="border-color: rgba(255, 68, 68, 0.5);"
    >
      <div class="relative w-10 h-10 flex items-center justify-center">
        <i
          class="fa-solid fa-skull text-red-500 text-2xl drop-shadow-[0_0_10px_rgba(255,0,0,0.6)]"
        ></i>
      </div>
      <div class="flex flex-col">
        <span class="text-xs text-white/70 font-bold uppercase tracking-wider"
          >Inimigo em</span
        >
        <span class="text-xl text-white font-black leading-none"
          >{Math.ceil(zombieRespawnTimer)}s</span
        >
      </div>
    </div>
  {/if}

  {#if showGameOverModal}
    <div
      use:portal
      class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div
        class="glass-panel p-8 rounded-3xl text-center flex flex-col items-center gap-6 max-w-sm w-full border border-white/20 shadow-[0_0_50px_rgba(255,0,0,0.3)]"
      >
        <h2
          class="text-4xl font-black text-white tracking-widest drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]"
        >
          GAME OVER
        </h2>
        <p class="text-white/70">
          Você não se preparou para consequências imprevistas!
        </p>

        <button
          class="px-8 py-3 bg-gradient-to-r from-red-600 to-red-500 rounded-xl text-white font-bold text-lg shadow-lg hover:scale-105 active:scale-95 transition-all w-full"
          on:click={resetGame}
        >
          TENTAR DE NOVO
        </button>
      </div>
    </div>
  {/if}

  {#if showModal && currentProject}
    <div
      use:portal
      class="modal-backdrop"
      on:click={closeModal}
      on:keydown={(e) => e.key === "Escape" && closeModal()}
      role="button"
      tabindex="-1"
    >
      <div
        class="portfolio-modal"
        on:click|stopPropagation
        on:keydown|stopPropagation
        role="dialog"
        aria-modal="true"
        tabindex="-1"
      >
        <!-- Header -->
        <div class="modal-header">
          <div>
            <h2 class="modal-title">{currentProject.name}</h2>
            <p class="modal-subtitle">{currentProject.year}</p>
          </div>
          <button class="close-button" on:click={closeModal} aria-label="Close">
            ✕
          </button>
        </div>

        <!-- Content -->
        <div class="modal-body">
          <!-- Image Carousel -->
          <div class="carousel-section">
            <div class="carousel-container">
              <img
                src={currentProject.images[currentImageIndex]}
                alt="{currentProject.name} screenshot {currentImageIndex + 1}"
                class="carousel-image"
              />

              <!-- Navigation Buttons -->
              {#if currentProject.images.length > 1}
                <button
                  class="carousel-btn prev-btn"
                  on:click={prevImage}
                  aria-label="Previous image"
                >
                  ‹
                </button>
                <button
                  class="carousel-btn next-btn"
                  on:click={nextImage}
                  aria-label="Next image"
                >
                  ›
                </button>
              {/if}
            </div>

            <!-- Thumbnail Indicators -->
            {#if currentProject.images.length > 1}
              <div class="carousel-indicators">
                {#each currentProject.images as _, index}
                  <button
                    class="indicator"
                    class:active={index === currentImageIndex}
                    on:click={() => goToImage(index)}
                    aria-label="Go to image {index + 1}"
                  ></button>
                {/each}
              </div>
            {/if}
          </div>

          <!-- Description -->
          <div class="description-section">
            <h3 class="section-title">About</h3>
            <p class="short-description">{currentProject.description}</p>
            <p class="long-description">{currentProject.longDescription}</p>
          </div>

          <!-- Technologies -->
          {#if currentProject.technologies && currentProject.technologies.length > 0}
            <div class="tech-section">
              <h3 class="section-title">Technologies</h3>
              <div class="tech-tags">
                {#each currentProject.technologies as tech}
                  <span class="tech-tag">{tech}</span>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Platform Links -->
          {#if currentProject.links && currentProject.links.length > 0}
            <div class="action-buttons">
              {#each currentProject.links as link}
                {#if link.platform === "demo"}
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="action-btn demo-btn"
                  >
                    <i class="fas fa-rocket"></i>
                    Live Demo
                  </a>
                {:else if link.platform === "github"}
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="action-btn github-btn"
                  >
                    <i class="fab fa-github"></i>
                    GitHub
                  </a>
                {:else if link.platform === "itch"}
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="action-btn itch-btn"
                  >
                    <i class="fas fa-gamepad"></i>
                    Itch.io
                  </a>
                {:else if link.platform === "steam"}
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="action-btn steam-btn"
                  >
                    <i class="fab fa-steam"></i>
                    Steam
                  </a>
                {:else if link.platform === "epic"}
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="action-btn epic-btn"
                  >
                    <i class="fas fa-store"></i>
                    Epic Games
                  </a>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if showDialogue}
    <div class="dialogue-container">
      <div class="dialogue-box">
        <div class="dialogue-text">
          <p class="speaker-name">
            {currentNPC === "miku" ? "Miku Brasileira" : "Paiaço"}
          </p>
          <p class="dialogue-content">
            {displayedText}
          </p>
        </div>
        {#if showButtons}
          <div class="dialogue-buttons">
            {#if currentNPC === "miku"}
              <button class="dialogue-btn yes-btn" on:click={handleYes}>
                <i class="fas fa-check"></i> Claro
              </button>
              <button class="dialogue-btn no-btn" on:click={handleNo}>
                <i class="fas fa-times"></i> Negativo
              </button>
            {:else if currentNPC === "clown"}
              <button class="dialogue-btn close-btn" on:click={endDialogue}>
                <i class="fas fa-check"></i> Fechar
              </button>
            {/if}
          </div>
        {/if}
        {#if showTextInput}
          <div class="joke-input-container">
            <input
              type="text"
              class="joke-input"
              placeholder="Conte sua piada..."
              bind:value={playerJoke}
              on:keydown={handleJokeKeydown}
            />
            <button class="send-btn" on:click={handleJokeSubmit}>
              <i class="fas fa-paper-plane"></i> Contar
            </button>
            <button class="dialogue-btn no-btn" on:click={handleNo}>
              <i class="fas fa-times"></i> Não
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Position Capture HUD -->
  {#if showHud}
    <div class="position-hud">
      <div class="hud-header">
        <h3>📍 Captura de Posição</h3>
        <button class="hud-toggle" on:click={() => (showHud = false)}>✕</button>
      </div>
      <div class="hud-coords">
        <div class="coord">
          <span class="label">X:</span>
          <span class="value">{playerPosition.x}</span>
        </div>
        <div class="coord">
          <span class="label">Y:</span>
          <span class="value">{playerPosition.y}</span>
        </div>
        <div class="coord">
          <span class="label">Z:</span>
          <span class="value">{playerPosition.z}</span>
        </div>
      </div>
      <button class="hud-copy-btn" on:click={copyPosition}>
        📋 Copiar Código
      </button>
    </div>
  {/if}

  <!-- Audio Mixer Tool -->
  {#if showHud && showAudioMixer}
    <div class="position-hud" style="top: 350px;">
      <div class="hud-header">
        <h3>🔊 Audio Mixer</h3>
        <button class="hud-toggle" on:click={() => (showAudioMixer = false)}
          >✕</button
        >
      </div>

      <div
        class="hud-coords"
        style="gap: 0.8rem; max-height: 400px; overflow-y: auto;"
      >
        <!-- Music -->
        <div class="coord" style="flex-direction: column; gap: 0.2rem;">
          <div style="display: flex; justify-content: space-between;">
            <span class="label">Música</span>
            <span class="value">{Math.round(volBgMusic * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volBgMusic}
            on:input={(e) => updateChannelVolume("music", e.target.value)}
            class="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        <!-- Type (Miku) -->
        <div class="coord" style="flex-direction: column; gap: 0.2rem;">
          <div style="display: flex; justify-content: space-between;">
            <span class="label">Miku</span>
            <span class="value">{Math.round(volType * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volType}
            on:input={(e) => updateChannelVolume("type", e.target.value)}
            class="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        <!-- Steps -->
        <div class="coord" style="flex-direction: column; gap: 0.2rem;">
          <div style="display: flex; justify-content: space-between;">
            <span class="label">Passos</span>
            <span class="value">{Math.round(volStep * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volStep}
            on:input={(e) => updateChannelVolume("step", e.target.value)}
            class="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        <!-- Jump -->
        <div class="coord" style="flex-direction: column; gap: 0.2rem;">
          <div style="display: flex; justify-content: space-between;">
            <span class="label">Pular</span>
            <span class="value">{Math.round(volJump * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volJump}
            on:input={(e) => updateChannelVolume("jump", e.target.value)}
            class="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        <!-- OK (Interaction) -->
        <div class="coord" style="flex-direction: column; gap: 0.2rem;">
          <div style="display: flex; justify-content: space-between;">
            <span class="label">OK</span>
            <span class="value">{Math.round(volOk * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volOk}
            on:input={(e) => updateChannelVolume("ok", e.target.value)}
            class="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        <!-- Bye -->
        <div class="coord" style="flex-direction: column; gap: 0.2rem;">
          <div style="display: flex; justify-content: space-between;">
            <span class="label">Tchau</span>
            <span class="value">{Math.round(volBye * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volBye}
            on:input={(e) => updateChannelVolume("bye", e.target.value)}
            class="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        <!-- Shutter -->
        <div class="coord" style="flex-direction: column; gap: 0.2rem;">
          <div style="display: flex; justify-content: space-between;">
            <span class="label">Câmera</span>
            <span class="value">{Math.round(volShutter * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volShutter}
            on:input={(e) => updateChannelVolume("shutter", e.target.value)}
            class="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        <!-- Zombie -->
        <div class="coord" style="flex-direction: column; gap: 0.2rem;">
          <div style="display: flex; justify-content: space-between;">
            <span class="label">Zumbi</span>
            <span class="value">{Math.round(volZombie * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volZombie}
            on:input={(e) => updateChannelVolume("zombie", e.target.value)}
            class="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer"
          />
        </div>
      </div>

      <button
        class="hud-copy-btn hud-copy-audio-btn"
        on:click={copyAudioDefaults}
      >
        📋 Copiar Padrões
      </button>
    </div>
  {/if}

  <!-- Interaction Hint Overlay -->
  {#if interactionHint.visible}
    <div
      class="fixed pointer-events-none z-[80] transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2"
      style="left: {interactionHint.x}px; top: {interactionHint.y}px;"
    >
      {#if interactionHint.isMobile}
        <!-- Icon for Mobile -->
        <div
          class="bg-white/20 backdrop-blur-md border border-white/40 p-3 rounded-full shadow-[0_0_15px_rgba(255,255,255,0.3)] animate-bounce"
        >
          <i class="fas fa-hand-point-down text-white text-2xl"></i>
        </div>
        <span
          class="text-white font-bold text-sm bg-black/50 px-2 py-1 rounded backdrop-blur-sm"
        >
          {interactionHint.text}
        </span>
      {:else}
        <!-- Desktop Hint -->
        <div
          class="bg-black/60 text-white px-4 py-2 rounded-full backdrop-blur-md border border-white/20 font-bold text-sm shadow-lg animate-pulse"
        >
          {interactionHint.text}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Mobile Interaction Button (Fixed Position) -->
  {#if isMobile && interactionHint.visible}
    <button
      class="fixed bottom-24 right-4 z-[90] w-20 h-20 bg-white/20 backdrop-blur-md border-2 border-white/40 rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(255,255,255,0.3)] active:bg-white/40 active:scale-95 transition-all"
      on:click={checkInteraction}
      aria-label="Interagir"
    >
      <i class="fas fa-hand-pointer text-white text-4xl drop-shadow-lg"></i>
    </button>
  {/if}
</main>

<style>
  .fullscreen {
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: #87ceeb;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    cursor: pointer;
  }

  canvas.crosshair {
    cursor: crosshair;
  }

  .glass-panel {
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    backdrop-filter: blur(4px);
    animation: fadeIn 0.2s ease-out;
  }

  /* Portfolio Modal Styles */
  .portfolio-modal {
    background: linear-gradient(
      135deg,
      rgba(20, 20, 40, 0.98),
      rgba(30, 30, 60, 0.98)
    );
    border: 2px solid rgba(100, 150, 255, 0.3);
    border-radius: 1.5rem;
    max-width: 90%;
    width: 900px;
    height: 85vh;
    margin-top: 2rem;
    margin-bottom: 2rem;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow:
      0 25px 50px -12px rgba(0, 0, 0, 0.5),
      0 0 30px rgba(100, 150, 255, 0.2);
    animation: scaleIn 0.3s ease-out;
    font-family: "Press Start 2P", cursive;
  }

  .portfolio-modal::-webkit-scrollbar {
    width: 8px;
  }

  .portfolio-modal::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 4px;
  }

  .portfolio-modal::-webkit-scrollbar-thumb {
    background: rgba(100, 150, 255, 0.5);
    border-radius: 4px;
  }

  .portfolio-modal::-webkit-scrollbar-thumb:hover {
    background: rgba(100, 150, 255, 0.7);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 1.5rem 2rem;
    border-bottom: 2px solid rgba(100, 150, 255, 0.2);
    background: linear-gradient(
      135deg,
      rgba(40, 40, 80, 0.5),
      rgba(20, 20, 40, 0.5)
    );
    flex-shrink: 0;
  }

  .modal-title {
    font-size: 1.2rem;
    color: #6fa3ff;
    margin: 0 0 0.5rem 0;
    text-shadow: 0 0 10px rgba(111, 163, 255, 0.5);
  }

  .modal-subtitle {
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.6);
    margin: 0;
  }

  .close-button {
    background: rgba(239, 68, 68, 0.2);
    border: 2px solid rgba(239, 68, 68, 0.5);
    color: #ef4444;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 0.5rem;
    font-size: 1.5rem;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: sans-serif;
  }

  .close-button:hover {
    background: rgba(239, 68, 68, 0.3);
    border-color: #ef4444;
    transform: scale(1.1);
  }

  .modal-body {
    padding: 1.5rem;
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* Carousel Styles */
  .carousel-section {
    flex-shrink: 0;
    margin-bottom: 0;
  }

  .carousel-container {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    max-height: 35vh;
    border-radius: 0.75rem;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.3);
    border: 2px solid rgba(100, 150, 255, 0.2);
  }

  .carousel-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: opacity 0.3s ease;
  }

  .carousel-btn {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(0, 0, 0, 0.6);
    border: 2px solid rgba(100, 150, 255, 0.5);
    color: white;
    width: 3rem;
    height: 3rem;
    border-radius: 50%;
    font-size: 2rem;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: sans-serif;
    backdrop-filter: blur(4px);
  }

  .carousel-btn:hover {
    background: rgba(100, 150, 255, 0.3);
    border-color: #6fa3ff;
    transform: translateY(-50%) scale(1.1);
  }

  .prev-btn {
    left: 1rem;
  }

  .next-btn {
    right: 1rem;
  }

  .carousel-indicators {
    display: flex;
    gap: 0.4rem;
    justify-content: center;
    margin-top: 0.5rem;
  }

  .indicator {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    background: rgba(100, 150, 255, 0.3);
    border: 2px solid rgba(100, 150, 255, 0.5);
    cursor: pointer;
    transition: all 0.2s;
    padding: 0;
  }

  .indicator:hover {
    background: rgba(100, 150, 255, 0.5);
    transform: scale(1.2);
  }

  .indicator.active {
    background: #6fa3ff;
    border-color: #6fa3ff;
    box-shadow: 0 0 10px rgba(111, 163, 255, 0.5);
  }

  /* Description Section */
  .description-section {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-height: 0;
  }

  .section-title {
    font-size: 0.75rem;
    color: #6fa3ff;
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    text-shadow: 0 0 10px rgba(111, 163, 255, 0.3);
    flex-shrink: 0;
  }

  /* Position Capture HUD */
  .position-hud {
    position: fixed;
    top: 100px;
    left: 20px;
    background: rgba(0, 0, 0, 0.85);
    color: #00ff00;
    padding: 1rem;
    border-radius: 12px;
    font-family: "Courier New", monospace;
    z-index: 10000;
    border: 1px solid #00ff00;
    box-shadow: 0 0 15px rgba(0, 255, 0, 0.2);
    min-width: 200px;
    backdrop-filter: blur(5px);
  }

  .hud-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.8rem;
    border-bottom: 1px solid rgba(0, 255, 0, 0.3);
    padding-bottom: 0.5rem;
  }

  .hud-header h3 {
    margin: 0;
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #fff;
  }

  .hud-toggle {
    background: transparent;
    border: none;
    color: #ff4444;
    cursor: pointer;
    font-weight: bold;
    padding: 0 4px;
  }

  .hud-coords {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-bottom: 1rem;
  }

  .coord {
    display: flex;
    justify-content: space-between;
  }

  .coord .label {
    color: rgba(255, 255, 255, 0.7);
  }

  .coord .value {
    font-weight: bold;
  }

  .hud-copy-btn {
    width: 100%;
    background: rgba(0, 255, 0, 0.1);
    border: 1px solid #00ff00;
    color: #00ff00;
    padding: 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
    font-family: inherit;
    font-weight: bold;
    text-transform: uppercase;
    font-size: 0.8rem;
  }

  .hud-copy-btn:hover {
    background: rgba(0, 255, 0, 0.2);
    box-shadow: 0 0 10px rgba(0, 255, 0, 0.3);
  }

  .hud-copy-btn:active {
    transform: translateY(1px);
  }

  .short-description {
    color: rgba(255, 255, 255, 0.9);
    font-size: 0.65rem;
    line-height: 1.4;
    margin: 0;
    flex-shrink: 0;
  }

  .long-description {
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.6rem;
    line-height: 1.4;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
  }

  /* Technology Tags */
  .tech-section {
    flex-shrink: 0;
  }

  .tech-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }

  .tech-tag {
    background: rgba(100, 150, 255, 0.2);
    border: 1px solid rgba(100, 150, 255, 0.4);
    color: #6fa3ff;
    padding: 0.4rem 0.8rem;
    border-radius: 0.4rem;
    font-size: 0.55rem;
    transition: all 0.2s;
    white-space: nowrap;
  }

  .tech-tag:hover {
    background: rgba(100, 150, 255, 0.3);
    border-color: #6fa3ff;
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(100, 150, 255, 0.3);
  }

  /* Action Buttons */
  .action-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    flex-shrink: 0;
  }

  .action-btn {
    flex: 1;
    min-width: 120px;
    padding: 0.75rem 1.25rem;
    font-weight: bold;
    font-size: 0.65rem;
    border: 2px solid;
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.2s;
    text-decoration: none;
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .demo-btn {
    background: linear-gradient(135deg, #10b981, #059669);
    border-color: #34d399;
    color: white;
  }

  .demo-btn:hover {
    background: linear-gradient(135deg, #059669, #047857);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
  }

  .github-btn {
    background: linear-gradient(135deg, #6366f1, #4f46e5);
    border-color: #818cf8;
    color: white;
  }

  .github-btn:hover {
    background: linear-gradient(135deg, #4f46e5, #4338ca);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
  }

  .itch-btn {
    background: linear-gradient(135deg, #fa5c5c, #d13030);
    border-color: #ff7b7b;
    color: white;
  }

  .itch-btn:hover {
    background: linear-gradient(135deg, #d13030, #a82020);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(250, 92, 92, 0.4);
  }

  .steam-btn {
    background: linear-gradient(135deg, #1b2838, #0e1419);
    border-color: #66c0f4;
    color: white;
  }

  .steam-btn:hover {
    background: linear-gradient(135deg, #0e1419, #000000);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(102, 192, 244, 0.4);
  }

  .epic-btn {
    background: linear-gradient(135deg, #0078f2, #005bb5);
    border-color: #2196f3;
    color: white;
  }

  .epic-btn:hover {
    background: linear-gradient(135deg, #005bb5, #004080);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 120, 242, 0.4);
  }



  /* Responsive Styles */
  @media (max-width: 768px) {
    .portfolio-modal {
      width: 90%;
      height: 80vh;
      margin-top: 3rem;
    }

    .modal-header {
      padding: 1rem;
    }

    .modal-title {
      font-size: 0.9rem;
    }

    .modal-subtitle {
      font-size: 0.6rem;
    }

    .modal-body {
      padding: 1rem;
      gap: 0.75rem;
    }

    .section-title {
      font-size: 0.65rem;
    }

    .short-description {
      font-size: 0.6rem;
    }

    .long-description {
      font-size: 0.55rem;
      -webkit-line-clamp: 2;
    }

    .tech-tag {
      font-size: 0.5rem;
      padding: 0.3rem 0.6rem;
    }

    .action-btn {
      min-width: 100%;
      font-size: 0.6rem;
      padding: 0.7rem 1rem;
    }

    .carousel-btn {
      width: 2.5rem;
      height: 2.5rem;
      font-size: 1.5rem;
    }

    /* Responsive Dialogue Modal */
    .dialogue-container {
      padding: 1rem;
    }

    .dialogue-box {
      padding: 1rem;
      width: 95%;
    }

    .speaker-name {
      font-size: 0.9rem;
    }

    .dialogue-content {
      font-size: 0.7rem;
    }

    .dialogue-buttons {
      gap: 0.5rem;
      flex-wrap: wrap;
      justify-content: center;
    }

    .dialogue-btn {
      padding: 0.6rem 1rem;
      font-size: 0.7rem;
      flex: 1 1 auto;
      justify-content: center;
      text-align: center;
    }
  }

  @media (max-width: 480px) {
    .portfolio-modal {
      width: 95%;
      height: 85vh;
      margin-top: 2rem;
    }

    .modal-header {
      padding: 0.75rem;
    }

    .modal-title {
      font-size: 0.75rem;
    }

    .modal-subtitle {
      font-size: 0.5rem;
    }



    .close-button {
      width: 2rem;
      height: 2rem;
      font-size: 1.2rem;
    }

    /* Dialogue Modal 480px overrides */
    .dialogue-container {
      padding: 0.5rem;
    }

    .dialogue-box {
      padding: 0.75rem;
      width: 100%;
      border-width: 2px;
      border-radius: 0.5rem;
    }

    .dialogue-buttons {
      flex-direction: column;
      gap: 0.5rem;
    }

    .dialogue-btn {
      width: 100%;
      padding: 0.5rem;
      font-size: 0.65rem;
    }
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes scaleIn {
    from {
      transform: scale(0.95);
      opacity: 0;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }

  .dialogue-container {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    padding: 2rem;
    z-index: 100;
    pointer-events: none;
  }

  .dialogue-box {
    background: linear-gradient(
      135deg,
      rgba(20, 20, 40, 0.95),
      rgba(40, 40, 80, 0.95)
    );
    border: 3px solid rgba(100, 150, 255, 0.8);
    border-radius: 1rem;
    padding: 1.5rem 2rem;
    max-width: 600px;
    width: 100%;
    box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.5);
    pointer-events: all;
    animation: slideUp 0.3s ease-out;
    font-family: "Press Start 2P", cursive;
  }

  .dialogue-text {
    margin-bottom: 1.5rem;
  }

  .speaker-name {
    color: #6fa3ff;
    font-weight: bold;
    font-size: 1.1rem;
    margin-bottom: 0.5rem;
    text-shadow: 0 0 10px rgba(111, 163, 255, 0.5);
  }

  .dialogue-content {
    color: white;
    font-size: 0.8rem;
    line-height: 1.6;
    margin: 0;
  }

  .dialogue-buttons {
    display: flex;
    gap: 1rem;
    justify-content: flex-end;
  }

  .dialogue-btn {
    padding: 0.75rem 1.5rem;
    font-weight: bold;
    font-size: 0.8rem;
    border: 2px solid;
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .yes-btn {
    background: linear-gradient(135deg, #10b981, #059669);
    border-color: #34d399;
    color: white;
  }

  .yes-btn:hover {
    background: linear-gradient(135deg, #059669, #047857);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
  }

  .no-btn {
    background: linear-gradient(135deg, #ef4444, #dc2626);
    border-color: #f87171;
    color: white;
  }

  .no-btn:hover {
    background: linear-gradient(135deg, #dc2626, #b91c1c);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
  }

  .close-btn {
    background: linear-gradient(135deg, #3b82f6, #2563eb);
    border-color: #60a5fa;
    color: white;
  }

  .close-btn:hover {
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
  }

  @keyframes slideUp {
    from {
      transform: translateY(100%);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  .joke-input-container {
    display: flex;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .joke-input {
    flex: 1;
    padding: 0.75rem 1rem;
    background: rgba(255, 255, 255, 0.1);
    border: 2px solid rgba(100, 150, 255, 0.5);
    border-radius: 0.5rem;
    color: white;
    font-family: "Press Start 2P", cursive;
    font-size: 0.7rem;
    outline: none;
    transition: all 0.2s;
  }

  .joke-input::placeholder {
    color: rgba(255, 255, 255, 0.4);
  }

  .joke-input:focus {
    border-color: rgba(100, 150, 255, 0.8);
    background: rgba(255, 255, 255, 0.15);
    box-shadow: 0 0 10px rgba(100, 150, 255, 0.3);
  }

  .send-btn {
    padding: 0.75rem 1.5rem;
    background: linear-gradient(135deg, #6366f1, #4f46e5);
    border: 2px solid #818cf8;
    border-radius: 0.5rem;
    color: white;
    font-family: "Press Start 2P", cursive;
    font-size: 0.7rem;
    font-weight: bold;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    white-space: nowrap;
  }

  .send-btn:hover {
    background: linear-gradient(135deg, #4f46e5, #4338ca);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
  }

  .flash-overlay {
    position: fixed;
    inset: 0;
    background: white;
    z-index: 9999;
    animation: flashFade 0.5s ease-out forwards;
    pointer-events: none;
  }

  @keyframes flashFade {
    0% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }

  /* Volume Slider Styling */
  .volume-slider {
    background: linear-gradient(
      to right,
      #3b82f6 0%,
      #3b82f6 var(--value, 30%),
      #d1d5db var(--value, 30%),
      #d1d5db 100%
    );
  }

  .volume-slider::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #3b82f6;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    transition: all 0.2s;
    margin-top: -4px;
  }

  .volume-slider::-webkit-slider-thumb:hover {
    background: #2563eb;
    transform: scale(1.2);
    box-shadow: 0 3px 6px rgba(0, 0, 0, 0.3);
  }

  .volume-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #3b82f6;
    cursor: pointer;
    border: none;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    transition: all 0.2s;
    margin-top: 0;
  }

  .volume-slider::-moz-range-thumb:hover {
    background: #2563eb;
    transform: scale(1.2);
    box-shadow: 0 3px 6px rgba(0, 0, 0, 0.3);
  }

  .volume-slider::-webkit-slider-runnable-track {
    height: 8px;
    border-radius: 4px;
  }

  .volume-slider::-moz-range-track {
    height: 8px;
    border-radius: 4px;
    background: #d1d5db;
  }
</style>
