/**
 * M7 v2 (PRD R3): special_projects.slug — the public signup link. Built from the
 * name + id (id is always unique, so no collision handling is needed) rather than
 * from a random token, so the URL stays legible.
 */
export function slugifyProjectName(name: string, id: number | string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "project"}-${id}`;
}
