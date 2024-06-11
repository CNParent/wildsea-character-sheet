<script>

	import character from "./models/character.js"
	import { theme } from './lib/styles.js'

	import Bio from "./components/Bio.svelte";
	import Details from "./components/Details.svelte";
	import Navbar from "./components/Navbar.svelte";
    import Notes from "./components/Notes.svelte";

	let model = character();

</script>

<svelte:head>
	{#if theme == 'dark'}
	<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/vinorodrigues/bootstrap-dark@0.6.1/dist/bootstrap-dark.min.css">
	{:else}
	<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@4.6.1/dist/css/bootstrap.min.css" integrity="sha384-zCbKRCUGaJDkqS1kPbPd7TveP5iyJE0EjAuZQTgFLD2ylzuqKfdKlfG/eSrtxUkn" crossorigin="anonymous">
	{/if}
</svelte:head>

<main id="app">
	<Navbar bind:model={model}></Navbar>
	<div class="row m-2">
		<Details open={true} title="Character"><Bio model={model} /></Details>
		<Details open={false} title="Notes"><Notes notes={model.notes} /></Details>
	</div>
</main>
