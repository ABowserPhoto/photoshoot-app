import { createClient } from "@supabase/supabase-js";

function serviceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    return null;
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function getScannedGmailMessageIds(messageIds: string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(messageIds.map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0) {
    return new Set();
  }

  const sb = serviceSupabase();
  if (!sb) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for scanned_invoices lookups.");
  }

  const { data, error } = await sb
    .from("scanned_invoices")
    .select("gmail_message_id")
    .in("gmail_message_id", ids);

  if (error) {
    throw new Error(`Could not load scanned_invoices: ${error.message}`);
  }

  return new Set(
    (data ?? [])
      .map((row) => (typeof row.gmail_message_id === "string" ? row.gmail_message_id.trim() : ""))
      .filter(Boolean)
  );
}

export async function isGmailMessageScanned(messageId: string): Promise<boolean> {
  const trimmed = messageId.trim();
  if (!trimmed) {
    return false;
  }
  const known = await getScannedGmailMessageIds([trimmed]);
  return known.has(trimmed);
}

/** Inserts a row; returns false when the message id was already recorded. */
export async function recordScannedInvoice(input: {
  gmailMessageId: string;
  fileName: string;
  lexofficeFileId: string | null;
}): Promise<boolean> {
  const gmailMessageId = input.gmailMessageId.trim();
  if (!gmailMessageId) {
    throw new Error("gmailMessageId is required.");
  }

  const sb = serviceSupabase();
  if (!sb) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to record scanned_invoices.");
  }

  const { error } = await sb.from("scanned_invoices").insert({
    gmail_message_id: gmailMessageId,
    file_name: input.fileName.trim() || "document.pdf",
    lexoffice_file_id: input.lexofficeFileId?.trim() || null,
  });

  if (error) {
    if (error.code === "23505") {
      return false;
    }
    throw new Error(`Could not record scanned_invoices row: ${error.message}`);
  }

  return true;
}
