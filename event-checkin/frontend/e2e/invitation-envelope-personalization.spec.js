import { test, expect } from '@playwright/test'
const event = { id:'names-event', name:'Community gathering', event_date:'2026-12-13T14:00:00Z', rsvp_enabled:true, invite_mode:'open', guest_hub_layout:'classic', rsvp_collect_email:true, rsvp_collect_phone:false, rsvp_multi_invitee_enabled:false, rsvp_invitee_type_options:[] }
const appearance = { style:'wax', palette:'ivory', paper:'', seal:'gold', initials:'M', wording:{ headline:'Dear {{first_name}} {{last_name}},', inscription:'For {{full_name}}', skip_label:'View event' } }
async function setup(page, guests={}, delayB=false) {
  await page.route('**/api/**', async route => {
    const url = route.request().url()
    if (url.includes('/public-theme')) return route.fulfill({json:{event_id:event.id,colors:{},wording:{},layout:{},envelope_config:{enabled:true,frequency:'once',appearance}}})
    if (url.includes('/api/invite/token/')) {
      const token = url.split('/api/invite/token/')[1]
      if (delayB && token === 'private-link-B') await new Promise(resolve=>setTimeout(resolve,700))
      return route.fulfill({json:{event,guest:{first_name:'',last_name:'',rsvp_status:'invited',...guests[token]},already_responded:false,deadline_passed:false}}).catch(()=>{})
    }
    if (url.includes('/api/invite/')) return route.fulfill({json:event})
    return route.fulfill({json:[]})
  })
}

test('personal names use the token response; distinct guests get distinct completion records', async ({page})=>{
  await setup(page,{'private-link-A':{first_name:'Amina',last_name:'Idris'},'private-link-B':{first_name:'Zara',last_name:'Noor'}},true)
  await page.goto('/r/private-link-A')
  await expect(page.locator('.inv-opening-heading')).toHaveText('Dear Amina Idris,')
  await expect(page.locator('.inv-envelope-address')).toHaveText('For Amina Idris')
  await page.getByRole('button',{name:'View event',exact:true}).click()
  await expect(page.getByRole('heading',{name:event.name,exact:true}).first()).toBeVisible()
  await page.evaluate(()=>{history.pushState({},'', '/r/private-link-B');dispatchEvent(new PopStateEvent('popstate'))})
  await expect(page.getByText('Loading…',{exact:true})).toBeVisible()
  await expect(page.locator('.inv-opening')).toHaveCount(0)
  await expect(page.locator('.inv-opening-heading')).toHaveText('Dear Zara Noor,')
  await page.getByRole('button',{name:'View event',exact:true}).click()
  const keys=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('festio:envelope:')))
  expect(keys).toHaveLength(2)
  expect(keys.join()).not.toMatch(/private-link|Amina|Idris|Zara|Noor/)
  await page.goto('/r/private-link-A')
  await expect(page.getByRole('heading',{name:event.name,exact:true}).first()).toBeVisible()
  await expect(page.locator('.inv-opening')).toHaveCount(0)
})

test('shared links ignore supplied query names and use the generic fallback', async({page})=>{
  await setup(page)
  await page.goto('/rsvp/shared?first_name=Spoofed&last_name=Person')
  await expect(page.locator('.inv-opening-heading')).toHaveText('Dear Guest,')
  await expect(page.locator('.inv-envelope-address')).toHaveText('For Guest')
  await expect(page.locator('.inv-opening')).not.toContainText('Spoofed')
})

test('missing names fall back; names containing markup are literal text', async({page})=>{
  await setup(page,{'empty-link':{},'markup-link':{first_name:'<img src=x onerror=alert(1)>',last_name:'Example'}})
  await page.goto('/r/empty-link')
  await expect(page.locator('.inv-opening-heading')).toHaveText('Dear Guest,')
  await page.goto('/r/markup-link')
  await expect(page.locator('.inv-opening-heading')).toContainText('<img src=x onerror=alert(1)>')
  await expect(page.locator('.inv-opening img')).toHaveCount(0)
})

test('long personalized names fit mobile and the opening remains usable @mobile',async({page})=>{
  await setup(page,{'long-link':{first_name:'M'.repeat(100),last_name:'W'.repeat(100)}})
  await page.goto('/r/long-link')
  await expect(page.locator('.inv-opening-heading')).toBeVisible()
  expect(await page.locator('.inv-opening').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBeTruthy()
  await page.getByRole('button',{name:'View event',exact:true}).click()
  await expect(page.locator('.inv-opening')).toHaveCount(0)
})
