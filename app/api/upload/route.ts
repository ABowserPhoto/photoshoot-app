import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { isDeliverableFileName } from "@/lib/deliverableFiles";
import { PHOTOS_ROOT } from "@/lib/photosPaths";

export const runtime = "nodejs";
export const maxDuration = 300;

const ILLEGAL_FOLDER_CHARS = /[<>:"/\\|?*]/g;

type UploadTaskData = {
  id?: string | number;
  title?: string;
  client?: string;
  price?: number;
  photoshoot_type?: string;
  shoot_location?: string;
  photoshoot_date?: string;
  due_date?: string;
  tax_percentage?: number;
  amount_type?: string;
  discount?: number;
  bracket_size?: number;
  local_folder_name?: string;
  email?: string;
  phone?: string;
  contact_first_name?: string;
  contact_last_name?: string;
  company_name?: string;
  country?: string;
  services?: unknown;
  products?: unknown;
  services_lexoffice_id?: string[];
  products_lexoffice_id?: string[];
  street?: string;
  zip_code?: string;
  city?: string;
  lexoffice_contact_id?: string;
  skip_invoice?: boolean | string | number | null;
  [key: string]: unknown;
};

type DbTaskRow = {
  id?: string | number;
  title?: string | null;
  client?: string | null;
  company_name?: string | null;
  contact_first_name?: string | null;
  contact_last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  street?: string | null;
  zip_code?: string | null;
  city?: string | null;
  country?: string | null;
  lexoffice_contact_id?: string | null;
  services?: unknown;
  products?: unknown;
  services_lexoffice_id?: unknown;
  products_lexoffice_id?: unknown;
  tax_percentage?: number | null;
  amount_type?: string | null;
  discount?: number | null;
  photoshoot_type?: string | null;
  shoot_location?: string | null;
  photoshoot_date?: string | null;
  due_date?: string | null;
  local_folder_name?: string | null;
  bracket_size?: number | null;
  skip_invoice?: boolean | null;
};

type DbClientRow = {
  company_name?: string | null;
  street?: string | null;
  zip_code?: string | null;
  city?: string | null;
  country?: string | null;
};

function getBaseDirectory(photoshootType: string) {
  // Assembled at runtime so Node File Tracing doesn't try to bundle the shared drive.
  const root = ["G:", "Shared drives", "Photostudio"].join("\\");
  return /real estate|immobilien/i.test(photoshootType)
    ? [root, "To Send - Immobilien"].join("\\")
    : [root, "To Send"].join("\\");
}

function sanitizeFolderSegment(value: string): string {
  const cleaned = value
    .replace(ILLEGAL_FOLDER_CHARS, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/g, "");
  return cleaned || "task-upload";
}

export async function POST(request: Request) {
  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (parseError) {
      const detail = parseError instanceof Error ? parseError.message : String(parseError);
      console.error("[upload] Failed to parse multipart body:", detail);
      return Response.json(
        {
          error:
            "Failed to parse upload body as FormData. This usually means the request was truncated " +
            "(file too large for the server body limit) or Content-Type was set without a multipart boundary. " +
            `Details: ${detail}`,
        },
        { status: 413 }
      );
    }

    const taskDataRaw = formData.get("taskData");
    if (typeof taskDataRaw !== "string") {
      return Response.json({ error: "Missing taskData payload." }, { status: 400 });
    }

    const taskData = JSON.parse(taskDataRaw) as UploadTaskData;
    const taskId = taskData.id != null ? String(taskData.id) : "";
    const title = typeof taskData.title === "string" && taskData.title.trim() ? taskData.title.trim() : "Untitled";
    const photoshootType =
      typeof taskData.photoshoot_type === "string" ? taskData.photoshoot_type : "";

    let dbStreet = "";
    let dbZipCode = "";
    let dbCity = "";
    let dbCountry = "";
    let dbTitle = "";
    let dbClient = "";
    let dbEmail = "";
    let dbPhone = "";
    let dbContactFirstName = "";
    let dbContactLastName = "";
    let dbCompanyName = "";
    let dbShootLocation = "";
    let dbPhotoshootDate = "";
    let dbDueDate = "";
    let dbPhotoshootType = "";
    let dbTaxPercentage = 19;
    let dbAmountType = "Net";
    let dbDiscount = 0;
    let dbBracketSize = 3;
    let dbLexofficeContactId = "";
    let dbLocalFolderName = "";
    let dbSkipInvoice = false;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    let dbServices: unknown = undefined;
    let dbProducts: unknown = undefined;
    let dbServicesLexofficeIds: string[] = [];
    let dbProductsLexofficeIds: string[] = [];

    if (taskId && supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
      const { data: taskRow, error: taskLookupError } = await supabase
        .from("tasks")
        .select(
          "id, title, client, company_name, contact_first_name, contact_last_name, email, phone, street, zip_code, city, country, lexoffice_contact_id, services, products, services_lexoffice_id, products_lexoffice_id, tax_percentage, amount_type, discount, photoshoot_type, shoot_location, photoshoot_date, due_date, local_folder_name, bracket_size, skip_invoice"
        )
        .eq("id", taskId)
        .maybeSingle();

      if (taskLookupError || !taskRow) {
        console.error("Task lookup failed; proceeding with frontend payload only.", {
          taskId,
          error: taskLookupError?.message ?? "Task not found",
        });
      } else {
        const row = taskRow as DbTaskRow;
        dbTitle = row.title ?? "";
        dbClient = row.client ?? "";
        dbEmail = row.email ?? "";
        dbPhone = row.phone ?? "";
        dbContactFirstName = row.contact_first_name ?? "";
        dbContactLastName = row.contact_last_name ?? "";
        dbCompanyName = row.company_name ?? "";
        dbStreet = row.street ?? "";
        dbZipCode = row.zip_code ?? "";
        dbCity = row.city ?? "";
        dbCountry = row.country ?? "";
        dbLexofficeContactId = row.lexoffice_contact_id ?? "";
        dbServices = row.services;
        dbProducts = row.products;
        dbServicesLexofficeIds = Array.isArray(row.services_lexoffice_id)
          ? row.services_lexoffice_id.map((value) => String(value ?? ""))
          : [];
        dbProductsLexofficeIds = Array.isArray(row.products_lexoffice_id)
          ? row.products_lexoffice_id.map((value) => String(value ?? ""))
          : [];
        dbTaxPercentage = Number(row.tax_percentage ?? 19);
        dbAmountType = row.amount_type === "Gross" ? "Gross" : "Net";
        dbDiscount = Number(row.discount ?? 0);
        dbPhotoshootType = row.photoshoot_type ?? "";
        dbShootLocation = row.shoot_location ?? "";
        dbPhotoshootDate = row.photoshoot_date ?? "";
        dbDueDate = row.due_date ?? "";
        dbLocalFolderName = row.local_folder_name ?? "";
        dbBracketSize = Number(row.bracket_size ?? 3) === 5 ? 5 : 3;
        dbSkipInvoice = Boolean(row.skip_invoice);

        if (dbLexofficeContactId) {
          const { data: clientRow } = await supabase
            .from("clients")
            .select("company_name, street, zip_code, city, country")
            .eq("lexoffice_contact_id", dbLexofficeContactId)
            .order("id", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (clientRow) {
            const client = clientRow as DbClientRow;
            dbCompanyName = dbCompanyName || client.company_name || "";
            dbStreet = dbStreet || client.street || "";
            dbZipCode = dbZipCode || client.zip_code || "";
            dbCity = dbCity || client.city || "";
            dbCountry = dbCountry || client.country || "";
          }
        }
      }
    } else {
      console.error("Task lookup skipped; missing task ID or Supabase config.", {
        hasTaskId: Boolean(taskId),
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasSupabaseKey: Boolean(supabaseKey),
      });
    }

    const files = formData
      .getAll("files")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0)
      .filter((file) => isDeliverableFileName(file.name));

    if (files.length === 0) {
      return Response.json(
        { error: "No supported files uploaded. Allowed: JPG/JPEG, video (mp4/mov/avi/mkv/webm), PDF." },
        { status: 400 }
      );
    }

    const baseDirectory = getBaseDirectory(photoshootType);
    const taskDirectory = path.join(baseDirectory, sanitizeFolderSegment(title));
    const localFolderNameRaw =
      typeof taskData.local_folder_name === "string" && taskData.local_folder_name.trim()
        ? taskData.local_folder_name.trim()
        : dbLocalFolderName.trim();
    const localFolderName = sanitizeFolderSegment(
      localFolderNameRaw || (taskId ? taskId.trim() : "") || "task-upload"
    );
    const localFinalDirectory = path.join(PHOTOS_ROOT, localFolderName, "4_Final");

    try {
      fs.mkdirSync(taskDirectory, { recursive: true });
      fs.mkdirSync(localFinalDirectory, { recursive: true });

      for (const file of files) {
        const fileBuffer = Buffer.from(await file.arrayBuffer());
        const driveDestination = path.join(taskDirectory, file.name);
        const localDestination = path.join(localFinalDirectory, file.name);
        await Promise.all([writeFile(driveDestination, fileBuffer), writeFile(localDestination, fileBuffer)]);
      }
    } catch (fsError) {
      const fsMessage = fsError instanceof Error ? fsError.message : String(fsError);
      return Response.json(
        {
          error: `File system write failed: ${fsMessage}`,
          taskDirectory,
          localFinalDirectory,
          localFolderName,
        },
        { status: 500 }
      );
    }

    return Response.json({
      success: true,
      folder: taskDirectory,
      localFolder: localFinalDirectory,
      files: files.map((file) => file.name),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
