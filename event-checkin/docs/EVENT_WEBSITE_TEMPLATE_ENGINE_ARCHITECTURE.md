# Event Website Template Engine

## Current architecture

Event data is stored once in `SiteContent`. The saved site records only a `template_family` identifier beside that content. Published releases snapshot both values, preserving the existing draft, preview, publish, rollback, and public URL behavior.

The public renderer uses shared programme, track, speaker, feature, venue, registration, FAQ, Festio Live, FestioMe, navigation, and footer helpers. Template configuration changes presentation while those sections continue to read the same content object.

## Template library

The library provides ten organizer-facing designs:

- Modern Professional
- Clean Elegant
- Image-focused Storytelling
- Bold & Dynamic
- Card-based Friendly
- Conference Programme
- Split Visual
- Immersive Inspirational
- Programme Showcase
- Elegant Countdown

Legacy `community`, `conference`, and `celebration` identifiers remain valid and map to a corresponding modern design. Existing published release snapshots therefore continue to render without a database migration.

## Editor behavior

Design Studio contains a Design step with a controlled template gallery. The live preview uses the current event's actual content and supports desktop, tablet, and mobile widths. Selecting a design updates only the draft template identifier. The public website changes only after the organizer saves and publishes through the existing workflow.

## Data and integrations

Event identity, dates, and venue continue to synchronize from Event Setup. Programme and speakers continue to import from their existing event sources. RSVP, Festio Live, FestioMe, venue maps, navigation, uploaded media, feature sections, and contact links remain shared across templates.

## Safety and validation

Template identifiers are schema validated. URLs and uploaded images continue through existing validation. Public pages retain a no-script content security policy; programme filtering remains keyboard-operable HTML/CSS. Missing sections are omitted rather than leaving broken controls.
