"use client";

import Image from "next/image";
import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  deleteClientProfile,
  type MetaIgAccountOption,
} from "@/app/actions/social-profiles";
import { deleteSchedulerPost } from "@/app/actions/scheduler";
import { generateHashtagsAction } from "@/app/actions/generate-hashtags";
import { publishToInstagram } from "@/app/actions/publish-instagram";
import { publishToTikTok } from "@/app/actions/publish-tiktok";
import SocialConnectionsModal from "@/app/components/SocialConnectionsModal";
import type { SchedulerSocialProfileRow } from "@/lib/schedulerSocialProfile";
import { supabase } from "@/lib/supabaseClient";

const SLOT_COUNT = 12;
const DEFAULT_CLIENT_NAME = "Acme Corp";

const DAY_OPTIONS = [
  { key: 1, label: "M" },
  { key: 2, label: "T" },
  { key: 3, label: "W" },
  { key: 4, label: "Th" },
  { key: 5, label: "F" },
  { key: 6, label: "Sa" },
  { key: 0, label: "Su" },
] as const;

type Platform = "instagram" | "tiktok";

type Slot = {
  id: string;
  fileUrl: string;
  scheduledAt: Date | null;
  caption?: string;
} | null;

type SchedulingRules = {
  validDays: number[];
  startDate: string;
  startTime: string;
  endTime: string;
  minIntervalHours: number;
  postsPerWeek: number;
};

interface ClientData {
  rules: SchedulingRules;
  slots: Slot[];
}

type AppState = Record<string, ClientData>;

type SocialClientRow = {
  id: string;
  name: string;
};

type SocialRuleRow = {
  profile_id: string;
  valid_days: number[] | null;
  start_date: string | null;
  start_time: string | null;
  end_time: string | null;
  min_interval_hours: number | null;
  posts_per_week: number | null;
};

type SocialPostRow = {
  id: string;
  profile_id: string;
  file_url: string;
  caption: string | null;
  scheduled_at: string | null;
  absolute_index: number;
};

type SocialProfileRow = SchedulerSocialProfileRow;

function hasInstagramConnected(profile: SocialProfileRow | null): boolean {
  const ig = profile?.ig_account_id;
  return typeof ig === "string" && ig.trim().length > 0;
}

function hasTikTokConnected(profile: SocialProfileRow | null): boolean {
  const t = profile?.tiktok_access_token;
  return typeof t === "string" && t.trim().length > 0;
}

/** Public https URL whose path ends in .mp4 (TikTok direct upload expects MP4 in our flow). */
function isSchedulerMp4VideoUrl(fileUrl: string): boolean {
  if (!fileUrl.trim() || fileUrl.startsWith("blob:")) {
    return false;
  }
  if (!fileUrl.startsWith("http://") && !fileUrl.startsWith("https://")) {
    return false;
  }
  const noQuery = fileUrl.split("?")[0] ?? "";
  return noQuery.toLowerCase().endsWith(".mp4");
}

const badgeFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map((part) => Number.parseInt(part, 10));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return 0;
  }
  return hours * 60 + minutes;
}

function randomInt(min: number, max: number): number {
  if (max <= min) {
    return min;
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getTodayDateInput(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, "0");
  const d = `${now.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function shuffle<T>(values: T[]): T[] {
  const next = [...values];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function createDefaultRules(): SchedulingRules {
  return {
    validDays: [1, 2, 3, 4, 5],
    startDate: getTodayDateInput(),
    startTime: "10:00",
    endTime: "19:00",
    minIntervalHours: 24,
    postsPerWeek: 3,
  };
}

function createClientData(): ClientData {
  return {
    rules: createDefaultRules(),
    slots: Array(SLOT_COUNT).fill(null),
  };
}

function toDisplayPlatform(platform: string | null | undefined): string {
  if (!platform) {
    return "Unknown";
  }
  const normalized = platform.trim().toLowerCase();
  if (normalized === "instagram") {
    return "Instagram";
  }
  if (normalized === "tiktok" || normalized === "tik tok") {
    return "TikTok";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getPlatformIcon(platform: string | null | undefined, className = "h-3.5 w-3.5") {
  const normalized = platform?.trim().toLowerCase();
  if (normalized === "instagram") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
        <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
        <circle cx="12" cy="12" r="4.2" />
        <circle cx="17.3" cy="6.8" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (normalized === "tiktok" || normalized === "tik tok") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
        <path d="M14 4v8.5a3.5 3.5 0 1 1-3.5-3.5" />
        <path d="M14 7a5 5 0 0 0 4 2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.8 12h16.4M12 3.8a12.5 12.5 0 0 1 0 16.4M12 3.8a12.5 12.5 0 0 0 0 16.4" />
    </svg>
  );
}

function mapRuleRowToRules(rule: SocialRuleRow | null): SchedulingRules {
  if (!rule) {
    return createDefaultRules();
  }
  return {
    validDays: rule.valid_days && rule.valid_days.length > 0 ? rule.valid_days : createDefaultRules().validDays,
    startDate: rule.start_date ?? getTodayDateInput(),
    startTime: rule.start_time ?? "10:00",
    endTime: rule.end_time ?? "19:00",
    minIntervalHours: Math.max(1, rule.min_interval_hours ?? 24),
    postsPerWeek: Math.max(1, rule.posts_per_week ?? 3),
  };
}

function mapPostsToSlots(posts: SocialPostRow[]): Slot[] {
  const highestIndex = posts.reduce((max, post) => Math.max(max, post.absolute_index), SLOT_COUNT - 1);
  const nextSlots: Slot[] = Array(Math.max(SLOT_COUNT, highestIndex + 1)).fill(null);
  posts.forEach((post) => {
    if (post.absolute_index < 0) {
      return;
    }
    nextSlots[post.absolute_index] = {
      id: post.id,
      fileUrl: post.file_url,
      caption: post.caption ?? "",
      scheduledAt: post.scheduled_at ? new Date(post.scheduled_at) : null,
    };
  });
  return nextSlots;
}

function scheduleSlots(inputSlots: Slot[], rules: SchedulingRules): Slot[] {
  const validDays = rules.validDays;
  if (validDays.length === 0) {
    return inputSlots.map((slot) => (slot ? { ...slot, scheduledAt: null } : null));
  }

  const startMinutes = toMinutes(rules.startTime);
  const endMinutes = Math.max(toMinutes(rules.endTime), startMinutes + 1);
  const intervalMs = Math.max(1, rules.minIntervalHours) * 60 * 60 * 1000;
  const postsPerWeek = Math.min(Math.max(1, rules.postsPerWeek), validDays.length);

  const originDate = new Date(`${rules.startDate}T00:00:00`);
  const startAnchor = Number.isNaN(originDate.getTime()) ? new Date() : originDate;

  const firstWeekStart = new Date(startAnchor);
  const mondayOffset = (firstWeekStart.getDay() + 6) % 7;
  firstWeekStart.setDate(firstWeekStart.getDate() - mondayOffset);
  firstWeekStart.setHours(0, 0, 0, 0);

  const filledCount = inputSlots.filter(Boolean).length;
  const targetDays: Date[] = [];
  const weekdayOffsets = validDays.map((day) => (day + 6) % 7);

  let weekOffset = 0;
  while (targetDays.length < filledCount && weekOffset < 104) {
    const weekStart = new Date(firstWeekStart);
    weekStart.setDate(firstWeekStart.getDate() + weekOffset * 7);

    const weekCandidates = weekdayOffsets
      .map((offset) => {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + offset);
        date.setHours(0, 0, 0, 0);
        return date;
      })
      .filter((date) => date.getTime() >= startAnchor.getTime());

    const picked = shuffle(weekCandidates)
      .slice(0, Math.min(postsPerWeek, weekCandidates.length))
      .sort((a, b) => a.getTime() - b.getTime());

    targetDays.push(...picked);
    weekOffset += 1;
  }

  const next = [...inputSlots];
  let previousScheduled: Date | null = null;
  let targetIndex = 0;

  for (let i = 0; i < next.length; i += 1) {
    const slot = next[i];
    if (!slot) {
      continue;
    }

    if (targetIndex >= targetDays.length) {
      next[i] = { ...slot, scheduledAt: null };
      continue;
    }

    let selectedTargetIndex = targetIndex;
    let day = targetDays[selectedTargetIndex];
    let dayStart = new Date(day);
    dayStart.setMinutes(startMinutes, 0, 0);
    let dayEnd = new Date(day);
    dayEnd.setMinutes(endMinutes, 0, 0);

    let scheduledAt = new Date(day);
    scheduledAt.setMinutes(randomInt(startMinutes, endMinutes), 0, 0);

    if (previousScheduled) {
      const minAllowed = new Date(previousScheduled.getTime() + intervalMs);
      if (scheduledAt.getTime() < minAllowed.getTime()) {
        let fallbackAt = new Date(Math.max(minAllowed.getTime(), dayStart.getTime()));

        while (fallbackAt.getTime() > dayEnd.getTime()) {
          selectedTargetIndex += 1;
          if (selectedTargetIndex >= targetDays.length) {
            break;
          }
          day = targetDays[selectedTargetIndex];
          dayStart = new Date(day);
          dayStart.setMinutes(startMinutes, 0, 0);
          dayEnd = new Date(day);
          dayEnd.setMinutes(endMinutes, 0, 0);
          fallbackAt = new Date(Math.max(minAllowed.getTime(), dayStart.getTime()));
        }

        if (selectedTargetIndex >= targetDays.length) {
          next[i] = { ...slot, scheduledAt: null };
          continue;
        }

        scheduledAt = fallbackAt;
      }
    }

    previousScheduled = scheduledAt;
    next[i] = { ...slot, scheduledAt };
    targetIndex = selectedTargetIndex + 1;
  }

  return next;
}

export default function SchedulerPage() {
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [profiles, setProfiles] = useState<SocialProfileRow[]>([]);
  const [profilesRefreshKey, setProfilesRefreshKey] = useState(0);
  const [appState, setAppState] = useState<AppState>({});
  const [activeClientId, setActiveClientId] = useState("");
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [currentBoardIndex, setCurrentBoardIndex] = useState(0);
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);
  const [draggingSlot, setDraggingSlot] = useState<number | null>(null);
  const [editingSlotIndex, setEditingSlotIndex] = useState<number | null>(null);
  const [captionDraft, setCaptionDraft] = useState("");
  const [isGeneratingTags, setIsGeneratingTags] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPublishingTikTok, setIsPublishingTikTok] = useState(false);
  const [metaOAuthHref, setMetaOAuthHref] = useState<string | null>(null);
  const [igSelector, setIgSelector] = useState<{
    profileId: string;
    accounts: MetaIgAccountOption[];
  } | null>(null);
  const [socialConnectionsOpen, setSocialConnectionsOpen] = useState(false);
  const [isAddProfileModalOpen, setIsAddProfileModalOpen] = useState(false);
  const [newPlatform, setNewPlatform] = useState<Platform>("instagram");
  const [newProfileHandle, setNewProfileHandle] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const syncingFromDbRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("meta_select") === "1") {
      void (async () => {
        try {
          const res = await fetch("/api/auth/meta-pending-accounts", { credentials: "include" });
          const data = (await res.json()) as {
            ok?: boolean;
            profileId?: string;
            accounts?: MetaIgAccountOption[];
            error?: string;
          };
          if (data.ok && data.profileId && data.accounts && data.accounts.length > 0) {
            setIgSelector({ profileId: data.profileId, accounts: data.accounts });
            setSocialConnectionsOpen(true);
          } else {
            window.alert(
              data.error === "no_pending_selection"
                ? "No Instagram accounts pending selection. Try connecting again."
                : `Could not load accounts to select: ${data.error ?? res.statusText}`,
            );
          }
        } catch {
          window.alert("Could not load Instagram accounts to select.");
        } finally {
          window.history.replaceState({}, "", "/scheduler");
        }
      })();
      return;
    }
    if (params.get("meta_connected") === "1") {
      setProfilesRefreshKey((k) => k + 1);
      window.alert("Instagram connected successfully.");
      window.history.replaceState({}, "", "/scheduler");
      return;
    }
    const err = params.get("meta_error");
    if (err) {
      try {
        window.alert(`Instagram connection failed: ${decodeURIComponent(err)}`);
      } catch {
        window.alert(`Instagram connection failed: ${err}`);
      }
      window.history.replaceState({}, "", "/scheduler");
      return;
    }
    if (params.get("tiktok_connected") === "1") {
      setProfilesRefreshKey((k) => k + 1);
      window.alert("TikTok connected successfully.");
      window.history.replaceState({}, "", "/scheduler");
      return;
    }
    const tiktokErr = params.get("tiktok_error");
    if (tiktokErr) {
      try {
        window.alert(`TikTok connection failed: ${decodeURIComponent(tiktokErr)}`);
      } catch {
        window.alert(`TikTok connection failed: ${tiktokErr}`);
      }
      window.history.replaceState({}, "", "/scheduler");
    }
  }, []);

  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_META_CLIENT_ID?.trim();
    if (!appId || !activeProfileId) {
      setMetaOAuthHref(null);
      return;
    }
    const base =
      process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") || window.location.origin;
    const redirectUri = `${base}/api/auth/meta`;
    const scope =
      "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,business_management";
    const qs = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      state: activeProfileId,
      scope,
      response_type: "code",
    });
    setMetaOAuthHref(`https://www.facebook.com/v19.0/dialog/oauth?${qs.toString()}`);
  }, [activeProfileId]);

  useEffect(() => {
    return () => {
      const urls = objectUrlsRef.current;
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  useEffect(() => {
    if (!activeProfileId) {
      return;
    }
    setAppState((prev) => {
      if (prev[activeProfileId]) {
        return prev;
      }
      return {
        ...prev,
        [activeProfileId]: createClientData(),
      };
    });
  }, [activeProfileId]);

  const activeData = activeProfileId ? appState[activeProfileId] ?? createClientData() : createClientData();
  const slots = activeData.slots;
  const rules = activeData.rules;
  const boardStart = currentBoardIndex * SLOT_COUNT;
  const boardEnd = boardStart + SLOT_COUNT;
  const currentSlots = slots.slice(boardStart, boardEnd);
  const previousBoardBottomRow = currentBoardIndex > 0 ? slots.slice(boardStart - 3, boardStart) : [];
  const editingSlot = editingSlotIndex !== null ? slots[editingSlotIndex] : null;

  const updateActiveData = (updater: (data: ClientData) => ClientData) => {
    if (!activeProfileId) {
      return;
    }
    setAppState((prev) => {
      const current = prev[activeProfileId] ?? createClientData();
      return {
        ...prev,
        [activeProfileId]: updater(current),
      };
    });
  };

  const ensureBoardExists = (boardIndex: number) => {
    updateActiveData((data) => {
      const requiredLength = (boardIndex + 1) * SLOT_COUNT;
      if (data.slots.length >= requiredLength) {
        return data;
      }
      const nextSlots = [...data.slots];
      while (nextSlots.length < requiredLength) {
        nextSlots.push(...Array(SLOT_COUNT).fill(null));
      }
      return {
        ...data,
        slots: nextSlots,
      };
    });
  };

  const rulesSignature = `${rules.validDays.join(",")}|${rules.startDate}|${rules.startTime}|${rules.endTime}|${rules.minIntervalHours}|${rules.postsPerWeek}`;

  const upsertRulesInDb = async (profileId: string, nextRules: SchedulingRules) => {
    if (!supabase) {
      return;
    }
    const { error } = await supabase.from("social_rules").upsert(
      {
        profile_id: profileId,
        valid_days: nextRules.validDays,
        start_date: nextRules.startDate,
        start_time: nextRules.startTime,
        end_time: nextRules.endTime,
        min_interval_hours: nextRules.minIntervalHours,
        posts_per_week: nextRules.postsPerWeek,
      },
      {
        onConflict: "profile_id",
      }
    );
    if (error) {
      throw new Error(error.message);
    }
  };

  const syncPostIndexesAndSchedules = async (slotsToSync: Slot[]) => {
    const client = supabase;
    if (!client) {
      return;
    }
    const updates: Array<PromiseLike<{ error: { message: string } | null }>> = [];
    slotsToSync.forEach((slot, index) => {
      if (!slot || slot.id.startsWith("temp-")) {
        return;
      }
      updates.push(
        client
          .from("social_posts")
          .update({
            absolute_index: index,
            scheduled_at: slot.scheduledAt ? slot.scheduledAt.toISOString() : null,
          })
          .eq("id", slot.id)
      );
    });
    if (updates.length === 0) {
      return;
    }
    const results = await Promise.all(updates);
    const failed = results.find((result) => result?.error);
    if (failed?.error) {
      throw new Error(failed.error.message);
    }
  };

  const updateRules = (updater: (currentRules: SchedulingRules) => SchedulingRules) => {
    if (!activeProfileId) {
      return;
    }
    let nextRulesSnapshot: SchedulingRules | null = null;
    updateActiveData((data) => {
      const nextRules = updater(data.rules);
      nextRulesSnapshot = nextRules;
      return {
        ...data,
        rules: nextRules,
      };
    });
    if (!nextRulesSnapshot) {
      return;
    }
    void upsertRulesInDb(activeProfileId, nextRulesSnapshot).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      setPersistenceError(`Could not save scheduler rules: ${message}`);
    });
  };

  useEffect(() => {
    let mounted = true;
    const loadClients = async () => {
      if (!supabase) {
        const fallbackId = "local-acme";
        const fallbackProfileId = "local-acme-instagram";
        if (!mounted) {
          return;
        }
        setClients([{ id: fallbackId, name: DEFAULT_CLIENT_NAME }]);
        setActiveClientId(fallbackId);
        setProfiles([{ id: fallbackProfileId, client_id: fallbackId, platform: "instagram", handle: "@acmecorp" }]);
        setActiveProfileId(fallbackProfileId);
        setAppState({ [fallbackProfileId]: createClientData() });
        return;
      }

      let { data, error } = await supabase.from("social_clients").select("*").order("name", { ascending: true });
      if (error) {
        if (mounted) {
          setPersistenceError(`Could not load social clients: ${error.message}`);
        }
        return;
      }
      if ((data ?? []).length === 0) {
        const inserted = await supabase
          .from("social_clients")
          .insert({ name: DEFAULT_CLIENT_NAME })
          .select("*")
          .single();
        if (inserted.error && mounted) {
          setPersistenceError(`Could not create default client: ${inserted.error.message}`);
          return;
        }
        const reloaded = await supabase.from("social_clients").select("*").order("name", { ascending: true });
        data = reloaded.data;
        error = reloaded.error;
      }
      if (!mounted) {
        return;
      }
      if (error) {
        setPersistenceError(`Could not load social clients: ${error.message}`);
        return;
      }
      const rows = (data ?? []) as SocialClientRow[];
      setClients(rows.map((row) => ({ id: row.id, name: row.name })));
      const firstClient = rows[0]?.id ?? "";
      setActiveClientId((prev) => prev || firstClient);
    };
    void loadClients();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!activeClientId) {
      setProfiles([]);
      setActiveProfileId(null);
      return;
    }
    if (!client) {
      setProfiles((prev) => prev);
      return;
    }
    let mounted = true;
    const loadProfiles = async () => {
      const { data, error } = await client
        .from("social_profiles")
        .select("*")
        .eq("client_id", activeClientId)
        .order("created_at", { ascending: true });

      if (!mounted) {
        return;
      }
      if (error) {
        setPersistenceError(`Could not load profiles: ${error.message}`);
        setProfiles([]);
        setActiveProfileId(null);
        return;
      }
      const rows = (data ?? []) as SocialProfileRow[];
      setProfiles(rows);
      setActiveProfileId((prev) => {
        if (prev && rows.some((r) => r.id === prev)) {
          return prev;
        }
        return rows[0]?.id ?? null;
      });
      setCurrentBoardIndex(0);
    };
    void loadProfiles();
    return () => {
      mounted = false;
    };
  }, [activeClientId, profilesRefreshKey]);

  useEffect(() => {
    const client = supabase;
    if (!client || !activeProfileId) {
      return;
    }
    let mounted = true;
    const loadActiveData = async () => {
      syncingFromDbRef.current = true;
      const [rulesRes, postsRes] = await Promise.all([
        client
          .from("social_rules")
          .select("*")
          .eq("profile_id", activeProfileId)
          .maybeSingle(),
        client
          .from("social_posts")
          .select("*")
          .eq("profile_id", activeProfileId)
          .order("absolute_index", { ascending: true }),
      ]);

      if (!mounted) {
        return;
      }
      if (rulesRes.error) {
        setPersistenceError(`Could not load social rules: ${rulesRes.error.message}`);
      }
      if (postsRes.error) {
        setPersistenceError(`Could not load social posts: ${postsRes.error.message}`);
      }

      const mappedRules = mapRuleRowToRules((rulesRes.data as SocialRuleRow | null) ?? null);
      const mappedSlots = mapPostsToSlots((postsRes.data ?? []) as SocialPostRow[]);
      setAppState((prev) => {
        return {
          ...prev,
          [activeProfileId]: { rules: mappedRules, slots: mappedSlots },
        };
      });
      setTimeout(() => {
        syncingFromDbRef.current = false;
      }, 0);
    };

    void loadActiveData();
    return () => {
      mounted = false;
      syncingFromDbRef.current = false;
    };
  }, [activeProfileId]);

  useEffect(() => {
    if (!activeProfileId || syncingFromDbRef.current) {
      return;
    }
    void upsertRulesInDb(activeProfileId, rules).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      setPersistenceError(`Could not save scheduler rules: ${message}`);
    });
  }, [activeProfileId, rulesSignature, rules]);

  useEffect(() => {
    ensureBoardExists(currentBoardIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfileId, currentBoardIndex]);

  useEffect(() => {
    if (editingSlotIndex === null) {
      setCaptionDraft("");
      return;
    }
    const slot = slots[editingSlotIndex];
    setCaptionDraft(slot?.caption ?? "");
  }, [editingSlotIndex, slots]);

  const calculateSchedule = () => {
    let nextSlotsSnapshot: Slot[] = [];
    updateActiveData((data) => {
      const nextSlots = scheduleSlots(data.slots, data.rules);
      nextSlotsSnapshot = nextSlots;
      return {
        ...data,
        slots: nextSlots,
      };
    });
    if (nextSlotsSnapshot.length === 0) {
      return;
    }
    void syncPostIndexesAndSchedules(nextSlotsSnapshot).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      setPersistenceError(`Could not save updated schedule: ${message}`);
    });
  };

  const handleGenerateHashtags = async () => {
    setIsGeneratingTags(true);
    setPersistenceError(null);
    try {
      const result = await generateHashtagsAction(captionDraft);
      if (!result.ok) {
        setPersistenceError(`Hashtag generation: ${result.error}`);
        window.alert(result.error);
        return;
      }
      const tags = result.hashtags.trim();
      if (!tags) {
        const msg = "No hashtags were returned. Try again.";
        setPersistenceError(`Hashtag generation: ${msg}`);
        window.alert(msg);
        return;
      }
      setCaptionDraft((prev) => `${prev}\n\n${tags}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not generate hashtags.";
      setPersistenceError(`Hashtag generation: ${message}`);
      window.alert(message);
    } finally {
      setIsGeneratingTags(false);
    }
  };

  const handleSaveCaption = () => {
    if (editingSlotIndex === null) {
      return;
    }
    updateActiveData((data) => {
      if (editingSlotIndex < 0 || editingSlotIndex >= data.slots.length) {
        return data;
      }
      const currentSlot = data.slots[editingSlotIndex];
      if (!currentSlot) {
        return data;
      }
      const nextSlots = [...data.slots];
      nextSlots[editingSlotIndex] = {
        ...currentSlot,
        caption: captionDraft.trim(),
      };
      return {
        ...data,
        slots: nextSlots,
      };
    });
    if (supabase && editingSlot && !editingSlot.id.startsWith("temp-")) {
      void supabase
        .from("social_posts")
        .update({ caption: captionDraft.trim() || null })
        .eq("id", editingSlot.id)
        .then((result) => {
          if (result.error) {
            setPersistenceError(`Could not save caption: ${result.error.message}`);
          }
        });
    }
    setEditingSlotIndex(null);
    setIsGeneratingTags(false);
  };

  const toggleDay = (day: number) => {
    updateRules((currentRules) => {
      const currentDays = currentRules.validDays;
      if (currentDays.includes(day)) {
        if (currentDays.length === 1) {
          return currentRules;
        }
        const nextDays = currentDays.filter((entry) => entry !== day);
        return {
          ...currentRules,
          validDays: nextDays,
          postsPerWeek: Math.min(currentRules.postsPerWeek, nextDays.length),
        };
      }
      return {
        ...currentRules,
        validDays: [...currentDays, day].sort((a, b) => a - b),
      };
    });
  };

  const handleDrop = (localIndex: number, event: DragEvent<HTMLDivElement>) => {
    if (!activeProfileId) {
      return;
    }
    const index = boardStart + localIndex;
    event.preventDefault();
    setHoveredSlot(null);
    setDraggingSlot(null);

    const sourceIndexRaw = event.dataTransfer.getData("sourceIndex");
    if (sourceIndexRaw) {
      const sourceIndex = Number.parseInt(sourceIndexRaw, 10);
      if (!Number.isNaN(sourceIndex) && sourceIndex >= 0 && sourceIndex < slots.length && sourceIndex !== index) {
        let nextSlotsSnapshot: Slot[] = [];
        updateActiveData((data) => {
          const moved = data.slots[sourceIndex];
          if (!moved) {
            return data;
          }
          const compact = data.slots.filter((_, slotIndex) => slotIndex !== sourceIndex);
          compact.splice(index, 0, moved);
          nextSlotsSnapshot = scheduleSlots(compact, data.rules);
          return {
            ...data,
            slots: nextSlotsSnapshot,
          };
        });
        if (nextSlotsSnapshot.length > 0) {
          void syncPostIndexesAndSchedules(nextSlotsSnapshot).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : "Unknown error";
            setPersistenceError(`Could not sync reordered posts: ${message}`);
          });
        }
      }
      return;
    }

    const droppedFile = event.dataTransfer.files?.[0];
    if (!droppedFile) {
      return;
    }

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const localUrl = URL.createObjectURL(droppedFile);
    objectUrlsRef.current.add(localUrl);
    let scheduledSlotsSnapshot: Slot[] = [];
    updateActiveData((data) => {
      const next = [...data.slots];
      const previousSlot = next[index];
      if (previousSlot?.fileUrl) {
        URL.revokeObjectURL(previousSlot.fileUrl);
        objectUrlsRef.current.delete(previousSlot.fileUrl);
      }
      next[index] = {
        id: tempId,
        fileUrl: localUrl,
        scheduledAt: null,
        caption: "",
      };
      scheduledSlotsSnapshot = scheduleSlots(next, data.rules);
      return {
        ...data,
        slots: scheduledSlotsSnapshot,
      };
    });

    if (scheduledSlotsSnapshot.length > 0) {
      void syncPostIndexesAndSchedules(scheduledSlotsSnapshot).catch(() => {
        // Intentionally swallow sync errors for temporary entries before insert completes.
      });
    }

    if (!supabase) {
      return;
    }

    void (async () => {
      const extension = droppedFile.name.includes(".") ? droppedFile.name.split(".").pop() : "jpg";
      const objectPath = `${activeClientId || "client"}/${activeProfileId}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${extension ?? "jpg"}`;

      const upload = await supabase.storage.from("social_media").upload(objectPath, droppedFile, {
        upsert: false,
      });
      if (upload.error) {
        setPersistenceError(`Could not upload file: ${upload.error.message}`);
        return;
      }

      const { data: publicData } = supabase.storage.from("social_media").getPublicUrl(objectPath);
      const publicUrl = publicData.publicUrl;
      const inserted = await supabase
        .from("social_posts")
        .insert({
          profile_id: activeProfileId,
          absolute_index: index,
          file_url: publicUrl,
          caption: null,
          scheduled_at: scheduledSlotsSnapshot[index]?.scheduledAt
            ? scheduledSlotsSnapshot[index]?.scheduledAt?.toISOString()
            : null,
        })
        .select("*")
        .single();

      if (inserted.error) {
        setPersistenceError(`Could not create social post record: ${inserted.error.message}`);
        return;
      }

      const insertedRow = inserted.data as SocialPostRow;
      updateActiveData((data) => {
        const next = [...data.slots];
        const current = next[index];
        if (!current || current.id !== tempId) {
          return data;
        }
        next[index] = {
          id: insertedRow.id,
          fileUrl: insertedRow.file_url,
          caption: insertedRow.caption ?? "",
          scheduledAt: insertedRow.scheduled_at ? new Date(insertedRow.scheduled_at) : current.scheduledAt,
        };
        return {
          ...data,
          slots: next,
        };
      });

      URL.revokeObjectURL(localUrl);
      objectUrlsRef.current.delete(localUrl);

      void syncPostIndexesAndSchedules(
        scheduledSlotsSnapshot.map((slot, slotIndex) =>
          slotIndex === index && slot?.id === tempId
            ? {
                ...slot,
                id: insertedRow.id,
                fileUrl: insertedRow.file_url,
              }
            : slot
        )
      ).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown error";
        setPersistenceError(`Could not sync social post ordering: ${message}`);
      });
    })();
  };

  const activeClientName = useMemo(
    () => clients.find((client) => client.id === activeClientId)?.name ?? "Client",
    [clients, activeClientId]
  );
  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) ?? null,
    [profiles, activeProfileId]
  );
  const platformLabel = toDisplayPlatform(activeProfile?.platform);
  const activeHandle = activeProfile?.handle ?? "@unknown";

  const handlePublishNow = async () => {
    if (!activeProfile?.ig_account_id?.trim() || !activeProfile?.access_token?.trim()) {
      window.alert("Connect Instagram for this profile first (open 🔗 Manage Connections).");
      return;
    }
    if (!editingSlot?.fileUrl) {
      window.alert("No image for this post.");
      return;
    }
    const imageUrl = editingSlot.fileUrl;
    if (imageUrl.startsWith("blob:")) {
      window.alert("Upload the image so it has a public URL before publishing to Instagram.");
      return;
    }
    setIsPublishing(true);
    try {
      const result = await publishToInstagram(
        activeProfile.ig_account_id.trim(),
        activeProfile.access_token.trim(),
        imageUrl,
        captionDraft.trim(),
      );
      if (!result.ok) {
        window.alert(result.error);
        return;
      }
      window.alert(`Published to Instagram successfully.\nMedia ID: ${result.mediaId}`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Publish failed.");
    } finally {
      setIsPublishing(false);
    }
  };

  const handlePublishTikTok = async () => {
    if (!activeProfileId || !editingSlot?.fileUrl) {
      window.alert("No video selected.");
      return;
    }
    if (!activeProfile || !hasTikTokConnected(activeProfile)) {
      window.alert("Connect TikTok for this profile first (open 🔗 Manage Connections).");
      return;
    }
    if (!isSchedulerMp4VideoUrl(editingSlot.fileUrl)) {
      window.alert("TikTok publishing requires a public .mp4 URL.");
      return;
    }
    setIsPublishingTikTok(true);
    try {
      const result = await publishToTikTok(activeProfileId, editingSlot.fileUrl, captionDraft.trim());
      if (!result.ok) {
        window.alert(result.error);
        return;
      }
      window.alert("Video uploaded to TikTok successfully.");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "TikTok publish failed.");
    } finally {
      setIsPublishingTikTok(false);
    }
  };

  const handleCreateClient = () => {
    const entered = window.prompt("Enter client name:")?.trim();
    if (!entered) {
      return;
    }
    if (!supabase) {
      const clientId = `${entered.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
      const profileId = `${clientId}-instagram`;
      setClients((prev) => [...prev, { id: clientId, name: entered }]);
      setProfiles([{ id: profileId, client_id: clientId, platform: "instagram", handle: "@newprofile" }]);
      setAppState((prev) => ({ ...prev, [profileId]: createClientData() }));
      setActiveClientId(clientId);
      setActiveProfileId(profileId);
      setCurrentBoardIndex(0);
      return;
    }
    void (async () => {
      const inserted = await supabase.from("social_clients").insert({ name: entered }).select("*").single();
      if (inserted.error || !inserted.data) {
        setPersistenceError(`Could not create client: ${inserted.error?.message ?? "Unknown error"}`);
        return;
      }
      const row = inserted.data as SocialClientRow;
      setClients((prev) => [...prev, { id: row.id, name: row.name }]);
      setActiveClientId(row.id);
      setActiveProfileId(null);
      setCurrentBoardIndex(0);
    })();
  };

  const handleDeleteProfile = (profileId: string) => {
    if (
      !window.confirm(
        "Are you sure you want to delete this client? All scheduled posts will be lost.",
      )
    ) {
      return;
    }
    if (!supabase) {
      setProfiles((prev) => {
        const next = prev.filter((p) => p.id !== profileId);
        setActiveProfileId((active) =>
          active === profileId ? next[0]?.id ?? null : active,
        );
        return next;
      });
      setAppState((s) => {
        const next = { ...s };
        delete next[profileId];
        return next;
      });
      return;
    }
    void (async () => {
      const result = await deleteClientProfile(profileId);
      if (!result.ok) {
        window.alert(result.error);
        return;
      }
      setProfiles((prev) => {
        const next = prev.filter((p) => p.id !== profileId);
        setActiveProfileId((active) =>
          active === profileId ? next[0]?.id ?? null : active,
        );
        return next;
      });
      setAppState((s) => {
        const next = { ...s };
        delete next[profileId];
        return next;
      });
    })();
  };

  const handleDeleteScheduledPost = (absoluteIndex: number) => {
    if (!activeProfileId) {
      return;
    }
    const target = slots[absoluteIndex];
    if (!target) {
      return;
    }
    if (!window.confirm("Are you sure you want to delete this post?")) {
      return;
    }

    const previousSlots = [...slots];
    const wasEditing = editingSlotIndex === absoluteIndex;
    updateActiveData((data) => {
      if (absoluteIndex < 0 || absoluteIndex >= data.slots.length) {
        return data;
      }
      const nextSlots = [...data.slots];
      nextSlots[absoluteIndex] = null;
      return { ...data, slots: nextSlots };
    });
    if (wasEditing) {
      setEditingSlotIndex(null);
      setCaptionDraft("");
      setIsGeneratingTags(false);
    }

    if (target.fileUrl.startsWith("blob:")) {
      URL.revokeObjectURL(target.fileUrl);
      objectUrlsRef.current.delete(target.fileUrl);
    }

    void (async () => {
      try {
        const result = await deleteSchedulerPost(target.id);
        if (!result.ok) {
          throw new Error(result.error);
        }
        setPersistenceError(null);
      } catch (error) {
        console.error("[scheduler delete post]", {
          postId: target.id,
          absoluteIndex,
          error,
        });
        setPersistenceError(error instanceof Error ? error.message : "Could not delete post.");
        updateActiveData((data) => ({ ...data, slots: previousSlots }));
      }
    })();
  };

  const handleAddProfile = () => {
    if (!activeClientId) {
      return;
    }
    setNewPlatform("instagram");
    setNewProfileHandle("");
    setIsAddProfileModalOpen(true);
  };

  const closeAddProfileModal = () => {
    if (isSavingProfile) {
      return;
    }
    setIsAddProfileModalOpen(false);
    setNewPlatform("instagram");
    setNewProfileHandle("");
  };

  const submitNewProfile = async () => {
    if (!activeClientId || isSavingProfile) {
      return;
    }

    const handleInput = newProfileHandle.trim();
    if (!handleInput) {
      setPersistenceError("Account handle is required.");
      return;
    }

    const normalizedPlatform = newPlatform;
    setIsSavingProfile(true);
    setPersistenceError(null);

    try {
      if (!supabase) {
        const localProfileId = `${activeClientId}-${Date.now()}`;
        const localProfile = {
          id: localProfileId,
          client_id: activeClientId,
          platform: normalizedPlatform,
          handle: handleInput,
        };
        setProfiles((prev) => [...prev, localProfile]);
        setAppState((prev) => ({ ...prev, [localProfileId]: createClientData() }));
        setActiveProfileId(localProfileId);
        setCurrentBoardIndex(0);
        setIsAddProfileModalOpen(false);
        setNewPlatform("instagram");
        setNewProfileHandle("");
        return;
      }

      const inserted = await supabase
        .from("social_profiles")
        .insert({
          client_id: activeClientId,
          platform: normalizedPlatform,
          handle: handleInput,
        })
        .select("*")
        .single();

      if (inserted.error || !inserted.data) {
        setPersistenceError(`Could not add account profile: ${inserted.error?.message ?? "Unknown error"}`);
        return;
      }

      const row = inserted.data as SocialProfileRow;
      setProfiles((prev) => [...prev, row]);
      setAppState((prev) => ({ ...prev, [row.id]: prev[row.id] ?? createClientData() }));
      setActiveProfileId(row.id);
      setCurrentBoardIndex(0);
      setIsAddProfileModalOpen(false);
      setNewPlatform("instagram");
      setNewProfileHandle("");
    } finally {
      setIsSavingProfile(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background text-zinc-100">
      <aside className="flex w-80 flex-col border-r border-white/10 bg-zinc-900/80">
        <div className="p-6">
          <div className="flex items-start gap-3">
            <Image
              src="/logo.webp"
              alt="Workflow"
              width={480}
              height={132}
              className="h-14 w-auto shrink-0 object-contain"
              priority
            />
            <h1 className="pt-1 text-2xl font-bold tracking-tight text-zinc-100">Social Scheduler</h1>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <p className="text-xs text-zinc-400">Plan visual posts with drag-and-drop layouting.</p>
          {persistenceError ? (
            <div className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
              {persistenceError}
            </div>
          ) : null}

          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Client</p>
              <button
                type="button"
                onClick={handleCreateClient}
                className="rounded border border-zinc-700 px-2 py-1 text-[10px] font-semibold text-zinc-300 hover:bg-zinc-800"
              >
                + New Client
              </button>
            </div>
            <select
              value={activeClientId}
              onChange={(event) => {
                setActiveClientId(event.target.value);
                setCurrentBoardIndex(0);
              }}
              className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none ring-zinc-500 focus:ring-2"
            >
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Profiles</p>
              <button
                type="button"
                onClick={handleAddProfile}
                className="rounded border border-zinc-700 px-2 py-1 text-[10px] font-semibold text-zinc-300 hover:bg-zinc-800"
              >
                + Add Account
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {profiles.length > 0 ? (
                profiles.map((profile) => {
                  const handle = profile.handle ?? "@unknown";
                  const isActive = profile.id === activeProfileId;
                  return (
                    <div key={profile.id} className="flex items-stretch gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveProfileId(profile.id);
                          setCurrentBoardIndex(0);
                        }}
                        className={`min-w-0 flex-1 rounded-md border px-3 py-2 text-left text-xs font-semibold transition ${
                          isActive
                            ? "border-zinc-200 bg-zinc-100 text-zinc-900"
                            : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                        }`}
                      >
                        <span className="inline-flex items-center gap-2">
                          {getPlatformIcon(profile.platform)}
                          <span className="truncate">{handle}</span>
                        </span>
                      </button>
                      {supabase ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteProfile(profile.id);
                          }}
                          className="shrink-0 rounded-md border border-red-500/35 bg-zinc-900 px-2 text-red-400/90 transition hover:border-red-500/60 hover:bg-red-500/10 hover:text-red-300"
                          title="Delete profile"
                          aria-label={`Delete profile ${handle}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                        </button>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-zinc-500">No profiles yet. Add an account.</p>
              )}
            </div>
            {supabase && activeProfileId && activeProfile ? (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setSocialConnectionsOpen(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-violet-500/45 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-100 transition hover:bg-violet-500/15"
                >
                  <span aria-hidden>🔗</span> Manage Connections
                </button>
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Scheduling Rules</p>

            <div className="mt-3">
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">Valid Days</p>
              <div className="mt-2 grid grid-cols-7 gap-1">
                {DAY_OPTIONS.map((day) => {
                  const enabled = rules.validDays.includes(day.key);
                  return (
                    <button
                      key={day.key}
                      type="button"
                      onClick={() => toggleDay(day.key)}
                      className={`rounded border px-1 py-1 text-[10px] font-semibold transition ${
                        enabled
                          ? "border-zinc-200 bg-zinc-100 text-zinc-900"
                          : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
                      }`}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="mt-3 block text-[11px] uppercase tracking-wide text-zinc-500">
              Start Date
              <input
                type="date"
                value={rules.startDate}
                onChange={(event) =>
                  updateRules((currentRules) => ({
                    ...currentRules,
                    startDate: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none ring-zinc-500 focus:ring-2"
              />
            </label>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-[11px] uppercase tracking-wide text-zinc-500">
                Start Time
                <input
                  type="time"
                  value={rules.startTime}
                  onChange={(event) =>
                    updateRules((currentRules) => ({
                      ...currentRules,
                      startTime: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none ring-zinc-500 focus:ring-2"
                />
              </label>
              <label className="text-[11px] uppercase tracking-wide text-zinc-500">
                End Time
                <input
                  type="time"
                  value={rules.endTime}
                  onChange={(event) =>
                    updateRules((currentRules) => ({
                      ...currentRules,
                      endTime: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none ring-zinc-500 focus:ring-2"
                />
              </label>
            </div>

            <label className="mt-3 block text-[11px] uppercase tracking-wide text-zinc-500">
              Posts Per Week
              <input
                type="number"
                min={1}
                max={Math.max(1, rules.validDays.length)}
                value={rules.postsPerWeek}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  const bounded = Number.isNaN(parsed)
                    ? 3
                    : Math.max(1, Math.min(parsed, Math.max(1, rules.validDays.length)));
                  updateRules((currentRules) => ({
                    ...currentRules,
                    postsPerWeek: bounded,
                  }));
                }}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none ring-zinc-500 focus:ring-2"
              />
            </label>

            <label className="mt-3 block text-[11px] uppercase tracking-wide text-zinc-500">
              Minimum Interval (Hours)
              <input
                type="number"
                min={1}
                value={rules.minIntervalHours}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  updateRules((currentRules) => ({
                    ...currentRules,
                    minIntervalHours: Number.isNaN(parsed) ? 24 : Math.max(1, parsed),
                  }));
                }}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none ring-zinc-500 focus:ring-2"
              />
            </label>
          </div>
        </div>
      </aside>

      <section className="flex-1 overflow-y-auto p-6 lg:p-8">
        <div className="relative mx-auto mt-8 flex h-[85vh] w-full items-center justify-center">
          <button
            type="button"
            onClick={() => setCurrentBoardIndex((prev) => Math.max(0, prev - 1))}
            disabled={currentBoardIndex === 0}
            className={`absolute left-2 z-20 flex h-12 w-12 items-center justify-center rounded-full border text-2xl transition ${
              currentBoardIndex === 0
                ? "cursor-not-allowed opacity-50 border-zinc-800 bg-zinc-900/50 text-zinc-700"
                : "border-zinc-700 bg-zinc-900/80 text-zinc-200 hover:bg-zinc-800"
            }`}
            aria-label="Previous board"
          >
            &lt;
          </button>

          <button
            type="button"
            onClick={() => {
              const nextBoard = currentBoardIndex + 1;
              ensureBoardExists(nextBoard);
              setCurrentBoardIndex(nextBoard);
            }}
            className="absolute right-2 z-20 flex h-12 w-12 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/80 text-2xl text-zinc-200 transition hover:bg-zinc-800"
            aria-label="Next board"
          >
            &gt;
          </button>

          <div className="relative mx-4 flex w-full max-w-sm flex-col md:max-w-lg">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-400">
                <span className="inline-flex items-center gap-2">
                  <span>{activeClientName} -</span>
                  <span className="inline-flex items-center gap-1">
                    {getPlatformIcon(activeProfile?.platform)}
                    <span>
                      {platformLabel} ({activeHandle})
                    </span>
                  </span>
                  <span>- {currentBoardIndex + 1}</span>
                </span>
              </h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={calculateSchedule}
                  className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-semibold text-zinc-200 hover:bg-zinc-800"
                >
                  Regenerate Schedule
                </button>
              </div>
            </div>

            {currentBoardIndex > 0 ? (
              <div className="group mb-[5px]">
                <div className="w-full cursor-pointer bg-white/5 py-1 text-center text-xs text-gray-400">
                  Hover for Continuity Check <span className="text-gray-500">v</span>
                </div>
                <div className="mt-[5px] hidden w-full grid-cols-3 gap-[5px] border border-white/10 bg-background p-2 shadow-2xl group-hover:grid">
                  {previousBoardBottomRow.map((slot, continuityIndex) => (
                    <div
                      key={`continuity-${continuityIndex}`}
                      className="relative aspect-[4/5] overflow-hidden rounded-md border border-zinc-800 bg-zinc-900 opacity-50"
                    >
                      {slot ? (
                        <img
                          src={slot.fileUrl}
                          alt={`Continuity slot ${continuityIndex + 1}`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-center text-[11px] text-zinc-600">
                          Empty
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-3 gap-[5px]">
              {currentSlots.map((slot, localIndex) => {
                const absoluteIndex = boardStart + localIndex;
                const isHovered = hoveredSlot === absoluteIndex;
                const isEmpty = slot === null;
                return (
                  <div
                    key={`slot-${absoluteIndex}`}
                    draggable={!isEmpty}
                    onDragStart={
                      !isEmpty
                        ? (event) => {
                            event.dataTransfer.setData("sourceIndex", absoluteIndex.toString());
                            event.dataTransfer.effectAllowed = "move";
                            setDraggingSlot(absoluteIndex);
                          }
                        : undefined
                    }
                    onDragEnd={() => {
                      setDraggingSlot(null);
                      setHoveredSlot(null);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setHoveredSlot(absoluteIndex);
                    }}
                    onDragLeave={() => {
                      setHoveredSlot((current) => (current === absoluteIndex ? null : current));
                    }}
                    onDrop={(event) => handleDrop(localIndex, event)}
                    onClick={
                      !isEmpty
                        ? () => {
                            if (draggingSlot !== null) {
                              return;
                            }
                            setEditingSlotIndex(absoluteIndex);
                          }
                        : undefined
                    }
                    className={`group relative aspect-[4/5] overflow-hidden rounded-md transition ${
                      isEmpty
                        ? `border border-dashed ${
                            isHovered
                              ? "border-zinc-300 bg-zinc-800/80 shadow-[0_0_0_1px_rgba(244,244,245,0.5)]"
                              : "border-zinc-700 bg-zinc-900/70"
                          }`
                        : "cursor-pointer border border-zinc-800 bg-zinc-900 ring-white/20 group-hover:ring-2"
                    } ${draggingSlot === absoluteIndex ? "opacity-50" : ""}`}
                  >
                    {slot ? (
                      <>
                        <img
                          src={slot.fileUrl}
                          alt={`Scheduled slot ${absoluteIndex + 1}`}
                          className="h-full w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDeleteScheduledPost(absoluteIndex);
                          }}
                          className="absolute right-2 top-2 z-10 rounded-md bg-black/70 p-1 text-zinc-200 opacity-0 transition hover:bg-red-600/90 hover:text-white group-hover:opacity-100"
                          title="Delete post"
                          aria-label={`Delete post in slot ${absoluteIndex + 1}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                        </button>
                        <span className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-0.5 text-[10px] font-medium text-zinc-100">
                          {slot.scheduledAt ? badgeFormatter.format(slot.scheduledAt) : "Pending"}
                        </span>
                      </>
                    ) : (
                      <div className="flex h-full items-center justify-center text-center text-[11px] text-zinc-500">
                        Drop image
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {editingSlotIndex !== null && editingSlot ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 flex w-full max-w-3xl flex-col gap-6 rounded-xl border border-white/10 bg-neutral-900 p-6 shadow-2xl md:flex-row">
            <div className="md:w-1/2">
              <div className="relative aspect-[4/5] overflow-hidden rounded-lg border border-white/10 bg-neutral-800">
                <img src={editingSlot.fileUrl} alt="Post preview" className="h-full w-full object-cover" />
              </div>
              <p className="mt-3 text-xs text-zinc-400">
                Scheduled: {editingSlot.scheduledAt ? badgeFormatter.format(editingSlot.scheduledAt) : "Pending"}
              </p>
            </div>

            <div className="flex min-h-[260px] flex-1 flex-col">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-300">Post Details</h3>
              <textarea
                value={captionDraft}
                onChange={(event) => setCaptionDraft(event.target.value)}
                placeholder="Write your caption here..."
                className="h-full min-h-[200px] flex-1 resize-none rounded-lg border border-white/10 bg-neutral-800 p-4 text-white placeholder-gray-500 outline-none focus:border-blue-500"
              />
              <div className="mt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleGenerateHashtags}
                  disabled={isGeneratingTags}
                  className="flex items-center gap-1 rounded-md bg-gradient-to-r from-purple-500 to-blue-500 px-3 py-1.5 text-xs text-white transition-all hover:from-purple-600 hover:to-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isGeneratingTags ? "Generating..." : "✨ Generate Hashtags"}
                </button>
                <div className="text-xs text-zinc-500" />
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingSlotIndex(null);
                    setIsGeneratingTags(false);
                  }}
                  className="rounded border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handlePublishNow}
                  disabled={isPublishing || isPublishingTikTok}
                  className="rounded border border-fuchsia-500 bg-gradient-to-r from-fuchsia-600 to-pink-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:from-fuchsia-500 hover:to-pink-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPublishing ? "Publishing…" : "🚀 Publish to Instagram"}
                </button>
                <button
                  type="button"
                  onClick={() => void handlePublishTikTok()}
                  disabled={
                    isPublishingTikTok ||
                    isPublishing ||
                    !editingSlot ||
                    !activeProfile ||
                    !hasTikTokConnected(activeProfile) ||
                    !isSchedulerMp4VideoUrl(editingSlot.fileUrl)
                  }
                  className="rounded border border-cyan-500/70 bg-cyan-950/50 px-4 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-900/50 disabled:cursor-not-allowed disabled:opacity-45"
                  title={
                    !activeProfile || !hasTikTokConnected(activeProfile)
                      ? "Connect TikTok via Manage Connections first"
                      : editingSlot && !isSchedulerMp4VideoUrl(editingSlot.fileUrl)
                        ? "Requires a public .mp4 file URL"
                        : undefined
                  }
                >
                  {isPublishingTikTok ? "Publishing…" : "🎵 Publish to TikTok"}
                </button>
                <button
                  type="button"
                  onClick={handleSaveCaption}
                  className="rounded border border-blue-500 bg-blue-500/90 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500"
                >
                  Save Caption
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isAddProfileModalOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-profile-title"
            className="w-full max-w-md rounded-xl border border-white/10 bg-zinc-900 p-6 shadow-2xl"
          >
            <h3 id="add-profile-title" className="text-lg font-semibold text-zinc-100">
              Add Social Profile
            </h3>
            <p className="mt-1 text-sm text-zinc-400">
              Link a social account to {activeClientName}.
            </p>

            <div className="mt-5 space-y-4">
              <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Platform
                <select
                  value={newPlatform}
                  onChange={(event) => setNewPlatform(event.target.value as Platform)}
                  disabled={isSavingProfile}
                  className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none ring-zinc-500 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="instagram">Instagram</option>
                  <option value="tiktok">TikTok</option>
                </select>
              </label>

              <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Account Handle
                <input
                  type="text"
                  value={newProfileHandle}
                  onChange={(event) => setNewProfileHandle(event.target.value)}
                  placeholder="@mybrand"
                  disabled={isSavingProfile}
                  className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none ring-zinc-500 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeAddProfileModal}
                disabled={isSavingProfile}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitNewProfile()}
                disabled={isSavingProfile}
                className="rounded-lg border border-zinc-200 bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingProfile ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <SocialConnectionsModal
        open={socialConnectionsOpen}
        onClose={() => setSocialConnectionsOpen(false)}
        activeProfileId={activeProfileId}
        activeProfile={activeProfile}
        hasSupabase={Boolean(supabase)}
        metaOAuthHref={metaOAuthHref}
        igSelector={igSelector}
        onIgSelectorClose={() => setIgSelector(null)}
        onConnectionsChanged={() => setProfilesRefreshKey((k) => k + 1)}
        onProfilesPatched={(fn) => setProfiles(fn)}
      />
    </div>
  );
}
