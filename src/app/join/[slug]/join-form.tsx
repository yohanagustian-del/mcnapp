"use client";

import { useState } from "react";

/**
 * Public signup form (no auth) — posts straight to `/api/join/{slug}` (service
 * role, R8/§3.5). Client component only for the fetch + inline result; no
 * server action here since the route handler already owns validation + writes.
 */
export function JoinForm({ slug, joinRequirements }: { slug: string; joinRequirements: string | null }) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const payload = {
      full_name: String(formData.get("full_name") ?? ""),
      username: String(formData.get("username") ?? ""),
      platform: String(formData.get("platform") ?? "tiktok"),
      phone: String(formData.get("phone") ?? ""),
      followers: String(formData.get("followers") ?? ""),
      niche: String(formData.get("niche") ?? ""),
      answers: { jawaban: String(formData.get("jawaban") ?? "") },
      consent_contact: formData.get("consent_contact") === "on",
    };
    try {
      const res = await fetch(`/api/join/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setResult({ ok: true, message: "Pendaftaran diterima — tim MCN MEA akan menghubungi kamu." });
        form.reset();
      } else {
        setResult({ ok: false, message: data.error ?? "Gagal mengirim pendaftaran." });
      }
    } catch {
      setResult({ ok: false, message: "Gagal terhubung ke server — coba lagi." });
    } finally {
      setSubmitting(false);
    }
  }

  if (result?.ok) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
        {result.message}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <input name="full_name" required placeholder="Nama lengkap"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      <input name="username" required placeholder="Username (mis. vikahere)"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      <select name="platform" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
        <option value="tiktok">TikTok</option>
        <option value="shopee">Shopee</option>
      </select>
      <input name="phone" placeholder="Nomor WhatsApp"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      <input name="followers" type="number" min="0" placeholder="Jumlah followers"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      <input name="niche" placeholder="Niche (mis. Beauty, Fashion)"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      {joinRequirements && (
        <div>
          <label className="mb-1 block text-xs text-slate-500">{joinRequirements}</label>
          <textarea name="jawaban" rows={3} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </div>
      )}
      <label className="flex items-start gap-2 text-xs text-slate-500">
        <input type="checkbox" name="consent_contact" required className="mt-0.5" />
        Saya setuju dihubungi tim MCN MEA terkait pendaftaran ini.
      </label>
      <button type="submit" disabled={submitting}
        className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
        {submitting ? "Mengirim…" : "Daftar"}
      </button>
      {result && !result.ok && <p className="text-xs text-red-700">{result.message}</p>}
    </form>
  );
}
