import React from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { useAuthStore } from "./store/authStore";
import { AppLayout } from "./components/layout/AppLayout";
import { LoginPage } from "./pages/auth/LoginPage";
import { DriversListPage } from "./pages/drivers/DriversListPage";
import { AddDriverPage } from "./pages/drivers/AddDriverPage";
import { EditDriverPage } from "./pages/drivers/EditDriverPage";
import { DriverDetailPage } from "./pages/drivers/DriverDetailPage";
import { DashboardPage } from "./pages/dashboard/DashboardPage";
import { RegisterPage } from "./pages/register/Register";
import { VehiclesListPage } from "./pages/vehicles/VehiclesListPage";
import { AddVehiclePage } from "./pages/vehicles/AddVehiclePage";
import { EditVehiclePage } from "./pages/vehicles/EditVehiclePage";
import { VehicleDetailPage } from "./pages/vehicles/VehicleDetailPage";
import { VehicleDocumentsPage } from "./pages/vehicles/VehicleDocumentsPage";
import { OverdueRentalsPage } from "./pages/rentals/OverdueRentalsPage";
import { EarningsOverviewPage } from "./pages/earnings/EarningsOverviewPage";
import { EarningsImportPage } from "./pages/earnings/EarningsImportPage";
import { EarningsPayoutsPage } from "./pages/earnings/EarningsPayoutsPage";
import { EarningsReportsPage } from "./pages/earnings/EarningsReportsPage";

function ProtectedRoute({ children }: { children: React.ReactElement }) {
  const token = useAuthStore((s) => s.token);
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <AppLayout>{children}</AppLayout>;
}

/** Data router (required for `useBlocker`, e.g. unsaved import navigation guard). */
export const appRouter = createBrowserRouter(
  [
    { path: "login", element: <LoginPage /> },
    { path: "/register", element: <RegisterPage /> },
    {
      path: "/dashboard",
      element: (
        <ProtectedRoute>
          <DashboardPage />
        </ProtectedRoute>
      ),
    },
    {
      path: "/drivers",
      element: (
        <ProtectedRoute>
          <DriversListPage />
        </ProtectedRoute>
      ),
    },
    {
      path: "/drivers/new",
      element: (
        <ProtectedRoute>
          <AddDriverPage />
        </ProtectedRoute>
      ),
    },
    {
      path: "/drivers/:id/edit",
      element: (
        <ProtectedRoute>
          <EditDriverPage />
        </ProtectedRoute>
      ),
    },
    {
      path: "/drivers/:id",
      element: (
        <ProtectedRoute>
          <DriverDetailPage />
        </ProtectedRoute>
      ),
    },
    {
      path: "/vehicles",
      element: (
        <ProtectedRoute>
          <VehiclesListPage />
        </ProtectedRoute>
      ),
    },
    {
      path: "/vehicles/new",
      element: (
        <ProtectedRoute>
          <AddVehiclePage />
        </ProtectedRoute>
      ),
    },
    {
      path: "/vehicles/:id/edit",
      element: (
        <ProtectedRoute>
          <EditVehiclePage />
        </ProtectedRoute>
      ),
    },
    {
      path: "/rentals/overdue",
      element: (
        <ProtectedRoute>
          <OverdueRentalsPage />
        </ProtectedRoute>
      ),
    },
    {
      path: "/earnings",
      element: (
        <ProtectedRoute>
          <EarningsOverviewPage />
        </ProtectedRoute>
      ),
    },
    {
      path: "/earnings/import",
      element: (
        <ProtectedRoute>
          <EarningsImportPage />
        </ProtectedRoute>
      ),
    },
    {
      path: "/earnings/payouts",
      element: (
        <ProtectedRoute>
          <EarningsPayoutsPage />
        </ProtectedRoute>
      ),
    },
    {
      path: "/earnings/reports",
      element: (
        <ProtectedRoute>
          <EarningsReportsPage />
        </ProtectedRoute>
      ),
    },
    {
      path: "/vehicles/:id",
      element: (
        <ProtectedRoute>
          <VehicleDetailPage />
        </ProtectedRoute>
      ),
    },
    {
      path: "/vehicles/:id/documents",
      element: (
        <ProtectedRoute>
          <VehicleDocumentsPage />
        </ProtectedRoute>
      ),
    },
    { path: "*", element: <Navigate to="/dashboard" replace /> },
  ],
  { basename: "/fleet" },
);
