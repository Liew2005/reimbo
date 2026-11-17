import { useEffect, useState } from 'react'

export type ThemePref = 'light' | 'dark' | 'system'

const resolve = (p: ThemePref): 'light' | 'dark' =>
  p === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : p

function applyTheme(p: ThemePref) {
  const t = resolve(p)
  const el = document.documentElement
  el.classList.add('theme-anim')
  el.dataset.theme = t
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0e130f' : '#f6f5f1')
  window.setTimeout(() => el.classList.remove('theme-anim'), 300)
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => (localStorage.getItem('theme') as ThemePref) || 'system')

  useEffect(() => {
    applyTheme(pref)
    localStorage.setItem('theme', pref)
    if (pref !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  return [pref, setPref] as const
}
