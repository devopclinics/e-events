import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMeetingUrl } from '../src/lib/meetingUrl.mjs';
test('pasted meeting URLs accept a missing scheme and surrounding spaces', () => {
  for (const value of ['meet.google.com/uxc-vqko-mih', '  meet.google.com/uxc-vqko-mih  ']) assert.equal(normalizeMeetingUrl(value), 'https://meet.google.com/uxc-vqko-mih');
  for (const value of ['', 'https://meet.google.com/uxc-vqko-mih', 'http://example.com/meeting', 'javascript:alert(1)', 'not a link']) assert.equal(normalizeMeetingUrl(value), value);
});
