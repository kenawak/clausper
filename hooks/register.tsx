import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Change, ListenMode, TurnRecord, View } from '../types'

const PANE = 'clausper'
const MAX_TURNS = 30
const MAX_ANSWER_CHARS = 14000
// A reply this short is spoken as it is: no summary call, no wait.
const SHORT_REPLY_CHARS = 320
const RECORD_SECONDS = 25
const MODEL_FILE = 'ggml-base.en.bin'

// Bump a shape tag when a record's fields change: it declines what an earlier
// version stored, which outlives a reload.
const turns = atom({ plugin: 'clausper', key: 'turns' } as const, [], {
  shape: 'turns-2',
})
const view = atom(
  { plugin: 'clausper', key: 'view' } as const,
  { kind: 'list' },
  { shape: 'view-1' },
)
const isMuted = atom({ plugin: 'clausper', key: 'isMuted' } as const, false)
const isSpeaking = atom({ plugin: 'clausper', key: 'isSpeaking' } as const, false)
// The sentence being spoken right now, drawn as a caption; null between utterances.
const caption = atom({ plugin: 'clausper', key: 'caption' } as const, null)
const showCaptions = atom({ plugin: 'clausper', key: 'showCaptions' } as const, true)
const listenMode = atom({ plugin: 'clausper', key: 'listenMode' } as const, 'off')
const isListening = atom({ plugin: 'clausper', key: 'isListening' } as const, false)
const heard = atom({ plugin: 'clausper', key: 'heard' } as const, null)

// Bumped by stop: a sentence loop that sees another generation ends.
let speakGeneration = 0

// A press or command hook has a budget of its own; speech and listening run
// far past it, so they are started from a timer and outlive the dispatch.
const later = ($: EngineInterface, work: () => Promise<unknown>) => {
  $.clock.after(0, () => {
    void work()
  })
}

type $ = EngineInterface

const SYSTEM = `You are Clausper, a voice companion for a developer using Claude Code in a terminal.
The developer does not read the long terminal replies; they HEAR your words through text-to-speech.
You receive the coding agent's full reply and answer with JSON only, no markdown fences, exactly this shape:
{"headline": "...", "spoken": "...", "asks": "..."}

headline: at most 60 characters, what happened this turn, no trailing period.
spoken: one to three plain sentences, at most 60 words, saying what was done, what changed and the outcome. Write for the ear: no code, no symbols, no markdown, no lists, no URLs. Say file names in words (for example "register dot tsx"). Lead with the result.
asks: if the reply asks the developer a question, needs a decision, or reports a failure or a blocker, say it plainly in one or two sentences meant to be spoken. Otherwise an empty string.
When the prompt says an opening sentence was already read aloud, do not repeat it: continue from it.`

// ---------------------------------------------------------------- text helpers

const baseName = (path: string) => path.split('/').filter(Boolean).pop() ?? path
const dirName = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/'))) || '/'

const plainText = (markdown: string) =>
  markdown
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>|]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/\s+/g, ' ')
    .trim()

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`

// Splits at sentence punctuation followed by a space, so "turn.complete" stays whole.
const sentencesOf = (text: string) =>
  text
    .split(/(?<=[.!?]["')\]]*)\s+/)
    .map(part => part.trim())
    .filter(part => part !== '')

// The opening sentence; a very short one ("Done.") takes the next along.
const leadOf = (plain: string) => {
  const [first = '', second = ''] = sentencesOf(plain)
  return first.length < 25 && second !== '' ? `${first} ${second}` : first
}

const firstSentences = (text: string, maxChars: number) => {
  let out = ''
  for (const sentence of sentencesOf(text)) {
    if (out !== '' && (out + ' ' + sentence).length > maxChars) break
    out = out === '' ? sentence : `${out} ${sentence}`
    if (out.length > maxChars) break
  }
  return (out || text.slice(0, maxChars)).trim()
}

const trimAnswer = (answer: string) => {
  if (answer.length <= MAX_ANSWER_CHARS) return answer
  const head = answer.slice(0, MAX_ANSWER_CHARS * 0.6)
  const tail = answer.slice(-MAX_ANSWER_CHARS * 0.4)
  return `${head}\n\n[... middle of the reply cut for length ...]\n\n${tail}`
}

// ---------------------------------------------------------------- summary

type Summary = Pick<TurnRecord, 'headline' | 'spoken' | 'asks' | 'status'>

const fallbackSummary = (plain: string, lead: string): Summary => {
  const rest = plain.startsWith(lead) ? plain.slice(lead.length).trim() : plain
  return {
    status: 'fallback',
    headline: clip(firstSentences(plain, 70), 60),
    spoken: firstSentences(rest || plain, 320),
    asks: '',
  }
}

const parseSummary = (text: string): Summary | null => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    const headline = typeof parsed.headline === 'string' ? parsed.headline.trim() : ''
    const spoken = typeof parsed.spoken === 'string' ? parsed.spoken.trim() : ''
    const asks = typeof parsed.asks === 'string' ? parsed.asks.trim() : ''
    if (spoken === '' && asks === '') return null
    return { status: 'done', headline: clip(headline || spoken || asks, 60), spoken, asks }
  } catch {
    return null
  }
}

const summarize = async ($: $, answer: string, plain: string, lead: string): Promise<Summary> => {
  const reply = await $.model.complete({
    model: 'haiku',
    system: SYSTEM,
    prompt: `This opening sentence was already read aloud to the developer: "${lead}"\n\nThe coding agent's full reply follows.\n\n<reply>\n${trimAnswer(answer)}\n</reply>`,
    maxTokens: 300,
    effort: 'low',
    timeoutMs: 20000,
  })
  if (!reply.isAnswered) {
    $.ui.log(`clausper: summary not answered (${reply.reason})`, { to: 'debug' })
    return fallbackSummary(plain, lead)
  }
  return parseSummary(reply.text) ?? fallbackSummary(plain, lead)
}

// ---------------------------------------------------------------- speech

const voiceOptions = async ($: $) => {
  const voice = await $.store.get('voice')
  return typeof voice === 'string' && voice !== '' ? { voice } : undefined
}

// Speaks sentence by sentence so the caption follows the voice.
const speak = async ($: $, text: string) => {
  const words = text.trim().slice(0, 4000)
  if (words === '') return
  speakGeneration += 1
  const generation = speakGeneration
  const voice = await voiceOptions($)
  await update($, isSpeaking, () => true)
  try {
    for (const sentence of sentencesOf(words)) {
      if (generation !== speakGeneration) break
      await update($, caption, () => sentence)
      await $.audio.speak(sentence, voice)
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    $.ui.toast(`Clausper could not speak: ${reason}`)
    $.ui.log(`clausper: speech failed: ${reason}`, { to: 'debug' })
  } finally {
    if (generation === speakGeneration) {
      await update($, caption, () => null)
      await update($, isSpeaking, () => false)
    }
  }
}

const stopSpeaking = async ($: $) => {
  speakGeneration += 1
  try {
    await $.process.run(['killall', 'say'], { timeoutMs: 3000 })
  } catch {
    // nothing was speaking
  }
  await update($, caption, () => null)
  await update($, isSpeaking, () => false)
}

const spokenFor = (turn: TurnRecord) =>
  [turn.lead, turn.spoken, turn.asks].filter(part => part !== '').join(' ')

const sayLast = async ($: $) => {
  const [last] = await read($, turns)
  if (last === undefined) {
    $.ui.toast('Clausper: nothing to say yet')
    return
  }
  await speak($, spokenFor(last))
}

// ---------------------------------------------------------------- listening

type Ears = { recorder: string | null; whisper: string | null; model: string | null }

const firstPresent = async ($: $, names: string[], dirs: string[]) => {
  for (const name of names) {
    const found = await $.process.run(['which', name], { timeoutMs: 3000 }).catch(() => null)
    if (found !== null && found.exitCode === 0 && found.stdout.trim() !== '') return found.stdout.trim()
    for (const dir of dirs) {
      if (await $.fs.exists(`${dir}/${name}`)) return `${dir}/${name}`
    }
  }
  return null
}

const findEars = async ($: $): Promise<Ears> => {
  const home = (await $.env.get('HOME')) ?? '/tmp'
  const dirs = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
  const override = await $.env.get('CLAUSPER_WHISPER_MODEL')
  const modelPath = override ?? `${home}/.clausper/models/${MODEL_FILE}`
  return {
    recorder: await firstPresent($, ['rec'], dirs),
    whisper: await firstPresent($, ['whisper-cli', 'whisper-cpp', 'main'], dirs.slice(0, 2)),
    model: (await $.fs.exists(modelPath)) ? modelPath : null,
  }
}

const earsReport = (ears: Ears) =>
  [
    `recorder (sox rec): ${ears.recorder ?? 'missing  → brew install sox'}`,
    `whisper (whisper.cpp): ${ears.whisper ?? 'missing  → brew install whisper-cpp'}`,
    `model: ${ears.model ?? `missing  → curl -L -o ~/.clausper/models/${MODEL_FILE} https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_FILE}`}`,
  ].join('\n')

const cleanTranscript = (raw: string) =>
  raw
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const CANCEL = /^(cancel|never ?mind|nothing|no|nope|skip|stop|not now|that's all|thanks?|thank you)[.!]?$/i

// Records until a pause, transcribes, and hands the words to the prompt.
const listenOnce = async ($: $, options: { ask: boolean }) => {
  if (await read($, isListening)) return
  const ears = await findEars($)
  if (ears.recorder === null || ears.whisper === null || ears.model === null) {
    $.ui.toast('Clausper cannot listen yet: run /clausper setup')
    return
  }
  await update($, isListening, () => true)
  const mode = await read($, listenMode)
  const wav = `/tmp/clausper-${Date.now()}.wav`
  try {
    if (options.ask) await speak($, 'What next?')
    await update($, caption, () => 'Listening… speak, then pause. Say "cancel" to skip.')
    $.ui.status('Clausper: listening…')

    // Wait for sound, stop after 1.6 s of quiet, never longer than RECORD_SECONDS.
    const recorded = await $.process
      .run(
        [ears.recorder, '-q', '-r', '16000', '-c', '1', '-b', '16', wav,
          'silence', '1', '0.15', '4%', '1', '1.6', '4%', 'trim', '0', String(RECORD_SECONDS)],
        { timeoutMs: (RECORD_SECONDS + 10) * 1000 },
      )
      .catch(() => null)
    if (recorded === null || !(await $.fs.exists(wav))) {
      await speak($, "I didn't hear anything.")
      return
    }

    await update($, caption, () => 'Transcribing…')
    const result = await $.process.run(
      [ears.whisper, '-m', ears.model, '-f', wav, '-nt', '-np', '-l', 'en', '-t', '8'],
      { timeoutMs: 60000 },
    )
    const text = cleanTranscript(result.stdout)
    if (result.exitCode !== 0 || text === '') {
      $.ui.log(`clausper: transcription failed (${result.exitCode}): ${result.stderr.slice(0, 200)}`, { to: 'debug' })
      await speak($, "I didn't catch that.")
      return
    }
    if (CANCEL.test(text)) {
      await speak($, 'Okay.')
      return
    }

    await update($, heard, () => text)
    if (mode === 'fill') {
      const filled = await $.prompt.fill({ text, mode: 'replace' })
      await speak($, filled.isFilled ? "It's in the prompt. Press enter to send." : 'I could not reach the prompt box.')
      return
    }
    $.ui.toast(`Clausper heard: ${clip(text, 80)}`)
    await $.prompt.submit({ text, asUser: true })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    $.ui.toast(`Clausper could not listen: ${reason}`)
    $.ui.log(`clausper: listen failed: ${reason}`, { to: 'debug' })
  } finally {
    $.ui.status(undefined)
    await update($, caption, () => null)
    await update($, isListening, () => false)
    void $.process.run(['rm', '-f', wav], { timeoutMs: 3000 }).catch(() => null)
  }
}

const setListenMode = async ($: $, mode: ListenMode) => {
  await $.store.set('listenMode', mode)
  await update($, listenMode, () => mode)
}

// ---------------------------------------------------------------- the digest

const patchTurn = ($: $, id: string, patch: Partial<TurnRecord>) =>
  update($, turns, list => list.map(turn => (turn.id === id ? { ...turn, ...patch } : turn)))

const afterSpeaking = async ($: $) => {
  if ((await read($, listenMode)) === 'off') return
  await listenOnce($, { ask: true })
}

const digest = async ($: $, id: string, answer: string) => {
  const started = await $.clock.now()
  const plain = plainText(answer)
  const muted = await read($, isMuted)

  // Short reply: say it as it is, right away.
  if (plain.length <= SHORT_REPLY_CHARS) {
    await patchTurn($, id, {
      status: 'done',
      headline: clip(firstSentences(plain, 70), 60),
      lead: plain,
      spoken: '',
      asks: '',
      summaryMs: 0,
    })
    $.ui.status(undefined)
    if (!muted) await speak($, plain)
    await afterSpeaking($)
    return
  }

  // Long reply: speak the opening sentence now while Haiku writes the rest.
  const lead = clip(leadOf(plain), 220)
  await patchTurn($, id, { lead, headline: clip(lead, 60) })
  const leadSpoken = muted ? Promise.resolve() : speak($, lead)
  const summary = await summarize($, answer, plain, lead)
  const summaryMs = (await $.clock.now()) - started
  await patchTurn($, id, { ...summary, summaryMs })
  $.ui.status(undefined)
  $.ui.log(`clausper: summary in ${summaryMs} ms (${summary.status})`, { to: 'debug' })
  await leadSpoken
  if (!muted) await speak($, [summary.spoken, summary.asks].filter(part => part !== '').join(' '))
  await afterSpeaking($)
}

// ---------------------------------------------------------------- change details

const describeChange = async ($: $, change: Change): Promise<{ text: string | null; note: string }> => {
  if (change.kind === 'ran') {
    return { text: change.command ?? null, note: 'Command this turn ran' }
  }
  const path = change.path
  if (path === undefined) return { text: null, note: 'No path recorded' }
  try {
    const diff = await $.process.run(['git', 'diff', '--', path], {
      cwd: dirName(path),
      timeoutMs: 10000,
    })
    if (diff.exitCode === 0 && diff.stdout.trim() !== '') {
      return { text: diff.stdout, note: 'Uncommitted diff (git)' }
    }
    const status = await $.process.run(['git', 'status', '--porcelain', '--', path], {
      cwd: dirName(path),
      timeoutMs: 10000,
    })
    if (status.exitCode === 0 && status.stdout.startsWith('??')) {
      const text = await $.fs.read(path)
      return { text: text.split('\n').slice(0, 120).join('\n'), note: 'New file, not yet tracked by git (first 120 lines)' }
    }
    if (status.exitCode === 0 && status.stdout.trim() === '') {
      return { text: null, note: 'No uncommitted changes for this file (already committed, or reverted)' }
    }
  } catch {
    // not a git repository, or git is missing: fall through to the file itself
  }
  try {
    const text = await $.fs.read(path)
    return { text: text.split('\n').slice(0, 120).join('\n'), note: 'Not in a git repository: showing the file (first 120 lines)' }
  } catch {
    return { text: null, note: 'The file could not be read' }
  }
}

const ago = (then: number, now: number) => {
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${Math.round(seconds / 3600)}h`
}

const statusMark = (turn: TurnRecord) =>
  turn.status === 'summarizing' ? '…' : turn.status === 'fallback' ? '~' : '•'

const kindMark = (change: Change) =>
  change.kind === 'write' ? '+' : change.kind === 'ran' ? '$' : '±'

const USAGE =
  'Usage: /clausper [mute | unmute | again | stop | captions on|off | listen [auto|fill|off] | setup | voice <name> | voices | test]'

// ---------------------------------------------------------------- register

export const register: Register = on => {
  // Changes recorded during the turn in flight; moved onto the turn's record
  // at turn.complete. Module state: a reload mid-turn loses only this turn's list.
  let currentTurnId: string | null = null
  let pending: Change[] = []
  let changeSerial = 0

  const record = (change: Omit<Change, 'id' | 'count'>) => {
    const same = pending.find(
      one => one.kind === change.kind && one.path === change.path && one.command === change.command,
    )
    if (same !== undefined) {
      same.count += 1
      return
    }
    changeSerial += 1
    pending.push({ ...change, id: `c${changeSerial}`, count: 1 })
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'clausper',
      description:
        'Clausper: open the pane; or mute | unmute | again | stop | captions on|off | listen [auto|fill|off] | setup | voice <name> | voices | test',
    })
    const stored = await $.store.get('listenMode')
    if (stored === 'auto' || stored === 'fill' || stored === 'off') {
      await update($, listenMode, () => stored)
    }
    void $.ui.open({ id: PANE, title: 'Clausper' })

    return next(e)
  })

  on('command.run', { command: 'clausper' }, async ($, e) => {
    const [word = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ')
    switch (word.toLowerCase()) {
      case '':
        await $.ui.open({ id: PANE, title: 'Clausper' })
        return { text: 'Clausper pane opened.' }
      case 'mute':
        await update($, isMuted, () => true)
        return { text: 'Clausper muted. Summaries still show in the pane.' }
      case 'unmute':
        await update($, isMuted, () => false)
        return { text: 'Clausper unmuted.' }
      case 'again':
      case 'last':
        later($, () => sayLast($))
        return { text: 'Saying the last summary again.' }
      case 'stop':
        await stopSpeaking($)
        return { text: 'Stopped speaking.' }
      case 'captions':
      case 'subtitles': {
        const isOn = arg.toLowerCase() !== 'off'
        await update($, showCaptions, () => isOn)
        return { text: isOn ? 'Captions on: the spoken sentence shows above the prompt.' : 'Captions off.' }
      }
      case 'listen': {
        const choice = arg.toLowerCase()
        if (choice === 'auto' || choice === 'fill' || choice === 'off') {
          await setListenMode($, choice)
          return {
            text:
              choice === 'off'
                ? 'Listen mode off.'
                : choice === 'auto'
                  ? 'Listen mode auto: after each summary Clausper asks "What next?", listens, and sends what you say.'
                  : 'Listen mode fill: after each summary Clausper listens and puts what you say in the prompt box for you to send.',
          }
        }
        if (choice !== '') return { text: USAGE }
        later($, () => listenOnce($, { ask: false }))
        return { text: 'Listening… speak, then pause.' }
      }
      case 'setup': {
        const ears = await findEars($)
        const ready = ears.recorder !== null && ears.whisper !== null && ears.model !== null
        return {
          text: `${earsReport(ears)}\n\n${
            ready
              ? 'Ready to listen. Try /clausper listen, or turn it on after every reply with /clausper listen auto.'
              : 'Install what is missing, then run /clausper setup again.'
          }`,
        }
      }
      case 'voice': {
        if (arg === '' || arg === 'default') {
          await $.store.delete('voice')
          return { text: 'Clausper will use the system default voice.' }
        }
        await $.store.set('voice', arg)
        later($, () => speak($, `Hi, this is ${arg}. I am Clausper.`))
        return { text: `Clausper voice set to ${arg}.` }
      }
      case 'voices': {
        const listed = await $.process.run(['say', '-v', '?'], { timeoutMs: 10000 })
        const names = listed.stdout
          .split('\n')
          .map(line => line.split(/\s{2,}/)[0]?.trim() ?? '')
          .filter(name => name !== '')
        return {
          text:
            names.length === 0
              ? 'No system voices found.'
              : `System voices (${names.length}): ${names.join(', ')}\n\nPick one with /clausper voice <name>.`,
        }
      }
      case 'test':
        later($, () => speak($, 'Clausper is listening. I will tell you what Claude did after each turn.'))
        return { text: 'Speaking a test line.' }
      default:
        return { text: USAGE }
    }
  })

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) {
      currentTurnId = e.turnId
      pending = []
      $.ui.status(undefined)
    }

    return next(e)
  })

  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit', 'Bash'] }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || currentTurnId === null) return ran

    if (e.tool === 'Edit') {
      record({ kind: 'edit', label: baseName(e.file_path), path: e.file_path })
    } else if (e.tool === 'Write') {
      record({ kind: 'write', label: baseName(e.file_path), path: e.file_path })
    } else if (e.tool === 'NotebookEdit') {
      record({ kind: 'notebook', label: baseName(e.notebook_path), path: e.notebook_path })
    } else if (e.tool === 'Bash') {
      if (ran.isReadOnly === true) return ran
      const label = e.description?.trim() || clip(e.command.trim(), 60)
      record({ kind: 'ran', label, command: e.command })
    }
    const files = pending.filter(one => one.kind !== 'ran').length
    $.ui.status(`Clausper: ${files} file${files === 1 ? '' : 's'} touched this turn`)

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer' || e.answer.trim() === '') return done

    const changes = pending
    pending = []
    const turn: TurnRecord = {
      id: e.turnId,
      at: await $.clock.now(),
      status: 'summarizing',
      headline: 'Summarizing…',
      lead: '',
      spoken: '',
      asks: '',
      changes,
      answerChars: e.answer.length,
      summaryMs: 0,
    }
    await update($, turns, list => [turn, ...list.filter(one => one.id !== turn.id)].slice(0, MAX_TURNS))
    await update($, view, (current): View => (current.kind === 'list' ? current : { kind: 'list' }))
    $.ui.status('Clausper: summarizing…')

    // The digest outlives this dispatch: a timer carries it.
    const answer = e.answer
    $.clock.after(0, () => {
      void digest($, turn.id, answer)
    })

    return done
  })

  // ---------------------------------------------------------------- pane

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const list = await read($, turns)
    const current = await read($, view)
    const muted = await read($, isMuted)
    const speaking = await read($, isSpeaking)
    const listening = await read($, isListening)
    const saying = await read($, caption)
    const ears = await read($, listenMode)
    const lastHeard = await read($, heard)
    const now = await $.clock.now()
    const width = Math.max(20, e.props.bodyColumns)

    const setView = (next: View) => update($, view, () => next)
    const showList = () => setView({ kind: 'list' })
    const showTurn = (turnId: string) => setView({ kind: 'turn', turnId })
    const showDetail = async (turn: TurnRecord, change: Change) => {
      await setView({ kind: 'detail', turnId: turn.id, changeId: change.id, text: null, note: 'Loading…' })
      const detail = await describeChange($, change)
      await setView({ kind: 'detail', turnId: turn.id, changeId: change.id, ...detail })
    }

    const state = listening ? 'listening…' : speaking ? 'speaking…' : muted ? 'muted' : 'ready'
    const header = (
      <Box flexDirection="column" marginBottom={1}>
        <Box gap={1}>
          <Text bold>Clausper</Text>
          <Text dimColor>{state}</Text>
          <Text dimColor>· ears {ears}</Text>
        </Box>
        <Box gap={1} flexWrap="wrap">
          <Button key="mute" hotkey="m" plain onPress={() => update($, isMuted, value => !value)}>
            {muted ? 'unmute' : 'mute'}
          </Button>
          <Button key="again" hotkey="a" plain onPress={() => later($, () => sayLast($))}>
            say again
          </Button>
          <Button key="stop" hotkey="s" plain onPress={() => stopSpeaking($)}>
            stop
          </Button>
          <Button key="listen" hotkey="l" plain onPress={() => later($, () => listenOnce($, { ask: false }))}>
            listen
          </Button>
        </Box>
        {(speaking || listening) && saying !== null && (
          <Box marginTop={1}>
            <Text color={listening ? 'green' : 'cyan'} italic wrap="wrap">
              {saying}
            </Text>
          </Box>
        )}
        {lastHeard !== null && !listening && (
          <Text dimColor wrap="truncate-end">
            heard: {lastHeard}
          </Text>
        )}
      </Box>
    )

    if (current.kind === 'list') {
      return (
        <Box flexDirection="column">
          {header}
          {list.length === 0 && (
            <Text dimColor wrap="wrap">
              Nothing yet. After each reply I'll say what happened and list the files touched.
            </Text>
          )}
          {list.map(turn => (
            <Box key={`row:${turn.id}`} flexDirection="column" marginBottom={1}>
              <Button key={`turn:${turn.id}`} plain onPress={() => showTurn(turn.id)}>
                {statusMark(turn)} {clip(turn.headline, width - 10)} <Text dimColor>{ago(turn.at, now)}</Text>
              </Button>
              <Text dimColor>
                {'  '}
                {turn.changes.length === 0
                  ? 'no changes'
                  : `${turn.changes.length} change${turn.changes.length === 1 ? '' : 's'}: ${clip(
                      turn.changes.map(change => change.label).join(', '),
                      width - 16,
                    )}`}
              </Text>
            </Box>
          ))}
        </Box>
      )
    }

    const turn = list.find(one => one.id === current.turnId)
    if (turn === undefined) {
      return (
        <Box flexDirection="column">
          {header}
          <Button key="back" hotkey="b" plain onPress={showList}>
            ← back
          </Button>
          <Text dimColor>That turn is gone.</Text>
        </Box>
      )
    }

    if (current.kind === 'turn') {
      return (
        <Box flexDirection="column">
          {header}
          <Box gap={1}>
            <Button key="back" hotkey="b" plain onPress={showList}>
              ← back
            </Button>
            <Button key={`say:${turn.id}`} hotkey="r" plain onPress={() => later($, () => speak($, spokenFor(turn)))}>
              read this one
            </Button>
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text bold wrap="wrap">
              {turn.headline}
            </Text>
            <Text dimColor>
              {ago(turn.at, now)} ago · {turn.answerChars} chars in the reply
              {turn.summaryMs > 0 ? ` · summary in ${(turn.summaryMs / 1000).toFixed(1)}s` : ''}
              {turn.status === 'fallback' ? ' · summary from the reply itself' : ''}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text wrap="wrap">{turn.status === 'summarizing' ? `${turn.lead} …` : spokenFor(turn)}</Text>
          </Box>
          {turn.asks !== '' && (
            <Box marginTop={1}>
              <Text color="yellow" wrap="wrap">
                Needs you: {turn.asks}
              </Text>
            </Box>
          )}
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>{turn.changes.length === 0 ? 'No files touched.' : 'Touched this turn:'}</Text>
            {turn.changes.map(change => (
              <Button key={`change:${turn.id}:${change.id}`} plain onPress={() => showDetail(turn, change)}>
                {kindMark(change)} {clip(change.label, width - 8)}
                {change.count > 1 ? <Text dimColor> ×{change.count}</Text> : ''}
              </Button>
            ))}
          </Box>
        </Box>
      )
    }

    const change = turn.changes.find(one => one.id === current.changeId)
    return (
      <Box flexDirection="column">
        {header}
        <Box gap={1} flexWrap="wrap">
          <Button key="back-turn" hotkey="b" plain onPress={() => showTurn(turn.id)}>
            ← back
          </Button>
          {change?.path !== undefined && (
            <Button
              key={`open:${change.id}`}
              hotkey="o"
              plain
              onPress={() => $.process.run(['open', change.path ?? ''], { timeoutMs: 5000 })}
            >
              open in editor
            </Button>
          )}
          {change !== undefined && (
            <Button
              key={`copy:${change.id}`}
              hotkey="c"
              plain
              onPress={() => $.ui.copy({ text: change.path ?? change.command ?? change.label, surface: e.surface })}
            >
              copy {change.path !== undefined ? 'path' : 'command'}
            </Button>
          )}
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text bold wrap="wrap">
            {change === undefined ? 'That change is gone.' : change.path ?? change.label}
          </Text>
          <Text dimColor wrap="wrap">
            {current.note}
          </Text>
        </Box>
        {current.text !== null && (
          <Box marginTop={1}>
            <Code source={current.text} language={change?.kind === 'ran' ? 'bash' : 'diff'} />
          </Box>
        )}
      </Box>
    )
  })

  // ---------------------------------------------------------------- band
  // Above the prompt: the caption while speaking or listening; otherwise the
  // last headline while the pane is not placed (narrow terminal).

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const width = Math.max(20, e.props.bodyColumns)

    const speaking = await read($, isSpeaking)
    const listening = await read($, isListening)
    const saying = await read($, caption)
    if ((speaking || listening) && saying !== null && (await read($, showCaptions))) {
      return (
        <Box gap={1}>
          <Text dimColor>Clausper</Text>
          <Text color={listening ? 'green' : 'cyan'} italic wrap="wrap">
            {saying}
          </Text>
          {speaking && (
            <Button key="caption-stop" plain onPress={() => stopSpeaking($)}>
              stop
            </Button>
          )}
        </Box>
      )
    }

    const [last] = await read($, turns)
    if (last === undefined) return next(e)
    const panes = await $.ui.panes()
    if (panes.some(pane => pane.id === PANE && pane.isPlaced)) return next(e)

    return (
      <Box gap={1}>
        <Text dimColor>Clausper:</Text>
        <Text wrap="truncate-end">{clip(last.headline, width - 40)}</Text>
        <Button key="band-open" plain onPress={() => $.ui.open({ id: PANE, title: 'Clausper' })}>
          open
        </Button>
        <Button key="band-again" plain onPress={() => later($, () => sayLast($))}>
          say again
        </Button>
      </Box>
    )
  })
}
