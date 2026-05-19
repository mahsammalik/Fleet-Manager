import { api } from "../lib/api";

export type SubcontractorRegistrationType = "srl" | "sa" | "other";

export interface Subcontractor {
  id: string;
  organization_id: string;
  legal_name: string;
  registration_type: SubcontractorRegistrationType;
  registration_number: string | null;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  bank_name: string | null;
  bank_account_iban: string | null;
  status: string;
  contract_start_date: string | null;
  contract_end_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  driver_count?: number;
}

export interface SubcontractorDetail extends Subcontractor {
  drivers: { id: string; first_name: string; last_name: string; phone: string; employment_status: string }[];
}

export interface SaveSubcontractorPayload {
  legalName: string;
  registrationType?: SubcontractorRegistrationType;
  registrationNumber?: string | null;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  bankName?: string | null;
  bankAccountIban?: string | null;
  status?: string;
  contractStartDate?: string | null;
  contractEndDate?: string | null;
  notes?: string | null;
}

export function getSubcontractors() {
  return api.get<Subcontractor[]>("/subcontractors");
}

export function getSubcontractor(id: string) {
  return api.get<SubcontractorDetail>(`/subcontractors/${encodeURIComponent(id)}`);
}

export function createSubcontractor(body: SaveSubcontractorPayload) {
  return api.post<Subcontractor>("/subcontractors", body);
}

export function updateSubcontractor(id: string, body: SaveSubcontractorPayload) {
  return api.put<Subcontractor>(`/subcontractors/${encodeURIComponent(id)}`, body);
}
