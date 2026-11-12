// Two short cue tones, built in code at load time so the plugin ships neither
// binary files nor encoded data: a 90 ms sine with a soft fade, as a WAV clip.

const SAMPLE_RATE = 22050
const DURATION_MS = 90
const AMPLITUDE = 0.25

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const toBase64 = (bytes: Uint8Array) => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += ALPHABET[(n >> 18) & 63]
    out += ALPHABET[(n >> 12) & 63]
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '='
    out += i + 2 < bytes.length ? ALPHABET[n & 63] : '='
  }
  return out
}

const writeAscii = (view: DataView, offset: number, text: string) => {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
}

// 16-bit mono PCM WAV: a 44-byte header followed by the samples.
const sineWav = (hz: number) => {
  const count = Math.round((SAMPLE_RATE * DURATION_MS) / 1000)
  const buffer = new ArrayBuffer(44 + count * 2)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + count * 2, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, count * 2, true)
  const fadeIn = SAMPLE_RATE * 0.01
  const fadeOut = SAMPLE_RATE * 0.03
  for (let i = 0; i < count; i += 1) {
    const env = Math.min(1, i / fadeIn, (count - i) / fadeOut)
    const sample = Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE) * AMPLITUDE * env
    view.setInt16(44 + i * 2, Math.round(sample * 32767), true)
  }
  return new Uint8Array(buffer)
}

export const beepClip = (hz: number) => ({ base64: toBase64(sineWav(hz)), mime: 'audio/wav' })

/** Listening has started: speak now. */
export const BEEP_START = beepClip(880)
/** Listening has stopped. */
export const BEEP_STOP = beepClip(587)
