import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizePhone, phoneInputSettings } from '../src/lib/rsvpPhone.mjs'

const us = { timezone: 'America/Indiana/Indianapolis' }
const nigeria = { timezone: 'Africa/Lagos' }

for (const [name, raw, event, expected] of [
  ['NCNMO local U.S. phone', '(317) 555-0123', us, '+13175550123'],
  ['U.S. area code 234 must not be mistaken for Nigeria', '2345550123', us, '+12345550123'],
  ['U.S. number already carrying 1', '1 317 555 0123', us, '+13175550123'],
  ['explicit U.S. phone at Nigerian event', '+1 (317) 555-0123', nigeria, '+13175550123'],
  ['explicit Nigerian phone at U.S. event', '+234 801 234 5678', us, '+2348012345678'],
  ['international 00 prefix', '0044 7700 900123', us, '+447700900123'],
  ['explicit international phone at an unknown location', '+44 7700 900123', {}, '+447700900123'],
  ['Nigerian local phone with trunk zero', '0801 234 5678', nigeria, '+2348012345678'],
  ['Nigerian local phone without trunk zero', '8012345678', nigeria, '+2348012345678'],
  ['Nigerian phone already carrying 234', '2348012345678', nigeria, '+2348012345678'],
  ['blank optional U.S. phone', '  ', us, ''],
  ['blank optional Nigerian phone', '', nigeria, ''],
]) test(name, () => assert.equal(normalizePhone(raw, event), expected))

for (const [name, raw, event] of [
  ['reject accidental extra U.S. digit', '31755501230', us],
  ['reject short U.S. phone', '317555012', us],
  ['require explicit international code for unknown event location', '3175550123', {}],
  ['do not assume all Americas use +1', '5551234567', { timezone: 'America/Sao_Paulo' }],
  ['reject letters instead of silently removing them', '3175550123oops', us],
  ['reject repeated international plus', '++13175550123', us],
  ['reject bare plus', '+', us],
]) test(name, () => assert.throws(() => normalizePhone(raw, event)))

test('event timezone controls guidance consistently', () => {
  for (const timezone of ['America/Indiana/Indianapolis', 'America/New_York', 'America/Chicago',
    'America/North_Dakota/Center', 'Pacific/Honolulu', 'America/Toronto', 'US/Pacific']) {
    assert.equal(phoneInputSettings({ timezone }).callingCode, '1')
  }
  assert.equal(phoneInputSettings(nigeria).callingCode, '234')
  assert.equal(phoneInputSettings({ timezone: 'Europe/Paris' }).callingCode, '')
})
