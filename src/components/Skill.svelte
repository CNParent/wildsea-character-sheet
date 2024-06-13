<script>
    const maxLevel = 3;

    import skill from "../models/skill.js";

    export let model = skill();

    $:arr = [...new Array(maxLevel)];

    function handleClick(i) {
        model.level = model.level == i + 1 ? i : i + 1;
    }
</script>

<div class="d-flex">
    <span class="align-self-center text-right border-right pr-1 py-2 font-weight-bold" style="width: 7.5em; height: 2.5em;">{model.name}</span>
    <div class="align-self-center ml-1">
        {#each arr as x,i}
        <button on:click={() => handleClick(i)} class="bubble btn border border-dark" class:btn-dark={model.level > i} class:btn-light={model.level <= i}>
        </button>
        {/each}
    </div>
</div>