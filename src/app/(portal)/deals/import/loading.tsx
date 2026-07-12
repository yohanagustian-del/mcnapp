import { SkeletonTitle, SkeletonSubtitle, SkeletonCard } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <SkeletonTitle />
      <SkeletonSubtitle />
      <SkeletonCard rows={6} />
    </div>
  );
}
