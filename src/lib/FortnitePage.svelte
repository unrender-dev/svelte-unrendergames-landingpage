<script>
  import { onMount, onDestroy } from "svelte";
  import { gsap } from "gsap";
  import * as THREE from "three";
  import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

  import Carousel from "./Carousel.svelte";
  import { contactModalState, globalLoading } from "./modalStore.js";
  import FeatureGrid from "./FeatureGrid.svelte";
  import { registerRenderer, unregisterRenderer } from "./debugStore.js";
  import { createRenderer } from "./threeRenderer.js";

  const features = [
    {
      icon: "fas fa-globe",
      title: "Mundos Virtuais",
      shortDesc: "Crie réplicas e experiências de marca.",
      longDesc:
        "Utilizamos a UEFN para projetar e publicar ilhas super realistas e imersivas conectando sua marca com o público.",
      images: ["/images/fortnite_banner1.jpg"],
    },
    {
      icon: "fas fa-gamepad",
      title: "Gamificação",
      shortDesc: "Engaje e fidelize com missões e eventos.",
      longDesc:
        "Adicionamos mecânicas de gameplay viciantes e missões diárias com recompensas para reter os jogadores.",
      images: ["/images/hellmans.webp"],
    },
    {
      icon: "fas fa-chart-bar",
      title: "Retorno Real",
      shortDesc: "Tráfego, cupons e métricas de negócio.",
      longDesc:
        "Conecte o virtual e o físico oferecendo descontos via cupons no Fortnite convertendo engajamento em vendas.",
      images: ["/images/fortnite_banner1.jpg"],
    },
    {
      icon: "fas fa-users",
      title: "Comunidade",
      shortDesc: "Experiências validadas pela comunidade.",
      longDesc:
        "Trabalhamos com criadores de conteúdo do Fortnite para que sua experiência ganhe tração orgânica.",
      images: ["/images/hellmans.webp", "/images/fortnite_banner1.jpg"],
    },
  ];

  let danceCanvas;
  let renderer, scene, camera, mixer, clock, reqId;
  let character;
  let modelGroup;
  let activeAction;
  let actions = {};

  // Cycle logic state
  let cycleState = "IDLE"; // "IDLE" or "CYCLING"
  let cycleTimeout;
  let animationsList = [];
  let currentAnimIndex = 0;

  // Emote wheel state
  let showEmoteWheel = false;
  let emoteSelection = "static";

  let audioPlayer = null;

  const playEmoteAudio = (key) => {
    stopEmoteAudio();
    let path = null;
    let rate = 1.0;

    if (key === "boogiedown") {
      path = "/fortnite/fboogiedown";
      rate = 1.0;
    } else if (key === "superhero") {
      path = "/fortnite/fheroland.mp3";
      rate = 1.2;
    } else if (key === "afrohouse") {
      path = "/fortnite/fafrohouse.mp3";
      rate = 1.0;
    }

    if (path) {
      audioPlayer = new Audio(path);
      audioPlayer.playbackRate = rate;
      audioPlayer.volume = 0.2;
      audioPlayer.play().catch((e) => console.error("Audio play failed:", e));
    }
  };

  const stopEmoteAudio = () => {
    if (audioPlayer) {
      audioPlayer.pause();
      audioPlayer.currentTime = 0;
      audioPlayer = null;
    }
  };

  const emotes = [
    { id: "boogiedown", name: "Boogie Down", img: "/fortnite/boogiedown.png" },
    {
      id: "superhero",
      name: "Acrobatic Superhero",
      img: "/fortnite/superhero.png",
    },
    { id: "afrohouse", name: "AfroHouse", img: "/fortnite/afrohouse.png" },
  ];

  const handleEmoteKeydown = (e) => {
    if (e.key.toLowerCase() === "b") {
      showEmoteWheel = !showEmoteWheel;
    }
  };

  // Pointer and Mobile interaction logic
  let orbitRotation = { x: 0.2, y: 0 }; // Start with a high camera looking down
  let parallaxRotation = { x: 0, y: 0 };
  let currentGroupRotation = { x: 0, y: 0 };
  let isDraggingModel = false;
  let previousPointerPos = { x: 0, y: 0 };

  function handlePointerDown(e) {
    if (showEmoteWheel) return;
    isDraggingModel = true;
    previousPointerPos = { x: e.clientX, y: e.clientY };
  }

  function handlePointerMove(e) {
    if (isDraggingModel) {
      const deltaX = e.clientX - previousPointerPos.x;
      const deltaY = e.clientY - previousPointerPos.y;
      orbitRotation.y += deltaX * 0.005; // Slightly more movement
      orbitRotation.x += deltaY * 0.005; // Slightly more movement
      orbitRotation.x = Math.max(0, Math.min(Math.PI / 4, orbitRotation.x));
      previousPointerPos = { x: e.clientX, y: e.clientY };
    }
    if (e.pointerType === "mouse") {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = -(e.clientY / window.innerHeight) * 2 + 1;
      parallaxRotation.y = nx * 0.25; // Slightly more parallax
      parallaxRotation.x = ny * 0.25; // Slightly more parallax
    }
  }

  function handlePointerUp() {
    isDraggingModel = false;
  }

  function handleDeviceOrientation(e) {
    if (e.beta === null || e.gamma === null) return;
    const tiltX = (e.beta - 45) * (Math.PI / 180);
    const tiltY = e.gamma * (Math.PI / 180);
    parallaxRotation.x = Math.max(-0.4, Math.min(0.4, tiltX));
    parallaxRotation.y = Math.max(-0.4, Math.min(0.4, tiltY));
  }

  const handleModelClick = async () => {
    showEmoteWheel = !showEmoteWheel;
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      try {
        const permissionState =
          await DeviceOrientationEvent.requestPermission();
        if (permissionState === "granted") {
          window.addEventListener(
            "deviceorientation",
            handleDeviceOrientation,
            false,
          );
        }
      } catch (error) {
        console.warn("Device orientation permission error", error);
      }
    }
  };

  const carouselSlides = [
    {
      type: "video",
      videoId: "8zC8HRyfRHw",
      alt: "Bradesco e Fortnite",
      label: "Braland: Veja a experiência Bradesco no Fortnite!",
    },
    {
      type: "image",
      src: "/images/fortnite_banner1.jpg",
      alt: "Marketing Dentro do Jogo",
      label: "Marketing in-game com Fortnite",
      link: "#",
    },
    {
      type: "image",
      src: "/images/hellmans.webp",
      alt: "Hellmans Fortnite",
      label: "Loot Irresistível: Hellman's e Fortnite",
      link: "https://www.terra.com.br/gameon/plataformas-e-consoles/exclusivo-hellmanns-inaugura-mapa-no-fortnite-com-premios-para-os-jogadores,209f8638890a273a0535de30c301dabby0awzkij.html",
    },
  ];

  let isDestroyed = false;

  // lifecycle management
  onMount(() => {
    globalLoading.set(true);

    // Prevent body scrolling
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.overflowX = "hidden";
    document.body.style.overscrollBehavior = "none";

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission !== "function"
    ) {
      window.addEventListener(
        "deviceorientation",
        handleDeviceOrientation,
        false,
      );
    }

    // --- DOM Animations ---
    // Animate title
    gsap.from(".game-title", {
      duration: 1,
      y: -50,
      opacity: 0,
      ease: "power3.out",
    });

    // Animate video container
    gsap.from(".video-container", {
      duration: 1.2,
      x: -100,
      opacity: 0,
      ease: "power3.out",
      delay: 0.3,
    });

    // Animate character image
    gsap.from(".character-image", {
      duration: 1,
      x: -100,
      opacity: 0,
      ease: "power3.out",
      delay: 0.5,
    });

    // Animate dance GIF
    gsap.from(".dance-gif", {
      duration: 1,
      x: 100,
      opacity: 0,
      ease: "power3.out",
      delay: 0.7,
    });

    // Animate description
    gsap.from(".game-description", {
      duration: 1,
      y: 30,
      opacity: 0,
      ease: "power3.out",
      delay: 0.6,
    });

    // Animate features with fromTo to prevent flickering
    gsap.fromTo(
      ".feature-item",
      {
        x: 50,
        opacity: 0,
      },
      {
        duration: 0.8,
        x: 0,
        opacity: 1,
        ease: "power3.out",
        stagger: 0.2,
        delay: 0.9,
      },
    );

    // Floating animation for images
    gsap.to(".floating-image", {
      duration: 3,
      y: "+=10",
      ease: "power2.inOut",
      yoyo: true,
      repeat: -1,
    });

    // Floating animation for character
    gsap.to(".character-image", {
      duration: 3,
      y: "+=10",
      ease: "power2.inOut",
      yoyo: true,
      repeat: -1,
    });

    // Floating animation for dance GIF
    gsap.to(".dance-gif", {
      duration: 4,
      y: "+=15",
      ease: "power2.inOut",
      yoyo: true,
      repeat: -1,
      delay: 0.5,
    });

    // Subtle rotation animation for dance GIF
    gsap.to(".dance-gif img", {
      duration: 6,
      rotation: 5,
      ease: "power2.inOut",
      yoyo: true,
      repeat: -1,
    });

    // --- THREE.JS SETUP ---
    const setupThreeJS = async () => {
      scene = new THREE.Scene();

    // Orthographic or Perspective. Since it's a character, Perspective is usually better unless matching the Roblox ortho aesthetic.
    // Given the fixed overlay nature, let's use Perspective.
      const result = await createRenderer({
        canvas: danceCanvas,
        alpha: true,
        antialias: true,
      });
      renderer = result.renderer;
      const currentRenderer = result.currentRenderer;

      // Set fixed initial size, will resize later
      renderer.setSize(400, 400);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      // Register renderer for global debug overlay
      registerRenderer(renderer, currentRenderer);

      const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
      scene.add(ambientLight);
      const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
      dirLight.position.set(2, 5, 5);
      scene.add(dirLight);

      clock = new THREE.Clock();

      modelGroup = new THREE.Group();
      scene.add(modelGroup);

      camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      camera.position.set(0, 1.2, 5);

      const loader = new GLTFLoader();
      loader.load("/fortnite/banana_dancing_fortnite.glb", (gltf) => {
        character = gltf.scene;

        // Center and scale the model depending on its native size. We will adjust scale later if needed.
        character.scale.set(1.15, 1.15, 1.15); // Shrunk slightly from 1.5
        character.position.y = -0.7; // Move up so it is not cut off
        modelGroup.add(character);

        mixer = new THREE.AnimationMixer(character);
        mixer.timeScale = 1.2;
        animationsList = gltf.animations;

        animationsList.forEach((clip) => {
          const name = clip.name.toLowerCase();
          let key = name;
          // Map common names to standard keys if possible, else just use the name
          if (name.includes("boogie")) key = "boogiedown";
          else if (name.includes("superhero")) key = "superhero";
          else if (name.includes("afro")) key = "afrohouse";

          actions[key] = mixer.clipAction(clip);
        });

        // Start the cycle
        startStaticPhase();

        // Once model is loaded, we can hide the global loader
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!isDestroyed) {
              globalLoading.set(false);
            }
          });
        });
      });
    };
    setupThreeJS();

    const animate = async () => {
      reqId = requestAnimationFrame(animate);
      if (!clock) return;
      const delta = clock.getDelta();
      if (mixer) mixer.update(delta);

      if (modelGroup) {
        let targetRotX = orbitRotation.x + parallaxRotation.x;
        // Clamp to ensure high camera angle and prevent looking from below
        targetRotX = Math.max(0.1, Math.min(Math.PI / 4, targetRotX));
        const targetRotY = orbitRotation.y + parallaxRotation.y;

        currentGroupRotation.x += (targetRotX - currentGroupRotation.x) * 0.1;
        currentGroupRotation.y += (targetRotY - currentGroupRotation.y) * 0.1;

        modelGroup.rotation.x = currentGroupRotation.x;
        modelGroup.rotation.y = currentGroupRotation.y;
      }

      if (renderer && scene && camera) {
        if (renderer.info) renderer.info.reset();
        
        renderer.render(scene, camera); // init() já foi aguardado: render síncrono (sem await por frame)
      }
    };
    animate();

    const handleResize = () => {
      if (!danceCanvas || !camera || !renderer) return;
      const rect = danceCanvas.parentElement.getBoundingClientRect();
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      renderer.setSize(rect.width, rect.height);
    };
    window.addEventListener("resize", handleResize);
    // Trigger initial resize after a small delay to ensure DOM is ready
    setTimeout(handleResize, 100);

    return () => {
      isDestroyed = true;
      cancelAnimationFrame(reqId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      if (typeof DeviceOrientationEvent !== "undefined") {
        window.removeEventListener(
          "deviceorientation",
          handleDeviceOrientation,
          false,
        );
      }
      if (renderer) {
        renderer.dispose();
      }
      unregisterRenderer();
      stopEmoteAudio();
      if (cycleTimeout) clearTimeout(cycleTimeout);
      // Revert body scrolling
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      document.body.style.overflowX = "";
      document.body.style.overscrollBehavior = "";
    };
  });

  const playAnimation = (key, loopOnce = false) => {
    if (activeAction) activeAction.fadeOut(0.3);
    const nextAction = actions[key];
    if (nextAction) {
      if (loopOnce) {
        nextAction.setLoop(THREE.LoopOnce, 1);
        nextAction.clampWhenFinished = true;
      } else {
        nextAction.setLoop(THREE.LoopRepeat, Infinity);
        nextAction.clampWhenFinished = false;
      }
      nextAction.reset().fadeIn(0.3).play();
      activeAction = nextAction;
      return nextAction;
    }
    return null;
  };

  const startStaticPhase = () => {
    cycleState = "IDLE";
    if (mixer) mixer.stopAllAction(); // Stop all animations to stay static
    activeAction = null;
    stopEmoteAudio();

    if (cycleTimeout) clearTimeout(cycleTimeout);
    cycleTimeout = setTimeout(() => {
      startCyclingPhase();
    }, 10000); // 10 seconds of idle
  };

  const startCyclingPhase = () => {
    if (animationsList.length === 0) return;
    cycleState = "CYCLING";
    currentAnimIndex = 0;
    playNextAnimInSequence();
  };

  const playNextAnimInSequence = () => {
    if (currentAnimIndex >= animationsList.length) {
      // Finished all animations, go back to static
      startStaticPhase();
      return;
    }

    const clip = animationsList[currentAnimIndex];
    const actionKey =
      Object.keys(actions).find((k) => actions[k].getClip() === clip) ||
      clip.name.toLowerCase();

    const action = playAnimation(actionKey, true);
    if (action) {
      playEmoteAudio(actionKey);
      // Wait for this animation to finish (using the clip's duration)
      const duration = (clip.duration / 1.2) * 1000;
      if (cycleTimeout) clearTimeout(cycleTimeout);
      cycleTimeout = setTimeout(() => {
        // Stop animation to stay static
        if (mixer) mixer.stopAllAction();
        activeAction = null;
        stopEmoteAudio();

        // Wait 10 seconds before playing the next animation
        cycleTimeout = setTimeout(() => {
          currentAnimIndex++;
          playNextAnimInSequence();
        }, 10000);
      }, duration);
    } else {
      currentAnimIndex++;
      playNextAnimInSequence();
    }
  };

  const selectEmote = (emoteId) => {
    showEmoteWheel = false;
    if (cycleTimeout) clearTimeout(cycleTimeout);

    if (emoteId === "static" || !actions[emoteId]) {
      startStaticPhase();
    } else {
      cycleState = "MANUAL";
      const action = playAnimation(emoteId, true);
      if (action) {
        playEmoteAudio(emoteId);
        // Return to static phase when the single loop finishes
        const duration = (action.getClip().duration / 1.2) * 1000;
        cycleTimeout = setTimeout(() => {
          startStaticPhase();
        }, duration);
      }
    }
  };
</script>

<svelte:window on:keydown={handleEmoteKeydown} />

<main
  class="fixed inset-0 bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white overflow-hidden pt-16 lg:pt-24 flex flex-col"
>
  <div
    class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden w-full p-4 md:p-6 lg:p-8 relative z-0 flex flex-col"
  >
    <div
      class="w-full max-w-7xl relative m-auto px-4 lg:px-6 flex flex-col lg:grid lg:grid-cols-12 lg:gap-x-8 lg:gap-y-6 xl:gap-y-10 lg:content-center lg:items-center lg:justify-center py-6 gap-6"
    >
      <!-- INTERLEAVED GRID: Video(L1) Text(R1) Grid(L2) 3D(R2) -->
      <!-- LEFT COLUMN -->
      <div class="left-column contents">
        <div
          class="video-container shrink-0 w-full relative lg:mb-0 order-1 lg:order-none lg:col-span-7 lg:col-start-1 lg:row-start-1 z-10 w-full"
        >
          <div class="relative">
            <div
              class="absolute -inset-2 md:-inset-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-2xl blur-lg opacity-30"
            ></div>
            <div
              class="relative bg-black rounded-2xl overflow-hidden shadow-2xl w-full aspect-video max-h-[20vh] lg:max-h-[30vh]"
            >
              <Carousel slides={carouselSlides} />
            </div>
          </div>
        </div>
        <div
          class="shrink min-h-0 w-full lg:w-full bg-transparent relative mt-8 mb-auto sm:mb-auto lg:mb-0 lg:mt-0 order-4 lg:order-none lg:col-span-7 lg:col-start-1 lg:row-start-2 z-10"
        >
          <FeatureGrid
            {features}
            hoverBgClass="hover:bg-[#1e1b4b] focus:bg-[#1e1b4b]"
            gapClass="gap-3 md:gap-4 lg:gap-6"
          />
        </div>
      </div>

      <div
        class="character-image absolute left-0 -translate-x-12 top-auto bottom-[20%] w-48 lg:bottom-0 lg:w-auto lg:-translate-x-48 lg:top-0 h-auto pointer-events-none z-0"
      >
        <img
          src="/images/fortnite-skin1.png"
          alt="Fortnite Character"
          class="h-full w-full object-contain"
        />
      </div>
      <!-- RIGHT COLUMN: Text, 3D Model -->
      <div class="right-column contents">
        <div
          class="flex flex-col w-[85%] sm:w-[85%] md:w-[85%] lg:w-full shrink-0 items-start text-left lg:items-start ml-4 lg:ml-0 order-2 lg:order-none lg:col-span-5 lg:col-start-8 lg:row-start-1 z-20"
        >
          <!-- Game Title -->
          <div class="game-title shrink-0 mb-2 lg:mb-4">
            <img
              src="/images/fortnite-logo.png"
              alt="Fortnite Logo"
              class="h-7 sm:h-10 md:h-14 lg:h-20 xl:h-24 mb-1 mx-0 object-contain"
            />
            <div
              class="w-12 md:w-16 lg:w-24 h-0.5 md:h-0.5 lg:h-1 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full mx-0"
            ></div>
          </div>

          <!-- Game Description -->
          <div class="game-description shrink-0 pr-2 lg:pr-0">
            <h3
              class="text-[11px] xxs:text-xs sm:text-sm md:text-lg lg:text-xl font-semibold text-white mb-2 lg:mb-4 leading-tight"
            >
              Nós transformamos seus objetivos de marketing em experiências
              imersivas dentro do Fortnite.
            </h3>
            <button
              class="px-3 py-1 md:px-6 md:py-2 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full font-bold text-[10px] md:text-base hover:scale-105 transition-transform shadow-lg hover:shadow-purple-500/50 mb-1 self-start"
              on:click={() =>
                contactModalState.update((s) => ({
                  ...s,
                  isOpen: true,
                  title: "Fortnite",
                }))}
            >
              FAZER ORÇAMENTO
            </button>
            <p
              class="text-[9px] sm:text-xs md:text-sm lg:text-base text-white max-w-lg mx-0 hidden sm:block leading-tight"
            >
              Através de mundos e jogos personalizados, criamos uma conexão
              duradoura com milhões de jogadores, convertendo engajamento em
              resultados concretos para sua marca.
            </p>
          </div>
        </div>
        <!-- 3D Model positioned securely in row 2 of grid -->
        <div
          class="dance-gif absolute top-[35%] md:top-[30%] lg:relative lg:top-auto lg:bottom-auto -translate-y-1/2 lg:-translate-y-0 -right-16 sm:-right-8 md:right-0 lg:right-auto z-30 flex flex-col justify-end lg:justify-start items-center pointer-events-none pb-4 lg:pb-0 order-3 lg:order-none lg:col-span-5 lg:col-start-8 lg:row-start-2 lg:-mt-20 xl:-mt-24 2xl:-mt-32"
        >
          <div
            class="relative w-[270px] h-[315px] md:w-[315px] md:h-[405px] lg:w-[400px] lg:h-[400px] xl:w-[450px] xl:h-[450px] max-w-full pointer-events-auto shrink flex-1 lg:max-h-[50vh]"
          >
            <div
              class="relative w-full h-full flex items-center justify-center cursor-pointer"
              on:click={handleModelClick}
              on:keydown={(e) => {
                if (e.key === "Enter" || e.key === " ") handleModelClick();
              }}
              role="button"
              tabindex="0"
            >
              <canvas
                bind:this={danceCanvas}
                class="w-full h-full object-contain drop-shadow-2xl"
              ></canvas>

              <div
                class="absolute bottom-[-15px] left-[40%] sm:left-[45%] lg:left-1/2 -translate-x-1/2 text-[10px] md:text-xs text-white/90 whitespace-nowrap bg-white/10 px-3 py-1.5 rounded-full border border-white/30 backdrop-blur-md shadow-lg font-medium tracking-wide z-10"
              >
                <span
                  class="bg-white/20 px-1.5 py-0.5 rounded font-bold text-white text-[9px] md:text-xs mx-0.5 border border-white/30"
                  >B</span
                > ou Clique
              </div>
            </div>
          </div>

          {#if showEmoteWheel}
            <div
              class="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
            >
              <!-- Wheel Container -->
              <div
                class="relative w-[300px] h-[300px] md:w-[400px] md:h-[400px] rounded-full pointer-events-auto"
              >
                <!-- Emote Title -->
                <div
                  class="absolute -top-12 left-1/2 -translate-x-1/2 text-white font-black italic tracking-wider text-2xl drop-shadow-lg uppercase text-center w-full z-10"
                >
                  Emotes
                </div>

                <!-- SVG Pizza Slices Background -->
                <svg
                  viewBox="0 0 100 100"
                  class="absolute inset-0 w-full h-full drop-shadow-2xl"
                >
                  <!-- Defs inside for drop shadows or gradients if needed -->
                  <!-- We draw 6 slices. Angle = 60deg (Math.PI/3) each -->
                  <circle cx="50" cy="50" r="48" fill="rgba(0,0,0,0.6)" />
                  <circle
                    cx="50"
                    cy="50"
                    r="20"
                    fill="transparent"
                    class="backdrop-blur-md"
                  />

                  <!-- Inner hole cutout line -->
                  <circle
                    cx="50"
                    cy="50"
                    r="28"
                    fill="transparent"
                    stroke="rgba(255,255,255,0.1)"
                    stroke-width="1"
                  />
                  <!-- Outer ring line -->
                  <circle
                    cx="50"
                    cy="50"
                    r="48"
                    fill="transparent"
                    stroke="rgba(255,255,255,0.2)"
                    stroke-width="0.5"
                  />
                </svg>

                <!-- Emote slots wrapper -->
                <div class="absolute inset-0 w-full h-full">
                  {#each [{ rotation: -90, id: emotes[0] ? emotes[0].id : "static", img: emotes[0] ? emotes[0].img : null }, { rotation: -30, id: emotes[1] ? emotes[1].id : "static", img: emotes[1] ? emotes[1].img : null }, { rotation: 30, id: emotes[2] ? emotes[2].id : "static", img: emotes[2] ? emotes[2].img : null }, { rotation: 90, id: "static", img: null }, { rotation: 150, id: "static", img: null }, { rotation: 210, id: "static", img: null }] as slot}
                    <div
                      class="absolute top-1/2 left-1/2 w-[100px] h-[100px] md:w-[120px] md:h-[120px] -ml-[50px] md:-ml-[60px] -mt-[50px] md:-mt-[60px] flex items-center justify-center p-3 outline-none"
                      style="transform: rotate({slot.rotation +
                        30}deg) translate(0, -110px) rotate({-(
                        slot.rotation + 30
                      )}deg)"
                    >
                      <!-- Hitbox pizza slice roughly mapped to a circle for hover -->
                      <button
                        class="w-full h-full flex flex-col items-center justify-center gap-1 transition-all duration-200 group relative z-20 outline-none"
                        on:click={(e) => {
                          e.stopPropagation();
                          selectEmote(slot.id);
                        }}
                      >
                        {#if slot.img}
                          <img
                            src={slot.img}
                            alt={slot.id}
                            class="w-3/4 h-3/4 object-contain filter drop-shadow-md group-hover:scale-110 group-hover:drop-shadow-[0_0_12px_rgba(255,255,255,0.8)] transition-all duration-200"
                          />
                          <span
                            class="text-[8px] md:text-[10px] font-bold text-white uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity absolute -bottom-4 bg-black/80 px-2 py-0.5 rounded shadow whitespace-nowrap"
                          >
                            {emotes.find((e) => e.id === slot.id)?.name ||
                              "Emote"}
                          </span>
                        {:else}
                          <div
                            class="text-white/30 text-[10px] md:text-xs font-black uppercase text-center leading-tight tracking-widest group-hover:text-white/60 transition-colors"
                          >
                            Vazio
                          </div>
                        {/if}
                      </button>
                    </div>
                  {/each}
                </div>
              </div>
            </div>
          {/if}
        </div>
        <!-- Floating Images -->
        <div class="relative hidden sm:block">
          <div
            class="floating-image absolute -top-8 -right-8 w-16 h-16 bg-gradient-to-br from-blue-400 to-purple-600 opacity-60"
          ></div>
          <div
            class="floating-image absolute -bottom-4 -left-4 w-12 h-12 bg-gradient-to-br from-purple-400 to-pink-600 opacity-40"
          ></div>
        </div>
      </div>
    </div>
  </div>
</main>

<style>
  /* Custom scrollbar for webkit browsers */
  ::-webkit-scrollbar {
    width: 8px;
  }

  ::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.1);
  }

  ::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.3);
    border-radius: 4px;
  }

  ::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.5);
  }
</style>
