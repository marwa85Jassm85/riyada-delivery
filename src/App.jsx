import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import EmployeeDashboard from './pages/employee/EmployeeDashboard';
import DriverDashboard from './pages/driver/DriverDashboard';
import PharmacistDashboard from './pages/pharmacist/PharmacistDashboard';
import AdminDashboard from './pages/admin/AdminDashboard';

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <img src="/logo.png" alt="logo" className="loading-logo" />
      <div className="loading-title">رياده كونكت</div>
      <div className="spinner" />
    </div>
  );
}

function ProtectedRoute({ children, role }) {
  const { currentUser, userProfile, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!currentUser) return <Navigate to="/login" replace />;
  if (userProfile && userProfile.role !== role) return <Navigate to="/login" replace />;
  return children;
}

function RootRedirect() {
  const { currentUser, userProfile, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (currentUser && userProfile) return <Navigate to={`/${userProfile.role}`} replace />;
  return <Navigate to="/login" replace />;
}

function AppRoutes() {
  const { currentUser } = useAuth();

  // منع زر الرجوع في Android من إغلاق الـ PWA
  // يعمل فقط عندما يكون المستخدم مسجل الدخول
  useEffect(() => {
    if (!currentUser) return;
    // نضيف state في الـ history حتى يكون فيه شيء يرجع إليه
    window.history.pushState({ pwa: true }, '', window.location.href);
    const onPop = () => {
      // عند الضغط Back نعيد الـ state بدل ما يخرج
      window.history.pushState({ pwa: true }, '', window.location.href);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [currentUser]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/employee/*" element={
        <ProtectedRoute role="employee"><EmployeeDashboard /></ProtectedRoute>
      } />
      <Route path="/driver/*" element={
        <ProtectedRoute role="driver"><DriverDashboard /></ProtectedRoute>
      } />
      <Route path="/pharmacist/*" element={
        <ProtectedRoute role="pharmacist"><PharmacistDashboard /></ProtectedRoute>
      } />
      <Route path="/admin/*" element={
        <ProtectedRoute role="admin"><AdminDashboard /></ProtectedRoute>
      } />
      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Toaster
          position="top-center"
          toastOptions={{
            style: { fontFamily: "'Tajawal', sans-serif", direction: 'rtl', fontSize: '15px' },
            duration: 3000,
          }}
        />
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
