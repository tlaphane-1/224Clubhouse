import { useEffect, useState } from 'react'
import { Plus, Edit2, Trash2, ToggleLeft, ToggleRight, AlertTriangle } from 'lucide-react'
import AdminLayout from '../../components/admin/AdminLayout'
import Modal from '../../components/ui/Modal'
import Badge from '../../components/ui/Badge'
import ProductForm from '../../components/admin/ProductForm'
import { useAllProducts } from '../../hooks/useProducts'
import { supabase } from '../../lib/supabase'
import { formatZAR } from '../../utils/formatCurrency'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

export default function Products() {
  const { data: products, isLoading, isError, refetch } = useAllProducts()
  const [modalOpen, setModalOpen] = useState(false)
  const [editProduct, setEditProduct] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    document.title = 'Products | 224 Admin'
  }, [])

  const handleToggleAvailable = async (product) => {
    try {
      await supabase.from('products').update({ is_available: !product.is_available }).eq('id', product.id)
      queryClient.invalidateQueries({ queryKey: ['products'] })
    } catch {
      toast.error('Failed to update product')
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this product? This cannot be undone.')) return
    setDeletingId(id)
    try {
      const { error } = await supabase.from('products').delete().eq('id', id)
      if (error) throw error
      queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success('Product deleted')
    } catch {
      toast.error('Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

  const openAdd = () => { setEditProduct(null); setModalOpen(true) }
  const openEdit = (product) => { setEditProduct(product); setModalOpen(true) }

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-heading text-3xl font-bold text-white">Products</h1>
          <p className="text-muted text-sm mt-1">{products?.length || 0} total products</p>
        </div>
        <button onClick={openAdd} className="btn-gold flex items-center gap-2 text-sm">
          <Plus size={16} /> Add Product
        </button>
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted">Loading...</div>
        ) : isError ? (
          <div className="p-10 text-center">
            <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
            <p className="text-white text-sm mb-5">
              Couldn't load products. Please check your connection and try again.
            </p>
            <button onClick={() => refetch()} className="btn-gold text-sm">
              Retry
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted uppercase tracking-widest text-xs">
                  <th className="p-4 text-left font-medium">Product</th>
                  <th className="p-4 text-left font-medium">Category</th>
                  <th className="p-4 text-right font-medium">Price</th>
                  <th className="p-4 text-right font-medium">Stock</th>
                  <th className="p-4 text-center font-medium">Available</th>
                  <th className="p-4 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {products?.map(product => (
                  <tr key={product.id} className="hover:bg-border/20 transition-colors">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-background overflow-hidden flex-shrink-0">
                          {product.images?.[0] ? (
                            <img src={product.images[0]} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <span className="text-gold/30 font-heading font-bold text-xs">224</span>
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="text-white font-medium">{product.name}</p>
                          {product.strain_type && (
                            <p className="text-muted text-xs capitalize">{product.strain_type}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <Badge variant={product.category}>{product.category}</Badge>
                    </td>
                    <td className="p-4 text-right text-white">{formatZAR(product.price)}</td>
                    <td className="p-4 text-right">
                      <span className={product.stock_quantity === 0 ? 'text-red-400' : 'text-white'}>
                        {product.stock_quantity}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      <button
                        onClick={() => handleToggleAvailable(product)}
                        className={`transition-colors ${product.is_available ? 'text-green-400 hover:text-red-400' : 'text-muted hover:text-green-400'}`}
                      >
                        {product.is_available ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                      </button>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEdit(product)} className="text-muted hover:text-gold transition-colors p-1">
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(product.id)}
                          disabled={deletingId === product.id}
                          className="text-muted hover:text-red-400 transition-colors p-1 disabled:opacity-50"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editProduct ? 'Edit Product' : 'Add Product'}
        size="lg"
      >
        <ProductForm product={editProduct} onClose={() => setModalOpen(false)} />
      </Modal>
    </AdminLayout>
  )
}
