import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, CircleAlert, Info, X } from 'lucide-react'

type ToastTone = 'success' | 'info' | 'warning' | 'error'
type ConfirmTone = 'info' | 'warning' | 'danger'

interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmTone
}

interface ConfirmState extends Required<ConfirmOptions> {}

interface ToastContextValue {
  notify: (message: string, tone?: ToastTone) => void
  confirm: (options: string | ConfirmOptions) => Promise<boolean>
}

const ToastContext = createContext<ToastContextValue | null>(null)

function resolvedToastTone(message: string, tone: ToastTone): ToastTone {
  if (tone !== 'info') return tone
  if (/(失败|错误|异常|无效|拒绝|超时|无法|不存在|内部错误|HTTP\s*\d+|network|fetch failed)/i.test(message)) return 'error'
  if (/(尚未|未配置|已暂停|已下线|已撤回|请先|注意)/i.test(message)) return 'warning'
  return tone
}

function ToastIcon({ tone }: { tone: ToastTone }) {
  if (tone === 'success') return <CheckCircle2 />
  if (tone === 'error') return <CircleAlert />
  if (tone === 'warning') return <AlertTriangle />
  return <Info />
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [dialog, setDialog] = useState<ConfirmState | null>(null)
  const dialogResolver = useRef<((result: boolean) => void) | null>(null)
  const cancelButton = useRef<HTMLButtonElement | null>(null)
  const nextToastId = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const notify = useCallback(
    (message: string, tone: ToastTone = 'success') => {
      const id = ++nextToastId.current
      const finalTone = resolvedToastTone(message, tone)
      setToasts((current) => current.some((toast) => toast.message === message) ? current : [...current, { id, message, tone: finalTone }])
      window.setTimeout(() => dismiss(id), finalTone === 'error' ? 5200 : 3600)
    },
    [dismiss],
  )

  const closeDialog = useCallback((result: boolean) => {
    const resolve = dialogResolver.current
    dialogResolver.current = null
    setDialog(null)
    resolve?.(result)
  }, [])

  const confirm = useCallback((options: string | ConfirmOptions) => {
    dialogResolver.current?.(false)
    const normalized = typeof options === 'string' ? { message: options } : options
    setDialog({
      title: normalized.title || '请确认操作',
      message: normalized.message,
      confirmLabel: normalized.confirmLabel || '确认',
      cancelLabel: normalized.cancelLabel || '取消',
      tone: normalized.tone || 'warning',
    })
    return new Promise<boolean>((resolve) => {
      dialogResolver.current = resolve
    })
  }, [])

  useEffect(() => {
    if (!dialog) return
    document.body.classList.add('modal-open')
    const frame = window.requestAnimationFrame(() => cancelButton.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDialog(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKeyDown)
      document.body.classList.remove('modal-open')
    }
  }, [dialog, closeDialog])

  useEffect(() => () => dialogResolver.current?.(false), [])

  const value = useMemo(() => ({ notify, confirm }), [notify, confirm])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div className="toast" data-tone={toast.tone} key={toast.id} role={toast.tone === 'error' ? 'alert' : 'status'}>
            <span className="toast__icon"><ToastIcon tone={toast.tone} /></span>
            <span className="toast__message">{toast.message}</span>
            <button type="button" onClick={() => dismiss(toast.id)} aria-label="关闭提示">
              <X />
            </button>
          </div>
        ))}
      </div>
      {dialog ? (
        <div className="feedback-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(false) }}>
          <section className="feedback-dialog" data-tone={dialog.tone} role="alertdialog" aria-modal="true" aria-labelledby="feedback-dialog-title" aria-describedby="feedback-dialog-message">
            <button className="feedback-dialog__close" type="button" onClick={() => closeDialog(false)} aria-label="关闭确认窗口"><X /></button>
            <span className="feedback-dialog__icon" aria-hidden="true">{dialog.tone === 'danger' ? <CircleAlert /> : dialog.tone === 'warning' ? <AlertTriangle /> : <Info />}</span>
            <div className="feedback-dialog__copy">
              <span className="overline">Action confirmation</span>
              <h2 id="feedback-dialog-title">{dialog.title}</h2>
              <p id="feedback-dialog-message">{dialog.message}</p>
            </div>
            <div className="feedback-dialog__actions">
              <button ref={cancelButton} className="button button--secondary" type="button" onClick={() => closeDialog(false)}>{dialog.cancelLabel}</button>
              <button className="button feedback-dialog__confirm" type="button" onClick={() => closeDialog(true)}>{dialog.confirmLabel}</button>
            </div>
          </section>
        </div>
      ) : null}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast must be used inside ToastProvider')
  return value
}
