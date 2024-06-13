<script>
    export let title;
    export let open = false;
</script>

<div class="col-lg-6 col-12 p-1">
    <button on:click={() => open = !open} class="btn btn-light border w-100 text-left align-top">{title}</button>
    {#if open}
    <div class="container-fluid m-0 p-0">
        <div class="card">
            <div class="card-body">
                <slot></slot>
            </div>
        </div>
    </div>
    {/if}
</div>
