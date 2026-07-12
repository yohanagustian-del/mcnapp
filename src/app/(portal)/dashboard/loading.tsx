import { SkeletonTitle, SkeletonSubtitle, SkeletonStatGrid } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <SkeletonTitle />
      <SkeletonSubtitle />
      <SkeletonStatGrid n={3} />
    </div>
  );
}
