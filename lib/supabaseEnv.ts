/**
 * Normalize env values for Supabase (trim + strip wrapping quotes from Vercel/dashboard pastes).
 */
export function cleanEnv(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  let trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed || undefined;
}

export function getSupabasePublicEnv(): { url?: string; anonKey?: string } {
  return {
    url: cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL),
    anonKey: cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  };
}

export function getSupabaseServiceRoleKey(): string | undefined {
  return cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
