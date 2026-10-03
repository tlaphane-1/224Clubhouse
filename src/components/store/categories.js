import { LayoutGrid, Leaf, Candy, Cigarette, Wrench, ShoppingBag } from 'lucide-react'

// Single source for the storefront categories, shared by the home page tiles
// and the store's filter chips. Values must match the products.category check
// constraint (see migration 20261001120000).
export const CATEGORIES = [
  { value: 'flower', label: 'Flower', title: 'Flower Selections', icon: Leaf, desc: 'Premium cannabis flower, handpicked' },
  { value: 'edibles', label: 'Edibles', title: 'Edibles', icon: Candy, desc: 'Infused treats & beverages' },
  { value: 'joints', label: 'Joints', title: 'Joints', icon: Cigarette, desc: 'Pre-rolled and ready to go' },
  { value: 'accessories', label: 'Accessories', title: 'Accessories', icon: Wrench, desc: 'Gear for the discerning smoker' },
  { value: 'merchandise', label: 'Merch', title: 'Merchandise', icon: ShoppingBag, desc: 'Represent the culture' },
]

export const ALL_CATEGORY = { value: 'all', label: 'All', icon: LayoutGrid }
