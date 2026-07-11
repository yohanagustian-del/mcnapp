import { SkeletonTitle, SkeletonTable } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <SkeletonTitle />
      <SkeletonTable rows={8} cols={5} />
    </div>
  );
}
