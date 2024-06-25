<script>
    import { afterUpdate } from 'svelte';

    export let content = '';
    export let label;

    let active = false;
    let control;

    afterUpdate(() => {
        if (active) control.focus();
    });
</script>

<div class="d-flex mb-1 border-bottom" style="min-height: 2.5em;">
{#if active}
    {#if label}
    <span class="align-self-center text-right mr-1 py-2 font-weight-bold" style="width: 5.5em; height: 2.5em;">{label}</span>
    {/if}
    <input bind:this={control} class="flex-grow-1 form-control" bind:value={content} on:blur={() => active = false}>
{:else}
    {#if label}
    <span class="align-self-center text-right border-right pr-1 py-2 font-weight-bold" style="width: 5.5em;">{label}</span>
    {/if}
    <button class="flex-grow-1 btn btn-light text-left" style="min-height: em-1" on:click={() => active = true}>{content}</button>
{/if}
</div>