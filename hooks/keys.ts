import type { EngineInterface } from 'claude-code'

import { platform, sha256Of } from './platform'

// Global shortcuts on macOS: keys/clausper-keys.swift, built once with the
// Xcode command line tools into ~/.clausper/bin and run beside each session. It
// registers each chord with Carbon's RegisterEventHotKey, which needs no
// Accessibility permission and sees no other key, and prints `press <action>`.
// Linux has no such helper yet.
//
// Each helper that takes $ is a function declaration: the engine follows $ past
// an import only into those.

type Engine = EngineInterface

export const KEY_ACTIONS = ['stop', 'mute', 'again', 'listen'] as const
export type KeyAction = (typeof KEY_ACTIONS)[number]
export type KeyBindings = Partial<Record<KeyAction, string>>

export const DEFAULT_KEYS: KeyBindings = { stop: 'ctrl+alt+s' }

const MODIFIERS = new Set(['cmd', 'command', 'super', 'shift', 'alt', 'opt', 'option', 'ctrl', 'control'])
const NAMED_KEYS = new Set([
  'space', 'escape', 'esc', 'return', 'enter', 'tab', 'delete', 'up', 'down', 'left', 'right',
  ...Array.from({ length: 19 }, (_, index) => `f${index + 1}`),
])

// "Shift+Cmd+S" -> "shift+cmd+s", or null when it is no chord the helper takes:
// one key, and at least one modifier unless the key is a function key.
export function normalChord(text: string): string | null {
  const parts = text.toLowerCase().replace(/\s+/g, '').split('+').filter(part => part !== '')
  const key = parts.pop()
  if (key === undefined) return null
  if (!(NAMED_KEYS.has(key) || /^[a-z0-9.,/;'[\]\-=`\\]$/.test(key))) return null
  if (parts.some(part => !MODIFIERS.has(part))) return null
  if (parts.length === 0 && !/^f\d+$/.test(key)) return null
  return [...new Set(parts), key].join('+')
}

// The stored bindings, the defaults when none were ever set, `{}` when turned off.
export function storedKeys(value: unknown): KeyBindings {
  if (value === 'off') return {}
  if (value === null || typeof value !== 'object') return DEFAULT_KEYS
  const keys: KeyBindings = {}
  for (const action of KEY_ACTIONS) {
    const chord = (value as Record<string, unknown>)[action]
    if (typeof chord === 'string' && normalChord(chord) !== null) keys[action] = chord
  }
  return keys
}

// The built helper, rebuilt when its source changes; null with the reason when
// it cannot be built (not macOS, no command line tools, a compile error).
export async function keysHelper($: Engine): Promise<{ path: string } | { reason: string }> {
  if ((await platform($)) !== 'macos') return { reason: 'global shortcuts are macOS only for now' }
  const home = await $.env.get('HOME')
  if (home === undefined || !home.startsWith('/')) return { reason: 'no home folder' }
  const source = `${$.plugin.root}/keys/clausper-keys.swift`
  const bin = `${home}/.clausper/bin`
  const path = `${bin}/clausper-keys`
  const digest = await sha256Of($, source)
  try {
    if ((await $.fs.exists(path)) && String(await $.fs.read(`${path}.sha256`)).trim() === digest) return { path }
  } catch {
    // no digest beside it: build it again
  }
  // Without the tools /usr/bin/swiftc opens the installer instead, so ask first.
  const tools = await $.process.run(['/usr/bin/xcode-select', '-p'], { timeoutMs: 5000 })
  if (tools.exitCode !== 0) return { reason: 'the Xcode command line tools are not installed (xcode-select --install)' }
  await $.process.run(['mkdir', '-p', bin], { timeoutMs: 5000 })
  // Built aside and moved into place, so two sessions building at once never run half a file.
  const aside = `${path}.${crypto.randomUUID()}`
  const built = await $.process.run(['/usr/bin/xcrun', 'swiftc', '-O', '-o', aside, source], { timeoutMs: 180000 })
  if (built.exitCode !== 0) {
    await $.process.run(['rm', '-f', aside], { timeoutMs: 5000 })
    return { reason: `the shortcut helper did not build: ${built.stderr.trim().split('\n').slice(-1)[0] ?? ''}` }
  }
  await $.process.run(['mv', '-f', aside, path], { timeoutMs: 5000 })
  await $.fs.write(`${path}.sha256`, `${digest}\n`)
  return { path }
}

// Runs the helper until `stop` is called or it exits, handing each line it prints to `onLine`.
export function runKeysHelper($: Engine, path: string, keys: KeyBindings, onLine: (line: string) => void) {
  const argv = [path, ...KEY_ACTIONS.flatMap(action => (keys[action] === undefined ? [] : [`${action}=${keys[action]}`]))]
  const stream = $.process.spawn({ argv })
  let buffered = ''
  const done = (async () => {
    for await (const piece of stream) {
      if (piece.stream !== 'stdout') continue
      buffered += piece.text
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      for (const line of lines) if (line.trim() !== '') onLine(line.trim())
    }
  })()
  return {
    done,
    stop: () => {
      stream.return({ code: null, signal: null }).catch(() => undefined)
    },
  }
}
