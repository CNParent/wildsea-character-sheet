<script>

	import character from "./models/character.js"
	import { theme } from './lib/styles.js'
	import collectionTypes from "./lib/collectionTypes.js";

	import Bio from "./components/Bio.svelte";
	import Collection from "./components/Collection.svelte";
	import Details from "./components/Details.svelte";
	import Navbar from "./components/Navbar.svelte";
    import Notes from "./components/Notes.svelte";
	import Skill from "./components/Skill.svelte";
    import TextInput from "./components/TextInput.svelte";

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
		<Details title="Edges" size="col-lg-3 col-xs-6">
			<Collection
				model={model.edges}
				capacity={3}
				itemType={collectionTypes.simple} />
		</Details>
		<Details title="Drives" size="col-lg-3 col-xs-6">
			<Collection
				model={model.drives}
				capacity={4}
				itemType={collectionTypes.simple} />
		</Details>
		<Details title="Major Milestones" size="col-lg-3 col-xs-6">
			<Collection model={model.milestones.major} itemType={collectionTypes.simple} />
		</Details>
		<Details title="Minor Milestones" size="col-lg-3 col-xs-6">
			<Collection model={model.milestones.major} itemType={collectionTypes.simple} />
		</Details>
		<Details title="Skills" size="col-lg-3 col-xs-6">
			<div class="row">
				{#each model.skills as skill}
				<Skill model={skill} />
				{/each}
			</div>
		</Details>
		<Details title="Languages" size="col-lg-3 col-xs-6">
			<div class="row">
				{#each model.languages as language}
				<Skill model={language} />
				{/each}
			</div>
		</Details>
		<Details title="Aspects">
			<Collection 
				model={model.aspects} 
				capacity={7} 
				itemType={collectionTypes.track}/>
		</Details>
		<Details title="Temporary Tracks">
			<Collection 
				model={model.tracks} 
				capacity={3} 
				itemType={collectionTypes.track}/>
		</Details>
		<Details title="Notes"><Notes notes={model.notes} /></Details>
	</div>
</main>
