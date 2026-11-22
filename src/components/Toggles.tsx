import { useEditor, useT } from '../store/editor'

export function BandToggle() {
  const band = useEditor((state) => state.band)
  const setBand = useEditor((state) => state.setBand)
  const t = useT()
  return (
    <div className="seg" role="group" aria-label={t('heat.title')}>
      <button type="button" data-testid="band-24" aria-pressed={band === '2.4'} className={band === '2.4' ? 'on' : ''} onClick={() => setBand('2.4')}>
        {t('band.24')}
      </button>
      <button type="button" data-testid="band-5" aria-pressed={band === '5'} className={band === '5' ? 'on' : ''} onClick={() => setBand('5')}>
        {t('band.5')}
      </button>
    </div>
  )
}

export function ModeToggle() {
  const mode = useEditor((state) => state.mode)
  const setMode = useEditor((state) => state.setMode)
  const t = useT()
  return (
    <div className="seg" role="group" data-testid="mode-toggle" aria-label={t('mode.advanced')}>
      <button type="button" aria-pressed={mode === 'simple'} className={mode === 'simple' ? 'on' : ''} onClick={() => setMode('simple')}>
        {t('mode.simple')}
      </button>
      <button type="button" aria-pressed={mode === 'advanced'} className={mode === 'advanced' ? 'on' : ''} onClick={() => setMode('advanced')}>
        {t('mode.advanced')}
      </button>
    </div>
  )
}
