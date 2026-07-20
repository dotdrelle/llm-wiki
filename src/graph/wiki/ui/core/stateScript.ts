export function graphUiStateScript(): string {
  return String.raw`
const colors=['#4d9cff','#a75ee8','#34c4ca','#66bd4b','#f1b52f','#ed7550','#dc5277','#7895bb','#9d70b9'];
let data=null,view='map',selected=null,selectedCommunity=null,transform=d3.zoomIdentity,mapViewBox=null;
const focusHistory=[];
const canvas=document.querySelector('#canvas'),inspector=document.querySelector('#inspector'),summary=document.querySelector('#summary'),title=document.querySelector('#view-title');
`;
}
