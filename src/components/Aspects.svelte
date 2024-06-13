<script>
    import Collection from "./Collection.svelte";
    import ListItem from "./ListItem.svelte";

    export let model;


</script>

<div class="col-12 flex-grow">
    <Collection bind:model={model}></Collection>
</div>