<script>
    export let hp;

    function handleCurrent(e) {
        hp.current += e.shiftKey ? -1 : 1;
    }

    function handleMax(e) {
        hp.max += e.shiftKey ? -1 : 1;
    }
</script>

<div class="d-flex">
    <h3><button class="btn-dark badge" on:click={handleCurrent}>{hp.current}</button></h3>
    <span class="ml-2 mr-2 align-self-center">/</span>
    <h3><button class="btn-dark badge" on:click={handleMax}>{hp.max}</button></h3>
    <span class="ml-2 align-self-center">Hit Points</span>
    <div class="btn-group ml-auto">
        <button on:click={() => handleCurrent({shiftKey: false})} class="btn btn-dark align-self-center">+</button>
        <button on:click={() => handleCurrent({shiftKey: true})} class="btn btn-dark align-self-center">-</button>
    </div>
    <div class="btn-group ml-1">
        <button on:click={() => handleMax({shiftKey: false})} class="btn btn-dark align-self-center">+max</button>
        <button on:click={() => handleMax({shiftKey: true})} class="btn btn-dark align-self-center">-max</button>
    </div>
</div>
