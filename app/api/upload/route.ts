import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { PHOTOS_ROOT } from "@/lib/photosPaths";

export const runtime = "nodejs";

type UploadTaskData = {
  id?: string | number;
  title?: string;
  photoshoot_type?: string;
  local_folder_name?: string;
  street?: string;
  zip_code?: string;
  city?: string;
  lexoffice_contact_id?: string;
  [key: string]: unknown;
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
    let dbLexofficeContactId = "";
    let dbLocalFolderName = "";

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    let dbServices: unknown = undefined;
    let dbProducts: unknown = undefined;

    if (taskId && supabaseUrl && supabaseAnonKey) {
      const supabase = createClient(supabaseUrl, supabaseAnonKey);
      const { data: taskRow, error: taskLookupError } = await supabase
        .from("tasks")
        .select("street, zip_code, city, lexoffice_contact_id, services, products, local_folder_name")
        .eq("id", taskId)
        .single();

      if (taskLookupError || !taskRow) {
        console.error("Task lookup failed; proceeding with frontend payload only.", {
          taskId,
          error: taskLookupError?.message ?? "Task not found",
        });
      } else {
        dbStreet = taskRow.street ?? "";
        dbZipCode = taskRow.zip_code ?? "";
        dbCity = taskRow.city ?? "";
        dbLexofficeContactId = taskRow.lexoffice_contact_id ?? "";
        dbServices = taskRow.services;
        dbProducts = taskRow.products;
        dbLocalFolderName = taskRow.local_folder_name ?? "";
      }
    } else {
      console.error("Task lookup skipped; missing task ID or Supabase config.", {
        hasTaskId: Boolean(taskId),
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasSupabaseAnonKey: Boolean(supabaseAnonKey),
      });
    }

    const files = formData
      .getAll("files")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    if (files.length === 0) {
      return Response.json({ error: "No files uploaded." }, { status: 400 });
    }

    const baseDirectory = getBaseDirectory(photoshootType);
    const taskDirectory = path.join(baseDirectory, title);
    await mkdir(taskDirectory, { recursive: true });
    const localFolderName =
      typeof taskData.local_folder_name === "string" && taskData.local_folder_name.trim()
        ? taskData.local_folder_name.trim()
        : dbLocalFolderName.trim();

    if (!localFolderName) {
      return Response.json(
        {
          error:
            "Missing local folder name. Include local_folder_name in payload or ensure tasks.local_folder_name is set.",
        },
        { status: 400 }
      );
    }

    const localFinalDirectory = path.join(PHOTOS_ROOT, localFolderName, "4_Final");
    fs.mkdirSync(localFinalDirectory, { recursive: true });

    for (const file of files) {
      const fileBuffer = Buffer.from(await file.arrayBuffer());
      const driveDestination = path.join(taskDirectory, file.name);
      const localDestination = path.join(localFinalDirectory, file.name);
      await Promise.all([writeFile(driveDestination, fileBuffer), writeFile(localDestination, fileBuffer)]);
    }

    const servicesSource = dbServices !== undefined ? dbServices : taskData.services;
    const productsSource = dbProducts !== undefined ? dbProducts : taskData.products;

    const services_lexoffice_id = mapLexofficeIdsFromLineItems(servicesSource);
    const products_lexoffice_id = mapLexofficeIdsFromLineItems(productsSource);

    const zapierPayload = {
      ...taskData,
      id: taskId || taskData.id,
      street: dbStreet || taskData.street || "",
      zip_code: dbZipCode || taskData.zip_code || "",
      city: dbCity || taskData.city || "",
      lexoffice_contact_id: dbLexofficeContactId || taskData.lexoffice_contact_id || "",
      services_lexoffice_id,
      products_lexoffice_id,
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
