import type { EngineInterface } from 'claude-code'

// What differs between macOS and Linux. On macOS Claude Code itself speaks
// (`say`) and plays clips (`afplay`); on Linux it has no player, so Clausper runs
// its own: espeak-ng (or spd-say) for the system voice, and pw-play, paplay,
// aplay or sox `play` for Kokoro's clips and the listening cues. Every program is
// looked up in fixed folders, never on PATH, and run directly, without a shell.
//
// Each helper that takes $ is a function declaration: the engine follows $ past
// an import only into those.

type Engine = EngineInterface

export type Os = 'macos' | 'linux' | 'other'

let os: Os | null = null

// Asked once per load. Anything but Linux keeps the engine's own speech and
// playback, which is what macOS uses.
export async function platform($: Engine): Promise<Os> {
  if (os !== null) return os
  try {
    const named = await $.process.run(['uname', '-s'], { timeoutMs: 3000 })
    const kernel = named.stdout.trim()
    os = kernel === 'Darwin' ? 'macos' : kernel === 'Linux' ? 'linux' : 'other'
  } catch {
    os = 'other'
  }
  return os
}

export async function isLinux($: Engine) {
  return (await platform($)) === 'linux'
}

// Where package managers put programs. macOS: Homebrew (Apple Silicon, then
// Intel), then the system. Linux: the distribution, then /usr/local, then
// Homebrew on Linux.
export async function binDirs($: Engine): Promise<string[]> {
  return (await isLinux($))
    ? ['/usr/bin', '/usr/local/bin', '/home/linuxbrew/.linuxbrew/bin']
    : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
}

async function firstIn($: Engine, names: string[], dirs: string[]) {
  for (const name of names) {
    for (const dir of dirs) {
      const isThere = await $.fs.exists(`${dir}/${name}`)
      if (isThere) return `${dir}/${name}`
    }
  }
  return null
}

// How to install a missing piece, said the way this system installs things.
export async function installHint($: Engine, brew: string, apt: string) {
  return (await isLinux($)) ? `sudo apt install ${apt} (or your distribution's package)` : `brew install ${brew}`
}

// ---------------------------------------------------------------- children

// The programs Clausper started to speak or play on Linux; stop ends them all.
const children = new Set<() => void>()

// Runs a program to its end, its whole life inside this call; stop (unless
// `isStoppable` is false), or an abort of `signal`, ends it early. Resolves the
// exit code, or null when killed.
async function runToEnd(
  $: Engine,
  argv: string[],
  options: { input?: string; signal?: AbortSignal; isStoppable?: boolean } = {},
): Promise<number | null> {
  const stream = $.process.spawn(options.input === undefined ? { argv } : { argv, input: options.input })
  let isKilled = false
  const kill = () => {
    isKilled = true
    stream.return({ code: null, signal: null }).catch(() => undefined)
  }
  if (options.isStoppable !== false) children.add(kill)
  options.signal?.addEventListener('abort', kill, { once: true })
  try {
    for await (const piece of stream) {
      if (isKilled) break
      void piece
    }
    if (isKilled) return null
    const ended = await stream.result
    return ended.code
  } finally {
    children.delete(kill)
    options.signal?.removeEventListener('abort', kill)
  }
}

// ---------------------------------------------------------------- speech

const SYNTHS = ['espeak-ng', 'espeak', 'spd-say']

export async function findSynth($: Engine) {
  return firstIn($, SYNTHS, await binDirs($))
}

// Says one sentence with the system voice: the engine's own on macOS; on Linux
// espeak-ng, espeak or spd-say, the text on standard input so nothing in it is
// read as an option.
export async function sayWithSystem($: Engine, sentence: string, voice: string | undefined) {
  if (!(await isLinux($))) {
    await $.audio.speak(sentence, voice === undefined ? undefined : { voice })
    return
  }
  const synth = await findSynth($)
  if (synth === null) throw new Error('no speech synthesizer: sudo apt install espeak-ng')
  const isSpd = synth.endsWith('spd-say')
  const voiceArgs = voice === undefined ? [] : isSpd ? ['-y', voice] : ['-v', voice]
  const argv = isSpd ? [synth, '-w', '-e', ...voiceArgs] : [synth, ...voiceArgs, '--stdin']
  const code = await runToEnd($, argv, { input: `${sentence}\n` })
  if (code !== null && code !== 0) throw new Error(`${synth} exited with ${code}`)
}

// The system voices by name, for /clausper voices.
export async function systemVoices($: Engine): Promise<string[]> {
  if (!(await isLinux($))) {
    const listed = await $.process.run(['say', '-v', '?'], { timeoutMs: 10000 })
    return listed.stdout
      .split('\n')
      .map(line => line.split(/\s{2,}/)[0]?.trim() ?? '')
      .filter(name => name !== '')
  }
  const synth = await findSynth($)
  if (synth === null) return []
  // spd-say -L: a header, then NAME LANGUAGE VARIANT. espeak-ng --voices: a
  // header, then Pty Language Age/Gender VoiceName File; -v takes the language.
  const isSpd = synth.endsWith('spd-say')
  const listed = await $.process.run(isSpd ? [synth, '-L'] : [synth, '--voices'], { timeoutMs: 10000 })
  return listed.stdout
    .split('\n')
    .slice(1)
    .map(line => line.trim().split(/\s+/)[isSpd ? 0 : 1] ?? '')
    .filter(name => name !== '')
}

// Ends the system voice: on macOS every `say` of this user's, as before; on
// Linux only the programs Clausper started.
export async function stopSystemVoice($: Engine) {
  for (const kill of [...children]) kill()
  if (await isLinux($)) return
  try {
    const user = await $.env.get('USER')
    await $.process.run(user ? ['killall', '-u', user, 'say'] : ['killall', 'say'], { timeoutMs: 3000 })
  } catch {
    // nothing was speaking
  }
}

// ---------------------------------------------------------------- clips

const PLAYERS: Record<string, string[]> = {
  'pw-play': [],
  paplay: [],
  aplay: ['-q'],
  play: ['-q'],
}

export async function findPlayer($: Engine) {
  return firstIn($, Object.keys(PLAYERS), await binDirs($))
}

// Plays a WAV file on disk: the engine's player on macOS, one of the Linux
// players otherwise. An abort ends it.
export async function playFile($: Engine, path: string, signal: AbortSignal) {
  if (!(await isLinux($))) {
    const bytes = await $.fs.read(path, { as: 'bytes' })
    await $.audio.play({ base64: bytes.base64, mime: 'audio/wav' }, { signal })
    return
  }
  const player = await findPlayer($)
  if (player === null) throw new Error('no audio player: sudo apt install pipewire-bin, pulseaudio-utils or alsa-utils')
  const name = player.split('/').pop() ?? ''
  const code = await runToEnd($, [player, ...(PLAYERS[name] ?? []), path], { signal })
  if (code !== null && code !== 0) throw new Error(`${name} exited with ${code}`)
}

// A listening cue: the engine plays the clip on macOS; on Linux sox's `play`
// (installed beside `rec`, which listening needs) synthesizes the same tone.
export async function playCue($: Engine, clip: { base64: string; mime: string }, hz: number) {
  if (!(await isLinux($))) {
    await $.audio.play(clip)
    return
  }
  const sox = await firstIn($, ['play'], await binDirs($))
  if (sox === null) return
  await runToEnd($, [sox, '-q', '-n', 'synth', '0.09', 'sine', String(hz), 'vol', '0.25', 'fade', '0.01', '0.09', '0.03'])
}

// ---------------------------------------------------------------- editor and setup

// VS Code's command where each system installs it.
export async function codeDirs($: Engine) {
  return (await isLinux($)) ? ['/usr/bin', '/usr/local/bin', '/snap/bin'] : ['/opt/homebrew/bin', '/usr/local/bin']
}

// What /clausper setup adds on Linux: the synthesizer and the player Clausper runs itself.
export async function speechReport($: Engine) {
  if (!(await isLinux($))) return ''
  const synth = await findSynth($)
  const player = await findPlayer($)
  return [
    `system voice: ${synth ?? 'missing  → sudo apt install espeak-ng'}`,
    `audio player (Kokoro clips): ${player ?? 'missing  → pw-play, paplay, aplay or sox play'}`,
  ].join('\n')
}

// ---------------------------------------------------------------- downloads

// This machine as uv names its builds (`aarch64-apple-darwin`, ...); null on
// anything else.
export async function machineTarget($: Engine): Promise<string | null> {
  const system = await platform($)
  if (system === 'other') return null
  let arch = ''
  try {
    const named = await $.process.run(['uname', '-m'], { timeoutMs: 3000 })
    arch = named.stdout.trim()
  } catch {
    return null
  }
  const cpu = arch === 'arm64' || arch === 'aarch64' ? 'aarch64' : arch === 'x86_64' ? 'x86_64' : null
  if (cpu === null) return null
  return system === 'macos' ? `${cpu}-apple-darwin` : `${cpu}-unknown-linux-gnu`
}

// Downloads `url`, https only, to `path`, telling `onBytes` how much has
// arrived every second. No time limit: a slow connection only takes longer, and
// stop does not end it.
export async function download($: Engine, url: string, path: string, onBytes: (bytes: number) => void) {
  const curl = await firstIn($, ['curl'], ['/usr/bin', '/bin'])
  if (curl === null) throw new Error('curl is not installed')
  let isDone = false
  let timer: { cancel: () => void } | null = null
  const poll = async () => {
    try {
      const stat = await $.fs.stat(path)
      if (!isDone) onBytes(stat.size)
    } catch {
      // not started writing yet
    }
    if (!isDone) timer = $.clock.after(1000, () => void poll())
  }
  timer = $.clock.after(1000, () => void poll())
  try {
    const code = await runToEnd($, [curl, '-fsSL', '--proto', '=https', '--retry', '3', '-o', path, url], { isStoppable: false })
    if (code !== 0) throw new Error(`the download failed (curl exited with ${code ?? 'a signal'}): check the connection`)
  } finally {
    isDone = true
    timer?.cancel()
  }
}

// The file's SHA-256 as lowercase hex: shasum on macOS, sha256sum on Linux.
export async function sha256Of($: Engine, path: string) {
  const linux = await isLinux($)
  const tool = linux ? await firstIn($, ['sha256sum'], ['/usr/bin', '/bin']) : '/usr/bin/shasum'
  if (tool === null) throw new Error('sha256sum is not installed')
  const summed = await $.process.run(linux ? [tool, '--', path] : [tool, '-a', '256', path], { timeoutMs: 120000 })
  return summed.stdout.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
}

// Runs a long setup step (uv fetching packages) with no time limit, keeping the
// end of its error output for the message when it fails.
export async function runLong($: Engine, argv: string[], cwd: string, env: Record<string, string>) {
  const stream = $.process.spawn({ argv, cwd, env })
  let stderr = ''
  for await (const piece of stream) {
    if (piece.stream === 'stderr') stderr = (stderr + piece.text).slice(-2000)
  }
  const ended = await stream.result
  return { code: ended.code, stderr }
}

// Unpacks a .tar.gz into `dir`.
export async function untar($: Engine, archive: string, dir: string) {
  const tar = await firstIn($, ['tar'], ['/usr/bin', '/bin'])
  if (tar === null) throw new Error('tar is not installed')
  const unpacked = await $.process.run([tar, '-xzf', archive, '-C', dir], { timeoutMs: 60000 })
  if (unpacked.exitCode !== 0) throw new Error(`tar exited with ${unpacked.exitCode}`)
}
