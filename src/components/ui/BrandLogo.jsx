import { BRAND_IMAGES } from '../../hooks/useStorageImages'

// The club's real logo (the white "224 · CLUBHOUSE" mark from the letterhead).
// Use it wherever the brand is shown — never re-type "224" as a stand-in.
// Size it with a height class (e.g. h-16); width follows the image's ratio.
// `decorative` hides it from screen readers where nearby text already names
// the brand, or where it is only a no-photo placeholder.
export default function BrandLogo({ className = '', decorative = false }) {
  return (
    <img
      src={BRAND_IMAGES.logo}
      alt={decorative ? '' : '224 Clubhouse'}
      aria-hidden={decorative || undefined}
      draggable={false}
      className={`object-contain select-none ${className}`}
    />
  )
}
