// Public contact only: no auth tokens, current URLs, guest identifiers or inbox data.
export const FESTIO_WHATSAPP_NUMBER = '15553888825'
export const DEFAULT_WHATSAPP_MESSAGE = 'Hi Festio, I would like some help with my event.'
export function whatsappContactLink(message=DEFAULT_WHATSAPP_MESSAGE){
 const url=new URL('https://wa.me/'+FESTIO_WHATSAPP_NUMBER)
 url.searchParams.set('text',String(message).trim().slice(0,1000)||DEFAULT_WHATSAPP_MESSAGE)
 return url.href
}
export function clampContactPosition(position,width,height){return {x:Math.max(8,Math.min(Number(position.x)||8,width-88)),y:Math.max(8,Math.min(Number(position.y)||8,height-88))}}
