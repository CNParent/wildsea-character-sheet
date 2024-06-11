<script>
    import Collection from "./Collection.svelte";

    export let model;

    function update() {
        model.equipment = model.equipment;
        model.wounds = model.wounds;
    }

    $:totalItemSize = model.equipment.reduce((a,b) => a + b.size, 0);
    $:totalWoundSize = model.wounds.reduce((a,b) => a + b.size, 0);
    $:maxWoundSize = 10 + model.abilities.constitution;
    $:maxItemSize = 10 + model.abilities.constitution - totalWoundSize;

    $:itemBtnStyle = totalItemSize > maxItemSize ? 'btn-danger' :
        totalWoundSize > 0 ? 'btn-warning' : 
        'btn-dark';

    $:woundBtnStyle = totalWoundSize >= maxWoundSize ? 'btn-danger' :
        totalWoundSize > 0 ? 'btn-warning' :
        'btn-dark';

</script>
<Collection model={model.equipment} capacity={maxItemSize} btnStyle={itemBtnStyle} {update} title="Equipment"/>
<hr/>
<Collection model={model.wounds} capacity={maxWoundSize} btnStyle={woundBtnStyle} {update} title="Wounds"/>
