import type { ModelCompleteResult, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

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
  on('session.cwd', () => ({ value: '/' }))
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
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
  return { clock, calls, toasts }
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
  on('fs.stat', () => ({ value: { kind: 'file', size: 44 + 32000 * 3, mtimeMs: 0, isLink: false } }))
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

// ---------------------------------------------------------------- kokoro voice

const OK_RUN = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const CLIPS = '/tmp/clausper.k1'

// A Mac with uv and the Kokoro model files: the runner writes one clip per input
// line and prints its path, or fails after `failAfter` clips.
const kokoro = (on: On, options: { isInstalled?: boolean; failAfter?: number } = {}) => {
  const runs: { argv: readonly string[]; input: string }[] = []
  const commands: (readonly string[])[] = []
  const played: string[] = []
  const isInstalled = options.isInstalled ?? true
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/ken' : e.name === 'USER' ? 'ken' : undefined }))
  on('fs.exists', () => ({ value: isInstalled }))
  on('process.run', (_, e) => {
    commands.push(e.argv)
    const [cmd = ''] = e.argv
    if (cmd === 'mktemp') return { value: { ...OK_RUN, stdout: `${CLIPS}\n` } }
    if (e.argv.includes('--list')) return { value: { ...OK_RUN, stdout: 'af_heart\naf_bella\n' } }
    return { value: OK_RUN }
  })
  on('process.spawn', async function* (_, e) {
    runs.push({ argv: e.argv, input: e.input ?? '' })
    const lines = (e.input ?? '').split('\n').filter(line => line !== '')
    for (const [index] of lines.entries()) {
      if (options.failAfter !== undefined && index >= options.failAfter) {
        yield { stream: 'stderr' as const, text: 'RuntimeError: onnxruntime ran out of memory\n' }
        return { value: { code: 1, signal: null } }
      }
      yield { stream: 'stdout' as const, text: `${CLIPS}/${String(index + 1).padStart(3, '0')}.wav\n` }
    }
    return { value: { code: 0, signal: null } }
  })
  on('fs.read', (_, e) => ({ value: { base64: btoa(e.path) } }))
  on('audio.play', (_, e) => {
    if (e.clip.base64 !== undefined) played.push(atob(e.clip.base64))
    return { value: undefined }
  })
  return { runs, commands, played }
}

const command = ($: Parameters<TestBody>[0], args: string) =>
  $.command.run({ command: 'clausper', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

const SHORT_REPLY = '**Fixed** the `login` bug. Tests pass now.'

test('kokoro: a chosen Kokoro voice speaks through the local runner, one clip per sentence', async ($, on) => {
  const spoken: string[] = []
  const { clock } = engine(on, spoken)
  const k = kokoro(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const set = await command($, 'voice af_bella')
  expect(set.text).toBe('Clausper voice set to Kokoro af_bella.')
  await clock.advance(1)
  expect(k.runs[0]?.input).toBe('Hi, this is Bella.\nI am Clausper.\n')
  k.played.length = 0

  await $.turn.start({ text: 'fix it', turnId: 'k1' })
  await $.turn.complete({ answer: SHORT_REPLY, durationMs: 10, isAborted: false, turnId: 'k1', reason: 'answer' })
  await clock.advance(1)

  expect(spoken).toEqual([])
  expect(k.played).toEqual([`${CLIPS}/001.wav`, `${CLIPS}/002.wav`])
  const run = k.runs.at(-1)
  expect(run?.input).toBe('Fixed the login bug.\nTests pass now.\n')
  // Offline, hash-locked, no project config, uv from Homebrew's folder, the model from ~/.clausper.
  expect(run?.argv.slice(0, 7)).toEqual(['/opt/homebrew/bin/uv', 'run', '--offline', '--locked', '--no-config', '--quiet', '--script'])
  expect(run?.argv.join(' ')).toContain('--model /home/ken/.clausper/models/kokoro-v1.0.onnx --voices /home/ken/.clausper/models/voices-v1.0.bin --voice af_bella')
  // Each utterance's private folder is removed afterwards.
  expect(k.commands.filter(argv => argv[0] === 'rm')).toContainEqual(['rm', '-rf', CLIPS])
})

test('kokoro: when the runner fails, the system voice says the rest and a toast says why', async ($, on) => {
  const spoken: string[] = []
  const { clock, toasts } = engine(on, spoken)
  const k = kokoro(on, { failAfter: 1 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await command($, 'voice kokoro')

  await $.turn.start({ text: 'fix it', turnId: 'k2' })
  await $.turn.complete({ answer: SHORT_REPLY, durationMs: 10, isAborted: false, turnId: 'k2', reason: 'answer' })
  await clock.advance(1)

  expect(k.played.at(-1)).toBe(`${CLIPS}/001.wav`)
  expect(spoken.at(-1)).toBe('Tests pass now.')
  expect(toasts.join('\n')).toContain('the Kokoro voice failed (RuntimeError: onnxruntime ran out of memory)')
})

test('kokoro: not set up, the system voice speaks and setup says what is missing', async ($, on) => {
  const spoken: string[] = []
  const { clock } = engine(on, spoken)
  const k = kokoro(on, { isInstalled: false })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const set = await command($, 'voice kokoro bm_george')
  expect(set.text).toContain('Kokoro is not set up yet')
  await clock.advance(1)
  expect(spoken).toEqual(['Hi, this is George.', 'I am Clausper.'])
  expect(k.runs).toEqual([])

  const setup = await command($, 'setup')
  expect(setup.text).toContain('voice: Kokoro bm_george')
  expect(setup.text).toContain('brew install uv')
  expect(setup.text).toContain('save kokoro-v1.0.onnx to ~/.clausper/models/')

  const unknown = await command($, 'voice kokoro zz_nobody')
  expect(unknown.text).toContain('No Kokoro voice zz_nobody')
  const back = await command($, 'voice default')
  expect(back.text).toContain('system default voice')
})

test('kokoro: install fetches only the hash-locked packages, and setup then reports ready', async ($, on) => {
  const spoken: string[] = []
  const { clock, toasts } = engine(on, spoken)
  const k = kokoro(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await command($, 'voice install')
  await clock.advance(1)
  const sync = k.commands.find(argv => argv[1] === 'sync')
  expect(sync?.[0]).toBe('/opt/homebrew/bin/uv')
  expect(sync).toContain('--locked')
  expect(sync).toContain('--no-config')
  expect(sync?.[3]?.endsWith('/tts/kokoro.py')).toBe(true)
  expect(toasts).toContain('Clausper: the Kokoro voice is installed.')

  const setup = await command($, 'setup')
  expect(setup.text).toContain('Kokoro packages: installed')
  expect(setup.text).toContain('Turn it on with /clausper voice kokoro')
})

test('kokoro: a long reply speaks the lead, then the summary prepared while the lead played', async ($, on) => {
  const spoken: string[] = []
  const { clock } = engine(on, spoken)
  const k = kokoro(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await command($, 'voice am_michael')
  await clock.advance(1)
  k.runs.length = 0
  k.played.length = 0

  await $.turn.start({ text: 'build it', turnId: 'k3' })
  await $.turn.complete({ answer: LONG_REPLY, durationMs: 10, isAborted: false, turnId: 'k3', reason: 'answer' })
  await clock.advance(1)

  expect(spoken).toEqual([])
  expect(k.runs.map(run => run.input)).toEqual([`${LEAD}\n`, `${SUMMARY.spoken}\n${SUMMARY.asks}\n`])
  expect(k.played).toEqual([`${CLIPS}/001.wav`, `${CLIPS}/001.wav`, `${CLIPS}/002.wav`])
})

