import type { FormEvent } from "react";
import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  getVehicleById,
  updateVehicle,
  type CreateVehiclePayload,
  type UpdateVehiclePayload,
  type Vehicle,
} from "../../api/vehicles";
import { getDrivers } from "../../api/drivers";

const VEHICLE_STATUSES = [
  { value: "available", label: "Available" },
  { value: "rented", label: "Rented" },
  { value: "maintenance", label: "Maintenance" },
  { value: "sold", label: "Sold" },
  { value: "scrapped", label: "Scrapped" },
] as const;

function toDateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const d = value.split("T")[0];
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
}

type VehicleFormState = CreateVehiclePayload & { status: string; currentDriverId: string };

function vehicleToForm(v: Vehicle): VehicleFormState {
  return {
    vehicleType: v.vehicle_type ?? "car",
    make: v.make ?? "",
    model: v.model ?? "",
    year: v.year ?? undefined,
    color: v.color ?? "",
    licensePlate: v.license_plate ?? "",
    vin: v.vin ?? "",
    fuelType: v.fuel_type ?? "",
    transmission: v.transmission ?? "",
    seatingCapacity: v.seating_capacity ?? undefined,
    dailyRent: v.daily_rent != null ? Number(v.daily_rent) : 0,
    weeklyRent: v.weekly_rent != null ? Number(v.weekly_rent) : 0,
    monthlyRent: v.monthly_rent != null ? Number(v.monthly_rent) : 0,
    insuranceExpiry: toDateInputValue(v.insurance_expiry),
    registrationExpiry: toDateInputValue(v.registration_expiry),
    status: v.status ?? "available",
    notes: v.notes ?? "",
    currentDriverId: v.current_driver_id ?? "",
  };
}

export function EditVehiclePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [success, setSuccess] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<VehicleFormState | null>(null);

  const { data: vehicleRes, isLoading: loadingVehicle, isError: vehicleError } = useQuery({
    queryKey: ["vehicle", id],
    queryFn: () => getVehicleById(id!),
    enabled: !!id,
  });

  const { data: driversList } = useQuery({
    queryKey: ["drivers"],
    queryFn: async () => {
      const { data } = await getDrivers();
      return data;
    },
  });

  const vehicle = vehicleRes?.data;

  useEffect(() => {
    if (vehicle) setForm(vehicleToForm(vehicle));
  }, [vehicle]);

  const mutation = useMutation({
    mutationFn: (payload: UpdateVehiclePayload) => updateVehicle(id!, payload),
    onSuccess: () => {
      setSuccess(true);
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle", id] });
      setTimeout(() => navigate("/vehicles"), 1500);
    },
  });

  const validate = (): string | null => {
    if (!form) return null;
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
    if (!form) return;
    const err = validate();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    const payload: UpdateVehiclePayload = {
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
      status: form.status as Vehicle["status"],
      currentDriverId: form.currentDriverId || null,
      notes: form.notes?.trim() || undefined,
    };
    mutation.mutate(payload);
  };

  const update = (key: keyof VehicleFormState, value: string | number | undefined) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : null));
  };

  if (!id) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <p className="text-slate-600">Missing vehicle ID.</p>
        <Link to="/vehicles" className="ml-2 text-sky-600 hover:underline">Back to vehicles</Link>
      </div>
    );
  }

  if (loadingVehicle || !form) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="inline-block w-8 h-8 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-600">Loading vehicle...</p>
        </div>
      </div>
    );
  }

  if (vehicleError) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-lg p-6 text-center max-w-md">
          <p className="text-red-600">Failed to load vehicle.</p>
          <Link to="/vehicles" className="mt-3 inline-block text-sm text-sky-600 hover:underline">
            Back to vehicles
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-lg p-8 text-center max-w-md">
          <p className="text-green-600 font-medium">Vehicle updated successfully.</p>
          <p className="text-sm text-slate-500 mt-1">Redirecting to vehicles list...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-100">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Edit Vehicle</h1>
        <Link to={`/vehicles/${id}`} className="text-sm text-slate-600 hover:text-slate-900">
          ← Back to vehicle
        </Link>
      </header>

      <main className="p-6 max-w-4xl mx-auto">
        <form onSubmit={onSubmit} className="bg-white shadow-sm rounded-xl p-6 space-y-6">
          {formError && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{formError}</p>
          )}

          <section>
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Basic info</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Vehicle type *</label>
                <input
                  type="text"
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.vehicleType}
                  onChange={(e) => update("vehicleType", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Make *</label>
                <input
                  type="text"
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.make}
                  onChange={(e) => update("make", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Model *</label>
                <input
                  type="text"
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.model}
                  onChange={(e) => update("model", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Year</label>
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
                <label className="block text-sm font-medium text-slate-700 mb-1">Color</label>
                <input
                  type="text"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.color ?? ""}
                  onChange={(e) => update("color", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">License plate *</label>
                <input
                  type="text"
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                  value={form.licensePlate}
                  onChange={(e) => update("licensePlate", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">VIN</label>
                <input
                  type="text"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.vin ?? ""}
                  onChange={(e) => update("vin", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Current driver</label>
                <select
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.currentDriverId}
                  onChange={(e) => update("currentDriverId", e.target.value)}
                >
                  <option value="">— None —</option>
                  {driversList?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.first_name} {d.last_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Fuel type</label>
                <input
                  type="text"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.fuelType ?? ""}
                  onChange={(e) => update("fuelType", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Transmission</label>
                <input
                  type="text"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.transmission ?? ""}
                  onChange={(e) => update("transmission", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Seating capacity</label>
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
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Rental rates (RON)</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Daily rent</label>
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
                <label className="block text-sm font-medium text-slate-700 mb-1">Weekly rent</label>
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
                <label className="block text-sm font-medium text-slate-700 mb-1">Monthly rent</label>
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
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Dates & status</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Insurance expiry</label>
                <input
                  type="date"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.insuranceExpiry ?? ""}
                  onChange={(e) => update("insuranceExpiry", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Registration expiry</label>
                <input
                  type="date"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.registrationExpiry ?? ""}
                  onChange={(e) => update("registrationExpiry", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
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
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
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
              {mutation.isPending ? "Saving..." : "Save changes"}
            </button>
            <Link
              to={`/vehicles/${id}`}
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
