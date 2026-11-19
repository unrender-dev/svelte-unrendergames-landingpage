<script>
    import { onMount, createEventDispatcher } from "svelte";
    import { gsap } from "gsap";
    import { hasSeenSplashScreen } from "$lib/modalStore.js";
    import { portal } from "./portal";

    export let isLoading = true;

    const dispatch = createEventDispatcher();
    let splashContainer;
    let logo;
    let brandText;
    let subText;
    let isExiting = false;

    onMount(() => {
        // Initial entrance animation
        // Set initial states immediately to avoid flickering
        gsap.set([logo, brandText, subText], { opacity: 0, y: 20 });
        gsap.set(logo, { scale: 0.8 });

        const tl = gsap.timeline();

        // Animate all elements together
        tl.to([logo, brandText, subText], {
            scale: 1,
            y: 0,
            opacity: 1,
            duration: 1.2,
            ease: "power3.out",
            stagger: 0, // Explicitly set to 0 for simultaneous animation
        });
    });

    // Watch for isLoading becoming false to trigger exit
    $: if (!isLoading && !isExiting && splashContainer) {
        exit();
    }

    function exit() {
        isExiting = true;
        const tl = gsap.timeline({
            onComplete: () => {
                hasSeenSplashScreen.set(true);
                dispatch("complete");
            },
        });

        tl.to([subText, brandText, logo], {
            y: -30,
            opacity: 0,
            duration: 0.6,
            stagger: 0.1,
            ease: "power2.in",
        }).to(
            splashContainer,
            {
                opacity: 0,
                duration: 0.8,
                ease: "power3.inOut",
            },
            "-=0.2",
        );
    }
</script>

<div
    use:portal
    bind:this={splashContainer}
    class="splash-screen fixed inset-0 z-[999999] flex flex-col items-center justify-center bg-[#0a0a0a] text-white p-4 pointer-events-auto"
>
    <div
        class="flex flex-col items-center max-w-[70vw] md:max-w-[70vh] w-full aspect-square justify-center relative"
    >
        <img
            bind:this={logo}
            src="/images/unrender-light.svg"
            alt="Unrender Logo"
            class="w-full h-auto object-contain mb-8 md:mb-12"
            style="opacity: 0;"
        />

        <div class="text-center space-y-4">
            <h1
                bind:this={brandText}
                class="text-4xl md:text-6xl font-bold tracking-[0.2em] uppercase"
                style="font-family: 'Montserrat', sans-serif; opacity: 0;"
            >
                UNRENDER
            </h1>

            <p
                bind:this={subText}
                class="text-sm md:text-xl font-medium tracking-widest text-[#f99126] uppercase opacity-80"
                style="font-family: 'Rajdhani', sans-serif; opacity: 0;"
            >
                Realidade Virtual | Jogos | Modelagem 3D | Audiovisual
            </p>
        </div>
    </div>
</div>

<style>
    .splash-screen {
        overflow: hidden;
    }
</style>
