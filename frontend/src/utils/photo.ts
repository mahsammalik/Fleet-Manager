/**
 * Base URL for uploads (same origin as API, without /api).
 * Backend serves uploads at GET /uploads/...
 */
function getUploadsBaseUrl(): string {
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4100/api";
  return apiUrl.replace(/\/api\/?$/, "");
}

/**
 * Full URL for a driver profile photo (relative path from DB).
 * Returns null if path is empty.
 */
export function getDriverPhotoUrl(profilePhotoUrl: string | null | undefined): string | null {
  if (!profilePhotoUrl?.trim()) return null;
  const base = getUploadsBaseUrl();
  const path = profilePhotoUrl.startsWith("/") ? profilePhotoUrl.slice(1) : profilePhotoUrl;
  return `${base}/${path}`;
}
