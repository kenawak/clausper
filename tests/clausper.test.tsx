import type { ModelCompleteResult, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'clausper',
  component: 'Pane',
  requestId: 'clausper',
  props: {
    title: 'Clausper',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const SUMMARY = {
  headline: 'Added the Clausper pane',
  spoken: 'I added the pane and wired the spoken summary.',
  asks: 'Do you want a band as well?',
}

const usage = {
  input_tokens: 10,
  output_tokens: 5,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
}

const ANSWERED: ModelCompleteResult = { isAnswered: true, text: JSON.stringify(SUMMARY), usage }

// A reply long enough to need a summary (over 320 plain characters).
const LONG_REPLY = [
  '# Done',
  '',
  'Clausper is built and loaded. I wrote the hooks module with a `turn.complete` hook that asks Haiku for a summary,',
  'a pane that lists every turn with the files it touched, and a band above the prompt for narrow terminals.',
  'The pane shows each file with its diff, and pressing one opens it in your editor or copies its path.',
  'Validation passes and all four tests pass. Do you want a band as well?',
].join('\n')

const LEAD = 'Done Clausper is built and loaded.'

// Nothing sits beneath the plugin: each hook here stands for the engine.
const engine = (on: On, spoken: string[], completion: ModelCompleteResult = ANSWERED) => {
  const clock = mock.clock(on)
  mock.store(on)
  const calls = { model: 0 }
  on('command.register', () => ({ value: { command: 'clausper' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: {} }))
  on('model.complete', () => {
    calls.model += 1
    return { value: completion }
  })
  on('audio.speak', (_, e) => {
    spoken.push(e.text)
    return { value: { via: 'system' } }
  })
  return { clock, calls }
}

test('a long reply: the opening sentence is spoken at once, then the summary', async ($, on) => {
  const spoken: string[] = []
  const { clock, calls } = engine(on, spoken)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'build it', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/app.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/app.ts', old_string: 'b', new_string: 'c' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/README.md', content: 'hi' })
  await $.turn.complete({ answer: LONG_REPLY, durationMs: 1200, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(1)

  expect(calls.model).toBe(1)
  // One utterance per sentence, so the caption follows the voice.
  expect(spoken).toEqual([LEAD, SUMMARY.spoken, SUMMARY.asks])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Button', text: /Added the Clausper pane/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /2 changes/ }))?.text).toContain('app.ts, README.md')

    await ui.press({ key: 'turn:t1' })
    expect(await ui.find({ type: 'Text', text: /Needs you/ })).toBeDefined()
    expect((await ui.find({ type: 'Button', key: 'change:t1:c1' }))?.text).toContain('×2')
    expect(await ui.find({ type: 'Button', text: /README\.md/ })).toBeDefined()

    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Button', key: 'turn:t1' })).toBeDefined()
    await ui.unmount()
  }
})

test('a short reply is spoken as it is, with no summary call', async ($, on) => {
  const spoken: string[] = []
  const { clock, calls } = engine(on, spoken)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't2' })
  await $.turn.complete({
    answer: '**Fixed** the `login` bug. Tests pass now.',
    durationMs: 10,
    isAborted: false,
    turnId: 't2',
    reason: 'answer',
  })
  await clock.advance(1)

  expect(calls.model).toBe(0)
  expect(spoken).toEqual(['Fixed the login bug.', 'Tests pass now.'])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', text: /Fixed the login bug/ })).toBeDefined()
  await ui.unmount()
})

test('muting keeps the summary but silences speech', async ($, on) => {
  const spoken: string[] = []
  const { clock } = engine(on, spoken)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const muted = await $.command.run({
    command: 'clausper',
    args: 'mute',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(muted.text).toContain('muted')

  await $.turn.start({ text: 'build', turnId: 't3' })
  await $.turn.complete({ answer: LONG_REPLY, durationMs: 10, isAborted: false, turnId: 't3', reason: 'answer' })
  await clock.advance(1)
  expect(spoken.length).toBe(0)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', text: /Added the Clausper pane/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^muted$/ })).toBeDefined()
  await ui.unmount()
})

test('a failed summary falls back to the reply itself, after the lead', async ($, on) => {
  const spoken: string[] = []
  const { clock } = engine(on, spoken, {
    isAnswered: false,
    reason: 'api-error',
    status: 529,
    error: 'overloaded',
    usage,
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't4' })
  await $.turn.complete({ answer: LONG_REPLY, durationMs: 10, isAborted: false, turnId: 't4', reason: 'answer' })
  await clock.advance(1)

  expect(spoken[0]).toBe(LEAD)
  expect(spoken[1]).toContain('I wrote the hooks module')
  expect(spoken.join(' ')).not.toContain('Done Clausper is built and loaded. Done')
})

test('subagent turns and empty answers are ignored', async ($, on) => {
  const spoken: string[] = []
  const { clock } = engine(on, spoken)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete({ answer: 'report', durationMs: 1, isAborted: false, turnId: 'a1', agentId: 'agent-1', reason: 'answer' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't5', reason: 'answer' })
  await $.turn.complete({ answer: 'cut off', durationMs: 1, isAborted: true, turnId: 't6', reason: 'aborted' })
  await clock.advance(1)

  expect(spoken.length).toBe(0)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Nothing yet/ })).toBeDefined()
  await ui.unmount()
})

test('listening: the wake word decides between sending and filling the prompt', async ($, on) => {
  const spoken: string[] = []
  const { clock } = engine(on, spoken)
  const submitted: string[] = []
  const filled: string[] = []
  let transcript = ' Add a readme file and commit it.\n'
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/ken' : undefined }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 44 + 32000 * 3 } }))
  on('audio.play', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('process.run', (_, e) => {
    const [cmd = ''] = e.argv
    if (cmd === 'mktemp') return { value: { exitCode: 0, stdout: '/tmp/clausper.abc\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (cmd.endsWith('whisper-cli')) return { value: { exitCode: 0, stdout: transcript, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const run = (args: string) =>
    $.command.run({ command: 'clausper', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await run('listen auto')

  // No wake word: the words land in the prompt box, nothing is sent.
  await run('listen')
  await clock.advance(1)
  expect(submitted).toEqual([])
  expect(filled).toEqual(['Add a readme file and commit it.'])

  // With the wake word: sent, and the wake word stripped.
  transcript = ' Clausper, add a readme file and commit it.\n'
  await run('listen')
  await clock.advance(1)
  expect(submitted).toEqual(['add a readme file and commit it.'])

  // Wake word off: everything heard is sent.
  transcript = ' Run the tests.\n'
  await run('wake off')
  await run('listen')
  await clock.advance(1)
  expect(submitted).toEqual(['add a readme file and commit it.', 'Run the tests.'])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /last listen/ }))?.text).toContain('Heard 3.0 s')
  await ui.unmount()
})

test('private mode makes no model call and speaks the reply itself', async ($, on) => {
  const spoken: string[] = []
  const { clock, calls } = engine(on, spoken)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'clausper', args: 'private on', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  await $.turn.start({ text: 'build', turnId: 'p1' })
  await $.turn.complete({ answer: LONG_REPLY, durationMs: 10, isAborted: false, turnId: 'p1', reason: 'answer' })
  await clock.advance(1)
  expect(calls.model).toBe(0)
  expect(spoken[0]).toBe(LEAD)
  expect(spoken[1]).toContain('I wrote the hooks module')
})

test('setup reports what listening needs, and listen mode is remembered', async ($, on) => {
  const spoken: string[] = []
  engine(on, spoken)
  on('env.get', () => ({ value: '/home/ken' }))
  on('fs.exists', () => ({ value: false }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'not found', isStdoutTruncated: false, isStderrTruncated: false } }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const run = (args: string) =>
    $.command.run({ command: 'clausper', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  const setup = await run('setup')
  expect(setup.text).toContain('brew install sox')
  expect(setup.text).toContain('brew install whisper-cpp')
  expect(setup.text).toContain('Install what is missing')

  const auto = await run('listen auto')
  expect(auto.text).toContain('What next?')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /ears auto/ })).toBeDefined()
  await ui.unmount()
})
