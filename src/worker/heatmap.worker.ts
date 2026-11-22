import { computeRssiGrid } from '../model/pathloss'
import type { HeatmapRequest } from '../model/types'

interface Job extends HeatmapRequest {
  id: number
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<Job>) => void) | null
  postMessage: (message: unknown, transfer: Transferable[]) => void
}

const scope = self as unknown as WorkerScope

scope.onmessage = (event: MessageEvent<Job>) => {
  const { id, ...request } = event.data
  const grid = computeRssiGrid(request)
  const rssi = grid.rssi.buffer
  scope.postMessage(
    {
      id,
      width: grid.width,
      height: grid.height,
      cellPx: grid.cellPx,
      originX: grid.originX,
      originY: grid.originY,
      rssi,
    },
    [rssi],
  )
}
