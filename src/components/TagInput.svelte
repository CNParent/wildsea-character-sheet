<script>
    import { afterUpdate } from 'svelte';

    export let content = '';
    export let remove = () => {};

    let active = false;
    let shouldFocus = false;
    let control;

    let activate = () => {
        active = true;
        shouldFocus = true;
    }

    afterUpdate(() => {
        if (!control || !shouldFocus) return; 
        
        control.focus();
        shouldFocus = false;
    });
</script>

{#if active}
    <div class="mt-1 d-flex flex-grow-1">
        <input bind:this={control} class="form-control" bind:value={content}>
        <button class="btn btn-light border" on:click={() => active = false}>&check;</button>
        <button class="btn btn-danger border" on:click={() => remove()}>&cross;</button>
    </div>
{:else}
    <button class="text-left flex-grow-1 btn btn-light mt-1" style="min-height: 2.2em" on:click={() => activate()}>{content}</button>
{/if}

