import React, { createContext, useContext, useState, useCallback } from 'react'

type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: number
  message: string
  type: ToastType
}

interface ToastCtx {
  toast: (message: string, type?: ToastType) => void
}

const Ctx = createContext<ToastCtx>({ toast: () => {} })

let _id = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++_id
    setToasts((prev) => [...prev, { id, message, type }])
    // Errors stay longer (6s), others auto-dismiss at 3s
    const duration = type === 'error' ? 6000 : 3000
    setTimeout(() => dismiss(id), duration)
  }, [dismiss])

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="toast-container" role="region" aria-live="polite" aria-label="알림">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`} role="alert">
            <span style={{ flex: 1 }}>{t.message}</span>
            <button className="toast-dismiss" onClick={() => dismiss(t.id)} aria-label="닫기">×</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  return useContext(Ctx)
}
