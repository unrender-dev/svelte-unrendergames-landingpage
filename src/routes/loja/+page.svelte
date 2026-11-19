<script>
    import { onMount } from "svelte";
    import { page } from "$app/stores";
    import { produtosGamificacao, categoriasProdutos, mesclarCatalogoSga } from "$lib/produtosGamificacaoData.js";
    import { productsModalState } from "$lib/modalStore.js";
    import ProdutosGamificacaoModal from "$lib/ProdutosGamificacaoModal.svelte";

    let selectedCategory = "all";
    let searchQuery = "";
    let sortBy = "featured"; // 'featured', 'price-asc', 'price-desc', 'stock'
    let onlyInStock = false;
    let sgaProdutosLive = null;

    $: catalogoAtivo = mesclarCatalogoSga(sgaProdutosLive ?? $page.data?.catalogoSga?.produtos);

    onMount(async () => {
        const endpoint = $page.data?.sga?.catalogo || "http://localhost:3002/api/v1/public/landing/unrender-games/catalogo";
        try {
            const res = await fetch(endpoint);
            if (res.ok) {
                const json = await res.json();
                if (Array.isArray(json.produtos)) {
                    sgaProdutosLive = json.produtos;
                }
            }
        } catch {
            // mantém catálogo SSR ou fallback
        }
    });

    // Filter & Sort Products
    $: filteredProducts = catalogoAtivo
        .filter((product) => {
            const matchesCategory =
                selectedCategory === "all" || product.category === selectedCategory;
            const matchesSearch =
                !searchQuery.trim() ||
                product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                product.shortDesc.toLowerCase().includes(searchQuery.toLowerCase()) ||
                product.tagline.toLowerCase().includes(searchQuery.toLowerCase()) ||
                product.categoryLabel.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesStock = !onlyInStock || (product.inStock && product.stockCount > 0);
            return matchesCategory && matchesSearch && matchesStock;
        })
        .sort((a, b) => {
            if (sortBy === "price-asc") {
                return (a.priceSaleNumeric || 0) - (b.priceSaleNumeric || 0);
            }
            if (sortBy === "price-desc") {
                return (b.priceSaleNumeric || 0) - (a.priceSaleNumeric || 0);
            }
            if (sortBy === "stock") {
                return (b.stockCount || 0) - (a.stockCount || 0);
            }
            return 0; // default order
        });

    function getWhatsAppUrl(product, customMsg = null) {
        const phone = $page.data?.tenant?.whatsapp
            ? $page.data.tenant.whatsapp.replace(/\D/g, "")
            : ($page.data?.tenant?.phone ? $page.data.tenant.phone.replace(/\D/g, "") : "5565999207154");
        
        if (customMsg) {
            return `https://wa.me/${phone}?text=${encodeURIComponent(customMsg)}`;
        }
        const text = encodeURIComponent(
            product?.whatsappMessage ||
            `Olá! Gostaria de consultar informações sobre o produto "${product?.name}" para pronta entrega na loja da Unrender Games.`
        );
        return `https://wa.me/${phone}?text=${text}`;
    }

    function openDirectOrder(productId, mode = "compra") {
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
</script>

<svelte:head>
    <title>Loja de Hardwares & Equipamentos Interativos | Unrender Games</title>
    <meta
        name="description"
        content="Catálogo e loja online de hardwares interativos, kits de realidade virtual, totens 4K e simuladores para compra ou locação com pronta entrega."
    />
</svelte:head>

<div class="min-h-screen bg-[#07080e] text-white pt-20 sm:pt-24 pb-16 font-sans selection:bg-unrender-accent selection:text-black overflow-x-hidden">
    <!-- Ambient Glow Backgrounds -->
    <div class="fixed top-0 left-1/4 w-96 h-96 bg-unrender-accent/10 rounded-full blur-[140px] pointer-events-none -z-0"></div>
    <div class="fixed bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-[140px] pointer-events-none -z-0"></div>

    <!-- Header / Hero Banner (Compact & High Impact) -->
    <header class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-2 pb-5 relative z-10">
        <div class="max-w-3xl space-y-2.5 sm:space-y-3">
            <div class="flex items-center gap-2 flex-wrap">
                <span class="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    Pronta Entrega para Todo o Brasil
                </span>
                <span class="text-xs text-gray-400 hidden sm:inline">
                    • Venda Definitiva & Locação para Eventos
                </span>
            </div>

            <h1 class="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black text-white tracking-tight uppercase leading-tight">
                Loja de Hardwares & <span class="text-transparent bg-clip-text bg-gradient-to-r from-unrender-accent via-amber-400 to-orange-500">Equipamentos Interativos</span>
            </h1>

            <p class="text-xs sm:text-sm text-gray-300 leading-relaxed max-w-2xl">
                Simuladores de alta performance, kits de headset VR corporativos, totens multitoque e pisos projetados com tecnologia Plug & Play e faturamento direto com NF.
            </p>

            <!-- Trust Points Badges -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
                <div class="p-2 sm:p-2.5 rounded-xl bg-white/[0.03] border border-white/10 flex items-center gap-2 hover:border-unrender-accent/40 transition-colors">
                    <i class="fas fa-truck-fast text-unrender-accent text-xs sm:text-sm"></i>
                    <span class="text-gray-300 font-semibold text-[11px] sm:text-xs">Envio em 24h a 48h</span>
                </div>
                <div class="p-2 sm:p-2.5 rounded-xl bg-white/[0.03] border border-white/10 flex items-center gap-2 hover:border-emerald-500/40 transition-colors">
                    <i class="fas fa-file-invoice text-emerald-400 text-xs sm:text-sm"></i>
                    <span class="text-gray-300 font-semibold text-[11px] sm:text-xs">Faturamento PJ com NF</span>
                </div>
                <div class="p-2 sm:p-2.5 rounded-xl bg-white/[0.03] border border-white/10 flex items-center gap-2 hover:border-cyan-400/40 transition-colors">
                    <i class="fas fa-shield-halved text-cyan-400 text-xs sm:text-sm"></i>
                    <span class="text-gray-300 font-semibold text-[11px] sm:text-xs">Garantia de 12 Meses</span>
                </div>
                <div class="p-2 sm:p-2.5 rounded-xl bg-white/[0.03] border border-white/10 flex items-center gap-2 hover:border-amber-400/40 transition-colors">
                    <i class="fas fa-bolt text-amber-400 text-xs sm:text-sm"></i>
                    <span class="text-gray-300 font-semibold text-[11px] sm:text-xs">Bivolt Plug & Play</span>
                </div>
            </div>
        </div>
    </header>

    <!-- Sticky Filter & Search Toolbar (Pins below navbar when scrolled) -->
    <div class="sticky top-16 lg:top-20 z-40 bg-[#07080e]/95 backdrop-blur-xl border-y border-white/10 shadow-[0_12px_30px_rgba(0,0,0,0.8)] py-2.5 sm:py-3 transition-all">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-2.5">
            <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
                <!-- Search Input with centered icon -->
                <div class="relative flex-1 min-w-[220px] max-w-xl">
                    <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
                        <i class="fas fa-search text-xs sm:text-sm"></i>
                    </div>
                    <input
                        type="text"
                        bind:value={searchQuery}
                        placeholder="Buscar por nome, totem, simulador, VR, kinect..."
                        class="w-full pl-10 pr-9 py-2 sm:py-2.5 bg-white/5 hover:bg-white/10 focus:bg-white/10 border border-white/15 focus:border-unrender-accent rounded-xl text-xs sm:text-sm text-white placeholder-gray-400 focus:outline-none transition-all shadow-inner"
                    />
                    {#if searchQuery}
                        <button
                            type="button"
                            class="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-white cursor-pointer"
                            on:click={() => (searchQuery = "")}
                            aria-label="Limpar busca"
                        >
                            <i class="fas fa-times-circle text-xs sm:text-sm"></i>
                        </button>
                    {/if}
                </div>

                <!-- Sort & In-Stock Filter -->
                <div class="flex items-center gap-2 justify-between sm:justify-end flex-wrap sm:flex-nowrap">
                    <div class="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/15 rounded-xl px-2.5 py-1.5 sm:py-2 text-xs transition-colors">
                        <label for="sort-select" class="text-gray-400 font-medium whitespace-nowrap text-[11px] sm:text-xs">Ordenar:</label>
                        <select
                            id="sort-select"
                            bind:value={sortBy}
                            class="bg-transparent text-white font-bold focus:outline-none cursor-pointer text-[11px] sm:text-xs"
                        >
                            <option value="featured" class="bg-slate-900 text-white">Recomendados</option>
                            <option value="price-asc" class="bg-slate-900 text-white">Menor Preço</option>
                            <option value="price-desc" class="bg-slate-900 text-white">Maior Preço</option>
                            <option value="stock" class="bg-slate-900 text-white">Mais em Estoque</option>
                        </select>
                    </div>

                    <button
                        type="button"
                        class="px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl text-[11px] sm:text-xs font-bold transition-all border flex items-center gap-1.5 cursor-pointer whitespace-nowrap {onlyInStock
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm'
                            : 'bg-white/5 text-gray-400 border-white/15 hover:text-white'}"
                        on:click={() => (onlyInStock = !onlyInStock)}
                    >
                        <span class="w-1.5 h-1.5 rounded-full {onlyInStock ? 'bg-emerald-400' : 'bg-gray-500'}"></span>
                        <span>Apenas Pronta Entrega</span>
                    </button>

                    <div class="text-xs text-gray-400 pl-1 hidden md:block whitespace-nowrap">
                        <strong class="text-white">{filteredProducts.length}</strong> produtos
                    </div>
                </div>
            </div>

            <!-- Categories: Clean Wrap & Responsive Pills (ZERO Cutoff, ZERO Horizontal Scroll) -->
            <div class="flex flex-wrap items-center gap-1.5 sm:gap-2 pt-0.5" role="toolbar" aria-label="Categorias de produtos">
                {#each categoriasProdutos as cat}
                    <button
                        type="button"
                        class="px-3 sm:px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all duration-200 flex items-center gap-1.5 cursor-pointer border {selectedCategory === cat.id
                            ? 'bg-unrender-accent text-black border-unrender-accent shadow-md shadow-unrender-accent/30 scale-[1.02]'
                            : 'bg-white/5 hover:bg-white/10 hover:border-white/20 text-gray-300 border-white/10 active:scale-95'}"
                        on:click={() => (selectedCategory = cat.id)}
                    >
                        <i class="{cat.icon} text-xs"></i>
                        <span>{cat.label}</span>
                    </button>
                {/each}
            </div>
        </div>
    </div>

    <!-- Main Content Container: Product Cards Grid & FAQ -->
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8 space-y-12 relative z-10">

        <!-- Product Cards Grid -->
        {#if filteredProducts.length === 0}
            <div class="py-16 sm:py-20 text-center space-y-4 bg-white/[0.02] border border-white/5 rounded-3xl">
                <div class="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto text-gray-500 text-3xl">
                    <i class="fas fa-box-open"></i>
                </div>
                <h3 class="text-lg font-bold text-white">Nenhum equipamento encontrado</h3>
                <p class="text-xs sm:text-sm text-gray-400 max-w-md mx-auto">
                    Não encontramos resultados para sua busca ou categoria. Tente limpar os filtros para ver todo o catálogo.
                </p>
                <button
                    type="button"
                    on:click={() => { searchQuery = ""; selectedCategory = "all"; onlyInStock = false; }}
                    class="px-5 py-2.5 rounded-xl bg-unrender-accent/20 border border-unrender-accent/40 text-unrender-accent text-xs font-bold cursor-pointer hover:bg-unrender-accent/30 transition-all"
                >
                    Limpar Filtros
                </button>
            </div>
        {:else}
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {#each filteredProducts as product (product.id)}
                    <article class="group bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 hover:border-unrender-accent/50 rounded-2xl overflow-hidden transition-all duration-300 flex flex-col justify-between shadow-xl hover:shadow-2xl hover:shadow-unrender-accent/10">
                        
                        <!-- Card Image Area (Clickable) -->
                        <button
                            type="button"
                            class="relative aspect-[16/10] w-full overflow-hidden bg-black/60 cursor-pointer block text-left p-0 border-0 focus:outline-none focus:ring-2 focus:ring-unrender-accent"
                            on:click={() => openProductDetails(product.id)}
                            aria-label="Abrir detalhes de {product.name}"
                        >
                            <img
                                src={product.image}
                                alt={product.name}
                                class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                loading="lazy"
                            />
                            <div class="absolute inset-0 bg-gradient-to-t from-[#0d0f1b] via-transparent to-transparent opacity-85"></div>

                            <!-- Badge overlay -->
                            <div class="absolute top-3 left-3 flex flex-wrap gap-1.5 pointer-events-none">
                                <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider {product.badgeColor} border backdrop-blur-md">
                                    {product.badge}
                                </span>
                            </div>

                            <!-- Stock tag -->
                            <div class="absolute bottom-3 right-3 bg-black/80 backdrop-blur-md px-2.5 py-0.5 rounded-md text-[10px] font-bold text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5 pointer-events-none">
                                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                                <span>{product.stockCount} un pronta entrega</span>
                            </div>
                        </button>

                        <!-- Card Content Body -->
                        <div class="p-4 sm:p-5 flex-1 flex flex-col justify-between space-y-3.5">
                            <div class="space-y-1.5">
                                <div class="text-[10px] uppercase font-bold tracking-wider text-unrender-accent">
                                    {product.categoryLabel}
                                </div>

                                <h2 class="text-base sm:text-lg font-bold text-white leading-snug">
                                    <button
                                        type="button"
                                        class="text-left w-full line-clamp-1 group-hover:text-unrender-accent transition-colors cursor-pointer bg-transparent border-0 p-0 text-white font-bold"
                                        on:click={() => openProductDetails(product.id)}
                                    >
                                        {product.shortTitle || product.name}
                                    </button>
                                </h2>

                                <p class="text-xs text-gray-300 leading-relaxed line-clamp-2">
                                    {product.quickPitch || product.shortDesc}
                                </p>
                            </div>

                            <!-- Clean Feature Tags / Chips -->
                            <div class="flex flex-wrap gap-1.5 py-0.5">
                                {#each (product.tags || product.highlights.slice(0, 3)) as tag}
                                    <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-white/[0.04] border border-white/10 text-[10px] text-gray-300 font-medium">
                                        <span class="w-1 h-1 rounded-full bg-unrender-accent/80 shrink-0"></span>
                                        <span class="truncate">{tag}</span>
                                    </span>
                                {/each}
                            </div>

                            <!-- Pricing Section -->
                            <div class="pt-3 border-t border-white/10 flex items-baseline justify-between">
                                <div>
                                    <span class="text-[9px] uppercase font-bold text-gray-400 tracking-wider block">Venda Definitiva</span>
                                    <span class="text-base sm:text-xl font-black text-white">{product.priceSale}</span>
                                    {#if product.parcelamentoExtraido}
                                        <span class="text-[10px] text-gray-400 block mt-0.5">{product.parcelamentoExtraido}</span>
                                    {/if}
                                </div>
                                <div class="text-right">
                                    <span class="text-[9px] uppercase font-bold text-emerald-400 tracking-wider block">Ou Locação</span>
                                    <span class="text-xs sm:text-sm font-bold text-gray-200">{product.priceRent}</span>
                                </div>
                            </div>

                            <!-- Action Buttons Bar -->
                            <div class="flex items-center gap-2 pt-1">
                                <!-- Primary: Finish Order in App -->
                                <button
                                    type="button"
                                    on:click={() => openDirectOrder(product.id, 'compra')}
                                    class="flex-1 py-2.5 px-3 rounded-xl bg-gradient-to-r from-unrender-accent via-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-black font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/20 active:scale-95 transition-all cursor-pointer"
                                    title="Finalizar compra ou locação no aplicativo"
                                >
                                    <i class="fas fa-cart-shopping text-xs"></i>
                                    <span>Finalizar Pedido</span>
                                </button>

                                <!-- Small Button: WhatsApp (know more) -->
                                <a
                                    href={getWhatsAppUrl(product)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="py-2.5 px-3 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 hover:text-emerald-200 text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0 active:scale-95 cursor-pointer"
                                    title="Saber mais no WhatsApp"
                                    aria-label="Saber mais no WhatsApp"
                                >
                                    <i class="fab fa-whatsapp text-sm text-emerald-400"></i>
                                    <span class="text-[11px] font-semibold hidden min-[420px]:inline">WhatsApp</span>
                                </a>

                                <!-- Quick Details Button -->
                                <button
                                    type="button"
                                    on:click={() => openProductDetails(product.id)}
                                    class="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-gray-300 hover:text-white flex items-center justify-center transition-all shrink-0 cursor-pointer"
                                    title="Ver ficha técnica e fotos completas"
                                    aria-label="Ver detalhes e ficha técnica"
                                >
                                    <i class="fas fa-circle-info text-xs"></i>
                                </button>
                            </div>
                        </div>
                    </article>
                {/each}
            </div>
        {/if}

        <!-- B2B Purchasing & Logistics FAQ / Help Banner -->
        <section class="mt-12 sm:mt-16 p-5 sm:p-8 rounded-3xl bg-white/[0.02] border border-white/10 space-y-6">
            <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
                <div>
                    <h2 class="text-base sm:text-xl font-black text-white uppercase">Dúvidas Frequentes sobre Compra e Locação</h2>
                    <p class="text-xs text-gray-400 mt-0.5">Informações comerciais para contratação corporativa e fornecimento de hardwares.</p>
                </div>
                <a
                    href={getWhatsAppUrl(null, "Olá! Gostaria de falar com o time de engenharia comercial da Unrender sobre compra e locação de hardwares.")}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-all shadow-md shadow-emerald-600/30 shrink-0"
                >
                    <i class="fab fa-whatsapp text-base"></i>
                    <span>Falar com Engenheiro no WhatsApp</span>
                </a>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5 text-xs text-gray-300">
                <div class="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-2">
                    <h3 class="font-bold text-white text-sm flex items-center gap-2 text-unrender-accent">
                        <i class="fas fa-file-invoice-dollar"></i>
                        Como funciona o faturamento?
                    </h3>
                    <p class="leading-relaxed text-gray-400">
                        Emitimos Nota Fiscal Eletrônica (Danfe) com descrição de fornecimento ou locação para empresas (PJ) ou pessoa física. Aceitamos faturamento a prazo via boleto bancário (sujeito à análise de crédito), PIX e cartão corporativo.
                    </p>
                </div>

                <div class="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-2">
                    <h3 class="font-bold text-white text-sm flex items-center gap-2 text-unrender-accent">
                        <i class="fas fa-truck-ramp-box"></i>
                        Prazos e logística de entrega?
                    </h3>
                    <p class="leading-relaxed text-gray-400">
                        Equipamentos em estoque têm envio em 24h a 48h úteis via transportadora com seguro integral de carga. Para eventos em capitais, oferecemos opção de entrega e montagem com equipe técnica no estande.
                    </p>
                </div>

                <div class="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-2">
                    <h3 class="font-bold text-white text-sm flex items-center gap-2 text-unrender-accent">
                        <i class="fas fa-gamepad"></i>
                        Os jogos e softwares vêm inclusos?
                    </h3>
                    <p class="leading-relaxed text-gray-400">
                        Sim! Todos os equipamentos acompanham pacotes de jogos e experiências interativas pré-instalados e configurados Plug & Play. É possível personalizar os jogos com as cores, marcas e regras da sua empresa.
                    </p>
                </div>
            </div>
        </section>

    </main>
</div>

<!-- In-App Interactive Modal & Finish Order Flow -->
<ProdutosGamificacaoModal />
