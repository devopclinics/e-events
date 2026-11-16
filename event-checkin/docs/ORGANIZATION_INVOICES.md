# Organization invoice workspace

`/invoices` and Org Settings → Invoices share the organization workspace. Media links to the same component. It does not require an event. Signed-in organization owners and admins can create/edit drafts, issue a reviewed invoice, and download its saved PDF. Organization selectors are resolved from current memberships; platform superadmins can manage organizations explicitly. Inactive organizations cannot use the workspace.

The additive `organization_invoices` table stores organization ownership, stable references, validated monetary values in cents, optimistic versions and private PDF snapshots. Final issuance obtains a row lock, validates the saved version and required invoice/payment details, and stores the reviewed one-page PDF. Issued/imported invoices are immutable. Only drafts can be deleted. There is no payment collection or outbound email in this workflow.

All `/api/organization-invoices` operations resolve the requested organization and check owner/admin access before accessing a record. Looking up a different organization's ID in an authorized scope returns 404. Private PDFs are delivered with `private, no-store`; they are not put in public uploads. List queries defer PDF bytes.

Event dates are optional. Invoice date, optional balance due date, issuer identity/contact, currency, included services, descriptions, discounts, deposit percentage and bank details are supported. The preview/export shares the existing invoice style; the proposal PDF exporter retains its default three-page behavior and accepts an explicit one-page option for invoices.

Existing reviewed Honeybols invoices can be imported by explicitly calling `app.services.import_invoice_archive.import_archive(db, org, operator)`. This import preserves references and PDF bytes, is idempotent, and refuses to reassign an existing reference to another organization. The source archive and staff-only legacy endpoints remain available for compatibility. New records live in the database and require no release to create.
