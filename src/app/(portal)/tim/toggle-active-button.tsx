"use client";

import { useTransition } from "react";
import { setTeamMemberActive } from "./actions";

/** Tombol Nonaktifkan/Aktifkan per baris — konfirmasi native sebelum mencabut akses. */
export function ToggleActiveButton({
  memberId, memberName, active,
}: {
  memberId: string;
  memberName: string;
  active: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    const verb = active ? "menonaktifkan" : "mengaktifkan";
    if (!confirm(`Yakin ${verb} akun ${memberName}? Aksesnya akan langsung ${active ? "dicabut" : "dipulihkan"}.`)) {
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("member_id", memberId);
      fd.set("active", String(!active));
      const res = await setTeamMemberActive(fd);
      if (!res.ok) alert(res.message);
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={
        active
          ? "rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          : "rounded-md border border-green-300 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
      }
    >
      {pending ? "..." : active ? "Nonaktifkan" : "Aktifkan"}
    </button>
  );
}
