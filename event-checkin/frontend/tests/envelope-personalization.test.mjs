import test from 'node:test'
import assert from 'node:assert/strict'
import { renderEnvelopeWording as render, personalEnvelopeScope } from '../src/components/invitations/envelopePersonalization.mjs'

test('names and aliases resolve, missing names have friendly fallbacks', () => {
  assert.equal(render('Dear {{first_name}} {{last_name}}, welcome {{full_name}} / {{guest_name}}.', {first_name:' Amina ',last_name:'Idris'}), 'Dear Amina Idris, welcome Amina Idris / Amina Idris.')
  assert.equal(render('Dear {{first_name}} {{last_name}},', null), 'Dear Guest,')
  assert.equal(render('Hello {{full_name}}', {first_name:'',last_name:'Idris'}), 'Hello Idris')
  assert.equal(render('Hello {{ FIRST_NAME }}', {first_name:'Amina'}), 'Hello Amina')
})
test('substitution is a single text pass and does not evaluate expressions', () => {
  assert.equal(render('{{first_name}} — {{full_name.constructor}}', {first_name:'{{last_name}}'}), '{{last_name}} — {{full_name.constructor}}')
  assert.equal(render('Dear {{first_name}}', {first_name:'<img src=x onerror=alert(1)>'}), 'Dear <img src=x onerror=alert(1)>')
  assert.equal(render('One\n{{full_name}}', null), 'One\nGuest')
})
test('completion scopes are stable, distinct, and contain neither names nor bearer tokens', async () => {
  const a = await personalEnvelopeScope('opaque-token-A'), b = await personalEnvelopeScope('opaque-token-B')
  assert.match(a, /^[a-f0-9]{64}$/); assert.notEqual(a,b)
  assert.equal(a,await personalEnvelopeScope('opaque-token-A'))
  assert.equal(a.includes('opaque-token-A'),false)
  assert.equal(await personalEnvelopeScope(''),'')
})

test('expanded copy is bounded even with many long name placeholders', () => {
  const result = render('{{full_name}} '.repeat(20), {first_name:'A'.repeat(100),last_name:'B'.repeat(100)})
  assert.equal(Array.from(result).length,320)
  assert.equal(result.endsWith('…'),true)
})
