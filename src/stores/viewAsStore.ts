import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Site-wide "View as" (impersonation) mode. When `viewAs` is set, read/display
 * surfaces show that address's data instead of the connected account's, and
 * the transaction review seams refuse every write.
 */

/** Shown whenever a write is refused because view-as mode is active. */
export const VIEW_AS_WRITE_REFUSAL =
  "You're viewing the site as another account — exit View as to transact."

interface ViewAsState {
  /** Address the site is being viewed as, or null when the mode is off. */
  viewAs: string | null

  setViewAs: (address: string) => void
  clearViewAs: () => void
}

export const useViewAsStore = create<ViewAsState>()(
  persist(
    (set) => ({
      viewAs: null,

      setViewAs: (address) => set({ viewAs: address }),

      clearViewAs: () => set({ viewAs: null }),
    }),
    {
      name: 'juicy-view-as-v1',
    }
  )
)
