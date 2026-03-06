import { Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "./store/authStore";
import { LoginPage } from "./pages/auth/LoginPage";
import { DriversListPage } from "./pages/drivers/DriversListPage";
import { AddDriverPage } from "./pages/drivers/AddDriverPage";
import { EditDriverPage } from "./pages/drivers/EditDriverPage";
import { DriverDetailPage } from "./pages/drivers/DriverDetailPage";
import { DashboardPage } from "./pages/dashboard/DashboardPage";
import { RegisterPage } from "./pages/register/Register";

function ProtectedRoute({ children }: { children: JSX.Element }) {
  const token = useAuthStore((s) => s.token);
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
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
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

