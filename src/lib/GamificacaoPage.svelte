<script>
  import { onMount, onDestroy, tick } from "svelte";
  import { fade } from "svelte/transition";
  import { gsap } from "gsap";
  import * as THREE from "three";
  import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

  import Carousel from "./Carousel.svelte";
  import { contactModalState, productsModalState, globalLoading } from "./modalStore.js";
  import GamificacaoQuiz from "./GamificacaoQuiz.svelte";
  import ProdutosGamificacaoModal from "./ProdutosGamificacaoModal.svelte";
  import { registerRenderer, unregisterRenderer } from "./debugStore.js";
  import { createRenderer } from "./threeRenderer.js";

  const features = [
    {
      icon: "fas fa-bullhorn",
      title: "Ativações de Marca",
      shortDesc: "Games customizados para sua marca.",
      longDesc:
        "Transformamos a identidade da sua marca em experiências jogáveis únicas para feiras e convenções.",
      images: ["/images/activation-game.jpg"],
    },
    {
      icon: "fas fa-desktop",
      title: "Totens e Quiosques",
      shortDesc: "Interatividade no local do evento.",
      longDesc:
        "Soluções touch e gestuais que garantem engajamento imediato e diversão para todos os visitantes.",
      images: ["/images/totem-virtual-tryon.jpg"],
    },
    {
      icon: "fas fa-mobile-alt",
      title: "Realidade Aumentada",
      shortDesc: "O virtual no mundo real.",
      longDesc:
        "Filtros e ativações via mobile que trazem elementos digitais para o espaço físico do seu evento.",
      images: ["/images/event-camera-photos.jpg"],
    },
    {
      icon: "fas fa-trophy",
      title: "E-sports e Torneios",
      shortDesc: "Competições em tempo real.",
      longDesc:
        "Organização completa de torneios com placares globais e transmissão ao vivo para o seu público.",
      images: ["/images/gamificacao.mp4"],
    },
  ];

  let canvas;
  let carouselEl;
  let gridEl;
  let budgetBtnEl;

  let renderer;
  let animationId;
  let handleResize;

  const carouselSlides = [
    {
      type: "localVideo",
      src: "/images/gamificacao.mp4",
      alt: "Ativações Interativas",
      label: "Experiências Imersivas em Eventos",
    },
    {
      type: "image",
      src: "/images/event-camera-photos.jpg",
      alt: "Event Photos",
      label: "Capture Momentos Inesquecíveis",
    },
    {
      type: "image",
      src: "/images/totem-virtual-tryon.jpg",
      alt: "Virtual Try-on",
      label: "Tecnologia de Ponta no seu Estande",
    },
  ];

  let isDestroyed = false;
  let mobileActiveView = "kiosk"; // 'kiosk', '2dgame'
  let gameState = "name"; // 'name', 'playing', 'gameover'
  let playerName = "";
  let playerScore = 0;

  function addLetter(letter) {
    if (playerName.length < 5) {
      playerName += letter;
    }
  }

  function removeLetter() {
    if (playerName.length > 0) {
      playerName = playerName.slice(0, -1);
    }
  }
  let iaScore = 0;
  let messages = [];
  let gameInterval;
  let iaInterval;
  let spawnInterval;
  let timeLeft = 30;

  let gameAreaEl;

  let kioskWidth = 0;
  let kioskHeight = 0;
  // Use a fixed native size for the kiosk to compute scaling
  const KIOSK_NATIVE_W = 320;
  const KIOSK_NATIVE_H = 700;

  // Calculate optimal scale to fit container dynamically without any vertical or horizontal scroll
  $: kioskScale =
    kioskWidth && kioskHeight
      ? Math.min(
          1.15,
          Math.max(0.35, (kioskWidth - 16) / KIOSK_NATIVE_W),
          Math.max(0.35, (kioskHeight - 16) / KIOSK_NATIVE_H)
        )
      : 0.65;

  let leaderboard = [
    { name: "LUCAS", score: 2500 },
    { name: "PEDRO", score: 2200 },
    { name: "MARIA", score: 1900 },
    { name: "CARLA", score: 1700 },
    { name: "JORGE", score: 1500 },
    { name: "ANDRE", score: 1300 },
    { name: "BRUNO", score: 1100 },
    { name: "DIEGO", score: 900 },
    { name: "FABIO", score: 700 },
    { name: "JULIA", score: 500 },
  ];

  const ticketTypes = [
    {
      text: "Atendimento",
      icon: "fa-comments",
      bgColor: "linear-gradient(135deg, #4ade80, #16a34a)",
    },
    {
      text: "Dúvida",
      icon: "fa-question-circle",
      bgColor: "linear-gradient(135deg, #60a5fa, #2563eb)",
    },
    {
      text: "Agendamento",
      icon: "fa-calendar-alt",
      bgColor: "linear-gradient(135deg, #facc15, #ca8a04)",
    },
    {
      text: "Visita",
      icon: "fa-building",
      bgColor: "linear-gradient(135deg, #f87171, #dc2626)",
    },
    {
      text: "Nutrição",
      icon: "fa-magnet",
      bgColor: "linear-gradient(135deg, #f472b6, #db2777)",
    },
    {
      text: "Lançamento",
      icon: "fa-file-excel",
      bgColor: "linear-gradient(135deg, #c084fc, #9333ea)",
    },
  ];

  async function startGame() {
    gameState = "playing";
    playerScore = 0;
    iaScore = 0;
    messages = [];
    timeLeft = 30;

    await tick();

    gameInterval = setInterval(() => {
      timeLeft -= 1;
      if (timeLeft <= 0) endGame();
    }, 1000);

    spawnInterval = setInterval(() => spawnMessage(), 250);

    iaInterval = setInterval(() => {
      const validMsgs = messages.filter((m) => !m.fading);
      if (validMsgs.length > 0) {
        const toPop = validMsgs.length > 6 ? 2 : 1;
        
        for (let i = 0; i < toPop; i++) {
          const currentValid = messages.filter((m) => !m.fading);
          if (currentValid.length > 0) {
            const index = Math.floor(Math.random() * currentValid.length);
            const msg = currentValid[index];
            msg.popping = true;
            msg.fading = true;
            msg.poppedByIA = true;
            iaScore += 100;
            messages = messages;
            setTimeout(() => {
              messages = messages.filter((m) => m.id !== msg.id);
            }, 400);
          }
        }
      }
    }, 500);
  }

  function spawnMessage() {
    if (messages.length < 25) {
      const id = Math.random().toString(36).substr(2, 9);
      const type = ticketTypes[Math.floor(Math.random() * ticketTypes.length)];
      const x = Math.random() * 65 + 10;
      const y = Math.random() * 55 + 20;
      messages = [
        ...messages,
        {
          id,
          text: type.text,
          icon: type.icon,
          bgColor: type.bgColor,
          x,
          y,
          fading: false,
          popping: false,
          poppedByIA: false,
        },
      ];
    }
  }

  function clickMessage(id) {
    const msg = messages.find((m) => m.id === id);
    if (msg && !msg.fading) {
      msg.popping = true;
      msg.fading = true;
      playerScore += 100;
      messages = messages;
      setTimeout(() => {
        messages = messages.filter((m) => m.id !== id);
      }, 400);
    }
  }

  function endGame() {
    clearInterval(gameInterval);
    clearInterval(iaInterval);
    clearInterval(spawnInterval);
    gameState = "gameover";
    const newEntry = { name: playerName, score: playerScore };
    leaderboard = [...leaderboard, newEntry]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }

  function handleNameInput(e) {
    playerName = e.target.value.toUpperCase().substr(0, 5);
  }

  onMount(() => {
    let scene;
    const setup = async () => {
      globalLoading.set(true);

      // Prevent body scrolling
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";

      // Alternate initial view on mobile
      if (typeof window !== "undefined" && window.localStorage) {
        const lastView = localStorage.getItem("lastMobileView");
        if (lastView === "kiosk") {
          mobileActiveView = "2dgame";
        } else if (lastView === "2dgame") {
          mobileActiveView = "kiosk";
        }
        localStorage.setItem("lastMobileView", mobileActiveView);
      }

      // --- GSAP Animations (using vertical motion to avoid horizontal overflow) ---
      gsap.from(".game-title", {
        duration: 0.9,
        y: -30,
        opacity: 0,
        ease: "power3.out",
      });

      gsap.from(".video-container", {
        duration: 1,
        y: 25,
        opacity: 0,
        ease: "power3.out",
        delay: 0.2,
      });

      gsap.from(".game-description", {
        duration: 0.9,
        y: 20,
        opacity: 0,
        ease: "power3.out",
        delay: 0.4,
      });

      if (!isDestroyed) {
        globalLoading.set(false);
      }
    };
    setup();

    return () => {
      isDestroyed = true;
    };
  });

  onDestroy(() => {
    if (typeof document !== "undefined") {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    }
  });
</script>

<main
  class="gamificacao-page fixed inset-0 bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white overflow-hidden flex flex-col"
>
  <!-- Content area: fills everything below navbar, strictly fullscreen with NO SCROLLBARS -->
  <div
    class="flex-1 min-h-0 flex flex-col lg:flex-row items-center justify-center w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 relative z-10 gap-3 lg:gap-8 pt-16 lg:pt-20 pb-12 lg:pb-6 overflow-hidden"
  >
    <!-- Right side on desktop, top on mobile: Text Content -->
    <div
      bind:this={gridEl}
      class="flex flex-col text-center lg:text-left lg:order-2 lg:flex-[2] w-full max-w-xl min-w-0 shrink-0 lg:shrink"
    >
      <div class="game-title mb-1 lg:mb-4">
        <h1
          class="text-xl sm:text-3xl md:text-4xl lg:text-5xl font-black italic tracking-tighter uppercase text-transparent bg-clip-text bg-gradient-to-r from-unrender-accent to-[#ffb7c5] leading-tight"
        >
          Gamificação & Eventos
        </h1>
        <div
          class="w-16 lg:w-24 h-1 lg:h-1.5 bg-gradient-to-r from-unrender-accent to-unrender-purple rounded-full mx-auto lg:mx-0 mt-1 lg:mt-2"
        ></div>
      </div>

      <div class="game-description mb-1 lg:mb-6">
        <p
          class="text-xs sm:text-sm lg:text-base font-medium text-gray-300 mb-2.5 lg:mb-5 leading-snug max-w-lg mx-auto lg:mx-0 line-clamp-2 sm:line-clamp-none"
        >
          Transformamos seu evento em uma jornada inesquecível com jogos sob
          medida, tecnologia imersiva e alto engajamento.
        </p>

        <!-- Buttons SIDE BY SIDE always, compact and fully responsive without cut-off -->
        <div class="flex flex-row items-center justify-center lg:justify-start gap-2 sm:gap-3 w-full max-w-full">
          <button
            bind:this={budgetBtnEl}
            class="px-3 py-1.5 sm:px-4 sm:py-2 lg:px-5 lg:py-2.5 bg-gradient-to-r from-unrender-accent to-[#e67a00] rounded-full font-bold text-[10px] sm:text-xs md:text-sm hover:scale-105 active:scale-95 transition-all shadow-md hover:shadow-unrender-accent/50 text-white flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            on:click={() =>
              contactModalState.update((s) => ({
                ...s,
                isOpen: true,
                title: "Gamificação & Eventos",
              }))}
          >
            <i class="fas fa-file-invoice-dollar text-[10px] sm:text-xs shrink-0"></i>
            <span><span class="hidden sm:inline">SOLICITAR </span>ORÇAMENTO</span>
          </button>

          <button
            class="px-3 py-1.5 sm:px-4 sm:py-2 lg:px-5 lg:py-2.5 bg-gradient-to-r from-emerald-600/40 via-purple-600/40 to-blue-600/40 hover:from-emerald-600/60 hover:to-blue-600/60 border border-emerald-400/50 hover:border-unrender-accent rounded-full font-bold text-[10px] sm:text-xs md:text-sm hover:scale-105 active:scale-95 transition-all shadow-md text-white flex items-center justify-center gap-1.5 group backdrop-blur-md cursor-pointer whitespace-nowrap shrink-0"
            on:click={() =>
              productsModalState.update((s) => ({
                ...s,
                isOpen: true,
                selectedProductId: null
              }))}
          >
            <i class="fas fa-boxes-stacked text-emerald-400 text-[10px] sm:text-xs group-hover:scale-110 transition-transform shrink-0"></i>
            <span><span class="hidden sm:inline">VER </span>PRODUTOS</span>
          </button>
        </div>
      </div>

      <!-- 2D Game -->
      <div
        class="w-full max-w-full overflow-hidden {mobileActiveView === '2dgame'
          ? 'flex flex-1 min-h-0 items-center justify-center'
          : 'hidden lg:block'} mt-2 lg:mt-4"
      >
        <div
          class="w-full aspect-video max-h-[38vh] lg:max-h-none rounded-2xl overflow-hidden shadow-2xl backdrop-blur-md relative border border-white/10"
        >
          <GamificacaoQuiz src="/images/gamificacao.mp4" active={true} />
        </div>
      </div>
    </div>

    <!-- Kiosk: always visible on desktop, toggleable on mobile -->
    <div
      bind:this={carouselEl}
      class="video-container flex-1 min-h-0 items-center justify-center lg:order-1 lg:flex-[3] w-full max-w-full h-full overflow-hidden {mobileActiveView ===
      'kiosk'
        ? 'flex'
        : 'hidden lg:flex'}"
    >
      <div
        class="kiosk-wrapper relative w-full max-w-full h-full flex items-center justify-center overflow-hidden"
        bind:clientWidth={kioskWidth}
        bind:clientHeight={kioskHeight}
      >
        <div
          class="kiosk-scaler"
          style="transform: scale({kioskScale}); transform-origin: center center;"
        >
          <!-- Kiosk Header / Marquee -->
          <div
            class="relative z-20 bg-gradient-to-b from-gray-800 to-gray-900 rounded-t-3xl border-t-4 border-x-4 border-gray-700 p-3 text-center shadow-2xl overflow-hidden"
          >
            <div
              class="absolute inset-0 bg-unrender-accent/10 animate-pulse"
            ></div>
            <h3
              class="relative z-10 text-unrender-accent font-black tracking-[0.2em] text-xl drop-shadow-[0_0_8px_rgba(249,145,38,0.8)]"
            >
              TOTEM
            </h3>
          </div>

          <!-- Kiosk Screen -->
          <div
            class="relative z-10 bg-black overflow-hidden shadow-[0_0_30px_rgba(0,0,0,0.8)] aspect-[3/4] border-x-[10px] border-y-[10px] border-gray-900 flex flex-col items-center justify-center font-mono ring-1 ring-white/10"
          >
            {#if gameState === "name"}
              <!-- Name Input Screen -->
              <div
                class="p-4 w-full h-full flex flex-col justify-between items-center bg-gradient-to-br from-slate-900 to-black text-white"
              >
                <div class="text-center">
                  <div
                    class="mb-2 inline-flex items-center justify-center w-14 h-14 rounded-full bg-unrender-accent/10 border border-unrender-accent/30 text-unrender-accent text-2xl"
                  >
                    <i class="fas fa-user-tag"></i>
                  </div>
                  <h3
                    class="text-xl font-black text-unrender-accent mb-1 italic"
                  >
                    JOGADOR
                  </h3>
                  <p
                    class="text-[10px] text-gray-500 uppercase tracking-widest"
                  >
                    5 Letras Máximo
                  </p>
                </div>

                <div
                  class="flex flex-col items-center space-y-3 w-full origin-center"
                >
                  <!-- Name Display with Cursor -->
                  <div class="flex space-x-2 justify-center">
                    {#each Array(5) as _, i}
                      <div
                        class="w-7 h-9 border-b-2 border-unrender-accent flex items-center justify-center text-lg font-bold"
                      >
                        {#if i < playerName.length}
                          {playerName[i]}
                        {:else if i === playerName.length}
                          <span class="animate-pulse bg-unrender-accent w-2 h-4"
                          ></span>
                        {:else}
                          <span class="text-gray-700">_</span>
                        {/if}
                      </div>
                    {/each}
                  </div>

                  <!-- Virtual Keyboard -->
                  <div class="grid grid-cols-7 gap-1 text-xs w-full">
                    {#each "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("") as letter}
                      <button
                        class="bg-white/5 hover:bg-white/10 p-1.5 rounded transition-colors"
                        on:click={() => addLetter(letter)}
                      >
                        {letter}
                      </button>
                    {/each}
                    <button
                      class="bg-red-500/20 hover:bg-red-500/30 p-1.5 rounded transition-colors col-span-2 text-red-500 font-bold"
                      on:click={removeLetter}
                    >
                      DEL
                    </button>
                  </div>

                  <button
                    class="px-5 py-2 bg-gradient-to-r from-unrender-accent to-unrender-purple rounded-full text-xs font-bold hover:scale-105 transition-transform text-white mt-2"
                    on:click={startGame}
                  >
                    INICIAR JOGO
                  </button>
                </div>

                <div class="text-[9px] text-gray-600">
                  SISTEMA ARCADE UNRENDER v1.0
                </div>
              </div>
            {:else if gameState === "playing"}
              <!-- Playing Screen -->
              <div class="w-full h-full relative overflow-hidden">
                <!-- Dark bg -->
                <div
                  class="absolute inset-0 bg-gradient-to-br from-slate-900 to-black"
                ></div>

                <!-- HUD Overlay -->
                <div
                  class="absolute top-0 left-0 right-0 z-20 flex justify-between items-center px-3 py-1.5 bg-black/50 backdrop-blur-md"
                >
                  <div class="flex items-center space-x-3">
                    <div class="flex items-center space-x-1">
                      <i class="fas fa-user text-unrender-accent text-xs"></i>
                      <span class="text-[10px] font-bold text-white uppercase"
                        >{playerName || "---"}</span
                      >
                    </div>
                    <div class="flex items-center space-x-1">
                      <i class="fas fa-star text-yellow-500 text-xs"></i>
                      <span class="text-xs font-black text-white"
                        >{playerScore}</span
                      >
                    </div>
                  </div>
                  <div
                    class="flex items-center space-x-1 bg-red-500/20 px-2 py-0.5 rounded-full border border-red-500/40"
                  >
                    <i
                      class="fas fa-stopwatch text-red-500 text-xs animate-pulse"
                    ></i>
                    <span class="text-xs font-black text-white"
                      >{timeLeft}s</span
                    >
                  </div>
                  <div class="flex items-center space-x-1">
                    <i class="fas fa-robot text-purple-400 text-xs"></i>
                    <span class="text-xs font-black text-white">{iaScore}</span>
                  </div>
                </div>

                <!-- Game Area with Balloons -->
                <div
                  bind:this={gameAreaEl}
                  class="absolute inset-0 z-10"
                  style="top: 30px; bottom: 24px;"
                >
                  {#each messages as msg (msg.id)}
                    <div
                      class="balloon absolute touch-manipulation"
                      class:balloon-pop={msg.popping}
                      style="left: {msg.x}%; top: {msg.y}%; background: {msg.bgColor};"
                      on:click={() => clickMessage(msg.id)}
                      role="button"
                      tabindex="0"
                    >
                      <i class="fas {msg.icon} text-white text-sm drop-shadow"
                      ></i>
                      <span class="text-[8px] font-bold text-white/90 mt-0.5"
                        >{msg.text}</span
                      >
                      {#if msg.poppedByIA}
                        <i class="fas fa-hand-pointer absolute text-purple-400 text-[28px] drop-shadow-2xl z-20" style="bottom: -10px; right: -15px; transform: rotate(-15deg);"></i>
                      {/if}
                    </div>
                  {/each}
                </div>

                <!-- Bottom Bar -->
                <div
                  class="absolute bottom-0 left-0 right-0 z-20 text-center py-1 bg-black/50 backdrop-blur-sm"
                >
                  <span class="text-[9px] text-gray-400"
                    ><i class="fas fa-mouse-pointer mr-1"></i>Toque nos tickets
                    antes da IA!</span
                  >
                </div>
              </div>
            {:else if gameState === "gameover"}
              <!-- Game Over / Leaderboard Screen -->
              <div
                class="p-3 w-full h-full flex flex-col justify-between bg-gradient-to-br from-slate-900 to-black text-white"
              >
                <div class="text-center">
                  <div
                    class="mb-1 inline-flex items-center justify-center w-10 h-10 rounded-full bg-red-500/10 border border-red-500/30 text-red-500 text-xl"
                  >
                    <i class="fas fa-trophy"></i>
                  </div>
                  <h3 class="text-lg font-black text-red-500 mb-0 italic">
                    FIM DE JOGO
                  </h3>
                  <p class="text-[8px] text-gray-500 uppercase">
                    Ranking Top 10
                  </p>
                </div>

                <div
                  class="w-full bg-white/5 rounded-lg border border-white/10 p-1.5 my-1 flex-1 flex flex-col justify-center"
                >
                  <div class="space-y-0.5">
                    {#each leaderboard as entry, index}
                      <div
                        class="flex justify-between items-center px-1 py-0.5 rounded text-[10px] {entry.name ===
                        playerName
                          ? 'bg-unrender-accent/20 border border-unrender-accent/30 text-unrender-accent'
                          : 'text-gray-400 border border-transparent'}"
                      >
                        <div class="flex items-center space-x-2">
                          <span class="w-4 font-black text-center"
                            >{index + 1}</span
                          >
                          <span class="font-bold uppercase tracking-wider"
                            >{entry.name}</span
                          >
                        </div>
                        <span class="font-black">{entry.score}</span>
                      </div>
                    {/each}
                  </div>
                </div>

                <div class="text-center mt-1">
                  <button
                    class="px-4 py-1.5 bg-gradient-to-r from-unrender-accent to-unrender-purple rounded-full text-[10px] font-bold hover:scale-105 transition-transform text-white flex items-center justify-center mx-auto"
                    on:click={() => (gameState = "name")}
                  >
                    <i class="fas fa-redo mr-1.5"></i> REINICIAR
                  </button>
                </div>
              </div>
            {/if}
          </div>

          <!-- Kiosk Control Panel -->
          <div
            class="relative z-20 bg-gradient-to-t from-gray-800 to-gray-900 rounded-b-3xl border-b-4 border-x-4 border-gray-700 p-4 flex flex-col items-center shadow-2xl origin-top"
            style="transform: perspective(1000px) rotateX(10deg);"
          >
            <div
              class="w-24 h-1 bg-gray-950 rounded-full mb-4 opacity-50 shadow-inner"
            ></div>
            <div class="flex space-x-8">
              <button
                type="button"
                aria-label="Botão Arcade Vermelho"
                class="w-10 h-10 rounded-full bg-red-600 shadow-[0_4px_0_#7f1d1d,0_10px_15px_rgba(0,0,0,0.4)] border-2 border-red-400 active:translate-y-1 active:shadow-none transition-all duration-100 cursor-pointer"
              ></button>
              <button
                type="button"
                aria-label="Botão Arcade Azul"
                class="w-10 h-10 rounded-full bg-blue-600 shadow-[0_4px_0_#1e3a8a,0_10px_15px_rgba(0,0,0,0.4)] border-2 border-blue-400 active:translate-y-1 active:shadow-none transition-all duration-100 cursor-pointer"
              ></button>
            </div>
          </div>

          <!-- Kiosk Stand Base -->
          <div
            class="kiosk-stand relative z-0 w-3/4 bg-gradient-to-b from-gray-800 to-gray-950 mx-auto rounded-b-2xl border-x-4 border-b-4 border-gray-800 shadow-[inset_0_10px_20px_rgba(0,0,0,0.5)] -mt-4"
          ></div>

          <!-- Floor Shadow -->
          <div
            class="w-5/6 h-5 bg-black/80 mx-auto rounded-[100%] blur-md mt-2"
          ></div>
        </div>
      </div>
    </div>
  </div>

  <!-- Mobile Carousel Controls -->
  <button
    type="button"
    aria-label="Alternar para exibição anterior"
    class="lg:hidden fixed left-2 top-1/2 -translate-y-1/2 z-50 w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-white/20 active:scale-95 text-white rounded-full backdrop-blur-md border border-white/20 shadow-lg transition-all cursor-pointer"
    on:click={() =>
      (mobileActiveView = mobileActiveView === "kiosk" ? "2dgame" : "kiosk")}
  >
    <i class="fas fa-chevron-left text-sm pr-0.5"></i>
  </button>

  <button
    type="button"
    aria-label="Alternar para próxima exibição"
    class="lg:hidden fixed right-2 top-1/2 -translate-y-1/2 z-50 w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-white/20 active:scale-95 text-white rounded-full backdrop-blur-md border border-white/20 shadow-lg transition-all cursor-pointer"
    on:click={() =>
      (mobileActiveView = mobileActiveView === "kiosk" ? "2dgame" : "kiosk")}
  >
    <i class="fas fa-chevron-right text-sm pl-0.5"></i>
  </button>

  <div
    class="lg:hidden fixed bottom-3 left-1/2 -translate-x-1/2 z-50 flex items-center space-x-3 bg-black/60 px-3.5 py-1 rounded-full backdrop-blur-md border border-white/15 pointer-events-auto"
  >
    <button
      type="button"
      class="flex items-center space-x-1.5 transition-opacity duration-300 {mobileActiveView ===
      'kiosk'
        ? 'opacity-100'
        : 'opacity-40'} cursor-pointer"
      on:click={() => (mobileActiveView = "kiosk")}
    >
      <div
        class="w-1.5 h-1.5 rounded-full {mobileActiveView === 'kiosk'
          ? 'bg-unrender-accent shadow-[0_0_8px_rgba(249,145,38,0.8)]'
          : 'bg-white'} transition-all duration-300"
      ></div>
      <span class="text-[10px] font-black uppercase tracking-wider text-white"
        >Totem 3D</span
      >
    </button>
    <span class="text-white/20 text-xs">•</span>
    <button
      type="button"
      class="flex items-center space-x-1.5 transition-opacity duration-300 {mobileActiveView ===
      '2dgame'
        ? 'opacity-100'
        : 'opacity-40'} cursor-pointer"
      on:click={() => (mobileActiveView = "2dgame")}
    >
      <div
        class="w-1.5 h-1.5 rounded-full {mobileActiveView === '2dgame'
          ? 'bg-unrender-accent shadow-[0_0_8px_rgba(249,145,38,0.8)]'
          : 'bg-white'} transition-all duration-300"
      ></div>
      <span class="text-[10px] font-black uppercase tracking-wider text-white"
        >Jogo 2D</span
      >
    </button>
  </div>

  <!-- Modal do Catálogo de Produtos e Hardwares Prontos -->
  <ProdutosGamificacaoModal />
</main>

<style>
  main {
    font-family: "Rajdhani", sans-serif;
  }
  h1 {
    font-family: "Montserrat", sans-serif;
    word-break: normal !important;
    overflow-wrap: break-word !important;
  }

  .kiosk-wrapper {
    width: 100%;
    max-width: 100%;
    height: 100%;
    max-height: 100%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Kiosk always fixed size natively, scaled dynamically via JS to fit available space */
  .kiosk-scaler {
    width: 320px;
    max-width: 100%;
    height: 680px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    flex-shrink: 0;
  }

  .kiosk-stand {
    height: 100px;
  }

  .balloon {
    width: 65px;
    height: 72px;
    border-radius: 50% 50% 50% 50% / 45% 45% 55% 55%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    transform: translate(-50%, -50%);
    cursor: pointer;
    box-shadow:
      0 4px 15px rgba(0, 0, 0, 0.3),
      inset 0 -4px 8px rgba(0, 0, 0, 0.2),
      inset 0 4px 8px rgba(255, 255, 255, 0.2);
    animation: balloon-float 2.5s ease-in-out infinite;
    transition: transform 0.1s;
  }
  @media (min-width: 640px) {
    .balloon {
      width: 75px;
      height: 82px;
    }
  }

  .balloon:hover {
    filter: brightness(1.2);
  }
  .balloon::after {
    content: "";
    position: absolute;
    bottom: -10px;
    left: 50%;
    transform: translateX(-50%);
    width: 1.5px;
    height: 14px;
    background: rgba(255, 255, 255, 0.25);
  }

  @keyframes balloon-float {
    0%,
    100% {
      transform: translate(-50%, -50%) translateY(0);
    }
    50% {
      transform: translate(-50%, -50%) translateY(-5px);
    }
  }

  .balloon-pop {
    animation: balloon-pop 0.4s ease-out forwards !important;
  }
  @keyframes balloon-pop {
    0% {
      transform: translate(-50%, -50%) scale(1);
      opacity: 1;
    }
    30% {
      transform: translate(-50%, -50%) scale(1.5);
      opacity: 0.8;
    }
    100% {
      transform: translate(-50%, -50%) scale(0);
      opacity: 0;
    }
  }
</style>
