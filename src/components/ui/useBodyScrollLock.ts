import { useEffect } from 'react'

// `showModal()` puts the dialog in the top layer and makes the rest of the
// document inert, but it does NOT stop the page behind from scrolling. That
// part stays manual — and it has to be reference counted, because stacked
// dialogs each acquire and release the same lock and the last release must
// restore whatever inline value the page had before the first acquire.

let lockCount = 0
let restoreOverflow = ''

function acquire(): void {
  if (lockCount === 0) {
    restoreOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  lockCount += 1
}

function release(): void {
  if (lockCount === 0) return
  lockCount -= 1
  if (lockCount === 0) document.body.style.overflow = restoreOverflow
}

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    acquire()
    return release
  }, [active])
}
