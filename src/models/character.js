import languages from "./languages.js";
import skills from "./skills.js";

const character = () => ({
    name: '',
    bloodline: 'Ardent',
    origin: 'Spit-Born',
    post: 'Alchemist',
    info: '',
    edges: [],
    milestones: {
        minor: [],
        major: []
    },
    drives: [],
    mires: [],
    skills: skills(),
    languages: languages(),
    resources: {
        salvage: [],
        specimens: [],
        whispers: [],
        charts: []
    },
    aspects: [],
    tracks: [],
    notes: []
});

export default character;
