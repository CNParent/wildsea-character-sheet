<script>
    import track from "../models/track.js";
    import TextArea from "./TextArea.svelte";
    import TextInput from "./TextInput.svelte";

    export let model = track();
    export let remove = () => {};
    export let move = (n) => {};

    let editing = false;

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
        if (model.mark < model.burn) model.mark = model.burn;
    }

    function resize(i) {
        if (model.size + i < 1) return;
        if (model.size + i > 8) return;

        model.size += i;

        if (model.mark > model.size) model.mark = model.size;
        if (model.burn > model.size) model.burn = model.size;
    }
</script>

{#if editing}
<div class="col-12 border p-3 mt-1">
    <div>
        <TextInput bind:content={model.name} label='Name' />
    </div>
    <div>
        <div>
            {#each arr as x,i}
            <button on:click={() => handleClick(i)} class="bubble btn border border-dark" class:btn-dark={model.mark > i} class:btn-light={model.mark <= i}>
                {#if model.burn > i}
                &cross;
                {/if}
            </button>
            {/each}
        </div>
        <div class="mt-1">
            <div class="btn-group">
                <button on:click={() => resize(-1)} class="btn border btn-light" title="Decrease burn">Size-</button>
                <button on:click={() => resize(1)} class="btn border btn-light" title="Increase burn">Size+</button>
            </div>
            <div class="btn-group ml-1">
                <button on:click={() => burn(-1)} class="btn border btn-light" title="Decrease burn">Burn-</button>
                <button on:click={() => burn(1)} class="btn border btn-light" title="Increase burn">Burn+</button>
            </div>
        </div>
    </div>
    <div class="mt-1 flex-grow-1">
        <TextArea bind:content={model.description} />
    </div>
    <div class="mt-1 flex-grow 1">
        <button on:click={() => editing = false} class="btn border btn-light">Done</button>
        <button on:click={() => move(-1)} class="btn border btn-light">&uarr;</button>
        <button on:click={() => move(1)} class="btn border btn-light">&darr;</button>
        <button on:click={() => { editing = false; remove(); }} class="btn border btn-danger">Remove</button>
    </div>
</div>
{:else}
<div class="d-flex flex-grow-1 mt-1">
    <button on:click={() => editing = true} class="text-left flex-grow-1 btn btn-light" style="min-height: 2.2em">{model.name}</button>
    <div class="align-self-center ml-1 flex-shrink-0">
        {#each arr as x,i}
        <button on:click={() => handleClick(i)} class="bubble btn border border-dark" class:btn-dark={model.mark > i} class:btn-light={model.mark <= i}>
            {#if model.burn > i}
            &cross;
            {/if}
        </button>
        {/each}
    </div>
</div>
{/if}