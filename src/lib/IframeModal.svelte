<script>
    import { iframeModalState } from "$lib/modalStore.js";
    import { fade, fly } from "svelte/transition";

    $: isOpen = $iframeModalState.isOpen;
    $: url = $iframeModalState.url;

    function close() {
        iframeModalState.update((s) => ({ ...s, isOpen: false }));
    }

    function openInNewTab() {
        if (url) {
            window.open(url, "_blank");
            close();
        }
    }

    function handleOutsideClick(e) {
        if (e.target.classList.contains("modal-overlay")) {
            close();
        }
    }

    function handleKeydown(e) {
        if (e.key === "Escape" && isOpen) {
            close();
        }
    }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
    <div
        class="modal-overlay fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-8"
        on:click={handleOutsideClick}
        on:keydown={(e) => e.key === "Enter" && handleOutsideClick(e)}
        role="button"
        tabindex="0"
        transition:fade={{ duration: 300 }}
    >
        <div
            class="modal-content relative w-full max-w-6xl h-full max-h-[90vh] bg-gradient-to-br from-unrender-purple to-[#0a0a1a] rounded-2xl shadow-2xl border border-white/10 overflow-hidden flex flex-col"
            transition:fly={{ y: 20, duration: 400 }}
        >
            <!-- Header Section (Matching Contact style) -->
            <div class="px-6 md:px-8 py-5 md:py-6 bg-black/20 border-b border-white/10 flex items-center justify-between">
                <div>
                    <h2 class="text-3xl font-bold text-white font-['Montserrat']">
                        Saiba Mais
                    </h2>
                </div>
                <div class="flex items-center space-x-3">
                    <button
                        on:click={openInNewTab}
                        class="flex items-center space-x-2 px-4 py-2 text-sm font-bold text-unrender-purple bg-white hover:bg-unrender-accent hover:text-white rounded-lg transition-all shadow-lg hover:shadow-unrender-accent/20"
                    >
                        <i class="fas fa-external-link-alt text-sm"></i>
                        <span>Abrir em Nova Aba</span>
                    </button>
                    <button
                        on:click={close}
                        class="p-2 text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-all"
                        aria-label="Fechar"
                    >
                        <i class="fas fa-times text-xl"></i>
                    </button>
                </div>
            </div>

            <!-- Body (Iframe) -->
            <div class="flex-grow bg-white/5 relative">
                {#if url}
                    <iframe
                        src={url}
                        title="Conteúdo"
                        class="w-full h-full border-none"
                        loading="lazy"
                    ></iframe>
                {:else}
                    <div
                        class="absolute inset-0 flex items-center justify-center text-white/50"
                    >
                        Carregando...
                    </div>
                {/if}
            </div>

            <!-- Mobile Footer (Internal navigation) -->
            <div
                class="sm:hidden px-6 py-4 border-t border-white/10 flex justify-end bg-black/20"
            >
                <button
                    on:click={close}
                    class="px-6 py-2.5 bg-white/10 text-white font-bold rounded-lg hover:bg-white/20 transition-all uppercase tracking-wider text-sm"
                >
                    Fechar
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    .modal-overlay {
        font-family: "Montserrat", "Roboto", "Inter", sans-serif;
    }

    iframe {
        background-color: white;
    }
</style>
