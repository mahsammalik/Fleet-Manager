import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  getDriverDetail,
  updateDriverNotes,
  deleteDriver,
  getDriverActivity,
  getDriverActiveRental,
  uploadDriverPhoto,
  type Driver,
  type DriverActivity,
} from "../../api/driverDetail";
import {
  PLATFORM_IDS,
  PLATFORM_ID_LABELS,
} from "../../constants/platformIds";
import { DriverAvatar } from "../../components/drivers/DriverAvatar";
import { updateVehicleRental } from "../../api/vehicles";
import { useAuthStore } from "../../store/authStore";
import { DocumentUpload } from "../../components/documents/DocumentUpload";
import { DocumentList } from "../../components/documents/DocumentList";

type TabId = "profile" | "documents" | "activity";

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
  active: "bg-green-100 text-green-800",
  suspended: "bg-amber-100 text-amber-800",
  terminated: "bg-red-100 text-red-800",
};

const ACTIVITY_LABELS: Record<string, string> = {
  profile_update: "Profile updated",
  profile_photo_update: "Profile photo updated",
  status_change: "Status changed",
  document_upload: "Document uploaded",
  document_verify: "Document verified",
  document_delete: "Document deleted",
  driver_delete: "Driver deleted",
  notes_update: "Notes updated",
};

export function DriverDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<TabId>("profile");
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [notesEdit, setNotesEdit] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [endRentalConfirm, setEndRentalConfirm] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const { data: driverRes, isLoading: loadingDriver, isError: driverError } = useQuery({
    queryKey: ["driver", id],
    queryFn: () => getDriverDetail(id!),
    enabled: !!id,
  });

  const { data: activityRes, isLoading: loadingActivity } = useQuery({
    queryKey: ["driverActivity", id],
    queryFn: () => getDriverActivity(id!),
    enabled: !!id && tab === "activity",
  });

  const { data: activeRentalRes } = useQuery({
    queryKey: ["driverActiveRental", id],
    queryFn: () => getDriverActiveRental(id!),
    enabled: !!id && tab === "profile",
  });

  const driver = driverRes?.data;
  const activities = activityRes?.data ?? [];
  const activeRental = activeRentalRes?.data ?? null;

  const notesMutation = useMutation({
    mutationFn: (notes: string | null) => updateDriverNotes(id!, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["driver", id] });
      queryClient.invalidateQueries({ queryKey: ["driverActivity", id] });
      setNotesEdit(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteDriver(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      setDeleteModalOpen(false);
      navigate("/drivers");
    },
  });

  const endRentalMutation = useMutation({
    mutationFn: async () => {
      const rental = activeRental;
      if (!rental) throw new Error("No active rental");
      return updateVehicleRental(rental.vehicle_id, rental.rental_id, { status: "completed" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["driver", id] });
      queryClient.invalidateQueries({ queryKey: ["driverActiveRental", id] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      setEndRentalConfirm(false);
    },
  });

  const photoMutation = useMutation({
    mutationFn: (file: File) => uploadDriverPhoto(id!, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["driver", id] });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      if (photoInputRef.current) photoInputRef.current.value = "";
    },
  });

  const canEdit = user?.role === "admin" || user?.role === "accountant";
  const canDelete = user?.role === "admin" || user?.role === "accountant";

  if (!id) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <p className="text-slate-600">Missing driver ID.</p>
        <Link to="/drivers" className="ml-2 text-sky-600 hover:underline">Back to drivers</Link>
      </div>
    );
  }

  if (loadingDriver || !driver) {
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
          <Link to="/drivers" className="mt-3 inline-block text-sm text-sky-600 hover:underline">Back to drivers</Link>
        </div>
      </div>
    );
  }

  const d = driver as Driver;

  return (
    <div className="min-h-full bg-slate-100">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="relative shrink-0">
              <DriverAvatar
                profilePhotoUrl={d.profile_photo_url}
                firstName={d.first_name}
                lastName={d.last_name}
                size="lg"
              />
              {canEdit && (
                <div className="mt-2">
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) photoMutation.mutate(file);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    disabled={photoMutation.isPending}
                    className="text-xs text-sky-600 hover:text-sky-800 font-medium disabled:opacity-60"
                  >
                    {photoMutation.isPending ? "Uploading..." : "Change photo"}
                  </button>
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <Link to="/drivers" className="text-sm text-slate-600 hover:text-slate-900">
                  ← Back to drivers
                </Link>
              </div>
              <h1 className="text-xl font-semibold text-slate-900 mt-1">
                {d.first_name} {d.last_name}
              </h1>
              <p className="text-xs text-slate-500 font-mono mt-0.5">ID: {id}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <Link
                to={`/drivers/${id}/edit`}
                className="inline-flex items-center rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"
              >
                Edit driver
              </Link>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => setDeleteModalOpen(true)}
                className="inline-flex items-center rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                Delete driver
              </button>
            )}
          </div>
        </div>

        <nav className="flex gap-1 mt-4 border-b border-slate-200">
          {(["profile", "documents", "activity"] as TabId[]).map((t) => (
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
              <h2 className="text-sm font-semibold text-slate-800 mb-3">Personal information</h2>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div><dt className="text-slate-500">First name</dt><dd className="font-medium">{d.first_name ?? "—"}</dd></div>
                <div><dt className="text-slate-500">Last name</dt><dd className="font-medium">{d.last_name ?? "—"}</dd></div>
                <div><dt className="text-slate-500">Email</dt><dd>{d.email ?? "—"}</dd></div>
                <div><dt className="text-slate-500">Phone</dt><dd>{d.phone ?? "—"}</dd></div>
                <div><dt className="text-slate-500">Date of birth</dt><dd>{formatDate(d.date_of_birth)}</dd></div>
                <div className="md:col-span-2"><dt className="text-slate-500">Address</dt><dd>{d.address ?? "—"}</dd></div>
              </dl>
            </section>

            <section className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-sm font-semibold text-slate-800 mb-3">License information</h2>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div><dt className="text-slate-500">License number</dt><dd>{d.license_number ?? "—"}</dd></div>
                <div><dt className="text-slate-500">License expiry</dt><dd>{formatDate(d.license_expiry)}</dd></div>
                <div><dt className="text-slate-500">License class</dt><dd>{d.license_class ?? "—"}</dd></div>
              </dl>
            </section>

            <section className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-sm font-semibold text-slate-800 mb-3">Employment</h2>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div><dt className="text-slate-500">Hire date</dt><dd>{formatDate(d.hire_date)}</dd></div>
                <div>
                  <dt className="text-slate-500">Status</dt>
                  <dd>
                    <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[d.employment_status] ?? "bg-slate-100 text-slate-800"}`}>
                      {d.employment_status}
                    </span>
                  </dd>
                </div>
                <div><dt className="text-slate-500">Commission rate</dt><dd>{d.commission_rate ?? "—"}%</dd></div>
              </dl>
            </section>

            <section className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-sm font-semibold text-slate-800 mb-3">Platform IDs</h2>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-slate-500">
                    {PLATFORM_ID_LABELS[PLATFORM_IDS.UBER]} driver ID
                  </dt>
                  <dd>{d.uber_driver_id ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">
                    {PLATFORM_ID_LABELS[PLATFORM_IDS.BOLT]} driver ID
                  </dt>
                  <dd>{d.bolt_driver_id ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">
                    {PLATFORM_ID_LABELS[PLATFORM_IDS.GLOVO]} courier ID
                  </dt>
                  <dd>{d.glovo_courier_id ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">
                    {PLATFORM_ID_LABELS[PLATFORM_IDS.BOLT_COURIER]} ID
                  </dt>
                  <dd>{d.bolt_courier_id ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">
                    {PLATFORM_ID_LABELS[PLATFORM_IDS.WOLT]} courier ID
                  </dt>
                  <dd>{d.wolt_courier_id ?? "—"}</dd>
                </div>
              </dl>
            </section>

            <section className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-sm font-semibold text-slate-800 mb-3">Current vehicle</h2>
              {d.current_vehicle_id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/vehicles/${d.current_vehicle_id}`}
                    className="font-medium text-sky-600 hover:text-sky-800"
                  >
                    {d.current_vehicle_year != null ? `${d.current_vehicle_year} ` : ""}
                    {d.current_vehicle_make ?? ""} {d.current_vehicle_model ?? ""}
                    {d.current_vehicle_license_plate ? ` (${d.current_vehicle_license_plate})` : ""}
                  </Link>
                  {canEdit && activeRental && (
                    <button
                      type="button"
                      onClick={() => setEndRentalConfirm(true)}
                      className="rounded-md border border-amber-300 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50"
                    >
                      End rental
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  No vehicle assigned. Assign a vehicle from the{" "}
                  <Link to="/vehicles" className="text-sky-600 hover:underline">vehicle detail page</Link>.
                </p>
              )}
            </section>

            <section className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-sm font-semibold text-slate-800 mb-3">Notes</h2>
              {!notesEdit ? (
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{d.notes || "No notes."}</p>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => {
                        setNotesValue(d.notes ?? "");
                        setNotesEdit(true);
                      }}
                      className="text-sm text-sky-600 hover:underline shrink-0"
                    >
                      Edit notes
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea
                    rows={3}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    value={notesValue}
                    onChange={(e) => setNotesValue(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => notesMutation.mutate(notesValue.trim() || null)}
                      disabled={notesMutation.isPending}
                      className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700 disabled:opacity-60"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => { setNotesEdit(false); setNotesValue(d.notes ?? ""); }}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>

            <section className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-sm font-semibold text-slate-800 mb-3">Metadata</h2>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-slate-600">
                <div><dt className="text-slate-500">Created</dt><dd>{formatDate(d.created_at)}</dd></div>
                <div><dt className="text-slate-500">Last updated</dt><dd>{formatDate(d.updated_at)}</dd></div>
              </dl>
            </section>
          </div>
        )}

        {tab === "documents" && (
          <div className="space-y-6">
            {canEdit && (
              <div className="bg-white rounded-xl shadow-sm p-6">
                <h2 className="text-sm font-semibold text-slate-800 mb-3">Upload new document</h2>
                <DocumentUpload driverId={id} />
              </div>
            )}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-sm font-semibold text-slate-800 mb-3">Documents</h2>
              <DocumentList driverId={id} />
            </div>
          </div>
        )}

        {tab === "activity" && (
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Activity history</h2>
            {loadingActivity ? (
              <p className="text-sm text-slate-500">Loading...</p>
            ) : activities.length === 0 ? (
              <p className="text-sm text-slate-500">No activity yet.</p>
            ) : (
              <ul className="space-y-3">
                {activities.map((a: DriverActivity) => (
                  <li key={a.id} className="flex flex-wrap items-baseline gap-2 border-b border-slate-100 pb-2 last:border-0">
                    <span className="text-sm font-medium text-slate-700">
                      {ACTIVITY_LABELS[a.activity_type] ?? a.activity_type}
                    </span>
                    {a.activity_description && (
                      <span className="text-sm text-slate-600">{a.activity_description}</span>
                    )}
                    <span className="text-xs text-slate-400 ml-auto">{formatDate(a.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </main>

      {deleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-slate-900">Delete driver?</h3>
            <p className="text-sm text-slate-600 mt-2">
              This will soft delete the driver. They will be removed from the active list and you will no longer be able to view or edit them here.
            </p>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </button>
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                disabled={deleteMutation.isPending}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {endRentalConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-slate-900">End rental?</h3>
            <p className="text-sm text-slate-600 mt-2">
              This will mark the current rental as completed and unassign the vehicle from this driver.
            </p>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => endRentalMutation.mutate()}
                disabled={endRentalMutation.isPending}
                className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
              >
                {endRentalMutation.isPending ? "Ending..." : "End rental"}
              </button>
              <button
                type="button"
                onClick={() => setEndRentalConfirm(false)}
                disabled={endRentalMutation.isPending}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
