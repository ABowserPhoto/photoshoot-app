import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * @deprecated Local shoot folders are created on your PC by `scripts/processing-worker.mjs`
 * (status `awaiting_folder_creation` → `Booking`). Vercel has no access to your D: drive.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "This endpoint is deprecated. Folder structure is created by the local PM2 worker using COMFYUI_INPUT_DIR. New bookings are saved with status awaiting_folder_creation until folders exist.",
    },
    { status: 410 }
  );
}
