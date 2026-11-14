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
  managers' own folders (`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`) and in the explicit
  overrides `CLAUSPER_RECORDER` and `CLAUSPER_WHISPER`. PATH is never searched, so a program
  planted earlier on PATH cannot receive the microphone audio.
- **Recordings.** Each listen creates a private folder with `mktemp -d` (mode 0700), records one
  file into it, transcribes it locally, and deletes the folder, success or failure.
- **Prompts.** Search for `prompt.submit` and `prompt.fill`. The only text ever submitted is
  your transcribed speech, verbatim and marked as coming from the plugin.
- **Anthropic's own scan.** The plugin directory's automated review, which looks for undisclosed
  egress, hidden code and permission changes, found none in version 0.2.4.

## The one real attack surface: your microphone

In listen mode, whatever the microphone hears can become a prompt. Someone in the room, a video,
or a crafted audio clip could issue an instruction. Three things limit this:

1. **Wake word, on by default.** In auto mode only a sentence that starts with "Clausper" or
   "Claude" is sent. Anything else is placed in the prompt box for you to read and press enter.
   `/clausper wake off` disables this, and the command says what that means.
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
