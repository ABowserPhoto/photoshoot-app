/** Row shape for `social_profiles` (or local scheduler fallback) used by Scheduler + SocialConnectionsModal. */
export type SchedulerSocialProfileRow = {
  id: string;
  client_id: string;
  platform: string | null;
  handle: string | null;
  ig_account_id?: string | null;
  access_token?: string | null;
  tiktok_access_token?: string | null;
  tiktok_refresh_token?: string | null;
  tiktok_open_id?: string | null;
};
