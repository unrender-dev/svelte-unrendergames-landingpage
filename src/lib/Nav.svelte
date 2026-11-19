<script>
    import { onMount } from "svelte";
    import { page } from "$app/stores";
    import ContactModal from "./ContactModal.svelte";
    import PortfolioModal from "./PortfolioModal.svelte";
    import IframeModal from "./IframeModal.svelte";
    import {
        contactModalState,
        hasSeenSplashScreen,
        globalLoading,
        portfolioModalState,
    } from "$lib/modalStore.js";

    let isScrolled = false;
    let isMobileMenuOpen = false;
    let windowWidth = 1400; // Default to desktop size
    let isMobileServicesOpen = false;

    $: isContactOpen = $contactModalState.isOpen;
    $: isMobile = windowWidth < 1024;

    // Force white background on Home (/), Jogos (/jogos) and Web Interativa pages
    // Checks for exact match on / or if it starts with /jogos or /web-interativa
    $: isAlwaysSolid =
        $page.url.pathname === "/" ||
        $page.url.pathname.startsWith("/jogos") ||
        $page.url.pathname.startsWith("/fortnite") ||
        $page.url.pathname.startsWith("/roblox") ||
        $page.url.pathname.startsWith("/metahuman") ||
        $page.url.pathname.startsWith("/audiovisual") ||
        $page.url.pathname.startsWith("/vfx") ||
        $page.url.pathname.startsWith("/vr") ||
        $page.url.pathname.startsWith("/web-interativa") ||
        $page.url.pathname.startsWith("/gamificacao") ||
        $page.url.pathname.startsWith("/loja");

    $: isServiceActive = [
        "/vr", "/audiovisual", "/gamificacao",
        "/fortnite", "/roblox", "/web-interativa"
    ].some(path => $page.url.pathname.startsWith(path));

    const getMobileLinkClass = (isActive) => `block px-6 py-3 font-medium transition-colors border-l-4 hover:bg-gray-50 hover:text-unrender-accent hover:border-unrender-accent ${isActive ? 'text-unrender-accent border-unrender-accent bg-gray-50' : 'text-gray-800 border-transparent'}`;
    const getMobileBtnClass = (isActive) => `flex items-center justify-between w-full px-6 py-3 font-medium transition-colors border-l-4 hover:bg-gray-50 hover:text-unrender-accent hover:border-unrender-accent bg-transparent border-0 ${isActive ? 'text-unrender-accent border-unrender-accent bg-gray-50' : 'text-gray-800 border-transparent'}`;
    const getMobileSubLinkClass = (isActive) => `block px-6 py-2 transition-colors hover:text-unrender-accent ${isActive ? 'text-unrender-accent font-medium' : 'text-gray-700'}`;
    const getDesktopSubLinkClass = (isActive) => `block px-4 py-2 text-sm transition-colors hover:bg-gray-50 hover:text-unrender-accent ${isActive ? 'text-unrender-accent bg-gray-50 font-medium' : 'text-gray-700'}`;

    // Determine if we should show the solid navbar style
    $: showSolidNav = isScrolled || isAlwaysSolid;

    function toggleMobileMenu() {
        isMobileMenuOpen = !isMobileMenuOpen;
    }

    function closeMobileMenu() {
        isMobileMenuOpen = false;
    }

    function openContact() {
        const path = window.location.pathname.toLowerCase();
        let title = ""; // Default empty for Inicio page

        if (path.includes("fortnite")) title = "Fortnite";
        else if (path.includes("roblox")) title = "Roblox";
        else if (path.includes("jogos")) title = "Jogos";
        else if (path.includes("web-interativa")) title = "Web Interativa";
        else if (path.includes("audiovisual")) title = "Audiovisual";

        contactModalState.set({ isOpen: true, title });
    }

    function closeContact() {
        contactModalState.update((s) => ({ ...s, isOpen: false }));
    }

    // Navigation helper to handle both scrolling and closing menu
    function handleNavigation() {
        setTimeout(() => {
            closeMobileMenu();
            // isMobileServicesOpen = false; removed to preserve accordion state
        }, 150);
    }

    onMount(() => {
        windowWidth = window.innerWidth;

        const handleScroll = () => {
            isScrolled = window.scrollY > 0;
        };

        const handleResize = () => {
            windowWidth = window.innerWidth;
            if (windowWidth >= 1300) {
                isMobileMenuOpen = false;
            }
        };

        const handleKey = (e) => {
            if (e.key === "Escape") {
                if (isContactOpen) closeContact();
                else closeMobileMenu();
            }
        };

        window.addEventListener("scroll", handleScroll);
        window.addEventListener("resize", handleResize);
        window.addEventListener("keydown", handleKey);

        // Initial check
        handleScroll();

        return () => {
            window.removeEventListener("scroll", handleScroll);
            window.removeEventListener("resize", handleResize);
            window.removeEventListener("keydown", handleKey);
        };
    });

    // --- Query Param Auto-Open Logic ---
    let hasCheckedQueryParam = false;

    // Reactively watch for the right conditions to auto-open the modal
    $: if (
        !hasCheckedQueryParam &&
        $hasSeenSplashScreen &&
        !$globalLoading &&
        $page.url.searchParams.has("portfolio")
    ) {
        hasCheckedQueryParam = true;
        // Small delay to ensure any existing animations (like Splash Screen exit or page entrance)
        // are sufficiently advanced or completed before the modal pops in.
        setTimeout(() => {
            // Default to 'jogos' tab when explicitly requested via URL
            portfolioModalState.set({ isOpen: true, activeTab: "jogos" });
        }, 300);
    }
</script>

<nav
    class="fixed top-0 left-0 right-0 z-[1000] transition-all duration-300 navbar"
    class:bg-white={showSolidNav}
    class:shadow-lg={showSolidNav}
    class:scrolled={showSolidNav}
    class:backdrop-blur-sm={!showSolidNav}
>
    <div class="container mx-auto px-4">
        <div class="flex items-center justify-between h-16 lg:h-20">
            <a
                class="flex items-center space-x-2 text-xl font-bold navbar-brand"
                href="/"
                class:text-gray-900={showSolidNav}
                class:text-white={!showSolidNav}
            >
                <img
                    class="w-10 h-10 object-contain"
                    src="/images/unrender-logo-small.png"
                    alt="Unrender Logo"
                />
                <span>UNRENDER</span>
            </a>

            <button
                class="p-2 rounded-md transition-colors navbar-toggler"
                class:hover:bg-gray-100={showSolidNav}
                class:hover:bg-white={!showSolidNav}
                class:bg-opacity-10={!showSolidNav}
                class:hidden={!isMobile}
                style={!showSolidNav
                    ? "background-color: rgba(255, 255, 255, 0.1);"
                    : ""}
                type="button"
                on:click={toggleMobileMenu}
                aria-label="Toggle navigation"
            >
                <svg
                    class="w-6 h-6 transition-colors duration-300"
                    class:text-gray-900={showSolidNav || isMobileMenuOpen}
                    class:text-white={!showSolidNav && !isMobileMenuOpen}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M4 6h16M4 12h16M4 18h16"
                    />
                </svg>
            </button>

            <!-- Desktop Menu -->
            <div
                class="items-center space-x-8"
                class:hidden={isMobile}
                class:flex={!isMobile}
            >
                <ul class="flex space-x-8">
                    <li>
                        <a
                            class="transition-colors hover:text-unrender-accent nav-link"
                            class:active={$page.url.pathname === "/"}
                            class:text-gray-900={showSolidNav}
                            class:text-white={!showSolidNav}
                            href="/">Início</a
                        >
                    </li>
                    <li>
                        <a
                            class="transition-colors hover:text-unrender-accent nav-link"
                            class:active={$page.url.pathname.startsWith("/jogos")}
                            class:text-gray-900={showSolidNav}
                            class:text-white={!showSolidNav}
                            href="/jogos">Jogos</a
                        >
                    </li>

                    <li class="relative group">
                        <button
                            type="button"
                            class="flex items-center space-x-1 transition-colors hover:text-unrender-accent nav-link bg-transparent border-0 p-0"
                            class:active={isServiceActive}
                            class:text-gray-900={showSolidNav}
                            class:text-white={!showSolidNav}
                        >
                            <span>Serviços</span>
                            <svg
                                class="w-4 h-4 transition-transform duration-200 group-hover:rotate-180"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M19 9l-7 7-7-7"
                                />
                            </svg>
                        </button>

                        <div
                            class="absolute left-0 pt-4 w-48 z-[250] opacity-0 translate-y-2 pointer-events-none group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto transition-all duration-200"
                            style="top: 100%;"
                        >
                            <div
                                class="bg-white rounded-md shadow-xl py-2 border border-gray-100"
                            >
                                <a
                                    href="/jogos"
                                    class={getDesktopSubLinkClass($page.url.pathname.startsWith('/jogos'))}
                                    on:click={handleNavigation}>Jogos</a
                                >
                                <a
                                    href="/vr"
                                    class={getDesktopSubLinkClass($page.url.pathname.startsWith('/vr'))}
                                    on:click={handleNavigation}>VR/AR</a
                                >
                                <a
                                    href="/audiovisual"
                                    class={getDesktopSubLinkClass($page.url.pathname.startsWith('/audiovisual'))}
                                    on:click={handleNavigation}
                                    >Audiovisual</a
                                >
                                <a
                                    href="/gamificacao"
                                    class={getDesktopSubLinkClass($page.url.pathname.startsWith('/gamificacao'))}
                                    on:click={handleNavigation}
                                    >Gamificação</a
                                >
                                <a
                                    href="/fortnite"
                                    class={getDesktopSubLinkClass($page.url.pathname.startsWith('/fortnite'))}
                                    on:click={handleNavigation}>Fortnite</a
                                >
                                <a
                                    href="/roblox"
                                    class={getDesktopSubLinkClass($page.url.pathname.startsWith('/roblox'))}
                                    on:click={handleNavigation}>Roblox</a
                                >

                                <a
                                    href="/web-interativa"
                                    class={getDesktopSubLinkClass($page.url.pathname.startsWith('/web-interativa'))}
                                    on:click={handleNavigation}>Web Interativa</a
                                >
                            </div>
                        </div>
                    </li>

                    <li>
                        <a
                            class="transition-colors hover:text-unrender-accent nav-link"
                            class:active={$page.url.pathname.startsWith("/loja")}
                            class:text-gray-900={showSolidNav}
                            class:text-white={!showSolidNav}
                            href="/loja"
                        >
                            Loja
                        </a>
                    </li>

                    <li>
                        <button
                            type="button"
                            class="transition-colors hover:text-unrender-accent nav-link bg-transparent border-0 p-0"
                            class:text-gray-900={showSolidNav}
                            class:text-white={!showSolidNav}
                            on:click={openContact}>Contato</button
                        >
                    </li>
                </ul>
            </div>
        </div>
    </div>
</nav>

<!-- Mobile menu overlay backdrop -->
{#if isMobileMenuOpen}
    <div
        class="fixed inset-0 bg-black/50 z-[1005] transition-opacity duration-300"
        on:click={closeMobileMenu}
        role="button"
        tabindex="0"
        on:keydown={(e) => e.key === "Enter" && closeMobileMenu()}
        aria-label="Close menu"
    ></div>
{/if}

<!-- Mobile menu container (Drawer) -->
<div
    class="fixed top-0 right-0 h-full w-64 bg-white shadow-2xl z-[1010] transform transition-transform duration-300 ease-in-out"
    class:translate-x-0={isMobileMenuOpen}
    class:translate-x-full={!isMobileMenuOpen}
    class:pointer-events-none={!isMobileMenuOpen}
    class:invisible={!isMobileMenuOpen}
    class:hidden={!isMobile && !isMobileMenuOpen}
>
    <div class="flex flex-col h-full">
        <div class="flex justify-end p-4">
            <button
                on:click={closeMobileMenu}
                class="p-2 text-gray-500 hover:text-gray-900 transition-colors"
                aria-label="Close menu"
            >
                <svg
                    class="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M6 18L18 6M6 6l12 12"
                    />
                </svg>
            </button>
        </div>

        <ul class="py-2 space-y-1 overflow-y-auto">
            <li>
                <a
                    class={getMobileLinkClass($page.url.pathname === '/')}
                    href="/"
                    on:click={handleNavigation}>Início</a
                >
            </li>
            <li>
                <a
                    class={getMobileLinkClass($page.url.pathname.startsWith('/jogos'))}
                    href="/jogos"
                    on:click={handleNavigation}>Jogos</a
                >
            </li>
            <li>
                <button
                    type="button"
                    class={getMobileBtnClass(isServiceActive)}
                    on:click={() =>
                        (isMobileServicesOpen = !isMobileServicesOpen)}
                >
                    <span>Serviços</span>
                    <svg
                        class="w-4 h-4 transition-transform duration-200"
                        class:rotate-180={isMobileServicesOpen}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M19 9l-7 7-7-7"
                        />
                    </svg>
                </button>
                {#if isMobileServicesOpen}
                    <ul class="bg-gray-50 py-1 pl-4">
                        <li>
                            <a
                                href="/jogos"
                                class={getMobileSubLinkClass($page.url.pathname.startsWith('/jogos'))}
                                on:click={handleNavigation}>Jogos</a
                            >
                        </li>
                        <li>
                            <a
                                href="/vr"
                                class={getMobileSubLinkClass($page.url.pathname.startsWith('/vr'))}
                                on:click={handleNavigation}>VR/AR</a
                            >
                        </li>
                        <li>
                            <a
                                href="/audiovisual"
                                class={getMobileSubLinkClass($page.url.pathname.startsWith('/audiovisual'))}
                                on:click={handleNavigation}>Audiovisual</a
                            >
                        </li>
                        <li>
                            <a
                                href="/gamificacao"
                                class={getMobileSubLinkClass($page.url.pathname.startsWith('/gamificacao'))}
                                on:click={handleNavigation}>Gamificação</a
                            >
                        </li>
                        <li>
                            <a
                                href="/fortnite"
                                class={getMobileSubLinkClass($page.url.pathname.startsWith('/fortnite'))}
                                on:click={handleNavigation}>Fortnite</a
                            >
                        </li>
                        <li>
                            <a
                                href="/roblox"
                                class={getMobileSubLinkClass($page.url.pathname.startsWith('/roblox'))}
                                on:click={handleNavigation}>Roblox</a
                            >
                        </li>

                        <li>
                            <a
                                href="/web-interativa"
                                class={getMobileSubLinkClass($page.url.pathname.startsWith('/web-interativa'))}
                                on:click={handleNavigation}>Web Interativa</a
                            >
                        </li>
                    </ul>
                {/if}
            </li>
            <li>
                <a
                    class={getMobileLinkClass($page.url.pathname.startsWith('/loja'))}
                    href="/loja"
                    on:click={handleNavigation}
                >
                    Loja
                </a>
            </li>
            <li>
                <button
                    type="button"
                    class="block w-full text-left px-6 py-3 text-gray-800 font-medium hover:bg-gray-50 hover:text-unrender-accent transition-colors border-l-4 border-transparent hover:border-unrender-accent bg-transparent border-0"
                    on:click={() => {
                        closeMobileMenu();
                        openContact();
                    }}>Contato</button
                >
            </li>
        </ul>
    </div>
</div>

<ContactModal />
<PortfolioModal />
<IframeModal />

<style>
    :global(:root) {
        --unrender-accent: #ffa500;
    }

    .navbar {
        font-family: "Montserrat", "Roboto", "Inter", sans-serif !important;
        transition:
            background-color 0.4s ease-out,
            backdrop-filter 0.4s ease-out,
            padding 0.4s ease-out;
    }

    .navbar .navbar-brand,
    .navbar .nav-link {
        display: flex;
        justify-content: center;
        align-items: center;
        color: #f0f0f0; /* Cor off-white para o texto transparente */
        transition:
            color 0.4s ease-out,
            transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);

        position: relative;
    }

    /* Remove underline effect */
    /* Brand hover effect: Scale up */
    .navbar .navbar-brand:hover,
    .navbar .navbar-brand:focus,
    .navbar .navbar-brand.active {
        transform: scale(1.1);
    }

    /* Nav items hover effect: Orange, no scale */
    .navbar .nav-link:hover,
    .navbar .nav-link:focus,
    .navbar .nav-link.active {
        color: var(
            --unrender-accent
        ) !important; /* Force override of utility classes */
        transform: none; /* Ensure no scale for links */
    }

    .navbar .container {
        transition: all 0.4s ease-out;
    }

    /* Estilos aplicados quando a página é rolada */
    .navbar.scrolled {
        background-color: rgba(255, 255, 255, 0.85) !important;
        backdrop-filter: blur(10px) !important;
        -webkit-backdrop-filter: blur(10px) !important;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1) !important;
    }

    .navbar.scrolled .navbar-brand,
    .navbar.scrolled .nav-link {
        color: #0a192f; /* Cor azul escuro para o texto quando com fundo branco */
    }

    /* Keep accent color on hover even when scrolled */
    .navbar.scrolled .nav-link:hover,
    .navbar.scrolled .nav-link:focus,
    .navbar.scrolled .nav-link.active {
        color: var(--unrender-accent) !important;
    }
</style>
