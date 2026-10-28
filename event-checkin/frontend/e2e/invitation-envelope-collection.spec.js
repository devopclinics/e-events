import {test,expect} from '@playwright/test'
const styles=['folio','velvet','drawer','story','lattice']
for(const mobile of [false,true])test(`collection reveal preserves invitation and recipient${mobile?' @mobile':''}`,async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.emulateMedia({reducedMotion:'reduce'})
 for(const style of styles){
  await page.unroute('**/api/**')
  await page.route('**/api/**',r=>{
   if(r.request().url().includes('/public-theme'))return r.fulfill({json:{event_id:'collection-test',colors:{},wording:{},layout:{},envelope_config:{enabled:true,frequency:'once',appearance:{style,palette:'signature',initials:'AB'}}}})
   if(r.request().url().includes('/api/invite/token/'))return r.fulfill({json:{event:{id:'collection-test',name:'Collection gathering',event_date:'2026-12-13T14:00:00Z',rsvp_collect_email:true,rsvp_collect_phone:false,rsvp_multi_invitee_enabled:false,rsvp_invitee_type_options:[],rsvp_enabled:true,invite_mode:'open',guest_hub_layout:'classic'},guest:{first_name:'Zara',last_name:'Test',rsvp_status:'invited'},already_responded:false,deadline_passed:false}})
   return r.fulfill({json:[]})
  })
  await page.goto(`/r/collection-${style}`)
  const scene=page.getByRole('dialog',{name:'Your invitation'})
  await expect(scene).toHaveAttribute('data-style',style)
  await expect(scene.locator('.inv-opening-kicker')).toHaveText('AN INVITATION FOR Zara')
  await scene.getByRole('button',{name:'Open your invitation',exact:true}).press('Enter')
  await expect(scene).toHaveAttribute('data-revealed','true')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy()
  await scene.getByRole('button',{name:'View full invitation',exact:false}).click()
  await expect(scene).toHaveCount(0)
  await expect(page.getByRole('heading',{name:'Collection gathering',exact:true}).first()).toBeVisible()
  await page.reload();await expect(scene).toHaveCount(0)
  await page.goto(`/r/collection-${style}?envelope-preview=1`)
  await expect(scene).toBeVisible();await page.keyboard.press('Escape');await expect(scene).toHaveCount(0)
 }
 expect(errors).toEqual([])
})
