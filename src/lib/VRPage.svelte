<script>
  import { onMount, onDestroy } from "svelte";
  import { fade } from "svelte/transition";
  import { gsap } from "gsap";
  import { page } from "$app/stores";

  import Carousel from "./Carousel.svelte";
  import { contactModalState, productsModalState, globalLoading } from "./modalStore.js";
  import FeatureGrid from "./FeatureGrid.svelte";
  import { produtosGamificacao, mesclarCatalogoSga } from "./produtosGamificacaoData.js";
  import ProdutosGamificacaoModal from "./ProdutosGamificacaoModal.svelte";

  // Filter VR and simulation hardware products for showcase (connected to SGA CTRLB)
  $: catalogoAtivo = mesclarCatalogoSga($page.data?.catalogoSga?.produtos);
  $: vrProducts = catalogoAtivo.filter(
    (p) => p.category === "vr-headset" || p.category === "simuladores" || p.category === "acessorios-vr"
  );

  const features = [
    {
      icon: "fas fa-vr-cardboard",
      title: "Simuladores & Treinamentos",
      shortDesc: "Capacitação imersiva e segura.",
      longDesc:
        "Desenvolvemos simuladores de alta fidelidade em Realidade Virtual e Aumentada para treinamento de equipes, reduzindo riscos operacionais.",
      images: ["/images/simulacao.webp"],
    },
    {
      icon: "fas fa-map-marked-alt",
      title: "Tours Virtuais 360°",
      shortDesc: "Visite qualquer lugar.",
      longDesc:
        "Apresente imóveis, fábricas ou pontos turísticos com tours virtuais interativos de alta qualidade em VR.",
      images: ["/images/tour-virtual.webp"],
    },
    {
      icon: "fas fa-gamepad",
      title: "Jogos Sob Medida",
      shortDesc: "Projetos em VR e AR.",
      longDesc:
        "Criamos jogos personalizados em Realidade Virtual e Aumentada para entretenimento, educação e experiências corporativas.",
      images: ["/images/realidadevirtual.mp4"],
    },
    {
      icon: "fas fa-bullhorn",
      title: "Ativações de Marca",
      shortDesc: "Destaque seu estande.",
      longDesc:
        "Atraia público para seu evento com experiências imersivas e exclusivas em Realidade Virtual e Aumentada.",
      images: ["/images/ativacao.webp"],
    },
  ];

  let carouselEl;
  let gridEl;
  let budgetBtnEl;

  const carouselSlides = [
    {
      type: "image",
      src: "/images/enigma0.webp",
      alt: "Enigma 0",
      label: "Protótipo",
      duration: 4600,
    },
    {
      type: "image",
      src: "/images/enigma1.webp",
      alt: "Enigma 1",
      label: "Protótipo",
      duration: 8080,
    },
    {
      type: "localVideo",
      src: "/images/realidadevirtual.mp4",
      alt: "Experiência VR",
      label: "Enigma dos Sinais",
      waitForEnd: true,
    },
    {
      type: "image",
      src: "/images/CentelhaMT.jpg",
      alt: "Pessoa com headset VR",
      label: "Resultado Fase 1",
    },
  ];

  function getWhatsAppUrl(product) {
    const phone = $page.data.tenant?.whatsapp
      ? $page.data.tenant.whatsapp.replace(/\D/g, "")
      : ($page.data.tenant?.phone ? $page.data.tenant.phone.replace(/\D/g, "") : "5565999207154");
    const text = encodeURIComponent(
      product?.whatsappMessage ||
        `Olá! Gostaria de saber mais sobre o kit de VR/Simulador "${product?.name}" para pronta entrega.`
    );
    return `https://wa.me/${phone}?text=${text}`;
  }

  function openOrderForProduct(productId, mode = "compra") {
    productsModalState.update((s) => ({
      ...s,
      isOpen: true,
      selectedProductId: productId,
      directCheckout: true,
      checkoutMode: mode,
    }));
  }

  function openProductDetails(productId) {
    productsModalState.update((s) => ({
      ...s,
      isOpen: true,
      selectedProductId: productId,
      directCheckout: false,
    }));
  }

  onMount(() => {
    globalLoading.set(true);

    // Prevent body scrolling
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    // --- GSAP Animations ---
    gsap.from(".game-title", {
      duration: 1,
      y: -50,
      opacity: 0,
      ease: "power3.out",
    });

    gsap.from(".video-container", {
      duration: 1.2,
      x: -100,
      opacity: 0,
      ease: "power3.out",
      delay: 0.3,
    });

    gsap.from(".game-description", {
      duration: 1,
      y: 30,
      opacity: 0,
      ease: "power3.out",
      delay: 0.6,
    });

    gsap.fromTo(
      ".feature-item",
      { x: 50, opacity: 0 },
      {
        duration: 0.8,
        x: 0,
        opacity: 1,
        ease: "power3.out",
        stagger: 0.2,
        delay: 0.9,
      },
    );

    globalLoading.set(false);
  });

  onDestroy(() => {
    if (typeof document !== "undefined") {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    }
  });
</script>

<main
  class="fixed inset-0 bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white overflow-hidden pt-20 lg:pt-24 flex flex-col"
>
  <div
    class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden w-full p-4 md:p-6 lg:p-8 relative z-10 flex flex-col space-y-12"
  >
    <!-- Top Hero Section -->
    <div
      class="m-auto relative grid grid-cols-1 lg:grid-cols-2 gap-8 items-center w-full max-w-7xl"
    >
      <!-- Left side: Media -->
      <div bind:this={carouselEl} class="video-container">
        <div class="relative">
          <div
            class="absolute -inset-4 bg-gradient-to-r from-cyan-500 to-purple-600 rounded-2xl blur-lg opacity-30"
          ></div>
          <div
            class="relative bg-black rounded-2xl overflow-hidden shadow-2xl aspect-video border border-white/10 w-full max-h-[25vh] lg:max-h-[40vh]"
          >
            <Carousel slides={carouselSlides} />
          </div>
        </div>
      </div>

      <!-- Right side: Content -->
      <div
        bind:this={gridEl}
        class="flex flex-col justify-between lg:justify-center h-full min-h-0 py-2 lg:py-0 text-center lg:text-left"
      >
        <div class="game-title shrink-0 mb-2 lg:mb-4">
          <h1
            class="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black italic tracking-tighter uppercase text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500"
          >
            Realidade Virtual & Aumentada
          </h1>
          <div
            class="w-16 md:w-24 h-1 md:h-1.5 bg-gradient-to-r from-cyan-400 to-purple-500 rounded-full mx-auto lg:mx-0 mt-2"
          ></div>
        </div>

        <div class="game-description shrink-0 mb-3 lg:mb-6">
          <p
            class="text-[11px] sm:text-xs md:text-sm lg:text-base font-medium text-gray-300 mb-3 lg:mb-4 leading-tight"
          >
            Desenvolvemos simuladores corporativos, treinamentos imersivos de alta precisão e jogos sob medida para estandes e eventos. Conheça nossos kits de óculos VR e cockpits de simulação para pronta entrega.
          </p>

          <!-- Action Buttons Group -->
          <div class="flex items-center justify-center lg:justify-start gap-2.5 flex-wrap">
            <button
              bind:this={budgetBtnEl}
              class="px-4 py-2 md:px-5 md:py-2.5 bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 rounded-xl font-bold text-xs md:text-sm hover:scale-105 transition-transform shadow-lg hover:shadow-cyan-500/50 text-white cursor-pointer"
              on:click={() =>
                contactModalState.update((s) => ({
                  ...s,
                  isOpen: true,
                  title: "Realidade Virtual e Aumentada",
                }))}
            >
              <i class="fas fa-envelope mr-1.5"></i>
              SOLICITAR ORÇAMENTO
            </button>

            <button
              type="button"
              class="px-4 py-2 md:px-5 md:py-2.5 bg-gradient-to-r from-emerald-600/40 via-cyan-600/40 to-blue-600/40 hover:from-emerald-600/60 hover:to-cyan-600/60 border border-cyan-400/50 hover:border-cyan-300 rounded-xl font-bold text-xs md:text-sm hover:scale-105 transition-all shadow-lg text-white flex items-center gap-2 group backdrop-blur-md cursor-pointer"
              on:click={() =>
                productsModalState.update((s) => ({
                  ...s,
                  isOpen: true,
                  selectedCategory: "vr-headset",
                  selectedProductId: null,
                }))}
            >
              <i class="fas fa-vr-cardboard text-cyan-400 group-hover:scale-110 transition-transform"></i>
              <span>KITS VR & SIMULADORES</span>
              <span class="text-[9px] uppercase font-black px-1.5 py-0.5 rounded-full bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 tracking-wider hidden sm:inline-block">
                Pronta Entrega
              </span>
            </button>

            <a
              href="/loja"
              class="px-3.5 py-2 md:py-2.5 bg-white/10 hover:bg-white/20 border border-white/15 rounded-xl font-bold text-xs md:text-sm hover:border-white/30 text-white transition-all flex items-center gap-1.5"
            >
              <i class="fas fa-shop text-xs text-unrender-accent"></i>
              <span>Loja Completa</span>
            </a>
          </div>
        </div>

        <div class="shrink min-h-0 w-full bg-transparent z-10 relative">
          <FeatureGrid
            {features}
            hoverBgClass="hover:bg-white/5 focus:bg-white/5"
            gapClass="gap-2 md:gap-3"
          />
        </div>
      </div>
    </div>

    <!-- Featured VR & Simulator Kits Showcase Section -->
    <div class="w-full max-w-7xl mx-auto space-y-6 pb-20">
      <div class="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
            <span class="text-[11px] uppercase font-black tracking-wider text-cyan-400">
              Equipamentos de Simulação & VR para Pronta Entrega
            </span>
          </div>
          <h2 class="text-xl sm:text-2xl md:text-3xl font-black text-white mt-1">
            Kits de Headset VR, Cockpits e Simuladores
          </h2>
          <p class="text-xs sm:text-sm text-gray-300 mt-1 max-w-2xl">
            Hardwares profissionais disponíveis para compra definitiva ou locação para eventos corporativos, feiras e treinamentos técnicos.
          </p>
        </div>

        <a
          href="/loja"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/40 text-cyan-300 text-xs font-bold transition-all shrink-0 hover:scale-105 active:scale-95"
        >
          <span>Explorar Todos os Produtos na Loja</span>
          <i class="fas fa-arrow-right text-[10px]"></i>
        </a>
      </div>

      <!-- VR Products Cards Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {#each vrProducts as product (product.id)}
          <div class="group bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 hover:border-cyan-400/40 rounded-2xl overflow-hidden transition-all duration-300 flex flex-col justify-between shadow-lg hover:shadow-cyan-500/10">
            <!-- Card Image Area (Clickable) -->
            <div
              class="relative aspect-[16/10] w-full overflow-hidden bg-black/60 cursor-pointer"
              on:click={() => openProductDetails(product.id)}
              role="button"
              tabindex="0"
              on:keydown={(e) => { if (e.key === 'Enter') openProductDetails(product.id); }}
            >
              <img
                src={product.image}
                alt={product.name}
                class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                loading="lazy"
              />
              <div class="absolute inset-0 bg-gradient-to-t from-[#0d0f1b] via-transparent to-transparent opacity-80"></div>

              <!-- Badge overlay -->
              <div class="absolute top-2.5 left-2.5 flex flex-wrap gap-1.5 pointer-events-none">
                <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider {product.badgeColor} border backdrop-blur-md">
                  {product.badge}
                </span>
              </div>

              <!-- Stock tag -->
              <div class="absolute bottom-2.5 right-2.5 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded-md text-[10px] font-bold text-emerald-400 border border-emerald-500/30 flex items-center gap-1 pointer-events-none">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span>{product.stockCount} un pronta entrega</span>
              </div>
            </div>

            <!-- Card Content Body -->
            <div class="p-4 flex-1 flex flex-col justify-between space-y-3">
              <div class="space-y-1.5">
                <div class="text-[10px] uppercase font-bold tracking-wider text-cyan-400">
                  {product.categoryLabel}
                </div>

                <h3
                  class="text-sm font-bold text-white leading-snug line-clamp-1 group-hover:text-cyan-400 transition-colors cursor-pointer"
                  on:click={() => openProductDetails(product.id)}
                  role="button"
                  tabindex="0"
                  on:keydown={(e) => { if (e.key === 'Enter') openProductDetails(product.id); }}
                >
                  {product.shortTitle || product.name}
                </h3>

                <p class="text-xs text-gray-300 leading-relaxed line-clamp-2">
                  {product.quickPitch || product.shortDesc}
                </p>
              </div>

              <!-- Clean Feature Tags / Chips -->
              <div class="flex flex-wrap gap-1.5 py-0.5">
                {#each (product.tags || product.highlights.slice(0, 3)) as tag}
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/10 text-[10px] text-gray-300 font-medium">
                    <span class="w-1 h-1 rounded-full bg-cyan-400 shrink-0"></span>
                    <span class="truncate">{tag}</span>
                  </span>
                {/each}
              </div>

              <!-- Pricing Section -->
              <div class="pt-2.5 border-t border-white/10 flex items-baseline justify-between">
                <div>
                  <span class="text-[9px] uppercase font-bold text-gray-400 tracking-wider block">Venda Definitiva</span>
                  <span class="text-base font-black text-white">{product.priceSale}</span>
                </div>
                <div class="text-right">
                  <span class="text-[9px] uppercase font-bold text-emerald-400 tracking-wider block">Ou Locação</span>
                  <span class="text-xs font-bold text-gray-200">{product.priceRent}</span>
                </div>
              </div>

              <!-- Action Buttons Bar -->
              <div class="flex items-center gap-2 pt-1">
                <!-- Primary: Finish Order in App -->
                <button
                  type="button"
                  on:click={() => openOrderForProduct(product.id, 'compra')}
                  class="flex-1 py-2 px-2.5 rounded-xl bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-600 hover:from-cyan-400 hover:to-blue-400 text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md shadow-cyan-500/20 active:scale-95 transition-all cursor-pointer"
                  title="Finalizar compra ou locação no aplicativo"
                >
                  <i class="fas fa-cart-shopping text-xs"></i>
                  <span>Finalizar Pedido</span>
                </button>

                <!-- Small Button: WhatsApp -->
                <a
                  href={getWhatsAppUrl(product)}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="py-2 px-2.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 hover:text-emerald-200 text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0 active:scale-95 cursor-pointer"
                  title="Saber mais no WhatsApp"
                  aria-label="Saber mais no WhatsApp"
                >
                  <i class="fab fa-whatsapp text-sm text-emerald-400"></i>
                  <span class="text-[11px] font-semibold hidden min-[400px]:inline">WhatsApp</span>
                </a>

                <!-- Quick Details Button -->
                <button
                  type="button"
                  on:click={() => openProductDetails(product.id)}
                  class="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-gray-300 hover:text-white flex items-center justify-center transition-all shrink-0 cursor-pointer"
                  title="Ver especificações e ficha técnica"
                  aria-label="Ver detalhes e ficha técnica"
                >
                  <i class="fas fa-circle-info text-xs"></i>
                </button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>
</main>

<!-- In-App Catalog & Checkout Modal -->
<ProdutosGamificacaoModal />

<style>
  main {
    font-family: "Rajdhani", sans-serif;
  }
  h1, h2, h3 {
    font-family: "Montserrat", sans-serif;
  }
</style>
