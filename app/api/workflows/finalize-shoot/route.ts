import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createDriveFolder, createGmailDraft } from "@/lib/google";
import {
  buildFinalizeShootEmailHtml,
  buildFinalizeShootEmailPlainText,
  buildFinalizeShootEmailSubject,
} from "@/lib/finalizeShootEmail";
import { createLexofficeInvoice, getLexofficePdfBuffer } from "@/lib/lexoffice";
import type { LexofficeInvoiceLineItem } from "@/lib/lexoffice";
import { getAuthRole } from "@/lib/server/getAuthRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const INVOICE_SENT_STATUS = "Invoice Sent";
const SEND_EMAIL_STATUS = "Send Email";
const DEFAULT_TAX_RATE = 19;

type ClientAddressInput =
  | string
  | {
      street?: string;
      zip?: string;
      city?: string;
      country?: string;
      countryCode?: string;
    };

type FinalizeShootLineItemInput = {
  name?: string;
  quantity?: number;
  price?: number;
  taxRate?: number;
};

function parseSkipInvoice(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  }
  return false;
}

type FinalizeShootBody = {
  taskId?: string;
  shootName?: string;
  invoiceName?: string;
  clientName?: string;
  clientEmail?: string;
  photoshootType?: string;
  shootLocation?: string;
  clientAddress?: ClientAddressInput;
  addressSupplement?: string;
  lineItems?: FinalizeShootLineItemInput[];
  taxRate?: number;
  lexofficeContactId?: string;
  skipInvoice?: boolean | string | number | null;
};

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !key) {
    return null;
  }
  return createClient(supabaseUrl, key, { auth: { persistSession: false } });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeFileName(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\r\n]+/g, "_").slice(0, 120) || "invoice";
}

function parseClientAddress(clientAddress: ClientAddressInput | undefined) {
  if (typeof clientAddress === "string") {
    const trimmed = clientAddress.trim();
    return trimmed ? { street: trimmed, countryCode: "DE" as const } : { countryCode: "DE" as const };
  }

  if (!clientAddress || typeof clientAddress !== "object") {
    return { countryCode: "DE" as const };
  }

  const countryCodeRaw =
    typeof clientAddress.countryCode === "string" ? clientAddress.countryCode.trim().toUpperCase() : "";

  return {
    street: typeof clientAddress.street === "string" ? clientAddress.street.trim() : undefined,
    zip: typeof clientAddress.zip === "string" ? clientAddress.zip.trim() : undefined,
    city: typeof clientAddress.city === "string" ? clientAddress.city.trim() : undefined,
    country: typeof clientAddress.country === "string" ? clientAddress.country.trim() : undefined,
    countryCode: countryCodeRaw || "DE",
  };
}

function parseLineItems(
  rawItems: FinalizeShootLineItemInput[] | undefined,
  fallbackTaxRate: number,
  shootName: string
): LexofficeInvoiceLineItem[] {
  const items = (Array.isArray(rawItems) ? rawItems : [])
    .map((item) => {
      const name = typeof item.name === "string" ? item.name.trim() : "";
      if (!name) {
        return null;
      }

      const quantity = Number(item.quantity);
      const price = Number(item.price);
      const taxRate = Number.isFinite(Number(item.taxRate)) ? Number(item.taxRate) : fallbackTaxRate;

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(`Invalid quantity for line item "${name}".`);
      }
      if (!Number.isFinite(price)) {
        throw new Error(`Invalid price for line item "${name}".`);
      }

      return {
        name,
        quantity,
        price,
        taxRate,
      };
    })
    .filter((item): item is LexofficeInvoiceLineItem => Boolean(item));

  if (items.length > 0) {
    return items;
  }

  return [
    {
      name: `Photoshoot: ${shootName}`,
      quantity: 1,
      price: 0,
      taxRate: fallbackTaxRate,
    },
  ];
}

function parseRequestBody(body: FinalizeShootBody) {
  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
  const shootName = typeof body.shootName === "string" ? body.shootName.trim() : "";
  const invoiceName = typeof body.invoiceName === "string" ? body.invoiceName.trim() : "";
  const clientName = typeof body.clientName === "string" ? body.clientName.trim() : "";
  const clientEmail = typeof body.clientEmail === "string" ? body.clientEmail.trim() : "";
  const photoshootType = typeof body.photoshootType === "string" ? body.photoshootType.trim() : "";
  const shootLocation = typeof body.shootLocation === "string" ? body.shootLocation.trim() : "";
  const addressSupplement =
    typeof body.addressSupplement === "string" ? body.addressSupplement.trim() : "";
  const taxRate = Number.isFinite(Number(body.taxRate)) ? Number(body.taxRate) : DEFAULT_TAX_RATE;
  const lexofficeContactId =
    typeof body.lexofficeContactId === "string" ? body.lexofficeContactId.trim() : "";
  const skipInvoice = parseSkipInvoice(body.skipInvoice);

  if (!taskId) {
    throw new Error("taskId is required.");
  }
  if (!shootName) {
    throw new Error("shootName is required.");
  }
  if (!skipInvoice && !invoiceName) {
    throw new Error("invoiceName is required.");
  }
  if (!clientEmail) {
    throw new Error("clientEmail is required.");
  }

  return {
    taskId,
    shootName,
    invoiceName,
    clientName,
    clientEmail,
    photoshootType,
    shootLocation,
    clientAddress: parseClientAddress(body.clientAddress),
    addressSupplement,
    lineItems: parseLineItems(body.lineItems, taxRate, shootName),
    taxRate,
    lexofficeContactId,
    skipInvoice,
  };
}

export async function POST(request: Request) {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase admin client is not configured. Set SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 }
    );
  }

  let body: FinalizeShootBody;
  try {
    body = (await request.json()) as FinalizeShootBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  let input: ReturnType<typeof parseRequestBody>;
  try {
    input = parseRequestBody(body);
  } catch (error) {
    return NextResponse.json({ error: toErrorMessage(error) }, { status: 400 });
  }

  const parentFolderId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID?.trim() || undefined;
  let currentStep = "validate-request";

  try {
    currentStep = "google-drive-create-folder";
    console.info(`[finalize-shoot] Step 1: Creating Drive folder for task ${input.taskId}`);
    const driveFolder = await createDriveFolder(input.shootName, parentFolderId);
    const googleDriveLink = driveFolder.webViewLink ?? `https://drive.google.com/drive/folders/${driveFolder.id}`;

    let pdfBuffer: Buffer | undefined;
    let invoice:
      | {
          id: string;
          documentFileId: string | null;
          resourceUri: string | null;
          invoiceViewUrl: string;
        }
      | undefined;

    if (!input.skipInvoice) {
      currentStep = "lexoffice-create-invoice";
      console.info(`[finalize-shoot] Step 2: Creating Lexoffice invoice for task ${input.taskId}`);
      invoice = await createLexofficeInvoice({
        client: {
          invoiceName: input.invoiceName,
          email: input.clientEmail,
          contactPersonName: input.clientName || undefined,
          addressSupplement: input.addressSupplement || undefined,
          ...input.clientAddress,
          ...(input.lexofficeContactId ? { contactId: input.lexofficeContactId } : {}),
        },
        lineItems: input.lineItems,
        taxType: "net",
        finalize: true,
        introduction: `Rechnung für ${input.shootName}`,
      });

      if (!invoice.documentFileId) {
        throw new Error("Lexoffice invoice was created but no documentFileId was returned.");
      }

      currentStep = "lexoffice-download-pdf";
      console.info(`[finalize-shoot] Step 3: Downloading Lexoffice PDF for task ${input.taskId}`);
      pdfBuffer = await getLexofficePdfBuffer(invoice.documentFileId);
    } else {
      console.info(`[finalize-shoot] Skipping Lexoffice steps for task ${input.taskId} (skipInvoice=true)`);
    }

    currentStep = "gmail-create-draft";
    console.info(`[finalize-shoot] Creating Gmail draft for task ${input.taskId}`);
    const subject = buildFinalizeShootEmailSubject({
      photoshootType: input.photoshootType,
      companyName: input.invoiceName,
      shootLocation: input.shootLocation,
      shootName: input.shootName,
    });
    const htmlBody = buildFinalizeShootEmailHtml({
      googleDriveLink,
      includeInvoiceNote: !input.skipInvoice,
    });
    const plainTextFallback = buildFinalizeShootEmailPlainText({
      googleDriveLink,
      includeInvoiceNote: !input.skipInvoice,
    });
    const gmailDraft = await createGmailDraft(
      input.clientEmail,
      subject,
      htmlBody,
      pdfBuffer,
      pdfBuffer ? `Invoice-${sanitizeFileName(input.shootName)}.pdf` : undefined,
      { plainTextFallback }
    );

    const nextStatus = input.skipInvoice ? SEND_EMAIL_STATUS : INVOICE_SENT_STATUS;

    currentStep = "supabase-update-task";
    console.info(`[finalize-shoot] Updating task ${input.taskId} in Supabase`);
    const { error: updateError } = await supabase
      .from("tasks")
      .update({
        ...(invoice?.id ? { lexoffice_invoice_id: invoice.id } : {}),
        google_drive_link: googleDriveLink,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.taskId);

    if (updateError) {
      throw new Error(`Supabase task update failed: ${updateError.message}`);
    }

    return NextResponse.json({
      success: true,
      taskId: input.taskId,
      status: nextStatus,
      skippedInvoice: input.skipInvoice,
      googleDriveFolderId: driveFolder.id,
      googleDriveLink,
      lexofficeInvoiceId: invoice?.id ?? null,
      lexofficeDocumentFileId: invoice?.documentFileId ?? null,
      lexofficeResourceUri: invoice?.resourceUri ?? null,
      lexofficeInvoiceViewUrl: invoice?.invoiceViewUrl ?? null,
      gmailDraftId: gmailDraft.id,
    });
  } catch (error) {
    const message = toErrorMessage(error);
    console.error(`[finalize-shoot] Failed during step "${currentStep}" for task ${input.taskId}:`, message);
    return NextResponse.json(
      {
        error: message,
        step: currentStep,
        taskId: input.taskId,
      },
      { status: 500 }
    );
  }
}
