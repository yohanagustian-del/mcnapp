import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  PAYMENT_TERMS,
  PAYMENT_TERMS_LABELS,
  TXN_DIRECTIONS,
  TXN_DIRECTION_LABELS,
  type FinanceTransaction,
} from "@/lib/finance/transaction";
import { FIELD_LABELS, MIN_REASON_LENGTH, type EditableField } from "@/lib/finance/change-request";
import { requestTransactionChange } from "../actions";

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

/**
 * Form pengajuan perubahan transaksi (Senior/Lead Finance).
 *
 * Server component — semua field dirender dengan nilai sekarang sebagai default;
 * server action yang menghitung field mana yang benar-benar berubah (diffTransaction),
 * lalu memecahnya jadi "butuh approval Director" vs "berlaku langsung" memakai
 * app_config finance.guarded_fields. Jadi tanda "approval" di sini adalah tampilan
 * dari config yang sama, bukan daftar kedua yang bisa melenceng.
 */
export function ChangeRequestForm({
  transaction,
  guardedFields,
}: {
  transaction: FinanceTransaction;
  guardedFields: readonly string[];
}) {
  const badge = (field: EditableField) =>
    guardedFields.includes(field) ? (
      <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800">
        approval
      </span>
    ) : (
      <span className="ml-1 rounded bg-emerald-100 px-1 text-[10px] font-medium text-emerald-800">
        langsung
      </span>
    );

  const Label = ({ field }: { field: EditableField }) => (
    <p className="text-xs font-medium text-slate-600">
      {FIELD_LABELS[field]}
      {badge(field)}
    </p>
  );

  return (
    <form action={requestTransactionChange} className="mt-3 rounded-lg border border-slate-200 bg-white p-4">
      <input type="hidden" name="transaction_id" value={transaction.id} />

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label field="payment_method" />
          <select name="payment_method" defaultValue={transaction.payment_method} className={input}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
            ))}
          </select>
        </div>
        <div>
          <Label field="payment_terms" />
          <select name="payment_terms" defaultValue={transaction.payment_terms} className={input}>
            {PAYMENT_TERMS.map((t) => (
              <option key={t} value={t}>{PAYMENT_TERMS_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <Label field="payment_status" />
          <select name="payment_status" defaultValue={transaction.payment_status} className={input}>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>{PAYMENT_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>

        <div>
          <Label field="bank_name" />
          <input name="bank_name" defaultValue={transaction.bank_name ?? ""} className={input} />
        </div>
        <div>
          <Label field="bank_account_no" />
          <input name="bank_account_no" defaultValue={transaction.bank_account_no ?? ""} className={input} />
        </div>
        <div>
          <Label field="bank_account_name" />
          <input name="bank_account_name" defaultValue={transaction.bank_account_name ?? ""} className={input} />
        </div>

        <div>
          <Label field="amount" />
          <input name="amount" defaultValue={String(transaction.amount)} className={input} />
        </div>
        <div>
          <Label field="invoice_no" />
          <input name="invoice_no" defaultValue={transaction.invoice_no ?? ""} className={input} />
        </div>
        <div>
          <Label field="direction" />
          <select name="direction" defaultValue={transaction.direction} className={input}>
            {TXN_DIRECTIONS.map((d) => (
              <option key={d} value={d}>{TXN_DIRECTION_LABELS[d]}</option>
            ))}
          </select>
        </div>

        <div>
          <Label field="due_date" />
          <input type="date" name="due_date" defaultValue={transaction.due_date ?? ""} className={input} />
        </div>
        <div>
          <Label field="paid_at" />
          <input type="date" name="paid_at" defaultValue={transaction.paid_at ?? ""} className={input} />
        </div>
        <div>
          <Label field="client_name" />
          <input name="client_name" defaultValue={transaction.client_name} className={input} />
        </div>

        <div className="sm:col-span-3">
          <Label field="notes" />
          <input name="notes" defaultValue={transaction.notes ?? ""} className={input} />
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs font-medium text-slate-600">
          Alasan perubahan (dibaca Director saat memutuskan, minimal {MIN_REASON_LENGTH} karakter)
        </p>
        <textarea
          name="reason"
          required
          rows={2}
          placeholder="Contoh: Klien minta pindah ke Virtual Account BCA per 4 Agustus, konfirmasi via email PIC."
          className={input}
        />
      </div>

      <button
        type="submit"
        className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
      >
        Ajukan Perubahan
      </button>
    </form>
  );
}
