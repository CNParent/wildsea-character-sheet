<script>
    const maxMark = 2;

    import mire from "../models/mire.js";

    export let model = mire();
    export let remove;

    let editing = false;

    $:arr = [...new Array(maxMark)];

    function handleClick(i) {
        model.mark = model.mark == i + 1 ? i : i + 1;
    }
</script>

<div class="d-flex mt-1">
    {#if editing}
    <input class="form-control" bind:value={model.name} />
    <button on:click={() => editing = false} class="btn btn-light">&check;</button>
    <button on:click={() => remove(model)} class="btn btn-danger">&cross;</button>
    {:else}
    <button on:click={() => editing = true} class="text-left border-right flex-grow-1 btn btn-light">{model.name}</button>
    {/if}
    <div class="align-self-center ml-1 flex-shrink-0" style="width: 4.0em;">
        {#each arr as x,i}
        <button on:click={() => handleClick(i)} class="bubble btn border border-dark" class:btn-dark={model.mark > i} class:btn-light={model.mark <= i}>
        </button>
        {/each}
    </div>
</div>