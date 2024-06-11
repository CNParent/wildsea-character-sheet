<script>
    import { afterUpdate } from 'svelte';

    export let content = '';

    let active = false;
    let control;

    afterUpdate(() => {
        if (active) control.focus();
    });
</script>

{#if active}
<div class="d-flex mb-1 border-bottom">
    <span class="align-self-center text-right mr-1 py-2 font-weight-bold" style="width: 5.5em; height: 2.5em;"><slot></slot></span>
    <input bind:this={control} class="flex-grow-1 form-control" bind:value={content} on:blur={() => active = false}>
</div>
{:else}
<div class="d-flex mb-1 border-bottom">
    <span class="align-self-center text-right border-right pr-1 py-2 font-weight-bold" style="width: 5.5em;"><slot></slot></span>
    <button class="flex-grow-1 btn btn-light text-left" on:click={() => active = true}>{content}</button>
</div>
{/if}