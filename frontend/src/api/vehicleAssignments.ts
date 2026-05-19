import { api } from "../lib/api";

export function assignVehicleToDriver(driverId: string, vehicleId: string) {
  return api.post<{ driverId: string; vehicleId: string }>(`/drivers/${driverId}/assign-vehicle`, {
    vehicleId,
  });
}

export function unassignDriverVehicle(driverId: string) {
  return api.post<{ driverId: string; vehicleId: null }>(`/drivers/${driverId}/unassign-vehicle`);
}

export function assignDriverToVehicle(vehicleId: string, driverId: string) {
  return api.post(`/vehicles/${vehicleId}/assign-driver`, { driverId });
}

export function unassignDriverFromVehicle(vehicleId: string) {
  return api.post(`/vehicles/${vehicleId}/unassign-driver`);
}
