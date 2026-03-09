// Platform ID constants
export const PLATFORM_IDS = {
  UBER: "uber",
  BOLT: "bolt",
  GLOVO: "glovo",
  BOLT_COURIER: "bolt_courier",
  WOLT: "wolt", // NEW PLATFORM
} as const;

export type PlatformId = (typeof PLATFORM_IDS)[keyof typeof PLATFORM_IDS];

// Platform ID labels for display
export const PLATFORM_ID_LABELS: Record<PlatformId, string> = {
  [PLATFORM_IDS.UBER]: "Uber",
  [PLATFORM_IDS.BOLT]: "Bolt",
  [PLATFORM_IDS.GLOVO]: "Glovo",
  [PLATFORM_IDS.BOLT_COURIER]: "Bolt Courier",
  [PLATFORM_IDS.WOLT]: "Wolt", // NEW PLATFORM
};

// Platform ID icons
export const PLATFORM_ID_ICONS: Record<PlatformId, string> = {
  [PLATFORM_IDS.UBER]: "🚗",
  [PLATFORM_IDS.BOLT]: "⚡",
  [PLATFORM_IDS.GLOVO]: "🛵",
  [PLATFORM_IDS.BOLT_COURIER]: "📦",
  [PLATFORM_IDS.WOLT]: "🛵", // NEW PLATFORM
};

// Platform ID colors for badges
export const PLATFORM_ID_COLORS: Record<PlatformId, string> = {
  [PLATFORM_IDS.UBER]: "bg-black text-white",
  [PLATFORM_IDS.BOLT]: "bg-blue-600 text-white",
  [PLATFORM_IDS.GLOVO]: "bg-green-600 text-white",
  [PLATFORM_IDS.BOLT_COURIER]: "bg-blue-500 text-white",
  [PLATFORM_IDS.WOLT]: "bg-orange-600 text-white", // NEW PLATFORM
};

// Platform ID required fields
export const PLATFORM_ID_REQUIRED_FIELDS: Record<PlatformId, string[]> = {
  [PLATFORM_IDS.UBER]: ["uber_driver_id"],
  [PLATFORM_IDS.BOLT]: ["bolt_driver_id"],
  [PLATFORM_IDS.GLOVO]: ["glovo_courier_id"],
  [PLATFORM_IDS.BOLT_COURIER]: ["bolt_courier_id"],
  [PLATFORM_IDS.WOLT]: ["wolt_courier_id"], // NEW PLATFORM
};

// Get all platform IDs
export const getAllPlatformIds = () => Object.values(PLATFORM_IDS);

// Get platform ID by code
export const getPlatformIdByCode = (code: string): PlatformId | undefined => {
  return Object.values(PLATFORM_IDS).find((id) => id === code);
};

