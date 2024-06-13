<script>
    export let move;
    export let remove;
    export let item;

</script>

<div class="d-flex m-1 align-self-start p-1 border">
    <div class="flex-grow-1 mr-1 p-1"><slot></slot></div>
    <div class="ml-auto p-1">
        <div>
            <button on:click={() => remove(item)} class="btn btn-danger" style="width: 2.5em;">&cross;</button>
        </div>
        <div>
            <button on:click={() => move(-1, item)} class="btn btn-light border-dark" style="width: 2.5em;">&uarr;</button>
        </div>
        <div>
            <button on:click={() => move(1, item)} class="btn btn-light border-dark" style="width: 2.5em;">&darr;</button>
        </div>
    </div>
</div>
