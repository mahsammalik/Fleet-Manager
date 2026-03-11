import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  getVehicleById,
  getVehicleRentals,
  getVehicleMaintenance,
  createVehicleRental,
  createVehicleMaintenance,
  updateVehicleRental,
  type Vehicle,
  type VehicleRental,
  type VehicleMaintenance,
  type CreateRentalPayload,
  type CreateMaintenancePayload,
} from "../../api/vehicles";
import { VehicleDocumentUpload } from "../../components/vehicles/VehicleDocumentUpload";
import { VehicleDocumentList } from "../../components/vehicles/VehicleDocumentList";
import { getDrivers } from "../../api/drivers";
import { useAuthStore } from "../../store/authStore";
import { formatCurrency } from "../../utils/currency";

type TabId = "profile" | "rentals" | "maintenance" | "documents";

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

const STATUS_COLORS: Record<string, string> = {
  available: "bg-green-100 text-green-800",
  rented: "bg-blue-100 text-blue-800",
  maintenance: "bg-amber-100 text-amber-800",
  sold: "bg-slate-100 text-slate-800",
  scrapped: "bg-red-100 text-red-800",
};

const RENTAL_STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  completed: "bg-slate-100 text-slate-800",
  cancelled: "bg-red-100 text-red-800",
  overdue: "bg-amber-100 text-amber-800",
};

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  paid: "bg-green-100 text-green-800",
  partial: "bg-blue-100 text-blue-800",
  overdue: "bg-red-100 text-red-800",
};

const DEPOSIT_STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  paid: "bg-green-100 text-green-800",
  refunded: "bg-slate-100 text-slate-800",
  partial: "bg-blue-100 text-blue-800",
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
  const [addRentalOpen, setAddRentalOpen] = useState(false);
  const [addMaintenanceOpen, setAddMaintenanceOpen] = useState(false);
  const [completeRentalId, setCompleteRentalId] = useState<string | null>(null);
  const [depositAction, setDepositAction] = useState<{
    type: "pay" | "refund" | "deduct";
    rental: VehicleRental;
  } | null>(null);

  const { data: vehicleRes, isLoading: loadingVehicle, isError: vehicleError } = useQuery({
    queryKey: ["vehicle", id],
    queryFn: () => getVehicleById(id!),
    enabled: !!id,
  });

  const { data: rentalsRes } = useQuery({
    queryKey: ["vehicleRentals", id],
    queryFn: () => getVehicleRentals(id!),
    enabled: !!id && tab === "rentals",
  });

  const { data: maintenanceRes } = useQuery({
    queryKey: ["vehicleMaintenance", id],
    queryFn: () => getVehicleMaintenance(id!),
    enabled: !!id && tab === "maintenance",
  });

  const { data: driversList } = useQuery({
    queryKey: ["drivers"],
    queryFn: async () => {
      const { data } = await getDrivers();
      return data;
    },
    enabled: !!id && (tab === "rentals" || addRentalOpen),
  });

  const vehicle = vehicleRes?.data;
  const rentals = rentalsRes?.data ?? [];
  const maintenanceList = maintenanceRes?.data ?? [];
  const canEdit = user?.role === "admin" || user?.role === "accountant";

  const createRentalMutation = useMutation({
    mutationFn: (payload: CreateRentalPayload) => createVehicleRental(id!, payload),
    onSuccess: (response) => {
      const rental = response.data;
      queryClient.invalidateQueries({ queryKey: ["vehicleRentals", id] });
      queryClient.invalidateQueries({ queryKey: ["vehicle", id] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      if (rental?.driver_id) {
        queryClient.invalidateQueries({ queryKey: ["driver", rental.driver_id] });
        queryClient.invalidateQueries({ queryKey: ["driverActiveRental", rental.driver_id] });
      }
      setAddRentalOpen(false);
    },
  });

  const completeRentalMutation = useMutation({
    mutationFn: (rentalId: string) =>
      updateVehicleRental(id!, rentalId, { status: "completed" }),
    onSuccess: (response) => {
      const rental = response.data;
      queryClient.invalidateQueries({ queryKey: ["vehicleRentals", id] });
      queryClient.invalidateQueries({ queryKey: ["vehicle", id] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      if (rental?.driver_id) {
        queryClient.invalidateQueries({ queryKey: ["driver", rental.driver_id] });
        queryClient.invalidateQueries({ queryKey: ["driverActiveRental", rental.driver_id] });
      }
      setCompleteRentalId(null);
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
          {(["profile", "rentals", "maintenance", "documents"] as TabId[]).map((t) => (
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
                <div><dt className="text-slate-500">Current driver</dt><dd>{v.current_driver_id ? (
                  <Link to={`/drivers/${v.current_driver_id}`} className="text-sky-600 hover:underline">
                    {v.driver_first_name || v.driver_last_name ? `${v.driver_first_name ?? ""} ${v.driver_last_name ?? ""}`.trim() : "View driver"}
                  </Link>
                ) : (v.driver_first_name || v.driver_last_name ? `${v.driver_first_name ?? ""} ${v.driver_last_name ?? ""}`.trim() : "—")}</dd></div>
              </dl>
            </section>

            <section className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-sm font-semibold text-slate-800 mb-3">Rental rates (RON)</h2>
              <dl className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div><dt className="text-slate-500">Daily</dt><dd className="font-medium">{formatCurrency(Number(v.daily_rent))}</dd></div>
                <div><dt className="text-slate-500">Weekly</dt><dd className="font-medium">{formatCurrency(Number(v.weekly_rent))}</dd></div>
                <div><dt className="text-slate-500">Monthly</dt><dd className="font-medium">{formatCurrency(Number(v.monthly_rent))}</dd></div>
              </dl>
            </section>

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

        {tab === "rentals" && (
          <div className="space-y-6">
            {canEdit && (
              <div className="bg-white rounded-xl shadow-sm p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-800">Rentals</h2>
                  <button
                    type="button"
                    onClick={() => setAddRentalOpen(true)}
                    disabled={v.status === "rented"}
                    className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                  >
                    Add rental
                  </button>
                </div>
                {v.status === "rented" && (
                  <p className="text-xs text-slate-500 mt-1">Complete the active rental before starting a new one.</p>
                )}
              </div>
            )}

            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-slate-700">Driver</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-700">Period</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-700">Type</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-700">Amount</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-700">Deposit</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-700">Deposit status</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-700">Payment</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-700">Status</th>
                    {canEdit && <th className="px-3 py-2 text-left font-medium text-slate-700">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {rentals.map((r: VehicleRental) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <Link to={`/drivers/${r.driver_id}`} className="text-sky-600 hover:underline">
                          {r.driver_first_name} {r.driver_last_name}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        {formatDate(r.rental_start_date)} – {formatDate(r.rental_end_date)}
                      </td>
                      <td className="px-3 py-2 capitalize">{r.rental_type}</td>
                      <td className="px-3 py-2">{r.total_rent_amount != null ? formatCurrency(Number(r.total_rent_amount)) : "—"}</td>
                      <td className="px-3 py-2">
                        {r.deposit_amount ? formatCurrency(Number(r.deposit_amount)) : "—"}
                        {r.deposit_status === "partial" && r.deposit_deduction_amount && (
                          <div className="text-xs text-slate-500">
                            Deducted: {formatCurrency(Number(r.deposit_deduction_amount))}{" "}
                            {r.deposit_deduction_reason ? `(${r.deposit_deduction_reason})` : ""}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.deposit_amount && Number(r.deposit_amount) > 0 ? (
                          <span
                            className={`inline-flex rounded px-2 py-0.5 text-xs font-medium capitalize ${
                              r.deposit_status ? DEPOSIT_STATUS_COLORS[r.deposit_status] ?? "" : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {r.deposit_status ?? "—"}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${PAYMENT_STATUS_COLORS[r.payment_status] ?? ""}`}>
                          {r.payment_status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium capitalize ${RENTAL_STATUS_COLORS[r.status] ?? ""}`}>
                          {r.status}
                        </span>
                      </td>
                      {canEdit && (
                        <td className="px-3 py-2">
                          {r.deposit_amount && Number(r.deposit_amount) > 0 && (
                            <div className="flex flex-wrap gap-2 mb-1">
                              {r.deposit_status === "pending" && (
                                <button
                                  type="button"
                                  onClick={() => setDepositAction({ type: "pay", rental: r })}
                                  className="text-xs text-sky-600 hover:underline"
                                >
                                  Mark deposit paid
                                </button>
                              )}
                              {r.deposit_status === "paid" && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setDepositAction({ type: "refund", rental: r })}
                                    className="text-xs text-sky-600 hover:underline"
                                  >
                                    Refund deposit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setDepositAction({ type: "deduct", rental: r })}
                                    className="text-xs text-amber-600 hover:underline"
                                  >
                                    Deduct from deposit
                                  </button>
                                </>
                              )}
                              {r.deposit_status === "partial" && (
                                <button
                                  type="button"
                                  onClick={() => setDepositAction({ type: "refund", rental: r })}
                                  className="text-xs text-sky-600 hover:underline"
                                >
                                  Refund remaining
                                </button>
                              )}
                            </div>
                          )}
                          {r.status === "active" && (
                            <button
                              type="button"
                              onClick={() => setCompleteRentalId(r.id)}
                              className="text-sky-600 hover:underline text-sm"
                            >
                              Complete
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {rentals.length === 0 && (
                    <tr>
                      <td colSpan={canEdit ? 9 : 8} className="px-3 py-4 text-center text-slate-500">
                        No rentals yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
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

      {/* Add rental modal */}
      {addRentalOpen && (
        <AddRentalModal
          drivers={driversList ?? []}
          dailyRent={Number(v.daily_rent)}
          weeklyRent={Number(v.weekly_rent)}
          monthlyRent={Number(v.monthly_rent)}
          onClose={() => setAddRentalOpen(false)}
          onSubmit={(payload) => createRentalMutation.mutate(payload)}
          isSubmitting={createRentalMutation.isPending}
        />
      )}

      {/* Complete rental confirm */}
      {completeRentalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-slate-900">Complete rental?</h3>
            <p className="text-sm text-slate-600 mt-2">
              The vehicle will be marked as available and the rental will be closed.
            </p>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => completeRentalMutation.mutate(completeRentalId)}
                disabled={completeRentalMutation.isPending}
                className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
              >
                {completeRentalMutation.isPending ? "Completing..." : "Complete"}
              </button>
              <button
                type="button"
                onClick={() => setCompleteRentalId(null)}
                disabled={completeRentalMutation.isPending}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add maintenance modal */}
      {addMaintenanceOpen && (
        <AddMaintenanceModal
          onClose={() => setAddMaintenanceOpen(false)}
          onSubmit={(payload) => createMaintenanceMutation.mutate(payload)}
          isSubmitting={createMaintenanceMutation.isPending}
        />
      )}

      {/* Deposit actions modal */}
      {depositAction && (
        <DepositModal
          action={depositAction.type}
          rental={depositAction.rental}
          onClose={() => setDepositAction(null)}
          vehicleId={id}
        />
      )}
    </div>
  );
}

function AddRentalModal({
  drivers,
  dailyRent,
  weeklyRent,
  monthlyRent,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  drivers: { id: string; first_name: string; last_name: string }[];
  dailyRent: number;
  weeklyRent: number;
  monthlyRent: number;
  onClose: () => void;
  onSubmit: (p: CreateRentalPayload) => void;
  isSubmitting: boolean;
}) {
  const [driverId, setDriverId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [rentalType, setRentalType] = useState<"daily" | "weekly" | "monthly">("daily");
  const [depositAmount, setDepositAmount] = useState(0);
  const [notes, setNotes] = useState("");

  const totalAmount =
    rentalType === "daily"
      ? dailyRent
      : rentalType === "weekly"
        ? weeklyRent
        : monthlyRent;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!driverId || !startDate || !endDate) return;
    onSubmit({
      driverId,
      rentalStartDate: startDate,
      rentalEndDate: endDate,
      rentalType,
      totalRentAmount: totalAmount,
      depositAmount: depositAmount || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold text-slate-900">Add rental</h3>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Driver *</label>
            <select
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
            >
              <option value="">Select driver</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.first_name} {d.last_name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Start date *</label>
              <input
                type="date"
                required
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">End date *</label>
              <input
                type="date"
                required
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Rental type</label>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={rentalType}
              onChange={(e) => setRentalType(e.target.value as "daily" | "weekly" | "monthly")}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            <p className="text-xs text-slate-500 mt-1">
              Amount: {formatCurrency(totalAmount)} (RON)
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Deposit (RON)</label>
            <input
              type="number"
              min={0}
              step={0.01}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={depositAmount || ""}
              onChange={(e) => setDepositAmount(parseFloat(e.target.value) || 0)}
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
              {isSubmitting ? "Creating..." : "Create rental"}
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

function DepositModal({
  action,
  rental,
  vehicleId,
  onClose,
}: {
  action: "pay" | "refund" | "deduct";
  rental: VehicleRental;
  vehicleId: string | undefined;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [deductionAmount, setDeductionAmount] = useState<number | "">("");
  const [deductionReason, setDeductionReason] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      if (!vehicleId) return;
      if (action === "pay") {
        return updateVehicleRental(vehicleId, rental.id, {
          depositStatus: "paid",
          paymentMethod: paymentMethod || undefined,
          paymentReference: paymentReference || undefined,
        });
      }
      if (action === "refund") {
        return updateVehicleRental(vehicleId, rental.id, {
          depositStatus: "refunded",
          paymentMethod: paymentMethod || undefined,
          paymentReference: paymentReference || undefined,
        });
      }
      // deduct
      const amount =
        deductionAmount === "" ? 0 : Number(deductionAmount);
      return updateVehicleRental(vehicleId, rental.id, {
        depositStatus: "partial",
        depositDeductionAmount: amount,
        depositDeductionReason: deductionReason || undefined,
        paymentMethod: paymentMethod || undefined,
      });
    },
    onSuccess: (response) => {
      const updated = response?.data;
      queryClient.invalidateQueries({ queryKey: ["vehicleRentals", vehicleId] });
      queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      if (updated?.driver_id) {
        queryClient.invalidateQueries({ queryKey: ["driver", updated.driver_id] });
        queryClient.invalidateQueries({ queryKey: ["driverActiveRental", updated.driver_id] });
      }
      onClose();
    },
  });

  const title =
    action === "pay"
      ? "Mark deposit as paid"
      : action === "refund"
        ? "Refund deposit"
        : "Deduct from deposit";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-lg p-6 max-w-sm w-full">
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-600 mt-1">
          Deposit amount:{" "}
          {rental.deposit_amount ? formatCurrency(Number(rental.deposit_amount)) : "—"}
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          {action === "deduct" && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Deduction amount (RON)
                </label>
                <input
                  type="number"
                  min={0}
                  max={rental.deposit_amount ? Number(rental.deposit_amount) : undefined}
                  step={0.01}
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={deductionAmount === "" ? "" : deductionAmount}
                  onChange={(e) =>
                    setDeductionAmount(e.target.value ? parseFloat(e.target.value) : "")
                  }
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Deduction reason
                </label>
                <textarea
                  rows={2}
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={deductionReason}
                  onChange={(e) => setDeductionReason(e.target.value)}
                />
              </div>
            </>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Payment method
            </label>
            <input
              type="text"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              placeholder="e.g. cash, bank transfer"
            />
          </div>
          {action !== "deduct" && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Reference / notes
              </label>
              <input
                type="text"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
              />
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
            >
              {mutation.isPending ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={mutation.isPending}
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
