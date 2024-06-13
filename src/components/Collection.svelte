<script>
    import ListItem from "./ListItem.svelte";
    import TagInput from "./TagInput.svelte";
    import Track from "./Track.svelte";

    import collectionTypes from "../lib/collectionTypes.js";
    import listActions from "../lib/listActions.js";
    import track from "../models/track.js";

    export let model = [];
    export let capacity;
    export let update;
    export let itemType = collectionTypes.simple;

    function add() {
        if (capacity && model.length == capacity) return;

        if (itemType == collectionTypes.simple) model.push('click to edit');
        else if (itemType == collectionTypes.track) model.push(track());

        model = model;

        if (update) update();
    }

    function move(n, item) {
        listActions.move(model, n, item);
        model = model;

        if (update) update();
    }

    function remove(item) {
        listActions.remove(model, item);
        model = model;

        if (update) update();
    }

</script>
{#if itemType != collectionTypes.simple}
<div class="d-flex align-items-end mb-1">
    {#if capacity}
    <span title="capacity" class="ml-auto btn btn-light">{model.length}/{capacity}</span>
    {/if}
    <button on:click={add} class:ml-1={capacity} class:ml-auto={!capacity} class="btn btn-dark">Add</button>
</div>
{/if}
{#each model as item}
        {#if itemType == collectionTypes.track}
            <ListItem item={item} move={move} remove={remove}>
                <Track model={item}></Track>
            </ListItem>
        {:else}
            <TagInput bind:content={item} remove={() => remove(item)} />
        {/if}
{/each}
{#if itemType == collectionTypes.simple && (model.length < capacity || !capacity)}
<button on:click={add} class="btn btn-light m-1 badge">add</button>
{/if}
