<script>
    import { afterUpdate } from 'svelte'
    import dateUtil from '../lib/dateUtil.js'
    import TextArea from './TextArea.svelte'

    export let actions;
    export let note;
    export let highlight;

    let editTitle = false;
    let input;
    $: collapse = highlight == '';
    $: dateValue = new Date(note.date);

    afterUpdate(() => {
        if (input) input.focus();
    });
</script>

{#if collapse}
<div class="col-12 d-flex">
    <h4 class="flex-grow-1 m-0"><button on:click={() => collapse = false} class="badge btn btn-light w-100 text-left" style="min-height: 2.2em;">{note.title}</button></h4>
    <button on:click={() => collapse = false} class="badge btn btn-light border ml-1 p-2">{dateUtil.shortDate(dateValue)}</button>
</div>
{:else}
<div class="col-12">
    <div class="card">
        <div class="card-body">
            <div class="d-flex">
                {#if editTitle}
                <input class="form-control" on:blur={() => editTitle = false} bind:this={input} bind:value={note.title}>
                {:else}
                <button on:click={() => editTitle = true} class="btn btn-light w-100 text-left font-weight-bold" style="min-height: 2.2em;">{note.title}</button>
                {/if}
                <button on:click={() => collapse = true} class="badge btn btn-light border ml-1 p-2">hide</button>
                <button on:click={() => actions.delete(note)} class="badge btn btn-light border ml-1 p-2">delete</button>
            </div>
            <div class="d-flex">
                <TextArea highlight={highlight} bind:content={note.content} />
            </div>
        </div>
    </div>
</div>
{/if}