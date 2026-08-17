import { describe, expect, it } from 'vitest'
import { createProjectFile } from './defaults'
import { fromCsv, toCsv } from './csv'
import { parseProjectFile, validateProjectFile } from './validation'

function readyFile() {
  const file = createProjectFile()
  file.video = { id: 'video-1', filePath: '/tmp/meeting.MOV', fileName: 'meeting.MOV', duration: 300, width: 1920, height: 1080, fps: 59.94 }
  file.project.videoId = file.video.id
  file.project.events.push({
    id: 'event-1', videoId: file.video.id, participantId: 'participant-a', categoryId: 'category-speech', tagId: 'tag-speech', type: 'State', start: 10.5, stop: 20.75, createdAt: '2026-01-01T00:00:00.000Z',
  })
  return file
}

describe('project domain', () => {
  it('round-trips the versioned project file', () => {
    const file = readyFile()
    expect(parseProjectFile(JSON.stringify(file))).toEqual(file)
    expect(validateProjectFile(file)).toEqual([])
  })

  it('rejects a Point event with a stop timestamp', () => {
    const file = readyFile()
    file.project.events[0].type = 'Point'
    file.project.events[0].stop = 20
    expect(validateProjectFile(file)).toContain('TagとEventの整合性がありません: event-1')
    expect(validateProjectFile(file)).toContain('Point Eventのstopはnullである必要があります: event-1')
  })

  it('exports condition and duration using display names', () => {
    const csv = toCsv(readyFile())
    expect(csv.startsWith('\uFEFFvideo,condition')).toBe(true)
    expect(csv).toContain('meeting.MOV,スーツ,A,発話,発話,State,10.500,20.750,10.250')
  })

  it('restores editable events from exported CSV', () => {
    const source = readyFile()
    const restored = fromCsv(source, toCsv(source))
    expect(restored.project.events).toHaveLength(1)
    expect(restored.project.events[0].participantId).toBe('participant-a')
    expect(restored.project.events[0].start).toBe(10.5)
    expect(restored.project.events[0].stop).toBe(20.75)
  })
})
