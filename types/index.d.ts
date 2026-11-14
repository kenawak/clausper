export type ChangeKind = 'edit' | 'write' | 'notebook' | 'ran'

export type Change = {
  id: string
  kind: ChangeKind
  /** What the row shows: a file's base name, or a command's description. */
  label: string
  /** Absolute path for a file change. */
  path?: string
  /** The command for a `ran` change. */
  command?: string
  /** How many times this turn touched it. */
  count: number
}

export type TurnStatus = 'summarizing' | 'done' | 'fallback'

export type TurnRecord = {
  id: string
  at: number
  status: TurnStatus
  headline: string
  /** The opening sentence spoken at once, before the summary arrived. */
  lead: string
  spoken: string
  asks: string
  changes: Change[]
  answerChars: number
  /** How long the summary took, in milliseconds; 0 when none was needed. */
  summaryMs: number
}

export type View =
  | { kind: 'list' }
  | { kind: 'turn'; turnId: string }
  | { kind: 'detail'; turnId: string; changeId: string; text: string | null; note: string }

/** off: never listen; auto: submit what was heard; fill: put it in the prompt box. */
export type ListenMode = 'off' | 'auto' | 'fill'

declare module 'claude-code' {
  interface PluginState {
    clausper: {
      turns: Shaped<TurnRecord[]>
      view: Shaped<View>
      isMuted: boolean
      isSpeaking: boolean
      caption: string | null
      showCaptions: boolean
      listenMode: ListenMode
      isListening: boolean
      heard: string | null
      /** What the last listen did, in one line: for the pane and for debugging. */
      lastListen: string | null
      /** Only a sentence starting with the wake word is auto-sent. */
      wake: boolean
      /** No model call: summaries come from the reply's own sentences. */
      isPrivate: boolean
    }
  }
}
