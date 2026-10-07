export const FLYER_SIZES={portrait:'Portrait · 1080 × 1350',square:'Square · 1080 × 1080',story:'Story · 1080 × 1920',a4:'A4 · 210 × 297 mm',a5:'A5 · 148 × 210 mm'};
export const FLYER_LAYOUTS={editorial:['Editorial','Clean, warm and spacious'], 'brand-led':['Brand-led','Rich colour and event artwork'], 'artwork-only':['Your finished flyer','Keep your artwork without overlays'],legacy:['Existing template','Keep the original flyer design']};
export function flyerSettings(assets={}) {
 const s=assets.flyer_settings||{};
 return {size:'portrait',qr:true,qrPosition:'bottom-right',showLogo:true,palette:'event',...s,composition:s.artworkOnly?'artwork-only':s.composition||'legacy'};
}
export function eventFlyerWording(event={},overrides={}) {
 let date='';const zone=event.timezone||event.event_timezone||'UTC';
 const format=v=>{try{return new Intl.DateTimeFormat('en-US',{dateStyle:'long',timeZone:zone}).format(new Date(v))}catch{return ''}};
 if(event.event_date)date=format(event.event_date);
 const end=event.end_date||event.event_end_date;if(end&&format(end)!==date)date=[date,format(end)].filter(Boolean).join(' – ');
 return {eventTitle:event.name||'Your event',date,venue:event.venue_name||'',address:event.venue_address||'',...Object.fromEntries(Object.entries(overrides).filter(([,v])=>v!=null&&String(v).trim()))};
}
// One request contract for guided preview, specialist preview and both downloads.
export function flyerRequest({draft,event={},theme={},eventId,origin,preview=false,format}) {
 const a=draft.asset_config||{},s=flyerSettings(a),modern=s.composition!=='legacy';
 const cover=s.composition==='artwork-only'?(a.artwork_image_url||a.cover_image_url):a.cover_image_url;
 return {preview,size:s.size,format:format||(preview?'png':['a4','a5'].includes(s.size)?'pdf':'png'),composition:s.composition,flyer_settings:s,
 template_id:draft.selected_flyer_template_id||draft.selected_template_id||undefined,colors:theme.colors||draft.theme_config?.colors,
 font_pairing:s.fontPairing==='event'?(theme.font_pairing||draft.theme_config?.fontPairing):s.fontPairing||(modern?'classic-serif':theme.font_pairing||draft.theme_config?.fontPairing),wording:eventFlyerWording(event,draft.wording_config),
 cover_image_url:s.composition!=='artwork-only'&&a.image_settings?.surfaces?.flyer===false?null:cover||null,logo_image_url:a.logo_image_url||null,
 image_settings:a.image_settings||{},image_position:a.image_position||{},text_scale:a.flyer_text_scale||1,
 qr_enabled:s.qr&&s.composition!=='artwork-only',qr_position:s.qrPosition,qr_data:s.qr?`${origin}/invite/${eventId}`:null};
}
