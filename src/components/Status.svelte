<script>

    import Abilities from "./Abilities.svelte";
    import HitPoints from "./HitPoints.svelte";

    export let model;
    export let update;
</script>

<HitPoints hp={model.hp} />
<hr />
<Abilities model={model} {update} />