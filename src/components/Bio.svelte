<script>
    import TextArea from './TextArea.svelte';
    import TextInput from './TextInput.svelte';

    export let model;

</script>

<TextInput bind:content={model.name}>Name</TextInput>
<TextInput bind:content={model.experience}>Experience</TextInput>
<TextInput bind:content={model.level}>Level</TextInput>
<hr />
<TextArea bind:content={model.info}>Info</TextArea>
