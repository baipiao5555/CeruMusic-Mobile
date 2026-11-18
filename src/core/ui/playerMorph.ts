import { ref } from 'vue'

interface MorphSource {
  rect: DOMRect
  src: string
  direction: 'expand' | 'collapse'
}

let pending: MorphSource | null = null
let overlay: HTMLImageElement | null = null
let hiddenTarget: HTMLElement | null = null
let hiddenStyle: { opacity: string; pointerEvents: string } | null = null
let animation: Animation | null = null
let staleTimer: ReturnType<typeof setTimeout> | undefined

/** 只有用户点了迷你播放器封面、且系统允许动效时才走连续展开。 */
export const playerMorphActive = ref(false)

export function startPlayerMorph(
  rect: DOMRect,
  src: string,
  direction: 'expand' | 'collapse' = 'expand'
): boolean {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false
  if (rect.width < 8 || rect.height < 8 || !src) return false
  cancelPlayerMorph()
  pending = { rect, src, direction }
  playerMorphActive.value = true
  staleTimer = setTimeout(() => {
    if (playerMorphActive.value) cancelPlayerMorph()
  }, 1500)
  return true
}

export function isCollapseMorphPending(): boolean {
  return pending?.direction === 'collapse'
}

export function cancelPlayerMorph(): void {
  if (staleTimer) clearTimeout(staleTimer)
  staleTimer = undefined
  pending = null
  animation?.cancel()
  animation = null
  overlay?.remove()
  overlay = null
  if (hiddenTarget && hiddenStyle) {
    hiddenTarget.style.opacity = hiddenStyle.opacity
    hiddenTarget.style.pointerEvents = hiddenStyle.pointerEvents
  }
  hiddenTarget = null
  hiddenStyle = null
  playerMorphActive.value = false
}

export async function playPlayerMorph(target: HTMLElement): Promise<void> {
  const source = pending
  if (!source) return
  if (staleTimer) clearTimeout(staleTimer)
  staleTimer = undefined
  pending = null

  const targetRect = target.getBoundingClientRect()
  if (targetRect.width < 8 || targetRect.height < 8) {
    playerMorphActive.value = false
    return
  }

  hiddenTarget = target
  hiddenStyle = {
    opacity: target.style.opacity,
    pointerEvents: target.style.pointerEvents
  }
  target.style.opacity = '0'
  target.style.pointerEvents = 'none'

  const image = document.createElement('img')
  image.src = source.src
  image.alt = ''
  image.className = 'player-morph-clone'
  image.setAttribute('aria-hidden', 'true')
  Object.assign(image.style, {
    position: 'fixed',
    left: `${source.rect.left}px`,
    top: `${source.rect.top}px`,
    width: `${source.rect.width}px`,
    height: `${source.rect.height}px`,
    borderRadius: '50%',
    objectFit: 'cover',
    boxShadow: '0 12px 30px rgba(0, 0, 0, 0.28)',
    pointerEvents: 'none',
    zIndex: '9999',
    transformOrigin: 'top left',
    willChange: 'transform'
  })
  document.body.appendChild(image)
  overlay = image

  try {
    await image.decode()
  } catch {
    // Cached mini artwork normally decodes immediately; keep the morph usable if it does not.
  }
  if (overlay !== image) return

  const scaleX = targetRect.width / source.rect.width
  const scaleY = targetRect.height / source.rect.height
  const translateX = targetRect.left - source.rect.left
  const translateY = targetRect.top - source.rect.top
  animation = image.animate(
    [
      { transform: 'translate3d(0, 0, 0) scale(1, 1)' },
      {
        transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${scaleX}, ${scaleY})`
      }
    ],
    {
      duration: 360,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      fill: 'forwards'
    }
  )

  try {
    await animation.finished
  } catch {
    if (!overlay) return
  }
  animation = null
  overlay?.remove()
  overlay = null
  if (hiddenTarget && hiddenStyle) {
    hiddenTarget.style.opacity = hiddenStyle.opacity
    hiddenTarget.style.pointerEvents = hiddenStyle.pointerEvents
  }
  hiddenTarget = null
  hiddenStyle = null
  playerMorphActive.value = false
}
