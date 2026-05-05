import { Navigate, useLocation } from "react-router-dom";
import { getToken } from "../lib/api";

export default function ProtectedRoute({ children }) {
  const location = useLocation();
  const token = getToken();
  if (!token) {
    return <Navigate to={`/login?from=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return children;
}
