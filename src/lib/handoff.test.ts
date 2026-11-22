import { describe, expect, it } from 'vitest'
import { projectFromHash, projectToHash } from './handoff'
import { createEmptyProject } from './project'

describe('fullscreen project handoff', () => {
  it('round-trips a project through a gzip hash', async () => {
    const project = createEmptyProject('Перенос')
    project.walls.push({ id: 'w', points: [0, 0, 40, 0], materialId: 'brick' })
    const hash = await projectToHash(project)
    expect(hash?.startsWith('wifiplan=')).toBe(true)
    const read = await projectFromHash(`#${hash}`)
    expect(read?.project?.name).toBe('Перенос')
    expect(read?.project?.walls).toHaveLength(1)
  })
})
