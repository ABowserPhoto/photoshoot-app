"use server";

/**
 * @deprecated Preview emails now use the Gmail API via `app/actions/previewEmail.ts`.
 * This re-export keeps older imports working.
 */
export { triggerPreviewEmail, type TriggerPreviewEmailResult } from "@/app/actions/previewEmail";
