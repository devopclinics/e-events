import { useRef, useState } from 'react';
import { api } from '../../api';
export default function Images({eventId,assets,onChange,disabled,onBusy}) {
 const [busy,setBusy]=useState(''),[error,setError]=useState('');const generation=useRef(0);
 const options=assets.image_settings||{};
 const setting=(key,value)=>onChange({image_settings:{...options,[key]:value}});
 async function upload(file,kind){
  if(!file||busy||disabled)return;
  setError('');
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)){setError('Choose a JPG, PNG or WebP image.');return}
  if(file.size>5*1024*1024){setError('Choose an image smaller than 5 MB.');return}
  const id=++generation.current;setBusy(kind);onBusy(true);
  let url;
  try {url=URL.createObjectURL(file);const image=new Image();image.src=url;await image.decode();if(image.width*image.height>25000000)throw Error('Choose an image with smaller dimensions.');const meta=await api.uploadDesignAsset(eventId,file,{attachToDesign:false});if(id===generation.current)onChange({[`${kind}_image_url`]:meta.public_url,[`${kind}_filename`]:file.name,library:[meta,...(assets.library||[])].slice(0,100)});}
  catch(e){setError(e.message||'Image upload failed. Try again.')}
  finally{if(url)URL.revokeObjectURL(url);setBusy('');onBusy(false)}
 }
 return <details className="studio-images" open><summary>Images <small>Logo & event cover</small></summary><p>Upload a photo or finished artwork. Publish when you are ready for guests to see it.</p><div className="studio-upload-grid">{['cover','logo'].map(kind=><div key={kind} className="studio-upload" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();upload(e.dataTransfer.files[0],kind)}}>{assets[`${kind}_image_url`]?<img src={assets[`${kind}_image_url`]} alt={`${kind} preview`} />:<span aria-hidden="true">＋</span>}<label htmlFor={`studio-${kind}`}>{busy===kind?'Uploading…':`${assets[`${kind}_image_url`]?'Replace':'Upload'} ${kind}`}</label><input id={`studio-${kind}`} aria-label={`Upload ${kind}`} type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled||!!busy} onChange={e=>{upload(e.target.files[0],kind);e.target.value=''}} /><small>{assets[`${kind}_filename`]||'Choose or drop an image'}</small>{assets[`${kind}_image_url`]&&<button type="button" disabled={disabled||!!busy} onClick={()=>onChange({[`${kind}_image_url`]:'',[`${kind}_filename`]:''})}>Remove {kind}</button>}</div>)}</div><p>JPG, PNG or WebP · Up to 5 MB. Use a transparent PNG for a logo.</p>{error&&<p role="alert" className="studio-error">{error}</p>}{assets.cover_image_url&&<><label className="studio-field">Image description<input value={options.alt||''} maxLength={180} onChange={e=>setting('alt',e.target.value)} /></label><div className="studio-row"><label className="studio-field">Image fit<select value={options.fit||'cover'} onChange={e=>setting('fit',e.target.value)}><option value="cover">Fill — crop edges</option><option value="contain">Fit — whole image</option></select></label><label className="studio-field">Position<select value={options.position||'center'} onChange={e=>setting('position',e.target.value)}>{['center','top','bottom','left','right'].map(x=><option key={x}>{x}</option>)}</select></label></div><p>Use Fit for artwork containing text. Fit preserves complete artwork. Flyer template zones retain their shape; email shows the whole image. Logo placement uses the guest page header.</p><div className="studio-image-surfaces">{['rsvp','hub','flyer','email'].map(s=><label className="studio-toggle" key={s}><input type="checkbox" checked={options.surfaces?.[s]!==false} onChange={e=>setting('surfaces',{...options.surfaces,[s]:e.target.checked})}/>{{rsvp:'Welcome RSVP',hub:'Event App',flyer:'Flyer',email:'Email'}[s]}</label>)}</div></>}</details>;
}
