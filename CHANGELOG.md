# Changelog

All notable changes to Clausper. Dates are when the change shipped to the mod.

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
