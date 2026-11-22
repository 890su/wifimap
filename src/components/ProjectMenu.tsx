import { useEffect, useRef, useState } from 'react'
import { deleteProject, listProjects, loadProject, type ProjectMeta } from '../lib/storage'
import { useEditor, useT } from '../store/editor'

export function ProjectMenu({
  onUpload,
  onCamera,
  onOpenJson,
  onSaveJson,
  onExportPng,
  onShare,
}: {
  onUpload: () => void
  onCamera: () => void
  onOpenJson: () => void
  onSaveJson: () => void
  onExportPng: () => void
  onShare: () => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState<ProjectMeta[]>([])
  const root = useRef<HTMLDivElement>(null)
  const newProject = useEditor((state) => state.newProject)
  const replaceProject = useEditor((state) => state.replaceProject)

  useEffect(() => {
    if (!open) return
    void listProjects().then(setSaved).catch(() => setSaved([]))
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  const run = (action: () => void) => {
    setOpen(false)
    action()
  }

  return (
    <div className="menu" ref={root}>
      <button type="button" className="btn btn-primary" aria-haspopup="menu" aria-expanded={open} aria-label={t('a11y.menu')} onClick={() => setOpen((value) => !value)}>
        {t('project.menu')}
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <button type="button" onClick={() => run(() => newProject(t('default.name')))}>{t('project.new')}</button>
          <button type="button" onClick={() => run(onUpload)}>{t('project.upload')}</button>
          <button type="button" className="mobile-only" onClick={() => run(onCamera)}>{t('project.camera')}</button>
          <button type="button" onClick={() => run(onOpenJson)}>{t('project.openJson')}</button>
          <button type="button" onClick={() => run(onSaveJson)}>{t('project.saveJson')}</button>
          <button type="button" onClick={() => run(onExportPng)}>{t('project.exportPng')}</button>
          <button type="button" onClick={() => run(onShare)}>{t('project.share')}</button>
          <p className="menu-label">{t('project.saved')}</p>
          {saved.length === 0 && <p className="menu-empty">{t('project.emptySaved')}</p>}
          {saved.slice(0, 8).map((item) => (
            <div key={item.id} className="menu-row">
              <button
                type="button"
                onClick={() =>
                  run(() => {
                    void loadProject(item.id).then((project) => {
                      if (project) replaceProject(project)
                    })
                  })
                }
              >
                {item.name}
              </button>
              <button
                type="button"
                className="menu-x"
                aria-label={t('project.delete')}
                onClick={() => {
                  void deleteProject(item.id).then(() => setSaved((list) => list.filter((entry) => entry.id !== item.id)))
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
