"use server";

import { createClient } from "@supabase/supabase-js";
import { createGmailDraft } from "@/lib/google";
import { buildPreviewEmailContent } from "@/lib/previewEmail";

export type TriggerPreviewEmailResult = {
  ok: boolean;
  error?: string;
  gmailDraftId?: string;
};

/**
 * Loads task contact info, builds the preview gallery email HTML, and creates a Gmail draft.
 * Replaces the legacy Zapier preview webhook.
 */
export async function triggerPreviewEmail(taskId: string): Promise<TriggerPreviewEmailResult> {
  try {
    const trimmedId = taskId?.trim() ?? "";
    if (!trimmedId) {
      return { ok: false, error: "taskId is required." };
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    if (!supabaseUrl || !supabaseKey) {
      return { ok: false, error: "Supabase is not configured." };
    }

    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

    const { data: row, error } = await supabase
      .from("tasks")
      .select(
        "id, email, email_cc, contact_first_name, contact_last_name, company_name, shoot_location, photoshoot_date, photoshoot_type"
      )
      .eq("id", trimmedId)
      .maybeSingle();

    if (error) {
      return { ok: false, error: error.message };
    }
    if (!row) {
      return { ok: false, error: "Task not found." };
    }

    const clientEmail = typeof row.email === "string" ? row.email.trim() : "";
    if (!clientEmail) {
      return { ok: false, error: "Task has no client email address." };
    }

    const nameFromContact = [row.contact_first_name, row.contact_last_name]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join(" ")
      .trim();
    const clientName =
      nameFromContact ||
      (typeof row.company_name === "string" ? row.company_name.trim() : "") ||
      "Client";
    const shootLocation = typeof row.shoot_location === "string" ? row.shoot_location.trim() : "";
    const photoshootType =
      typeof row.photoshoot_type === "string" ? row.photoshoot_type.trim() : "";
    const ccEmails = typeof row.email_cc === "string" ? row.email_cc.trim() : "";

    const shootId = String(row.id);
    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || "https://workflow.abowserphoto.com").replace(
      /\/$/,
      ""
    );
    const previewLink = `${baseUrl}/gallery/${shootId}`;

    const { emailVariant, subject, htmlBody, plainTextBody } = buildPreviewEmailContent({
      photoshootType,
      previewLink,
      clientName,
      shootLocation,
    });

    console.log("CREATING PREVIEW GMAIL DRAFT:", {
      email: clientEmail,
      link: previewLink,
      shootLocation,
      photoshootType,
      emailVariant,
    });

    const draft = await createGmailDraft(clientEmail, subject, htmlBody, undefined, undefined, {
      plainTextFallback: plainTextBody,
      ...(ccEmails ? { cc: ccEmails } : {}),
    });

    return { ok: true, gmailDraftId: draft.id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to create preview email draft.",
    };
  }
}
