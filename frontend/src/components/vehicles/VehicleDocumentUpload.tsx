import type { DragEvent, FormEvent, ChangeEvent } from "react";
import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { uploadVehicleDocument } from "../../api/vehicleDocuments";
import {
  VEHICLE_DOCUMENT_TYPES,
  type VehicleDocumentType,
} from "../../constants/vehicleDocumentTypes";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
const ALLOWED_EXT = [".pdf", ".jpg", ".jpeg", ".png"];

function validateFile(file: File): string | null {
  if (file.size > MAX_SIZE) return "File must be 10MB or smaller.";
  const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
  const ok = ALLOWED_TYPES.includes(file.type) || ALLOWED_EXT.includes(ext);
  if (!ok) return "Only PDF, JPG and PNG files are allowed.";
  return null;
}

interface VehicleDocumentUploadProps {
  vehicleId: string;
  onSuccess?: () => void;
}

export function VehicleDocumentUpload({ vehicleId, onSuccess }: VehicleDocumentUploadProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<VehicleDocumentType>("insurance");
  const [documentNumber, setDocumentNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const mutation = useMutation({
    mutationFn: ({
      file,
      onProgress,
    }: {
      file: File;
      onProgress: (p: number) => void;
    }) => {
      const form = new FormData();
      form.append("file", file);
      form.append("documentType", documentType);
      if (documentNumber.trim()) form.append("documentNumber", documentNumber.trim());
      if (expiryDate) form.append("expiryDate", expiryDate);
      if (issueDate) form.append("issueDate", issueDate);
      if (notes.trim()) form.append("notes", notes.trim());
      return uploadVehicleDocument(vehicleId, form, onProgress);
    },
    onSuccess: () => {
      setToast({ type: "success", message: "Document uploaded successfully." });
      setSelectedFile(null);
      setDocumentNumber("");
      setExpiryDate("");
      setIssueDate("");
      setNotes("");
      setUploadProgress(0);
      queryClient.invalidateQueries({ queryKey: ["vehicleDocuments", vehicleId] });
      onSuccess?.();
    },
    onError: (err: Error) => {
      setToast({
        type: "error",
        message: (err as Error).message || "Upload failed.",
      });
      setUploadProgress(0);
    },
  });

  const onFileSelected = (file: File | null) => {
    if (!file) {
      setSelectedFile(null);
      return;
    }
    const err = validateFile(file);
    if (err) {
      setToast({ type: "error", message: err });
      setSelectedFile(null);
      return;
    }
    setToast(null);
    setSelectedFile(file);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFileSelected(file);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setToast({ type: "error", message: "Please select a file first." });
      return;
    }
    mutation.mutate({
      file: selectedFile,
      onProgress: (p) => setUploadProgress(p),
    });
  };

  const onFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    onFileSelected(file);
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Document type</label>
          <select
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value as VehicleDocumentType)}
          >
            {VEHICLE_DOCUMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Document number <span className="text-slate-400">(optional)</span>
          </label>
          <input
            type="text"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            value={documentNumber}
            onChange={(e) => setDocumentNumber(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Issue date <span className="text-slate-400">(optional)</span>
          </label>
          <input
            type="date"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Expiry date <span className="text-slate-400">(optional)</span>
          </label>
          <input
            type="date"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Notes <span className="text-slate-400">(optional)</span>
        </label>
        <textarea
          rows={2}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div
        className={`mt-2 flex flex-col items-center justify-center border-2 border-dashed rounded-xl px-4 py-6 text-center ${
          dragOver ? "border-sky-400 bg-sky-50/50" : "border-slate-300 bg-slate-50/40"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
        }}
        onDrop={onDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/jpg,image/png"
          onChange={onFileInputChange}
        />
        <p className="text-sm text-slate-700">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="font-medium text-sky-600 hover:text-sky-800"
          >
            Click to upload
          </button>{" "}
          or drag and drop
        </p>
        <p className="text-xs text-slate-500 mt-1">PDF, JPG, PNG up to 10MB</p>
        {selectedFile && (
          <p className="mt-3 text-xs text-slate-600">
            Selected: <span className="font-medium">{selectedFile.name}</span>
          </p>
        )}
      </div>

      {uploadProgress > 0 && uploadProgress < 100 && (
        <div className="mt-2">
          <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-sky-500 transition-all"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">Uploading... {uploadProgress}%</p>
        </div>
      )}

      {toast && (
        <p
          className={`text-xs mt-1 ${
            toast.type === "success" ? "text-emerald-600" : "text-red-600"
          }`}
        >
          {toast.message}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="submit"
          disabled={mutation.isPending}
          className="inline-flex items-center rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
        >
          {mutation.isPending ? "Uploading..." : "Upload document"}
        </button>
      </div>
    </form>
  );
}

