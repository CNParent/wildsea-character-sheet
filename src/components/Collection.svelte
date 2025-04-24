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
    export let afterRemove;
    export let allowAdd = true;

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

        if (afterRemove) afterRemove(item);
        if (update) update();
    }

</script>

{#if (!capacity || model.length < capacity) && allowAdd}
<button on:click={add} class="btn btn-light badge">Add</button>
{/if}
{#each model as item}
        {#if itemType == collectionTypes.track}
            <ListItem item={item} move={move} remove={remove}>
                <Track model={item}></Track>
            </ListItem>
        {:else}
            <div class="d-flex">
                <TagInput bind:content={item} remove={() => remove(item)} />
            </div>
        {/if}
{/each}
