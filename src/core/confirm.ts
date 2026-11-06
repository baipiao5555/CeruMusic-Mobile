import { reactive } from 'vue'

export interface ConfirmOptions {
  title: string
  body?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

interface ConfirmState extends ConfirmOptions {
  open: boolean
  confirmText: string
  cancelText: string
  danger: boolean
}

export const confirmState = reactive<ConfirmState>({
  open: false,
  title: '',
  body: '',
  confirmText: '确定',
  cancelText: '取消',
  danger: false
})

let resolver: ((value: boolean) => void) | null = null

/** 统一的二次确认：返回 Promise<boolean>，替代 window.confirm 的原生弹窗。 */
export function confirmAction(options: ConfirmOptions | string): Promise<boolean> {
  const opts: ConfirmOptions = typeof options === 'string' ? { title: options } : options
  if (resolver) {
    resolver(false)
    resolver = null
  }
  confirmState.title = opts.title
  confirmState.body = opts.body ?? ''
  confirmState.confirmText = opts.confirmText ?? '确定'
  confirmState.cancelText = opts.cancelText ?? '取消'
  confirmState.danger = opts.danger ?? false
  confirmState.open = true
  return new Promise<boolean>((resolve) => {
    resolver = resolve
  })
}

export function settleConfirm(value: boolean): void {
  confirmState.open = false
  const done = resolver
  resolver = null
  done?.(value)
}
