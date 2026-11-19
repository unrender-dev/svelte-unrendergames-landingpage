<script>
    import FeatureCard from "./FeatureCard.svelte";

    export let features = [];
    export let hoverBgClass = "hover:bg-[#1e1b4b] focus:bg-[#1e1b4b]";
    export let gapClass = "gap-3 md:gap-4 lg:gap-6";

    const getPositionClass = (index) => {
        switch (index) {
            case 0:
                return "top-0 left-0";
            case 1:
                return "top-0 right-0";
            case 2:
                return "bottom-0 left-0";
            case 3:
                return "bottom-0 right-0";
            default:
                return "top-0 left-0";
        }
    };
</script>

<div class="grid grid-cols-1 sm:grid-cols-2 {gapClass} w-full">
    {#each features as feature, index}
        <FeatureCard
            {feature}
            positionClass={getPositionClass(index)}
            {hoverBgClass}
        />
    {/each}
</div>
