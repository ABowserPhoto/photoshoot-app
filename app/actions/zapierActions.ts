"use server";

import { createClient } from "@supabase/supabase-js";

export type TriggerPreviewEmailResult = {
  ok: boolean;
  error?: string;
};

/**
 * Loads task contact info, builds the client gallery URL, and POSTs to Zapier for the preview email.
 */
export async function triggerPreviewEmail(taskId: string): Promise<TriggerPreviewEmailResult> {
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

  const { data: row, error } = await supabase
    .from("tasks")
    .select("id, email, contact_first_name, contact_last_name, company_name")
    .eq("id", trimmedId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
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

  const base =
    (process.env.NEXT_PUBLIC_APP_URL ?? "https://workflow.abowserphoto.com").replace(/\/$/, "");
  const previewLink = `${base}/gallery/${String(row.id)}`;
  console.log("SENDING TO ZAPIER:", { email: clientEmail, link: previewLink });
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientEmail,
      clientName,
      previewLink,
      taskId: String(row.id),
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      ok: false,
      error: `Zapier webhook failed (${response.status}): ${text || response.statusText}`,
    };
  }

  return { ok: true };
}
