<script>
    import Ability from "./Ability.svelte";

    export let model;
    export let update;
</script>

<Ability bind:score={model.abilities.strength}>Strength</Ability>
<Ability bind:score={model.abilities.dexterity}>Dexterity</Ability>
<Ability bind:score={model.abilities.constitution} {update}>Constitution</Ability>
<Ability bind:score={model.abilities.intelligence}>Intelligence</Ability>
<Ability bind:score={model.abilities.wisdom}>Wisdom</Ability>
<Ability bind:score={model.abilities.charisma}>Charisma</Ability>
