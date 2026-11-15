# Staff invoice archive

This folder contains reviewed PDF snapshots and their catalogue metadata. The archive is independent of event and organization uploads. Only `require_superadmin` routes expose the catalogue and PDF bytes; do not copy these PDFs to frontend public assets.

To retain another prepared invoice, add the reviewed PDF here and a record to `catalog.json` with a stable unique ID, client, event title, safe filename, guest count, major-unit total, ISO currency, preparation date, event date (or null for tentative dates), and document status. Keep existing IDs and files stable. These status labels describe prepared documents, not verified payment or delivery.

The 150-guest Honeybols PDF includes three emails and three WhatsApp messages per guest and table/seat assignment. The 500-guest invoice is the separate previously prepared event on 22 May 2027.
