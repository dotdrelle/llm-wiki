export function graphUiThemeScript(): string {
  return String.raw`
const THEME_KEY='llm-wiki:theme',themeToggle=document.querySelector('#theme-toggle');function applyTheme(theme,persist=true){const light=theme==='light';document.body.classList.toggle('theme-light',light);themeToggle.textContent=light?'☾':'☀';themeToggle.title=light?'Switch to dark theme':'Switch to light theme';if(persist)localStorage.setItem(THEME_KEY,theme)}applyTheme(localStorage.getItem(THEME_KEY)||localStorage.getItem('llm-wiki:graph:theme')||'dark');themeToggle.addEventListener('click',()=>applyTheme(document.body.classList.contains('theme-light')?'dark':'light'));window.addEventListener('storage',event=>{if(event.key===THEME_KEY&&event.newValue)applyTheme(event.newValue,false)});
`;
}
