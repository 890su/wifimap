import { Redo2, Undo2 } from 'lucide-react'
import { useMedia } from '../hooks/useMedia'
import { buildSampleProject } from '../lib/sampleProject'
import { useEditor, useT } from '../store/editor'
import { ProjectMenu } from './ProjectMenu'
import { BandToggle, ModeToggle } from './Toggles'

export function Header({
  embed,
  onUpload,
  onCamera,
  onOpenJson,
  onSaveJson,
  onSaveJsonBare,
  onExportPng,
  onShare,
}: {
  embed: boolean
  onUpload: () => void
  onCamera: () => void
  onOpenJson: () => void
  onSaveJson: () => void
  onSaveJsonBare: () => void
  onExportPng: () => void
  onShare: () => void
}) {
  const t = useT()
  const mobile = useMedia('(max-width: 900px)')
  const name = useEditor((state) => state.project.name)
  const rename = useEditor((state) => state.rename)
  const undo = useEditor((state) => state.undo)
  const redo = useEditor((state) => state.redo)
  const past = useEditor((state) => state.past.length)
  const future = useEditor((state) => state.future.length)
  const lang = useEditor((state) => state.lang)
  const setLang = useEditor((state) => state.setLang)
  const replaceProject = useEditor((state) => state.replaceProject)

  return (
    <header className="header">
      <div className="brand">
        <span className="mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="28" height="28">
            <rect width="32" height="32" rx="8" fill="#1c1915" />
            <path d="M8 20c2.2-2.4 4.6-3.6 8-3.6S21.8 17.6 24 20" fill="none" stroke="#f0b429" strokeWidth="2" strokeLinecap="round" />
            <path d="M11 16.2c1.6-1.6 3.2-2.4 5-2.4s3.4.8 5 2.4" fill="none" stroke="#f0b429" strokeWidth="2" strokeLinecap="round" />
            <circle cx="16" cy="22.5" r="1.6" fill="#3dbea5" />
          </svg>
        </span>
        {!embed && (
          <div className="brand-text desktop-only">
            <strong>{t('app.name')}</strong>
            <span>{t('app.tagline')}</span>
          </div>
        )}
      </div>
      <input className="name-input" value={name} aria-label={t('insp.name')} onChange={(event) => rename(event.target.value)} />
      {!mobile && <BandToggle />}
      {!mobile && <ModeToggle />}
      <div className="header-actions">
        {mobile && (
          <>
            <button type="button" className="icon-btn" disabled={past === 0} aria-label={t('tool.undo')} onClick={undo}>
              <Undo2 size={18} />
            </button>
            <button type="button" className="icon-btn" disabled={future === 0} aria-label={t('tool.redo')} onClick={redo}>
              <Redo2 size={18} />
            </button>
          </>
        )}
        <button type="button" className="btn btn-ghost desktop-only" onClick={() => replaceProject(buildSampleProject(t('project.sample')))}>
          {t('project.sample')}
        </button>
        <div className="seg lang desktop-only">
          <button type="button" className={lang === 'ru' ? 'on' : ''} onClick={() => setLang('ru')}>{t('lang.ru')}</button>
          <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>{t('lang.en')}</button>
        </div>
        {embed && (
          <button
            type="button"
            className="icon-btn"
            data-testid="embed-fullscreen"
            aria-label={t('embed.fullscreen')}
            title={t('embed.fullscreen')}
            onClick={() => {
              const url = new URL(window.location.href)
              url.searchParams.delete('embed')
              window.open(url.toString(), '_blank', 'noopener')
            }}
          >
            ⛶
          </button>
        )}
        <ProjectMenu
          onUpload={onUpload}
          onCamera={onCamera}
          onOpenJson={onOpenJson}
          onSaveJson={onSaveJson}
          onSaveJsonBare={onSaveJsonBare}
          onExportPng={onExportPng}
          onShare={onShare}
        />
      </div>
    </header>
  )
}
