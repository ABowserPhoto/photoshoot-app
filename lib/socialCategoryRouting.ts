/**
 * Maps Kanban photoshoot categories to Social Scheduler Instagram profiles
 * (handles under the studio social_clients account).
 */

export type SocialCategoryRoute = {
  categoryLabel: string;
  /** Tokens matched against social_profiles.handle (case-insensitive). */
  handleTokens: string[];
  /** Fallback tokens matched against social_clients.name. */
  clientNameTokens: string[];
  routingBadge: string;
};

const ROUTES: SocialCategoryRoute[] = [
  {
    categoryLabel: "Immobilien",
    handleTokens: ["immo", "immobilien", "realestate", "real-estate", "real estate"],
    clientNameTokens: ["immo", "immobilien", "real estate"],
    routingBadge: "Category: Immobilien → Routing to @Immo (Real Estate) account",
  },
  {
    categoryLabel: "Food",
    handleTokens: ["food"],
    clientNameTokens: ["food"],
    routingBadge: "Category: Food → Routing to @Food account",
  },
  {
    categoryLabel: "Portrait",
    handleTokens: ["portrait", "aaronbowser_photography", "photography"],
    clientNameTokens: ["aaron bowser", "portrait", "photography"],
    routingBadge: "Category: Portrait → Routing to @aaronbowser_photography account",
  },
];

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[@_\s-]+/g, "");
}

export function resolveSocialCategoryRoute(photoshootType: string): SocialCategoryRoute {
  const type = photoshootType.trim().toLowerCase();

  if (
    type.includes("immobilien") ||
    type.includes("real estate") ||
    type === "real estate"
  ) {
    return ROUTES[0];
  }
  if (type.includes("food")) {
    return ROUTES[1];
  }
  // Business Portraits, Portrait Pro, Studio Portrait, Hochzeit, Mini Session, Product, etc.
  return ROUTES[2];
}

export function profileMatchesRoute(
  route: SocialCategoryRoute,
  profile: { handle?: string | null; clientName?: string | null }
): boolean {
  const handle = normalize(profile.handle ?? "");
  if (!handle) {
    return false;
  }

  // Prefer handle matching — studio profiles often share one social_clients row.
  if (
    route.handleTokens.some((token) => {
      const n = normalize(token);
      return n.length > 0 && (handle === n || handle.includes(n));
    })
  ) {
    return true;
  }

  // Fallback only when the profile has no useful handle differentiation.
  const clientName = normalize(profile.clientName ?? "");
  if (!clientName) {
    return false;
  }
  return route.clientNameTokens.some((token) => {
    const n = normalize(token);
    return n.length > 0 && clientName === n;
  });
}

export function buildSocialCaptionSeed(input: {
  clientName?: string;
  shootLocation?: string;
  photoshootType?: string;
}): string {
  const parts = [
    input.clientName?.trim() ? `Client: ${input.clientName.trim()}` : null,
    input.shootLocation?.trim() ? `Location: ${input.shootLocation.trim()}` : null,
    input.photoshootType?.trim() ? `Type: ${input.photoshootType.trim()}` : null,
  ].filter(Boolean);
  if (parts.length === 0) {
    return "Ready for AI caption";
  }
  return `Ready for AI caption — ${parts.join(" · ")}`;
}
