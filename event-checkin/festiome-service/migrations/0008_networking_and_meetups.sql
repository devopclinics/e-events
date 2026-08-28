CREATE TABLE IF NOT EXISTS connections (
    id VARCHAR(36) PRIMARY KEY,
    group_id VARCHAR(36) NOT NULL REFERENCES festiome_groups(id),
    requester_member_id VARCHAR(36) NOT NULL REFERENCES members(id),
    recipient_member_id VARCHAR(36) NOT NULL REFERENCES members(id),
    pair_key VARCHAR(80) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    responded_at TIMESTAMP,
    CONSTRAINT uq_connection_pair UNIQUE (group_id, pair_key),
    CONSTRAINT ck_connection_status CHECK (status IN ('pending','accepted','declined'))
);
CREATE INDEX IF NOT EXISTS ix_connections_group_id ON connections(group_id);
CREATE INDEX IF NOT EXISTS ix_connections_requester_member_id ON connections(requester_member_id);
CREATE INDEX IF NOT EXISTS ix_connections_recipient_member_id ON connections(recipient_member_id);
CREATE INDEX IF NOT EXISTS ix_connections_group_status ON connections(group_id, status, created_at);

CREATE TABLE IF NOT EXISTS meetups (
    id VARCHAR(36) PRIMARY KEY,
    group_id VARCHAR(36) NOT NULL REFERENCES festiome_groups(id),
    creator_member_id VARCHAR(36) NOT NULL REFERENCES members(id),
    title VARCHAR(160) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    location VARCHAR(255) NOT NULL DEFAULT '',
    starts_at TIMESTAMP NOT NULL,
    ends_at TIMESTAMP,
    capacity INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT ck_meetup_status CHECK (status IN ('scheduled','cancelled'))
);
CREATE INDEX IF NOT EXISTS ix_meetups_group_id ON meetups(group_id);
CREATE INDEX IF NOT EXISTS ix_meetups_creator_member_id ON meetups(creator_member_id);
CREATE INDEX IF NOT EXISTS ix_meetups_group_start ON meetups(group_id, starts_at);

CREATE TABLE IF NOT EXISTS meetup_attendees (
    id VARCHAR(36) PRIMARY KEY,
    meetup_id VARCHAR(36) NOT NULL REFERENCES meetups(id),
    member_id VARCHAR(36) NOT NULL REFERENCES members(id),
    status VARCHAR(20) NOT NULL DEFAULT 'going',
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT uq_meetup_attendee UNIQUE (meetup_id, member_id),
    CONSTRAINT ck_meetup_attendee_status CHECK (status IN ('going','interested','declined'))
);
CREATE INDEX IF NOT EXISTS ix_meetup_attendees_meetup_id ON meetup_attendees(meetup_id);
CREATE INDEX IF NOT EXISTS ix_meetup_attendees_member_id ON meetup_attendees(member_id);
CREATE INDEX IF NOT EXISTS ix_meetup_attendees_member ON meetup_attendees(member_id, status);
