import { api } from "../lib/api";

export type DocumentType =
  | "id_card"
  | "drivers_license"
  | "contract"
  | "insurance"
  | "vehicle_permit"
  | "other";

export interface DriverDocument {
  id: string;
  driver_id: string;
  document_type: DocumentType;
  file_name: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  expiry_date: string | null;
  is_verified: boolean;
  verified_by: string | null;
  verified_at: string | null;
  uploaded_by: string | null;
  notes: string | null;
  created_at: string;
}

export function getDocuments(driverId: string) {
  return api.get<DriverDocument[]>(`/drivers/${driverId}/documents`);
}

export function uploadDocument(
  driverId: string,
  formData: FormData,
  onUploadProgress?: (progress: number) => void,
) {
  return api.post<DriverDocument>(`/drivers/${driverId}/documents`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: onUploadProgress
      ? (e) => {
          if (e.total) onUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      : undefined,
  });
}

export function deleteDocument(driverId: string, documentId: string) {
  return api.delete(`/drivers/${driverId}/documents/${documentId}`);
}

export function verifyDocument(
  driverId: string,
  documentId: string,
  verified: boolean,
) {
  return api.put<DriverDocument>(
    `/drivers/${driverId}/documents/${documentId}/verify`,
    { verified },
  );
}

export async function downloadDocument(driverId: string, documentId: string) {
  const { data } = await api.get<Blob>(
    `/drivers/${driverId}/documents/${documentId}/download`,
    { responseType: "blob" },
  );
  return data;
}
