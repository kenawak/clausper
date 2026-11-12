# Clausper

Clausper whispers. After every Claude Code reply it speaks a short summary through your Mac's
system voice, so you do not have to read a long terminal answer to know what just happened.
While it speaks, the current sentence shows as a caption above the prompt and in the pane.
It also keeps a pane beside the chat listing each turn, the files it touched, and the
commands it ran. Pressing a file shows its uncommitted diff, opens it in your editor, or
copies its path.

Short replies are spoken as they are, at once. For a long reply Clausper speaks the opening
sentence immediately while Haiku writes the rest of the summary through your own Claude Code
session, on your subscription. No API key, no extra service. If the summary call fails,
Clausper speaks the first sentences of the reply instead.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install clausper --marketplace kenawak/clausper
```

Answer `y` to add the marketplace, then pick a scope (user is the usual choice).

From a shell:

```
claude plugin install clausper --marketplace kenawak/clausper
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins,
Add marketplace with `kenawak/clausper`, then Add plugin.

Landing page: https://clausper.kenawak.dev (source: https://github.com/kenawak/clausper-site)

## Listen mode: answer by voice

Clausper can ask "What next?" after each summary, listen to your answer, and send it as your
next prompt. Nothing leaves your machine: recording uses `sox`, transcription uses whisper.cpp
with a local model.

    brew install sox whisper-cpp

Then download the model file `ggml-base.en.bin` (141 MB) from the whisper.cpp model page,
https://huggingface.co/ggerganov/whisper.cpp/tree/main, and save it as
`~/.clausper/models/ggml-base.en.bin`. Nothing is executed from the download: it is a data file
that whisper.cpp reads. A different model file can be named with `CLAUSPER_WHISPER_MODEL`.

Then `/clausper setup` checks the pieces, `/clausper listen` listens once, and
`/clausper listen auto` turns on hands-free mode. `/clausper listen fill` puts what you said in
the prompt box instead of sending it, for when you want to check it first. `/clausper listen off`
turns it off. Say "cancel" or "nothing" to skip a turn. macOS asks for microphone access the
first time; allow it for your terminal app.

## What Clausper does on your machine

Clausper is a hooks module. This is everything it runs, reads, sends and submits.

**Hooks.** `turn.complete`: reads the reply you just received and starts the summary and speech.
`turn.start`: resets the per-turn change list. `tool.call` on Edit, Write, NotebookEdit and Bash:
after the tool has run, records the file path or command for the pane; it never blocks, rewrites
or denies a call. `command.run` for `/clausper`. `ui.render` for its own pane and the band above
the prompt. It never touches permission modes, settings, other plugins or the model's system prompt.

**What it sends, and where.** One model call per long reply, through your own Claude Code session
to the same Anthropic API your session already uses, carrying the text of that reply and a fixed
instruction to summarize it (the `haiku` model). Short replies are not sent anywhere. No other
network calls are made by Clausper itself: no telemetry, no third-party service, and your voice
recordings never leave the machine.

**Programs it runs, and why.** All are run directly, without a shell, with fixed arguments except
where noted.

- The macOS speech synthesizer, through Claude Code's own speech call, to speak summaries.
- `killall say`, when you press stop, to end the current utterance.
- `say -v ?`, for `/clausper voices`, to list installed voices.
- `which`, to find the recorder and transcriber on your PATH.
- `rec` (sox), when listening, to record 16 kHz mono from the default microphone until a pause.
  The output path is a temporary file under `/tmp`.
- `whisper-cli` (whisper.cpp), to transcribe that file with the model in `~/.clausper/models`
  or the file named by `CLAUSPER_WHISPER_MODEL`.
- `rm -f` on that one temporary file afterwards.
- `git diff -- <file>` and `git status --porcelain -- <file>`, run in the file's folder, when you
  press a file in the pane, to show its uncommitted changes.
- `open <file>`, when you press "open in editor".

**Prompts it submits.** In listen mode, after you speak, Clausper submits the transcribed words as
your next message, verbatim and unedited, marked as coming from the plugin. In fill mode it only
places them in the prompt box and you press enter. Saying "cancel", "nothing" or "skip" submits
nothing.

**What it reads.** The environment variables `HOME` and `CLAUSPER_WHISPER_MODEL`, the reply text,
the paths and commands of tool calls in your session, and files you choose to open from the pane.
It reads no credentials, keys or tokens, and stores only its own settings (voice, listen mode) in
the plugin store Claude Code provides.

## Commands

- `/clausper` opens the pane
- `/clausper mute` and `/clausper unmute` silence or restore speech
- `/clausper again` repeats the last summary
- `/clausper stop` cuts speech off
- `/clausper captions off` and `/clausper captions on` hide or show the caption line
- `/clausper listen` listens once; `/clausper listen auto|fill|off` sets the mode; `/clausper setup` checks the tools
- `/clausper voice <name>` picks a system voice, `/clausper voices` lists them
- `/clausper test` speaks a test line

In the pane, `m` mutes, `a` says the last summary again, `s` stops, `l` listens, `b` goes back.

## Developing

The mod is a Claude Code hooks module: `hooks/register.tsx`, its state contract in
`types/index.d.ts`, tests in `tests/`. Run it from this folder with
`claude --plugin-dir .`, check it with `claude plugin validate .` and `claude plugin test .`.
The landing page is its own repository: https://github.com/kenawak/clausper-site.

## Requirements

macOS, for the system voice and microphone. On other platforms the pane and captions work and
nothing is spoken.
