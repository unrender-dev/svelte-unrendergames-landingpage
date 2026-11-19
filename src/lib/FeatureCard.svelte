<script>
    import { onMount, onDestroy } from "svelte";

    export let feature;
    export let positionClass = "top-0 left-0";
    export let hoverBgClass = "hover:bg-[#1e1b4b] focus:bg-[#1e1b4b]";

    let currentImageIndex = 0;
    let interval;

    $: images = Array.isArray(feature.images)
        ? feature.images
        : [feature.images];

    onMount(() => {
        if (images.length > 1) {
            interval = setInterval(() => {
                currentImageIndex = (currentImageIndex + 1) % images.length;
            }, 3000); // 3 seconds per image
        }
    });

    onDestroy(() => {
        if (interval) clearInterval(interval);
    });
</script>

<div
    class="relative w-full h-[48px] md:h-[56px] feature-item z-10 hover:z-[100] focus-within:z-[100]"
>
    <div
        role="button"
        tabindex="0"
        class="group absolute {positionClass} z-10 hover:z-50 focus:z-50 focus-within:z-50 w-full hover:w-[260px] xs:hover:w-[290px] sm:hover:w-[320px] md:hover:w-[420px] lg:hover:w-[480px] focus:w-[260px] xs:focus:w-[290px] sm:focus:w-[320px] md:focus:w-[420px] lg:focus:w-[480px] h-[48px] md:h-[56px] hover:h-[130px] sm:hover:h-[150px] md:hover:h-[180px] lg:hover:h-[200px] focus:h-[130px] sm:focus:h-[150px] md:focus:h-[180px] lg:focus:h-[200px] bg-white/10 backdrop-blur-xl {hoverBgClass} rounded-lg border border-white/20 p-2 md:p-2.5 transition-all duration-300 ease-out overflow-hidden shadow-md hover:shadow-2xl focus:shadow-2xl flex flex-col outline-none"
    >
        <div class="flex items-center space-x-2 md:space-x-3 shrink-0">
            <div
                class="w-8 h-8 md:w-9 md:h-9 rounded-md flex items-center justify-center bg-white/20 shrink-0"
            >
                <i class="{feature.icon} text-white text-[12px] md:text-sm"></i>
            </div>
            <h4
                class="text-[11px] md:text-sm font-semibold text-white whitespace-nowrap overflow-hidden text-ellipsis"
            >
                {feature.title}
            </h4>
        </div>

        <div
            class="flex flex-row mt-3 md:mt-4 gap-2 md:gap-4 items-center opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity duration-300 delay-100"
        >
            <div class="flex flex-col flex-1 justify-center min-w-0">
                <p
                    class="text-[10px] md:text-sm text-gray-200 leading-tight font-medium mb-1 line-clamp-2"
                >
                    {feature.shortDesc}
                </p>
                <p
                    class="text-[9px] md:text-xs text-gray-400 leading-snug line-clamp-3 hidden sm:block"
                >
                    {feature.longDesc}
                </p>
            </div>
            <div
                class="w-20 sm:w-28 md:w-36 lg:w-44 shrink-0 rounded overflow-hidden relative aspect-video shadow-inner bg-black/50"
            >
                {#each images as img, i}
                    {#if img.endsWith('.mp4')}
                        <video
                            src={img}
                            autoplay
                            loop
                            muted
                            playsinline
                            class="absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ease-in-out {i ===
                            currentImageIndex
                                ? 'opacity-100 z-10'
                                : 'opacity-0 z-0'}"
                        ></video>
                    {:else}
                        <img
                            src={img}
                            alt={feature.title}
                            class="absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ease-in-out {i ===
                            currentImageIndex
                                ? 'opacity-100 z-10'
                                : 'opacity-0 z-0'}"
                        />
                    {/if}
                {/each}
            </div>
        </div>
    </div>
</div>
