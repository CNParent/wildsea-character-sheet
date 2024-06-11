<script>
    import Note from '../components/Note.svelte'

    export let notes;

    const actions = {
        delete: (note) => {
            if (!confirm(`Delete ${note.title}?`)) return;

            let i = notes.indexOf(note);
            notes.splice(i, 1);
            notes = notes;
        }
    }

    let filter = '';
    let menu = '';
    $: filtered = notes.filter(x => 
        !filter || 
        x.title.toLowerCase().includes(filter.toLowerCase()) || 
        x.content.toLowerCase().includes(filter.toLowerCase()));

    function add() {
        notes.splice(0, 0, { 
            id: crypto.randomUUID(),
            title: 'New note', 
            date: (new Date()).toISOString(), 
            content: 'Enter your notes here' 
        });

        notes = notes;
    }

    function clearMenu(e) {
        if (e.relatedTarget?.className.includes('dropdown-item')) return;
        menu = '';
    }

    function sort(method) {
        if (method == 'alpha') notes.sort((a,b) => a.title.localeCompare(b.title));
        else if (method == 'ralpha') notes.sort((a,b) => b.title.localeCompare(a.title));
        else if (method == 'oldest') notes.sort((a,b) => a.date > b.date);
        else if (method == 'newest') notes.sort((a,b) => a.date < b.date);

        notes = notes;
    }

    $: {
        notes.forEach(note => {
            if (!note.id) note.id = crypto.randomUUID();
        });
    }
</script>

<div class="d-flex">
    <button on:click={add} class="btn btn-light border mb-1 mr-1">Add note</button>
    <div class="dropdown">
        <button on:blur={clearMenu} on:click={() => menu = 'sort'} class="dropdown-toggle btn btn-light border mb-1">Sort</button>
        <div class="dropdown-menu" style="{`display: ${menu == 'sort' ? 'block' : 'none'}`}">
            <button on:blur={clearMenu} on:click={() => sort("newest")} class="dropdown-item">Newest</button>
            <button on:blur={clearMenu} on:click={() => sort("oldest")} class="dropdown-item">Oldest</button>
            <button on:blur={clearMenu} on:click={() => sort("alpha")} class="dropdown-item">A &rarr; Z</button>
            <button on:blur={clearMenu} on:click={() => sort("ralpha")} class="dropdown-item">Z &rarr; A</button>
        </div>
    </div>
</div>
<div class="d-flex">
    <input class="form-control" placeholder="filter" bind:value={filter}>
</div>
<div class="row mt-2">
    {#each filtered as note (note.id)}
    <Note note={note} actions={actions} highlight={filter} />
    {/each}
</div>
