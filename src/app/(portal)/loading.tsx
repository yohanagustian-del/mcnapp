import { SkeletonTitle, SkeletonSubtitle, SkeletonTable } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <SkeletonTitle />
      <SkeletonSubtitle />
      <SkeletonTable rows={6} cols={4} />
    </div>
  );
}
