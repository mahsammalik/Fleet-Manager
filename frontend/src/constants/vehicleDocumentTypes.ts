export type VehicleDocumentType =
  | "insurance"
  | "registration"
  | "maintenance"
  | "inspection"
  | "permit"
  | "other";

export interface VehicleDocumentTypeMeta {
  value: VehicleDocumentType;
  label: string;
  colorClass: string;
}

export const VEHICLE_DOCUMENT_TYPES: VehicleDocumentTypeMeta[] = [
  { value: "insurance", label: "Insurance", colorClass: "bg-purple-100 text-purple-800" },
  { value: "registration", label: "Registration", colorClass: "bg-blue-100 text-blue-800" },
  { value: "maintenance", label: "Maintenance", colorClass: "bg-amber-100 text-amber-800" },
  { value: "inspection", label: "Inspection", colorClass: "bg-emerald-100 text-emerald-800" },
  { value: "permit", label: "Permit", colorClass: "bg-slate-100 text-slate-800" },
  { value: "other", label: "Other", colorClass: "bg-gray-100 text-gray-800" },
];

export const VEHICLE_DOCUMENT_LABELS: Record<VehicleDocumentType, string> = VEHICLE_DOCUMENT_TYPES.reduce(
  (acc, t) => {
    acc[t.value] = t.label;
    return acc;
  },
  {} as Record<VehicleDocumentType, string>,
);

