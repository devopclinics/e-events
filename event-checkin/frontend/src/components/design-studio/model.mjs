export const CONFIG_KEYS = ['selected_template_id','selected_flyer_template_id','theme_config','wording_config','asset_config','page_config'];
export const payloadOf = value => Object.fromEntries(CONFIG_KEYS.map(k => [k, value?.[k] ?? (k.startsWith('selected_') ? null : {})]));
export const signature = value => JSON.stringify(payloadOf(value));
export const FONTS = {'modern-sans':'system-ui,-apple-system,"Segoe UI",sans-serif','classic-serif':'Georgia,"Times New Roman",serif','elegant-serif':'"Iowan Old Style",Georgia,serif','display-rounded':'"Trebuchet MS","Segoe UI",sans-serif','bold-sans':'"Segoe UI",system-ui,sans-serif'};
export function createDesignSaver(initial, save, onState = () => {}) {
  let desired=payloadOf(initial), acknowledged=signature(initial), revision=initial.revision || 0, running=null, closed=false;
  const emit=(status,extra={})=>{if(!closed)onState({status,...extra})};
  return {
    edit(value){desired=payloadOf(value);if(signature(desired)!==acknowledged)emit('unsaved')},
    accept(value){desired=payloadOf(value);acknowledged=signature(value);revision=value.revision||0;emit('saved',{saved:value})},
    get revision(){return revision},
    close(){closed=true},
    flush(){
      if(running)return running;
      running=(async()=>{
        while(!closed && signature(desired)!==acknowledged){
          const sent=structuredClone(desired), sentSignature=signature(sent);emit('saving');
          const saved=await save({...sent,expected_revision:revision});
          revision=saved.revision;acknowledged=sentSignature;
          // A response acknowledges only its own payload, never newer edits.
          if(signature(desired)===acknowledged)emit('saved',{saved});
        }
        return revision;
      })().catch(error=>{emit('error',{error:error.message||'Save failed'});throw error}).finally(()=>{running=null});
      return running;
    }
  };
}
export function toPublicTheme(draft, templates, eventId) {
 const tpl=templates.find(t=>t.id===draft.selected_template_id)||templates[0]||{};
 const t=draft.theme_config||{},a=draft.asset_config||{};
 return {event_id:eventId,template_id:tpl.id,is_default:!draft.selected_template_id,colors:{...tpl.defaultColors,...t.colors},font_pairing:t.fontPairing||tpl.fontPairing,button_style:t.buttonStyle||tpl.buttonStyle,layout:tpl.layout||{},wording:draft.wording_config||{},page_config:draft.page_config||{},pass_options:t.passOptions||{},hub_layout:t.hubLayout||{},hub_style:t.hubStyle||'wallet-pass',guest_app_theme:t.guestAppTheme||'event',cover_image_url:a.cover_image_url||null,flyer_image_url:a.flyer_image_url||null,logo_image_url:a.logo_image_url||null,image_settings:a.image_settings||{}};
}
export function writeDraftPreview(key,eventId,theme){
 localStorage.setItem(`festio:studio:${key}`,JSON.stringify({event_id:eventId,theme,expires:Date.now()+15*60*1000}));
}
export function readDraftPreview(key,eventId){
 if(!/^[a-f0-9-]{36}$/.test(key||''))return null;
 try {const value=JSON.parse(localStorage.getItem(`festio:studio:${key}`));if(value?.event_id===eventId&&value.expires>Date.now()&&value.theme)return value.theme;}catch{}
 return null;
}
export function imagePresentation(theme,surface){
 const image=theme?.image_settings||{};
 return {visible:image.surfaces?.[surface]!==false,alt:typeof image.alt==='string'?image.alt:'',style:{objectFit:image.fit==='contain'?'contain':'cover',objectPosition:['center','top','bottom','left','right'].includes(image.position)?image.position:'center'}};
}
