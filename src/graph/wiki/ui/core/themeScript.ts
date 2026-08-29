export function graphUiThemeScript(): string {
  return String.raw`
const THEME_KEY='llm-wiki:theme';function applyTheme(theme){const selected=theme==='dark'?'dark':'light';document.documentElement.classList.toggle('theme-dark',selected==='dark');document.documentElement.classList.toggle('theme-light',selected==='light')}applyTheme(localStorage.getItem(THEME_KEY)||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));window.addEventListener('storage',event=>{if(event.key===THEME_KEY&&event.newValue)applyTheme(event.newValue)});
`;
}
