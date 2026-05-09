import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { PHOTOS_ROOT } from "@/lib/photosPaths";

export const runtime = "nodejs";

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
};

type DbClientRow = {
  company_name?: string | null;
  street?: string | null;
  zip_code?: string | null;
  city?: string | null;
  country?: string | null;
};

function getBaseDirectory(photoshootType: string) {
  return /real estate|immobilien/i.test(photoshootType)
    ? "G:\\Shared drives\\Photostudio\\To Send - Immobilien"
    : "G:\\Shared drives\\Photostudio\\To Send";
}

/** Aligns 1:1 with the `services` / `products` JSON arrays; missing IDs become "". */
function mapLexofficeIdsFromLineItems(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (!item || typeof item !== "object") return "";
    const row = item as Record<string, unknown>;
    const id = row.lexoffice_id;
    if (typeof id === "string") return id;
    if (id == null) return "";
    return String(id);
  });
}

function normalizeLineItems(items: unknown): Array<{ name: string; quantity: number; price: number; lexoffice_id: string | null }> {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const name = typeof row.name === "string" ? row.name.trim() : "";
      if (!name) return null;
      return {
        name,
        quantity: Number(row.quantity) || 1,
        price: Number(row.price) || 0,
        lexoffice_id: typeof row.lexoffice_id === "string" ? row.lexoffice_id : null,
      };
    })
    .filter(
      (item): item is { name: string; quantity: number; price: number; lexoffice_id: string | null } =>
        Boolean(item)
    );
}

function sumLineItems(items: Array<{ quantity: number; price: number }>): number {
  return items.reduce((sum, item) => sum + item.quantity * item.price, 0);
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
    const formData = await request.formData();
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
          "id, title, client, company_name, contact_first_name, contact_last_name, email, phone, street, zip_code, city, country, lexoffice_contact_id, services, products, services_lexoffice_id, products_lexoffice_id, tax_percentage, amount_type, discount, photoshoot_type, shoot_location, photoshoot_date, due_date, local_folder_name, bracket_size"
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
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    if (files.length === 0) {
      return Response.json({ error: "No files uploaded." }, { status: 400 });
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

    const servicesSource = dbServices !== undefined ? dbServices : taskData.services;
    const productsSource = dbProducts !== undefined ? dbProducts : taskData.products;
    const services = normalizeLineItems(servicesSource);
    const products = normalizeLineItems(productsSource);
    const servicePrices = services.map((item) => Number(item.price) || 0);
    const productPrices = products.map((item) => Number(item.price) || 0);
    const services_lexoffice_id =
      dbServicesLexofficeIds.length > 0 ? dbServicesLexofficeIds : mapLexofficeIdsFromLineItems(services);
    const products_lexoffice_id =
      dbProductsLexofficeIds.length > 0 ? dbProductsLexofficeIds : mapLexofficeIdsFromLineItems(products);
    const servicesSubtotal = sumLineItems(services);
    const productsSubtotal = sumLineItems(products);
    const subtotal = servicesSubtotal + productsSubtotal;
    const discountValue = Number(dbDiscount || taskData.discount || 0);
    const taxableTotal = Math.max(0, subtotal - discountValue);
    const taxPercentage = Number(dbTaxPercentage || taskData.tax_percentage || 19);
    const shootName = dbTitle || title || localFolderName;
    const clientEmail =
      dbEmail ||
      (typeof taskData.email === "string" ? taskData.email.trim() : "") ||
      "";
    const clientNameFromContact = [dbContactFirstName, dbContactLastName]
      .map((value) => value.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    const clientName =
      clientNameFromContact ||
      dbCompanyName.trim() ||
      [taskData.contact_first_name, taskData.contact_last_name]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
        .join(" ")
        .trim() ||
      (typeof taskData.company_name === "string" ? taskData.company_name.trim() : "") ||
      "Client";
    const amountType =
      dbAmountType || (typeof taskData.amount_type === "string" ? taskData.amount_type : "Net");
    const invoiceTotal =
      amountType === "Gross"
        ? taxableTotal
        : taxableTotal + taxableTotal * (Number.isFinite(taxPercentage) ? taxPercentage / 100 : 0);
    const shootDate = dbPhotoshootDate || (typeof taskData.photoshoot_date === "string" ? taskData.photoshoot_date : "");
    const dueDate = dbDueDate || (typeof taskData.due_date === "string" ? taskData.due_date : "");
    const shootLocation =
      dbShootLocation || (typeof taskData.shoot_location === "string" ? taskData.shoot_location : "");
    const resolvedPhotoshootType =
      dbPhotoshootType || (typeof taskData.photoshoot_type === "string" ? taskData.photoshoot_type : "");

    const zapierPayload = {
      ...taskData,
      id: taskId || taskData.id,
      task_id: taskId || taskData.id || "",
      shoot_name: shootName,
      shoot_title: shootName,
      shoot_date: shootDate,
      shoot_location: shootLocation,
      photoshoot_type: resolvedPhotoshootType,
      due_date: dueDate || "",
      local_folder_name: localFolderName,
      bracket_size: dbBracketSize || Number(taskData.bracket_size ?? 3) || 3,
      client_email: clientEmail,
      client_name: clientName,
      client: dbClient || clientName,
      company_name:
        dbCompanyName || (typeof taskData.company_name === "string" ? taskData.company_name : "") || "",
      contact_first_name:
        dbContactFirstName || (typeof taskData.contact_first_name === "string" ? taskData.contact_first_name : "") || "",
      contact_last_name:
        dbContactLastName || (typeof taskData.contact_last_name === "string" ? taskData.contact_last_name : "") || "",
      email: clientEmail,
      phone: dbPhone || (typeof taskData.phone === "string" ? taskData.phone : "") || "",
      street: dbStreet || taskData.street || "",
      zip_code: dbZipCode || taskData.zip_code || "",
      city: dbCity || taskData.city || "",
      country: dbCountry || (typeof taskData.country === "string" ? taskData.country : "") || "",
      lexoffice_contact_id: dbLexofficeContactId || taskData.lexoffice_contact_id || "",
      services,
      products,
      service_prices: servicePrices,
      product_prices: productPrices,
      services_lexoffice_id,
      products_lexoffice_id,
      services_count: services.length,
      products_count: products.length,
      invoice: {
        subtotal_services: servicesSubtotal,
        subtotal_products: productsSubtotal,
        subtotal,
        discount: discountValue,
        taxable_total: taxableTotal,
        tax_percentage: taxPercentage,
        amount_type: amountType,
        total: invoiceTotal,
      },
      tax_percentage: taxPercentage,
      amount_type: amountType,
      discount: discountValue,
      total_price: invoiceTotal,
    };

    console.log("ZAPIER PAYLOAD:", zapierPayload);

    const webhookResponse = await fetch("https://hooks.zapier.com/hooks/catch/13609476/uv3pu5f/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(zapierPayload),
    });

    if (!webhookResponse.ok) {
      const webhookText = await webhookResponse.text();
      return Response.json(
        { error: `Webhook call failed: ${webhookResponse.status} ${webhookText}` },
        { status: 502 }
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
