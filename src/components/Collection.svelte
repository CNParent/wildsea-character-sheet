<script>
    import Item from "./Item.svelte";
    import ListItem from "./ListItem.svelte";
    import listActions from "../lib/listActions.js";

    export let model;
    export let capacity;
    export let title;
    export let btnStyle;
    export let update;

    function add() {
        model.push({ name: '', size: 1 });
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

    $:totalSize = model.reduce((a,b) => a + b.size, 0);

</script>
<div class="d-flex align-items-end m-1">
    <span>{title}</span>
    <span title="capacity" class="ml-auto btn {btnStyle}">{totalSize}/{capacity}</span>
    <button on:click={add} class="ml-1 btn btn-dark">Add</button>
</div>
{#each model as item}
    <ListItem item={item} move={move} remove={remove}>
        <Item bind:item={item}></Item>
    </ListItem>
{/each}
