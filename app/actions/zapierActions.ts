"use server";

import { createClient } from "@supabase/supabase-js";
import { fetchWithTimeout, toFetchErrorMessage } from "@/lib/server/fetchWithTimeout";

export type TriggerPreviewEmailResult = {
  ok: boolean;
  error?: string;
};

/**
 * Loads task contact info, builds the client gallery URL, and POSTs to Zapier for the preview email.
 */
export async function triggerPreviewEmail(taskId: string): Promise<TriggerPreviewEmailResult> {
  try {
    const trimmedId = taskId?.trim() ?? "";
    if (!trimmedId) {
      return { ok: false, error: "taskId is required." };
    }

    const webhook = process.env.ZAPIER_WEBHOOK_PREVIEW?.trim();
    if (!webhook) {
      return { ok: false, error: "ZAPIER_WEBHOOK_PREVIEW is not configured." };
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return { ok: false, error: "Supabase is not configured." };
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    let row:
      | {
          id: string | number;
          email: string | null;
          contact_first_name: string | null;
          contact_last_name: string | null;
          company_name: string | null;
          shoot_location: string | null;
          photoshoot_date: string | null;
        }
      | null = null;
    try {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, email, contact_first_name, contact_last_name, company_name, shoot_location, photoshoot_date")
        .eq("id", trimmedId)
        .maybeSingle();

      if (error) {
        return { ok: false, error: error.message };
      }
      row = data;
    } catch (error) {
      return {
        ok: false,
        error: `Supabase request failed: ${error instanceof Error ? error.message : "network error"}`,
      };
    }

    if (!row) {
      return { ok: false, error: "Task not found." };
    }

    const clientEmail = typeof row.email === "string" ? row.email.trim() : "";
    const nameFromContact = [row.contact_first_name, row.contact_last_name]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join(" ")
      .trim();
    const clientName =
      nameFromContact ||
      (typeof row.company_name === "string" ? row.company_name.trim() : "") ||
      "Client";
    const shootLocation = typeof row.shoot_location === "string" ? row.shoot_location.trim() : "";
    const shootDate = typeof row.photoshoot_date === "string" ? row.photoshoot_date.trim() : "";

    const base =
      (process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? "https://workflow.abowserphoto.com").replace(/\/$/, "");
    const previewLink = `${base}/gallery/${String(row.id)}`;
    console.log("SENDING TO ZAPIER:", { email: clientEmail, link: previewLink, shootLocation, shootDate });

    let response: Response;
    try {
      response = await fetchWithTimeout(
        webhook,
        {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientEmail,
          clientName,
          previewLink,
          shootLocation,
          shootDate,
          taskId: String(row.id),
        }),
        },
        10_000
      );
    } catch (error) {
      return {
        ok: false,
        error: toFetchErrorMessage(error, "Zapier webhook request failed"),
      };
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Zapier webhook failed (${response.status}): ${text || response.statusText}`,
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to send preview email.",
    };
  }
}
