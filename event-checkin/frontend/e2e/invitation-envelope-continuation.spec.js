import {test,expect} from '@playwright/test'
const styles=['wax','classic','pocket','folio','velvet','drawer','story','lattice']
for(const mobile of [false,true])test(`optional three-second continuation and manual reveal${mobile?' @mobile':''}`,async({page})=>{
 await page.clock.install({time:new Date('2026-10-28T12:00:00Z')})
 await page.clock.pauseAt(new Date('2026-10-28T12:00:01Z'))
 await page.emulateMedia({reducedMotion:mobile?'reduce':'no-preference'})
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 let posts=0
 for(const style of styles)for(const mode of ['auto','manual']){
  await page.unroute('**/api/**')
  await page.route('**/api/**',r=>{
   if(r.request().method()==='POST')posts++
   if(r.request().url().includes('/public-theme'))return r.fulfill({json:{colors:{},wording:{},layout:{},envelope_config:{enabled:true,frequency:'always',continue_mode:mode,appearance:{style,palette:'ivory',initials:'AB'}}}})
   if(r.request().url().includes('/api/invite/'))return r.fulfill({json:{id:'timed-event',name:'Timed invitation',event_date:'2026-12-13T14:00:00Z',rsvp_enabled:true,invite_mode:'open',guest_hub_layout:'classic',rsvp_collect_email:true,rsvp_collect_phone:false,rsvp_multi_invitee_enabled:false,rsvp_invitee_type_options:[]}})
   return r.fulfill({json:[]})
  })
  await page.goto('/invite/timed-event')
  const opening=page.getByRole('dialog',{name:'Your invitation'})
  await expect(opening).toHaveAttribute('data-style',style)
  await opening.getByRole('button',{name:'Open your invitation',exact:true}).click()
  await page.clock.fastForward(2999)
  await expect(opening).toBeVisible()
  await expect(opening).toHaveAttribute('data-revealed','true')
  if(mode==='auto')await page.clock.fastForward(1)
  else{
   await page.clock.fastForward(5000)
   await expect(opening).toBeVisible()
   await opening.getByRole('button',{name:'View full invitation',exact:false}).click()
  }
  await expect(opening).toHaveCount(0)
  await expect(page.getByRole('heading',{name:'Timed invitation',exact:true}).first()).toBeVisible()
 }
 expect(posts).toBe(0);expect(errors).toEqual([])
})
