import React from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  size?: 'default' | 'lg'
  className?: string
}

export function Modal({ title, onClose, children, footer, size = 'default', className = '' }: ModalProps) {
  if (typeof document === 'undefined') return null
  const overlayClassName = className.includes('report-history-modal') ? 'modal-overlay modal-overlay-top' : 'modal-overlay'

  return createPortal(
    <div className={overlayClassName} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size === 'lg' ? 'modal-lg' : ''} ${className}`.trim()}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="btn-icon" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
