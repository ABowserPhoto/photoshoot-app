import { SOCIAL_PLATFORM_ENV } from "@/lib/socialOAuthScopes";

export type SocialPlatformCredentials = {
  meta: boolean;
  tiktok: boolean;
  linkedin: boolean;
};

function present(value: string | undefined): string {
  return value?.trim() ?? "";
}

/** True when the connect flow can exchange a code. Never returns secret values. */
export function socialPlatformCredentials(): SocialPlatformCredentials {
  const metaId = present(process.env.META_CLIENT_ID) || present(process.env.NEXT_PUBLIC_META_CLIENT_ID);
  const metaSecret = present(process.env.META_CLIENT_SECRET);
  const tiktokKey = present(process.env.TIKTOK_CLIENT_KEY) || present(process.env.NEXT_PUBLIC_TIKTOK_CLIENT_KEY);
  const tiktokSecret = present(process.env.TIKTOK_CLIENT_SECRET);
  const linkedinId = present(process.env.LINKEDIN_CLIENT_ID);
  const linkedinSecret = present(process.env.LINKEDIN_CLIENT_SECRET);

  return {
    meta: Boolean(metaId && metaSecret),
    tiktok: Boolean(tiktokKey && tiktokSecret),
    linkedin: Boolean(linkedinId && linkedinSecret),
  };
}

export function platformEnvNames() {
  return {
    meta: [...SOCIAL_PLATFORM_ENV.meta],
    tiktok: [...SOCIAL_PLATFORM_ENV.tiktok],
    linkedin: [...SOCIAL_PLATFORM_ENV.linkedin],
    optional: [
      "META_REDIRECT_URI",
      "TIKTOK_REDIRECT_URI",
      "LINKEDIN_REDIRECT_URI",
      "LINKEDIN_API_VERSION",
      "NEXT_PUBLIC_APP_URL",
      "NEXT_PUBLIC_BASE_URL",
    ],
  };
}

export function metaClientId(): string | null {
  return present(process.env.META_CLIENT_ID) || present(process.env.NEXT_PUBLIC_META_CLIENT_ID) || null;
}

export function tiktokClientKey(): string | null {
  return present(process.env.TIKTOK_CLIENT_KEY) || present(process.env.NEXT_PUBLIC_TIKTOK_CLIENT_KEY) || null;
}

export function linkedInClientId(): string | null {
  return present(process.env.LINKEDIN_CLIENT_ID) || null;
}

export function publicAppOrigin(requestOrigin: string): string {
  const fromEnv =
    present(process.env.NEXT_PUBLIC_BASE_URL).replace(/\/$/, "") ||
    present(process.env.NEXT_PUBLIC_APP_URL).replace(/\/$/, "");
  return fromEnv || requestOrigin;
}
