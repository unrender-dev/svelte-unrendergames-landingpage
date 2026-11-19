<script>
  import { onMount, onDestroy } from "svelte";
  import { browser } from "$app/environment";
  import { gsap } from "gsap";
  import * as THREE from "three/webgpu";
  import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
  import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
  import Spinner from "./Spinner.svelte";
  import { createRenderer } from "./threeRenderer.js";
  import { createBirdFlock, boundsFromPlayArea } from "./birdFlock.js";
  import {
    contactModalState,
    iframeModalState,
    hasSeenSplashScreen,
    globalLoading,
  } from "./modalStore.js";
  import { registerRenderer, unregisterRenderer } from "./debugStore.js";
  import InnerMediaCarousel from "./InnerMediaCarousel.svelte";

  // Componentes pesados dos slides: só baixam/montam quando o slide chega perto
  // (cada um cria seu próprio renderer/modelos). Antes TODOS montavam no load.
  const lazySlide = {
    ascii: () => import("./AsciiTerminal.svelte"),
    phone: () => import("./PhoneModel.svelte"),
    quiz: () => import("./GamificacaoQuiz.svelte"),
    plane: () => import("./PlaneGame.svelte"),
    web: () => import("./WebInterativa.svelte"),
    modelagem: () => import("./Modelagem3DCarouselItem.svelte"),
  };
  const lazyCache = {};
  function loadSlideComponent(key) {
    return (lazyCache[key] ??= lazySlide[key]().then((m) => m.default));
  }

  let canvasContainer;
  let renderer, scene, camera, dirLight;
  // Bando de pássaros (birdFlock.js): 5 draw calls, asas articuladas, boids em grade
  let flock = null;
  const _cloudDummy = new THREE.Object3D();
  let clock = new THREE.Clock();
  let cloudsInstancedArray = [];
  const cloudData = [];
  let animationId;
  let currentRenderer = "Loading...";
  let showDebugMode = false;
  let lastLogTime = 0;

  // Performance Tier System State
  let performanceTier = "high"; // 'low' | 'medium' | 'high'
  let activeFlockSize = 120; // initialized dynamically in detectPerformanceTier
  let shadowsEnabled = true;
  let shadowMapSize = 1024;
  let maxPixelRatio = 1.5;
  let consecutiveLowFpsSeconds = 0;
  let frameCount = 0;
  let isPageVisible = true;

  // Performance tracking for debug overlay
  let fpsFrames = 0;
  let fpsLastTime = performance.now();
  let rendererInfo = {
    geometries: 0,
    textures: 0,
    drawCalls: 0,
    triangles: 0,
    fps: 0,
    frameTime: 0,
    memory: 0,
    tier: "high",
  };

  function detectPerformanceTier() {
    if (!browser) return;

    const ua = navigator.userAgent;
    const isMobileDevice =
      /Mobi|Android|iPhone|iPad|iPod/i.test(ua) || window.innerWidth < 768;
    const hasLowMemory = navigator.deviceMemory && navigator.deviceMemory < 4;
    const hasLowCores =
      navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;

    if (isMobileDevice) {
      if (hasLowMemory || hasLowCores) {
        performanceTier = "low";
        activeFlockSize = 40;
        shadowsEnabled = false;
        shadowMapSize = 512;
        maxPixelRatio = 0.85;
      } else {
        performanceTier = "medium";
        activeFlockSize = 70;
        shadowsEnabled = true;
        shadowMapSize = 512;
        maxPixelRatio = 1.0;
      }
    } else {
      performanceTier = "high";
      activeFlockSize = 120; // matches FLOCK_SIZE
      shadowsEnabled = true;
      shadowMapSize = 1024; // 1024 is plenty for a low-poly forest!
      maxPixelRatio = 1.5;
    }

    rendererInfo.tier = performanceTier;
    console.info(
      `[Performance System] Detected Tier: ${performanceTier.toUpperCase()} | Active Birds: ${activeFlockSize} | Shadows: ${shadowsEnabled} (Size: ${shadowMapSize}) | Max DPR: ${maxPixelRatio}`,
    );
  }

  function downgradeQuality() {
    if (performanceTier === "high") {
      performanceTier = "medium";
      activeFlockSize = 70;
      shadowMapSize = 512;

      // Shrink shadow map size if shadows are still active
      if (dirLight && dirLight.shadow) {
        dirLight.shadow.mapSize.width = 512;
        dirLight.shadow.mapSize.height = 512;
        // WebGPURenderer redimensiona o shadow map sozinho (ShadowNode.setSize);
        // dar dispose() aqui deixava textura deletada em uso.
      }

      flock?.setCount(activeFlockSize);

      rendererInfo.tier = performanceTier;
      registerRenderer(renderer, currentRenderer, performanceTier);
      console.warn(
        "[Performance System] Downgraded to MEDIUM tier due to low frame rate (<35 FPS)",
      );
    } else if (performanceTier === "medium") {
      performanceTier = "low";
      activeFlockSize = 40;
      shadowsEnabled = false;
      maxPixelRatio = 0.85;

      // Disable shadows completely
      if (renderer) {
        renderer.shadowMap.enabled = false;
      }
      if (dirLight) {
        dirLight.castShadow = false;
      }
      if (scene) {
        scene.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = false;
            child.receiveShadow = false;
          }
        });
      }

      // Lower pixel ratio
      if (renderer) {
        renderer.setPixelRatio(maxPixelRatio);
        onWindowResize(); // force resizing
      }

      flock?.setCount(activeFlockSize);

      rendererInfo.tier = performanceTier;
      registerRenderer(renderer, currentRenderer, performanceTier);
      console.warn(
        "[Performance System] Downgraded to LOW tier due to persistent low frame rate",
      );
    }
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      isPageVisible = false;
      if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
      clock.stop();
      console.log("[Performance System] Page hidden - pausing rendering loop");
    } else {
      isPageVisible = true;
      clock.start();
      if (!animationId && renderer && scene && camera) {
        console.log(
          "[Performance System] Page visible - resuming rendering loop",
        );
        animate();
      }
    }
  }

  // Reset global loading immediately when component is instantiated
  globalLoading.set(true);

  let isDestroyed = false;

  // Shader Code

  // Carousel state
  let currentSlide = 0;
  let isTransitioning = false;
  let touchStartX = 0;
  let touchEndX = 0;
  let autoplayTimer = null;
  let autoplayDelay = 12000; // 12 seconds to ensure > 10s

  // --- Nosso mapa (mesmo do /jogos): static/models/map/unrender_forest.glb ---
  // Gerado por tools/generate-forest-map.mjs; já vem cercado por falésias, então
  // a Home não precisa mais do "rock border" por raycast em runtime.
  const MAP_URL = "/models/map/unrender_forest.glb";
  const MAP_SCALE = 5;
  const MAP_Y = -5;
  const MAP_NO_SHADOW_CAST = new Set(["paths", "trees_far", "terrain_far"]);
  // Fallback caso o GLB venha sem extras.playArea (AREA do gerador)
  const MAP_AREA_FALLBACK = { xmin: -12.5, xmax: 16.5, zmin: -14, zmax: 16 };

  // Bando
  const FLOCK_SIZE = 120;
  const BIRD_MIN_Y = 24;
  const BIRD_MAX_Y = 58;

  // Lazy loading state for heavy content and instant display
  let loadedSlides = [];
  $: {
    if (slides && slides.length > 0) {
      let currentArr =
        loadedSlides.length === slides.length
          ? [...loadedSlides]
          : new Array(slides.length).fill(false);
      // Só o slide atual e o próximo (o anterior já foi montado se o usuário
      // passou por ele; voltar do slide 0 pro último não baixa mais 8 MB no load)
      currentArr[currentSlide] = true;
      currentArr[(currentSlide + 1) % slides.length] = true;
      currentArr[0] = true; // Always ensure first slide is ready
      loadedSlides = currentArr;
    }
  }

  // Carousel slides data
  let slides = [
    {
      title: "NOSSOS SERVIÇOS",
      tagline: "Soluções digitais de alto impacto",
      description:
        "Conteúdo digital e tecnologias que transformam a conexão da sua marca com o público.",
      buttons: [
        { text: "Jogos", action: "/jogos", style: "service" },
        { text: "Web Interativa", action: "/web-interativa", style: "service" },
        { text: "Modelagem 3D", action: "slide:11", style: "service" },
        { text: "Fortnite", action: "/fortnite", style: "service" },
        { text: "Roblox", action: "/roblox", style: "service" },
        { text: "Audiovisual", action: "/audiovisual", style: "service" },
      ],
      media: {
        type: "chromaFloat",
        src: "/images/chroma-keyed-video.webm",
        alt: "Nossos Serviços",
      },
    },
    {
      title: "JOGOS",
      tagline: "Windows, Mac, Linux, Android, iOS, PS, Xbox e Nintendo",
      description:
        "Desenvolvemos FPS, TPS, Plataforma, Corrida e mecânicas autorais com tecnologia de ponta.",
      buttons: [
        {
          text: "SAIBA MAIS",
          action: "/jogos",
          style: "primary",
        },
        { text: "ENTRAR EM CONTATO", action: "contact", style: "secondary" },
      ],
      media: {
        type: "planegame_or_image",
        imageSrc: "/images/jogos.webp",
        currentType: "component", // Will flip to image on first visit
        isLoading: true,
        alt: "Desenvolvimento de Jogos",
      },
    },
    {
      title: "FORTNITE",
      tagline: "Sua marca dentro do Battle Royale",
      description:
        "Ilhas criativas e experiências imersivas no Fortnite para engajar milhões de jogadores globalmente.",
      buttons: [
        {
          text: "SAIBA MAIS",
          action: "/fortnite",
          style: "primary",
        },
        { text: "ENTRAR EM CONTATO", action: "contact", style: "secondary" },
      ],
      media: {
        type: "random_image",
        clickAction: { type: "/fortnite" },
        sources: ["/images/fortnite.webp", "/images/hellmans.webp"],
        src: "/images/fortnite.webp",
        alt: "Fortnite",
      },
    },
    {
      title: "ROBLOX",
      tagline: "Sua marca no Metaverso",
      description:
        "Mapas e experiências imersivas no Roblox para engajamento massivo com o público jovem.",
      buttons: [
        {
          text: "SAIBA MAIS",
          action: "/roblox",
          style: "primary",
        },
        { text: "ENTRAR EM CONTATO", action: "contact", style: "secondary" },
      ],
      media: {
        type: "random_image",
        clickAction: { type: "/roblox" },
        sources: [
          "/images/roblox_banner1.jpg",
          "/images/roblox-game.webp",
          "/images/roblox_banner2.jpg",
        ],
        src: "/images/roblox_banner1.jpg",
        alt: "Roblox",
      },
    },
    {
      title: "WEB INTERATIVA",
      tagline: "Experiências 3D para o Navegador",
      description:
        "Web 3D e vitrines imersivas direto no browser para máximo engajamento e conversão.",
      buttons: [
        {
          text: "SAIBA MAIS",
          action: "/web-interativa",
          style: "primary",
        },
        { text: "ENTRAR EM CONTATO", action: "contact", style: "secondary" },
      ],
      media: {
        type: "webinterativa_component",
        alt: "Web Interativa",
        isLoading: false,
      },
    },
    {
      title: "REALIDADE VIRTUAL",
      tagline: "Mundos totalmente imersivos",
      description:
        "Experiências VR de alta fidelidade para treinamentos, marketing e entretenimento.",
      buttons: [
        {
          text: "SAIBA MAIS",
          action: "/vr",
          style: "primary",
        },
        { text: "ENTRAR EM CONTATO", action: "contact", style: "secondary" },
      ],
      media: {
        type: "localVideo",
        clickAction: { type: "/vr" },
        src: "/images/realidadevirtual.mp4",
        alt: "VR Experience",
      },
    },
    {
      title: "REALIDADE AUMENTADA",
      tagline: "Filtros, vitrines virtuais e experiências interativas.",
      description:
        "Filtros e experiências AR que conectam o digital ao físico para interações instantâneas.",
      buttons: [
        {
          text: "SAIBA MAIS",
          action: "/vr",
          style: "primary",
        },
        { text: "ENTRAR EM CONTATO", action: "contact", style: "secondary" },
      ],
      media: {
        type: "image",
        clickAction: { type: "/vr" },
        src: "/images/ar_app.webp",
        alt: "AR Experience",
      },
    },
    {
      title: "EVENTOS",
      tagline: "Realidade aumentada/virtual e experiências interativas.",
      description:
        "Gamificação, totens interativos, cabines de fotos e ativações digitais.",
      buttons: [
        {
          text: "SAIBA MAIS",
          action: "/gamificacao",
          style: "primary",
        },
        { text: "ENTRAR EM CONTATO", action: "contact", style: "secondary" },
      ],
      media: {
        type: "random_image",
        clickAction: { type: "/gamificacao" },
        sources: [
          "/images/event-camera-photos.jpg",
          "/images/activation-game.jpg",
          "/images/totem-virtual-tryon.jpg",
        ],
        src: "/images/event-camera-photos.jpg",
        alt: "Eventos",
      },
    },
    {
      title: "GAMIFICAÇÃO",
      tagline: "Encante e engaje seu público.",
      description:
        "Com experiências interativas e jogos, seus objetivos são facilmente alcançados.",
      buttons: [
        {
          text: "SAIBA MAIS",
          action: "/gamificacao",
          style: "primary",
        },
        { text: "ENTRAR EM CONTATO", action: "contact", style: "secondary" },
      ],
      media: {
        type: "gamificacao_interactive",
        src: "/images/gamificacao.mp4",
        alt: "Gamificação",
      },
    },
    {
      title: "AUDIOVISUAL",
      tagline: "Computação Gráfica, MetaHumans e Motion Capture",
      description:
        "Animações em 3D, efeitos especiais, produção virtual, MetaHumans ultra-realistas e captura de movimentos realista em tempo real.",
      buttons: [
        {
          text: "SAIBA MAIS",
          action: "/audiovisual",
          style: "primary",
        },
        { text: "ENTRAR EM CONTATO", action: "contact", style: "secondary" },
      ],
      media: {
        type: "random_media",
        clickAction: { type: "/audiovisual" },
        sources: [
          "/images/composition.mp4",
          "/images/mocap.webp",
          "/images/metahuman.mp4",
        ],
        src: "/images/composition.mp4",
        alt: "Audiovisual, VFX & Motion Capture",
      },
    },
    {
      title: "APLICATIVOS MOBILE",
      tagline: "Ferramentas e Customizadores",
      description:
        "Apps mobile como customizadores de produtos e ferramentas técnicas personalizadas.",
      buttons: [
        {
          text: "SAIBA MAIS",
          action: "/web-interativa",
          style: "primary",
        },
        { text: "ENTRAR EM CONTATO", action: "contact", style: "secondary" },
      ],
      media: {
        type: "phone_showcase",
        clickAction: { type: "/web-interativa" },
        images: ["/images/3d_apps_left.png", "/images/3d_apps_right.png"],
        alt: "Aplicativos Mobile",
      },
    },
    {
      title: "MODELAGEM 3D",
      tagline: "Personagens, Cenários e Props",
      description:
        "Modelos 3D otimizados para jogos, web, AR/VR, com rigging e animações complexas.",
      buttons: [
        { text: "ENTRAR EM CONTATO", action: "contact", style: "primary" },
      ],
      media: {
        type: "modelagem3d_component",
        alt: "Modelagem 3D",
        isLoading: false,
      },
    },
  ];

  // Carousel navigation functions
  function nextSlide(isManual = false) {
    if (isTransitioning) return;
    isTransitioning = true;

    const oldSlide = currentSlide;
    currentSlide = (currentSlide + 1) % slides.length;
    animateSlideTransition(oldSlide, currentSlide);

    // If manual navigation, set longer delay
    if (isManual) {
      autoplayDelay = 30000; // 30 seconds
    }

    // Restart autoplay timer
    startAutoplay();
  }

  function prevSlide(isManual = false) {
    if (isTransitioning) return;
    isTransitioning = true;

    const oldSlide = currentSlide;
    currentSlide = (currentSlide - 1 + slides.length) % slides.length;
    animateSlideTransition(oldSlide, currentSlide);

    // If manual navigation, set longer delay
    if (isManual) {
      autoplayDelay = 30000; // 30 seconds
    }

    // Restart autoplay timer
    startAutoplay();
  }

  function goToSlide(index, isManual = false) {
    if (isTransitioning || index === currentSlide) return;
    isTransitioning = true;

    const oldSlide = currentSlide;
    currentSlide = index;
    animateSlideTransition(oldSlide, currentSlide);

    // If manual navigation, set longer delay
    if (isManual) {
      autoplayDelay = 30000; // 30 seconds
    }

    // Restart autoplay timer
    startAutoplay();
  }

  function startAutoplay() {
    // Clear existing timer
    if (autoplayTimer) {
      clearTimeout(autoplayTimer);
    }

    // Set new timer
    autoplayTimer = setTimeout(() => {
      nextSlide(false); // Auto-advance (not manual)
      autoplayDelay = 12000; // Reset to 12 seconds for auto-advance
    }, autoplayDelay);
  }

  function stopAutoplay() {
    if (autoplayTimer) {
      clearTimeout(autoplayTimer);
      autoplayTimer = null;
    }
  }

  function typewriterEffect(element, text, duration = 1.5) {
    if (!element) return;

    element.textContent = "";
    const chars = text.split("");
    const timeline = gsap.timeline();

    chars.forEach((char, index) => {
      timeline.to(
        element,
        {
          duration: duration / chars.length,
          onStart: () => {
            element.textContent += char;
          },
        },
        index * (duration / chars.length),
      );
    });

    return timeline;
  }

  // Timeline storage to manage and kill active animations
  let slideTimelines = {};

  function cleanupSlideAnimations(slideIndex) {
    const slide = document.querySelector(`.slide-${slideIndex}`);
    if (!slide) return;

    const title = slide.querySelector(".slide-title");
    const tagline = slide.querySelector(".slide-tagline");
    const description = slide.querySelector(".slide-description");
    const buttons = slide.querySelectorAll(".slide-button");

    const elements = [title, tagline, description, ...buttons].filter(Boolean);
    gsap.killTweensOf(elements);

    // Also kill the master timeline for this slide if it exists
    if (slideTimelines[slideIndex]) {
      slideTimelines[slideIndex].kill();
      delete slideTimelines[slideIndex];
    }
  }

  function animateSlideContent(slideIndex) {
    const slide = document.querySelector(`.slide-${slideIndex}`);
    if (!slide) return;

    // Ensure state is clean before starting
    cleanupSlideAnimations(slideIndex);

    const title = slide.querySelector(".slide-title");
    const tagline = slide.querySelector(".slide-tagline");
    const description = slide.querySelector(".slide-description");
    const buttons = slide.querySelectorAll(".slide-button");

    const titleText = slides[slideIndex].title;
    const taglineText = slides[slideIndex].tagline;
    const descriptionText = slides[slideIndex].description;

    // Create timeline for sequential animations
    const timeline = gsap.timeline();
    slideTimelines[slideIndex] = timeline;

    if (title) {
      title.textContent = "";
      timeline.add(() => typewriterEffect(title, titleText, 0.8));
    }

    if (tagline) {
      tagline.textContent = "";
      timeline.add(() => typewriterEffect(tagline, taglineText, 1.2), 0.3);
    }

    if (description) {
      description.textContent = "";
      timeline.add(
        () => typewriterEffect(description, descriptionText, 1.8),
        0.6,
      );
    }

    if (buttons.length > 0) {
      gsap.fromTo(
        buttons,
        { opacity: 0, y: 20 },
        {
          opacity: 1,
          y: 0,
          duration: 0.5,
          stagger: 0.1,
          delay: 1.5,
          ease: "power2.out",
        },
      );
    }

    const media = slide.querySelector(".media-container");
    if (media) {
      gsap.fromTo(
        media,
        { opacity: 0, scale: 0.95 },
        { opacity: 1, scale: 1, duration: 0.8, ease: "power2.out", delay: 0.2 },
      );
    }
  }

  function animateSlideTransition(from, to) {
    // Preloaded content handles its own state instantly without requiring reload
    if (slides[to].media && slides[to].media.type === "planegame_or_image") {
      // Force component once it's mounted via lazy load
      slides[to].media.currentType = "component";
    }

    // Handle random_image/random_media type for Roblox & Audiovisual
    // Random selection removed in favor of manual inner carousel navigation

    // Kill old animations immediately
    cleanupSlideAnimations(from);

    // Immediately hide old slide content
    const oldSlide = document.querySelector(`.slide-${from}`);
    if (oldSlide) {
      gsap.set(oldSlide, { opacity: 0, display: "none" });
    }

    // Show new slide and start typewriter animation immediately
    const newSlide = document.querySelector(`.slide-${to}`);
    if (newSlide) {
      gsap.set(newSlide, { opacity: 1, display: "block" });
      animateSlideContent(to);

      setTimeout(() => {
        isTransitioning = false;
      }, 300);
    }
  }

  function handleKeydown(e) {
    if (e.key === "ArrowLeft") prevSlide(true); // Manual navigation
    if (e.key === "ArrowRight") nextSlide(true); // Manual navigation
  }

  function handleTouchStart(e) {
    touchStartX = e.changedTouches[0].screenX;
  }

  function handleTouchEnd(e) {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
  }

  function handleSwipe() {
    const swipeThreshold = 50;
    const diff = touchStartX - touchEndX;

    if (Math.abs(diff) > swipeThreshold) {
      if (diff > 0) {
        nextSlide(true); // Manual navigation
      } else {
        prevSlide(true); // Manual navigation
      }
    }
  }

  function handleButtonClick(button) {
    if (button.action === "contact") {
      openContact();
    } else if (button.action === "iframe") {
      iframeModalState.set({ isOpen: true, url: button.url });
    } else if (button.action.startsWith("slide:")) {
      const slideIndex = parseInt(button.action.split(":")[1], 10);
      goToSlide(slideIndex, true);
    } else {
      window.location.href = button.action + window.location.search;
    }
  }

  // Prevent body scrolling while this fullscreen page is mounted
  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    showDebugMode = params.has("debug") || params.has("3ddebug");

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.overflowX = "hidden";
    document.body.style.overscrollBehavior = "none";

    initThreeJS();

    // Add keyboard listener
    window.addEventListener("keydown", handleKeydown);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Start autoplay
    startAutoplay();

    // Sem espera artificial: libera a tela assim que o mapa está na cena
    // (teto de 2,5 s para redes lentas — os pássaros e o céu já aparecem)
    Promise.race([sceneReady, new Promise((r) => setTimeout(r, 2500))]).then(() => {
      if (isDestroyed) return;
      initAnimations();
      // Ensure at least one frame is rendered before hiding global loader
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!isDestroyed) {
            globalLoading.set(false);

            // Safety: Clear all slide loaders after a 5 second grace period
            // This prevents infinite sliders if iframe load events are missed
            setTimeout(() => {
              if (!isDestroyed) {
                let changed = false;
                slides.forEach((s) => {
                  if (s.media && s.media.isLoading) {
                    s.media.isLoading = false;
                    changed = true;
                  }
                });
                if (changed) {
                  slides = slides;
                  console.log("Safety timeout: Cleared stuck loaders");
                }
              }
            }, 5000);
          }
        });
      });
    });
  });

  // Helper for cleaning up ThreeJS objects
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

  onDestroy(() => {
    isDestroyed = true;
    if (browser) {
      if (animationId) cancelAnimationFrame(animationId);
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      document.body.style.overflowX = "";
      document.body.style.overscrollBehavior = "";
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("keydown", handleKeydown);
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      stopAutoplay(); // Clean up autoplay timer
    }

    if (scene) {
      scene.traverse(disposeNode);
    }

    // Explicitly clear arrays
    flock?.dispose();
    flock = null;
    cloudData.length = 0;
    cloudsInstancedArray = [];

    if (renderer) {
      renderer.dispose?.();
      renderer.forceContextLoss?.();
      renderer.domElement = null;
      renderer = null;
      unregisterRenderer();
    }
  });

  async function initThreeJS() {
    detectPerformanceTier();

    scene = new THREE.Scene();

    // Skybox - Gradient
    scene.background = createSkyGradient();
    // Fog matching the horizon color of the gradient
    // Neblina na cor do horizonte: esconde a borda das colinas distantes do mapa
    scene.fog = new THREE.Fog(0xe48a5c, 320, 1100);

    createClouds();

    camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      1,
      1400,
    );
    // Moved camera forward to Z=25 to be inside the rock borders
    camera.position.set(0, 15, 65);
    camera.lookAt(0, 5, 0);

    // WebGPU-first with automatic WebGL fallback
    const result = await createRenderer({ antialias: true, alpha: true });
    renderer = result.renderer;
    currentRenderer = result.currentRenderer;

    // Register renderer for global debug overlay
    registerRenderer(renderer, currentRenderer, performanceTier);

    renderer.setSize(window.innerWidth, window.innerHeight);

    // Dynamic Pixel Ratio Clamping based on Performance Tier
    const targetPixelRatio = Math.min(
      maxPixelRatio,
      window.devicePixelRatio || 1,
    );
    renderer.setPixelRatio(targetPixelRatio);

    // Dynamic Shadow Map enabling based on Performance Tier
    renderer.shadowMap.enabled = shadowsEnabled;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Medium shadows
    canvasContainer.appendChild(renderer.domElement);

    // Warmer Hemisphere Light for sunset
    const hemiLight = new THREE.HemisphereLight(0xffeeb1, 0x080820, 2.0); // Warm sky, dark ground
    hemiLight.position.set(0, 200, 0);
    scene.add(hemiLight);

    // Golden Sunset Light
    dirLight = new THREE.DirectionalLight(0xffaa33, 3.5);
    dirLight.position.set(50, 20, 50); // Lower angle for long shadows
    dirLight.castShadow = shadowsEnabled;
    dirLight.shadow.bias = -0.001;
    dirLight.shadow.normalBias = 0.2;
    // Dynamic shadow map size based on performance tier
    dirLight.shadow.mapSize.width = shadowMapSize;
    dirLight.shadow.mapSize.height = shadowMapSize;
    dirLight.shadow.camera.top = 300;
    dirLight.shadow.camera.bottom = -300;
    dirLight.shadow.camera.left = -300;
    dirLight.shadow.camera.right = 300;
    scene.add(dirLight);

    // Pássaros já voam enquanto o mapa baixa
    flock = createBirdFlock(THREE, {
      count: FLOCK_SIZE,
      bounds: boundsFromPlayArea(
        [
          [MAP_AREA_FALLBACK.xmin, MAP_AREA_FALLBACK.zmin],
          [MAP_AREA_FALLBACK.xmax, MAP_AREA_FALLBACK.zmax],
        ],
        { scale: MAP_SCALE },
      ),
      minY: BIRD_MIN_Y,
      maxY: BIRD_MAX_Y,
      scale: 1.7,
      palette: "sunset",
      castShadow: false,
      seed: 7,
    });
    flock.setCount(activeFlockSize);
    scene.add(flock.object);

    loadMap();

    window.addEventListener("resize", onWindowResize);
    animate();
  }

  function loadMap() {
    const loader = new GLTFLoader();
    loader.load(
      MAP_URL,
      (gltf) => {
        if (isDestroyed || !scene) return;
        const model = gltf.scene;
        // Mesmo tratamento do /jogos: um material barato (cor por vértice + flat)
        const mapMaterial = new THREE.MeshLambertMaterial({
          vertexColors: true,
          flatShading: true,
        });
        const helpers = [];
        model.traverse((child) => {
          if (!child.isMesh) return;
          if (child.name === "colliders") {
            helpers.push(child); // só colisão, nunca renderiza
            return;
          }
          child.geometry.computeVertexNormals();
          child.material = mapMaterial;
          const castsShadow = !MAP_NO_SHADOW_CAST.has(child.name);
          child.castShadow = shadowsEnabled && castsShadow;
          child.receiveShadow = shadowsEnabled;
          child.userData.castsShadow = castsShadow;
          child.matrixAutoUpdate = false;
        });
        helpers.forEach((m) => m.parent.remove(m));
        model.scale.setScalar(MAP_SCALE);
        model.position.y = MAP_Y;
        model.name = "map_root";
        model.updateMatrixWorld(true);
        model.traverse((c) => (c.matrixAutoUpdate = false));
        scene.add(model);

        // Pássaros usam a clareira real do mapa (extras.playArea)
        const playArea = model.userData.playArea;
        if (flock && Array.isArray(playArea) && playArea.length > 2) {
          flock.setBounds(boundsFromPlayArea(playArea, { scale: MAP_SCALE, margin: 10 }));
        }
        markSceneReady();
      },
      undefined,
      (error) => {
        console.error("An error happened loading the map:", error);
        markSceneReady();
      },
    );
  }

  // O loader global some quando o mapa está na tela (ou em 2,5 s no pior caso)
  let sceneReadyResolve;
  const sceneReady = new Promise((r) => (sceneReadyResolve = r));
  function markSceneReady() {
    sceneReadyResolve?.();
  }


  function createClouds() {
    const totalClouds = 25; // More clouds total
    const numFormations = 4;
    const cloudsPerFormation = Math.ceil(totalClouds / numFormations);

    const puffGeoTemplate = new THREE.DodecahedronGeometry(1, 0);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffcccc,
      emissive: 0xff8866,
      emissiveIntensity: 0.3,
      flatShading: true,
      roughness: 0.0,
      opacity: 0.9,
      transparent: true,
      side: THREE.FrontSide,
    });

    const dummy = new THREE.Object3D();

    for (let f = 0; f < numFormations; f++) {
      // 1. Create unique prototype for this formation
      const prototypePuffs = [];
      const puffCount = 6 + Math.floor(Math.random() * 5); // 6 to 10 puffs per cloud

      for (let j = 0; j < puffCount; j++) {
        const puffGeo = puffGeoTemplate.clone();
        const puffScale = 12 + Math.random() * 15;

        // Spread puffs slightly differently per formation
        const translateX = (Math.random() - 0.5) * (30 + f * 5);
        const translateY = (Math.random() - 0.5) * 10;
        const translateZ = (Math.random() - 0.5) * (20 + f * 5);

        const mat4 = new THREE.Matrix4().compose(
          new THREE.Vector3(translateX, translateY, translateZ),
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              Math.random() * Math.PI,
              Math.random() * Math.PI,
              Math.random() * Math.PI,
            ),
          ),
          new THREE.Vector3(
            puffScale,
            puffScale * (0.5 + Math.random() * 0.3),
            puffScale,
          ),
        );
        puffGeo.applyMatrix4(mat4);
        prototypePuffs.push(puffGeo);
      }

      const prototypeCloudGeo = mergeGeometries(prototypePuffs, false);
      prototypePuffs.forEach((g) => g.dispose());

      // 2. Create InstancedMesh for this formation
      const instancedMesh = new THREE.InstancedMesh(
        prototypeCloudGeo,
        material,
        cloudsPerFormation,
      );
      instancedMesh.castShadow = shadowsEnabled;
      instancedMesh.receiveShadow = false;
      scene.add(instancedMesh);
      cloudsInstancedArray.push(instancedMesh);

      // 3. Position instances
      for (let i = 0; i < cloudsPerFormation; i++) {
        const cloudX = (Math.random() - 0.5) * 2000;
        const cloudY = 120 + Math.random() * 100;
        const cloudZ = -400 + (Math.random() - 0.5) * 1000;
        const speed = 0.5 + Math.random() * 1.5;
        const scale = 0.6 + Math.random() * 1.2;

        const pos = new THREE.Vector3(cloudX, cloudY, cloudZ);

        cloudData.push({
          formationIndex: f,
          instanceIndex: i,
          position: pos,
          speed: speed,
          scale: scale,
          rotationY: Math.random() * Math.PI * 2,
        });

        dummy.position.copy(pos);
        dummy.rotation.y = cloudData[cloudData.length - 1].rotationY;
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(i, dummy.matrix);
      }
      instancedMesh.instanceMatrix.needsUpdate = true;
    }
    puffGeoTemplate.dispose();
  }

  function createSkyGradient() {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, 0, 512);

    // Brazil Sunset Palette: Blue -> Purple -> Orange
    gradient.addColorStop(0.0, "#3b6978"); // Dusky Blue Top
    gradient.addColorStop(0.3, "#5d44a2"); // Purple transition
    gradient.addColorStop(0.6, "#ed7e4e"); // Sunset Orange
    gradient.addColorStop(1.0, "#fce043"); // Horizon Gold

    context.fillStyle = gradient;
    context.fillRect(0, 0, 2, 512);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
  function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function animate() {
    if (!renderer || !isPageVisible) return;

    const frameStartTime = performance.now();
    fpsFrames++;

    const delta = clock.getDelta();
    const time = clock.getElapsedTime();

    if (frameStartTime - fpsLastTime >= 1000) {
      const currentFps = Math.round(
        (fpsFrames * 1000) / (frameStartTime - fpsLastTime),
      );
      rendererInfo = {
        ...rendererInfo,
        fps: currentFps,
      };
      fpsFrames = 0;
      fpsLastTime = frameStartTime;

      // Update RAM if available (Chromium only)
      if (performance.memory) {
        rendererInfo = {
          ...rendererInfo,
          memory: Math.round(performance.memory.usedJSHeapSize / 1048576),
        };
      } else {
        rendererInfo = { ...rendererInfo, memory: "N/A" };
      }

      // Dynamic Performance Monitor: Downgrade quality if frame rate falls consistently
      if (time > 6 && performanceTier !== "low") {
        if (currentFps < 35) {
          consecutiveLowFpsSeconds++;
          if (consecutiveLowFpsSeconds >= 3) {
            downgradeQuality();
            consecutiveLowFpsSeconds = 0;
          }
        } else {
          consecutiveLowFpsSeconds = 0;
        }
      }
    }

    frameCount++;

    // Pássaros (delta-time, independe do FPS)
    flock?.update(delta, time);

    // Animate clouds
    if (cloudsInstancedArray.length > 0) {
      cloudData.forEach((cloud) => {
        cloud.position.x += cloud.speed * delta * 5; // Drift across X axis slowly
        if (cloud.position.x > 1000) {
          cloud.position.x = -1000; // Reset to other side when leaving bounds
        }
        _cloudDummy.position.copy(cloud.position);
        _cloudDummy.rotation.y = cloud.rotationY;
        _cloudDummy.scale.set(cloud.scale, cloud.scale, cloud.scale);
        _cloudDummy.updateMatrix();
        cloudsInstancedArray[cloud.formationIndex].setMatrixAt(
          cloud.instanceIndex,
          _cloudDummy.matrix,
        );
      });
      cloudsInstancedArray.forEach((mesh) => {
        mesh.instanceMatrix.needsUpdate = true;
      });
    }
    if (camera) {
      camera.position.x = Math.sin(time * 0.1) * 10;
      camera.lookAt(0, 15, 0);
    }

    if (renderer && scene && camera) {
      // Force reset of info per cycle to prevent infinite accumulation bug in certain WebGPU adapters
      if (renderer.info) {
        renderer.info.reset();
      }

      renderer.render(scene, camera); // init() já foi aguardado: render síncrono (sem await por frame)

      // Live debug tracking as requested
      if (
        showDebugMode &&
        renderer.info &&
        frameStartTime - lastLogTime > 1000
      ) {
        console.log(
          "Draw Calls:",
          renderer.info.render.calls || renderer.info.render.drawCalls,
        );
        lastLogTime = frameStartTime;
      }
    }

    // Schedule next frame ONLY if renderer is still valid and page is visible
    if (renderer && isPageVisible) {
      animationId = requestAnimationFrame(animate);
    }
  }

  function initAnimations() {
    // Animate initial slide content with typewriter effect
    setTimeout(() => {
      animateSlideContent(0);
    }, 100);

    gsap.from(".carousel-nav", {
      duration: 0.8,
      opacity: 0,
      ease: "power2.out",
      delay: 0.5,
    });
  }

  function openContact() {
    contactModalState.set({ isOpen: true, title: "" });
  }
</script>

<svelte:head>
  <!-- Só o mapa da cena é pré-carregado; as mídias dos slides carregam sob demanda (antes ~40 MB de GIF/vídeo no load) -->
  <link rel="preload" as="fetch" href="/models/map/unrender_forest.glb" crossorigin="anonymous" />
</svelte:head>

<main
  class="fixed inset-0 text-white overflow-hidden"
  class:hidden={$globalLoading}
  on:touchstart={handleTouchStart}
  on:touchend={handleTouchEnd}
>
  <!-- 3D Background -->
  <div
    bind:this={canvasContainer}
    class="absolute inset-0 -z-10 bg-sky-300"
  ></div>

  <!-- Glass Overlay (Right Side Blur) -->
  <div
    class="absolute inset-0 z-0 pointer-events-none"
    style="
    background: rgba(0, 0, 0, 0.2); 
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    mask-image: linear-gradient(to right, transparent 0%, black 60%);
    -webkit-mask-image: linear-gradient(to right, transparent 0%, black 60%);
  "
  ></div>

  <!-- Carousel Container -->
  <div
    class="carousel-content absolute inset-0 w-full p-4 md:p-8 pointer-events-none flex flex-col items-center justify-center"
  >
    <div class="max-w-7xl w-full mx-auto">
      {#each slides as slide, index}
        <div
          class="slide slide-{index} relative flex flex-col md:flex-row items-center gap-4 sm:gap-6 md:gap-8 lg:gap-12 w-full justify-end"
          class:active={index === currentSlide}
          style="display: {index === currentSlide ? 'flex' : 'none'};"
        >
          <!-- Media Container -->
          {#if slide.media}
            {#if slide.media.type === "ascii"}
              <div
                class="w-full md:w-[calc(50%-1.5rem)] flex-shrink-0 max-w-2xl aspect-video relative z-50 pointer-events-auto group p-0"
              >
                {#if loadedSlides[index]}
                  {#await loadSlideComponent("ascii") then Comp}
                    <svelte:component this={Comp} src={slide.media.src} isActive={index === currentSlide} />
                  {/await}
                {/if}
              </div>
            {:else if slide.media.type === "webinterativa_component"}
              <div
                class="w-full md:w-[calc(50%-1.5rem)] flex-shrink-0 max-w-2xl aspect-video rounded-3xl overflow-hidden shadow-2xl border border-white/20 backdrop-blur-md pointer-events-auto relative group media-container p-0 bg-black/50"
                role="presentation"
                on:mouseenter={stopAutoplay}
                on:mouseleave={startAutoplay}
              >
                <div class="w-full h-full pointer-events-auto absolute inset-0 block">
                  {#if loadedSlides[index]}
                    {#await loadSlideComponent("web") then Comp}
                      <svelte:component this={Comp} />
                    {/await}
                  {/if}
                </div>
              </div>
            {:else if slide.media.type === "html"}
              <div
                class="w-full md:w-[calc(50%-1.5rem)] flex-shrink-0 max-w-2xl aspect-video rounded-3xl overflow-hidden shadow-2xl border border-white/20 backdrop-blur-md pointer-events-auto relative group media-container p-0 bg-black/50"
                role="presentation"
                on:mouseenter={stopAutoplay}
                on:mouseleave={startAutoplay}
              >
                {#if slide.media.isLoading}
                  <Spinner
                    position="absolute"
                    background="transparent"
                    showText={false}
                  />
                {/if}
                {#if loadedSlides[index]}
                  <iframe
                    src={slide.media.src}
                    title={slide.media.alt || slide.title}
                    class="w-full h-full pointer-events-auto border-0 block"
                    on:load={() => {
                      slide.media.isLoading = false;
                      slides = slides;
                    }}
                  ></iframe>
                {/if}
              </div>
            {:else if slide.media.type === "planegame_or_image"}
              <div
                class="w-full md:w-[calc(50%-1.5rem)] flex-shrink-0 max-w-2xl aspect-video rounded-3xl overflow-hidden shadow-2xl border border-white/20 backdrop-blur-md pointer-events-auto relative group media-container p-0 bg-black/50"
                role="presentation"
                on:mouseenter={stopAutoplay}
                on:mouseleave={startAutoplay}
              >
                {#if slide.media.isLoading && slide.media.currentType === "component"}
                  <Spinner
                    position="absolute"
                    background="transparent"
                    showText={false}
                  />
                {/if}
                <!-- Preloaded image fallback -->
                <img
                  src={loadedSlides[index] && slide.media.currentType === "image" ? slide.media.imageSrc : undefined}
                  alt={slide.media.alt || slide.title}
                  loading="lazy"
                  decoding="async"
                  class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                  style="display: {slide.media.currentType === 'image'
                    ? 'block'
                    : 'none'};"
                  on:load={() => {
                    if (slide.media.currentType === "image") {
                      slide.media.isLoading = false;
                      slides = slides;
                    }
                  }}
                />
                <!-- Lazy mounted component -->
                {#if loadedSlides[index]}
                  <div
                    class="w-full h-full pointer-events-auto absolute inset-0"
                    style="display: {slide.media.currentType === 'component'
                      ? 'block'
                      : 'none'};"
                  >
                    {#await loadSlideComponent("plane") then Comp}
                      <svelte:component this={Comp} on:ready={() => {
                        if (
                          slide.media &&
                          slide.media.type === "planegame_or_image"
                        ) {
                          slide.media.isLoading = false;
                          slides = slides;
                        }
                      }} />
                    {/await}
                  </div>
                {/if}
              </div>
            {:else if slide.media.type === "gamificacao_interactive"}
              <div
                class="w-full md:w-[calc(50%-1.5rem)] flex-shrink-0 max-w-2xl aspect-video rounded-3xl overflow-hidden shadow-2xl backdrop-blur-md pointer-events-auto relative group media-container bg-transparent flex flex-col items-center justify-center p-0 m-0"
                class:cursor-pointer={slide.media.clickAction}
                role={slide.media.clickAction ? "button" : "presentation"}
                on:mouseenter={stopAutoplay}
                on:mouseleave={startAutoplay}
                on:click={() =>
                  slide.media.clickAction &&
                  handleButtonClick({ action: slide.media.clickAction.type })}
              >
                {#if loadedSlides[index]}
                  {#await loadSlideComponent("quiz") then Comp}
                    <svelte:component this={Comp} src={slide.media.src} active={index === currentSlide} />
                  {/await}
                {/if}
              </div>
            {:else if slide.media.type === "modelagem3d_component"}
              <div
                class="w-full md:w-[calc(50%-1.5rem)] flex-shrink-0 h-[40vh] min-h-[300px] md:min-h-0 md:h-[65vh] pointer-events-auto relative group media-container p-0 flex flex-col items-center justify-center"
                role="presentation"
                on:mouseenter={stopAutoplay}
                on:mouseleave={startAutoplay}
              >
                <div class="w-full h-full pointer-events-auto absolute inset-0 block">
                  {#if loadedSlides[index]}
                    {#await loadSlideComponent("modelagem") then Comp}
                      <svelte:component this={Comp} isActive={index === currentSlide} />
                    {/await}
                  {/if}
                </div>
              </div>
            {:else if slide.media.type === "phone_showcase"}
              <div
                class="w-full md:w-[calc(50%-1.5rem)] flex-shrink-0 max-w-2xl aspect-video rounded-3xl overflow-hidden shadow-2xl border border-white/20 backdrop-blur-md pointer-events-auto relative group media-container p-0"
                class:cursor-pointer={slide.media.clickAction}
                role={slide.media.clickAction ? "button" : "presentation"}
                on:click={() =>
                  slide.media.clickAction &&
                  handleButtonClick({ action: slide.media.clickAction.type })}
              >
                <div class="phone-showcase-layout">
                  <!-- 3D Phone Model -->
                  <div class="phone-model-side">
                    {#if loadedSlides[index]}
                      {#await loadSlideComponent("phone") then Comp}
                        <svelte:component this={Comp} isActive={index === currentSlide} />
                      {/await}
                    {/if}
                  </div>
                  <!-- App Screenshots -->
                  <div class="phone-images-side">
                    {#each slide.media.images as imgSrc, imgIdx}
                      <img
                        src={loadedSlides[index] ? imgSrc : undefined}
                        loading="lazy"
                        decoding="async"
                        alt="{slide.media.alt} {imgIdx + 1}"
                        class="phone-showcase-img"
                      />
                    {/each}
                  </div>
                </div>
              </div>
            {:else if slide.media.type === "chromaFloat"}
              <!-- svelte-ignore a11y-media-has-caption -->
              <!-- Nossos Serviços only: fixed bottom-left floating character -->
              <div class="pointer-events-none media-container localvideo-float">
                <video
                  src={slide.media.src}
                  autoplay
                  loop
                  muted
                  playsinline
                  class="w-full h-full object-contain transition-transform duration-500 ease-out hover:scale-110"
                  style="filter: drop-shadow(0 0 32px rgba(249,145,38,0.22));"
                ></video>
              </div>
            {:else}
              <button
                class="w-full md:w-[calc(50%-1.5rem)] flex-shrink-0 max-w-2xl aspect-video rounded-3xl overflow-hidden shadow-2xl border border-white/20 backdrop-blur-md pointer-events-auto relative group media-container p-0"
                class:cursor-pointer={slide.media.clickAction}
                disabled={!slide.media.clickAction}
                on:click={() =>
                  slide.media.clickAction &&
                  handleButtonClick({
                    action: slide.media.clickAction.type,
                    url: slide.media.clickAction.url,
                  })}
              >
                {#if slide.media.type === "image"}
                  <img
                    src={loadedSlides[index] ? slide.media.src : undefined}
                    loading="lazy"
                    decoding="async"
                    alt={slide.media.alt || slide.title}
                    class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                  />
                {:else if slide.media.type === "localVideo"}
                  {#if loadedSlides[index]}
                    <!-- svelte-ignore a11y-media-has-caption -->
                    <video
                      src={slide.media.src}
                      autoplay
                      loop
                      muted
                      playsinline
                      class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                    ></video>
                  {/if}
                {:else if slide.media.type === "random_image" || slide.media.type === "random_media"}
                  {#if loadedSlides[index]}
                    <InnerMediaCarousel sources={slide.media.sources} alt={slide.media.alt || slide.title} isActive={index === currentSlide} />
                  {/if}
                {:else if slide.media.type === "video"}
                  <iframe
                    src={`https://www.youtube.com/embed/${slide.media.src}?autoplay=0&mute=1&controls=0&loop=1&playlist=${slide.media.src}&modestbranding=1&rel=0&showinfo=0`}
                    title={slide.title}
                    class="w-full h-full object-cover pointer-events-none"
                    frameborder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  ></iframe>
                  <!-- Overlay to capture clicks if action is present -->
                  {#if slide.media.clickAction}
                    <div
                      class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center"
                    >
                      <div
                        class="w-16 h-16 rounded-full bg-white/20 backdrop-blur-md border border-white/40 flex items-center justify-center scale-0 group-hover:scale-100 transition-transform duration-300"
                      >
                        <svg
                          class="w-8 h-8 text-white"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                          />
                        </svg>
                      </div>
                    </div>
                  {/if}
                {/if}
              </button>
            {/if}
          {/if}

          <!-- Text Content -->
          <div
            class="pointer-events-auto w-full md:w-[calc(50%-1.5rem)] flex-shrink-0 space-y-3 sm:space-y-4 md:space-y-6 lg:space-y-8 max-w-2xl flex flex-col items-end text-right"
          >
            <!-- Title -->
            <div class="space-y-4 flex flex-col items-end">
              <h1
                class="slide-title text-2xl sm:text-3xl md:text-5xl lg:text-7xl drop-shadow-lg text-[#f99126]"
                style="font-family: 'Montserrat', 'Roboto', sans-serif; text-transform: uppercase; font-weight: 700; letter-spacing: 0.02em; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;"
              >
                {slide.title}
              </h1>
              <div class="w-32 h-1 bg-[#f99126] rounded-full shadow-lg"></div>
            </div>

            <!-- Tagline -->
            <h2
              class="slide-tagline text-base sm:text-lg md:text-2xl lg:text-4xl font-semibold drop-shadow-md text-white"
              style="font-family: 'Rajdhani', sans-serif; font-weight: 600; letter-spacing: 0.03em;"
            >
              {slide.tagline}
            </h2>

            <!-- Description -->
            <p
              class="slide-description text-sm sm:text-base md:text-lg lg:text-xl drop-shadow-md font-medium text-white"
              style="font-family: 'Rajdhani', sans-serif; font-weight: 400; letter-spacing: 0.01em;"
            >
              {slide.description}
            </p>

            <!-- Buttons -->
            <div
              class="flex flex-wrap gap-2 sm:gap-3 md:gap-4 items-center justify-end pt-3 sm:pt-4"
            >
              {#each slide.buttons as button}
                {#if button.style === "primary"}
                  <button
                    class="slide-button px-4 sm:px-6 md:px-8 py-2 sm:py-3 md:py-4 bg-[#f99126] border-2 border-[#f99126]/30 rounded-full font-bold text-xs sm:text-sm md:text-lg hover:bg-[#f99126]/80 transition-all shadow-lg text-white"
                    on:click={() => handleButtonClick(button)}
                  >
                    {button.text}
                  </button>
                {:else if button.style === "secondary"}
                  <button
                    class="slide-button px-4 sm:px-6 md:px-8 py-2 sm:py-3 md:py-4 bg-white/10 border-2 border-white/30 rounded-full font-bold text-xs sm:text-sm md:text-lg hover:bg-white/20 transition-all shadow-lg text-white"
                    on:click={() => handleButtonClick(button)}
                  >
                    {button.text}
                  </button>
                {:else if button.style === "service"}
                  <a
                    class="slide-button px-3 sm:px-4 md:px-6 py-1.5 sm:py-2 md:py-3 bg-[#f99126]/20 border border-[#f99126]/40 rounded-full font-semibold text-xs sm:text-sm md:text-base hover:bg-[#f99126]/30 hover:scale-105 transition-all shadow-md text-white"
                    href={button.action}
                  >
                    {button.text}
                  </a>
                {/if}
              {/each}
            </div>
          </div>
        </div>
      {/each}
    </div>
  </div>

  <!-- Carousel Navigation -->
  <div
    class="carousel-nav absolute bottom-3 sm:bottom-5 md:bottom-8 left-1/2 transform -translate-x-1/2 flex items-center gap-3 sm:gap-4 md:gap-6 pointer-events-auto z-[60]"
  >
    <!-- Previous Button -->
    <button
      on:click={() => prevSlide(true)}
      class="w-9 h-9 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-full bg-white/10 backdrop-blur-md border border-white/30 flex items-center justify-center hover:bg-white/20 transition-all shadow-lg"
      aria-label="Previous slide"
    >
      <svg
        class="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-white"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M15 19l-7-7 7-7"
        />
      </svg>
    </button>

    <!-- Dot Indicators -->
    <div class="flex gap-1 sm:gap-1.5 md:gap-2">
      {#each slides as _, index}
        <button
          on:click={() => goToSlide(index, true)}
          class="w-2 h-2 sm:w-2.5 sm:h-2.5 md:w-3 md:h-3 rounded-full bg-white/40 transition-all duration-300"
          class:bg-[#f99126]={index === currentSlide}
          class:scale-125={index === currentSlide}
          aria-label="Go to slide"
        ></button>
      {/each}
    </div>

    <!-- Next Button -->
    <button
      on:click={() => nextSlide(true)}
      class="w-9 h-9 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-full bg-white/10 backdrop-blur-md border border-white/30 flex items-center justify-center hover:bg-white/20 transition-all shadow-lg"
      aria-label="Next slide"
    >
      <svg
        class="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-white"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M9 5l7 7-7 7"
        />
      </svg>
    </button>
  </div>
</main>

<style>
  .slide {
    transition: opacity 0.5s ease-in-out;
  }

  .slide.active {
    opacity: 1;
  }

  /* Typography */
  .slide-title {
    font-family: "Montserrat", "Roboto", sans-serif;
    font-weight: 700;
    letter-spacing: 0.08em;
  }

  .slide-tagline {
    font-family: "Rajdhani", sans-serif;
    font-weight: 600;
    letter-spacing: 0.03em;
  }

  .slide-description {
    font-family: "Rajdhani", sans-serif;
    font-weight: 400;
    letter-spacing: 0.01em;
    line-height: 1.6;
  }

  .slide-button {
    font-family: "Rajdhani", sans-serif;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  /* Allow horizontal swipe gestures but also vertical scroll within carousel */
  main {
    touch-action: pan-x pan-y;
  }

  /* Media containers: constrain height on mobile portrait so text stays visible */
  @media (max-width: 767px) and (orientation: portrait) {
    :global(.media-container) {
      max-height: 35vh !important;
    }
  }

  /* Media containers: constrain height on mobile landscape */
  @media (max-height: 500px) and (orientation: landscape) {
    :global(.media-container) {
      max-height: 55vh !important;
    }
  }

  /* Phone Showcase Layout */
  .phone-showcase-layout {
    display: flex;
    width: 100%;
    height: 100%;
    align-items: center;
    gap: 0.5rem;
  }

  .phone-model-side {
    flex: 0 0 38%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .phone-images-side {
    flex: 1;
    display: flex;
    flex-direction: row;
    gap: 0.5rem;
    padding: 0.75rem 0.75rem 0.75rem 0;
    height: 100%;
    align-items: center;
    justify-content: center;
  }

  .phone-showcase-img {
    max-width: 48%;
    max-height: 90%;
    object-fit: contain;
    border-radius: 1rem;
    filter: drop-shadow(0 4px 16px rgba(0, 0, 0, 0.5));
    transition: transform 0.4s ease;
    animation: phoneImgFloat 3.5s ease-in-out infinite;
  }

  .phone-showcase-img:nth-child(2) {
    animation-delay: -1.75s;
  }

  .phone-showcase-img:hover {
    transform: scale(1.04);
  }

  @keyframes phoneImgFloat {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-8px);
    }
  }

  @media (max-width: 640px) {
    .phone-showcase-layout {
      gap: 0.25rem;
    }
    .phone-model-side {
      flex: 0 0 36%;
    }
    .phone-images-side {
      padding: 0.25rem 0.25rem 0.25rem 0;
      gap: 0.25rem;
    }
    .phone-showcase-img {
      border-radius: 0.5rem;
    }
  }

  /* Nossos Serviços — chroma character responsive layout */
  .localvideo-float {
    position: relative; /* Default on mobile vertical: flows in flex column */
    width: 260px; /* Increased from 200px */
    height: 325px; /* Increased from 250px */
    z-index: 20;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    pointer-events: none;
    order: -1; /* Place above the text on mobile portrait */
    margin: 0 10% -70px auto; /* Aligned closer to the right-aligned text and pulled closer vertically */
  }

  /* Tablet landscape & small desktop screens */
  @media (min-width: 768px) {
    .localvideo-float {
      position: absolute;
      top: -50px;
      bottom: auto;
      left: 80px; /* Moved closer to the text content on the right */
      width: 380px; /* Increased from 320px */
      height: 475px; /* Increased from 400px */
      order: unset;
      margin: 0;
    }
  }

  /* Large desktop screens */
  @media (min-width: 1024px) {
    .localvideo-float {
      position: absolute;
      top: -100px;
      bottom: auto;
      left: 140px; /* Moved closer to the text content on the right */
      width: 540px; /* Increased from 440px */
      height: 675px; /* Increased from 550px */
      order: unset;
      margin: 0;
    }
  }

  /* Mobile Landscape / Short Screens */
  @media (max-height: 500px) and (orientation: landscape) {
    .localvideo-float {
      position: absolute !important;
      top: 15px !important;
      bottom: auto !important;
      left: 20px !important;
      width: 150px !important;
      height: 190px !important;
      order: unset !important;
      margin: 0 !important;
    }
  }

  /* ===== RESPONSIVE CAROUSEL LAYOUT ===== */

  /* Global Short Screen Handling (Laptops, Horizontal Tablets, etc) */
  @media (max-height: 850px) {
    :global(.media-container) {
      max-width: 480px !important;
    }
    .slide-title {
      font-size: clamp(1.8rem, 4vh + 0.8rem, 3.2rem) !important;
    }
    .slide-tagline {
      font-size: clamp(0.95rem, 2vh + 0.4rem, 1.5rem) !important;
    }
    .slide-description {
      font-size: clamp(0.8rem, 1.8vh + 0.1rem, 1.05rem) !important;
      line-height: 1.35 !important;
    }
    /* Reduce vertical spacing between text elements */
    :global(.space-y-8 > :not([hidden]) ~ :not([hidden])),
    :global(.space-y-6 > :not([hidden]) ~ :not([hidden])) {
      margin-top: 0.8rem !important;
    }
    /* Scale buttons slightly down */
    .slide-button {
      padding: 0.5rem 1.1rem !important;
      font-size: 0.85rem !important;
    }
  }

  /* Extra Short Screens (< 650px height) */
  @media (max-height: 650px) {
    :global(.media-container) {
      max-width: 380px !important;
    }
    .slide-title {
      font-size: clamp(1.4rem, 3.5vh + 0.5rem, 2.2rem) !important;
    }
    .slide-tagline {
      font-size: clamp(0.85rem, 1.8vh + 0.3rem, 1.2rem) !important;
    }
    .slide-description {
      font-size: clamp(0.75rem, 1.5vh + 0.1rem, 0.9rem) !important;
      line-height: 1.25 !important;
    }
    /* Further reduce gaps */
    :global(.space-y-8 > :not([hidden]) ~ :not([hidden])),
    :global(.space-y-6 > :not([hidden]) ~ :not([hidden])),
    :global(.space-y-4 > :not([hidden]) ~ :not([hidden])) {
      margin-top: 0.5rem !important;
    }
    .slide-button {
      padding: 0.4rem 0.8rem !important;
      font-size: 0.75rem !important;
    }
  }

  /* Mobile Landscape: switch to side-by-side layout like desktop */
  @media (max-height: 500px) and (orientation: landscape) {
    :global(.media-container) {
      max-width: 250px !important;
    }
    .slide {
      flex-direction: row !important;
      align-items: center !important;
      gap: 1rem !important;
    }
    .slide-title {
      font-size: 1.2rem !important;
    }
    .slide-tagline {
      font-size: 0.8rem !important;
    }
    .slide-description {
      font-size: 0.7rem !important;
      line-height: 1.2 !important;
    }
    .slide-button {
      padding: 0.3rem 0.6rem !important;
      font-size: 0.65rem !important;
    }
  }

  /* Tablet portrait: compact spacing */
  @media (min-width: 768px) and (max-width: 1023px) and (orientation: portrait) {
    /* Kept for potential portrait tablet overrides if needed */
  }

  /* Very small mobile screens (< 375px width) */
  @media (max-width: 374px) {
    .slide-title {
      font-size: 1.4rem !important;
    }
    .slide-tagline {
      font-size: 0.85rem !important;
    }
    .slide-description {
      font-size: 0.75rem !important;
    }
    .slide-button {
      padding: 0.3rem 0.6rem !important;
      font-size: 0.6rem !important;
    }
  }

  /* Carousel nav: ensure it never overlaps with FAB buttons on mobile */
  @media (max-width: 767px) {
    :global(.carousel-nav) {
      bottom: 0.5rem !important;
    }
  }
</style>

