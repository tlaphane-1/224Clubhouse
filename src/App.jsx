import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './context/AuthContext'
import { CartProvider } from './context/CartContext'
import AgeGate from './components/layout/AgeGate'
import Navbar from './components/layout/Navbar'
import Footer from './components/layout/Footer'

// Pages
import Home from './pages/Home'
import Store from './pages/Store'
import ProductDetail from './pages/ProductDetail'
import Cart from './pages/Cart'
import Checkout from './pages/Checkout'
import OrderConfirmation from './pages/OrderConfirmation'
import Events from './pages/Events'
import Login from './pages/Login'
import Dashboard from './pages/admin/Dashboard'
import Products from './pages/admin/Products'
import Orders from './pages/admin/Orders'
import AdminEvents from './pages/admin/Events'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2, // 2 min
      retry: 1,
    },
  },
})

function ProtectedRoute({ children }) {
  const { user, loading, isAdmin } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user || !isAdmin) {
    return <Navigate to="/admin/login" replace />
  }

  return children
}

function PublicLayout({ children }) {
  return (
    <>
      <Navbar />
      <main>{children}</main>
      <Footer />
    </>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CartProvider>
          <BrowserRouter>
            <AgeGate />
            <Toaster position="top-right" />
            <Routes>
              {/* Public */}
              <Route path="/" element={<PublicLayout><Home /></PublicLayout>} />
              <Route path="/store" element={<PublicLayout><Store /></PublicLayout>} />
              <Route path="/store/:slug" element={<PublicLayout><ProductDetail /></PublicLayout>} />
              <Route path="/cart" element={<PublicLayout><Cart /></PublicLayout>} />
              <Route path="/checkout" element={<PublicLayout><Checkout /></PublicLayout>} />
              <Route path="/order-confirmation/:id" element={<PublicLayout><OrderConfirmation /></PublicLayout>} />
              <Route path="/events" element={<PublicLayout><Events /></PublicLayout>} />

              {/* Admin */}
              <Route path="/admin/login" element={<Login />} />
              <Route path="/admin/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/admin/products" element={<ProtectedRoute><Products /></ProtectedRoute>} />
              <Route path="/admin/orders" element={<ProtectedRoute><Orders /></ProtectedRoute>} />
              <Route path="/admin/events" element={<ProtectedRoute><AdminEvents /></ProtectedRoute>} />

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </CartProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
