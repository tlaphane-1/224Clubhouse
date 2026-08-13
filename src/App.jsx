import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './context/AuthContext'
import { CartProvider } from './context/CartContext'
import AgeGate from './components/layout/AgeGate'
import Navbar from './components/layout/Navbar'
import Footer from './components/layout/Footer'
import ErrorBoundary from './components/ErrorBoundary'
import NotFound from './pages/NotFound'

// Pages are lazy-loaded: each becomes its own chunk fetched on demand, so the
// storefront's initial bundle no longer ships the admin panel, checkout,
// Firebase, or Paystack code.
const Home = lazy(() => import('./pages/Home'))
const Store = lazy(() => import('./pages/Store'))
const ProductDetail = lazy(() => import('./pages/ProductDetail'))
const Cart = lazy(() => import('./pages/Cart'))
const Checkout = lazy(() => import('./pages/Checkout'))
const OrderConfirmation = lazy(() => import('./pages/OrderConfirmation'))
const TrackOrder = lazy(() => import('./pages/TrackOrder'))
const MyOrders = lazy(() => import('./pages/MyOrders'))
const Account = lazy(() => import('./pages/Account'))
const OrderDetail = lazy(() => import('./pages/OrderDetail'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const Events = lazy(() => import('./pages/Events'))
const Membership = lazy(() => import('./pages/Membership'))
const About = lazy(() => import('./pages/About'))
const Contact = lazy(() => import('./pages/Contact'))
const PrivacyPolicy = lazy(() => import('./pages/legal/PrivacyPolicy'))
const Terms = lazy(() => import('./pages/legal/Terms'))
const DeliveryReturns = lazy(() => import('./pages/legal/DeliveryReturns'))
const Login = lazy(() => import('./pages/Login'))
const Dashboard = lazy(() => import('./pages/admin/Dashboard'))
const Products = lazy(() => import('./pages/admin/Products'))
const Orders = lazy(() => import('./pages/admin/Orders'))
const AdminEvents = lazy(() => import('./pages/admin/Events'))
const AdminMemberships = lazy(() => import('./pages/admin/Memberships'))
const AdminMessages = lazy(() => import('./pages/admin/Messages'))
const AdminNewsletter = lazy(() => import('./pages/admin/Newsletter'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2, // 2 min
      retry: 1,
    },
  },
})

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

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
            <ErrorBoundary>
            <Suspense fallback={<PageFallback />}>
              <Routes>
                {/* Public */}
                <Route path="/" element={<PublicLayout><Home /></PublicLayout>} />
                <Route path="/store" element={<PublicLayout><Store /></PublicLayout>} />
                <Route path="/store/:slug" element={<PublicLayout><ProductDetail /></PublicLayout>} />
                <Route path="/cart" element={<PublicLayout><Cart /></PublicLayout>} />
                <Route path="/checkout" element={<PublicLayout><Checkout /></PublicLayout>} />
                <Route path="/order-confirmation/:id" element={<PublicLayout><OrderConfirmation /></PublicLayout>} />
                <Route path="/track" element={<PublicLayout><TrackOrder /></PublicLayout>} />
                {/* No ProtectedRoute: the page shows sign-in itself when logged out. */}
                <Route path="/orders" element={<PublicLayout><MyOrders /></PublicLayout>} />
                <Route path="/account" element={<PublicLayout><Account /></PublicLayout>} />
                <Route path="/orders/:id" element={<PublicLayout><OrderDetail /></PublicLayout>} />
                {/* Password-recovery landing page — the emailed reset link points here. */}
                <Route path="/reset-password" element={<PublicLayout><ResetPassword /></PublicLayout>} />
                <Route path="/events" element={<PublicLayout><Events /></PublicLayout>} />
                <Route path="/membership" element={<PublicLayout><Membership /></PublicLayout>} />
                <Route path="/about" element={<PublicLayout><About /></PublicLayout>} />
                <Route path="/contact" element={<PublicLayout><Contact /></PublicLayout>} />
                <Route path="/privacy" element={<PublicLayout><PrivacyPolicy /></PublicLayout>} />
                <Route path="/terms" element={<PublicLayout><Terms /></PublicLayout>} />
                <Route path="/delivery-returns" element={<PublicLayout><DeliveryReturns /></PublicLayout>} />

                {/* Admin */}
                <Route path="/admin/login" element={<Login />} />
                <Route path="/admin/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                <Route path="/admin/products" element={<ProtectedRoute><Products /></ProtectedRoute>} />
                <Route path="/admin/orders" element={<ProtectedRoute><Orders /></ProtectedRoute>} />
                <Route path="/admin/events" element={<ProtectedRoute><AdminEvents /></ProtectedRoute>} />
                <Route path="/admin/memberships" element={<ProtectedRoute><AdminMemberships /></ProtectedRoute>} />
                <Route path="/admin/messages" element={<ProtectedRoute><AdminMessages /></ProtectedRoute>} />
                <Route path="/admin/newsletter" element={<ProtectedRoute><AdminNewsletter /></ProtectedRoute>} />

                {/* Fallback */}
                <Route path="*" element={<PublicLayout><NotFound /></PublicLayout>} />
              </Routes>
            </Suspense>
            </ErrorBoundary>
          </BrowserRouter>
        </CartProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
