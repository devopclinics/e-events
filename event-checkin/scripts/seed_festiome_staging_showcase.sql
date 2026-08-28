-- Idempotent, additive showcase data for the staging MBF Summit FestioMe group.
-- This script never deletes existing groups, members, channels, or messages.
\set group_id '8d3541b5-bc1e-474d-9fe1-770bfdcfab61'

BEGIN;

UPDATE members
SET bio = CASE display_name
      WHEN 'DevOps Clinics' THEN 'Event organizer · community host'
      WHEN 'Redesign E2E' THEN 'Product and experience design'
      WHEN 'test3 test' THEN 'Youth programs and community service'
      WHEN 'TEST2 k' THEN 'Leadership and volunteer coordination'
      WHEN 'test test' THEN 'Technology and event operations'
      ELSE bio
    END,
    interest_tags = CASE display_name
      WHEN 'DevOps Clinics' THEN '["leadership","community service","technology"]'::json
      WHEN 'Redesign E2E' THEN '["experience design","technology","leadership"]'::json
      WHEN 'test3 test' THEN '["youth programs","community service","networking"]'::json
      WHEN 'TEST2 k' THEN '["leadership","volunteering","education"]'::json
      WHEN 'test test' THEN '["technology","operations","networking"]'::json
      ELSE interest_tags
    END
WHERE group_id = :'group_id' AND removed_at IS NULL;

INSERT INTO members (id, group_id, identity_kind, identity_ref, display_name, role, rules_accepted_version, joined_at, bio, interest_tags)
VALUES
  ('f5000000-0000-4000-8000-000000000001', :'group_id', 'guest', 'staging-community-01', 'Aisha Khan', 'member', 0, now() - interval '8 days', 'SRE engineer · interested in resilient communities', '["technology","leadership","community service"]'),
  ('f5000000-0000-4000-8000-000000000002', :'group_id', 'guest', 'staging-community-02', 'Daniel Okafor', 'member', 0, now() - interval '7 days', 'Community builder and DevOps consultant', '["technology","networking","leadership"]'),
  ('f5000000-0000-4000-8000-000000000003', :'group_id', 'guest', 'staging-community-03', 'Maya Chen', 'member', 0, now() - interval '6 days', 'Engineering leader focused on mentorship', '["leadership","youth programs","technology"]'),
  ('f5000000-0000-4000-8000-000000000004', :'group_id', 'guest', 'staging-community-04', 'Hamza Ali', 'member', 0, now() - interval '5 days', 'Platform engineer and volunteer coordinator', '["volunteering","technology","community service"]'),
  ('f5000000-0000-4000-8000-000000000005', :'group_id', 'guest', 'staging-community-05', 'Sara Malik', 'member', 0, now() - interval '4 days', 'Youth mentor and program organizer', '["youth programs","education","community service"]'),
  ('f5000000-0000-4000-8000-000000000006', :'group_id', 'guest', 'staging-community-06', 'Rayan Ahmed', 'member', 0, now() - interval '3 days', 'Cloud architect who enjoys connecting people', '["technology","networking","education"]')
ON CONFLICT (group_id, identity_kind, identity_ref) DO UPDATE
SET display_name = EXCLUDED.display_name, bio = EXCLUDED.bio, interest_tags = EXCLUDED.interest_tags, removed_at = NULL;

INSERT INTO channels (id, group_id, name, slug, description, kind, is_private, is_dm, created_by_member_id, archived, created_at)
VALUES
  ('fc000000-0000-4000-8000-000000000001', :'group_id', 'Announcements', 'announcements', 'Official MBF Summit community updates', 'announcement', false, false, (SELECT id FROM members WHERE group_id = :'group_id' AND role = 'owner' LIMIT 1), false, now() - interval '7 days'),
  ('fc000000-0000-4000-8000-000000000002', :'group_id', 'Session 3 · MBF Summit Formal Opening', 'session-3-mbf-summit-formal-opening', 'Continue the formal opening conversation and share reflections', 'discussion', false, false, (SELECT id FROM members WHERE group_id = :'group_id' AND role = 'owner' LIMIT 1), false, now() - interval '6 days'),
  ('fc000000-0000-4000-8000-000000000003', :'group_id', 'Young Professionals', 'young-professionals', 'Career, mentorship, and peer networking', 'discussion', false, false, (SELECT id FROM members WHERE group_id = :'group_id' AND role = 'owner' LIMIT 1), false, now() - interval '5 days'),
  ('fc000000-0000-4000-8000-000000000004', :'group_id', 'Community Service', 'community-service', 'Ideas and opportunities to serve together', 'discussion', false, false, (SELECT id FROM members WHERE group_id = :'group_id' AND role = 'owner' LIMIT 1), false, now() - interval '4 days'),
  ('fc000000-0000-4000-8000-000000000005', :'group_id', 'Volunteers', 'volunteers', 'Coordination and support for the volunteer team', 'discussion', false, false, (SELECT id FROM members WHERE group_id = :'group_id' AND role = 'owner' LIMIT 1), false, now() - interval '3 days')
ON CONFLICT (group_id, slug) DO UPDATE
SET name = EXCLUDED.name, description = EXCLUDED.description, kind = EXCLUDED.kind, archived = false;

INSERT INTO messages (id, group_id, channel_id, author_member_id, body, created_at, published_at)
VALUES
  ('fd000000-0000-4000-8000-000000000001', :'group_id', 'fc000000-0000-4000-8000-000000000001', (SELECT id FROM members WHERE group_id = :'group_id' AND role = 'owner' LIMIT 1), 'Welcome to the MBF Summit community. Introduce yourself, explore the session conversations, and connect with someone new.', now() - interval '5 days', now() - interval '5 days'),
  ('fd000000-0000-4000-8000-000000000002', :'group_id', 'fc000000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000001', 'What is one outcome you hope our community carries beyond this summit?', now() - interval '3 days', now() - interval '3 days'),
  ('fd000000-0000-4000-8000-000000000003', :'group_id', 'fc000000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000002', 'I would love to see a cross-city mentoring circle continue after the event.', now() - interval '2 days 20 hours', now() - interval '2 days 20 hours'),
  ('fd000000-0000-4000-8000-000000000004', :'group_id', 'fc000000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000003', 'The opening message on service was powerful. What local project could we start together?', now() - interval '2 days', now() - interval '2 days'),
  ('fd000000-0000-4000-8000-000000000005', :'group_id', 'fc000000-0000-4000-8000-000000000003', 'f5000000-0000-4000-8000-000000000005', 'Young professionals meetup after the afternoon session—who would like to join?', now() - interval '30 hours', now() - interval '30 hours'),
  ('fd000000-0000-4000-8000-000000000006', :'group_id', 'fc000000-0000-4000-8000-000000000003', 'f5000000-0000-4000-8000-000000000006', 'I can share a short career roadmap template during the meetup.', now() - interval '24 hours', now() - interval '24 hours'),
  ('fd000000-0000-4000-8000-000000000007', :'group_id', 'fc000000-0000-4000-8000-000000000004', 'f5000000-0000-4000-8000-000000000004', 'Could we organize one coordinated service day across all participating communities?', now() - interval '20 hours', now() - interval '20 hours'),
  ('fd000000-0000-4000-8000-000000000008', :'group_id', 'fc000000-0000-4000-8000-000000000004', 'f5000000-0000-4000-8000-000000000001', 'Yes—let us collect project ideas here and vote on the first pilot.', now() - interval '18 hours', now() - interval '18 hours'),
  ('fd000000-0000-4000-8000-000000000009', :'group_id', 'fc000000-0000-4000-8000-000000000005', (SELECT id FROM members WHERE group_id = :'group_id' AND role = 'owner' LIMIT 1), 'Volunteer briefing starts 30 minutes before the formal opening. Please check in here when you arrive.', now() - interval '16 hours', now() - interval '16 hours'),
  ('fd000000-0000-4000-8000-000000000010', :'group_id', 'fc000000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000005', 'I hope we make space for youth voices in every follow-up conversation.', now() - interval '8 hours', now() - interval '8 hours'),
  ('fd000000-0000-4000-8000-000000000011', :'group_id', 'fc000000-0000-4000-8000-000000000003', 'f5000000-0000-4000-8000-000000000003', 'Happy to mentor anyone exploring engineering leadership.', now() - interval '6 hours', now() - interval '6 hours'),
  ('fd000000-0000-4000-8000-000000000012', :'group_id', 'fc000000-0000-4000-8000-000000000004', 'f5000000-0000-4000-8000-000000000002', 'A shared volunteer directory would make collaboration much easier.', now() - interval '4 hours', now() - interval '4 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO meetups (id, group_id, creator_member_id, title, description, location, starts_at, ends_at, capacity, status, created_at)
VALUES
  ('fe000000-0000-4000-8000-000000000001', :'group_id', 'f5000000-0000-4000-8000-000000000005', 'Young professionals coffee circle', 'Meet peers, exchange goals, and find an accountability partner.', 'Atrium coffee bar', now() + interval '2 hours', now() + interval '3 hours', 20, 'scheduled', now()),
  ('fe000000-0000-4000-8000-000000000002', :'group_id', 'f5000000-0000-4000-8000-000000000002', 'Community project roundtable', 'Turn summit ideas into one practical collaborative project.', 'Breakout room B', now() + interval '1 day 3 hours', now() + interval '1 day 4 hours', 30, 'scheduled', now()),
  ('fe000000-0000-4000-8000-000000000003', :'group_id', 'f5000000-0000-4000-8000-000000000006', 'Technology leaders networking', 'An informal conversation for technology and operations leaders.', 'Main lobby', now() + interval '2 days', now() + interval '2 days 1 hour', 15, 'scheduled', now())
ON CONFLICT (id) DO UPDATE
SET title = EXCLUDED.title, description = EXCLUDED.description, location = EXCLUDED.location,
    starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, capacity = EXCLUDED.capacity,
    status = 'scheduled';

INSERT INTO meetup_attendees (id, meetup_id, member_id, status, created_at, updated_at)
VALUES
  ('fa000000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000005', 'going', now(), now()),
  ('fa000000-0000-4000-8000-000000000002', 'fe000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000003', 'going', now(), now()),
  ('fa000000-0000-4000-8000-000000000003', 'fe000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000006', 'going', now(), now()),
  ('fa000000-0000-4000-8000-000000000004', 'fe000000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000002', 'going', now(), now()),
  ('fa000000-0000-4000-8000-000000000005', 'fe000000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000001', 'interested', now(), now()),
  ('fa000000-0000-4000-8000-000000000006', 'fe000000-0000-4000-8000-000000000003', 'f5000000-0000-4000-8000-000000000006', 'going', now(), now())
ON CONFLICT (meetup_id, member_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now();

INSERT INTO connections (id, group_id, requester_member_id, recipient_member_id, pair_key, status, created_at, responded_at)
VALUES
  ('ff000000-0000-4000-8000-000000000001', :'group_id', 'f5000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000002', least('f5000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000002') || '|' || greatest('f5000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000002'), 'accepted', now() - interval '2 days', now() - interval '2 days'),
  ('ff000000-0000-4000-8000-000000000002', :'group_id', 'f5000000-0000-4000-8000-000000000003', 'f5000000-0000-4000-8000-000000000005', least('f5000000-0000-4000-8000-000000000003','f5000000-0000-4000-8000-000000000005') || '|' || greatest('f5000000-0000-4000-8000-000000000003','f5000000-0000-4000-8000-000000000005'), 'accepted', now() - interval '1 day', now() - interval '1 day'),
  ('ff000000-0000-4000-8000-000000000003', :'group_id', 'f5000000-0000-4000-8000-000000000004', 'f5000000-0000-4000-8000-000000000006', least('f5000000-0000-4000-8000-000000000004','f5000000-0000-4000-8000-000000000006') || '|' || greatest('f5000000-0000-4000-8000-000000000004','f5000000-0000-4000-8000-000000000006'), 'accepted', now() - interval '12 hours', now() - interval '12 hours'),
  ('ff000000-0000-4000-8000-000000000004', :'group_id', 'f5000000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000005', least('f5000000-0000-4000-8000-000000000002','f5000000-0000-4000-8000-000000000005') || '|' || greatest('f5000000-0000-4000-8000-000000000002','f5000000-0000-4000-8000-000000000005'), 'pending', now() - interval '3 hours', NULL)
ON CONFLICT (group_id, pair_key) DO NOTHING;

INSERT INTO connections (id, group_id, requester_member_id, recipient_member_id, pair_key, status, created_at, responded_at)
SELECT seeded.id, :'group_id', existing.id, seeded.other_id,
       least(existing.id, seeded.other_id) || '|' || greatest(existing.id, seeded.other_id),
       seeded.status, now() - interval '10 hours', CASE WHEN seeded.status = 'accepted' THEN now() - interval '9 hours' ELSE NULL END
FROM members existing
CROSS JOIN (VALUES
  ('ff000000-0000-4000-8000-000000000005', 'f5000000-0000-4000-8000-000000000001', 'accepted'),
  ('ff000000-0000-4000-8000-000000000006', 'f5000000-0000-4000-8000-000000000002', 'accepted'),
  ('ff000000-0000-4000-8000-000000000007', 'f5000000-0000-4000-8000-000000000003', 'pending')
) AS seeded(id, other_id, status)
WHERE existing.group_id = :'group_id' AND existing.display_name = 'test3 test' AND existing.removed_at IS NULL
ON CONFLICT (group_id, pair_key) DO NOTHING;

INSERT INTO meetup_attendees (id, meetup_id, member_id, status, created_at, updated_at)
SELECT 'fa000000-0000-4000-8000-000000000007', 'fe000000-0000-4000-8000-000000000001', id, 'going', now(), now()
FROM members WHERE group_id = :'group_id' AND display_name = 'test3 test' AND removed_at IS NULL
ON CONFLICT (meetup_id, member_id) DO UPDATE SET status = 'going', updated_at = now();

INSERT INTO connections (id, group_id, requester_member_id, recipient_member_id, pair_key, status, created_at, responded_at)
SELECT seeded.id, :'group_id', existing.id, seeded.other_id,
       least(existing.id, seeded.other_id) || '|' || greatest(existing.id, seeded.other_id),
       seeded.status, now() - interval '8 hours', CASE WHEN seeded.status = 'accepted' THEN now() - interval '7 hours' ELSE NULL END
FROM members existing
CROSS JOIN (VALUES
  ('ff000000-0000-4000-8000-000000000008', 'f5000000-0000-4000-8000-000000000001', 'accepted'),
  ('ff000000-0000-4000-8000-000000000009', 'f5000000-0000-4000-8000-000000000004', 'accepted'),
  ('ff000000-0000-4000-8000-000000000010', 'f5000000-0000-4000-8000-000000000006', 'pending')
) AS seeded(id, other_id, status)
WHERE existing.group_id = :'group_id' AND existing.display_name = 'TEST2 k' AND existing.removed_at IS NULL
ON CONFLICT (group_id, pair_key) DO NOTHING;

INSERT INTO meetup_attendees (id, meetup_id, member_id, status, created_at, updated_at)
SELECT 'fa000000-0000-4000-8000-000000000008', 'fe000000-0000-4000-8000-000000000001', id, 'going', now(), now()
FROM members WHERE group_id = :'group_id' AND display_name = 'TEST2 k' AND removed_at IS NULL
ON CONFLICT (meetup_id, member_id) DO UPDATE SET status = 'going', updated_at = now();

INSERT INTO points_entries (id, group_id, member_id, points, reason, source_ref, created_at)
SELECT 'fb000000-0000-4000-8000-' || lpad(row_number() OVER ()::text, 12, '0'), :'group_id', id,
       5 + (row_number() OVER ()::int * 2), 'staging_showcase', 'staging-profile:' || id, now() - interval '1 day'
FROM members WHERE group_id = :'group_id' AND removed_at IS NULL
ON CONFLICT (id) DO NOTHING;

COMMIT;
