import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  createSubcontractor,
  getSubcontractor,
  updateSubcontractor,
  type SaveSubcontractorPayload,
  type SubcontractorRegistrationType,
} from "../../api/subcontractors";

export function SubcontractorFormPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const detailQ = useQuery({
    queryKey: ["subcontractors", id],
    queryFn: () => getSubcontractor(id!).then((r) => r.data),
    enabled: !isNew && !!id,
  });

  const [form, setForm] = useState({
    legalName: "",
    registrationType: "srl" as SubcontractorRegistrationType,
    registrationNumber: "",
    taxId: "",
    email: "",
    phone: "",
    address: "",
    bankName: "",
    bankAccountIban: "",
    status: "active",
    contractStartDate: "",
    contractEndDate: "",
    notes: "",
  });

  useEffect(() => {
    const d = detailQ.data;
    if (!d) return;
    setForm({
      legalName: d.legal_name,
      registrationType: (d.registration_type as SubcontractorRegistrationType) || "srl",
      registrationNumber: d.registration_number ?? "",
      taxId: d.tax_id ?? "",
      email: d.email ?? "",
      phone: d.phone ?? "",
      address: d.address ?? "",
      bankName: d.bank_name ?? "",
      bankAccountIban: d.bank_account_iban ?? "",
      status: d.status,
      contractStartDate: d.contract_start_date?.slice(0, 10) ?? "",
      contractEndDate: d.contract_end_date?.slice(0, 10) ?? "",
      notes: d.notes ?? "",
    });
  }, [detailQ.data]);

  const saveMut = useMutation({
    mutationFn: async (body: SaveSubcontractorPayload) => {
      if (isNew) return createSubcontractor(body).then((r) => r.data);
      return updateSubcontractor(id!, body).then((r) => r.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["subcontractors"] });
      navigate("/subcontractors");
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : "Save failed"),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!form.legalName.trim()) {
      setErr("Legal name is required.");
      return;
    }
    const body: SaveSubcontractorPayload = {
      legalName: form.legalName.trim(),
      registrationType: form.registrationType,
      registrationNumber: form.registrationNumber.trim() || null,
      taxId: form.taxId.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      bankName: form.bankName.trim() || null,
      bankAccountIban: form.bankAccountIban.trim() || null,
      status: form.status,
      contractStartDate: form.contractStartDate.trim() || null,
      contractEndDate: form.contractEndDate.trim() || null,
      notes: form.notes.trim() || null,
    };
    saveMut.mutate(body);
  };

  return (
    <div className="min-h-full bg-slate-100">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/subcontractors" className="text-sm text-slate-600 hover:text-slate-900">
            Subcontractors
          </Link>
          <h1 className="text-xl font-semibold text-slate-900">{isNew ? "New subcontractor" : "Edit subcontractor"}</h1>
        </div>
      </header>
      <main className="p-4 sm:p-6 max-w-2xl">
        {!isNew && detailQ.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {err && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>}
        {!isNew && detailQ.isError && <p className="text-sm text-red-700">Could not load subcontractor.</p>}
        {(isNew || detailQ.data) && (
          <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div>
              <label className="block text-sm font-medium text-slate-700">Legal name</label>
              <input
                required
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={form.legalName}
                onChange={(e) => setForm((f) => ({ ...f, legalName: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Registration type</label>
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={form.registrationType}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, registrationType: e.target.value as SubcontractorRegistrationType }))
                  }
                >
                  <option value="srl">SRL</option>
                  <option value="sa">SA</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Status</label>
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Registration number</label>
              <input
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={form.registrationNumber}
                onChange={(e) => setForm((f) => ({ ...f, registrationNumber: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Tax ID</label>
              <input
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={form.taxId}
                onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Email</label>
                <input
                  type="email"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Phone</label>
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Address</label>
              <textarea
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                rows={2}
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Bank name</label>
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={form.bankName}
                  onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">IBAN</label>
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={form.bankAccountIban}
                  onChange={(e) => setForm((f) => ({ ...f, bankAccountIban: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Contract start</label>
                <input
                  type="date"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={form.contractStartDate}
                  onChange={(e) => setForm((f) => ({ ...f, contractStartDate: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Contract end</label>
                <input
                  type="date"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={form.contractEndDate}
                  onChange={(e) => setForm((f) => ({ ...f, contractEndDate: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Notes</label>
              <textarea
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            {!isNew && detailQ.data?.drivers && detailQ.data.drivers.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-medium text-slate-800">Linked drivers</p>
                <ul className="mt-2 text-sm text-slate-700 space-y-1">
                  {detailQ.data.drivers.map((d) => (
                    <li key={d.id}>
                      {d.first_name} {d.last_name} — {d.phone}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={saveMut.isPending}
                className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
              >
                {saveMut.isPending ? "Saving…" : "Save"}
              </button>
              <Link
                to="/subcontractors"
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </Link>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
