export const listRows=value=>Array.isArray(value)?value:Array.isArray(value?.items)?value.items:Array.isArray(value?.groups)?value.groups:[]
const count=(data,key)=>listRows(data[key]).length
export function toolChecks(tool,event={},data={},failures=[]) {
 const checks=[],add=(label,passed,detail)=>checks.push({label,passed,detail})
 if(tool.flag)add('Tool enabled',!!event[tool.flag],event[tool.flag]?'Enabled. Content still needs its own setup.':'Enable this tool from Add tools before configuring it.')
 switch(tool.id){
 case 'seating':add('Tables saved',count(data,'listTables')>0,`${count(data,'listTables')} tables · ${listRows(data.listTables).reduce((n,t)=>n+(Number(t.capacity)||0),0)} seats`);break
 case 'programme':add('Published workflow',listRows(data.listExperienceWorkflows).some(w=>w.status==='published'),'Publish the intended workflow in the editor.');add('Programme visible in GuestHub',!!event.live_program_enabled,'Publishing a workflow and enabling GuestHub programme visibility are separate.');add('Programme steps configured',listRows(data.listExperienceWorkflows).some(w=>w.status==='published'&&listRows(w.steps).length>0),'Review the steps in the published workflow; Festio Live activities have separate access.');break
 case 'forms':add('Published form version',listRows(data.listEventForms).some(f=>f.published_version!=null),'Save the form and explicitly publish the version guests should complete.');break
 case 'tickets':{const cfg=data.ticketingConfig;add('Ticket catalog saved',!!cfg?.config,cfg?.config?`${cfg.config.currency} · ${cfg.config.enabled?'Sales enabled':'Checkout paused'}`:'Save a paused catalog before creating tickets.');add('Ticket products saved',count(data,'ticketingProducts')>0,`${count(data,'ticketingProducts')} ticket products`);if(cfg?.go_live)add('Paid-sales prerequisites',!!cfg.go_live.ready,(cfg.go_live.checks||[]).filter(c=>!c.ready).map(c=>c.label).join(' · ')||'Provider prerequisites recorded; complete the controlled payment test separately.');break}
 case 'giving':add('Campaign saved',!!data.donationCampaign?.id,data.donationCampaign?.title||'Create and save the campaign.');add('Public campaign enabled',!!data.donationCampaign?.enabled,'Save the enabled state before sharing. Pledges are not received money.');add('At least one giving method',!!data.donationCampaign?.channels?.some(c=>c.enabled),'Only enable collection methods you have configured and reviewed.');break
 case 'community':{const status=data.eventFestioMeStatus,policy=data.festiomeAccessPolicy;add('Community service available',!!status?.available,status?.detail||'Review the configured FestioMe connection.');add('Community enabled',!!status?.enabled,'Open the community only after reviewing guest eligibility.');add('Community groups available',count(data,'festiomeManageGroups')>0,`${count(data,'festiomeManageGroups')} groups available`);if(policy)add('Guest access policy',policy.mode!=='approved_adults'||(policy.adult_guest_ids||[]).length>0,policy.mode==='approved_adults'?`${policy.adult_guest_ids?.length||0} adults approved. Ineligible guests stay blocked.`:'Eligible-audience policy. Review the intended guest before launch.');break}
 case 'website':add('Website version published',!!data.website?.published_release_id,'Publish the intended website version.');add('Published content current',!!data.website?.published_release_id&&!data.website?.draft_is_newer&&!data.website?.live_release_outdated,'Draft or source changes may need another publication.');break
 case 'design':case 'guesthub':add('Design selected',!!data.getEventDesign?.selected_template_id,'Choose a template or retain the current invitation design.');add('Design published',!!data.getEventDesign?.is_published,'Review and publish the intended design in Design Studio.');if(tool.id==='guesthub')add('GuestHub enabled',data.messagingSettings?.guest_hub_enabled===true,'Enable the personal hub in messaging settings and review modules.');break
 case 'speakers':add('Speaker profiles saved',count(data,'listSpeakers')>0,`${count(data,'listSpeakers')} speakers`);add('Public speaker link available',!!data.getSpeakerSettings?.speaker_token,'Review public listing settings before sharing.');break
 case 'partners':add('Partner profiles saved',count(data,'listPartners')>0,`${count(data,'listPartners')} partners`);add('Public partner link available',!!data.getPartnerSettings?.partner_token,'Review public listing settings before sharing.');break
 case 'gifts':add('Registry items saved',count(data,'listRegistryItems')>0,`${count(data,'listRegistryItems')} gift items`);add('Public registry link available',!!(data.getRegistrySettings?.registry_token||event.registry_token),'Review gift-list visibility before sharing.');break
 case 'meals':add('Menu categories saved',count(data,'listMenuCategories')>0,`${count(data,'listMenuCategories')} categories. Check the choices inside each category.`);break
 case 'deliveries':add('Shipments saved',count(data,'listShipments')>0,`${count(data,'listShipments')} shipments. A saved shipment does not prove fulfilment.`);break
 case 'access':add('Venue zones saved',count(data,'listZones')>0,`${count(data,'listZones')} zones`);add('Access gates saved',count(data,'listGates')>0,`${count(data,'listGates')} gates. Test both allowed and denied credentials.`);break
 case 'live':add('Activities saved',count(data,'liveActivities')>0,`${count(data,'liveActivities')} activities. Open voting separately when the question is ready.`);break
 case 'certificates':add('Certificate templates saved',count(data,'listCertificateTemplates')>0,`${count(data,'listCertificateTemplates')} templates`);add('Issued certificate available',listRows(data.listEventCertificates).some(c=>c.status==='issued'),'Issuance is deliberate. Verify a controlled issued certificate before batch issuance.');break
 case 'resources':add('Presenter materials saved',count(data,'listPresenterMaterials')>0,`${count(data,'listPresenterMaterials')} materials. Test the intended access and version.`);break
 case 'displays':add('Displays configured',count(data,'liveDisplays')>0,`${count(data,'liveDisplays')} displays`);add('Show workflows saved',count(data,'liveWorkflows')>0,`${count(data,'liveWorkflows')} workflows. Rehearse the actual device separately.`);break
 case 'guests':case 'passes':case 'checkin':add('Guest records available',count(data,'listGuests')>0,`${count(data,'listGuests')} guests in this event`);if(tool.id!=='guests')add('Personal guest credentials available',listRows(data.listGuests).some(g=>!!(g.invite_token||g.qr_token)),'Choose an authorized test guest to inspect their pass and admission status.');break
 default:{const resources=Object.entries(data).filter(([k])=>k!=='event'&&k!=='progress');if(resources.length)add('Workspace data available',resources.some(([,v])=>v!=null),'Saved data can be opened. Follow the scoped test below to verify the outcome.');break}
 }
 if(failures.some(f=>f.key!=='evidence'))for(const c of checks)if(c.label!=='Tool enabled'){c.passed=null;c.detail='Could not verify saved setup. Retry service checks.'}
 for(const failure of failures)add(failure.label||failure.key,null,failure.message||'Could not verify. Retry this service check.')
 return checks
}
export function safePreviewUrl(value,origin) {if(!value)return '';try{const u=new URL(value,origin);return (u.origin===origin||u.protocol==='https:')&&!u.username&&!u.password?u.href:''}catch{return ''}}
export function toolPreviewUrl(tool,event,data,guest,origin) {
 const kind=tool.preview||tool.guide?.preview
 if(kind==='guest'){const token=guest?.invite_token||guest?.qr_token;return token?`${origin}/r/${encodeURIComponent(token)}#/${tool.guestTab||tool.guide?.guestTab||'more'}`:''}
 if(kind==='giving')return data.donationCampaign?.enabled&&data.donationCampaign?.public_token?`${origin}/give/${encodeURIComponent(data.donationCampaign.public_token)}`:''
 if(kind==='website')return data.website?.published_release_id?safePreviewUrl(data.website.public_url,origin):''
 if(kind==='speakers')return data.getSpeakerSettings?.speaker_token?`${origin}/speakers/${encodeURIComponent(data.getSpeakerSettings.speaker_token)}`:''
 if(kind==='partners')return data.getPartnerSettings?.partner_token?`${origin}/partners/${encodeURIComponent(data.getPartnerSettings.partner_token)}`:''
 if(kind==='registry'){const token=data.getRegistrySettings?.registry_token||event.registry_token;return token?`${origin}/registry/${encodeURIComponent(token)}`:''}
 if(kind==='certificate'){const row=listRows(data.listEventCertificates).find(c=>c.status==='issued');return safePreviewUrl(row?.verification_url,origin)}
 if(kind==='tickets')return data.ticketingConfig?.config?`${origin}/tickets/e/${encodeURIComponent(event.id)}`:''
 if(kind==='invitation'){const q=event.setup_preferences?.quick_invite;return q?`${origin}/i/${encodeURIComponent(q.share_slug||event.rsvp_token||event.id)}`:event.rsvp_token?`${origin}/rsvp/${encodeURIComponent(event.rsvp_token)}`:`${origin}/invite/${encodeURIComponent(event.id)}`}
 return ''
}
export function toolRevision(tool,event,data){
 const skip=/token|email|phone|first_name|last_name|created_at|updated_at|response_count|last_seen|credit|balance|responded_at/i
 const clean=v=>Array.isArray(v)?v.map(clean):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).filter(k=>!skip.test(k)).sort().map(k=>[k,clean(v[k])])):v
 const text=JSON.stringify(clean({tool:tool.id,event,data}));let hash=2166136261;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}return `tool-v1-${(hash>>>0).toString(16)}`
}
