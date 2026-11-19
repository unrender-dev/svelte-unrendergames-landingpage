<script>
  import { onMount, onDestroy } from "svelte";
  import { fade } from "svelte/transition";
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
      title: "Locais, Ambientes e Eventos",
      shortDesc: "Traga o mundo real para o metaverso.",
      longDesc:
        "Criamos as melhores réplicas de locais reais e organizamos eventos virtuais imersivos.",
      images: ["/images/roblox_banner1.jpg", "/images/roblox_banner2.jpg"],
    },
    {
      icon: "fas fa-gamepad",
      title: "Jogos",
      shortDesc: "Obbys, Tycoons e RPGs viciantes.",
      longDesc:
        "Desenvolvemos jogos engajadores desenhados para máxima retenção e monetização no Roblox.",
      images: ["/images/roblox_banner2.jpg"],
    },
    {
      icon: "fas fa-chart-bar",
      title: "Métricas",
      shortDesc: "Dados precisos de visitas e retenção.",
      longDesc:
        "Painéis analytics e insights sobre comportamento dos jogadores para maximizar o ROI na plataforma.",
      images: ["/images/roblox_banner1.jpg"],
    },
    {
      icon: "fas fa-users",
      title: "Comunidade",
      shortDesc: "Construa uma comunidade leal com UGC.",
      longDesc:
        "Crie e distribua itens UGC exclusivos da sua marca, aumentando o reconhecimento visual.",
      images: ["/images/bis_roblox.jpg", "/images/roblox_banner1.jpg"],
    },
  ];

  let canvas;
  let carouselEl;
  let gridEl;
  let budgetBtnEl;
  let joystickZoneEl;
  let joystickKnobEl;

  let showTooltips = true;
  let tooltipsTimeout = null;
  let renderer;
  let animationId;
  let handleResize;
  let handleMouseMove;
  let handleMouseClick;
  let handleKeyDown = () => {};
  let handleKeyUp = () => {};

  const hideTooltips = () => {
    if (!showTooltips || tooltipsTimeout !== null) return;
    tooltipsTimeout = setTimeout(() => {
      showTooltips = false;
    }, 2000); // 2 seconds fade out
  };

  let doMobileJump = () => {};
  let isDead = false;
  let showRespawnSpinner = false;
  let joystickActive = false;
  let joystickVector = { x: 0, y: 0 };

  const handleTouchStart = (e) => {
    hideTooltips();
    const touch = e.changedTouches[0];
    const rect = joystickZoneEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    updateJoystick(
      touch.clientX,
      touch.clientY,
      centerX,
      centerY,
      rect.width / 2,
    );
    joystickActive = true;
  };

  const handleTouchMove = (e) => {
    if (!joystickActive) return;
    const touch = e.changedTouches[0];
    const rect = joystickZoneEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    updateJoystick(
      touch.clientX,
      touch.clientY,
      centerX,
      centerY,
      rect.width / 2,
    );
  };

  const handleTouchEnd = () => {
    joystickActive = false;
    joystickVector = { x: 0, y: 0 };
    if (joystickKnobEl) {
      joystickKnobEl.style.transform = `translate(-50%, -50%)`;
    }
  };

  const updateJoystick = (tx, ty, cx, cy, radius) => {
    let dx = tx - cx;
    let dy = ty - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > radius) {
      dx = (dx / dist) * radius;
      dy = (dy / dist) * radius;
    }

    joystickVector = {
      x: dx / radius,
      y: dy / radius,
    };

    if (joystickKnobEl) {
      joystickKnobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    }
  };

  const mobileJump = (e) => {
    hideTooltips();
    e.preventDefault();
    doMobileJump();
  };

  const carouselSlides = [
    {
      type: "video",
      videoId: "6oxS0OHzmig",
      alt: "BIS & Roblox",
      label: "Assista a experiência BIS no Roblox!",
    },
    {
      type: "image",
      src: "/images/roblox_banner1.jpg",
      alt: "Roblox Banner",
      label: "Eventos Especiais",
      link: "#",
    },
    {
      type: "image",
      src: "/images/roblox_banner2.jpg",
      alt: "Games",
      label: "Jogos e Experiências!",
      link: "#",
    },
    {
      type: "image",
      src: "/images/bis_roblox.jpg",
      alt: "Games",
      label: "MorumBIS: Evento no Roblox da BIS",
      link: "https://forbes.com.br/forbes-mkt/2025/08/bis-lanca-experiencia-imersiva-no-roblox-com-ambientacao-no-estadio-morumbis/",
    },
  ];

  let isDestroyed = false;

  // lifecycle management
  onMount(() => {
    const setup = async () => {
      globalLoading.set(true);

      // Prevent body scrolling
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      document.body.style.overflowX = "hidden";
      document.body.style.overscrollBehavior = "none";

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
      const scene = new THREE.Scene();

      const aspect = window.innerWidth / window.innerHeight;
      const d = 40;
      const camera = new THREE.OrthographicCamera(
        -d * aspect,
        d * aspect,
        d,
        -d,
        1,
        1000,
      );
      camera.position.set(20, 20, 20);
      camera.lookAt(scene.position);

      const result = await createRenderer({
        canvas,
        alpha: true,
        antialias: true,
      });
      renderer = result.renderer;
      const currentRenderer = result.currentRenderer;
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      // Register renderer for global debug overlay
      registerRenderer(renderer, currentRenderer);

      const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
      scene.add(ambientLight);
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
      dirLight.position.set(10, 20, 10);
      dirLight.castShadow = true;
      scene.add(dirLight);

      let mixer;
      let actions = {};
      let currentAction;
      let character;

      const loader = new GLTFLoader();
      loader.load("/roblox/r6_roblox_noob_animated.glb", (gltf) => {
        character = gltf.scene;
        character.scale.set(3, 3, 3);
        scene.add(character);

        mixer = new THREE.AnimationMixer(character);
        gltf.animations.forEach((clip) => {
          const name = clip.name;
          let key = null;
          if (
            name === "R6Armature|RunAnim" ||
            name.toLowerCase().includes("run") ||
            name.toLowerCase().includes("walk")
          )
            key = "walk";
          else if (
            name === "R6Armature|Jump" ||
            name.toLowerCase().includes("jump")
          )
            key = "jump";
          else if (
            name === "R6Armature|Fall" ||
            name.toLowerCase().includes("fall")
          )
            key = "fall";
          else if (
            name === "R6Armature|Idle" ||
            name.toLowerCase().includes("idle")
          )
            key = "idle";

          if (key) {
            actions[key] = mixer.clipAction(clip);
          }
        });

        if (actions.idle) {
          actions.idle.play();
          currentAction = actions.idle;
        }

        // Once model is loaded, we can hide the global loader
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!isDestroyed) {
              globalLoading.set(false);
            }
          });
        });
      });

      const keys = { w: false, a: false, s: false, d: false, " ": false };
      const velocity = new THREE.Vector3();
      let isJumping = false;

      // Reusable objects for animation loop memory optimization
      const _moveDir = new THREE.Vector3();
      const _futurePos = new THREE.Vector3();
      const _groundPos = new THREE.Vector3();
      const _rayOrigin = new THREE.Vector3();
      const _rayDir = new THREE.Vector3();
      const _targetPos = new THREE.Vector3();
      const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const _ray = new THREE.Ray();

      handleKeyDown = (e) => {
        if (keys.hasOwnProperty(e.key.toLowerCase())) {
          keys[e.key.toLowerCase()] = true;
          hideTooltips();
        }
        if (e.key === " ") {
          e.preventDefault();
          hideTooltips();
        }
      };
      handleKeyUp = (e) => {
        if (keys.hasOwnProperty(e.key.toLowerCase()))
          keys[e.key.toLowerCase()] = false;
      };

      doMobileJump = () => {
        if (isDead) return;
        if (character && character.position.y === 0) {
          velocity.y = 25;
          isJumping = true;
          if (actions.jump) {
            if (currentAction) currentAction.fadeOut(0.1);
            actions.jump.reset().fadeIn(0.1).play();
            currentAction = actions.jump;
          }
        }
      };

      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();
      let hoveredCharacter = false;

      const checkIntersection = (clientX, clientY) => {
        if (!character || isDead) return false;
        mouse.x = (clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObject(character, true);
        return intersects.length > 0;
      };

      handleMouseMove = (e) => {
        if (checkIntersection(e.clientX, e.clientY)) {
          if (!hoveredCharacter) {
            hoveredCharacter = true;
            document.body.style.cursor = "pointer";
          }
        } else {
          if (hoveredCharacter) {
            hoveredCharacter = false;
            document.body.style.cursor = "auto";
          }
        }
      };

      handleMouseClick = (e) => {
        // Prioritize touch coordinates if available
        let x = e.clientX;
        let y = e.clientY;
        if (e.changedTouches && e.changedTouches.length > 0) {
          x = e.changedTouches[0].clientX;
          y = e.changedTouches[0].clientY;
        }
        if (checkIntersection(x, y)) {
          die();
        }
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("click", handleMouseClick);
      window.addEventListener("touchstart", handleMouseClick);

      const die = () => {
        if (isDead) return;
        isDead = true;
        document.body.style.cursor = "auto"; // Reset cursor
        hoveredCharacter = false;

        // Play audio
        const audio = new Audio("/roblox/robloxoof.mp3");
        audio.volume = 0.2;
        audio.play();

        // Death physics response
        velocity.y = 25; // Pop up slightly
        isJumping = true;

        // Rotate backwards to look "dead"
        gsap.to(character.rotation, {
          x: -Math.PI / 2,
          duration: 0.3,
          ease: "power2.in",
        });

        // Respawn timer
        setTimeout(() => {
          showRespawnSpinner = true;

          setTimeout(() => {
            showRespawnSpinner = false;
            isDead = false;
            // Respawn: drop from the sky and reset rotation
            character.position.set(0, 40, 0);
            character.rotation.set(0, 0, 0);
            velocity.y = -10;
          }, 3000);
        }, 1500);
      };

      const clock = new THREE.Clock();

      const animate = async () => {
        animationId = requestAnimationFrame(animate);
        const delta = Math.min(clock.getDelta(), 0.1);

        if (mixer) mixer.update(delta);

        if (character) {
          _moveDir.set(0, 0, 0);
          if (!isDead) {
            if (keys.w) {
              _moveDir.x -= 1;
              _moveDir.z -= 1;
            }
            if (keys.s) {
              _moveDir.x += 1;
              _moveDir.z += 1;
            }
            if (keys.a) {
              _moveDir.x -= 1;
              _moveDir.z += 1;
            }
            if (keys.d) {
              _moveDir.x += 1;
              _moveDir.z -= 1;
            }

            if (joystickActive) {
              _moveDir.x += joystickVector.y + joystickVector.x;
              _moveDir.z += joystickVector.y - joystickVector.x;
            }

            if (_moveDir.length() > 0) {
              _moveDir.normalize();
              const speed = 30;
              _futurePos.copy(character.position).addScaledVector(_moveDir, speed * delta);

              let bottomLimit = -0.95;
              if (budgetBtnEl) {
                const rect = budgetBtnEl.getBoundingClientRect();
                bottomLimit = -(rect.bottom / window.innerHeight) * 2 + 1;
              }

              _groundPos.copy(_futurePos);
              _groundPos.y = 0;
              const p = _groundPos.project(camera);

              let isClamped = false;
              if (p.x < -0.95) {
                p.x = -0.95;
                isClamped = true;
              }
              if (p.x > 0.95) {
                p.x = 0.95;
                isClamped = true;
              }
              if (p.y > 0.85) {
                p.y = 0.85;
                isClamped = true;
              }
              if (p.y < bottomLimit) {
                p.y = bottomLimit;
                isClamped = true;
              }

              if (isClamped) {
                p.z = -1;
                _rayOrigin.copy(p).unproject(camera);
                p.z = 1;
                _rayDir.copy(p)
                  .unproject(camera)
                  .sub(_rayOrigin)
                  .normalize();
                
                const resultTarget = _ray.set(_rayOrigin, _rayDir).intersectPlane(_plane, _targetPos);

                if (resultTarget) {
                  character.position.x = _targetPos.x;
                  character.position.z = _targetPos.z;
                }
              } else {
                character.position.x = _futurePos.x;
                character.position.z = _futurePos.z;
              }

              const targetAngle = Math.atan2(_moveDir.x, _moveDir.z);
              let diff = targetAngle - character.rotation.y;
              while (diff < -Math.PI) diff += Math.PI * 2;
              while (diff > Math.PI) diff -= Math.PI * 2;
              character.rotation.y += diff * 15 * delta;

              if (!isJumping && currentAction !== actions.walk && actions.walk) {
                if (currentAction) currentAction.fadeOut(0.2);
                actions.walk.reset().fadeIn(0.2).play();
                currentAction = actions.walk;
              }
            } else {
              if (!isJumping && currentAction !== actions.idle && actions.idle) {
                if (currentAction) currentAction.fadeOut(0.2);
                actions.idle.reset().fadeIn(0.2).play();
                currentAction = actions.idle;
              }
            }

            if (keys[" "] && character.position.y === 0) {
              doMobileJump();
            }
          }

          velocity.y -= 70 * delta;
          character.position.y += velocity.y * delta;

          if (character.position.y <= 0) {
            character.position.y = 0;
            velocity.y = 0;
            if (isJumping) {
              isJumping = false;
              if (!isDead) {
                const next = moveDir.length() > 0 ? actions.walk : actions.idle;
                if (next) {
                  if (currentAction) currentAction.fadeOut(0.2);
                  next.reset().fadeIn(0.2).play();
                  currentAction = next;
                }
              }
            }
          } else if (
            velocity.y < 0 &&
            isJumping &&
            !isDead &&
            currentAction !== actions.fall &&
            actions.fall
          ) {
            if (currentAction) currentAction.fadeOut(0.2);
            actions.fall.reset().fadeIn(0.2).play();
            currentAction = actions.fall;
          }
        }

        if (renderer && scene && camera) {
          if (renderer.info) renderer.info.reset();
          
          renderer.render(scene, camera); // init() já foi aguardado: render síncrono (sem await por frame)
        }
      };
      animate();

      handleResize = () => {
        const aspect = window.innerWidth / window.innerHeight;
        camera.left = -d * aspect;
        camera.right = d * aspect;
        camera.top = d;
        camera.bottom = -d;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      };
      window.addEventListener("resize", handleResize);
    };
    setup();

    return () => {
      isDestroyed = true;
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("click", handleMouseClick);
      window.removeEventListener("touchstart", handleMouseClick);

      if (renderer) {
        renderer.dispose();
      }
      unregisterRenderer();
    };
  });

  onDestroy(() => {
    // Revert changes
    if (typeof document !== "undefined") {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      document.body.style.overflowX = "";
      document.body.style.overscrollBehavior = "";
    }
  });
</script>

<svelte:window on:keydown={handleKeyDown} on:keyup={handleKeyUp} />

<main
  class="fixed inset-0 bg-gradient-to-br from-slate-900 via-orange-900 to-slate-900 text-white overflow-hidden pt-20 lg:pt-24 flex flex-col"
>
  <div
    class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden w-full p-3 md:p-4 lg:p-6 relative z-0 flex flex-col"
  >
    <div
      class="m-auto relative grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 lg:gap-8 xl:gap-12 items-center w-full max-w-7xl pb-24 lg:pb-0"
    >
      <!-- YouTube Video - First on mobile, left on desktop -->
      <div
        bind:this={carouselEl}
        class="video-container order-1 lg:order-1 lg:-translate-y-16"
        style="position:relative; z-index:10;"
      >
        <div class="relative">
          <div
            class="absolute -inset-2 md:-inset-4 bg-gradient-to-r from-orange-500 to-red-600 rounded-2xl blur-lg opacity-30"
          ></div>
          <div
            class="relative bg-black rounded-2xl overflow-hidden shadow-2xl w-full aspect-video max-h-[20vh] lg:max-h-[30vh]"
          >
            <Carousel slides={carouselSlides} />
          </div>
        </div>
      </div>

      <!-- Roblox Character -->
      <div
        class="character-image absolute left-0 -translate-x-24 top-0 bottom-0 w-48 lg:w-auto lg:-translate-x-48 lg:top-0"
      >
        <img
          src="/images/roblox_skin1.webp"
          alt="Roblox Character"
          class="h-full w-full object-contain"
        />
      </div>

      <!-- Roblox Dance GIF -->
      <div
        class="dance-gif absolute right-0 translate-x-0 top-20 bottom-0 w-48 lg:w-auto lg:translate-x-16 lg:top-0 lg:right-0 pointer-events-none"
      >
        <div
          class="relative h-full flex items-center justify-center scale-[0.2] lg:scale-[0.2] lg:origin-right origin-center"
        >
          <img
            src="/images/roblox-dance.webp"
            alt="Roblox Dance Animation"
            class="h-full w-full object-contain drop-shadow-2xl"
          />
        </div>
      </div>

      <!-- Game Content - Second on mobile, right on desktop -->
      <div
        bind:this={gridEl}
        class="order-2 lg:order-2 flex flex-col justify-between lg:justify-center h-full min-h-0 py-2 lg:py-0 text-center lg:text-left overflow-visible lg:translate-y-16"
        style="position:relative; z-index:30;"
      >
        <!-- Game Title -->
        <div class="game-title shrink-0 mb-1 lg:mb-4">
          <img
            src="/images/roblox_logo.png"
            alt="Roblox Logo"
            class="h-6 sm:h-10 md:h-14 lg:h-20 xl:h-24 mb-1 mx-auto lg:mx-0 object-contain"
          />
          <div
            class="w-12 md:w-16 lg:w-24 h-0.5 md:h-0.5 lg:h-1 bg-gradient-to-r from-orange-500 to-red-500 rounded-full mx-auto lg:mx-0"
          ></div>
        </div>

        <div class="game-description shrink-0 mb-2 lg:mb-4">
          <h3
            class="text-[10px] xxs:text-xs sm:text-sm md:text-lg lg:text-xl font-semibold text-white mb-1 lg:mb-4 leading-tight"
          >
            Ajudamos você a conhecer e se conectar com seu público-alvo no
            Roblox com experiências únicas!
          </h3>
          <button
            bind:this={budgetBtnEl}
            class="px-3 py-1 md:px-6 md:py-2 bg-gradient-to-r from-orange-600 to-red-600 rounded-full font-bold text-[10px] md:text-base hover:scale-105 transition-transform shadow-lg hover:shadow-orange-500/50 mb-1"
            on:click={() =>
              contactModalState.update((s) => ({
                ...s,
                isOpen: true,
                title: "Roblox",
              }))}
          >
            FAZER ORÇAMENTO
          </button>
        </div>

        <!-- Game Features -->
        <div class="shrink min-h-0 w-full bg-transparent z-10 relative">
          <FeatureGrid
            {features}
            hoverBgClass="hover:bg-[#0f172a] focus:bg-[#0f172a]"
            gapClass="gap-2 md:gap-3"
          />
        </div>

        <!-- Floating Images -->
        <div class="relative hidden sm:block">
          <div
            class="floating-image absolute -top-8 -right-8 w-16 h-16 bg-gradient-to-br from-orange-400 to-red-600 opacity-60"
          ></div>
          <div
            class="floating-image absolute -bottom-4 -left-4 w-12 h-12 bg-gradient-to-br from-red-400 to-orange-600 opacity-40"
          ></div>
        </div>
      </div>
    </div>
  </div>
  <canvas
    bind:this={canvas}
    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 9999;"
  ></canvas>

  <!-- Desktop Tooltips -->
  {#if showTooltips}
    <div
      transition:fade={{ duration: 500 }}
      class="fixed bottom-8 left-8 z-[10000] hidden md:flex flex-col gap-3 pointer-events-none"
    >
      <div
        class="bg-white/10 text-white px-4 py-2 rounded-xl backdrop-blur-md border border-white/30 shadow-lg flex items-center gap-3"
      >
        <div class="flex gap-1">
          <span
            class="bg-white/20 px-2 py-1 rounded text-xs font-bold border border-white/30"
            >W</span
          >
          <span
            class="bg-white/20 px-2 py-1 rounded text-xs font-bold border border-white/30"
            >A</span
          >
          <span
            class="bg-white/20 px-2 py-1 rounded text-xs font-bold border border-white/30"
            >S</span
          >
          <span
            class="bg-white/20 px-2 py-1 rounded text-xs font-bold border border-white/30"
            >D</span
          >
        </div>
        <span class="text-sm font-medium">Mover personagem</span>
      </div>

      <div
        class="bg-white/10 text-white px-4 py-2 rounded-xl backdrop-blur-md border border-white/30 shadow-lg flex items-center gap-3"
      >
        <div class="flex gap-1">
          <span
            class="bg-white/20 px-4 py-1 rounded text-xs font-bold border border-white/30"
            >Espaço</span
          >
        </div>
        <span class="text-sm font-medium">Pular</span>
      </div>
    </div>
  {/if}

  {#if showRespawnSpinner}
    <div
      transition:fade={{ duration: 300 }}
      class="fixed top-24 right-6 bg-black/60 border border-white/20 rounded-xl px-4 py-3 flex items-center gap-3 z-[11000] backdrop-blur-md shadow-lg"
    >
      <div
        class="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin"
      ></div>
      <span class="text-white text-sm font-bold tracking-wider"></span>
    </div>
  {/if}

  <div
    bind:this={joystickZoneEl}
    on:touchstart|preventDefault={handleTouchStart}
    on:touchmove|preventDefault={handleTouchMove}
    on:touchend|preventDefault={handleTouchEnd}
    on:touchcancel|preventDefault={handleTouchEnd}
    class="fixed bottom-6 left-6 w-24 h-24 bg-white/10 rounded-full border border-white/30 backdrop-blur-md flex items-center justify-center md:hidden z-[10000]"
  >
    <div
      bind:this={joystickKnobEl}
      class="absolute top-1/2 left-1/2 w-10 h-10 bg-white/80 rounded-full shadow-lg transform -translate-x-1/2 -translate-y-1/2"
      style="transition: transform 0.05s linear;"
    ></div>
  </div>

  <button
    on:touchstart|preventDefault={mobileJump}
    class="fixed bottom-8 right-20 sm:right-24 w-16 h-16 bg-white/10 rounded-full border border-white/30 backdrop-blur-md text-white font-bold flex items-center justify-center active:bg-white/30 md:hidden z-[10000] shadow-lg"
  >
    <svg
      xmlns="http://www.w3.org/.svg"
      class="w-8 h-8"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="3"
        d="M5 10l7-7m0 0l7 7m-7-7v18"
      />
    </svg>
  </button>
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
