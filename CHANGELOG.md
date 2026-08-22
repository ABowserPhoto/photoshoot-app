# Changelog

All notable changes to Studio Workflow Suite are documented in this file.

### [1.6.0] - Automated Workflows, Planner Concurrency & Gmail Scanning

#### Added

- **Gmail to Lexoffice Invoice Scanner:** Background scanning API (`POST /api/finance/invoice-scanner`) extracting attachments, converting inline HTML/links to PDF via `jspdf`, and uploading directly to Lexoffice with deduplication & Gmail labeling (`Lexoffice/Processed`).
- **Social Scheduler Auto-Routing:** Integrated dual-route handler on Kanban 'Edited' drop. Auto-uploads selected hero shots to Supabase `social_media` bucket and routes to category-mapped Instagram profiles (`@Immo`, `@Food`, `@aaronbowser_photography`) into next open grid slots.
- **Multi-Tenant Studio Planner:** Isolated task visibility and timer concurrency per user. Added unassigned task auto-claiming upon starting/moving to Processing, along with multi-user collaborator support in task detail modals.
- **Jibble Break Sync:** One-way integration pausing active task timers when staff take a Jibble break, logging auto-pause audit reasons.

#### Fixed & Updated

- **Social Scheduler Clean Deletes:** Secured post deletion with `SUPABASE_SERVICE_ROLE_KEY`, ensuring sync between UI, database, and physical file deletion in Supabase Storage.
- **Client Gallery Watermark & Interaction:** Restored standard card click modal triggers and corner-only selection. Set single watermark signature to fill mode with 70% opacity overlay.
- **Admin Timer Overrides:** Admin-only duration editing modal added to Studio Planner and Kanban boards with real-time `started_at` offset calculations.
