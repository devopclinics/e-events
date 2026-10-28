import {test,expect} from '@playwright/test'
for(const mobile of [false,true])test(`paid ticket opens personalized folio then confirmed GuestHub${mobile?' @mobile':''}`,async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 let posts=0
 await page.route('**/api/**',r=>{
  const url=r.request().url();if(r.request().method==='POST')posts++
  if(url.includes('/public-theme'))return r.fulfill({json:{colors:{},wording:{},layout:{},envelope_config:{enabled:true,frequency:'once',appearance:{style:'folio',palette:'signature',initials:'MA'}}}})
  if(url.includes('/api/invite/token/'))return r.fulfill({json:{event:{id:'paid-event',name:'Mumineen Academy Annual Fundraising Event',event_date:'2026-12-13T14:00:00Z',rsvp_enabled:true,invite_mode:'closed',guest_hub_layout:'app',rsvp_landing_layout:'welcome'},guest:{first_name:'Amina',last_name:'Idris',rsvp_status:'confirmed'},already_responded:true}})
  if(url.includes('/guest-hub'))return r.fulfill({json:{guest:{name:'Amina Idris',qr_token:'paid-qr',rsvp_status:'confirmed',admitted:false},announcements:[],direct_messages:[],chat_messages:[],capabilities:{}}})
  return r.fulfill({json:[]})
 })
 await page.emulateMedia({reducedMotion:'reduce'})
 await page.goto('/r/paid-personal?ticket-opening=1#guest-hub')
 await expect(page.locator('.inv-opening-kicker')).toHaveText('AN INVITATION FOR Amina')
 await page.getByRole('button',{name:'Open your invitation',exact:true}).click()
 await expect(page.locator('.inv-opening')).toHaveAttribute('data-revealed','true')
 await page.getByRole('button',{name:'View full invitation',exact:false}).click()
 await expect(page.locator('.inv-opening')).toHaveCount(0)
 await expect(page.getByRole('heading',{name:'Welcome, Amina',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Open My Pass',exact:true}).click()
 await expect(page.locator('img[src="/api/scan/paid-qr/qr.png"]').first()).toBeVisible()
 await page.reload();await expect(page.locator('.inv-opening')).toHaveCount(0)
 await page.goto('/r/paid-personal');await expect(page.locator('.inv-opening')).toHaveCount(0)
 expect(posts).toBe(0);expect(errors).toEqual([])
})
