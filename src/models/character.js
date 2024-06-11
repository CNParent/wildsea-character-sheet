const character = () => ({
    name: '',
    level: 1,
    experience: 0,
    hp: {
        current: 0,
        max: 0
    },
    abilities: {
        strength: 0,
        dexterity: 0,
        constitution: 0,
        wisdom: 0,
        intelligence: 0,
        charisma: 0
    },
    equipment: [],
    wounds: [],
    info: '',
    notes: []
});

export default character;
