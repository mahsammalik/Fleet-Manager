import { useState } from "react";
import { useAuthStore } from "../../store/authStore";
import { LogoutConfirmationModal } from "./LogoutConfirmationModal";

function LogoutIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
      />
    </svg>
  );
}

export function LogoutButton() {
  const logout = useAuthStore((s) => s.logout);
  const [modalOpen, setModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleConfirm = async () => {
    setIsLoading(true);
    setSuccessMessage(null);
    try {
      logout();
      setSuccessMessage("Logged out successfully.");
    } catch {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      setModalOpen(false);
      setSuccessMessage(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-1 transition-colors"
        aria-label="Log out"
      >
        <LogoutIcon />
        <span className="hidden sm:inline">Log out</span>
      </button>
      <LogoutConfirmationModal
        isOpen={modalOpen}
        onClose={handleClose}
        onConfirm={handleConfirm}
        isLoading={isLoading}
        successMessage={successMessage}
      />
    </>
  );
}
