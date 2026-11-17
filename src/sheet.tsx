import { useEffect, type ReactNode } from 'react'
import { Icon } from './ui'

/** Bottom sheet on phones; right-hand drawer on wide screens when `drawer` is set. */
export function Sheet({ title, onClose, drawer, children }: { title: string; onClose: () => void; drawer?: boolean; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    if (drawer) document.documentElement.classList.add('has-drawer')
    return () => {
      window.removeEventListener('keydown', onKey)
      if (drawer) document.documentElement.classList.remove('has-drawer')
    }
  }, [onClose, drawer])

  return (
    <div className={'modal' + (drawer ? ' drawer' : '')} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-label={title}>
        <div className="sheet-head">
          <h2 className="disp" style={{ fontSize: 22 }}>{title}</h2>
          <button className="icobtn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
