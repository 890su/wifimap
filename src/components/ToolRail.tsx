import type { ComponentType } from 'react'
import { Hand, MousePointer2, Pencil, Redo2, Router, Ruler, Smartphone, Square, Undo2 } from 'lucide-react'
import type { MessageKey } from '../i18n'
import type { Tool } from '../model/types'
import { useEditor, useT } from '../store/editor'

const TOOLS: { id: Tool; label: MessageKey; icon: ComponentType<{ size?: number }> }[] = [
  { id: 'select', label: 'tool.select', icon: MousePointer2 },
  { id: 'pan', label: 'tool.pan', icon: Hand },
  { id: 'scale', label: 'tool.scale', icon: Ruler },
  { id: 'wall', label: 'tool.wall', icon: WallIcon },
  { id: 'room', label: 'tool.room', icon: Square },
  { id: 'pencil', label: 'tool.pencil', icon: Pencil },
  { id: 'ap', label: 'tool.ap', icon: Router },
  { id: 'client', label: 'tool.client', icon: Smartphone },
]

function WallIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 18 L20 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" fill="none" />
    </svg>
  )
}

export function ToolRail() {
  const tool = useEditor((state) => state.tool)
  const setTool = useEditor((state) => state.setTool)
  const undo = useEditor((state) => state.undo)
  const redo = useEditor((state) => state.redo)
  const past = useEditor((state) => state.past.length)
  const future = useEditor((state) => state.future.length)
  const t = useT()
  return (
    <aside className="tools">
      <div className="tool-list">
        {TOOLS.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`tool-${item.id}`}
              className={tool === item.id ? 'tool on' : 'tool'}
              aria-pressed={tool === item.id}
              aria-label={t(item.label)}
              title={t(item.label)}
              onClick={() => setTool(item.id)}
            >
              <Icon size={18} />
              <span>{t(item.label)}</span>
            </button>
          )
        })}
      </div>
      <div className="tool-history desktop-only">
        <button type="button" className="tool" disabled={past === 0} aria-label={t('tool.undo')} onClick={undo}>
          <Undo2 size={18} />
        </button>
        <button type="button" className="tool" disabled={future === 0} aria-label={t('tool.redo')} onClick={redo}>
          <Redo2 size={18} />
        </button>
      </div>
      <p className="tool-hint desktop-only">{t(`hint.${tool}`)}</p>
    </aside>
  )
}
