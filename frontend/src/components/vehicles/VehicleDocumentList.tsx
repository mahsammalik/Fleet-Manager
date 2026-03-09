import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  getVehicleDocuments,
  deleteVehicleDocument,
  verifyVehicleDocument,
  downloadVehicleDocument,
  type VehicleDocument,
} from "../../api/vehicleDocuments";
import { VEHICLE_DOCUMENT_LABELS, type VehicleDocumentType } from "../../constants/vehicleDocumentTypes";

const DOC_TYPE_COLORS: Record<string, string> = {
  insurance: "bg-purple-100 text-purple-800",
  registration: "bg-blue-100 text-blue-800",
  maintenance: "bg-amber-100 text-amber-800",
  inspection: "bg-emerald-100 text-emerald-800",
  permit: "bg-slate-100 text-slate-800",
  other: "bg-gray-100 text-gray-800",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = value.split("T")[0];
  return d || "—";
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isExpired(expiryDate: string | null): boolean {
  if (!expiryDate) return false;
  return new Date(expiryDate) < new Date();
}

interface VehicleDocumentListProps {
  vehicleId: string;
}

export function VehicleDocumentList({ vehicleId }: VehicleDocumentListProps) {
  const queryClient = useQueryClient();
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const { data: docsResponse, isLoading, isError } = useQuery({
    queryKey: ["vehicleDocuments", vehicleId],
    queryFn: () => getVehicleDocuments(vehicleId),
  });

  const deleteMutation = useMutation({
    mutationFn: (docId: string) => deleteVehicleDocument(vehicleId, docId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicleDocuments", vehicleId] });
      setDeleteConfirm(null);
    },
  });

  const verifyMutation = useMutation({
    mutationFn: ({ docId, verified }: { docId: string; verified: boolean }) =>
      verifyVehicleDocument(vehicleId, docId, verified),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicleDocuments", vehicleId] });
    },
  });

  const handleDownload = async (doc: VehicleDocument) => {
    const blob = await downloadVehicleDocument(vehicleId, doc.id);
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = doc.file_name || "document";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  const docs = docsResponse?.data ?? [];

  return (
    <div className="space-y-3">
      {isLoading && <p className="text-sm text-slate-500">Loading documents...</p>}
      {isError && <p className="text-sm text-red-600">Failed to load documents.</p>}
      {!isLoading && !isError && docs.length === 0 && (
        <p className="text-sm text-slate-500">No vehicle documents yet.</p>
      )}
      {!isLoading && !isError && docs.length > 0 && (
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-slate-700">Type</th>
              <th className="px-3 py-2 text-left font-medium text-slate-700">Number</th>
              <th className="px-3 py-2 text-left font-medium text-slate-700">File</th>
              <th className="px-3 py-2 text-left font-medium text-slate-700">Issue / Expiry</th>
              <th className="px-3 py-2 text-left font-medium text-slate-700">Status</th>
              <th className="px-3 py-2 text-left font-medium text-slate-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => {
              const type = (doc.document_type as VehicleDocumentType) ?? "other";
              const label = VEHICLE_DOCUMENT_LABELS[type] ?? doc.document_type;
              const colorClass = DOC_TYPE_COLORS[type] ?? "bg-gray-100 text-gray-800";
              const expired = isExpired(doc.expiry_date);
              return (
                <tr key={doc.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colorClass}`}
                    >
                      {label}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs text-slate-700">
                      {doc.document_number || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {doc.file_name ? (
                      <button
                        type="button"
                        onClick={() => handleDownload(doc)}
                        className="text-sky-600 hover:text-sky-800 text-sm font-medium"
                      >
                        {doc.file_name}
                        {doc.file_size != null && (
                          <span className="text-xs text-slate-500 ml-1">
                            ({formatSize(doc.file_size)})
                          </span>
                        )}
                      </button>
                    ) : (
                      <span className="text-xs text-slate-500">No file</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    <div>Issue: {formatDate(doc.issue_date)}</div>
                    <div>
                      Expiry:{" "}
                      <span className={expired ? "text-red-600 font-medium" : ""}>
                        {formatDate(doc.expiry_date)}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        doc.is_verified
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {doc.is_verified ? "Verified" : "Pending"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() =>
                          verifyMutation.mutate({ docId: doc.id, verified: !doc.is_verified })
                        }
                        disabled={verifyMutation.isPending}
                        className="text-sky-600 hover:text-sky-800 font-medium disabled:opacity-60"
                      >
                        {doc.is_verified ? "Mark as unverified" : "Mark as verified"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirm(doc.id)}
                        className="text-red-600 hover:text-red-800 font-medium"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-slate-900">Delete document?</h3>
            <p className="text-sm text-slate-600 mt-2">
              This will permanently delete the vehicle document and its file from the server.
            </p>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => deleteMutation.mutate(deleteConfirm)}
                disabled={deleteMutation.isPending}
                className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                disabled={deleteMutation.isPending}
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

