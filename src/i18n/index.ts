import { en } from './en'
import { ru, type MessageKey } from './ru'

export type Lang = 'ru' | 'en'
export type { MessageKey }

const dictionaries: Record<Lang, Record<MessageKey, string>> = { ru, en }

export function translate(lang: Lang, key: MessageKey): string {
  return dictionaries[lang][key] ?? ru[key]
}

export function qualityKey(score: number): MessageKey {
  if (score >= 85) return 'q.great'
  if (score >= 70) return 'q.good'
  if (score >= 50) return 'q.ok'
  if (score >= 30) return 'q.poor'
  return 'q.bad'
}
