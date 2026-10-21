import test from 'node:test'
import assert from 'node:assert/strict'
import { rememberSignupConsent, verifiedSignupConsent, clearSignupConsent } from '../src/lib/marketingConsent.mjs'
const storage = () => { const values = new Map(); return { getItem: k => values.get(k) || null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) } }
test('signup checkbox follows only the same verified UID and mailbox', () => {
  const s=storage(); rememberSignupConsent('one','ONE@example.com',true,s,1000)
  assert.deepEqual(verifiedSignupConsent({uid:'one',email:'one@example.com',emailVerified:false},s,2000),{})
  assert.deepEqual(verifiedSignupConsent({uid:'two',email:'one@example.com',emailVerified:true},s,2000),{})
  assert.deepEqual(verifiedSignupConsent({uid:'one',email:'other@example.com',emailVerified:true},s,2000),{})
  const header=verifiedSignupConsent({uid:'one',email:'one@example.com',emailVerified:true},s,2000)
  assert.equal(JSON.parse(decodeURIComponent(header['X-Festio-Attribution'])).consent_email,true)
  clearSignupConsent('one',s)
  assert.deepEqual(verifiedSignupConsent({uid:'one',email:'one@example.com',emailVerified:true},s,2000),{})
})
test('expired or malformed local choices never grant consent', () => {
 const s=storage(); rememberSignupConsent('one','one@example.com',true,s,1000)
 assert.deepEqual(verifiedSignupConsent({uid:'one',email:'one@example.com',emailVerified:true},s,1000+8*86400000),{})
 s.setItem('festio:signup-consent:one','broken')
 assert.deepEqual(verifiedSignupConsent({uid:'one',email:'one@example.com',emailVerified:true},s,2000),{})
})

test('automatic preview excludes historical contacts and missing eligibility proof', async () => {
 const {onboardingPreviewLeads}=await import('../src/lib/marketingConsent.mjs')
 const leads=[{id:'old',automation:{automatic_eligible:false}},{id:'unknown'},{id:'eligible',automation:{automatic_eligible:true}}]
 assert.deepEqual(onboardingPreviewLeads(leads,{enabled:true}).map(x=>x.id),['eligible'])
 assert.equal(onboardingPreviewLeads(leads,{enabled:false}).length,3)
})
