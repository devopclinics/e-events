# Venue and RSVP party self check-in

In **Event settings → Self check-in → Venue and RSVP party check-in**, set the venue latitude/longitude and allowed radius (25–1,000 metres). An organizer already at the venue can use **Use my current location as the venue**. Save the settings, then enable Self check-in.

**Require guests to be at the venue** checks a fresh device location on the server. Missing, stale (over 90 seconds), future-dated, inaccurate, or outside-boundary readings are rejected before anyone is admitted. Guests must allow browser location access. Staff scanning remains available when location cannot be determined. Device-reported locations are a proximity check, not tamper-proof proof of presence. Coordinates are not stored with attendance.

**Allow guests to check in the companions they registered** requires a personal invitation/pass credential. Open **Check in at the venue** from GuestHub Home or My Pass. The shared event QR at `/e/{event_code}` lets guests paste their personal invitation link. Names alone do not authorize party check-in. A registering guest can select themselves and their registered companions; a companion's link only authorizes their own admission, protecting parents/siblings. Junior credentials never gain family admission rights.

Guests explicitly select who has arrived and confirm everyone selected is present. Unselected guests remain unchecked. Each selection goes through the normal admission flow, including seating, cancelled tickets, required steps, existing group-pass restrictions and notifications. Results report each person separately; some admissions can succeed while others are denied. Repeating admission returns Already checked in. Phone location cannot prove that companions are physically present.

The settings belong to the event. Existing events with no configuration retain their current self check-in behavior. Duplicating an event copies the venue protection with the other self check-in settings; organizers must update coordinates if the venue changes. Personal invitation credentials travel in the URL fragment from GuestHub, avoiding their inclusion in page-request paths and referrers.

API: admin `PATCH /api/events/{event_id}/self-checkin-config`; public credential-scoped `POST /api/e/{code}/party` and `POST /api/e/{code}/party/checkin`. Venue protection also applies to legacy single-guest admission. Party-enabled events reject anonymous name search and single-guest-ID admission to prevent bypass.
