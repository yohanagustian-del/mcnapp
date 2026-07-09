import { createAdminClient } from "@/lib/supabase/admin";

export type AuditType = "auto" | "approval" | "platform_alert";

export interface AuditEntry {
  actorId?: string | null; // uuid → team_members (internal / director:<id>); null = non-team actor/engine
  actorLabel?: string | null; // string actor for non-team_members: 'creator_user:CRT-xxxxx', 'system:retention'
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  type: AuditType;
}

/**
 * Centralized audit writer (CLAUDE.md #2): every material mutation MUST call this.
 * Uses the service-role client so the log is append-only for regular users.
 * Throws on failure — a mutation without its audit trail is a bug, not a warning.
 *
 * External principals (creator_user) and system jobs (retention) are not in team_members,
 * so their actor is recorded via actorLabel while actor_id stays null.
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("audit_logs").insert({
    actor_id: entry.actorId ?? null,
    actor_label: entry.actorLabel ?? null,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    type: entry.type,
  });
  if (error) throw new Error(`writeAudit failed: ${error.message}`);
}
