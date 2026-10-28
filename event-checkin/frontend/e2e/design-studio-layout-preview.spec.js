import {test,expect} from '@playwright/test'
const key='12345678-1234-4234-8234-123456789abc'
const markers={classic:'.fh-hub-style-wallet-pass',companion:'.fh-companion-layout',journey:'.flow-option-three',complete:'.flow-option-four',app:'.fh-event-app'}
for(const mobile of [false,true])test(`draft preview preserves each layout past the loading timeout${mobile?' @mobile':''}`,async({page})=>{
 await page.clock.install({time:new Date('2026-10-28T12:00:00Z')})
 await page.clock.pauseAt(new Date('2026-10-28T12:00:01Z'))
 let publishedReads=0,writes=0;const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(({key})=>{
  const layout=new URLSearchParams(location.search).get('test-layout')||'classic'
  localStorage.setItem('festio:studio:'+key,JSON.stringify({event_id:'preview-event',expires:Date.now()+600000,theme:{event_id:'preview-event',colors:{},wording:{eventTitle:'Draft preview'},layout:{},page_config:{experience:{guestHubLayout:layout,rsvpLayout:'welcome'}},hub_style:'wallet-pass'}}))
 },{key})
 await page.route('**/api/**',r=>{
  if(r.request().method()!=='GET')writes++
  if(r.request().url().includes('/public-theme')){publishedReads++;return r.fulfill({json:{colors:{},wording:{eventTitle:'Published app'},layout:{},page_config:{experience:{guestHubLayout:'app'}}}})}
  if(r.request().url().includes('/api/invite/'))return r.fulfill({json:{id:'preview-event',name:'Published app',event_date:'2026-12-13T14:00:00Z',rsvp_enabled:true,guest_hub_layout:'app',rsvp_landing_layout:'welcome',rsvp_collect_email:true,rsvp_collect_phone:false,rsvp_multi_invitee_enabled:false,rsvp_invitee_type_options:[]}})
  return r.fulfill({json:[]})
 })
 for(const [layout,marker] of Object.entries(markers)){
  await page.goto(`/invite/preview-event?studio-preview=1&studio-key=${key}&studio-surface=hub&test-layout=${layout}`)
  await expect(page.locator(marker).first()).toBeVisible()
  await page.clock.fastForward(6000)
  await expect(page.locator(marker).first()).toBeVisible()
  await expect(page.getByText('Published app',{exact:true})).toHaveCount(0)
  if(layout!=='app')await expect(page.locator('.fh-event-app')).toHaveCount(0)
 }
 // RSVP uses its landing page; My Pass intentionally uses the pass app.
 await page.goto(`/invite/preview-event?studio-preview=1&studio-key=${key}&studio-surface=rsvp&test-layout=classic`)
 await expect(page.locator('.rsvp-welcome')).toBeVisible();await page.clock.fastForward(6000)
 await expect(page.locator('.rsvp-welcome')).toBeVisible()
 await page.goto(`/invite/preview-event?studio-preview=1&studio-key=${key}&studio-surface=pass&test-layout=classic#/pass`)
 await expect(page.locator('.fh-event-app')).toBeVisible();await page.clock.fastForward(6000)
 await expect(page.locator('.fh-event-app')).toBeVisible()
 expect(publishedReads).toBe(0);expect(writes).toBe(0);expect(errors).toEqual([])
})
