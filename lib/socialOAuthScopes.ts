/**
 * OAuth scopes requested when a staff member connects a client profile.
 * App review / product approval is documented in the pull request.
 * Changing these does not upgrade tokens already stored; the profile must reconnect.
 */

/** Meta Login dialog uses a comma-separated scope list. */
export const META_OAUTH_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
  "pages_show_list",
  "pages_read_engagement",
  "read_insights",
  "business_management",
].join(",");

/** TikTok Login Kit uses a comma-separated scope list. */
export const TIKTOK_OAUTH_SCOPES = [
  "user.info.basic",
  "user.info.profile",
  "user.info.stats",
  "video.list",
  "video.publish",
].join(",");

/** LinkedIn uses a space-separated scope list. */
export const LINKEDIN_OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "rw_organization_admin",
  "r_organization_social",
].join(" ");

export const SOCIAL_PLATFORM_ENV = {
  meta: ["META_CLIENT_ID", "META_CLIENT_SECRET"] as const,
  tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"] as const,
  linkedin: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"] as const,
};
