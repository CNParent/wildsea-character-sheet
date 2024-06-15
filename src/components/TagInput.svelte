<script>
    import { afterUpdate } from 'svelte';

    export let content = '';
    export let remove = () => {};

    let active = false;
    let control;

    function handleApply() {
        active = false;
        if (!content) content = "click to edit";
    }

    afterUpdate(() => {
        if (control) control.focus();
    });
</script>

{#if active}
    <div class="mt-1 d-flex flex-grow-1">
        <input bind:this={control} class="form-control" bind:value={content}>
        <button class="btn btn-light border" on:click={handleApply}>&check;</button>
        <button class="btn btn-danger border" on:click={() => remove()}>&cross;</button>
    </div>
{:else}
    <button class="text-left flex-grow-1 btn btn-light mt-1" on:click={() => active = true}>{content}</button>
{/if}

