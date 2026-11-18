/**
 * 弹层关闭后把焦点还给打开它的控件。
 * 中央观察 DOM，而不是要求每个 v-if 弹层各自保存触发器。
 */
export function installSheetFocusRestore(): () => void {
  let activeMasks = 0
  let trigger: HTMLElement | null = null

  const sync = (): void => {
    const count = document.querySelectorAll('.sheet-mask').length
    if (count > 0 && activeMasks === 0) {
      const focused = document.activeElement
      trigger =
        focused instanceof HTMLElement && !focused.closest('.sheet-mask')
          ? focused
          : null
    } else if (count === 0 && activeMasks > 0) {
      const target = trigger
      trigger = null
      if (target?.isConnected && target.getClientRects().length) {
        requestAnimationFrame(() => target.focus({ preventScroll: true }))
      }
    }
    activeMasks = count
  }

  const onKeydown = (event: KeyboardEvent): void => {
    const masks = document.querySelectorAll<HTMLElement>('.sheet-mask')
    const mask = masks[masks.length - 1]
    if (!mask) return
    if (event.key === 'Escape') {
      event.preventDefault()
      mask.click()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      mask.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => element.getClientRects().length > 0)
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (!mask.contains(active)) {
      event.preventDefault()
      first.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    } else if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    }
  }

  const observer = new MutationObserver(sync)
  observer.observe(document.body, { childList: true, subtree: true })
  document.addEventListener('keydown', onKeydown)
  sync()
  return () => {
    observer.disconnect()
    document.removeEventListener('keydown', onKeydown)
  }
}
