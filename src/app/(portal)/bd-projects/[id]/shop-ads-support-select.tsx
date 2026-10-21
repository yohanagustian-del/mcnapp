"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { updateProjectShopAdsSupport, type ProjectFormState } from "../actions";

/**
 * Pilihan Ads Support satu shop di project ini (bd_project_shops.ads_support, 0097).
 * Tersimpan begitu pilihan diganti; nilai lama di luar daftar tetap tampil.
 */
export function ShopAdsSupportSelect({
  projectId,
  shopKey,
  value,
  options,
}: {
  projectId: string;
  shopKey: string;
  value: string | null;
  options: string[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<ProjectFormState | null, FormData>(
    updateProjectShopAdsSupport,
    null
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  const list = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <form ref={formRef} action={formAction} className="min-w-48">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="shop_key" value={shopKey} />
      <select
        name="ads_support"
        defaultValue={value ?? ""}
        disabled={pending}
        onChange={() => formRef.current?.requestSubmit()}
        aria-label={`Ads Support ${shopKey}`}
        className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
      >
        <option value="">— belum diatur —</option>
        {list.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      {state && !state.ok && (
        <span className="mt-1 block text-xs text-red-600" role="alert">{state.message}</span>
      )}
    </form>
  );
}
