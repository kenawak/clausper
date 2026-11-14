# Security

Clausper runs inside Claude Code and can speak, record from the microphone, run a few local
programs and submit prompts. That deserves scrutiny. This page says what it does, how to check,
and how to report a problem.

## How to verify it yourself

The whole mod is one readable TypeScript file, `hooks/register.tsx`, plus `hooks/beeps.ts`
(two generated tones) and `types/index.d.ts`. There is no build step, no bundling, no
dependencies and no minified code: what is in the repository is what runs.

- **Network.** Search the source for `http`, `fetch`, `url` and `socket`. The only network
  activity is one `$.model.complete` call per long reply, which goes through your own Claude
  Code session to the Anthropic API it already uses. `/clausper private on` turns even that
  off. There is no telemetry and no other endpoint.
- **Programs.** Search for `process.run`. Every command is listed in the README under
  "What Clausper does on your machine": the speech synthesizer, `killall -u <you> say`,
  `say -v ?`, `mktemp`, `rec`, `whisper-cli`, `rm -rf` on the one private recording folder,
  `git diff`, `git status`, and `open` on a file you pressed. All run directly, without a shell.
- **Where programs come from.** The recorder and transcriber are looked up in the package
  managers' own folders (`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`). PATH is never
  searched. The overrides `CLAUSPER_RECORDER`, `CLAUSPER_WHISPER` and `CLAUSPER_WHISPER_MODEL`
  are honored only when they are absolute paths outside the temporary folder and outside the
  session's project folder, so a repository cannot point them at a file it ships. Without a
  `HOME`, Clausper does not listen at all.
- **Recordings.** Each listen creates a private folder with `mktemp -d` (mode 0700), records one
  file into it, transcribes it locally, and deletes the folder, success or failure.
- **Prompts.** Search for `prompt.submit` and `prompt.fill`. The only text ever submitted is
  your transcribed speech, minus the wake word and whisper's non-speech tags. It is tagged as the
  plugin's for hooks and the transcript; the model reads it as your words, which is the point.
- **Opening files.** "Open in editor" uses `code --goto` or `open -t`, so a file Claude wrote is
  shown in a text editor, never launched.
- **The summary prompt.** The reply is sent inside `<reply>` tags with any such tags inside it
  neutralized and an instruction to treat it as text. A reply can still steer the wording of its
  own summary, which is why the spoken line is a summary and never a command to you.
- **Independent review.** Version 0.3.1 followed an adversarial review of the whole source with a
  written threat model; its findings and the fixes are in CHANGELOG.md.

## The one real attack surface: your microphone

In listen mode, whatever the microphone hears can become a prompt. Someone in the room, a video,
or a crafted audio clip could issue an instruction. Three things limit this:

1. **Wake word, on by default.** In auto mode only a sentence that starts with "Clausper" (or
   one of the spellings whisper produces for it) or "Claude" is sent. Anything else is placed in
   the prompt box for you to read and press enter. `/clausper wake off` disables this, and the
   command says what that means.
   Two more brakes apply even with the wake word off: captures under a second are never sent,
   and after three voice-submitted turns in a row with no typed prompt, Clausper drops to the
   prompt box and says so, so a television or a hallucinated transcript cannot run the session.
2. **Fill mode.** `/clausper listen fill` never sends anything by itself.
3. **Claude Code's own permissions.** A spoken prompt is still an ordinary prompt: destructive
   actions still go through the same permission prompts as typed ones.

Listening only starts after you enable it, and macOS asks for microphone permission the first time.

## What it does not do

No reading of credentials, keys, tokens, SSH configuration, browser data or anything outside the
session's own tool calls and the files you press. No settings changes. No modification of other
plugins, of Claude's permission mode, or of its system prompt. No accounts and no identifiers.

## Reporting

Open an issue at https://github.com/kenawak/clausper/issues, or email the address on the author's
GitHub profile for anything that should not be public first. Reports are answered as quickly as
one person can, and fixes ship as a new version through the same marketplace install.

## Known limits

- "Stop" ends every `say` process of your user, not only Clausper's.
- A spoken summary is text written by a model from a reply that a repository can influence.
  Clausper never acts on it; only you do, and only through Claude Code's normal prompts.
