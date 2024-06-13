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
    <div class="m-1 d-flex">
        <input bind:this={control} class="flex-grow-1 form-control m-2" bind:value={content}>
        <div class="btn-group">
            <button class="btn btn-light border" on:click={handleApply}>&check;</button>
            <button class="btn btn-danger border" on:click={() => remove()}>&cross;</button>
        </div>
    </div>
{:else}
    <button class="badge btn btn-light m-1" on:click={() => active = true}>{content}</button>
{/if}
