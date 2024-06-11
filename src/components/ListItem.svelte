<script>
    export let move;
    export let remove;
    export let item;

</script>

<div class="d-flex m-1 align-self-start">
    <div class="flex-grow-1 d-flex mr-1"><slot></slot></div>
    <div class="align-self-start ml-auto">
        <div class="btn-group">
            <button on:click={() => move(-1, item)} class="btn btn-light border-dark">&uarr;</button>
            <button on:click={() => move(1, item)} class="btn btn-light border-dark">&darr;</button>
        </div>
        <button on:click={() => remove(item)} class="btn btn-danger">Delete</button>
    </div>
</div>
