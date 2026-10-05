// Phone action bar pinned to the bottom of the screen, within thumb reach.
// Rules (docs/DESIGN_SYSTEM.md §7 "Sticky action bar"):
//  - render it as a direct child of an UNtransformed page wrapper (a transform
//    on any ancestor breaks sticky positioning);
//  - place it right after the content it acts on, so it's in the right reading
//    and focus order — it pins while that content is on screen, then settles;
//  - from `hideFrom` up it disappears and the page's inline action takes over.
const HIDE_FROM = { md: 'md:hidden', lg: 'lg:hidden' }

export default function StickyActionBar({ hideFrom = 'md', className = '', children }) {
  return (
    <div
      className={`${HIDE_FROM[hideFrom]} sticky bottom-0 z-30 px-4 pt-3 pb-4 bg-background/95 backdrop-blur-md
                  border-t border-border ${className}`}
    >
      {children}
    </div>
  )
}
