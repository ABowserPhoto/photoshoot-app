import { NextResponse } from "next/server";

import {
  normalizeAccessibleModules,
  type AppModule,
} from "@/lib/appModules";
import { crmRoleFormValue, formatCrmUserRole, normalizeAssignableRole } from "@/lib/crmUserRoles";
import { getAdminAreaAuth } from "@/lib/server/getAdminAreaAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type CrmUserRecord = {
  id: string;
  name: string;
  email: string;
  createdAt: string | null;
  createdAtLabel: string;
  role: string;
  roleKey: "admin" | "staff";
  jibblePersonId: string | null;
  isArchived: boolean;
  accessibleModules: AppModule[];
};

function formatCreatedAtLabel(value: string | null): string {
  if (!value?.trim()) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function readMetadataName(metadata: Record<string, unknown>): string {
  const name = metadata.name;
  return typeof name === "string" ? name.trim() : "";
}

function mapUserRecord(
  user: {
    id: string;
    email?: string | null;
    created_at?: string;
    user_metadata?: Record<string, unknown> | null;
  },
  jibblePersonId: string | null = null,
  isArchived = false,
  accessibleModules: AppModule[] = []
): CrmUserRecord {
  const metadata = user.user_metadata ?? {};
  const createdAt = user.created_at ?? null;

  return {
    id: user.id,
    name: readMetadataName(metadata),
    email: user.email?.trim() ?? "",
    createdAt,
    createdAtLabel: formatCreatedAtLabel(createdAt),
    role: formatCrmUserRole(metadata.role),
    roleKey: crmRoleFormValue(metadata.role),
    jibblePersonId,
    isArchived,
    accessibleModules,
  };
}

async function upsertUserProfile(
  supabaseAdmin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  payload: {
    id: string;
    email: string;
    role: string;
    name: string;
    accessibleModules: AppModule[];
  }
) {
  const { error: profileError } = await supabaseAdmin.from("profiles").upsert(
    {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      full_name: payload.name || null,
      // Admins ignore modules; store empty to keep the column clean.
      accessible_modules: payload.role === "admin" ? [] : payload.accessibleModules,
    },
    { onConflict: "id" }
  );

  if (profileError) {
    console.warn("[crm/users] profiles upsert failed:", profileError.message);
  }
}

async function listAllUsers() {
  const supabaseAdmin = createSupabaseAdminClient();
  if (!supabaseAdmin) {
    return { error: "Supabase admin client is not configured. Set SUPABASE_SERVICE_ROLE_KEY." as const };
  }

  const authUsers: Array<{
    id: string;
    email?: string | null;
    created_at?: string;
    user_metadata?: Record<string, unknown> | null;
  }> = [];

  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) {
      return { error: error.message };
    }

    const batch = data.users ?? [];
    authUsers.push(...batch);

    if (batch.length < perPage) {
      break;
    }
    page += 1;
  }

  // Fetch jibble + archive + module grants from profiles for all users in one query.
  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, jibble_employee_id, is_archived, accessible_modules");

  const jibbleMap = new Map<string, string | null>();
  const archivedMap = new Map<string, boolean>();
  const modulesMap = new Map<string, AppModule[]>();
  for (const profile of profiles ?? []) {
    const p = profile as {
      id: string;
      jibble_employee_id?: string | null;
      is_archived?: boolean | null;
      accessible_modules?: unknown;
    };
    jibbleMap.set(p.id, p.jibble_employee_id?.trim() || null);
    archivedMap.set(p.id, p.is_archived === true);
    modulesMap.set(p.id, normalizeAccessibleModules(p.accessible_modules));
  }

  return {
    users: authUsers
      .map((u) =>
        mapUserRecord(
          u,
          jibbleMap.get(u.id) ?? null,
          archivedMap.get(u.id) ?? false,
          modulesMap.get(u.id) ?? []
        )
      )
      .sort((a, b) => {
        // Active users first, then archived; stable email order within each group.
        if (a.isArchived !== b.isArchived) {
          return a.isArchived ? 1 : -1;
        }
        return a.email.localeCompare(b.email, "en");
      }),
  };
}

export async function GET() {
  const auth = await getAdminAreaAuth();
  if (!auth.authenticated || !auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await listAllUsers();
  if ("error" in result) {
    const errMsg = result.error as string;
    return NextResponse.json({ error: errMsg }, { status: errMsg.includes("configured") ? 503 : 400 });
  }

  return NextResponse.json({ ok: true, users: result.users });
}

type CreateUserBody = {
  name?: unknown;
  email?: unknown;
  password?: unknown;
  role?: unknown;
  accessibleModules?: unknown;
};

export async function POST(request: Request) {
  const auth = await getAdminAreaAuth();
  if (!auth.authenticated || !auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: CreateUserBody;
  try {
    body = (await request.json()) as CreateUserBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role = normalizeAssignableRole(body.role);
  const accessibleModules =
    role === "admin" ? [] : normalizeAccessibleModules(body.accessibleModules);

  if (!email) {
    return NextResponse.json({ error: "email is required." }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "password must be at least 8 characters." }, { status: 400 });
  }
  if (!role) {
    return NextResponse.json({ error: 'role must be "admin" or "staff".' }, { status: 400 });
  }

  const supabaseAdmin = createSupabaseAdminClient();
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Supabase admin client is not configured. Set SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 }
    );
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role, name },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const createdUser = data.user;
  if (createdUser) {
    await upsertUserProfile(supabaseAdmin, {
      id: createdUser.id,
      email,
      role,
      name,
      accessibleModules,
    });
  }

  if (!createdUser) {
    return NextResponse.json({ error: "User was created but no user record was returned." }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: true,
      user: mapUserRecord(
        {
          id: createdUser.id,
          email: createdUser.email,
          created_at: createdUser.created_at,
          user_metadata: createdUser.user_metadata as Record<string, unknown>,
        },
        null,
        false,
        accessibleModules
      ),
    },
    { status: 201 }
  );
}

type UpdateUserBody = {
  id?: unknown;
  name?: unknown;
  email?: unknown;
  role?: unknown;
  accessibleModules?: unknown;
};

export async function PATCH(request: Request) {
  const auth = await getAdminAreaAuth();
  if (!auth.authenticated || !auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: UpdateUserBody;
  try {
    body = (await request.json()) as UpdateUserBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = normalizeAssignableRole(body.role);
  const accessibleModules =
    role === "admin" ? [] : normalizeAccessibleModules(body.accessibleModules);

  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  if (!email) {
    return NextResponse.json({ error: "email is required." }, { status: 400 });
  }
  if (!role) {
    return NextResponse.json({ error: 'role must be "admin" or "staff".' }, { status: 400 });
  }

  const supabaseAdmin = createSupabaseAdminClient();
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Supabase admin client is not configured. Set SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 }
    );
  }

  const { data: existingData, error: existingError } = await supabaseAdmin.auth.admin.getUserById(id);
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }
  if (!existingData.user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const existingMetadata = (existingData.user.user_metadata ?? {}) as Record<string, unknown>;

  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(id, {
    email,
    user_metadata: {
      ...existingMetadata,
      role,
      name,
    },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const updatedUser = data.user;
  if (!updatedUser) {
    return NextResponse.json({ error: "User update succeeded but no user record was returned." }, { status: 500 });
  }

  await upsertUserProfile(supabaseAdmin, {
    id: updatedUser.id,
    email,
    role,
    name,
    accessibleModules,
  });

  const { data: profileRow } = await supabaseAdmin
    .from("profiles")
    .select("jibble_employee_id, is_archived, accessible_modules")
    .eq("id", updatedUser.id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    user: mapUserRecord(
      {
        id: updatedUser.id,
        email: updatedUser.email,
        created_at: updatedUser.created_at,
        user_metadata: updatedUser.user_metadata as Record<string, unknown>,
      },
      typeof profileRow?.jibble_employee_id === "string"
        ? profileRow.jibble_employee_id.trim() || null
        : null,
      profileRow?.is_archived === true,
      normalizeAccessibleModules(profileRow?.accessible_modules)
    ),
  });
}
