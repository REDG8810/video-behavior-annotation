import type { AnnotationEvent, ProjectFile } from './types'

function cell(value: string | number | null): string {
  if (value === null) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function toCsv(file: ProjectFile): string {
  const { project, video, conditions } = file
  const participants = new Map(project.participants.map((item) => [item.id, item.name]))
  const categories = new Map(project.categories.map((item) => [item.id, item.name]))
  const tags = new Map(project.tags.map((item) => [item.id, item.name]))
  const condition = conditions.find((item) => item.id === project.conditionId)?.name ?? ''
  const header = ['video', 'condition', 'participant', 'category', 'tag', 'type', 'start', 'stop', 'duration']
  const rows = project.events.slice().sort((a, b) => a.start - b.start).map((event) => [
    video.fileName,
    condition,
    participants.get(event.participantId) ?? '[不明]',
    categories.get(event.categoryId) ?? '[不明]',
    tags.get(event.tagId) ?? '[不明]',
    event.type,
    event.start.toFixed(3),
    event.stop === null ? null : event.stop.toFixed(3),
    event.stop === null ? null : (event.stop - event.start).toFixed(3),
  ])
  return `\uFEFF${[header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`
}

function parseRows(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]
    if (character === '"' && quoted && next === '"') { value += '"'; index += 1; continue }
    if (character === '"') { quoted = !quoted; continue }
    if (character === ',' && !quoted) { row.push(value); value = ''; continue }
    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1
      row.push(value); value = ''
      if (row.some((cellValue) => cellValue.length > 0)) rows.push(row)
      row = []
      continue
    }
    value += character
  }
  if (value.length > 0 || row.length > 0) { row.push(value); rows.push(row) }
  return rows
}

export function fromCsv(base: ProjectFile, text: string): ProjectFile {
  const rows = parseRows(text)
  if (rows.length < 2) throw new Error('CSVにイベント行がありません')
  const header = rows[0].map((item) => item.trim().toLowerCase())
  const required = ['video', 'condition', 'participant', 'category', 'tag', 'type', 'start', 'stop', 'duration']
  const indexes = new Map(required.map((name) => [name, header.indexOf(name)]))
  const missing = required.filter((name) => indexes.get(name) === -1)
  if (missing.length > 0) throw new Error(`CSV列が不足しています: ${missing.join(', ')}`)
  const valueAt = (row: string[], name: string): string => row[indexes.get(name) ?? -1]?.trim() ?? ''
  const file = structuredClone(base)
  const conditionName = valueAt(rows[1], 'condition')
  let condition = file.conditions.find((item) => item.name === conditionName)
  if (!condition) {
    condition = { id: crypto.randomUUID(), name: conditionName || '未設定' }
    file.conditions.push(condition)
  }
  file.project.conditionId = condition.id
  const participants = new Map(file.project.participants.map((item) => [item.name, item.id]))
  const categories = new Map(file.project.categories.map((item) => [item.name, item.id]))
  const tags = new Map(file.project.tags.map((item) => [item.name, item]))
  const events: AnnotationEvent[] = []
  rows.slice(1).forEach((row, rowIndex) => {
    const line = rowIndex + 2
    const participantId = participants.get(valueAt(row, 'participant'))
    const categoryId = categories.get(valueAt(row, 'category'))
    const tag = tags.get(valueAt(row, 'tag'))
    const type = valueAt(row, 'type') as AnnotationEvent['type']
    const start = Number(valueAt(row, 'start'))
    const stopValue = valueAt(row, 'stop')
    const durationValue = Number(valueAt(row, 'duration'))
    if (!participantId) throw new Error(`CSV ${line}行目: Participantが見つかりません`)
    if (!categoryId) throw new Error(`CSV ${line}行目: Categoryが見つかりません`)
    if (!tag) throw new Error(`CSV ${line}行目: Tagが見つかりません`)
    if (tag.categoryId !== categoryId) throw new Error(`CSV ${line}行目: CategoryとTagが一致しません`)
    if (type !== 'Point' && type !== 'State') throw new Error(`CSV ${line}行目: Typeが不正です`)
    if (!Number.isFinite(start) || start < 0) throw new Error(`CSV ${line}行目: Startが不正です`)
    let stop: number | null = null
    if (type === 'State') {
      const stateStop = stopValue ? Number(stopValue) : start + durationValue
      if (!Number.isFinite(stateStop) || stateStop <= start) throw new Error(`CSV ${line}行目: Stateの時間範囲が不正です`)
      stop = stateStop
    }
    events.push({ id: crypto.randomUUID(), videoId: file.project.videoId, participantId, categoryId, tagId: tag.id, type, start, stop, createdAt: new Date().toISOString() })
  })
  file.project.events = events
  return file
}
