<script>
    const maxMires = 4;

    import Mire from "./Mire.svelte";
    import mire from "../models/mire.js";

    export let model = [mire()];

    function add() {
        model.push(mire('click to edit'));
        model = model;
    }

    function remove(item) {
        let i = model.indexOf(item);
        model.splice(i, 1);
        model = model;
    }
</script>

{#if model.length < maxMires}
<button on:click={add} class="btn btn-light badge">Add</button>
{/if}
{#each model as item}
<Mire model={item} remove={remove} />
{/each}
