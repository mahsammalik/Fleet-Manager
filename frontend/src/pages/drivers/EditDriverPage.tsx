import type { FormEvent } from "react";
import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  getDriverById,
  updateDriver,
  type CreateDriverPayload,
  type CommissionType,
  type Driver,
} from "../../api/drivers";
import { CommissionInput } from "../../components/drivers/CommissionInput";
import { DocumentUpload } from "../../components/documents/DocumentUpload";
import { DocumentList } from "../../components/documents/DocumentList";

const EMPLOYMENT_STATUSES = [
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "terminated", label: "Terminated" },
] as const;

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePhone(phone: string): boolean {
  return /^[\d\s+\-()]{8,}$/.test(phone.replace(/\s/g, ""));
}

function toDateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const d = value.split("T")[0];
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
}

function driverToForm(
  d: Driver
): CreateDriverPayload & {
  commissionType: CommissionType;
  fixedCommissionAmount: number;
  minimumCommission: number;
} {
  const commissionType = (d.commission_type as CommissionType) || "percentage";
  return {
    firstName: d.first_name ?? "",
    lastName: d.last_name ?? "",
    email: d.email ?? "",
    phone: d.phone ?? "",
    dateOfBirth: toDateInputValue(d.date_of_birth),
    address: d.address ?? "",
    licenseNumber: d.license_number ?? "",
    licenseExpiry: toDateInputValue(d.license_expiry),
    licenseClass: d.license_class ?? "",
    hireDate: toDateInputValue(d.hire_date),
    employmentStatus: (d.employment_status as "active" | "suspended" | "terminated") ?? "active",
    commissionRate: d.commission_rate != null ? Number(d.commission_rate) : 20,
    commissionType,
    fixedCommissionAmount:
      d.fixed_commission_amount != null ? Number(d.fixed_commission_amount) : 0,
    minimumCommission:
      d.minimum_commission != null ? Number(d.minimum_commission) : 0,
    uberDriverId: d.uber_driver_id ?? "",
    boltDriverId: d.bolt_driver_id ?? "",
    glovoCourierId: d.glovo_courier_id ?? "",
    boltCourierId: d.bolt_courier_id ?? "",
    notes: d.notes ?? "",
  };
}

export function EditDriverPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [success, setSuccess] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [commissionErrors, setCommissionErrors] = useState<Partial<Record<string, string>>>({});
  const [form, setForm] = useState<(CreateDriverPayload & {
    commissionType: CommissionType;
    fixedCommissionAmount: number;
    minimumCommission: number;
  }) | null>(null);

  const {
    data: driverResponse,
    isLoading: loadingDriver,
    isError: driverError,
  } = useQuery({
    queryKey: ["driver", id],
    queryFn: () => getDriverById(id!),
    enabled: !!id,
  });

  const driver = driverResponse?.data;

  useEffect(() => {
    if (driver) {
      setForm(driverToForm(driver));
    }
  }, [driver]);

  const mutation = useMutation({
    mutationFn: (payload: CreateDriverPayload) => updateDriver(id!, payload),
    onSuccess: () => {
      setSuccess(true);
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      queryClient.invalidateQueries({ queryKey: ["driver", id] });
      setTimeout(() => navigate("/drivers"), 1500);
    },
  });

  const validate = (): string | null => {
    if (!form) return null;
    if (!form.firstName?.trim()) return "First name is required.";
    if (!form.lastName?.trim()) return "Last name is required.";
    if (!form.phone?.trim()) return "Phone number is required.";
    if (form.phone && !validatePhone(form.phone)) return "Enter a valid phone number.";
    if (form.email?.trim() && !validateEmail(form.email)) return "Enter a valid email address.";
    const errs: Partial<Record<string, string>> = {};
    const type = form.commissionType ?? "percentage";
    if (type === "percentage" || type === "hybrid") {
      const rate = Number(form.commissionRate);
      if (Number.isNaN(rate) || rate < 0 || rate > 100)
        errs.commissionRate = "Commission rate must be between 0 and 100%.";
    }
    if (type === "fixed_amount" || type === "hybrid") {
      const fixed = Number(form.fixedCommissionAmount ?? 0);
      if (Number.isNaN(fixed) || fixed < 0)
        errs.fixedCommissionAmount = "Fixed amount must be 0 or greater.";
    }
    const min = Number(form.minimumCommission ?? 0);
    if (!Number.isNaN(min) && min < 0)
      errs.minimumCommission = "Minimum commission cannot be negative.";
    setCommissionErrors(errs);
    if (Object.keys(errs).length > 0) return "Please fix commission errors.";
    return null;
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const err = validate();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    const payload: CreateDriverPayload = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phone: form.phone.trim(),
      email: form.email?.trim() || undefined,
      dateOfBirth: form.dateOfBirth?.trim() || undefined,
      address: form.address?.trim() || undefined,
      licenseNumber: form.licenseNumber?.trim() || undefined,
      licenseExpiry: form.licenseExpiry?.trim() || undefined,
      licenseClass: form.licenseClass?.trim() || undefined,
      hireDate: form.hireDate?.trim() || undefined,
      employmentStatus: form.employmentStatus ?? "active",
      commissionRate: form.commissionRate ?? 20,
      commissionType: form.commissionType ?? "percentage",
      fixedCommissionAmount: form.fixedCommissionAmount ?? 0,
      minimumCommission: form.minimumCommission ?? 0,
      uberDriverId: form.uberDriverId?.trim() || undefined,
      boltDriverId: form.boltDriverId?.trim() || undefined,
      notes: form.notes?.trim() || undefined,
    };
    mutation.mutate(payload);
  };

  const update = (
    key:
      | keyof CreateDriverPayload
      | "commissionType"
      | "fixedCommissionAmount"
      | "minimumCommission"
      | "glovoCourierId"
      | "boltCourierId",
    value: string | number | undefined
  ) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : null));
  };

  if (!id) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <p className="text-slate-600">Missing driver ID.</p>
        <Link to="/drivers" className="ml-2 text-sky-600 hover:underline">
          Back to drivers
        </Link>
      </div>
    );
  }

  if (loadingDriver || form === null) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="inline-block w-8 h-8 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-600">Loading driver...</p>
        </div>
      </div>
    );
  }

  if (driverError) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-lg p-6 text-center max-w-md">
          <p className="text-red-600">Failed to load driver.</p>
          <Link to="/drivers" className="mt-3 inline-block text-sm text-sky-600 hover:underline">
            Back to drivers
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-lg p-8 text-center max-w-md">
          <p className="text-green-600 font-medium">Driver updated successfully.</p>
          <p className="text-sm text-slate-500 mt-1">Redirecting to drivers list...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-100">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Edit Driver</h1>
          <p className="text-xs text-slate-500 mt-0.5 font-mono">ID: {id}</p>
        </div>
        <Link to="/drivers" className="text-sm text-slate-600 hover:text-slate-900">
          ← Back to drivers
        </Link>
      </header>

      <main className="p-6 max-w-4xl mx-auto">
        <form onSubmit={onSubmit} className="bg-white shadow-sm rounded-xl p-6 space-y-6">
          <section>
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Personal info</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">First name *</label>
                <input
                  type="text"
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.firstName}
                  onChange={(e) => update("firstName", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Last name *</label>
                <input
                  type="text"
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.lastName}
                  onChange={(e) => update("lastName", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.email ?? ""}
                  onChange={(e) => update("email", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Phone *</label>
                <input
                  type="tel"
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.phone}
                  onChange={(e) => update("phone", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date of birth</label>
                <input
                  type="date"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.dateOfBirth ?? ""}
                  onChange={(e) => update("dateOfBirth", e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
                <input
                  type="text"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.address ?? ""}
                  onChange={(e) => update("address", e.target.value)}
                />
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-slate-800 mb-3">License info</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">License number</label>
                <input
                  type="text"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.licenseNumber ?? ""}
                  onChange={(e) => update("licenseNumber", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">License expiry</label>
                <input
                  type="date"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.licenseExpiry ?? ""}
                  onChange={(e) => update("licenseExpiry", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">License class</label>
                <input
                  type="text"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.licenseClass ?? ""}
                  onChange={(e) => update("licenseClass", e.target.value)}
                />
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Employment</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Hire date</label>
                <input
                  type="date"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.hireDate ?? ""}
                  onChange={(e) => update("hireDate", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <select
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.employmentStatus ?? "active"}
                  onChange={(e) => update("employmentStatus", e.target.value as "active" | "suspended" | "terminated")}
                >
                  {EMPLOYMENT_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Commission</h2>
            <CommissionInput
              commissionType={form.commissionType ?? "percentage"}
              commissionRate={form.commissionRate ?? 20}
              fixedCommissionAmount={form.fixedCommissionAmount ?? 0}
              minimumCommission={form.minimumCommission ?? 0}
              onChange={(values) => {
                if (values.commissionType != null) update("commissionType", values.commissionType);
                if (values.commissionRate != null) update("commissionRate", values.commissionRate);
                if (values.fixedCommissionAmount != null)
                  update("fixedCommissionAmount", values.fixedCommissionAmount);
                if (values.minimumCommission != null) update("minimumCommission", values.minimumCommission);
              }}
              errors={commissionErrors}
            />
          </section>

          <section>
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Platform IDs</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Uber driver ID</label>
                <input
                  type="text"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.uberDriverId ?? ""}
                  onChange={(e) => update("uberDriverId", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Bolt driver ID</label>
                <input
                  type="text"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.boltDriverId ?? ""}
                  onChange={(e) => update("boltDriverId", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Glovo courier ID</label>
                <input
                  type="text"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.glovoCourierId ?? ""}
                  onChange={(e) => update("glovoCourierId", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Bolt courier ID</label>
                <input
                  type="text"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.boltCourierId ?? ""}
                  onChange={(e) => update("boltCourierId", e.target.value)}
                />
              </div>
            </div>
          </section>

          <section>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
            <textarea
              rows={3}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              value={form.notes ?? ""}
              onChange={(e) => update("notes", e.target.value)}
            />
          </section>

          {formError && <p className="text-sm text-red-600">{formError}</p>}
          {mutation.isError && !formError && (
            <p className="text-sm text-red-600">
              {(mutation.error as Error).message || "Failed to update driver."}
            </p>
          )}

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="submit"
              disabled={mutation.isPending}
              className="inline-flex items-center justify-center rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-60"
            >
              {mutation.isPending ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Saving...
                </>
              ) : (
                "Save changes"
              )}
            </button>
            <Link
              to="/drivers"
              className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Link>
          </div>
        </form>

        {id && (
          <section className="mt-8 bg-white shadow-sm rounded-xl p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Documents</h2>
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-medium text-slate-700 mb-2">Upload document</h3>
                <DocumentUpload driverId={id} />
              </div>
              <div>
                <h3 className="text-sm font-medium text-slate-700 mb-2">Uploaded documents</h3>
                <DocumentList driverId={id} />
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
