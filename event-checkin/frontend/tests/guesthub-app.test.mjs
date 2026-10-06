import test from 'node:test';
import assert from 'node:assert/strict';
import { appHash, readAppRoute, appPhase, upcomingProgramme, requiredActions, partyMembers, guestServices, safeExternal } from '../src/components/guesthub/appModel.mjs';
test('routes preserve screen, day and person without carrying credentials', () => {
  const route = {
    screen: 'programme',
    day: '2026-12-24',
    session: 's1'
  };
  assert.deepEqual(readAppRoute(appHash(route)), {
    ...route,
    member: ''
  });
  assert.equal(readAppRoute('#garbage').screen, 'home');
  assert.equal(appHash({
    screen: 'pass',
    member: 'g1',
    token: 'SECRET'
  }).includes('SECRET'), false);
});
test('phase respects checkout and explicit end, does not treat date-only start as ending', () => {
  assert.equal(appPhase({
    event_date: '2026-01-01'
  }, {
    admitted: true
  }, Date.now()), 'during');
  assert.equal(appPhase({}, {
    admitted: true,
    checked_out: true
  }), 'before');
  assert.equal(appPhase({
    status: 'ended'
  }, {}), 'after');
});
test('up next excludes ended sessions and deduplicates program sources', () => {
  const now = Date.parse('2026-12-24T14:00:00Z');
  const s = {
    step_id: 'a',
    starts_at: '2026-12-24T14:30:00',
    ends_at: '2026-12-24T15:30:00'
  };
  assert.deepEqual(upcomingProgramme({
    days: [{
      segments: [s, {
        step_id: 'old',
        starts_at: '2026-12-24T12:00:00Z',
        ends_at: '2026-12-24T13:00:00Z'
      }]
    }],
    next_segments: [s]
  }, now), [s]);
});
test('native consent does not appear before admission; completed steps do not remain actions', () => {
  const j = {
    consent: {
      required: true,
      signed: false
    },
    steps: [{
      id: 'done',
      required: true,
      actionable: true,
      status: 'completed'
    }]
  };
  assert.equal(requiredActions(j, {
    admitted: false
  }).length, 0);
  assert.equal(requiredActions(j, {
    admitted: true
  })[0].id, 'consent');
});
test('party list alone does not expose party credentials; only authorized response does', () => {
  const hub = {
    guest: {
      id: 'me',
      qr_token: 'own'
    },
    party: [{
      id: 'other',
      qr_token: 'untrusted'
    }]
  };
  assert.equal(partyMembers(hub, null).find(p => p.id === 'other').qr_token, undefined);
  assert.equal(partyMembers(hub, {
    members: [{
      id: 'other',
      qr_token: 'allowed'
    }]
  }).find(p => p.id === 'other').qr_token, 'allowed');
});
test('services stay visible when enabled but guest access is unavailable', () => {
  const services = guestServices({
    id: 'e',
    engagement_enabled: true,
    festiome_enabled: true
  }, {
    guest: {}
  }, {
    menu_enabled: true
  });
  assert.equal(services.length, 3);
  assert.ok(services.every(s => !s.href));
  assert.equal(guestServices({
    engagement_enabled: true
  }, {}, {}, () => false).length, 0);
});
test('external instructions cannot become javascript or data links', () => {
  assert.equal(safeExternal('javascript:alert(1)'), '');
  assert.equal(safeExternal('data:text/html,a'), '');
  assert.equal(safeExternal('https://example.com/a'), 'https://example.com/a');
});
test('latest authoritative party status supersedes stale hub checkout after reentry', () => {
  const rows = partyMembers({
    guest: {
      id: 'me',
      qr_token: 'mine',
      checked_out: true
    }
  }, {
    members: [{
      id: 'me',
      qr_token: 'mine',
      checked_out: false,
      status: 'Checked in'
    }]
  });
  assert.equal(rows[0].checked_out, false);
  assert.equal(rows[0].is_self, true);
});
