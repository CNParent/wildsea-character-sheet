<script>
    export let score;
    export let update;

    function handleClick(e) {
        score += e.shiftKey ? -1 : 1;
        if (score < 0) score = 10;
        if (score > 10) score = 0;

        if (!update) return;
        update();
    }

    $:scoreText = score > 0 ? `+${score}` : `${score}`;
</script>

<div class="d-flex">
    <h4><button class="btn btn-dark badge" style="width: 3.0em" on:click={handleClick}>{scoreText}</button></h4>
    <span class="align-self-center ml-1"><slot></slot></span>
</div>