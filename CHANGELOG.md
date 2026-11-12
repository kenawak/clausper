# Changelog

All notable changes to Clausper. Dates are when the change shipped to the mod.

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
