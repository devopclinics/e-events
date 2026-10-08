(()=>{
  'use strict';
  const highlightRoot=document.getElementById('programme');
  const highlightControls=highlightRoot?.querySelector('[data-highlight-controls]');
  if(highlightControls){
    highlightControls.hidden=false;
    highlightControls.querySelectorAll('[data-highlight-filter]').forEach(button=>button.addEventListener('click',()=>{
      highlightControls.querySelectorAll('button').forEach(other=>other.setAttribute('aria-pressed',String(other===button)));
      highlightRoot.querySelectorAll('[data-session]').forEach(card=>{
        card.hidden=button.dataset.highlightFilter!=='all'&&card.dataset.category!==button.dataset.highlightFilter;
        if(card.hidden)card.querySelectorAll('details[open]').forEach(detail=>detail.open=false);
      });
    }));
  }
  document.querySelectorAll('.mobile-menu a').forEach(a=>a.addEventListener('click',()=>a.closest('details').open=false));
  const root=document.getElementById('programme');
  if(!root)return;
  const controls=root.querySelector('[data-programme-controls]');
  if(!controls)return;
  const day=root.querySelector('#programme-day'),track=root.querySelector('#programme-track'),audience=root.querySelector('#programme-audience'),search=root.querySelector('#programme-search');
  const more=root.querySelector('#programme-more'),empty=root.querySelector('#programme-empty'),count=root.querySelector('#programme-count');
  const cards=[...root.querySelectorAll('[data-session]')].map(el=>({el,day:el.dataset.day,track:el.dataset.track,audience:el.dataset.audience,text:el.textContent.toLocaleLowerCase()}));
  let limit=12;
  function render(reset=true){
    if(reset)limit=12;
    const query=search.value.trim().toLocaleLowerCase();
    const matches=cards.filter(c=>(day.value==='all'||c.day===day.value)&&(!track.value||c.track===track.value)&&(!audience.value||c.audience===audience.value)&&(!query||c.text.includes(query)));
    const visible=new Set(matches.slice(0,limit));
    cards.forEach(c=>{c.el.hidden=!visible.has(c);if(c.el.hidden)c.el.querySelectorAll('details[open]').forEach(d=>d.open=false)});
    more.hidden=matches.length<=limit;empty.hidden=matches.length!==0;
    count.textContent=`Showing ${Math.min(limit,matches.length)} of ${matches.length} sessions`;
  }
  controls.hidden=false;
  for(const el of [day,track,audience])el.addEventListener('change',()=>render());
  search.addEventListener('input',()=>render());
  more.addEventListener('click',()=>{limit+=12;render(false)});
  document.querySelectorAll('[data-track-jump]').forEach(a=>a.addEventListener('click',()=>{day.value='all';track.value=[...track.options].some(o=>o.value===a.dataset.trackJump)?a.dataset.trackJump:'';audience.value='';search.value='';render()}));
  render();
})();
