# Bird 10DLC Campaign

Festio SMS uses Bird's 10DLC campaign registration for US long-code traffic.
The backend includes an operator script that builds the compliant 10DLC brand
and campaign bodies from the same identity and SMS copy used by the app.

Bird's API can charge registration or resubmission fees. The script is dry-run
by default and only calls Bird when `--submit` is passed.

## Current Festio registration

Workspace:

```text
bb047250-0922-4b22-946a-fe476e2b2ea3
```

Approved Festio brand:

```text
Brand ID: c16d7252-9726-4e31-94df-036f00358e2e
Company: FOHMA Solutions LLC
Display: Festio
Website: https://festio.events
Contact: muritala@festio.events
Status: APPROVED
```

Current campaign:

```text
Campaign ID: 03086b58-dba3-435e-95ec-837884364881
TCR/DCA campaign code from latest decline: CM9VGC4
Name: Festio - Event Ticket & Check-in Notifications
Use case: LOW_VOLUME (Bird dashboard label: Low Volume Mixed)
Sub-use cases: ACCOUNT_NOTIFICATION, CUSTOMER_CARE
Status: PENDING
Subscription status: planned
Created: 2026-07-03T17:36:09.92Z
Last updated: 2026-07-08T15:53:28.992Z
```

Check live status:

```bash
cd /home/dev/events/platform-tutor/event-checkin/backend
python3 scripts/bird_10dlc_campaign.py --list-campaigns --brand-id c16d7252-9726-4e31-94df-036f00358e2e
```

When the campaign is `APPROVED`, activate/subscribe it in Bird and assign the
US SMS channel/number to the approved campaign if Bird does not do this
automatically.

## Commands

From `event-checkin/backend`:

```bash
# Find the approved Festio / FOHMA brand ID in the current workspace.
python3 scripts/bird_10dlc_campaign.py --list-brands

# Preview the corrected Festio / FOHMA brand payload.
python3 scripts/bird_10dlc_campaign.py --create-brand

# Create the corrected brand in Bird.
python3 scripts/bird_10dlc_campaign.py --create-brand --submit

# After Bird approves the new brand, preview the corrected campaign payload.
python3 scripts/bird_10dlc_campaign.py --brand-id <new_brand_id>

# Create the campaign under the corrected brand.
python3 scripts/bird_10dlc_campaign.py --brand-id <new_brand_id> --submit
```

Only use the Bird campaign resource ID when the existing brand is already correct.
Do not use the DCA/TCR short code from the rejection text, such as `CM9VGC4`,
as the API `--campaign-id`; Bird's API returns `Invalid value for campaignID`
for that code. Use the UUID shown by `--list-campaigns`.
If the old campaign belongs to a wrong brand, create a new campaign under the
new brand instead.

```bash
# Preview resubmitting a declined campaign under a corrected existing brand.
python3 scripts/bird_10dlc_campaign.py --brand-id <brand_id> --campaign-id 03086b58-dba3-435e-95ec-837884364881

# Resubmit that declined campaign.
python3 scripts/bird_10dlc_campaign.py --brand-id <brand_id> --campaign-id 03086b58-dba3-435e-95ec-837884364881 --submit
```

You can also set these environment variables in `backend/.env`:

```bash
BIRD_TCR_BRAND_ID=<brand_id>
BIRD_TCR_CAMPAIGN_ID=03086b58-dba3-435e-95ec-837884364881
BIRD_TCR_USECASE=LOW_VOLUME
BIRD_TCR_SUB_USECASES=ACCOUNT_NOTIFICATION,CUSTOMER_CARE
BIRD_TCR_BRAND_ENTITY_TYPE=PRIVATE_PROFIT
BIRD_TCR_BRAND_DISPLAY_NAME=Festio
BIRD_TCR_BRAND_COMPANY_NAME=FOHMA Solutions LLC
BIRD_TCR_BRAND_EIN=332603330
BIRD_TCR_BRAND_WEBSITE=https://festio.events
BIRD_TCR_BRAND_EMAIL=muritala@festio.events
BIRD_TCR_BRAND_BUSINESS_CONTACT_EMAIL=muritala@festio.events
```

Then run:

```bash
python3 scripts/bird_10dlc_campaign.py
python3 scripts/bird_10dlc_campaign.py --submit
```

## Troubleshooting

- `unknown usecase: LOW_VOLUME_MIXED`: use the API enum `LOW_VOLUME`. Bird's
  dashboard label is `Low Volume Mixed`, but the API value is different.
- `no credit available`: add Bird billing credit or a payment method. Campaign
  creation charges registration and minimum commitment fees.
- `Personal, free and group email IDs are not supported`: use a named business
  mailbox on the Festio domain, such as `muritala@festio.events`, not
  `info@...`, Gmail, or a different-domain address.
- `BRAND_INCONSISTENCIES`: verify the TCR brand, website, privacy policy, terms,
  message samples, and actual SMS copy all use the same `Festio` /
  `FOHMA Solutions LLC` identity.

## Notes

- Before submitting, verify the Bird brand record itself matches the campaign:
  legal company, display name, and website should clearly align with
  `FOHMA Solutions LLC`, `Festio`, and `https://festio.events`. If the brand
  website points somewhere else, the campaign can still fail with brand
  inconsistency even when the campaign payload is correct.
- Bird's approved TCR brands cannot change core fields such as `companyName`,
  `entityType`, `ein`, or `einIssuingCountry`. If those are wrong, create a new
  brand and create a new campaign under that brand.
- Bird rejects free, personal, and group/role emails for 10DLC brand contact.
  Use a named mailbox on the Festio domain, such as `muritala@festio.events`,
  and make sure it can receive mail before submitting.
- Bird's dashboard label `Low Volume Mixed` maps to API use case `LOW_VOLUME`.
  Override with `--usecase` and `--sub-usecases` if Bird returns a use-case
  validation error.
- Include opt-in screenshots or a public evidence URL with `--attachment-url` if
  Bird asks for proof. The script also includes the opt-in page details in
  `messageFlow`.
- Keep the public website, privacy policy, terms, sample messages, and actual
  SMS copy aligned on the `Festio` brand.
