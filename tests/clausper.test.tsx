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
const engine = (on: On, spoken: string[], completion: ModelCompleteResult = ANSWERED, cwd = '/') => {
  const clock = mock.clock(on)
  mock.store(on)
  const calls = { model: 0 }
  on('command.register', () => ({ value: { command: 'clausper' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.cwd', () => ({ value: cwd }))
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

test('cost: each summary shows its tokens and dollars, and /clausper cost totals them', async ($, on) => {
  const spoken: string[] = []
  const priced: ModelCompleteResult = {
    ...ANSWERED,
    usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  }
  const { clock } = engine(on, spoken, priced)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd: 0.04 } } }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const turnId of ['c1', 'c2']) {
    await $.turn.start({ text: 'build it', turnId })
    await $.turn.complete({ answer: LONG_REPLY, durationMs: 10, isAborted: false, turnId, reason: 'answer' })
    await clock.advance(1)
  }
  // A short reply makes no call and costs nothing.
  await $.turn.start({ text: 'hi', turnId: 'c3' })
  await $.turn.complete({ answer: 'Done.', durationMs: 10, isAborted: false, turnId: 'c3', reason: 'answer' })
  await clock.advance(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /2\.4k tokens ≈\$0\.0004/ })).toBeDefined()
  await ui.press({ key: 'turn:c1' })
  expect(await ui.find({ type: 'Text', text: /1\.2k tokens, ≈\$0\.0002/ })).toBeDefined()
  await ui.unmount()

  const report = await $.command.run({ command: 'clausper', args: 'cost', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const text = 'text' in report ? report.text : ''
  expect(text).toContain('this session  2 summaries, 2.4k tokens, ≈$0.0004')
  expect(text).toContain('today         2 summaries, 2.4k tokens, ≈$0.0004')
  expect(text).toContain("1.0% of this session's ≈$0.040")
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
const kokoro = (on: On, options: { isInstalled?: boolean; hasPackages?: boolean; failAfter?: number } = {}) => {
  const runs: { argv: readonly string[]; input: string }[] = []
  const commands: (readonly string[])[] = []
  const played: string[] = []
  const isInstalled = options.isInstalled ?? true
  let hasPackages = options.hasPackages ?? true
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/ken' : e.name === 'USER' ? 'ken' : undefined }))
  on('fs.exists', () => ({ value: isInstalled }))
  on('process.run', (_, e) => {
    commands.push(e.argv)
    const [cmd = ''] = e.argv
    if (cmd === 'mktemp') return { value: { ...OK_RUN, stdout: `${CLIPS}\n` } }
    if (e.argv[1] === 'sync') hasPackages = true
    if (e.argv.includes('--list')) {
      return { value: hasPackages ? { ...OK_RUN, stdout: 'af_heart\naf_bella\n' } : { ...OK_RUN, exitCode: 1 } }
    }
    return { value: OK_RUN }
  })
  on('process.spawn', async function* (_, e) {
    if (e.argv[1] === 'sync') {
      commands.push(e.argv)
      hasPackages = true
      return { value: { code: 0, signal: null } }
    }
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

// ---------------------------------------------------------------- the floor

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
  expect(set.text).toContain('Setting it up now')
  await clock.advance(1)
  expect(spoken).toEqual(['Hi, this is George.', 'I am Clausper.'])
  expect(k.runs).toEqual([])

  const setup = await command($, 'setup')
  expect(setup.text).toContain('voice: Kokoro bm_george')
  expect(setup.text).toContain('uv (runs Kokoro): missing  → /clausper voice install fetches it')
  expect(setup.text).toContain('Kokoro model: missing  → /clausper voice install fetches it')

  const comma = await command($, 'voice kokoro,')
  expect(comma.text).toContain('Clausper voice set to Kokoro af_heart.')

  const unknown = await command($, 'voice kokoro zz_nobody')
  expect(unknown.text).toContain('No Kokoro voice zz_nobody')
  const back = await command($, 'voice default')
  expect(back.text).toContain('system default voice')
})

test('kokoro: install fetches only the hash-locked packages, and setup then reports ready', async ($, on) => {
  const spoken: string[] = []
  const { clock } = engine(on, spoken)
  const k = kokoro(on, { hasPackages: false })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await command($, 'voice install')
  await clock.advance(1)
  const sync = k.commands.find(argv => argv[1] === 'sync')
  expect(sync?.[0]).toBe('/opt/homebrew/bin/uv')
  expect(sync).toContain('--locked')
  expect(sync).toContain('--no-config')
  expect(sync?.[3]?.endsWith('/tts/kokoro.py')).toBe(true)
  expect(spoken).toContain('The Kokoro voice is ready.')

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


const FLOOR = '/home/ken/.clausper/floor'

// ~/.clausper/floor as another session left it: held for `busyFor` tries, its owner
// stamped at `stamp`. Once the plugin holds it, its own stamps replace the owner.
const floor = (on: On, options: { busyFor: number; stamp: number }) => {
  const commands: (readonly string[])[] = []
  let owner = `other-session ${options.stamp}`
  let busy = options.busyFor
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/ken' : undefined }))
  on('fs.exists', () => ({ value: true }))
  on('fs.write', (_, e) => {
    if (e.path === `${FLOOR}/owner`) owner = e.text
    return { value: undefined }
  })
  on('fs.read', (_, e) => ({ value: e.path === `${FLOOR}/owner` ? owner : '' }))
  on('process.run', (_, e) => {
    commands.push(e.argv)
    if (e.argv[0] === 'mkdir' && e.argv[1] === '-m' && busy > 0) {
      busy -= 1
      return { value: { ...OK_RUN, exitCode: 1, stderr: 'mkdir: File exists' } }
    }
    return { value: OK_RUN }
  })
  return { commands }
}

test('the floor: a turn that ends while another session speaks waits, then says which project it is', async ($, on) => {
  const spoken: string[] = []
  const { clock } = engine(on, spoken, ANSWERED, '/home/ken/dev/weather_app')
  const f = floor(on, { busyFor: 2, stamp: 9e12 })
  await $.session.start({ cwd: '/home/ken/dev/weather_app', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'fix it', turnId: 'f1' })
  await $.turn.complete({ answer: SHORT_REPLY, durationMs: 10, isAborted: false, turnId: 'f1', reason: 'answer' })

  await clock.advance(1)
  expect(spoken).toEqual([])
  await clock.advance(250)
  expect(spoken).toEqual([])
  await clock.advance(250)
  expect(spoken).toEqual(['In weather app.', 'Fixed the login bug.', 'Tests pass now.'])
  // Released afterwards, and only because the owner stamp is this session's own.
  expect(f.commands).toContainEqual(['rm', '-rf', FLOOR])
})

test('the floor: a floor left by a crashed session is moved aside and taken', async ($, on) => {
  const spoken: string[] = []
  const { clock } = engine(on, spoken)
  const f = floor(on, { busyFor: 1, stamp: 0 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(20000)
  await $.turn.start({ text: 'fix it', turnId: 'f2' })
  await $.turn.complete({ answer: SHORT_REPLY, durationMs: 10, isAborted: false, turnId: 'f2', reason: 'answer' })
  await clock.advance(1)

  expect(spoken).toEqual(['Fixed the login bug.', 'Tests pass now.'])
  const moved = f.commands.find(argv => argv[0] === 'mv')
  expect(moved?.[1]).toBe(FLOOR)
  expect(moved?.[2]?.startsWith(`${FLOOR}.stale-`)).toBe(true)
})

test('the floor: stop while waiting gives up the turn, and the summary still reaches the pane', async ($, on) => {
  const spoken: string[] = []
  const { clock } = engine(on, spoken)
  floor(on, { busyFor: 1000, stamp: 9e12 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'build it', turnId: 'f3' })
  await $.turn.complete({ answer: LONG_REPLY, durationMs: 10, isAborted: false, turnId: 'f3', reason: 'answer' })
  await clock.advance(1)

  await command($, 'stop')
  await clock.advance(1000)
  expect(spoken).toEqual([])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', text: /Added the Clausper pane/ })).toBeDefined()
  await ui.unmount()
})

// ---------------------------------------------------------------- shortcuts

const KEYS_BIN = '/home/ken/.clausper/bin/clausper-keys'
const STOP_FILE = '/home/ken/.clausper/run/stop'

// A Mac with the command line tools: the helper is built from its source, then
// started; it says each chord is ready, and after `pressAfter` ms presses stop.
// `stop` is the stamp another session left in ~/.clausper/run/stop.
const macKeys = (on: On, clock: { sleep: (ms: number) => Promise<void> }, options: { pressAfter?: number; busyFor?: number } = {}) => {
  const commands: (readonly string[])[] = []
  const helpers: (readonly string[])[] = []
  const writes = new Map<string, string>()
  const stamp = { stop: '0' }
  let busy = options.busyFor ?? 0
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/ken' : e.name === 'USER' ? 'ken' : undefined }))
  on('fs.exists', () => ({ value: true }))
  on('fs.write', (_, e) => {
    writes.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', (_, e) => ({ value: e.path === STOP_FILE ? stamp.stop : e.path === `${KEYS_BIN}.sha256` ? 'built-before\n' : '' }))
  on('process.run', (_, e) => {
    commands.push(e.argv)
    const [cmd = '', first = ''] = e.argv
    if (cmd === 'uname') return { value: { ...OK_RUN, stdout: 'Darwin\n' } }
    if (cmd === '/usr/bin/shasum') return { value: { ...OK_RUN, stdout: `source-digest  ${e.argv.at(-1)}\n` } }
    if (cmd === 'mkdir' && first === '-m' && busy > 0) {
      busy -= 1
      return { value: { ...OK_RUN, exitCode: 1, stderr: 'mkdir: File exists' } }
    }
    return { value: OK_RUN }
  })
  on('process.spawn', async function* (_, e) {
    helpers.push(e.argv)
    for (const binding of e.argv.slice(1)) {
      const [action, chord] = binding.split('=')
      yield { stream: 'stdout' as const, text: `ready ${action} ${chord}\n` }
    }
    if (options.pressAfter !== undefined && helpers.length === 1) {
      await clock.sleep(options.pressAfter)
      yield { stream: 'stdout' as const, text: 'press stop\n' }
    }
    return { value: { code: 0, signal: null } }
  })
  return { commands, helpers, writes, stamp }
}

test('shortcuts: the helper is built from its source and its stop key tells every session to stop', async ($, on) => {
  const spoken: string[] = []
  const { clock } = engine(on, spoken)
  const k = macKeys(on, clock, { pressAfter: 5000 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1)

  const build = k.commands.find(argv => argv[0] === '/usr/bin/xcrun')
  expect(build?.slice(1, 3)).toEqual(['swiftc', '-O'])
  expect(build?.at(-1)?.endsWith('/keys/clausper-keys.swift')).toBe(true)
  expect(k.writes.get(`${KEYS_BIN}.sha256`)).toBe('source-digest\n')
  expect(k.helpers).toEqual([[KEYS_BIN, 'stop=ctrl+alt+s']])
  const shown = await command($, 'keys')
  expect(shown.text).toContain('stop   ⌃⌥S')
  expect(shown.text).toContain('Helper: stop: ⌃⌥S')

  await clock.advance(5000)
  // Stamped with the time of the press, which every busy session reads.
  expect(Number(k.writes.get(STOP_FILE))).toBe(5000)
})

test('shortcuts: a stop another session stamped ends this one\'s wait for its turn', async ($, on) => {
  const spoken: string[] = []
  const { clock } = engine(on, spoken)
  const k = macKeys(on, clock, { busyFor: 8 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'fix it', turnId: 's1' })
  await $.turn.complete({ answer: SHORT_REPLY, durationMs: 10, isAborted: false, turnId: 's1', reason: 'answer' })
  await clock.advance(1)

  k.stamp.stop = String(clock.now() + 1)
  await clock.advance(5000)
  expect(spoken).toEqual([])
})

test('shortcuts: /clausper keys rebinds, refuses what is no chord, and turns them off and on', async ($, on) => {
  const spoken: string[] = []
  const { clock } = engine(on, spoken)
  const k = macKeys(on, clock)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1)

  expect((await command($, 'keys stop Cmd+Shift+S')).text).toContain('stop   ⌘⇧S')
  await clock.advance(1)
  expect(k.helpers.at(-1)).toEqual([KEYS_BIN, 'stop=cmd+shift+s'])
  expect((await command($, 'keys stop hyper+x')).text).toContain('is not a shortcut Clausper can use')
  expect((await command($, 'keys stop s')).text).toContain('is not a shortcut Clausper can use')
  expect((await command($, 'keys mute cmd+shift+s')).text).toContain('already stop')
  expect((await command($, 'keys again ctrl+alt+a')).text).toContain('again  ⌃⌥A')
  await clock.advance(1)
  expect(k.helpers.at(-1)).toEqual([KEYS_BIN, 'stop=cmd+shift+s', 'again=ctrl+alt+a'])

  const started = k.helpers.length
  expect((await command($, 'keys off')).text).toBe('Clausper shortcuts off.')
  await clock.advance(1)
  expect(k.helpers).toHaveLength(started)
  await command($, 'keys on')
  await clock.advance(1)
  expect(k.helpers.at(-1)).toEqual([KEYS_BIN, 'stop=cmd+shift+s', 'again=ctrl+alt+a'])
  await command($, 'keys reset')
  await clock.advance(1)
  expect(k.helpers.at(-1)).toEqual([KEYS_BIN, 'stop=ctrl+alt+s'])
})

// ---------------------------------------------------------------- linux

// A Linux machine: Claude Code has no player there, so Clausper runs its own.
// `present` are the files that exist; spawned programs are recorded with their input.
const linux = (on: On, present: string[]) => {
  const spawned: { argv: readonly string[]; input: string }[] = []
  const commands: (readonly string[])[] = []
  const engineAudio: string[] = []
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/ken' : e.name === 'USER' ? 'ken' : undefined }))
  on('fs.exists', (_, e) => ({ value: present.includes(e.path) }))
  on('process.run', (_, e) => {
    commands.push(e.argv)
    const [cmd = ''] = e.argv
    if (cmd === 'uname') return { value: { ...OK_RUN, stdout: 'Linux\n' } }
    if (cmd === 'mktemp') return { value: { ...OK_RUN, stdout: `${CLIPS}\n` } }
    if (e.argv.includes('--voices') && cmd.endsWith('espeak-ng')) {
      return { value: { ...OK_RUN, stdout: 'Pty Language       Age/Gender VoiceName\n 5  en-gb          --/M      English\n 2  en-us          --/M      English_(America)\n' } }
    }
    return { value: OK_RUN }
  })
  on('process.spawn', async function* (_, e) {
    spawned.push({ argv: e.argv, input: e.input ?? '' })
    if (e.argv.includes('--script')) {
      const lines = (e.input ?? '').split('\n').filter(line => line !== '')
      for (const [index] of lines.entries()) {
        yield { stream: 'stdout' as const, text: `${CLIPS}/${String(index + 1).padStart(3, '0')}.wav\n` }
      }
    }
    return { value: { code: 0, signal: null } }
  })
  on('audio.play', () => {
    engineAudio.push('play')
    return { value: undefined }
  })
  return { spawned, commands, engineAudio }
}

test('linux: the system voice is espeak-ng, each sentence on its standard input', async ($, on) => {
  const spoken: string[] = []
  const { clock } = engine(on, spoken)
  const l = linux(on, ['/usr/bin/espeak-ng'])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'fix it', turnId: 'l1' })
  await $.turn.complete({ answer: SHORT_REPLY, durationMs: 10, isAborted: false, turnId: 'l1', reason: 'answer' })
  await clock.advance(1)

  expect(spoken).toEqual([])
  expect(l.spawned).toEqual([
    { argv: ['/usr/bin/espeak-ng', '--stdin'], input: 'Fixed the login bug.\n' },
    { argv: ['/usr/bin/espeak-ng', '--stdin'], input: 'Tests pass now.\n' },
  ])

  await command($, 'voice en-gb')
  await clock.advance(1)
  expect(l.spawned.at(-1)?.argv).toEqual(['/usr/bin/espeak-ng', '-v', 'en-gb', '--stdin'])

  // Stop ends only what Clausper started: no killall on Linux.
  await command($, 'stop')
  expect(l.commands.some(argv => argv[0] === 'killall')).toBe(false)
})

test('linux: Kokoro clips play through pw-play, uv from ~/.local/bin', async ($, on) => {
  const spoken: string[] = []
  const { clock } = engine(on, spoken)
  const l = linux(on, [
    '/usr/bin/espeak-ng',
    '/usr/bin/pw-play',
    '/home/ken/.local/bin/uv',
    '/home/ken/.clausper/models/kokoro-v1.0.onnx',
    '/home/ken/.clausper/models/voices-v1.0.bin',
  ])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await command($, 'voice kokoro')
  await clock.advance(1)
  l.spawned.length = 0

  await $.turn.start({ text: 'fix it', turnId: 'l2' })
  await $.turn.complete({ answer: SHORT_REPLY, durationMs: 10, isAborted: false, turnId: 'l2', reason: 'answer' })
  await clock.advance(1)

  expect(spoken).toEqual([])
  expect(l.engineAudio).toEqual([])
  expect(l.spawned[0]?.argv[0]).toBe('/home/ken/.local/bin/uv')
  expect(l.spawned.slice(1).map(run => run.argv)).toEqual([
    ['/usr/bin/pw-play', `${CLIPS}/001.wav`],
    ['/usr/bin/pw-play', `${CLIPS}/002.wav`],
  ])
})

test('linux: setup and voices speak Linux', async ($, on) => {
  const spoken: string[] = []
  engine(on, spoken)
  linux(on, ['/usr/bin/espeak-ng'])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const setup = await command($, 'setup')
  expect(setup.text).toContain('sudo apt install sox')
  expect(setup.text).toContain('build whisper.cpp')
  expect(setup.text).toContain('system voice: /usr/bin/espeak-ng')
  expect(setup.text).toContain('audio player (Kokoro clips): missing')
  expect(setup.text).toContain('/clausper voice install fetches it')
  expect(setup.text).not.toContain('brew')

  const voices = await command($, 'voices')
  expect(voices.text).toContain('System voices (2): en-gb, en-us')
})

// ---------------------------------------------------------------- kokoro setup

const UV_PIN = '60fbd5c8a1ed681845eea28d9d622fcde03c51e91a43465b64a1e17db1ed3472'
const MODEL_PIN = '7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5'
const VOICES_PIN = 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d'
const HOME_MODELS = '/home/ken/.clausper/models'

// A fresh Apple Silicon Mac with nothing of Kokoro's: what the downloads write
// appears once it is moved into place. `badSum` names a file whose checksum is wrong.
const freshMac = (on: On, options: { badSum?: string } = {}) => {
  const present = new Set<string>()
  const commands: (readonly string[])[] = []
  const downloads: (readonly string[])[] = []
  const played: string[] = []
  let hasPackages = false
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/ken' : e.name === 'USER' ? 'ken' : undefined }))
  on('fs.exists', (_, e) => ({ value: present.has(e.path) || e.path === '/usr/bin/curl' || e.path === '/usr/bin/tar' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1000, mtimeMs: 0, isLink: false } }))
  on('process.run', (_, e) => {
    commands.push(e.argv)
    const [cmd = '', first = '', second = '', third = ''] = e.argv
    if (cmd === 'uname') return { value: { ...OK_RUN, stdout: first === '-m' ? 'arm64\n' : 'Darwin\n' } }
    if (cmd === 'mktemp') return { value: { ...OK_RUN, stdout: `${CLIPS}\n` } }
    if (cmd === '/usr/bin/shasum') {
      const path = third
      const pin = path.includes('uv.tar.gz') ? UV_PIN : path.includes('kokoro-v1.0.onnx') ? MODEL_PIN : VOICES_PIN
      const sum = options.badSum !== undefined && path.includes(options.badSum) ? '0'.repeat(64) : pin
      return { value: { ...OK_RUN, stdout: `${sum}  ${path}\n` } }
    }
    if (cmd === 'mv') present.add(second === '' ? first : e.argv.at(-1) ?? '')
    if (e.argv[1] === 'sync') hasPackages = true
    if (e.argv.includes('--list')) {
      return { value: hasPackages ? { ...OK_RUN, stdout: 'af_heart\n' } : { ...OK_RUN, exitCode: 1 } }
    }
    return { value: OK_RUN }
  })
  on('process.spawn', async function* (_, e) {
    if (e.argv[0] === '/usr/bin/curl') {
      downloads.push(e.argv)
      return { value: { code: 0, signal: null } }
    }
    if (e.argv[1] === 'sync') {
      commands.push(e.argv)
      hasPackages = true
      return { value: { code: 0, signal: null } }
    }
    const lines = (e.input ?? '').split('\n').filter(line => line !== '')
    for (const [index] of lines.entries()) {
      yield { stream: 'stdout' as const, text: `${CLIPS}/${String(index + 1).padStart(3, '0')}.wav\n` }
    }
    return { value: { code: 0, signal: null } }
  })
  on('fs.read', (_, e) => ({ value: { base64: btoa(e.path) } }))
  on('audio.play', (_, e) => {
    if (e.clip.base64 !== undefined) played.push(atob(e.clip.base64))
    return { value: undefined }
  })
  return { present, commands, downloads, played }
}

test('kokoro setup: choosing Kokoro on a fresh Mac fetches uv, the model and the packages, each checked', async ($, on) => {
  const spoken: string[] = []
  const { clock } = engine(on, spoken)
  const m = freshMac(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const set = await command($, 'voice kokoro')
  expect(set.text).toContain('Setting it up now')
  await clock.advance(1)

  // https only, from the pinned releases, in order.
  expect(m.downloads.map(argv => argv.at(-1))).toEqual([
    'https://github.com/astral-sh/uv/releases/download/0.13.6/uv-aarch64-apple-darwin.tar.gz',
    'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx',
    'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin',
  ])
  expect(m.downloads[0]?.slice(1, 4)).toEqual(['-fsSL', '--proto', '=https'])
  // Each checked before it is moved into place.
  // (The shortcut helper's own source is hashed too, to know when to rebuild it.)
  expect(
    m.commands.filter(argv => argv[0] === '/usr/bin/shasum' && !String(argv.at(-1)).endsWith('/clausper-keys.swift')),
  ).toHaveLength(3)
  expect(m.present.has('/home/ken/.clausper/bin/uv')).toBe(true)
  expect(m.present.has(`${HOME_MODELS}/kokoro-v1.0.onnx`)).toBe(true)
  // The packages come from the fetched uv, hash-locked; then Kokoro says hello.
  const sync = m.commands.find(argv => argv[1] === 'sync')
  expect(sync?.[0]).toBe('/home/ken/.clausper/bin/uv')
  expect(sync).toContain('--locked')
  expect(spoken).toEqual([])
  expect(m.played).toEqual([`${CLIPS}/001.wav`, `${CLIPS}/002.wav`])
})

test('kokoro setup: a download that does not match its pin is deleted and never used', async ($, on) => {
  const spoken: string[] = []
  const { clock, toasts } = engine(on, spoken)
  const m = freshMac(on, { badSum: 'kokoro-v1.0.onnx' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await command($, 'voice kokoro')
  await clock.advance(1)

  expect(toasts.join('\n')).toContain('the model did not match its pinned checksum')
  expect(m.present.has(`${HOME_MODELS}/kokoro-v1.0.onnx`)).toBe(false)
  const removed = m.commands.filter(argv => argv[0] === 'rm' && argv[1] === '-f').map(argv => argv[2] ?? '')
  expect(removed.some(path => path.startsWith(`${HOME_MODELS}/kokoro-v1.0.onnx.`) && path.endsWith('.part'))).toBe(true)
  expect(m.commands.some(argv => argv[1] === 'sync')).toBe(false)
  // The system voice says hello instead.
  expect(spoken).toEqual(['Hi, this is Heart.', 'I am Clausper.'])
})

test('kokoro setup: the tip is shown once, never again', async ($, on) => {
  const spoken: string[] = []
  const { toasts } = engine(on, spoken)
  freshMac(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(toasts.filter(text => text.includes('Clausper tip'))).toHaveLength(1)
})
