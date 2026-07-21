export function graphUiThemeScript(): string {
  return String.raw`
const THEME_KEY='llm-wiki:theme';function applyTheme(theme){document.body.classList.toggle('theme-light',theme==='light')}applyTheme(localStorage.getItem(THEME_KEY)||'dark');window.addEventListener('storage',event=>{if(event.key===THEME_KEY&&event.newValue)applyTheme(event.newValue)});
`;
}
