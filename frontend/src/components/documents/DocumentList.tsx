import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  getDocuments,
  deleteDocument,
  verifyDocument,
  downloadDocument,
  type DriverDocument,
  type DocumentType,
} from "../../api/documents";

const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  trc_card: "TRC Card",
  drivers_license: "Driver's License",
  contract: "Contract",
  insurance: "Insurance",
  vehicle_permit: "Vehicle Permit",
  passport: "Passport",
  other: "Other",
};

const DOC_TYPE_COLORS: Record<DocumentType, string> = {
  trc_card: "bg-blue-100 text-blue-800",
  drivers_license: "bg-emerald-100 text-emerald-800",
  contract: "bg-amber-100 text-amber-800",
  insurance: "bg-purple-100 text-purple-800",
  vehicle_permit: "bg-slate-100 text-slate-800",
  passport: "bg-cyan-100 text-cyan-800",
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

interface DocumentListProps {
  driverId: string;
}

export function DocumentList({ driverId }: DocumentListProps) {
  const queryClient = useQueryClient();
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const { data: docsResponse, isLoading, isError } = useQuery({
    queryKey: ["documents", driverId],
    queryFn: () => getDocuments(driverId),
  });

  const deleteMutation = useMutation({
    mutationFn: (docId: string) => deleteDocument(driverId, docId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents", driverId] });
      queryClient.invalidateQueries({ queryKey: ["driver", driverId] });
      setDeleteConfirm(null);
    },
  });

  const verifyMutation = useMutation({
    mutationFn: ({ docId, verified }: { docId: string; verified: boolean }) =>
      verifyDocument(driverId, docId, verified),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents", driverId] });
    },
  });

  const handleDownload = async (doc: DriverDocument) => {
    try {
      const blob = await downloadDocument(driverId, doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.file_name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  };

  const docs = docsResponse?.data ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span className="inline-block w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
        Loading documents...
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-red-600">Failed to load documents.</p>
    );
  }

  if (docs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
        No documents yet. Upload one above.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {docs.map((doc) => (
        <div
          key={doc.id}
          className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span
              className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${
                DOC_TYPE_COLORS[doc.document_type]
              }`}
            >
              {DOC_TYPE_LABELS[doc.document_type]}
            </span>
            {doc.is_verified ? (
              <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800">
                Verified
              </span>
            ) : (
              <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-600">
                Pending
              </span>
            )}
            {doc.expiry_date && isExpired(doc.expiry_date) && (
              <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800">
                Expired
              </span>
            )}
          </div>

          <p className="text-sm font-medium text-slate-900 truncate" title={doc.file_name}>
            {doc.file_name}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {formatSize(doc.file_size)} · Uploaded {formatDate(doc.created_at)}
          </p>
          {doc.expiry_date && (
            <p className="text-xs text-slate-500">
              Expires {formatDate(doc.expiry_date)}
              {isExpired(doc.expiry_date) && (
                <span className="text-red-600 ml-1">(expired)</span>
              )}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleDownload(doc)}
              className="text-sm font-medium text-sky-600 hover:text-sky-800"
            >
              Download
            </button>
            <button
              type="button"
              onClick={() =>
                verifyMutation.mutate({
                  docId: doc.id,
                  verified: !doc.is_verified,
                })
              }
              disabled={verifyMutation.isPending}
              className="text-sm font-medium text-slate-600 hover:text-slate-800 disabled:opacity-60"
            >
              {doc.is_verified ? "Unverify" : "Verify"}
            </button>
            {deleteConfirm === doc.id ? (
              <>
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate(doc.id)}
                  disabled={deleteMutation.isPending}
                  className="text-sm font-medium text-red-600 hover:text-red-800"
                >
                  Confirm delete
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(null)}
                  className="text-sm text-slate-500 hover:text-slate-700"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setDeleteConfirm(doc.id)}
                className="text-sm font-medium text-red-600 hover:text-red-800"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
