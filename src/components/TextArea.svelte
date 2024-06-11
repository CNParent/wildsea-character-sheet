<script>
    import { afterUpdate } from 'svelte';

    export let content = '';
    export let highlight = '';

    let active = false;
    let control;
    $:regexp = new RegExp(highlight, 'gi');
    $:matches = [...content.matchAll(regexp)];
    $:firstFragment = matches.length == 0 ? '' : content.substring(0, matches[0].index);
    $:lastFragment = matches.length == 0 ? '' : content.substring(matches[matches.length - 1].index + matches[matches.length - 1][0].length);

    function resizeInput() {
        if (control) 
            control.style.height = `${control.scrollHeight + 2}px`;
    }

    afterUpdate(() => {
        if (active) control.focus();
    });
</script>

{#if active}
<span class="py-2 font-weight-bold"><slot></slot></span>
<textarea 
    bind:this={control} 
    bind:value={content}
    on:blur={() => active = false}
    on:focus={resizeInput}
    on:keyup={resizeInput}
    class="flex-grow-1 form-control"></textarea>
{:else}
<span class="py-2 font-weight-bold"><slot></slot></span>
<button class="btn btn-light border text-left align-top wrap w-100" style="min-height: 2.5em;" on:click={() => active = true}>
    {#if matches.length == 0}
        {content}
    {:else}
        {#each matches as match, i}
            {#if i == 0}{firstFragment}{/if}<span class="bg-info">{match[0]}</span>{#if i < matches.length - 1}{content.substring(match.index + match[0].length, matches[i + 1].index)}{:else}{lastFragment}{/if}
        {/each}
    {/if}
</button>
{/if}