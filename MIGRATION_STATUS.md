# CALVIN-LEDGER Android migration status

## Native workflows included in this build

- Expo / React Native Android shell, email authentication, password reset, secure session storage, branded splash / launcher assets, and bottom navigation with Ionicons.
- Home: household membership, create household and join household flows.
- Household: household expense create/edit/delete, category create/edit/archive/restore, monthly and termly/yearly category budget calculations, rollover/exclusion flags, monthly cap, people, quick-entry create/edit/use/delete, recurring bill due-day support, payment periods, obligations, obligation payment entries, monthly spending summaries, six-month spending bars, category budget progress, CSV/PDF reports and activity-history display.
- Personal: personal expense create/edit/delete, category create/edit/archive/restore, monthly cap, monthly/yearly category budget calculations, rollover/exclusion flags, monthly totals and household-paid contribution summary.
- Income: income create/edit/delete, category create/edit/archive/restore, month filtering, CSV/PDF exports.
- Bills: monthly calendar based on quick-entry `due_day`; paid status is determined by the exact `template_id` link, not amount matching; marking paid creates a linked household expense.
- Reports: monthly income/expense/net summary, six-month spending trend, category distribution, comparison with prior months, CSV and PDF exports.
- Debts: personal debt create/edit/delete, repayments, matching personal expense or income entries when a repayment category is configured, linked-entry cleanup when deleting repayments/debts, and automatic cleared status when fully repaid.
- Business calculations are ported from supplied `legacy-web/src/lib.js`: local month attribution, strict amount parsing, category budget rollover, monthly caps, and six-month totals.
- PDF/CSV exports use Android file storage and the system share sheet. PDF data is escaped before rendering; CSV values are protected against spreadsheet-formula injection.
- Offline queue follows the supplied web app's intentionally narrow scope: new household expense inserts are persisted in AsyncStorage and replayed on network restoration, app foreground and periodic retry. The queue key is retained (`expense-tracker-pending-writes`).
- Local release signing plugin and interactive APK build script for the existing keystore alias `wayawaya`. Passwords are prompted at build time and are not embedded in source or ZIP.

## Remaining gaps / validation required

- The original web app's admin-only user browsing and read-only account switching are not yet ported. Account deletion and invite-link deep-link auto-join also require native flows.
- The original web app's full debt UX includes some scope/admin views and more payment-history presentation than the native screen; verify the current personal debt path against live data before relying on it.
- The original offline implementation queues only new household expense inserts. This native version intentionally does not claim offline reads or offline edits/deletes, or offline writes for personal expenses, income, debts, categories, obligations or payments. A timeout after a server-side insert commit can theoretically cause a duplicate retry, matching the original web queue's limitation.
- Household activity history is read from `audit_log`; not every native mutation currently writes a matching audit row. Audit coverage should be completed if full history parity is required.
- Supabase RLS, schema compatibility, PDF/CSV sharing, Android build/signature, and end-to-end CRUD must be tested against the user's actual Supabase project and Mac environment. No live backend or signing keystore is available in this packaging environment.

The complete supplied React source is preserved under `legacy-web/src/` for direct comparison and further parity work. No service-role key or source `.env` was included.
