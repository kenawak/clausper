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
    mkdir -p ~/.clausper/models
    curl -L -o ~/.clausper/models/ggml-base.en.bin \
      https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin

Then `/clausper setup` checks the pieces, `/clausper listen` listens once, and
`/clausper listen auto` turns on hands-free mode. `/clausper listen fill` puts what you said in
the prompt box instead of sending it, for when you want to check it first. `/clausper listen off`
turns it off. Say "cancel" or "nothing" to skip a turn. macOS asks for microphone access the
first time; allow it for your terminal app. Set `CLAUSPER_WHISPER_MODEL` to use another model
file.

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
