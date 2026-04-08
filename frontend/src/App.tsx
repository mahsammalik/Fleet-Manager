import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
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

export default function App() {
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/drivers"
        element={
          <ProtectedRoute>
            <DriversListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/drivers/new"
        element={
          <ProtectedRoute>
            <AddDriverPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/drivers/:id/edit"
        element={
          <ProtectedRoute>
            <EditDriverPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/drivers/:id"
        element={
          <ProtectedRoute>
            <DriverDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/vehicles"
        element={
          <ProtectedRoute>
            <VehiclesListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/vehicles/new"
        element={
          <ProtectedRoute>
            <AddVehiclePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/vehicles/:id/edit"
        element={
          <ProtectedRoute>
            <EditVehiclePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/rentals/overdue"
        element={
          <ProtectedRoute>
            <OverdueRentalsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/earnings"
        element={
          <ProtectedRoute>
            <EarningsOverviewPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/earnings/import"
        element={
          <ProtectedRoute>
            <EarningsImportPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/earnings/payouts"
        element={
          <ProtectedRoute>
            <EarningsPayoutsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/earnings/reports"
        element={
          <ProtectedRoute>
            <EarningsReportsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/vehicles/:id"
        element={
          <ProtectedRoute>
            <VehicleDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/vehicles/:id/documents"
        element={
          <ProtectedRoute>
            <VehicleDocumentsPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

