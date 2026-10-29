export const CERTIFICATE_TYPES = [
  {id:'participation',name:'Participation',title:'Certificate of Participation',body:'For successful participation in this event'},
  {id:'completion',name:'Completion',title:'Certificate of Completion',body:'For successfully completing the programme'},
  {id:'achievement',name:'Achievement',title:'Certificate of Achievement',body:'In recognition of outstanding achievement'},
  {id:'appreciation',name:'Appreciation',title:'Certificate of Appreciation',body:'With sincere appreciation for your valuable contribution'},
  {id:'speaker',name:'Speaker',title:'Speaker Recognition',body:'In appreciation of sharing your knowledge and inspiring our community'},
  {id:'volunteer',name:'Volunteer',title:'Volunteer Recognition',body:'In recognition of your generous service and dedication'},
]
export const CERTIFICATE_LAYOUTS = [{id:'classic',name:'Classic frame'},{id:'modern',name:'Modern band'},{id:'editorial',name:'Editorial border'}]
export function applyCertificateType(design, id) {
  const type=CERTIFICATE_TYPES.find(type=>type.id===id)
  return type?{...design,kind:id,title:type.title,subtitle:'This certificate is proudly presented to',body:type.body}:{...design,kind:'custom'}
}
