import { getDriverPhotoUrl } from "../../utils/photo";

interface DriverAvatarProps {
  profilePhotoUrl?: string | null;
  firstName: string;
  lastName: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  sm: "w-8 h-8 text-xs",
  md: "w-12 h-12 text-sm",
  lg: "w-20 h-20 text-lg",
};

function getInitials(firstName: string, lastName: string): string {
  const f = (firstName ?? "").trim().charAt(0);
  const l = (lastName ?? "").trim().charAt(0);
  if (f || l) return `${f}${l}`.toUpperCase();
  return "?";
}

export function DriverAvatar({
  profilePhotoUrl,
  firstName,
  lastName,
  size = "md",
  className = "",
}: DriverAvatarProps) {
  const photoUrl = getDriverPhotoUrl(profilePhotoUrl);
  const sizeClass = sizeClasses[size];

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={`${firstName} ${lastName}`}
        className={`rounded-full object-cover shrink-0 ${sizeClass} ${className}`}
      />
    );
  }

  return (
    <div
      className={`rounded-full bg-sky-100 text-sky-700 flex items-center justify-center font-medium shrink-0 ${sizeClass} ${className}`}
      aria-hidden
    >
      {getInitials(firstName, lastName)}
    </div>
  );
}
