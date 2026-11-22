import { useMemo, useState } from 'react'
import { useMedia } from '../hooks/useMedia'
import { fmtMbps, fmtMs, fmtNum } from '../lib/format'
import { qualityKey, type MessageKey } from '../i18n'
import { MATERIALS } from '../model/materials'
import { AP_PRESET_IDS, AP_PRESETS, CLIENT_PRESET_IDS, CLIENT_PRESETS } from '../model/presets'
import { ACTIVITY_IDS, effectiveScale, estimateClients } from '../model'
import type { AccessPoint, Backhaul, WifiGen } from '../model/types'
import { useEditor, useT } from '../store/editor'
import { BandToggle, ModeToggle } from './Toggles'
import { Button } from './ui/button'

const BACKHAULS: Backhaul[] = ['wired', 'repeater', 'mesh-wireless', 'mesh-wired']
const GENS: WifiGen[] = ['wifi4', 'wifi5', 'wifi6']

function matKey(id: string): MessageKey {
  return `mat.${id}` as MessageKey
}

export function SidePanel() {
  const t = useT()
  const mobile = useMedia('(max-width: 900px)')
  const [open, setOpen] = useState(false)
  const project = useEditor((state) => state.project)
  const selection = useEditor((state) => state.selection)
  const mode = useEditor((state) => state.mode)
  const materialId = useEditor((state) => state.materialId)
  const setMaterial = useEditor((state) => state.setMaterial)
  const status = useEditor((state) => state.heatmapStatus)
  const coverage = useEditor((state) => state.coverage67)
  const renderer = useEditor((state) => state.renderer)
  const opacity = useEditor((state) => state.heatmapOpacity)
  const setOpacity = useEditor((state) => state.setOpacity)
  const updateWall = useEditor((state) => state.updateWall)
  const updateClient = useEditor((state) => state.updateClient)
  const setIsp = useEditor((state) => state.setIsp)
  const setPropagation = useEditor((state) => state.setPropagation)
  const deleteSelection = useEditor((state) => state.deleteSelection)
  const pushHistory = useEditor((state) => state.pushHistory)
  const setClientPreset = useEditor((state) => state.setClientPreset)

  const { metersPerPixel, approximate } = effectiveScale(project.scale)
  const estimates = useMemo(
    () => estimateClients(project, metersPerPixel, approximate),
    [project, metersPerPixel, approximate],
  )
  const selectedClient = project.clients.find((client) => selection?.type === 'client' && selection.id === client.id) ?? project.clients[0]
  const estimate = estimates.find((item) => item.clientId === selectedClient?.id)
  const wall = project.walls.find((item) => selection?.type === 'wall' && selection.id === item.id)
  const ap = project.aps.find((item) => selection?.type === 'ap' && selection.id === item.id)
  const client = project.clients.find((item) => selection?.type === 'client' && selection.id === item.id)
  const collapsed = mobile && !open

  return (
    <aside className={collapsed ? 'side collapsed' : 'side'}>
      <span className="sr-only" data-testid="heatmap-status">{status}</span>
      {mobile && (
        <button type="button" className="peek" onClick={() => setOpen((value) => !value)}>
          <span>{selectedClient?.name ?? t('results.title')}</span>
          {estimate && (
            <strong>
              <span data-testid="result-down">{fmtMbps(estimate.downMbps)}</span> {t('results.mbps')}
            </strong>
          )}
          <span className="peek-caret">{open ? t('results.less') : t('results.more')}</span>
        </button>
      )}
      <div className="side-body">
        {mobile && (
          <div className="side-toggles">
            <BandToggle />
            <ModeToggle />
          </div>
        )}
        <section>
          <h2>{t('isp.title')}</h2>
          <div className="split">
            <label>
              {t('isp.down')}
              <input
                className="field"
                type="number"
                min={0}
                value={project.isp.downMbps}
                onFocus={() => pushHistory()}
                onChange={(event) => setIsp({ downMbps: Math.max(0, Number(event.target.value) || 0) }, false)}
              />
            </label>
            <label>
              {t('isp.up')}
              <input
                className="field"
                type="number"
                min={0}
                value={project.isp.upMbps}
                onFocus={() => pushHistory()}
                onChange={(event) => setIsp({ upMbps: Math.max(0, Number(event.target.value) || 0) }, false)}
              />
            </label>
          </div>
          <p className="field-note">{t('isp.note')}</p>
        </section>

        <section>
          <h2>{t('heat.title')}</h2>
          <div className="legend" aria-hidden="true">
            <span>{t('heat.weak')}</span>
            <i />
            <span>{t('heat.strong')}</span>
          </div>
          <p className="coverage">
            {t('heat.coverage')}: <strong>{coverage === null ? '—' : `${Math.round(coverage * 100)}%`}</strong>
          </p>
          <label className="slider">
            {t('heat.opacity')}
            <input type="range" min={0.2} max={0.85} step={0.01} value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} />
          </label>
          {status === 'computing' && <p className="field-note">{t('heat.computing')}</p>}
          {status === 'idle' && <p className="field-note">{t('heat.idle')}</p>}
          {status === 'error' && <p className="field-note warn">{t('heat.error')}</p>}
          <p className="field-note">{t('heat.note')}</p>
          {mode === 'advanced' && (
            <>
              <label className="slider">
                {t('heat.exponent')} · {project.propagation.exponent.toFixed(1)}
                <input
                  type="range"
                  min={2}
                  max={4}
                  step={0.1}
                  value={project.propagation.exponent}
                  onChange={(event) => setPropagation({ exponent: Number(event.target.value) }, false)}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={project.propagation.autoClutter}
                  onChange={(event) => setPropagation({ autoClutter: event.target.checked }, true)}
                />
                {t('heat.auto')}
              </label>
              {renderer && <p className="field-note">{renderer === 'webgl2' ? t('heat.renderer.webgl2') : t('heat.renderer.canvas2d')}</p>}
            </>
          )}
        </section>

        <section data-testid="client-results">
          <h2>{t('results.title')}</h2>
          {project.clients.length === 0 && <p className="field-note">{t('results.empty')}</p>}
          {project.clients.length > 0 && project.aps.length === 0 && <p className="field-note">{t('results.noAp')}</p>}
          {project.clients.length > 1 && (
            <div className="client-switch">
              {project.clients.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === selectedClient?.id ? 'on' : ''}
                  onClick={() => useEditor.getState().select({ type: 'client', id: item.id })}
                >
                  {item.name}
                </button>
              ))}
            </div>
          )}
          {estimate && selectedClient && (
            <div className="result-card">
              <div className="result-head">
                <strong>{selectedClient.name}</strong>
                {!mobile && (
                  <span className="result-speed">
                    <span data-testid="result-down">{fmtMbps(estimate.downMbps)}</span> {t('results.mbps')}
                  </span>
                )}
              </div>
              <div className="metrics">
                <Metric label={t('results.down')} value={fmtMbps(estimate.downMbps)} unit={t('results.mbps')} />
                <Metric label={t('results.up')} value={fmtMbps(estimate.upMbps)} unit={t('results.mbps')} />
                <Metric label={t('results.ping')} value={fmtMs(estimate.pingMs)} unit={t('results.ms')} />
                <Metric label={t('results.jitter')} value={fmtMs(estimate.jitterMs)} unit={t('results.ms')} />
              </div>
              {estimate.apName && (
                <p className="field-note">
                  {t('results.via')} {estimate.apName}
                  {estimate.band ? ` · ${estimate.band === '5' ? t('band.5') : t('band.24')}` : ''}
                  {estimate.rssiDbm !== null ? ` · ${fmtNum(estimate.rssiDbm, 0)} ${t('unit.dbm')}` : ''}
                </p>
              )}
              {mode === 'advanced' && estimate.distanceM !== null && (
                <p className="field-note">
                  {t('results.distance')} {fmtNum(estimate.distanceM, 1)} {t('unit.m')}
                  {' · '}
                  {t('results.walls')} {fmtNum(estimate.wallLossDb, 0)} {t('unit.db')}
                  {' · '}
                  {t('results.phy')} {fmtMbps(estimate.phyMbps)} {t('results.mbps')}
                  {' · '}
                  {t('results.snr')} {fmtNum(estimate.snrDb, 0)} {t('unit.db')}
                </p>
              )}
              <div className="scores">
                {ACTIVITY_IDS.map((id) => {
                  const score = estimate.scores[id]
                  return (
                    <div key={id} className="score">
                      <span>{t(`act.${id}`)}</span>
                      <span className="score-track"><span style={{ width: `${score}%` }} /></span>
                      <em>{t(qualityKey(score))}</em>
                    </div>
                  )
                })}
              </div>
              {estimate.warnings.map((code) => (
                <p key={code} className="field-note warn">{t(`warn.${code}`)}</p>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2>{t('insp.title')}</h2>
          <label>
            {wall ? t('insp.materialOf') : t('insp.material')}
            <select
              className="field"
              value={wall?.materialId ?? materialId}
              onChange={(event) => {
                if (wall) updateWall(wall.id, { materialId: event.target.value })
                else setMaterial(event.target.value)
              }}
            >
              {MATERIALS.map((material) => (
                <option key={material.id} value={material.id}>
                  {t(matKey(material.id))}
                  {mode === 'advanced' ? ` · ${material.lossDb['2.4']}/${material.lossDb['5']} ${t('unit.db')}` : ''}
                </option>
              ))}
            </select>
          </label>
          {!wall && !ap && !client && <p className="field-note">{t('insp.none')}</p>}
          {ap && <ApFields ap={ap} advanced={mode === 'advanced'} />}
          {client && (
            <div className="stack">
              <label>
                {t('insp.name')}
                <input className="field" value={client.name} onChange={(event) => updateClient(client.id, { name: event.target.value }, false)} />
              </label>
              <label>
                {t('insp.preset')}
                <select
                  className="field"
                  value={client.preset}
                  onChange={(event) => {
                    const preset = event.target.value as typeof client.preset
                    const params = CLIENT_PRESETS[preset]
                    updateClient(client.id, { preset, ...params })
                    setClientPreset(preset)
                  }}
                >
                  {CLIENT_PRESET_IDS.map((id) => (
                    <option key={id} value={id}>{t(`preset.client.${id}`)}</option>
                  ))}
                </select>
              </label>
              {mode === 'advanced' && (
                <>
                  <label>
                    {t('insp.gen')}
                    <select className="field" value={client.wifiGen} onChange={(event) => updateClient(client.id, { wifiGen: event.target.value as WifiGen })}>
                      {GENS.map((gen) => (
                        <option key={gen} value={gen}>{t(`gen.${gen}`)}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t('insp.mimo')}
                    <input className="field" type="number" min={1} max={4} value={client.mimo} onChange={(event) => updateClient(client.id, { mimo: Number(event.target.value) }, false)} />
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={client.supports5} onChange={(event) => updateClient(client.id, { supports5: event.target.checked })} />
                    {t('insp.supports5')}
                  </label>
                </>
              )}
            </div>
          )}
          {(wall || ap || client) && (
            <Button variant="danger" onClick={deleteSelection}>{t('insp.delete')}</Button>
          )}
        </section>
      </div>
    </aside>
  )
}

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{unit}</small>
    </div>
  )
}

function ApFields({ ap, advanced }: { ap: AccessPoint; advanced: boolean }) {
  const t = useT()
  const updateAp = useEditor((state) => state.updateAp)
  const setApPreset = useEditor((state) => state.setApPreset)
  return (
    <div className="stack">
      <label>
        {t('insp.name')}
        <input className="field" value={ap.name} onChange={(event) => updateAp(ap.id, { name: event.target.value }, false)} />
      </label>
      <label>
        {t('insp.preset')}
        <select
          className="field"
          value={ap.preset}
          onChange={(event) => {
            const preset = event.target.value as AccessPoint['preset']
            const params = AP_PRESETS[preset]
            updateAp(ap.id, {
              preset,
              wifiGen: params.wifiGen,
              mimo: params.mimo,
              backhaul: params.backhaul,
              band24: { ...params.band24 },
              band5: { ...params.band5 },
            })
            setApPreset(preset)
          }}
        >
          {AP_PRESET_IDS.map((id) => (
            <option key={id} value={id}>{t(`preset.ap.${id}`)}</option>
          ))}
        </select>
      </label>
      <label>
        {t('insp.backhaul')}
        <select className="field" value={ap.backhaul} onChange={(event) => updateAp(ap.id, { backhaul: event.target.value as Backhaul })}>
          {BACKHAULS.map((id) => (
            <option key={id} value={id}>{t(`backhaul.${id}`)}</option>
          ))}
        </select>
      </label>
      {advanced && (
        <>
          <label>
            {t('insp.gen')}
            <select className="field" value={ap.wifiGen} onChange={(event) => updateAp(ap.id, { wifiGen: event.target.value as WifiGen })}>
              {GENS.map((gen) => (
                <option key={gen} value={gen}>{t(`gen.${gen}`)}</option>
              ))}
            </select>
          </label>
          <label>
            {t('insp.mimo')}
            <input className="field" type="number" min={1} max={4} value={ap.mimo} onFocus={() => useEditor.getState().pushHistory()} onChange={(event) => updateAp(ap.id, { mimo: Number(event.target.value) }, false)} />
          </label>
          <RadioFields ap={ap} band="band24" title={t('band.24')} widths={[20, 40]} />
          <RadioFields ap={ap} band="band5" title={t('band.5')} widths={[20, 40, 80, 160]} />
        </>
      )}
    </div>
  )
}

function RadioFields({ ap, band, title, widths }: { ap: AccessPoint; band: 'band24' | 'band5'; title: string; widths: number[] }) {
  const t = useT()
  const updateAp = useEditor((state) => state.updateAp)
  const radio = ap[band]
  const patch = (next: Partial<AccessPoint['band24']>, history = true) => updateAp(ap.id, { [band]: { ...radio, ...next } }, history)
  return (
    <fieldset className="radio-box">
      <legend>{title}</legend>
      <label className="check">
        <input type="checkbox" checked={radio.enabled} onChange={(event) => patch({ enabled: event.target.checked })} />
        {t('insp.bandOn')}
      </label>
      <label>
        {t('insp.tx')}
        <input className="field" type="number" value={radio.txPowerDbm} onFocus={() => useEditor.getState().pushHistory()} onChange={(event) => patch({ txPowerDbm: Number(event.target.value) }, false)} />
      </label>
      <label>
        {t('insp.gain')}
        <input className="field" type="number" value={radio.gainDbi} onFocus={() => useEditor.getState().pushHistory()} onChange={(event) => patch({ gainDbi: Number(event.target.value) }, false)} />
      </label>
      <label>
        {t('insp.width')}
        <select className="field" value={radio.channelWidthMHz} onChange={(event) => patch({ channelWidthMHz: Number(event.target.value) })}>
          {widths.map((width) => (
            <option key={width} value={width}>{width}</option>
          ))}
        </select>
      </label>
    </fieldset>
  )
}
