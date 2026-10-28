export const ENVELOPE_COLLECTION = {
 folio:{name:'Executive Folio',number:'01',edition:'THE EXECUTIVE EDITION',headline:'A gathering.\nA greater purpose.',description:'Tailored covers, a discreet clasp and a beautifully framed invitation.',reveal:'Both covers swing outward from the centre.',feeling:'Composed. Considered. Personal.',audience:'Executive dinners, foundation galas and formal invitations.',gesture:'Touch the clasp. Open the possibility.',colours:['#193e35','#112d27','#cdb67b','#e3e4da','#344f3b']},
 velvet:{name:'Velvet Keepsake',number:'02',edition:'THE KEEPSAKE EDITION',headline:'An invitation\nworth keeping.',description:'A velvet-inspired rigid box with foil initials and a warm, lined interior.',reveal:'The lid lifts upward and tilts aside in perspective.',feeling:'Intimate. Tactile. Celebratory.',audience:'VIP receptions, weddings and milestone celebrations.',gesture:'Lift the lid. Discover what’s inside.',colours:['#572c44','#321b2b','#d5b47c','#eae1df','#634454']},
 drawer:{name:'Ribbon Drawer',number:'03',edition:'THE UNWRAPPED EDITION',headline:'A small gesture.\nA lasting welcome.',description:'A quiet sleeve, a satin ribbon and a fitted invitation tray.',reveal:'The ribbon and tray slide out as the sleeve moves aside.',feeling:'Thoughtful. Warm. Beautifully made.',audience:'Fundraisers, hospitality and community gatherings.',gesture:'Pull the ribbon. Find your place.',colours:['#b7bea4','#899375','#eee1b7','#edece2','#626e4b']},
 story:{name:'Story Fold',number:'04',edition:'THE STORYTELLER EDITION',headline:'One gathering.\nMany possibilities.',description:'Three connected panels make room for your invitation, gathering and message.',reveal:'A compact cover opens into three unfolding panels.',feeling:'Expressive. Editorial. Full of life.',audience:'Conferences, cultural programmes and multi-day events.',gesture:'Unfold the story. Begin the next chapter.',colours:['#273e66','#172c4f','#e8dbc0','#e1e6ea','#3d526e']},
 lattice:{name:'Lattice Gate',number:'05',edition:'THE ARCHITECTURAL EDITION',headline:'Opened by\npossibility.',description:'Geometric screens form an arched gateway around a softly illuminated invitation.',reveal:'Twin lattice gates swing outward to reveal the light within.',feeling:'Rooted. Luminous. Distinctive.',audience:'Heritage, faith-led and community gatherings.',gesture:'Open the gates. Let the light in.',colours:['#b6a46e','#81734a','#f8edc8','#163f36','#e5d8ac']},
}
export function collectionDate(event) {
 try {
  if (!event?.event_date) return 'Date to be announced'
  const raw=event.event_date
  const date=new Date(raw.includes('T')&&!/(Z|[+-]\d\d:\d\d)$/i.test(raw)?raw+'Z':raw)
  return new Intl.DateTimeFormat('en-US',{day:'numeric',month:'long',year:'numeric',timeZone:event.timezone||'UTC'}).format(date)
 } catch {return 'Date to be announced'}
}
