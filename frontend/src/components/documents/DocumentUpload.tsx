import type { DragEvent, FormEvent, ChangeEvent } from "react";
import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  uploadDocument,
  type DocumentType,
} from "../../api/documents";

const DOCUMENT_TYPES: { value: DocumentType; label: string }[] = [
  { value: "id_card", label: "ID Card" },
  { value: "drivers_license", label: "Driver's License" },
  { value: "contract", label: "Contract" },
  { value: "insurance", label: "Insurance" },
  { value: "vehicle_permit", label: "Vehicle Permit" },
  { value: "other", label: "Other" },
];

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

interface DocumentUploadProps {
  driverId: string;
  onSuccess?: () => void;
}

export function DocumentUpload({ driverId, onSuccess }: DocumentUploadProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<DocumentType>("drivers_license");
  const [expiryDate, setExpiryDate] = useState("");
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
      if (expiryDate) form.append("expiryDate", expiryDate);
      if (notes.trim()) form.append("notes", notes.trim());
      return uploadDocument(driverId, form, onProgress);
    },
    onSuccess: () => {
      setToast({ type: "success", message: "Document uploaded successfully." });
      setSelectedFile(null);
      setExpiryDate("");
      setNotes("");
      setUploadProgress(0);
      queryClient.invalidateQueries({ queryKey: ["driver", driverId] });
      queryClient.invalidateQueries({ queryKey: ["documents", driverId] });
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

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const err = validateFile(file);
    if (err) {
      setToast({ type: "error", message: err });
      return;
    }
    setSelectedFile(file);
    setToast(null);
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const err = validateFile(file);
    if (err) {
      setToast({ type: "error", message: err });
      return;
    }
    setSelectedFile(file);
    setToast(null);
    e.target.value = "";
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setToast({ type: "error", message: "Please select a file." });
      return;
    }
    setToast(null);
    mutation.mutate({
      file: selectedFile,
      onProgress: setUploadProgress,
    });
  };

  const handleCancel = () => {
    setSelectedFile(null);
    setUploadProgress(0);
    setToast(null);
  };

  const isImage = selectedFile?.type.startsWith("image/");
  const isPdf = selectedFile?.type === "application/pdf";

  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            border-2 border-dashed rounded-lg p-6 text-center transition-colors
            ${dragOver ? "border-sky-500 bg-sky-50" : "border-slate-300 bg-slate-50"}
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            onChange={handleFileSelect}
            className="hidden"
          />
          {selectedFile ? (
            <div className="flex flex-col items-center gap-2">
              {isImage && (
                <img
                  src={URL.createObjectURL(selectedFile)}
                  alt="Preview"
                  className="max-h-24 rounded object-cover"
                />
              )}
              {isPdf && (
                <div className="w-12 h-16 bg-red-100 rounded flex items-center justify-center text-red-600 text-xs font-medium">
                  PDF
                </div>
              )}
              {!isImage && !isPdf && (
                <div className="w-12 h-12 bg-slate-200 rounded flex items-center justify-center text-slate-500 text-xs">
                  File
                </div>
              )}
              <p className="text-sm font-medium text-slate-700 truncate max-w-full">
                {selectedFile.name}
              </p>
              <p className="text-xs text-slate-500">
                {(selectedFile.size / 1024).toFixed(1)} KB
              </p>
              {mutation.isPending && (
                <div className="w-full max-w-xs bg-slate-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-sky-600 transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-sm text-sky-600 hover:underline"
                >
                  Change file
                </button>
                {mutation.isPending && (
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="text-sm text-slate-500 hover:underline"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              <p className="text-slate-600 text-sm mb-2">
                Drag & drop a file here, or click to browse
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-md bg-white border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Select file
              </button>
              <p className="text-xs text-slate-500 mt-2">
                PDF, JPG, PNG only. Max 10MB.
              </p>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Document type *
            </label>
            <select
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value as DocumentType)}
            >
              {DOCUMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Expiry date (optional)
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
            Notes (optional)
          </label>
          <input
            type="text"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes"
          />
        </div>

        {toast && (
          <p
            className={`text-sm ${
              toast.type === "success" ? "text-green-600" : "text-red-600"
            }`}
          >
            {toast.message}
          </p>
        )}

        <button
          type="submit"
          disabled={!selectedFile || mutation.isPending}
          className="inline-flex items-center rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-60"
        >
          {mutation.isPending ? (
            <>
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
              Uploading...
            </>
          ) : (
            "Upload"
          )}
        </button>
      </form>
    </div>
  );
}
