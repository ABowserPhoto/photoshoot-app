/** Shared Cloudinary assets + photoshoot-type helpers for client emails. */

export const FINAL_EMAIL_COVER_IMMOBILIEN =
  "https://res.cloudinary.com/dggils0xr/image/upload/v1778187091/FotosDa_cmxr5c.png";
export const FINAL_EMAIL_COVER_WEDDING =
  "https://res.cloudinary.com/dggils0xr/image/upload/v1785920988/Wedding_Graphic_hipzm4.png";
export const FINAL_EMAIL_COVER_FALLBACK =
  "https://res.cloudinary.com/dggils0xr/image/upload/v1785920598/Fashion_Fotos_da_htjte4.jpg";

/** Immobilien preview assets (Gmail draft). */
export const PREVIEW_EMAIL_HEADER_IMMOBILIEN =
  "https://res.cloudinary.com/dggils0xr/image/upload/v1778187091/photoPreview_umvhsk.png";
export const PREVIEW_EMAIL_STEP1_IMMOBILIEN =
  "https://res.cloudinary.com/dggils0xr/image/upload/v1778187090/EmailStep1_p2jhl2.png";
export const PREVIEW_EMAIL_STEP2_IMMOBILIEN =
  "https://res.cloudinary.com/dggils0xr/image/upload/v1778187090/EmailStep3_b_grvd8a.png";
export const PREVIEW_EMAIL_STEP3_IMMOBILIEN =
  "https://res.cloudinary.com/dggils0xr/image/upload/v1778187089/EmailStep3_wcy3i9.png";

/** Non-Immobilien / standard preview assets. */
export const PREVIEW_EMAIL_HEADER_STANDARD =
  "https://res.cloudinary.com/dggils0xr/image/upload/v1785920599/FotoPreview_l6b5ju.png";
export const PREVIEW_EMAIL_STEP1_ANSCHAUEN =
  "https://res.cloudinary.com/dggils0xr/image/upload/v1785920599/firststep_anschauen_tkeu4l.png";
export const PREVIEW_EMAIL_STEP2_AUSWAHL =
  "https://res.cloudinary.com/dggils0xr/image/upload/v1778186972/secondstep_g3leco.png";
export const PREVIEW_EMAIL_STEP3_CELEBRATE =
  "https://res.cloudinary.com/dggils0xr/image/upload/v1778186972/abowserphoto_celebrate.png";

export function normalizePhotoshootType(value?: string | null): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function isImmobilienPhotoshootType(value?: string | null): boolean {
  const type = normalizePhotoshootType(value);
  return type === "immobilien" || type === "real estate";
}

export function isWeddingPhotoshootType(value?: string | null): boolean {
  const type = normalizePhotoshootType(value);
  return type === "hochzeit" || type === "wedding";
}

export function resolveFinalEmailCoverImageUrl(photoshootType?: string | null): string {
  if (isWeddingPhotoshootType(photoshootType)) {
    return FINAL_EMAIL_COVER_WEDDING;
  }
  if (isImmobilienPhotoshootType(photoshootType)) {
    return FINAL_EMAIL_COVER_IMMOBILIEN;
  }
  return FINAL_EMAIL_COVER_FALLBACK;
}

export type PreviewEmailVariant = "immobilien" | "standard";

export function resolvePreviewEmailVariant(photoshootType?: string | null): PreviewEmailVariant {
  return isImmobilienPhotoshootType(photoshootType) ? "immobilien" : "standard";
}

export function resolveStandardPreviewEmailAssets() {
  return {
    headerImageUrl: PREVIEW_EMAIL_HEADER_STANDARD,
    stepImageUrls: [
      PREVIEW_EMAIL_STEP1_ANSCHAUEN,
      PREVIEW_EMAIL_STEP2_AUSWAHL,
      PREVIEW_EMAIL_STEP3_CELEBRATE,
    ] as const,
  };
}

export function resolveImmobilienPreviewEmailAssets() {
  return {
    headerImageUrl: PREVIEW_EMAIL_HEADER_IMMOBILIEN,
    stepImageUrls: [
      PREVIEW_EMAIL_STEP1_IMMOBILIEN,
      PREVIEW_EMAIL_STEP2_IMMOBILIEN,
      PREVIEW_EMAIL_STEP3_IMMOBILIEN,
    ] as const,
  };
}
