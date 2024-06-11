<script>
    import TextArea from './TextArea.svelte';
    import TextInput from './TextInput.svelte';

    export let model;

</script>

<TextInput bind:content={model.name}>Name</TextInput>
<TextInput bind:content={model.bloodline}>Bloodline</TextInput>
<TextInput bind:content={model.origin}>Origin</TextInput>
<TextInput bind:content={model.post}>Post</TextInput>
<hr />
<TextArea bind:content={model.info}>Info</TextArea>
