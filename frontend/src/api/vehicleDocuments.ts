import { api } from "../lib/api";
import type { VehicleDocumentType } from "../constants/vehicleDocumentTypes";

export interface VehicleDocument {
  id: string;
  vehicle_id: string;
  organization_id: string;
  document_type: VehicleDocumentType | string;
  document_number: string | null;
  file_name: string | null;
  file_path: string | null;
  file_size: number | null;
  expiry_date: string | null;
  issue_date: string | null;
  is_verified: boolean;
  verified_by: string | null;
  verified_at: string | null;
  notes: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpiringVehicleDocument extends VehicleDocument {
  make: string;
  model: string;
  license_plate: string;
}

export function getVehicleDocuments(vehicleId: string) {
  return api.get<VehicleDocument[]>(`/vehicles/${vehicleId}/documents`);
}

export function uploadVehicleDocument(
  vehicleId: string,
  formData: FormData,
  onUploadProgress?: (progress: number) => void,
) {
  return api.post<VehicleDocument>(`/vehicles/${vehicleId}/documents`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: onUploadProgress
      ? (e) => {
          if (e.total) onUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      : undefined,
  });
}

export function deleteVehicleDocument(vehicleId: string, documentId: string) {
  return api.delete(`/vehicles/${vehicleId}/documents/${documentId}`);
}

export function verifyVehicleDocument(
  vehicleId: string,
  documentId: string,
  verified: boolean,
) {
  return api.put<VehicleDocument>(`/vehicles/${vehicleId}/documents/${documentId}/verify`, {
    verified,
  });
}

export async function downloadVehicleDocument(vehicleId: string, documentId: string) {
  const { data } = await api.get<Blob>(
    `/vehicles/${vehicleId}/documents/${documentId}/download`,
    { responseType: "blob" },
  );
  return data;
}

export function getExpiringVehicleDocuments() {
  return api.get<ExpiringVehicleDocument[]>(`/vehicles/documents/expiring`);
}

