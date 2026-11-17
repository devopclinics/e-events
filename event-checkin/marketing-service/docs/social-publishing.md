# Festio social publishing

The Marketing → Content calendar workspace provides a separate social content
library and publishing queue. The previous content calendar remains accessible.
This feature does not enable lifecycle, campaign, sales, SMS or WhatsApp sending.

## Workflow

1. Upload JPEG/PNG images or MP4 video (200 MiB per file by default).
2. Create a post with one version per platform. Each version has its own caption,
   format, media and video title. Instagram image posts require JPEG. YouTube
   includes explicit visibility, audience and synthetic-media declarations.
3. Submit for review. A manager or platform superadmin approves the exact versions.
4. Schedule the approved post. Dates must include a timezone; the browser displays
   its local timezone and sends UTC. Editing requires returning to draft and clears
   approval. Attempted posts are immutable: create a new draft for new content.
5. Each platform has an independent delivery record. Successful records retain
   provider IDs and links. Failed platforms do not cause successful ones to repost.
6. TikTok is manual: open/download the media, publish using TikTok or an approved
   scheduler, then record the published link. Festio does not call TikTok Direct
   Post or represent this as automated delivery.

Content prepared in a chat can be pasted/imported as JSON, reviewed and saved.
The API accepts the same structure at `POST /api/marketing/social/posts`. Upload
assets first and use their returned `id` as `asset_id` for image/video variants.
This is an explicit transfer into the library, not a background connection to chat.

```json
{
  "title": "Create your next event",
  "notes": "Campaign prepared in our planning session",
  "variants": [
    {
      "platform": "facebook",
      "format": "text",
      "caption": "Bring your guests together with Festio.",
      "link_url": "https://festio.events/create-invitation"
    }
  ]
}
```

## Account setup

A platform superadmin configures credentials under Marketing → Social settings.
Secrets are encrypted using the existing Marketing credential cipher and are never
returned to the browser. Account connections are workspace-wide; owner-scoped
staff cannot access the new social workspace. Managers approve, schedule, cancel,
retry and reconcile. Workspace staff can prepare drafts and upload media.

### Facebook and Instagram

Create/configure a Meta developer app with Facebook Login for Business. Set its
valid OAuth redirect URI to:

`https://festio.events/api/marketing/social/oauth/facebook/callback`

Save the app ID, app secret and target Facebook Page ID, then choose **Authorize
Facebook + linked Instagram**. Authorize the Page and its connected Instagram
professional account. The callback obtains a long-lived user token, obtains the
Page token, and saves that Page and linked Instagram account. Review requirements
and access level depend on the app and account roles; Meta approval is external to
this implementation. Use **Test connection** for both platforms: it checks token
validity, publishing scopes and access to the configured account, rather than
only checking `/me`. Connection checks do not publish anything.

Supported direct formats: Facebook feed text/links, photo and video posts;
Instagram single JPEG and video Reels. Facebook Reels and Instagram carousels/
Stories are not implemented in this version. No trending-music or sticker editor
is provided. Asset aspect ratio, duration, codec and platform account limits are
ultimately validated by each provider. Check rendered assets before approval.

### YouTube

Enable YouTube Data API v3 in a Google Cloud project and configure an OAuth web
client and consent screen. Register:

`https://festio.events/api/marketing/social/oauth/youtube/callback`

Save the client ID and secret, then choose **Authorize YouTube**. The flow requests
upload and read-only scopes, saves the offline refresh token and selected channel
ID, and never sends those secrets back to the browser. Google consent-screen
publication/verification and test-user restrictions must be handled in the Cloud
project. Do not rely on short-lived testing-mode authorizations for unattended
production. **Test connection** refreshes access and confirms the target channel.

The adapter sends the stored MP4 using a resumable upload session, preserves its
provider ID, and checks video processing and requested visibility before marking
the delivery published. Shorts use the standard video upload API; YouTube decides
Shorts classification from the uploaded media. Use a suitable vertical source.

## Runtime configuration

All new delivery switches default to false, independently of the old
`MARKETING_OUTBOUND_ENABLED` and `MARKETING_SCHEDULER_ENABLED` switches.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MARKETING_SOCIAL_PUBLISHING_ENABLED` | `false` | Allow the new social worker to make delivery calls |
| `MARKETING_SOCIAL_SCHEDULER_ENABLED` | `false` | Start the dedicated 30-second queue worker |
| `MARKETING_SOCIAL_PUBLIC_ORIGIN` | `https://festio.events` | Canonical HTTPS origin for OAuth callbacks and public media |
| `MARKETING_SOCIAL_ASSET_DIR` | `/data/social-assets` | Durable media storage on the existing marketing PVC |
| `MARKETING_SOCIAL_MAX_ASSET_MB` | `200` | Maximum asset size, clamped to 1–500 MiB |
| `MARKETING_SOCIAL_DISK_RESERVE_MB` | `256` | Stop media uploads before using reserved database space (minimum 128 MiB) |
| `MARKETING_META_GRAPH_VERSION` | `v23.0` | Meta Graph API version |

YouTube also supports environment fallbacks `YOUTUBE_CLIENT_ID`,
`YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` and `YOUTUBE_CHANNEL_ID`.

Expose the `/api/marketing/social/assets/*/file` and OAuth callback routes through
the existing Marketing API ingress. Media links contain a signature and are
public to anyone possessing the link, including before approval. Only distribute
approved media externally; the library is not for confidential documents. Changing
the Marketing signing secret invalidates existing media links and encrypted
credentials, as it does for existing integrations. No user-supplied media URLs are
fetched by this server: uploads are stored locally and platform requests use fixed
API hosts. OAuth callbacks use one-use random state with a 10-minute expiry.

New tables are additive: `marketing_social_assets`, `marketing_social_posts`,
`marketing_social_deliveries`, `marketing_social_oauth_states`. Back up the Marketing
SQLite database **and** asset directory before rollout. Existing tables are not
rewritten. Keep the deployment's existing single-replica/Recreate PVC strategy.

## Reliability and operations

The worker conditionally claims each delivery in the database. A unique
post/platform constraint and conditional scheduling prevent duplicate queue rows.
It stores upload/container IDs before proceeding and polls those IDs instead of
recreating accepted content. Known safe temporary failures use bounded exponential
backoff. Definite failures can be retried by a manager after correcting the issue.

Timeouts, ambiguous writes and stale worker claims become **Needs review**. They
are never blindly resent. Check the actual platform account and reconcile using
the existing post ID and URL. If no post exists, investigate the provider outcome
before preparing a replacement draft. Reconciliation records a manager's explicit
confirmation; manual TikTok confirmation is also an operator assertion, not an API
verification. Delivered posts are not deleted by cancelling remaining deliveries.

The worker checks its publishing gate before each delivery. Changes to environment
configuration take effect on service restart; a gate cannot undo a request already
in flight. The frontend refreshes status every 30 seconds. All workflow actions
are audited. Delivery records intentionally exclude credentials and upload-session
URLs. This version tracks delivery, not reach, likes or conversion analytics.

## Validation and rollout

Run `python -m pytest -q` in `marketing-service`, and `npm ci && npm run build` in
`frontend`. Provider tests use mock transports; no public content is posted.
Browser-check draft creation, media previews, review, approval, timezone handling,
scheduling, cancellation and TikTok completion at desktop/mobile widths.

Deploy to staging with both new flags false. Verify account OAuth and read-only
connection checks there. Then enable **only** these social flags for a scoped
account publishing check using explicitly approved content. Confirm actual links
and visibility on every connected platform before production enablement. Keep
all existing email/sales flags as configured. Production rollout and developer
account authorization remain separate from merging this source implementation.

Official references checked November 17, 2026:

- https://developers.facebook.com/documentation/instagram-platform/content-publishing
- https://developers.facebook.com/documentation/pages-api/posts
- https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol
- https://developers.google.com/youtube/data/reference/rest/v3/videos/insert
- https://developers.tiktok.com/docs/en/content-sharing-guidelines
