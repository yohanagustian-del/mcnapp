/**
 * M7 v2 (PRD §6.1, R1): special_projects.type is now the enum `project_type_t`
 * instead of free text. Single list shared by the create-project form and its
 * server action validation (CLAUDE.md #4: one source of truth).
 */
export const PROJECT_TYPES = [
  { value: "bootcamp", label: "Bootcamp" },
  { value: "training", label: "Training" },
  { value: "event", label: "Event" },
  { value: "showcase", label: "Showcase" },
  { value: "campaign", label: "Campaign" },
  { value: "trip", label: "Trip" },
  { value: "other", label: "Lainnya" },
] as const;

export type ProjectType = (typeof PROJECT_TYPES)[number]["value"];

export function isProjectType(value: string): value is ProjectType {
  return PROJECT_TYPES.some((t) => t.value === value);
}

/**
 * M7 v2 (§6.2): project_manpower.role is now the enum `manpower_role_t`.
 */
export const MANPOWER_ROLES = [
  { value: "pic", label: "PIC" },
  { value: "project_manager", label: "Project Manager" },
  { value: "cm", label: "CM" },
  { value: "cpm", label: "CPM" },
  { value: "akuisisi", label: "Akuisisi" },
  { value: "bizdev", label: "BizDev" },
  { value: "support", label: "Support" },
  { value: "other", label: "Lainnya" },
] as const;

export type ManpowerRole = (typeof MANPOWER_ROLES)[number]["value"];

export function isManpowerRole(value: string): value is ManpowerRole {
  return MANPOWER_ROLES.some((r) => r.value === value);
}
