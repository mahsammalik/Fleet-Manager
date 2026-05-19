import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  getVehicleById,
  getVehicleMaintenance,
  createVehicleMaintenance,
  type Vehicle,
  type VehicleMaintenance,
  type CreateMaintenancePayload,
} from "../../api/vehicles";
import {
  assignDriverToVehicle,
  unassignDriverFromVehicle,
} from "../../api/vehicleAssignments";
import { getDrivers, type DriverListItem } from "../../api/drivers";
import { VehicleDocumentUpload } from "../../components/vehicles/VehicleDocumentUpload";
import { VehicleDocumentList } from "../../components/vehicles/VehicleDocumentList";
import { VehicleAssignmentHistoryPanel } from "../../components/vehicles/VehicleAssignmentHistoryPanel";
import { useAuthStore } from "../../store/authStore";
import { formatCurrency } from "../../utils/currency";

type TabId = "profile" | "maintenance" | "documents";

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = value.split("T")[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "—";
  }
}

function driverDisplayName(
  firstName?: string | null,
  lastName?: string | null,
): string {
  const name = `${firstName ?? ""} ${lastName ?? ""}`.trim();
  return name || "View driver";
}

const STATUS_COLORS: Record<string, string> = {
  available: "bg-green-100 text-green-800",
  rented: "bg-blue-100 text-blue-800",
  maintenance: "bg-amber-100 text-amber-800",
  sold: "bg-slate-100 text-slate-800",
  scrapped: "bg-red-100 text-red-800",
};

const MAINTENANCE_STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  in_progress: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-slate-100 text-slate-800",
};

export function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<TabId>("profile");
  const [addMaintenanceOpen, setAddMaintenanceOpen] = useState(false);
  const [assignDriverOpen, setAssignDriverOpen] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState("");

  const { data: vehicleRes, isLoading: loadingVehicle, isError: vehicleError } = useQuery({
    queryKey: ["vehicle", id],
    queryFn: () => getVehicleById(id!),
    enabled: !!id,
  });

  const { data: maintenanceRes } = useQuery({
    queryKey: ["vehicleMaintenance", id],
    queryFn: () => getVehicleMaintenance(id!),
    enabled: !!id && tab === "maintenance",
  });

  const { data: driversRes } = useQuery({
    queryKey: ["drivers", "for-assign"],
    queryFn: () => getDrivers({ limit: 500, status: "active" }),
    enabled: assignDriverOpen && !!id,
  });

  const vehicle = vehicleRes?.data;
  const maintenanceList = maintenanceRes?.data ?? [];
  const driversForAssign = driversRes?.data ?? [];
  const canEdit = user?.role === "admin" || user?.role === "accountant";

  const assignDriverMutation = useMutation({
    mutationFn: (driverId: string) => assignDriverToVehicle(id!, driverId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehicle", id] });
      void queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      void queryClient.invalidateQueries({ queryKey: ["vehicle-assignment-history"] });
      void queryClient.invalidateQueries({ queryKey: ["drivers"] });
      setAssignDriverOpen(false);
      setSelectedDriverId("");
    },
  });

  const unassignDriverMutation = useMutation({
    mutationFn: () => unassignDriverFromVehicle(id!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehicle", id] });
      void queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      void queryClient.invalidateQueries({ queryKey: ["vehicle-assignment-history"] });
      void queryClient.invalidateQueries({ queryKey: ["drivers"] });
    },
  });

  const createMaintenanceMutation = useMutation({
    mutationFn: (payload: CreateMaintenancePayload) =>
      createVehicleMaintenance(id!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicleMaintenance", id] });
      queryClient.invalidateQueries({ queryKey: ["vehicle", id] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      setAddMaintenanceOpen(false);
    },
  });

  if (!id) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <p className="text-slate-600">Missing vehicle ID.</p>
        <Link to="/vehicles" className="ml-2 text-sky-600 hover:underline">
          Back to vehicles
        </Link>
      </div>
    );
  }

  if (loadingVehicle || !vehicle) {
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

  const v = vehicle as Vehicle;

  return (
    <div className="min-h-full bg-slate-100">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link to="/vehicles" className="text-sm text-slate-600 hover:text-slate-900">
              ← Back to vehicles
            </Link>
            <h1 className="text-xl font-semibold text-slate-900 mt-1">
              {v.year ? `${v.year} ` : ""}
              {v.make} {v.model}
            </h1>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              {v.license_plate} · {v.vehicle_type}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex rounded px-2 py-1 text-xs font-medium capitalize ${
                STATUS_COLORS[v.status] ?? "bg-slate-100 text-slate-800"
              }`}
            >
              {v.status}
            </span>
            {canEdit && (
              <Link
                to={`/vehicles/${id}/edit`}
                className="inline-flex items-center rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"
              >
                Edit vehicle
              </Link>
            )}
          </div>
        </div>

        <nav className="flex gap-1 mt-4 border-b border-slate-200">
          {(["profile", "maintenance", "documents"] as TabId[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium rounded-t-md capitalize ${
                tab === t
                  ? "bg-slate-100 text-slate-900 border border-b-0 border-slate-200 -mb-px"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </header>

      <main className="p-6 max-w-4xl mx-auto">
        {tab === "profile" && (
          <div className="space-y-6">
            <section className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-sm font-semibold text-slate-800 mb-3">Vehicle details</h2>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div><dt className="text-slate-500">Make / Model</dt><dd className="font-medium">{v.make} {v.model}</dd></div>
                <div><dt className="text-slate-500">Year</dt><dd>{v.year ?? "—"}</dd></div>
                <div><dt className="text-slate-500">Color</dt><dd>{v.color ?? "—"}</dd></div>
                <div><dt className="text-slate-500">License plate</dt><dd className="font-mono">{v.license_plate}</dd></div>
                <div><dt className="text-slate-500">VIN</dt><dd>{v.vin ?? "—"}</dd></div>
                <div><dt className="text-slate-500">Fuel / Transmission</dt><dd>{[v.fuel_type, v.transmission].filter(Boolean).join(" · ") || "—"}</dd></div>
                <div><dt className="text-slate-500">Seating capacity</dt><dd>{v.seating_capacity ?? "—"}</dd></div>
                <div>
                  <dt className="text-slate-500">Current driver</dt>
                  <dd>
                    {v.current_driver_id ? (
                      <Link
                        to={`/drivers/${v.current_driver_id}`}
                        className="text-sky-600 hover:underline"
                      >
                        {driverDisplayName(v.driver_first_name, v.driver_last_name)}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
              </dl>
            </section>

            {canEdit && (
              <section className="bg-white rounded-xl shadow-sm p-6">
                <h2 className="text-sm font-semibold text-slate-800 mb-3">Driver assignment</h2>
                {v.current_driver_id ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <Link
                      to={`/drivers/${v.current_driver_id}`}
                      className="text-sm text-sky-600 hover:underline font-medium"
                    >
                      {driverDisplayName(v.driver_first_name, v.driver_last_name)}
                    </Link>
                    <button
                      type="button"
                      onClick={() => unassignDriverMutation.mutate()}
                      disabled={unassignDriverMutation.isPending}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {unassignDriverMutation.isPending ? "Unassigning…" : "Unassign driver"}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAssignDriverOpen(true)}
                    className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"
                  >
                    Assign driver
                  </button>
                )}
              </section>
            )}

            <section className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-sm font-semibold text-slate-800 mb-3">Rental rates (RON)</h2>
              <dl className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div><dt className="text-slate-500">Daily</dt><dd className="font-medium">{formatCurrency(Number(v.daily_rent))}</dd></div>
                <div>
                  <dt className="text-slate-500" title="Deducted each payout week while assigned to a driver.">
                    Weekly (payroll)
                  </dt>
                  <dd className="font-medium">{formatCurrency(Number(v.weekly_rent))}</dd>
                </div>
                <div><dt className="text-slate-500">Monthly</dt><dd className="font-medium">{formatCurrency(Number(v.monthly_rent))}</dd></div>
              </dl>
            </section>

            {(user?.role === "admin" || user?.role === "accountant") && id && (
              <VehicleAssignmentHistoryPanel mode="vehicle" entityId={id} title="Driver history" />
            )}

            <section className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-sm font-semibold text-slate-800 mb-3">Expiry dates</h2>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div><dt className="text-slate-500">Insurance expiry</dt><dd>{formatDate(v.insurance_expiry)}</dd></div>
                <div><dt className="text-slate-500">Registration expiry</dt><dd>{formatDate(v.registration_expiry)}</dd></div>
              </dl>
            </section>

            {v.notes && (
              <section className="bg-white rounded-xl shadow-sm p-6">
                <h2 className="text-sm font-semibold text-slate-800 mb-3">Notes</h2>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{v.notes}</p>
              </section>
            )}
          </div>
        )}

        {tab === "maintenance" && (
          <div className="space-y-6">
            {canEdit && (
              <div className="bg-white rounded-xl shadow-sm p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-800">Maintenance</h2>
                  <button
                    type="button"
                    onClick={() => setAddMaintenanceOpen(true)}
                    className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"
                  >
                    Add maintenance
                  </button>
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-slate-700">Type</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-700">Description</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-700">Scheduled</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-700">Cost</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-700">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {maintenanceList.map((m: VehicleMaintenance) => (
                    <tr key={m.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{m.maintenance_type}</td>
                      <td className="px-3 py-2">{m.description ?? "—"}</td>
                      <td className="px-3 py-2">{formatDate(m.scheduled_date)}</td>
                      <td className="px-3 py-2">{m.cost != null ? formatCurrency(Number(m.cost)) : "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium capitalize ${MAINTENANCE_STATUS_COLORS[m.status] ?? ""}`}>
                          {m.status.replace("_", " ")}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {maintenanceList.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                        No maintenance records yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "documents" && (
          <div className="space-y-6">
            {canEdit && (
              <div className="bg-white rounded-xl shadow-sm p-6">
                <h2 className="text-sm font-semibold text-slate-800 mb-3">Upload new document</h2>
                <VehicleDocumentUpload vehicleId={id} />
              </div>
            )}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-sm font-semibold text-slate-800 mb-3">Documents</h2>
              <VehicleDocumentList vehicleId={id} />
            </div>
          </div>
        )}
      </main>

      {assignDriverOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold text-slate-900">Assign driver</h3>
            <p className="text-sm text-slate-600 mt-1">Select a driver for this vehicle.</p>
            <select
              className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={selectedDriverId}
              onChange={(e) => setSelectedDriverId(e.target.value)}
            >
              <option value="">Choose driver…</option>
              {driversForAssign.map((d: DriverListItem) => (
                <option key={d.id} value={d.id}>
                  {d.first_name} {d.last_name}
                  {d.current_vehicle_id && d.current_vehicle_id !== id ? " (reassign)" : ""}
                </option>
              ))}
            </select>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                disabled={!selectedDriverId || assignDriverMutation.isPending}
                onClick={() => assignDriverMutation.mutate(selectedDriverId)}
                className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
              >
                {assignDriverMutation.isPending ? "Assigning…" : "Assign"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAssignDriverOpen(false);
                  setSelectedDriverId("");
                }}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {addMaintenanceOpen && (
        <AddMaintenanceModal
          onClose={() => setAddMaintenanceOpen(false)}
          onSubmit={(payload) => createMaintenanceMutation.mutate(payload)}
          isSubmitting={createMaintenanceMutation.isPending}
        />
      )}
    </div>
  );
}

function AddMaintenanceModal({
  onClose,
  onSubmit,
  isSubmitting,
}: {
  onClose: () => void;
  onSubmit: (p: CreateMaintenancePayload) => void;
  isSubmitting: boolean;
}) {
  const [maintenanceType, setMaintenanceType] = useState("");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState<number | "">("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [status, setStatus] = useState<CreateMaintenancePayload["status"]>("pending");
  const [mechanicName, setMechanicName] = useState("");
  const [notes, setNotes] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!maintenanceType.trim()) return;
    onSubmit({
      maintenanceType: maintenanceType.trim(),
      description: description.trim() || undefined,
      cost: cost === "" ? undefined : Number(cost),
      scheduledDate: scheduledDate || undefined,
      status,
      mechanicName: mechanicName.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold text-slate-900">Add maintenance</h3>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Type *</label>
            <input
              type="text"
              required
              placeholder="e.g. Oil change, Tire rotation"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={maintenanceType}
              onChange={(e) => setMaintenanceType(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <textarea
              rows={2}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Scheduled date</label>
              <input
                type="date"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Cost (RON)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={cost === "" ? "" : cost}
                onChange={(e) => setCost(e.target.value ? parseFloat(e.target.value) : "")}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value as CreateMaintenancePayload["status"])}
            >
              <option value="pending">Pending</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Mechanic name</label>
            <input
              type="text"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={mechanicName}
              onChange={(e) => setMechanicName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
            <textarea
              rows={2}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
            >
              {isSubmitting ? "Creating..." : "Create maintenance"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
