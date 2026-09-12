export function graphUiStateScript(): string {
  return String.raw`
const colors=['#4d9cff','#a75ee8','#34c4ca','#66bd4b','#f1b52f','#ed7550','#dc5277','#7895bb','#9d70b9'];
let data=null,view='map',selected=null,selectedCommunity=null,groupAxis='concept';
// The top search is a RELATION filter, applied server-side before the
// projection (leaf edges, community edges and all axis groupings then agree).
// Kept here so every re-render — type filters, grouping axis, revisions —
// re-fetches with the same query instead of silently dropping it.
let searchQuery='';
const focusHistory=[];
const canvas=document.querySelector('#canvas'),inspector=document.querySelector('#inspector'),summary=document.querySelector('#summary'),title=document.querySelector('#view-title');
`;
}
