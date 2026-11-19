<script>
    import { page } from "$app/stores";
    import { portfolioModalState, contactModalState } from "$lib/modalStore.js";
    import { onMount } from "svelte";
    import { whatsappComVisitante } from "$lib/rastroSga.js";

    // Reactive pathname
    $: pathname = $page.url.pathname;
    // WhatsApp = Link Rastreável do SGA Ctrl+B (conversa cai no Atendimento com a origem).
    let montado = false;
    onMount(() => (montado = true));
    $: zapAntigo = $page.data.tenant?.whatsapp ? `https://wa.me/${$page.data.tenant.whatsapp.replace(/\D/g, '')}` : ($page.data.tenant?.phone ? `https://wa.me/${$page.data.tenant.phone.replace(/\D/g, '')}` : "https://wa.me/5565999207154");
    $: zap = montado ? whatsappComVisitante($page.data.sga, zapAntigo) : ($page.data.sga?.whatsapp || zapAntigo);
    $: isJogosPage = pathname === "/jogos" || pathname === "/jogos/";
</script>

<!-- If we are on Jogos Page, the FABs should be top-right, right below the config button (which is top-40) -->
{#if isJogosPage}
    <a
        href={zap}
        target="_blank"
        rel="noopener noreferrer"
        class="fixed top-56 right-4 z-[99] p-3 rounded-full glass-panel text-white hover:bg-white/20 transition-all active:scale-95 shadow-lg hover:shadow-green-500/50"
        aria-label="Falar no WhatsApp"
        title="Falar no WhatsApp"
    >
        <i
            class="fab fa-whatsapp no-pixel text-green-400 text-xl w-6 h-6 flex items-center justify-center"
        ></i>
    </a>

    <button
        class="fixed top-72 right-4 z-[99] p-3 rounded-full glass-panel text-white hover:bg-white/20 transition-all active:scale-95 shadow-lg hover:shadow-orange-500/50"
        on:click={() => portfolioModalState.set({ isOpen: true, activeTab: "jogos" })}
        aria-label="Ver Portfólio"
        title="Ver Portfólio"
    >
        <i
            class="fas fa-briefcase no-pixel text-orange-400 text-xl w-6 h-6 flex items-center justify-center"
        ></i>
    </button>
{:else}
    <!-- For all other pages, use bottom right FABs -->
    <!-- Positioned to avoid overlap with centered carousel nav controls -->
    <a
        href={zap}
        target="_blank"
        rel="noopener noreferrer"
        class="fixed bottom-16 sm:bottom-20 md:bottom-24 right-3 z-[99] p-3 sm:p-4 rounded-full bg-green-500 text-white hover:bg-green-600 transition-all active:scale-95 shadow-lg shadow-green-500/30"
        aria-label="Falar no WhatsApp"
        title="Falar no WhatsApp"
    >
        <i
            class="fab fa-whatsapp no-pixel text-lg sm:text-2xl w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center"
        ></i>
    </a>

    <button
        class="fixed bottom-3 sm:bottom-5 md:bottom-6 right-3 z-[99] p-3 sm:p-4 rounded-full bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 transition-all active:scale-95 shadow-lg shadow-orange-500/30"
        on:click={() => portfolioModalState.set({ isOpen: true, activeTab: "jogos" })}
        aria-label="Ver Portfólio"
        title="Ver Portfólio"
    >
        <i
            class="fas fa-briefcase no-pixel text-lg sm:text-2xl w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center"
        ></i>
    </button>
{/if}
