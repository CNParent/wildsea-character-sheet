<script>
    import TextArea from './TextArea.svelte';
    import TextInput from './TextInput.svelte';

    export let model;

</script>

<TextInput bind:content={model.name} label='Name' />
<TextInput bind:content={model.bloodline} label='Bloodline' />
<TextInput bind:content={model.origin} label='Origin' />
<TextInput bind:content={model.post} label='Post' />
<hr />
<TextArea bind:content={model.info} label='Info' />
