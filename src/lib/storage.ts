import { parseProject, readProject, type MigrationNotice } from './project'
import type { Project } from '../model/types'

const DB_NAME = 'wifiplan'
const STORE = 'projects'
const LAST_KEY = 'wifiplan:last'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function saveProject(project: Project): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).put(project, project.id)
  await done(tx)
  db.close()
  localStorage.setItem(LAST_KEY, project.id)
}

export async function loadProject(id: string): Promise<{ project: Project | null; notices: MigrationNotice[] }> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readonly')
  const request = tx.objectStore(STORE).get(id)
  const value = await new Promise<unknown>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return readProject(value)
}

export async function loadLastProject(): Promise<{ project: Project | null; notices: MigrationNotice[] }> {
  const id = localStorage.getItem(LAST_KEY)
  if (!id) return { project: null, notices: [] }
  return loadProject(id)
}

export interface ProjectMeta {
  id: string
  name: string
  updatedAt: number
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readonly')
  const request = tx.objectStore(STORE).getAll()
  const values = await new Promise<unknown[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as unknown[])
    request.onerror = () => reject(request.error)
  })
  db.close()
  return values
    .map((value) => parseProject(value))
    .filter((project): project is Project => project !== null)
    .map((project) => ({ id: project.id, name: project.name, updatedAt: project.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).delete(id)
  await done(tx)
  db.close()
  if (localStorage.getItem(LAST_KEY) === id) localStorage.removeItem(LAST_KEY)
}
