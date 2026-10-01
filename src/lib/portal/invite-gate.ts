import { hasPermission, type Role } from "@/lib/rbac-constants";

/**
 * Who may invite a creator to the Creator Portal, and from where (pure; shared by the
 * server action and the pages that decide whether to render <PortalInviteButton>).
 *
 *  - "any":     `m9.invite` (Management + CM + Acquisition) — any creator in scope,
 *               from /creators/[id], CM Workspace or a Special Project.
 *  - "project": `m7.curate` only (e.g. bizdev, campaign_ops — Improvement MCN Q5, user
 *               decision 2026-10-01): only a PARTICIPANT of the Special Project the
 *               invite is sent from.
 *  - null:      no invite rights.
 *
 * CPM scope (own creators only) is applied on top by assertCreatorInScope.
 */
export type PortalInviteGate = "any" | "project" | null;

export function portalInviteGate(role: Role): PortalInviteGate {
  if (hasPermission("m9.invite", role)) return "any";
  if (hasPermission("m7.curate", role)) return "project";
  return null;
}
