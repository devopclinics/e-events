import { memo, useEffect, useId, useState } from 'react'
import { bounds, GROUP_COLORS, keyOf, objects, sizeOf, union } from './model.mjs'

function Decor({item}) {
  const {width:w,height:h,type}=item,cx=w/2,cy=h/2
  const rounded=['tree','column','water','power'].includes(type)
  return <>
    {type==='label'?<rect width={w} height={h} rx="4" fill={item.color||'#edf0f3'} fillOpacity=".85"/>:rounded?<ellipse cx={cx} cy={cy} rx={w/2} ry={h/2} fill={item.color||'#dce5ec'} stroke="#6e8291" strokeWidth="1.3"/>:<rect width={w} height={h} rx={['wall','window','aisle'].includes(type)?1:7} fill={item.color||'#e2e8f0'} fillOpacity={type==='aisle'?.55:1} stroke="#7e909e" strokeWidth={type==='wall'?2:1} strokeDasharray={['garden','parking','aisle'].includes(type)?'6 4':undefined}/>}
    {type==='tent'&&<path d={`M0 ${h} L${cx} 0 L${w} ${h} M0 0 L${w} ${h} M${w} 0 L0 ${h}`} fill="none" stroke="#9e9b88" strokeWidth="1"/>}
    {type==='stage'&&<><path d={`M10 ${h-10} H${w-10}`} stroke="#719092" strokeWidth="4"/><path d={`M${w-40} ${h}v14h30v-14`} fill="#dde9e9" stroke="#8eaaac"/></>}
    {type==='stairs'&&Array.from({length:6},(_,i)=><line key={i} x1="8" y1={(i+1)*h/7} x2={w-8} y2={(i+1)*h/7} stroke="#8fa0b0"/>)}
    {type==='door'&&<><path d={`M5 ${h-5} V5 M5 ${h-5} H${w-5} M${w-5} ${h-5} A${w-10} ${h-10} 0 0 0 5 5`} fill="none" stroke="#657d8c" strokeDasharray="4 3"/><path d={`M5 ${h-5} L${w-5} ${h-5}`} stroke="#526e82" strokeWidth="4"/></>}
    {type==='window'&&<path d={`M0 ${cy} H${w}`} stroke="#4c93b2" strokeWidth="2"/>}
    {type==='tree'&&<><ellipse cx={w*.38} cy={h*.4} rx={w*.22} ry={h*.22} fill="none" stroke="#6f9875"/><ellipse cx={w*.63} cy={h*.5} rx={w*.21} ry={h*.24} fill="none" stroke="#6f9875"/></>}
    {type==='dancefloor'&&<path d={`M${w/2} 0v${h} M0 ${h/2}h${w}`} stroke="#c5a96d"/>}
    {type==='parking'&&Array.from({length:4},(_,i)=><path key={i} d={`M${(i+1)*w/5} 8 V${h*.32} M${(i+1)*w/5} ${h*.68} V${h-8}`} stroke="#829ab1" fill="none"/>)}
    {type==='foodtruck'&&<><rect x={w*.15} y={-4} width={w*.14} height="8" rx="3" fill="#596a73"/><rect x={w*.72} y={-4} width={w*.14} height="8" rx="3" fill="#596a73"/><rect x={w*.75} y="10" width={w*.17} height={h-20} rx="4" fill="#fcf3e6"/></>}
    {['entrance','exit'].includes(type)&&<path d={`M12 ${cy}h18m-6-6 6 6-6 6`} fill="none" stroke={type==='exit'?'#a35855':'#3e8063'} strokeWidth="2"/>}
    {type==='power'&&<path d={`M${cx+4} ${h*.2}l-12 ${h*.35}h10l-6 ${h*.25} 16-${h*.4}h-10z`} fill="#9b7a28"/>}
    {type==='water'&&<path d={`M${cx} ${h*.2}q-${w*.4} ${h*.5} 0 ${h*.6}q${w*.4}-${h*.1} 0-${h*.6}`} fill="#73afc9"/>}
    {!['wall','window','column','tree','power','water','door'].includes(type)&&<text x={cx} y={cy+4} textAnchor="middle" fontSize={Math.max(8,Math.min(13,w/9))} fontWeight="600" fill="#344e5f" pointerEvents="none">{item.label||type}</text>}
    {['tree','column','power','water','door'].includes(type)&&<title>{item.label||type}</title>}
  </>
}
function Table({item,color}) {
  const custom=!!item.color,ink=custom&&((parseInt(color.slice(1,3),16)*299+parseInt(color.slice(3,5),16)*587+parseInt(color.slice(5,7),16)*114)/1000<150)?'#ffffff':'#233e50'
  const {w,h}=sizeOf(item,'table'),capacity=Math.min(20,Math.max(0,item.capacity||0)),round=item.shape!=='rect'
  return <>
    {Array.from({length:capacity},(_,i)=>{if(round){const angle=(i/capacity)*Math.PI*2;return <rect key={i} x={w/2-5} y={-13} width="10" height="7" rx="3" fill={custom?color:"#f7fafb"} stroke={color} strokeWidth="1" transform={`rotate(${angle*180/Math.PI} ${w/2} ${h/2})`}/>}const top=i<Math.ceil(capacity/2),count=top?Math.ceil(capacity/2):Math.floor(capacity/2),j=top?i:i-Math.ceil(capacity/2);return <rect key={i} x={(j+1)*w/(count+1)-5} y={top?-12:h+5} width="10" height="7" rx="3" fill={custom?color:"#f7fafb"} stroke={color}/>})}
    {round?<circle cx={w/2} cy={h/2} r={w/2} fill={custom?color:"#fff"} stroke={color} strokeWidth={custom?3:2}/>:<rect width={w} height={h} rx="8" fill={custom?color:"#fff"} stroke={color} strokeWidth={custom?3:2}/>}
    {round&&!custom&&<circle cx={w/2} cy={h/2} r={Math.max(1,w/2-5)} fill={color} fillOpacity=".055"/>}
    <text x={w/2} y={h/2-3} textAnchor="middle" fontSize="12" fontWeight="700" fill={ink} pointerEvents="none">{item.name}</text>
    <text x={w/2} y={h/2+13} textAnchor="middle" fontSize="10" fill={custom?ink:"#71828e"} pointerEvents="none">{item.seated||0} / {item.capacity} seats</text>
  </>
}
const TableSymbol=memo(Table,(a,b)=>a.color===b.color&&['capacity','seated','name','shape','color'].every(key=>a.item[key]===b.item[key]))
const DecorSymbol=memo(Decor,(a,b)=>['type','width','height','color','label'].every(key=>a.item[key]===b.item[key]))
export default function FloorCanvas({doc,svgRef,view,grid,selection,onItemDown,onHandleDown,onCanvasDown,onMove,onUp,onCancel,onWheel,marquee,measure,pendingPoint,pending,mode}) {
  const id=useId().replaceAll(':',''),groupColors={};let group=0
  const [viewport,setViewport]=useState({w:1200,h:800})
  useEffect(()=>{const update=()=>{const r=svgRef.current.getBoundingClientRect();setViewport(old=>old.w===r.width&&old.h===r.height?old:{w:r.width,h:r.height})};const observer=new ResizeObserver(update);observer.observe(svgRef.current);update();return()=>observer.disconnect()},[svgRef])
  useEffect(()=>{const svg=svgRef.current;const listener=e=>{if(e.ctrlKey||e.metaKey)onWheel(e)};svg.addEventListener('wheel',listener,{passive:false});return()=>svg.removeEventListener('wheel',listener)},[onWheel,svgRef])
  doc.tables.forEach(t=>{if(t.table_group_id&&!groupColors[t.table_group_id])groupColors[t.table_group_id]=GROUP_COLORS[group++%GROUP_COLORS.length]})
  const items=objects(doc),selected=items.filter(o=>selection.includes(o.key)),box=union(selected.map(o=>bounds(o.item,o.kind))),strokeScale=Math.max(view.w/Math.max(1,viewport.w),view.h/Math.max(1,viewport.h)),rulerStep=Math.max(100,Math.ceil(80*strokeScale/100)*100)
  return <svg ref={svgRef} className={`venue-canvas mode-${mode}`} role="application" aria-label="Venue floor plan canvas" tabIndex="0" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} onPointerDown={onCanvasDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}>
    <defs><pattern id={`dots-${id}`} width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="#afc1cd" opacity=".45"/></pattern><filter id={`shadow-${id}`} x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="9" floodColor="#526f83" floodOpacity=".12"/></filter></defs>
    <rect className="venue-paper" x="0" y="0" width={doc.width} height={doc.height} rx="3" fill="#fcfdfd" stroke="#a9bdca" strokeWidth="1" filter={`url(#shadow-${id})`}/>
    {doc.bg_image_url&&<image href={doc.bg_image_url} width={doc.width} height={doc.height} opacity={(doc.bg_opacity??40)/100} preserveAspectRatio="xMidYMid slice" pointerEvents="none"/>}
    {grid&&<rect width={doc.width} height={doc.height} fill={`url(#dots-${id})`} pointerEvents="none"/>}
    <g pointerEvents="none" fill="#7d96a7" fontSize="10" fontFamily="monospace">
      {Array.from({length:Math.min(101,Math.floor(doc.width/rulerStep)+1)},(_,i)=><g key={i}><line x1={i*rulerStep} y1="-7" x2={i*rulerStep} y2="0" stroke="#9db2c0"/><text x={i*rulerStep+3} y="-13">{i*rulerStep}</text></g>)}
      {Array.from({length:Math.min(101,Math.floor(doc.height/rulerStep)+1)},(_,i)=><g key={i}><line x1="-7" y1={i*rulerStep} x2="0" y2={i*rulerStep} stroke="#9db2c0"/><text x="-12" y={i*rulerStep+3} textAnchor="end">{i*rulerStep}</text></g>)}
    </g>
    {items.filter(o=>o.kind==='element').concat(items.filter(o=>o.kind==='table')).map(o=>{const {w,h}=sizeOf(o.item,o.kind),active=selection.includes(o.key);return <g key={o.key} data-object-key={o.key} role="button" aria-label={`${o.kind==='table'?'Table':'Zone'} ${o.item.name||o.item.label||o.item.type}`} aria-pressed={active} tabIndex="-1" onPointerDown={e=>onItemDown(e,o)} className={`venue-object ${active?'is-selected':''}`} transform={`translate(${o.item.pos_x||0} ${o.item.pos_y||0}) rotate(${o.item.rotation||0} ${w/2} ${h/2})`}>
      {o.kind==='table'?<TableSymbol item={o.item} color={o.item.color||groupColors[o.item.table_group_id]||GROUP_COLORS[0]}/>:<DecorSymbol item={o.item}/>}
      {active&&<rect x="-4" y="-4" width={w+8} height={h+8} rx="4" fill="none" stroke="#178b9b" strokeWidth={2*strokeScale} strokeDasharray={`${5*strokeScale} ${3*strokeScale}`} pointerEvents="none"/>}
    </g>})}
    {box&&selected.length>1&&<rect x={box.x-8} y={box.y-8} width={box.w+16} height={box.h+16} fill="none" stroke="#178b9b" strokeWidth={1.5*strokeScale} strokeDasharray="5 4" pointerEvents="none"/>}
    {selected.length===1&&doc.editable&&<g className="venue-handles">
      <line x1={box.x+box.w/2} y1={box.y-8} x2={box.x+box.w/2} y2={box.y-30*strokeScale} stroke="#178b9b" pointerEvents="none"/>
      <circle aria-label="Rotate selection" data-handle="rotate" cx={box.x+box.w/2} cy={box.y-30*strokeScale} r={7*strokeScale} fill="#fff" stroke="#178b9b" strokeWidth={2*strokeScale} onPointerDown={e=>onHandleDown(e,'rotate',selected[0])}/>
      {selected[0].kind==='element'&&<rect aria-label="Resize zone" data-handle="resize" x={box.x+box.w-6*strokeScale} y={box.y+box.h-6*strokeScale} width={12*strokeScale} height={12*strokeScale} rx="2" fill="#fff" stroke="#178b9b" strokeWidth={2*strokeScale} onPointerDown={e=>onHandleDown(e,'resize',selected[0])}/>}
    </g>}
    {marquee&&<rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} fill="#24a1b7" fillOpacity=".1" stroke="#178b9b" pointerEvents="none"/>}
    {pendingPoint&&pending&&<g pointerEvents="none" opacity=".55"><rect x={pendingPoint.x-pending.w/2} y={pendingPoint.y-pending.h/2} width={pending.w} height={pending.h} rx="6" fill={pending.color} stroke="#178b9b" strokeDasharray="6 4"/><text x={pendingPoint.x} y={pendingPoint.y+4} textAnchor="middle" fontSize="12" fill="#244e64">{pending.count>1?`${pending.count} × `:''}{pending.label}</text></g>}
    {measure?.a&&measure?.b&&<g pointerEvents="none"><line x1={measure.a.x} y1={measure.a.y} x2={measure.b.x} y2={measure.b.y} stroke="#d19435" strokeWidth={2*strokeScale} strokeDasharray="5 3"/><circle cx={measure.a.x} cy={measure.a.y} r={4*strokeScale} fill="#d19435"/><circle cx={measure.b.x} cy={measure.b.y} r={4*strokeScale} fill="#d19435"/><text x={(measure.a.x+measure.b.x)/2} y={(measure.a.y+measure.b.y)/2-10*strokeScale} textAnchor="middle" fontSize={12*strokeScale} fill="#9b6d25">{Math.round(Math.hypot(measure.b.x-measure.a.x,measure.b.y-measure.a.y))} units</text></g>}
  </svg>
}
