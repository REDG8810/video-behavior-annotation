<script lang="ts">
  import { onMount } from 'svelte'
  import { createProjectFile, nextTagColor } from './lib/domain/defaults'
  import { fromCsv, toCsv } from './lib/domain/csv'
  import { formatDuration, formatTime } from './lib/domain/format'
  import { parseProjectFile, validateProjectFile } from './lib/domain/validation'
  import type { AnnotationEvent, Category, Condition, EventType, Participant, Project, ProjectFile, Tag, Video } from './lib/domain/types'
  import { appStore, eventKey, recordTag, replaceFile, setCurrentTime, setPendingState, setSaved, setSelectedEvent, setVideo, undo, redo, updateFile } from './lib/stores'

  let videoElement: HTMLVideoElement
  let timelineScroll: HTMLDivElement
  let timelineSvg: SVGSVGElement
  let videoSrc = ''
  let originalPath = ''
  let temporaryMediaPath = ''
  let browserObjectUrl = ''
  let isTranscoding = false
  let transcodeProgress = 0
  let notice = ''
  let activeParticipantId = ''
  let playing = false
  let playbackRate = 1
  let seekAmount = 5
  let lastTranscodeAttempt = ''
  let fallbackVideoInput: HTMLInputElement
  let fallbackCsvInput: HTMLInputElement
  let tagModal: { id?: string; name: string; categoryId: string; type: EventType; color: string } | null = null
  let expandedCategories: string[] = []
  type MasterKind = 'condition' | 'participant' | 'category'
  let masterModal: { kind: MasterKind; id?: string; name: string } | null = null
  let helpOpen = false
  let darkMode = false

  type TimelineRow = { participant: Participant; category: Category; tag?: Tag; key: string }
  function buildTimelineRows(currentProject: Project, participantFilter: string[], categoryFilter: string[], expanded: string[]): TimelineRow[] {
    return currentProject.participants.filter((participant) => participantFilter.includes(participant.id)).flatMap((participant) => currentProject.categories.filter((category) => categoryFilter.includes(category.id)).flatMap((category) => {
      const tags = currentProject.tags.filter((tag) => tag.categoryId === category.id)
      if (expanded.includes(category.id) && tags.length > 0) return tags.map((tag) => ({ participant, category, tag, key: `${participant.id}:${category.id}:${tag.id}` }))
      return [{ participant, category, key: `${participant.id}:${category.id}` }]
    }))
  }

  $: project = $appStore.file.project
  $: video = $appStore.file.video
  $: duration = video.duration || 600
  $: selectedEvent = project.events.find((item) => item.id === $appStore.selectedEventId) ?? null
  $: rows = buildTimelineRows(project, $appStore.participantFilter, $appStore.categoryFilter, expandedCategories)
  $: rowMap = new Map(rows.map((row, index) => [row.key, index]))
  $: visibleEvents = project.events.filter((event) => $appStore.participantFilter.includes(event.participantId) && $appStore.categoryFilter.includes(event.categoryId))
  $: pixelsPerSecond = 0.8 * $appStore.zoom
  $: timelineLabelWidth = 130
  $: timelineWidth = Math.max(920, timelineLabelWidth + duration * pixelsPerSecond)
  $: rowHeight = 42
  $: headerHeight = 36
  $: timelineHeight = Math.max(120, headerHeight + rows.length * rowHeight)
  $: tickStep = $appStore.zoom >= 6 ? 5 : $appStore.zoom >= 3 ? 10 : $appStore.zoom >= 1.5 ? 30 : duration > 1800 ? 300 : duration > 900 ? 120 : duration > 300 ? 60 : 30
  $: minorTickStep = tickStep >= 300 ? 60 : tickStep >= 120 ? 30 : tickStep >= 60 ? 10 : tickStep >= 30 ? 5 : 1

  type DragState = { id: string; mode: 'move' | 'start' | 'stop'; start: number; stop: number | null; offset: number; draftStart: number; draftStop: number | null }
  let drag: DragState | null = null

  onMount(() => {
    activeParticipantId = project.participants[0]?.id ?? ''
    darkMode = localStorage.getItem('annotation-desk-theme') === 'dark'
    if (!window.electronAPI) return
    const removeProgress = window.electronAPI.onTranscodeProgress((progress) => { transcodeProgress = progress })
    return () => { removeProgress(); if (temporaryMediaPath) void window.electronAPI.removeTempMedia(temporaryMediaPath) }
  })

  $: if ($appStore.autoFollow && timelineScroll && duration > 0) {
    const x = timelineLabelWidth + $appStore.currentTime * pixelsPerSecond
    if (x > timelineScroll.scrollLeft + timelineScroll.clientWidth * 0.8 || x < timelineScroll.scrollLeft + timelineScroll.clientWidth * 0.15) timelineScroll.scrollLeft = Math.max(0, x - timelineScroll.clientWidth * 0.35)
  }

  function notify(message: string): void {
    notice = message
    window.setTimeout(() => { if (notice === message) notice = '' }, 3500)
  }

  function projectName(): string {
    return ($appStore.file.project.name || 'project').replace(/[\\/:*?"<>|]/g, '_')
  }

  function downloadBrowserFile(filename: string, content: string, type: string): void {
    const url = URL.createObjectURL(new Blob([content], { type }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function toggleDarkMode(): void {
    darkMode = !darkMode
    localStorage.setItem('annotation-desk-theme', darkMode ? 'dark' : 'light')
  }

  function setPlaybackRate(rate: number): void {
    playbackRate = rate
    if (videoElement) videoElement.playbackRate = rate
  }

  function setSeekAmount(seconds: number): void {
    seekAmount = seconds
  }

  async function chooseVideo(): Promise<void> {
    if (project.events.length > 0 && !window.confirm('動画を変更すると現在のイベント参照先も変更されます。続けますか？')) return
    if (!window.electronAPI) { fallbackVideoInput?.click(); return }
    const selection = await window.electronAPI.chooseVideo()
    if (!selection) return
    originalPath = selection.filePath
    temporaryMediaPath = ''
    lastTranscodeAttempt = ''
    videoSrc = selection.url
    setCurrentTime(0)
    notify(`${selection.fileName} を読み込み中です`)
  }

  function handleFallbackVideo(event: Event): void {
    const file = (event.currentTarget as HTMLInputElement).files?.[0]
    if (!file) return
    if (browserObjectUrl) URL.revokeObjectURL(browserObjectUrl)
    browserObjectUrl = URL.createObjectURL(file)
    originalPath = file.name
    temporaryMediaPath = ''
    lastTranscodeAttempt = ''
    videoSrc = browserObjectUrl
    setCurrentTime(0)
    notify(`${file.name} を読み込み中です`)
    ;(event.currentTarget as HTMLInputElement).value = ''
  }

  async function loadProject(): Promise<void> {
    if (!window.electronAPI) { notify('プロジェクト操作はElectronアプリで実行してください'); return }
    const result = await window.electronAPI.openProject()
    if (!result) return
    try {
      const file = parseProjectFile(result.text)
      const errors = validateProjectFile(file)
      if (errors.length > 0) { notify(errors[0]); return }
      replaceFile(file)
      expandedCategories = []
      activeParticipantId = file.project.participants[0]?.id ?? ''
      const selection = await window.electronAPI.resolveVideo(file.video.filePath)
      if (selection) { originalPath = selection.filePath; videoSrc = selection.url; notify('プロジェクトと動画を読み込みました') }
      else notify('プロジェクトを読み込みました。動画ファイルが見つからないため再リンクしてください')
    } catch { notify('JSONの形式が正しくありません') }
  }

  async function saveProject(): Promise<void> {
    if (!window.electronAPI) { notify('プロジェクト保存はElectronアプリで実行してください'); return }
    if (!project.videoId) { notify('先に動画を読み込んでください'); return }
    const path = await window.electronAPI.saveProject(`${projectName()}.json`, JSON.stringify($appStore.file, null, 2))
    if (path) { setSaved(); notify('プロジェクトを保存しました') }
  }

  async function saveCsv(): Promise<void> {
    if (!project.videoId) { notify('先に動画を読み込んでください'); return }
    const content = toCsv($appStore.file)
    if (!window.electronAPI) {
      downloadBrowserFile(`${projectName()}.csv`, content, 'text/csv;charset=utf-8')
      notify('CSVをダウンロードしました')
      return
    }
    const path = await window.electronAPI.saveCsv(`${projectName()}.csv`, content)
    if (path) notify('CSVを保存しました')
  }

  async function loadCsv(): Promise<void> {
    if (!project.videoId) { notify('先に動画とプロジェクトを読み込んでください'); return }
    if (!window.electronAPI) { fallbackCsvInput?.click(); return }
    const result = await window.electronAPI.openCsv()
    if (!result) return
    try {
      const restored = fromCsv($appStore.file, result.text)
      replaceFile(restored)
      notify('CSVから進捗を復元しました。イベントを編集できます')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'CSVを読み込めませんでした')
    }
  }

  function handleFallbackCsv(event: Event): void {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    file.text().then((text) => {
      try {
        replaceFile(fromCsv($appStore.file, text))
        notify('CSVから進捗を復元しました。イベントを編集できます')
      } catch (error) {
        notify(error instanceof Error ? error.message : 'CSVを読み込めませんでした')
      }
    }).catch(() => notify('CSVを読み込めませんでした'))
  }

  function newProject(): void {
    if ($appStore.dirty && !window.confirm('保存していない変更を破棄しますか？')) return
    if (temporaryMediaPath && window.electronAPI) void window.electronAPI.removeTempMedia(temporaryMediaPath)
    if (browserObjectUrl) URL.revokeObjectURL(browserObjectUrl)
    videoSrc = ''; originalPath = ''; temporaryMediaPath = ''; browserObjectUrl = ''; playing = false
    const file = createProjectFile()
    replaceFile(file)
    expandedCategories = []
    activeParticipantId = file.project.participants[0]?.id ?? ''
    notify('新規プロジェクトを作成しました')
  }

  function handleMetadata(event: Event): void {
    const element = event.currentTarget as HTMLVideoElement
    const current = video
    const next: Video = {
      id: current.id || crypto.randomUUID(), filePath: originalPath, fileName: originalPath.split(/[\\/]/).pop() ?? '',
      duration: Number.isFinite(element.duration) ? element.duration : 0, width: element.videoWidth, height: element.videoHeight,
      fps: current.fps > 0 ? current.fps : 59.94,
    }
    element.playbackRate = playbackRate
    setVideo(next)
    notify(`${next.fileName} を読み込みました`)
  }

  async function handleVideoError(): Promise<void> {
    if (!window.electronAPI) { notify('このブラウザでは動画を再生できません。Electronアプリで起動してください'); return }
    if (!originalPath || isTranscoding || lastTranscodeAttempt === originalPath) { notify('この動画を再生できません'); return }
    lastTranscodeAttempt = originalPath
    isTranscoding = true; transcodeProgress = 0
    notify('HEVC動画をH.264へ変換しています')
    try {
      const result = await window.electronAPI.transcodeVideo(originalPath, video.duration)
      temporaryMediaPath = result.filePath
      videoSrc = result.url
      notify('変換が完了しました')
    } catch { notify('FFmpegによる変換に失敗しました') }
    finally { isTranscoding = false }
  }

  function togglePlay(): void {
    if (!videoElement || !videoSrc) { notify('先に動画を開いてください'); return }
    if (videoElement.paused) void videoElement.play()
    else videoElement.pause()
  }

  function seek(time: number): void {
    const next = Math.max(0, Math.min(time, video.duration || Number.MAX_SAFE_INTEGER))
    if (videoElement) videoElement.currentTime = next
    setCurrentTime(next)
  }

  function step(seconds: number): void { seek($appStore.currentTime + seconds) }
  function frameStep(direction: number): void { step(direction / (video.fps || 59.94)) }

  function loadedTime(event: Event): void { setCurrentTime((event.currentTarget as HTMLVideoElement).currentTime) }

  function inputTag(participantId: string, tag: Tag): void {
    if (!project.videoId) { notify('先に動画を開いてください'); return }
    activeParticipantId = participantId
    const result = recordTag(participantId, tag, $appStore.currentTime)
    if (result === 'started') notify(`${tag.name}を開始しました`)
    else if (result === 'created') notify(`${tag.name}を記録しました`)
    else notify('開始時刻より後で終了してください')
  }

  function updateEvent(id: string, patch: Partial<AnnotationEvent>): void {
    updateFile((file) => ({ ...file, project: { ...file.project, events: file.project.events.map((event) => event.id === id ? { ...event, ...patch } : event) } }))
  }

  function deleteEvent(id: string): void {
    updateFile((file) => ({ ...file, project: { ...file.project, events: file.project.events.filter((event) => event.id !== id) } }))
    setSelectedEvent(null); notify('イベントを削除しました')
  }

  function editProject(patch: Partial<Project>): void { updateFile((file) => ({ ...file, project: { ...file.project, ...patch } })) }
  function addCondition(): void { masterModal = { kind: 'condition', name: '' } }
  function editCondition(item: Condition): void { masterModal = { kind: 'condition', id: item.id, name: item.name } }
  function deleteCondition(item: Condition): void { if (project.conditionId === item.id) { notify('現在使用中のConditionは削除できません'); return } updateFile((file) => ({ ...file, conditions: file.conditions.filter((condition) => condition.id !== item.id) })) }

  function addParticipant(): void { masterModal = { kind: 'participant', name: '' } }
  function editParticipant(item: Participant): void { masterModal = { kind: 'participant', id: item.id, name: item.name } }
  function deleteParticipant(item: Participant): void { if (project.events.some((event) => event.participantId === item.id)) { notify('イベントで使用中の参加者は削除できません'); return } updateFile((file) => ({ ...file, project: { ...file.project, participants: file.project.participants.filter((candidate) => candidate.id !== item.id) } })) }

  function addCategory(): void { masterModal = { kind: 'category', name: '' } }
  function editCategory(item: Category): void { masterModal = { kind: 'category', id: item.id, name: item.name } }
  function deleteCategory(item: Category): void { if (project.tags.some((tag) => tag.categoryId === item.id) || project.events.some((event) => event.categoryId === item.id)) { notify('タグまたはイベントで使用中のカテゴリは削除できません'); return } updateFile((file) => ({ ...file, project: { ...file.project, categories: file.project.categories.filter((candidate) => candidate.id !== item.id) } })) }

  function submitMaster(): void {
    if (!masterModal?.name.trim()) { notify('名前を入力してください'); return }
    const modal = { ...masterModal, name: masterModal.name.trim() }
    if (modal.kind === 'condition') {
      if ($appStore.file.conditions.some((item) => item.name === modal.name && item.id !== modal.id)) { notify('同じCondition名が存在します'); return }
      updateFile((file) => ({ ...file, conditions: modal.id ? file.conditions.map((item) => item.id === modal.id ? { ...item, name: modal.name } : item) : [...file.conditions, { id: crypto.randomUUID(), name: modal.name }] }))
    } else if (modal.kind === 'participant') {
      if (project.participants.some((item) => item.name === modal.name && item.id !== modal.id)) { notify('同じ参加者名が存在します'); return }
      if (modal.id) updateFile((file) => ({ ...file, project: { ...file.project, participants: file.project.participants.map((item) => item.id === modal.id ? { ...item, name: modal.name } : item) } }))
      else { const item = { id: crypto.randomUUID(), name: modal.name }; updateFile((file) => ({ ...file, project: { ...file.project, participants: [...file.project.participants, item] } })); appStore.update((state) => ({ ...state, participantFilter: [...state.participantFilter, item.id] })); activeParticipantId = item.id }
    } else {
      if (project.categories.some((item) => item.name === modal.name && item.id !== modal.id)) { notify('同じカテゴリ名が存在します'); return }
      if (modal.id) updateFile((file) => ({ ...file, project: { ...file.project, categories: file.project.categories.map((item) => item.id === modal.id ? { ...item, name: modal.name } : item) } }))
      else { const item = { id: crypto.randomUUID(), name: modal.name }; updateFile((file) => ({ ...file, project: { ...file.project, categories: [...file.project.categories, item] } })); appStore.update((state) => ({ ...state, categoryFilter: [...state.categoryFilter, item.id] })) }
    }
    masterModal = null
  }

  function addTag(): void {
    if (project.categories.length === 0) { notify('先にカテゴリを作成してください'); return }
    tagModal = { name: '', categoryId: project.categories[0].id, type: 'Point', color: nextTagColor(project.tags) }
  }
  function editTag(item: Tag): void { tagModal = { id: item.id, name: item.name, categoryId: item.categoryId, type: item.type, color: item.color } }
  function submitTag(): void {
    if (!tagModal?.name.trim()) { notify('タグ名を入力してください'); return }
    const modal = { ...tagModal, name: tagModal.name.trim() }
    const current = modal.id ? project.tags.find((item) => item.id === modal.id) : undefined
    if (current && project.events.some((event) => event.tagId === current.id) && (current.categoryId !== modal.categoryId || current.type !== modal.type)) { notify('イベントで使用中のタグのカテゴリとタイプは変更できません'); return }
    if (modal.id) updateFile((file) => ({ ...file, project: { ...file.project, tags: file.project.tags.map((item) => item.id === modal.id ? { ...item, name: modal.name, categoryId: modal.categoryId, type: modal.type, color: modal.color } : item) } }))
    else updateFile((file) => ({ ...file, project: { ...file.project, tags: [...file.project.tags, { id: crypto.randomUUID(), name: modal.name, categoryId: modal.categoryId, type: modal.type, color: nextTagColor(file.project.tags) }] } }))
    tagModal = null
  }
  function deleteTag(item: Tag): void { if (project.events.some((event) => event.tagId === item.id)) { notify('イベントで使用中のタグは削除できません'); return } updateFile((file) => ({ ...file, project: { ...file.project, tags: file.project.tags.filter((candidate) => candidate.id !== item.id) } })) }

  function changeEventCategory(id: string, categoryId: string): void {
    const tag = project.tags.find((item) => item.categoryId === categoryId)
    if (!tag) { notify('このカテゴリにはタグがありません'); return }
    updateEvent(id, { categoryId, tagId: tag.id, type: tag.type })
  }

  function toggleCategory(id: string): void { appStore.update((state) => ({ ...state, categoryFilter: state.categoryFilter.includes(id) ? state.categoryFilter.filter((item) => item !== id) : [...state.categoryFilter, id] })) }
  function toggleParticipant(id: string): void { appStore.update((state) => ({ ...state, participantFilter: state.participantFilter.includes(id) ? state.participantFilter.filter((item) => item !== id) : [...state.participantFilter, id] })) }
  function toggleCategoryTags(id: string): void { expandedCategories = expandedCategories.includes(id) ? expandedCategories.filter((item) => item !== id) : [...expandedCategories, id] }
  function timelineRowKey(event: AnnotationEvent): string { return expandedCategories.includes(event.categoryId) ? `${event.participantId}:${event.categoryId}:${event.tagId}` : `${event.participantId}:${event.categoryId}` }
  function eventColor(tagId: string): string { return project.tags.find((tag) => tag.id === tagId)?.color ?? '#6b8f52' }

  function timeFromPointer(event: PointerEvent | MouseEvent): number { const rect = timelineSvg.getBoundingClientRect(); return Math.max(0, Math.min(duration, (event.clientX - rect.left - timelineLabelWidth) / pixelsPerSecond)) }
  function beginDrag(event: PointerEvent, item: AnnotationEvent, mode: DragState['mode']): void { event.stopPropagation(); const time = timeFromPointer(event); drag = { id: item.id, mode, start: item.start, stop: item.stop, offset: mode === 'move' ? time - item.start : 0, draftStart: item.start, draftStop: item.stop }; setSelectedEvent(item.id) }
  function moveDrag(event: PointerEvent): void {
    if (!drag) return
    const time = timeFromPointer(event)
    if (drag.mode === 'move') { const length = drag.stop === null ? 0 : drag.stop - drag.start; const start = Math.max(0, Math.min(duration - length, time - drag.offset)); drag = { ...drag, draftStart: start, draftStop: drag.stop === null ? null : start + length } }
    if (drag.mode === 'start' && drag.stop !== null) drag = { ...drag, draftStart: Math.max(0, Math.min(drag.stop - 0.01, time)) }
    if (drag.mode === 'stop' && drag.stop !== null) drag = { ...drag, draftStop: Math.max(drag.start + 0.01, Math.min(duration, time)) }
  }
  function endDrag(): void { if (!drag) return; updateEvent(drag.id, { start: Number(drag.draftStart.toFixed(3)), stop: drag.draftStop === null ? null : Number(drag.draftStop.toFixed(3)) }); drag = null }
  function displayEvent(item: AnnotationEvent): AnnotationEvent { return drag?.id === item.id ? { ...item, start: drag.draftStart, stop: drag.draftStop } : item }
  function selectEvent(id: string): void { setSelectedEvent(id); const event = project.events.find((item) => item.id === id); if (event) seek(event.start) }

  function handleGlobalKey(event: KeyboardEvent): void { if (event.key === 'Delete' && $appStore.selectedEventId) { event.preventDefault(); deleteEvent($appStore.selectedEventId) } }
</script>

<svelte:window on:keydown={handleGlobalKey} />

<div class:dark-mode={darkMode} class="app-shell">
  <header class="topbar">
    <div class="brand"><span class="brand-mark">A</span><div><span class="eyebrow">VIDEO BEHAVIOR LAB</span><h1>Annotation Desk</h1></div></div>
    <nav class="actions"><button class="button ghost" on:click={newProject}>新規</button><button class="button ghost" on:click={loadProject}>プロジェクトを開く</button><button class="button ghost" on:click={loadCsv}>CSV読み込み</button><button class="button secondary" on:click={saveProject}>JSON保存</button><button class="button primary" on:click={saveCsv}>CSV保存</button><button class="button utility" on:click={() => helpOpen = true}>？ ヘルプ</button><button class="button utility" on:click={toggleDarkMode}>{darkMode ? '☀ ライト' : '☾ ダーク'}</button></nav>
  </header>

  <main class="workspace">
    <aside class="sidebar">
      <section class="side-card">
        <div class="section-title">PROJECT <span class:dirty={$appStore.dirty} class="status-dot"></span></div>
        <label>プロジェクト名<input class="text-input" value={project.name} on:input={(event) => editProject({ name: (event.currentTarget as HTMLInputElement).value })} /></label>
        <label>実験条件<select class="text-input" value={project.conditionId} on:change={(event) => editProject({ conditionId: (event.currentTarget as HTMLSelectElement).value })}>{#each $appStore.file.conditions as condition}<option value={condition.id}>{condition.name}</option>{/each}</select></label>
      </section>

      <section class="side-card">
        <div class="section-title">VIDEO SOURCE <span class="badge">MOV / MP4</span></div>
        <button class="upload" on:click={chooseVideo}><span class="upload-icon">↥</span><strong>{video.fileName || '動画ファイルを開く'}</strong><small>HEVC MOV / H.264 MP4</small></button><input class="hidden-input" bind:this={fallbackVideoInput} type="file" accept="video/quicktime,video/mp4,.mov,.mp4" on:change={handleFallbackVideo} /><input class="hidden-input" bind:this={fallbackCsvInput} type="file" accept="text/csv,.csv" on:change={handleFallbackCsv} />
        {#if video.filePath}<div class="meta"><span>{video.width} × {video.height} / {formatTime(video.duration)}</span><label>FPS<input type="number" min="1" step="0.001" value={video.fps} on:change={(event) => updateFile((file) => ({ ...file, video: { ...file.video, fps: Number((event.currentTarget as HTMLInputElement).value) } }))} /></label></div>{:else}<p class="muted">動画を選択してください。</p>{/if}
        {#if isTranscoding}<div class="progress"><span>H.264へ変換中 {transcodeProgress}%</span><div><i style={`width:${transcodeProgress}%`}></i></div></div>{/if}
      </section>

      <section class="side-card definitions">
        <div class="section-title">CONDITIONS <button class="add" on:click={addCondition}>＋</button></div>
        {#each $appStore.file.conditions as item}<div class="definition"><span>{item.name}</span><button on:click={() => editCondition(item)}>編集</button><button on:click={() => deleteCondition(item)}>×</button></div>{/each}
        <div class="section-title with-top">PARTICIPANTS <button class="add" on:click={addParticipant}>＋</button></div>
        {#each project.participants as item}<div class="definition"><span>{item.name}</span><button on:click={() => editParticipant(item)}>編集</button><button on:click={() => deleteParticipant(item)}>×</button></div>{/each}
        <div class="section-title with-top">CATEGORIES <button class="add" on:click={addCategory}>＋</button></div>
        {#each project.categories as item}<div class="definition"><span>{item.name}</span><button on:click={() => editCategory(item)}>編集</button><button on:click={() => deleteCategory(item)}>×</button></div>{/each}
        <div class="section-title with-top">TAGS <button class="add" on:click={addTag}>＋</button></div>
        {#each project.tags as item}<div class="definition"><span><i class="tag-swatch" style={`background:${item.color}`}></i>{item.name}<small>{item.type}</small></span><button on:click={() => editTag(item)}>編集</button><button on:click={() => deleteTag(item)}>×</button></div>{/each}
      </section>
    </aside>

    <section class="main-column">
      <section class="video-card">
        <span class="video-label">REVIEW MONITOR</span>
        <!-- svelte-ignore a11y_media_has_caption -->
        {#if videoSrc}<video bind:this={videoElement} src={videoSrc} controls={false} on:loadedmetadata={handleMetadata} on:timeupdate={loadedTime} on:play={() => playing = true} on:pause={() => playing = false} on:ended={() => playing = false} on:error={handleVideoError}></video>{:else}<div class="empty-video"><span>◌</span><strong>分析する動画を選択してください</strong><small>動画はElectron内でのみ読み込まれます。</small></div>{/if}
        {#if video.filePath && !videoSrc}<div class="relink">動画ファイルが見つかりません。<button on:click={chooseVideo}>再リンク</button></div>{/if}
      </section>

      <section class="transport panel"><button class="skip" on:click={() => step(-seekAmount)}>− {seekAmount >= 60 ? `${seekAmount / 60}m` : `${seekAmount}s`}</button><button class="play" on:click={togglePlay}>{playing ? 'Ⅱ' : '▶'}</button><button class="skip" on:click={() => step(seekAmount)}>＋ {seekAmount >= 60 ? `${seekAmount / 60}m` : `${seekAmount}s`}</button><label class="seek-select">移動幅<select value={seekAmount} on:change={(event) => setSeekAmount(Number((event.currentTarget as HTMLSelectElement).value))}><option value="5">5秒</option><option value="10">10秒</option><option value="15">15秒</option><option value="30">30秒</option><option value="60">1分</option><option value="300">5分</option></select></label><button class="frame-button" on:click={() => frameStep(-1)}>|‹</button><button class="frame-button" on:click={() => frameStep(1)}>›|</button><label class="speed-select">速度<select value={playbackRate} on:change={(event) => setPlaybackRate(Number((event.currentTarget as HTMLSelectElement).value))}><option value="0.5">0.5x</option><option value="0.8">0.8x</option><option value="1.1">1.1x</option><option value="1.2">1.2x</option><option value="1.5">1.5x</option><option value="2">2.0x</option></select></label><strong class="time">{formatTime($appStore.currentTime)} <small>/ {formatTime(video.duration)}</small></strong><input type="range" min="0" max={video.duration || 1} step="0.001" value={Math.min($appStore.currentTime, video.duration || 1)} on:input={(event) => seek(Number((event.currentTarget as HTMLInputElement).value))} /></section>

      <section class="panel timeline-panel"><div class="panel-head"><div><span class="kicker">TIMELINE</span><h2>イベントを確認・修正</h2></div><div class="tools"><label>ズーム <input type="range" min="0.1" max="10" step="0.05" value={$appStore.zoom} on:input={(event) => appStore.update((state) => ({ ...state, zoom: Number((event.currentTarget as HTMLInputElement).value) }))} /></label><button class:active={$appStore.autoFollow} on:click={() => appStore.update((state) => ({ ...state, autoFollow: !state.autoFollow }))}>追従 {$appStore.autoFollow ? 'ON' : 'OFF'}</button></div></div>
        <div class="timeline-instruction"><span>表示モード</span><strong>カテゴリ名をクリック</strong>すると、タグを「まとめて表示」と「タグ別レーン」に切り替えられます。</div><div class="filters"><span>表示:</span>{#each project.categories as category}<span class="category-filter"><input type="checkbox" checked={$appStore.categoryFilter.includes(category.id)} on:change={() => toggleCategory(category.id)} /><button class:expanded={expandedCategories.includes(category.id)} title="クリックでタグ表示を切り替え" on:click={() => toggleCategoryTags(category.id)}>{category.name} <small>{expandedCategories.includes(category.id) ? 'タグ別' : 'まとめ'}</small></button></span>{/each}<i></i>{#each project.participants as participant}<label><input type="checkbox" checked={$appStore.participantFilter.includes(participant.id)} on:change={() => toggleParticipant(participant.id)} />{participant.name}</label>{/each}<small class="filter-help">☑ 表示　カテゴリ名 = 表示モード</small></div>
        <div class="timeline-scroll" bind:this={timelineScroll}><!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions --><svg bind:this={timelineSvg} width={timelineWidth} height={timelineHeight} on:click={(event) => { if (!(event.target as Element).closest('.event-shape')) seek(timeFromPointer(event)) }} on:pointermove={moveDrag} on:pointerup={endDrag} on:pointercancel={endDrag}>
          <rect width={timelineWidth} height={timelineHeight} fill="#f7f5ef" />
          <rect x="0" y="0" width={timelineLabelWidth} height={timelineHeight} class="label-gutter" />
          {#each Array(Math.floor(duration / minorTickStep) + 1) as _, index}{#if index * minorTickStep <= duration}{@const time = index * minorTickStep}{@const x = timelineLabelWidth + time * pixelsPerSecond}<line x1={x} y1={time % tickStep === 0 ? 25 : 30} x2={x} y2={headerHeight} class:major-tick={time % tickStep === 0} class="tick-mark" />{/if}{/each}
          {#each Array(Math.floor(duration / tickStep) + 1) as _, index}{#if index * tickStep <= duration}<line x1={timelineLabelWidth + index * tickStep * pixelsPerSecond} y1={headerHeight} x2={timelineLabelWidth + index * tickStep * pixelsPerSecond} y2={timelineHeight} class="grid-line" /><text x={timelineLabelWidth + index * tickStep * pixelsPerSecond + 5} y="22" class="tick">{formatTime(index * tickStep).slice(0, 5)}</text>{/if}{/each}
          {#each rows as row, index}<rect x="0" y={headerHeight + index * rowHeight} width={timelineWidth} height={rowHeight} class:even={index % 2 === 0} class="lane" /><text role="button" tabindex="0" aria-label={`${row.category.name}のタグ表示を切り替え`} x="10" y={headerHeight + index * rowHeight + 25} class="row-label" on:click|stopPropagation={() => toggleCategoryTags(row.category.id)} on:keydown={(event) => { if (event.key === 'Enter' || event.key === ' ') toggleCategoryTags(row.category.id) }}>{row.participant.name} <tspan>{row.category.name}{row.tag ? ` / ${row.tag.name}` : ''}</tspan></text>{/each}
          {#each visibleEvents as raw}{@const item = displayEvent(raw)}{@const rowIndex = rowMap.get(timelineRowKey(item))}{#if rowIndex !== undefined}{@const x = timelineLabelWidth + item.start * pixelsPerSecond}{@const y = headerHeight + rowIndex * rowHeight + 11}{@const color = eventColor(item.tagId)}{#if item.type === 'Point'}<circle style={`fill:${color};stroke:${color}`} role="button" tabindex="0" aria-label="Pointイベントを選択" cx={x} cy={y + 10} r={$appStore.selectedEventId === item.id ? 8 : 6} class:selected={$appStore.selectedEventId === item.id} class="event-shape point" on:pointerdown={(event) => beginDrag(event, item, 'move')} on:keydown={(event) => { if (event.key === 'Enter' || event.key === ' ') selectEvent(item.id) }} on:click|stopPropagation={() => selectEvent(item.id)} />{:else}{@const stop = item.stop ?? item.start}{@const width = Math.max(4, (stop - item.start) * pixelsPerSecond)}<g role="button" tabindex="0" aria-label="Stateイベントを選択" class:event-selected={$appStore.selectedEventId === item.id} class="event-shape" on:keydown={(event) => { if (event.key === 'Enter' || event.key === ' ') selectEvent(item.id) }} on:click|stopPropagation={() => selectEvent(item.id)}><rect style={`fill:${color};stroke:${color}`} role="button" tabindex="0" aria-label="Stateイベントを移動" x={x} y={y} width={width} height="20" class="state-bar" on:pointerdown={(event) => beginDrag(event, item, 'move')} /><rect role="button" tabindex="0" aria-label="Stateイベントの開始を変更" x={x - 4} y={y} width="8" height="20" class="resize" on:pointerdown={(event) => beginDrag(event, item, 'start')} /><rect role="button" tabindex="0" aria-label="Stateイベントの終了を変更" x={x + width - 4} y={y} width="8" height="20" class="resize" on:pointerdown={(event) => beginDrag(event, item, 'stop')} /></g>{/if}{/if}{/each}
          <line x1={timelineLabelWidth + $appStore.currentTime * pixelsPerSecond} y1="0" x2={timelineLabelWidth + $appStore.currentTime * pixelsPerSecond} y2={timelineHeight} class="current-line" />
          {#if drag}{@const dragEvent = project.events.find((item) => item.id === drag?.id)}{@const dragText = dragEvent?.type === 'State' ? `${formatTime(drag.draftStart)} — ${formatTime(drag.draftStop ?? drag.draftStart)}` : formatTime(drag.draftStart)}{@const dragTime = drag.mode === 'stop' ? (drag.draftStop ?? drag.draftStart) : drag.draftStart}{@const dragX = timelineLabelWidth + dragTime * pixelsPerSecond}<g class="drag-readout" transform={`translate(${Math.max(timelineLabelWidth, Math.min(timelineWidth - 150, dragX - 55))} 4)`}><rect width="145" height="24" rx="4" /><text x="8" y="16">{dragText}</text></g>{/if}
        </svg></div>
      </section>

      <section class="panel event-list"><div class="panel-head"><div><span class="kicker">EVENT LOG</span><h2>イベント一覧 <small>{project.events.length}</small></h2></div></div><div class="table-wrap"><table><thead><tr><th>Time</th><th>Participant</th><th>Category</th><th>Tag</th><th>Type</th><th>Duration</th></tr></thead><tbody>{#if project.events.length === 0}<tr><td colspan="6" class="empty">イベントはまだありません。</td></tr>{:else}{#each project.events.slice().sort((a, b) => a.start - b.start) as item}<tr class:selected={$appStore.selectedEventId === item.id} on:click={() => selectEvent(item.id)}><td class="mono">{formatTime(item.start)}</td><td>{project.participants.find((p) => p.id === item.participantId)?.name}</td><td>{project.categories.find((c) => c.id === item.categoryId)?.name}</td><td>{project.tags.find((t) => t.id === item.tagId)?.name}</td><td><span class="pill {item.type.toLowerCase()}">{item.type}</span></td><td class="mono">{formatDuration(item.stop === null ? null : item.stop - item.start)}</td></tr>{/each}{/if}</tbody></table></div></section>
      </section>

    <aside class="right-rail">
      <section class="panel tag-panel right-tag-panel"><div class="panel-head"><div><span class="kicker">TAG INPUT</span><h2>行動を記録</h2></div></div><div class="input-target"><span>入力対象</span>{#each project.participants as participant}<button class:active={participant.id === activeParticipantId} on:click={() => activeParticipantId = participant.id}>{participant.name}</button>{/each}</div><p class="hint">先に入力対象を選び、下の行動名をクリックします。Stateは1回目で開始、2回目で終了します。</p>
        {#each project.categories as category}<div class="tag-group"><h3>{category.name}</h3><div class="right-action-buttons">{#each project.tags.filter((tag) => tag.categoryId === category.id) as tag}<button style={`border-left:3px solid ${tag.color}`} class:pending={Boolean($appStore.pendingStates[eventKey(activeParticipantId, tag.id)])} on:click={() => inputTag(activeParticipantId, tag)}><i style={`background:${tag.color}`}></i><span>{tag.name}</span><small>{tag.type}</small></button>{/each}</div></div>{/each}
      </section>
      <div class="event-detail-scroll">
        {#if selectedEvent}<section class="panel inspector"><div class="panel-head"><div><span class="kicker">SELECTED EVENT</span><h2>イベント詳細</h2></div><button class="danger" on:click={() => deleteEvent(selectedEvent.id)}>削除</button></div><div class="event-summary"><span>{selectedEvent.type}</span><strong>{formatTime(selectedEvent.start)}</strong><small>{selectedEvent.stop === null ? 'Point event' : `〜 ${formatTime(selectedEvent.stop)}`}</small></div><label>Participant<select class="text-input" value={selectedEvent.participantId} on:change={(event) => updateEvent(selectedEvent.id, { participantId: (event.currentTarget as HTMLSelectElement).value })}>{#each project.participants as item}<option value={item.id}>{item.name}</option>{/each}</select></label><label>Category<select class="text-input" value={selectedEvent.categoryId} on:change={(event) => changeEventCategory(selectedEvent.id, (event.currentTarget as HTMLSelectElement).value)}>{#each project.categories as item}<option value={item.id}>{item.name}</option>{/each}</select></label><label>Tag<select class="text-input" value={selectedEvent.tagId} on:change={(event) => { const tag = project.tags.find((item) => item.id === (event.currentTarget as HTMLSelectElement).value); if (tag) updateEvent(selectedEvent.id, { tagId: tag.id, categoryId: tag.categoryId, type: tag.type }) }}>{#each project.tags.filter((item) => item.categoryId === selectedEvent.categoryId) as item}<option value={item.id}>{item.name}</option>{/each}</select></label><div class="time-fields"><label>Start<input class="text-input mono" type="number" min="0" max={video.duration} step="0.001" value={selectedEvent.start} on:change={(event) => { const start = Math.max(0, Number((event.currentTarget as HTMLInputElement).value)); updateEvent(selectedEvent.id, { start, stop: selectedEvent.stop === null ? null : Math.max(start, selectedEvent.stop) }) }} /></label><label>Stop<input class="text-input mono" type="number" min={selectedEvent.start} max={video.duration} step="0.001" disabled={selectedEvent.stop === null} value={selectedEvent.stop ?? ''} on:change={(event) => updateEvent(selectedEvent.id, { stop: Math.max(selectedEvent.start, Number((event.currentTarget as HTMLInputElement).value)) })} /></label></div><button class="delete-button" on:click={() => deleteEvent(selectedEvent.id)}>このイベントを削除</button></section>{:else}<section class="panel inspector empty-inspector"><span>⌁</span><h2>イベントを選択</h2><p>タイムラインまたは一覧からイベントを選択してください。</p></section>{/if}
      </div>
    </aside>

     {#if selectedEvent}<aside class="panel inspector"><div class="panel-head"><div><span class="kicker">SELECTED EVENT</span><h2>イベント詳細</h2></div><button class="danger" on:click={() => deleteEvent(selectedEvent.id)}>削除</button></div><div class="event-summary"><span>{selectedEvent.type}</span><strong>{formatTime(selectedEvent.start)}</strong><small>{selectedEvent.stop === null ? 'Point event' : `〜 ${formatTime(selectedEvent.stop)}`}</small></div><label>Participant<select class="text-input" value={selectedEvent.participantId} on:change={(event) => updateEvent(selectedEvent.id, { participantId: (event.currentTarget as HTMLSelectElement).value })}>{#each project.participants as item}<option value={item.id}>{item.name}</option>{/each}</select></label><label>Category<select class="text-input" value={selectedEvent.categoryId} on:change={(event) => changeEventCategory(selectedEvent.id, (event.currentTarget as HTMLSelectElement).value)}>{#each project.categories as item}<option value={item.id}>{item.name}</option>{/each}</select></label><label>Tag<select class="text-input" value={selectedEvent.tagId} on:change={(event) => { const tag = project.tags.find((item) => item.id === (event.currentTarget as HTMLSelectElement).value); if (tag) updateEvent(selectedEvent.id, { tagId: tag.id, categoryId: tag.categoryId, type: tag.type }) }}>{#each project.tags.filter((item) => item.categoryId === selectedEvent.categoryId) as item}<option value={item.id}>{item.name}</option>{/each}</select></label><div class="time-fields"><label>Start<input class="text-input mono" type="number" min="0" max={video.duration} step="0.001" value={selectedEvent.start} on:change={(event) => { const start = Math.max(0, Number((event.currentTarget as HTMLInputElement).value)); updateEvent(selectedEvent.id, { start, stop: selectedEvent.stop === null ? null : Math.max(start, selectedEvent.stop) }) }} /></label><label>Stop<input class="text-input mono" type="number" min={selectedEvent.start} max={video.duration} step="0.001" disabled={selectedEvent.stop === null} value={selectedEvent.stop ?? ''} on:change={(event) => updateEvent(selectedEvent.id, { stop: Math.max(selectedEvent.start, Number((event.currentTarget as HTMLInputElement).value)) })} /></label></div><button class="delete-button" on:click={() => deleteEvent(selectedEvent.id)}>このイベントを削除</button></aside>{:else}<aside class="panel inspector empty-inspector"><span>⌁</span><h2>イベントを選択</h2><p>タイムラインまたは一覧からイベントを選択してください。</p></aside>{/if}
  </main>
  {#if notice}<div class="toast">{notice}</div>{/if}
  {#if helpOpen}<div class="modal-backdrop" role="presentation" on:click={() => helpOpen = false}><!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions a11y_no_static_element_interactions --><section class="modal help-modal" on:click|stopPropagation><div class="kicker">HELP / 操作説明</div><h2>Annotation Deskの使い方</h2><div class="help-section"><h3>動画</h3><p>「動画ファイルを開く」からMOV / MP4を選択します。HEVC動画が再生できない場合は自動でH.264へ変換します。</p></div><div class="help-section"><h3>イベント入力</h3><p>右レールのTag Inputで参加者とタグをクリックします。Pointはクリック時刻を記録し、Stateは1回目で開始、2回目で終了します。</p></div><div class="help-section"><h3>タイムライン</h3><p>イベントをクリックすると選択・シークできます。Pointはドラッグ、Stateは中央ドラッグで移動、左右端ドラッグで開始・終了を編集できます。</p><p><strong>カテゴリ名をクリック</strong>すると、タグをまとめた一行表示とタグ別レーン表示を切り替えられます。</p></div><div class="help-section"><h3>編集・保存</h3><p>Condition、Participant、Category、Tagは左側の編集ボタンから変更します。JSON保存でプロジェクトを保存し、CSV出力で分析用データを書き出します。</p></div><button class="button primary modal-close" on:click={() => helpOpen = false}>閉じる</button></section></div>{/if}
  {#if masterModal}<div class="modal-backdrop" role="presentation" on:click={() => masterModal = null}><!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions a11y_autofocus --><form class="modal" on:submit|preventDefault={submitMaster} on:click|stopPropagation><div class="kicker">MASTER EDITOR</div><h2>{masterModal.id ? '編集' : '追加'}: {masterModal.kind === 'condition' ? 'Condition' : masterModal.kind === 'participant' ? 'Participant' : 'Category'}</h2><label>名前<input class="text-input" autofocus value={masterModal.name} on:input={(event) => masterModal = masterModal ? { ...masterModal, name: (event.currentTarget as HTMLInputElement).value } : null} /></label><div class="modal-actions"><button type="button" class="button ghost" on:click={() => masterModal = null}>キャンセル</button><button type="submit" class="button primary">保存</button></div></form></div>{/if}
  {#if tagModal}<div class="modal-backdrop" role="presentation" on:click={() => tagModal = null}><!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions a11y_autofocus --><form class="modal" on:submit|preventDefault={submitTag} on:click|stopPropagation><div class="kicker">TAG EDITOR</div><h2>{tagModal.id ? 'タグを編集' : 'タグを追加'}</h2><label>タグ名<input class="text-input" autofocus value={tagModal.name} on:input={(event) => tagModal = tagModal ? { ...tagModal, name: (event.currentTarget as HTMLInputElement).value } : null} /></label><label>カテゴリ<select class="text-input" value={tagModal.categoryId} on:change={(event) => tagModal = tagModal ? { ...tagModal, categoryId: (event.currentTarget as HTMLSelectElement).value } : null}>{#each project.categories as category}<option value={category.id}>{category.name}</option>{/each}</select></label><label>タイプ<select class="text-input" value={tagModal.type} on:change={(event) => tagModal = tagModal ? { ...tagModal, type: (event.currentTarget as HTMLSelectElement).value as EventType } : null}><option value="Point">Point</option><option value="State">State</option></select></label><label>色<input class="color-input" type="color" value={tagModal.color} on:input={(event) => tagModal = tagModal ? { ...tagModal, color: (event.currentTarget as HTMLInputElement).value } : null} /></label><div class="modal-actions"><button type="button" class="button ghost" on:click={() => tagModal = null}>キャンセル</button><button type="submit" class="button primary">保存</button></div></form></div>{/if}
</div>
