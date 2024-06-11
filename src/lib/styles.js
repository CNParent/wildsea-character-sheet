const params = new URLSearchParams(window.location.search);
const theme = params.get('theme') ?? 
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

function setTheme(name) {
    window.location.search = `theme=${name}`;
}

export {theme, setTheme};
