# Changelog

All notable changes to Clausper. Dates are when the change shipped to the mod.

## 0.5.0 — 2026-11-19

### Added
- A global key to stop speech on macOS: ⌃⌥S, from any app, even when the terminal is in the background. It stops every session that is speaking, listening or waiting for its turn.
- `/clausper keys` shows and changes the shortcuts: `/clausper keys stop cmd+shift+s` rebinds stop, and `mute` (toggle), `again` and `listen` can get chords too. `/clausper keys off`, `on` and `reset`.
- The caption's stop button shows the chord.
- What each summary costs: the pane shows its tokens and dollars (Claude Haiku 5.5 at API list prices) and the session's total in its header. `/clausper cost` totals this session, today and all time, and the share of the session's cost. Short replies and private mode make no call and cost nothing.
- README: how to update the plugin, check and switch voices, copy the Kokoro model files from another machine (with their hashes), and fix a Kokoro setup that went wrong.

### Security
- The shortcuts come from `keys/clausper-keys.swift`, built on your Mac with `xcrun swiftc` (never downloaded) and rebuilt when its hash changes. It uses macOS hotkey registration: no Accessibility or Input Monitoring permission, and it sees only its own chords. It exits with its session.

## 0.4.1 — 2026-11-17

### Changed
- The Kokoro voice sets itself up. `/clausper voice kokoro` fetches whatever is missing, once: uv 0.13.6 into `~/.clausper/bin` (when no uv is installed), the model files into `~/.clausper/models`, and the pinned packages. Progress shows in the status line, and the system voice keeps speaking until Kokoro is ready. No more `brew install uv` or manual model downloads.
- A one-time tip at the first session points to `/clausper voice kokoro`.

### Security
- Every download is https only and checked against a SHA-256 pinned in the source before it is moved into place; a file that does not match is deleted. The setup runs only when you choose Kokoro or run `/clausper voice install`.

## 0.4.0 — 2026-11-16

### Added
- A natural voice, optional: Kokoro, an open-weight neural text-to-speech model that runs on the Mac, chosen with `/clausper voice kokoro` or a voice name such as `/clausper voice af_heart`. `/clausper voice install` fetches its packages once; `/clausper setup` checks uv, the model files and the packages; `/clausper voices` lists the Kokoro voices beside the system ones.
- The Kokoro audio streams: the first sentence plays while the next is being made, and a long reply's summary is made while its opening sentence plays.
- If Kokoro cannot speak, the system voice says the rest of the utterance and a toast says why.
- Sessions take turns: when several Claude Code sessions finish together, one speaks (and, in listen mode, listens) while the others wait, so summaries no longer play over each other and one spoken answer is never sent to two sessions. A session that waited names its project first.
- Linux: Clausper speaks with espeak-ng (or espeak, or spd-say), plays Kokoro clips through pw-play, paplay, aplay or sox `play`, makes the listening cues with sox, and finds programs in the Linux package folders. `/clausper setup` and `/clausper voices` give Linux instructions. macOS behaves as before.
- The turn is a folder, `~/.clausper/floor`, created with `mkdir`, which only one session can win. A session killed while holding it is taken over after ten seconds; one that exits hands it on at once. Stop in a waiting session gives up its turn.

### Security
- The runner is `tts/kokoro.py`, run by uv with `--offline`, `--locked` (packages pinned by hash in `tts/kokoro.py.lock`) and `--no-config`, from a private `mktemp -d` folder that is deleted afterwards. uv is looked up only in known folders or at `CLAUSPER_UV` under the same rules as the other overrides.
- Overrides are also refused under `/var/tmp` and `/dev/shm`. On Linux the spoken sentence reaches the synthesizer on standard input, never as an argument, and "open in editor" never falls back to `xdg-open`.

## 0.3.1 — 2026-11-14

Fixes from an independent adversarial review of the whole source.

### Security
- "Open in editor" uses `code --goto` or `open -t`, never plain `open`, so a file Claude wrote is shown in a text editor and never launched by its handler.
- The wake word matches only "Clausper", the spellings whisper produces for it, or "Claude". The previous pattern also accepted words such as "clamp" and "clap".
- The `CLAUSPER_RECORDER`, `CLAUSPER_WHISPER` and `CLAUSPER_WHISPER_MODEL` overrides must be absolute paths outside the temporary folder and the session's project folder. Without a `HOME`, Clausper refuses to listen.
- Two brakes on runaway voice sessions: captures under a second are never auto-sent, and after three voice turns in a row without a typed prompt Clausper falls back to the prompt box.
- The summary prompt neutralizes `</reply>` tags and quotes from the reply and tells the model to treat it as text.
- `git diff` and `git status` run with external diff tools and the file monitor disabled, and the diff shown is capped at 100,000 characters.

### Fixed
- Transcripts keep what you said: only whisper's non-speech tags are removed, not every parenthesis. "Clausper, cancel" now cancels instead of being sent, and a bare "no" is submitted as an answer instead of being swallowed.
- Mute silences listen-mode prompts too. Fill never overwrites a draft; it appends.
- A reload during a listen no longer leaves the mod stuck in "listening". A failed summary clears the status line.
- `mktemp` is called with a template GNU mktemp also accepts, so listening can work on Linux.
- Vercel link files that had slipped into the repository are removed.

## 0.3.0 — 2026-11-14

### Security
- Wake word, on by default: in auto listen mode only a sentence that starts with "Clausper" or "Claude" is sent; anything else goes to the prompt box for you to confirm. `/clausper wake off` disables it.
- The recorder and transcriber are looked up only in the package managers' folders or at `CLAUSPER_RECORDER` / `CLAUSPER_WHISPER`; PATH is never searched.
- Each recording lives in a private `mktemp -d` folder (mode 0700) that is deleted afterwards, instead of a predictable file in `/tmp`.
- Stop ends only your own user's speech processes.

### Added
- `/clausper private on|off`: no model call at all; summaries are the reply's own opening sentences.
- SECURITY.md: what the mod does, how to verify it, and how to report.

## 0.2.4 — 2026-11-12

### Changed
- The cue tones are synthesized in code at load time, so the source holds neither binary files nor encoded data.
- The setup hint no longer embeds a download URL; the README says where the model file comes from.

## 0.2.3 — 2026-11-12

### Changed
- The two beep sounds are embedded in the source instead of shipped as `.wav` files, so the plugin contains no binary files.
- Source rewritten to the plugin directory's plain-call rules; no behavior change.
- README documents every program the mod runs, what it sends and where, and what it submits as prompts.

## 0.2.2 — 2026-11-12

### Fixed
- Listening no longer gives up after a click or a breath: captures shorter than a word are retried, up to three times.
- Recorder threshold lowered to 2 % and the stop pause set to 1.5 s, the settings that transcribed correctly in testing.
- Whisper runs with non-speech tokens suppressed and no temperature fallback, so silence no longer becomes "[MUSIC PLAYING]".

### Added
- A short high beep when listening starts and a lower one when it stops.
- A "last listen" line in the pane: seconds recorded and the words heard, or the exact reason nothing was.

## 0.2.1 — 2026-11-12

### Fixed
- Pane buttons that start speech or listening hand the work to a timer, so the 10-second button budget no longer cuts them off.

## 0.2.0 — 2026-11-12

### Added
- Listen mode: after the summary Clausper asks "What next?", records until you pause, transcribes locally with whisper.cpp, and sends your words as the next prompt. `/clausper listen auto|fill|off`, remembered across sessions.
- `/clausper setup` reports the recorder, transcriber and model, with install hints for what is missing.

### Changed
- Short replies are spoken as they are, with no summary call.
- Long replies start with the opening sentence at once while Haiku writes the rest; Haiku is told what was already said.
- The pane shows how long each summary took.

## 0.1.1 — 2026-11-12

### Added
- Captions: the sentence being spoken shows above the prompt and in the pane, in sync, because each sentence is its own utterance. `/clausper captions on|off`.

### Changed
- Stop ends the whole summary instead of only the current sentence.

## 0.1.0 — 2026-11-12

### Added
- Spoken summary of every reply through the macOS system voice, written by Haiku through your own Claude Code session.
- The Clausper pane: each turn with its headline, the files Claude edited or wrote and the commands it ran; press a file for its git diff, to open it, or to copy its path.
- A band above the prompt for terminals too narrow to dock the pane.
- Commands: `/clausper`, `mute`, `unmute`, `again`, `stop`, `voice <name>`, `voices`, `test`.
- Fallback to the reply's own first sentences when the summary call fails.
