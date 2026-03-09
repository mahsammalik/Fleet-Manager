import { VEHICLE_DOCUMENT_LABELS } from "../../constants/vehicleDocumentTypes";
import type { VehicleDocument } from "../../api/vehicleDocuments";

interface VehicleDocumentDetailProps {
  document: VehicleDocument;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = value.split("T")[0];
  return d || "—";
}

export function VehicleDocumentDetail({ document }: VehicleDocumentDetailProps) {
  const label =
    VEHICLE_DOCUMENT_LABELS[document.document_type as keyof typeof VEHICLE_DOCUMENT_LABELS] ??
    document.document_type;

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h3 className="text-sm font-semibold text-slate-800 mb-1">Document</h3>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <dt className="text-slate-500">Type</dt>
            <dd className="font-medium">{label}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Number</dt>
            <dd className="font-mono text-xs">{document.document_number || "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Issue date</dt>
            <dd>{formatDate(document.issue_date)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Expiry date</dt>
            <dd>{formatDate(document.expiry_date)}</dd>
          </div>
        </dl>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-slate-800 mb-1">File</h3>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <dt className="text-slate-500">Name</dt>
            <dd>{document.file_name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Path</dt>
            <dd className="font-mono text-xs break-all">{document.file_path ?? "—"}</dd>
          </div>
        </dl>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-slate-800 mb-1">Status</h3>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <dt className="text-slate-500">Verified</dt>
            <dd>{document.is_verified ? "Yes" : "No"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Verified at</dt>
            <dd>{formatDate(document.verified_at)}</dd>
          </div>
        </dl>
      </div>
      {document.notes && (
        <div>
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Notes</h3>
          <p className="text-slate-700 whitespace-pre-wrap">{document.notes}</p>
        </div>
      )}
    </div>
  );
}

