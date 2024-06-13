<script>
    import track from "../models/track.js";
    import TextArea from "./TextArea.svelte";
    import TextInput from "./TextInput.svelte";

    export let model = track();

    $:arr = [...new Array(model.size)];
    
    function burn(value) {
        if (model.burn + value < 0 || model.burn + value > model.size) return;

        model.burn += value;
        model.mark += value;

        if (model.mark < 0) model.mark = 0;
        if (model.mark > model.size) model.mark = model.size;
    }

    function handleClick(i) {
        model.mark = model.mark == i + 1 ? i : i + 1;
    }

    function resize(i) {
        if (model.size + i < 1) return;
        if (model.size + i > 8) return;

        model.size += i;

        if (model.mark > model.size) model.mark = model.size;
        if (model.burn > model.size) model.burn = model.size;
    }
</script>

<div class="flew-grow-1">
    <div>
        <TextInput bind:content={model.name} label='Name' />
    </div>
    <div class="m-1">
        {#each arr as x,i}
        <button on:click={() => handleClick(i)} class="bubble btn border border-dark" class:btn-dark={model.mark > i} class:btn-light={model.mark <= i}>
            {#if model.burn > i}
            &cross;
            {/if}
        </button>
        {/each}
    </div>
    <div class="d-flex m-1">
        <div class="btn-group">
            <button on:click={() => resize(-1)} class="btn border btn-light" title="Decrease burn">Size-</button>
            <button on:click={() => resize(1)} class="btn border btn-light" title="Increase burn">Size+</button>
        </div>
        <div class="btn-group ml-1">
            <button on:click={() => burn(-1)} class="btn border btn-light" title="Decrease burn">Burn-</button>
            <button on:click={() => burn(1)} class="btn border btn-light" title="Increase burn">Burn+</button>
        </div>
    </div>
    <TextArea bind:content={model.description} />
</div>