<script>
    import ListItem from "./ListItem.svelte";
    import TextInput from "./TextInput.svelte";
    import Track from "./Track.svelte";

    import collectionTypes from "../lib/collectionTypes.js";
    import listActions from "../lib/listActions.js";
    import track from "../models/track.js";

    export let model = [];
    export let capacity = 10;
    export let update;
    export let itemType = collectionTypes.simple;

    function add() {
        if (model.length == capacity) return;

        if (itemType == collectionTypes.simple) model.push('');
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
<div class="d-flex align-items-end m-1">
    <span title="capacity" class="ml-auto btn btn-light">{model.length}/{capacity}</span>
    <button on:click={add} class="ml-1 btn btn-dark">Add</button>
</div>
{#each model as item}
    <ListItem item={item} move={move} remove={remove}>
        {#if itemType == collectionTypes.track}
        <Track model={item}></Track>
        {:else}
        <TextInput bind:value={item}></TextInput>
        {/if}
    </ListItem>
{/each}
