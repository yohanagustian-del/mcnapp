"use client";

import { useEffect } from "react";
import {
  ROLES,
  ROLE_LABELS,
  SEGMENTS,
  TEAM_GROUPS,
  TEAM_GROUP_LABELS,
  type Role,
} from "@/lib/tim/roles";

const labelCls = "block text-xs font-medium text-slate-600";
const inputCls =
  "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none";

const SEGMENT_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  shopee: "Shopee",
  celeb: "Celeb",
};

/** Modal sederhana: klik latar / Escape untuk menutup. Dipakai semua dialog manajemen user. */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export interface MemberFieldValues {
  name?: string;
  email?: string;
  role?: string;
  team_group?: string;
  platform_segment?: string | null;
  active?: boolean;
}

/**
 * Field data anggota tim — dipakai bersama oleh form tambah/edit milik Director dan
 * form usulan milik OD, supaya aturan yang tampil (mis. email terkunci saat edit)
 * tidak pernah berbeda antar halaman.
 */
export function MemberFields({
  idPrefix,
  values,
  mode,
}: {
  idPrefix: string;
  values?: MemberFieldValues;
  /** create = email bisa diisi; edit = email terkunci; propose-update = tanpa kolom status. */
  mode: "create" | "edit" | "propose-update";
}) {
  const showEmail = mode === "create";
  const showActive = mode === "edit";

  return (
    <>
      <div className="col-span-2">
        <label className={labelCls} htmlFor={`${idPrefix}-name`}>
          Nama Lengkap
        </label>
        <input
          id={`${idPrefix}-name`}
          name="name"
          required
          defaultValue={values?.name ?? ""}
          className={inputCls}
        />
      </div>

      {showEmail ? (
        <div className="col-span-2">
          <label className={labelCls} htmlFor={`${idPrefix}-email`}>
            Email (dipakai untuk login)
          </label>
          <input
            id={`${idPrefix}-email`}
            name="email"
            type="email"
            required
            defaultValue={values?.email ?? ""}
            className={inputCls}
          />
        </div>
      ) : (
        values?.email && (
          <div className="col-span-2">
            <label className={labelCls}>Email (tidak bisa diubah)</label>
            <p className="mt-1 rounded-md bg-slate-50 px-2 py-1.5 text-sm text-slate-500">
              {values.email}
            </p>
          </div>
        )
      )}

      <div>
        <label className={labelCls} htmlFor={`${idPrefix}-role`}>
          Jabatan
        </label>
        <select
          id={`${idPrefix}-role`}
          name="role"
          required
          defaultValue={values?.role ?? ""}
          className={inputCls}
        >
          <option value="" disabled>
            Pilih jabatan…
          </option>
          {ROLES.map((r: Role) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelCls} htmlFor={`${idPrefix}-team_group`}>
          Divisi
        </label>
        <select
          id={`${idPrefix}-team_group`}
          name="team_group"
          defaultValue={values?.team_group ?? ""}
          className={inputCls}
        >
          <option value="">Otomatis dari jabatan</option>
          {TEAM_GROUPS.map((g) => (
            <option key={g} value={g}>
              {TEAM_GROUP_LABELS[g]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelCls} htmlFor={`${idPrefix}-platform_segment`}>
          Segmen Platform
        </label>
        <select
          id={`${idPrefix}-platform_segment`}
          name="platform_segment"
          defaultValue={values?.platform_segment ?? ""}
          className={inputCls}
        >
          <option value="">— tidak spesifik —</option>
          {SEGMENTS.map((s) => (
            <option key={s} value={s}>
              {SEGMENT_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {showActive && (
        <div>
          <label className={labelCls} htmlFor={`${idPrefix}-active`}>
            Status
          </label>
          <select
            id={`${idPrefix}-active`}
            name="active"
            defaultValue={values?.active === false ? "false" : "true"}
            className={inputCls}
          >
            <option value="true">Aktif</option>
            <option value="false">Nonaktif (tidak bisa login)</option>
          </select>
        </div>
      )}
    </>
  );
}

export { inputCls, labelCls };
