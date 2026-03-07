import type { FormEvent } from "react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { createVehicle, type CreateVehiclePayload } from "../../api/vehicles";

const VEHICLE_STATUSES = [
  { value: "available", label: "Available" },
  { value: "maintenance", label: "Maintenance" },
  { value: "sold", label: "Sold" },
  { value: "scrapped", label: "Scrapped" },
] as const;

export function AddVehiclePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [success, setSuccess] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [form, setForm] = useState<CreateVehiclePayload & { status: string }>({
    vehicleType: "car",
    make: "",
    model: "",
    year: undefined,
    color: "",
    licensePlate: "",
    vin: "",
    fuelType: "",
    transmission: "",
    seatingCapacity: undefined,
    dailyRent: 0,
    weeklyRent: 0,
    monthlyRent: 0,
    insuranceExpiry: "",
    registrationExpiry: "",
    status: "available",
    notes: "",
  });

  const mutation = useMutation({
    mutationFn: (payload: CreateVehiclePayload) => createVehicle(payload),
    onSuccess: () => {
      setSuccess(true);
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      setTimeout(() => navigate("/vehicles"), 1500);
    },
  });

  const validate = (): string | null => {
    if (!form.vehicleType?.trim()) return "Vehicle type is required.";
    if (!form.make?.trim()) return "Make is required.";
    if (!form.model?.trim()) return "Model is required.";
    if (!form.licensePlate?.trim()) return "License plate is required.";
    const daily = Number(form.dailyRent);
    const weekly = Number(form.weeklyRent);
    const monthly = Number(form.monthlyRent);
    if (!Number.isNaN(daily) && daily < 0) return "Daily rent cannot be negative.";
    if (!Number.isNaN(weekly) && weekly < 0) return "Weekly rent cannot be negative.";
    if (!Number.isNaN(monthly) && monthly < 0) return "Monthly rent cannot be negative.";
    return null;
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    const payload: CreateVehiclePayload = {
      vehicleType: form.vehicleType.trim(),
      make: form.make.trim(),
      model: form.model.trim(),
      year: form.year,
      color: form.color?.trim() || undefined,
      licensePlate: form.licensePlate.trim(),
      vin: form.vin?.trim() || undefined,
      fuelType: form.fuelType?.trim() || undefined,
      transmission: form.transmission?.trim() || undefined,
      seatingCapacity: form.seatingCapacity,
      dailyRent: form.dailyRent ?? 0,
      weeklyRent: form.weeklyRent ?? 0,
      monthlyRent: form.monthlyRent ?? 0,
      insuranceExpiry: form.insuranceExpiry?.trim() || undefined,
      registrationExpiry: form.registrationExpiry?.trim() || undefined,
      status: form.status as CreateVehiclePayload["status"],
      notes: form.notes?.trim() || undefined,
    };
    mutation.mutate(payload);
  };

  const update = (key: keyof typeof form, value: string | number | undefined) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  if (success) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-lg p-8 text-center max-w-md">
          <p className="text-green-600 font-medium">Vehicle created successfully.</p>
          <p className="text-sm text-slate-500 mt-1">Redirecting to vehicles list...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-100">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Add Vehicle</h1>
        <Link to="/vehicles" className="text-sm text-slate-600 hover:text-slate-900">
          ← Back to vehicles
        </Link>
      </header>

      <main className="p-6 max-w-4xl mx-auto">
        <form
          onSubmit={onSubmit}
          className="bg-white shadow-sm rounded-xl p-6 space-y-6"
        >
          {formError && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">
              {formError}
            </p>
          )}

          <section>
            <h2 className="text-sm font-semibold text-slate-800 mb-3">
              Basic info
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Vehicle type *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. car, van, motorcycle"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.vehicleType}
                  onChange={(e) => update("vehicleType", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Make *
                </label>
                <input
                  type="text"
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.make}
                  onChange={(e) => update("make", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Model *
                </label>
                <input
                  type="text"
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.model}
                  onChange={(e) => update("model", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Year
                </label>
                <input
                  type="number"
                  min={1900}
                  max={2100}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.year ?? ""}
                  onChange={(e) =>
                    update("year", e.target.value ? parseInt(e.target.value, 10) : undefined)
                  }
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Color
                </label>
                <input
                  type="text"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.color ?? ""}
                  onChange={(e) => update("color", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  License plate *
                </label>
                <input
                  type="text"
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                  value={form.licensePlate}
                  onChange={(e) => update("licensePlate", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  VIN
                </label>
                <input
                  type="text"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.vin ?? ""}
                  onChange={(e) => update("vin", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Fuel type
                </label>
                <input
                  type="text"
                  placeholder="e.g. petrol, diesel"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.fuelType ?? ""}
                  onChange={(e) => update("fuelType", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Transmission
                </label>
                <input
                  type="text"
                  placeholder="e.g. manual, automatic"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.transmission ?? ""}
                  onChange={(e) => update("transmission", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Seating capacity
                </label>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.seatingCapacity ?? ""}
                  onChange={(e) =>
                    update(
                      "seatingCapacity",
                      e.target.value ? parseInt(e.target.value, 10) : undefined,
                    )
                  }
                />
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-slate-800 mb-3">
              Rental rates (RON)
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Daily rent
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.dailyRent ?? 0}
                  onChange={(e) => update("dailyRent", parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Weekly rent
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.weeklyRent ?? 0}
                  onChange={(e) => update("weeklyRent", parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Monthly rent
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.monthlyRent ?? 0}
                  onChange={(e) => update("monthlyRent", parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-slate-800 mb-3">
              Dates & status
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Insurance expiry
                </label>
                <input
                  type="date"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.insuranceExpiry ?? ""}
                  onChange={(e) => update("insuranceExpiry", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Registration expiry
                </label>
                <input
                  type="date"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.registrationExpiry ?? ""}
                  onChange={(e) => update("registrationExpiry", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Status
                </label>
                <select
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.status}
                  onChange={(e) => update("status", e.target.value)}
                >
                  {VEHICLE_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Notes
            </label>
            <textarea
              rows={3}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              value={form.notes ?? ""}
              onChange={(e) => update("notes", e.target.value)}
            />
          </section>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
            >
              {mutation.isPending ? "Creating..." : "Create vehicle"}
            </button>
            <Link
              to="/vehicles"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
