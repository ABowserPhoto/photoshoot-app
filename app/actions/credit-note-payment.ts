"use server";

import { createClient } from "@supabase/supabase-js";

import { uploadLexofficeVoucherFile } from "@/lib/lexoffice";
import { getAuthRole } from "@/lib/server/getAuthRole";

type Ok = {
  ok: true;
  creditNoteFileUrl: string;
  lexofficeFileId: string | null;
  lexofficeVoucherId: string | null;
};

type Err = { ok: false; error: string };

function serviceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function creditNotesBucket(): string {
  return process.env.CREDIT_NOTE_STORAGE_BUCKET?.trim() || "credit-notes";
}

function isPdfFile(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  return type === "application/pdf" || name.endsWith(".pdf");
}

/**
 * Mark a credit-note shoot as paid:
 * 1) Upload PDF to Lexoffice Inbox (type=voucher)
 * 2) Store a copy in Supabase Storage
 * 3) Set credit_note_paid + is_paid and save credit_note_file_url
 */
export async function processCreditNotePayment(
  taskId: string,
  formData: FormData
): Promise<Ok | Err> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const id = taskId.trim();
  if (!id) {
    return { ok: false, error: "taskId is required." };
  }

  const fileValue = formData.get("file");
  if (!(fileValue instanceof File) || fileValue.size === 0) {
    return { ok: false, error: "A PDF credit note file is required." };
  }
  if (!isPdfFile(fileValue)) {
    return { ok: false, error: "Only PDF files are accepted." };
  }

  const supabase = serviceSupabase();
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured." };
  }

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id, is_credit_note, credit_note_paid, title")
    .eq("id", id)
    .maybeSingle();

  if (taskError) {
    return { ok: false, error: taskError.message };
  }
  if (!task) {
    return { ok: false, error: "Task not found." };
  }
  if (!task.is_credit_note) {
    return { ok: false, error: "This task is not marked as a credit note." };
  }
  if (task.credit_note_paid) {
    return { ok: false, error: "This credit note is already marked as paid." };
  }

  const safeName = fileValue.name.replace(/[^\w.\-()+ ]+/g, "_").trim() || "credit-note.pdf";
  const storagePath = `${id}/${crypto.randomUUID()}-${safeName}`;

  let lexofficeFileId: string | null = null;
  let lexofficeVoucherId: string | null = null;

  try {
    const lexoffice = await uploadLexofficeVoucherFile(fileValue, safeName);
    lexofficeFileId = lexoffice.fileId;
    lexofficeVoucherId = lexoffice.voucherId;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Lexoffice upload failed.",
    };
  }

  const buffer = Buffer.from(await fileValue.arrayBuffer());
  const { error: uploadError } = await supabase.storage.from(creditNotesBucket()).upload(storagePath, buffer, {
    contentType: "application/pdf",
    upsert: false,
  });

  if (uploadError) {
    return {
      ok: false,
      error: `Lexoffice upload succeeded, but Supabase storage failed: ${uploadError.message}`,
    };
  }

  const { data: publicData } = supabase.storage.from(creditNotesBucket()).getPublicUrl(storagePath);
  const creditNoteFileUrl = publicData.publicUrl;

  const { error: updateError } = await supabase
    .from("tasks")
    .update({
      credit_note_paid: true,
      credit_note_file_url: creditNoteFileUrl,
      is_paid: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (updateError) {
    return {
      ok: false,
      error: `File uploaded, but task update failed: ${updateError.message}`,
    };
  }

  return {
    ok: true,
    creditNoteFileUrl,
    lexofficeFileId,
    lexofficeVoucherId,
  };
}
