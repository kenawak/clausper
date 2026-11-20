# Clausper

Clausper whispers. After every Claude Code reply it speaks a short summary through your
computer's system voice, or through Kokoro, an optional natural-sounding neural voice that also
runs on your machine, so you do not have to read a long terminal answer to know what just
happened. It runs on macOS and Linux.
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
claude plugin marketplace add kenawak/clausper --scope user
claude plugin install clausper@clausper --scope user
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins,
Add marketplace with `kenawak/clausper`, then Add plugin.

`claude plugin list` should show `clausper@clausper` enabled. Start a new session afterwards:
plugins load when a session starts.

### Updating

A new release reaches you only when you update. From a shell:

```
claude plugin marketplace update clausper
claude plugin update clausper@clausper
```

Then start a new session. `claude plugin list` shows the version you run; a feature in this README
that does nothing (the stop key, say) usually means an older version is still loaded.

Landing page: https://clausper.kenawak.dev (source: https://github.com/kenawak/clausper-site)

## Listen mode: answer by voice

Clausper can ask "What next?" after each summary, listen to your answer, and send it as your
next prompt. Nothing leaves your machine: recording uses `sox`, transcription uses whisper.cpp
with a local model.

    brew install sox whisper-cpp

On Linux, install sox from your distribution (`sudo apt install sox`) and build whisper.cpp
(https://github.com/ggml-org/whisper.cpp), then put `whisper-cli` in `/usr/local/bin` or
`~/.local/bin`, or point `CLAUSPER_WHISPER` at it.

Then download the model file `ggml-base.en.bin` (141 MB) from the whisper.cpp model page,
https://huggingface.co/ggerganov/whisper.cpp/tree/main, and save it as
`~/.clausper/models/ggml-base.en.bin`. Nothing is executed from the download: it is a data file
that whisper.cpp reads. A different model file can be named with `CLAUSPER_WHISPER_MODEL`.

Then `/clausper setup` checks the pieces, `/clausper listen` listens once, and
`/clausper listen auto` turns on hands-free mode. In auto mode the wake word is on by default:
only a sentence that starts with "Clausper" (or "Claude") is sent, anything else is placed in
the prompt box for you to confirm. `/clausper wake off` turns that off. `/clausper listen fill` puts what you said in
the prompt box instead of sending it, for when you want to check it first. `/clausper listen off`
turns it off. Say "cancel" or "nothing" to skip a turn. macOS asks for microphone access the
first time; allow it for your terminal app. On Linux sox records from the default input of
PipeWire, PulseAudio or ALSA.

## Linux

Claude Code speaks and plays sound only on macOS, so on Linux Clausper runs its own programs:

    sudo apt install espeak-ng sox pipewire-bin

- The system voice is `espeak-ng` (or `espeak`, or speech-dispatcher's `spd-say`).
  `/clausper voices` lists its languages; `/clausper voice en-gb` picks one.
- Kokoro clips play through `pw-play`, `paplay`, `aplay` or sox's `play`, whichever is installed
  first. Kokoro is the better voice on Linux too, and sets itself up the same way.
- The listening cues are made by sox's `play`, installed with sox.
- "Open in editor" uses VS Code's `code` when it is installed; otherwise copy the path.
  `xdg-open` is never used, because it can run a `.desktop` file instead of showing it.

## A natural voice: Kokoro (optional)

The system voices can sound robotic. Kokoro is an open-weight neural text-to-speech model
(82 million parameters, Apache 2.0) that sounds close to a person and runs on your computer's CPU, the
same way listen mode runs whisper.cpp: nothing you hear is made anywhere else.

One command turns it on and sets it up:

    /clausper voice kokoro

The first time, Clausper fetches what is missing, once, with progress in the status line, while
the system voice keeps speaking. It then says hello in the new voice:

- uv 0.13.6 (17 MB) into `~/.clausper/bin`, from uv's GitHub release, when no uv is installed
  (Homebrew's, or uv's own installer's in `~/.local/bin`, is used when it is there)
- `kokoro-v1.0.onnx` (326 MB) and `voices-v1.0.bin` (28 MB) into `~/.clausper/models`, from the
  kokoro-onnx model release
- the runner's Python packages (about 130 MB), exactly the versions and hashes pinned in
  `tts/kokoro.py.lock`, from PyPI into uv's cache, and Python itself if no 3.10–3.13 is installed

Every file is downloaded over https under a temporary `.part` name, checked against the SHA-256
pinned in `hooks/register.tsx`, and moved into place only if it matches. A file that does not
match is deleted. Nothing is executed from the model files: they are data the model runtime
reads. If the setup is interrupted, `/clausper voice install` picks up where it stopped.
`/clausper setup` checks every piece.

You need about 500 MB of free disk and a network connection for this one setup; after it, Kokoro
speaks fully offline. On Linux, install `espeak-ng` and a player first (see Linux above).

### Check that it works

    /clausper setup     lists uv, the model, the voices and the packages as found or missing
    /clausper test      speaks a test line: you should hear Kokoro, not the system voice

### Switch between voices

    /clausper voices            lists every voice, system and Kokoro
    /clausper voice kokoro      Kokoro's default voice, af_heart
    /clausper voice bm_george   any other Kokoro voice by name
    /clausper voice Samantha    a system voice by name (Linux: an espeak-ng language, e.g. en-gb)
    /clausper voice default     back to the system default voice

Kokoro's names start with `af_` and `am_` (American female and male) or `bf_` and `bm_` (British).
Switching is instant once the files are there; the choice is kept for every session. Going back to
the system voice leaves the Kokoro files in place, so switching back needs no download.

### Skip the download: copy the files from another machine

A machine that already runs Kokoro has both model files in `~/.clausper/models`. Copy them before
running `/clausper voice kokoro` and it fetches only what is still missing:

    ssh other-host 'mkdir -p ~/.clausper/models'
    scp ~/.clausper/models/kokoro-v1.0.onnx ~/.clausper/models/voices-v1.0.bin other-host:~/.clausper/models/

AirDrop or a USB drive works too; the names must stay exactly these. Check them on the new machine
with `shasum -a 256` (Linux: `sha256sum`):

| File | SHA-256 |
| --- | --- |
| `kokoro-v1.0.onnx` | `7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5` |
| `voices-v1.0.bin` | `bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d` |

A file whose hash differs: delete it and let `/clausper voice kokoro` download it.

### If something goes wrong

Start with `/clausper setup`: it names the missing piece and the command that fixes it.

| Symptom | Fix |
| --- | --- |
| A toast says Kokoro failed and the system voice took over | `/clausper setup`, then fix the line marked missing |
| Setup says the packages are missing | `/clausper voice install` once while online (about 130 MB) |
| Setup says "not checked: install uv and the model files first" | a model file is missing or misnamed in `~/.clausper/models`; `/clausper voice install` |
| The setup was interrupted | `/clausper voice install` picks up where it stopped |
| Linux: no sound from Kokoro | install a player: `pw-play` (pipewire-bin), `paplay`, `aplay` or sox's `play` |

To test Kokoro outside Claude Code, run the same offline check Clausper uses (use
`~/.clausper/bin/uv` if uv came from Clausper's setup, and your installed version in the path).
It prints the voice names, `af_heart` among them:

    cd ~ && uv run --offline --locked --no-config --quiet \
      --script ~/.claude/plugins/cache/clausper/clausper/<version>/tts/kokoro.py \
      --model ~/.clausper/models/kokoro-v1.0.onnx \
      --voices ~/.clausper/models/voices-v1.0.bin --list

### How it runs

Each utterance starts `tts/kokoro.py`, a short Python script in this repository. On Apple Silicon
the first sentence is ready in two to three seconds (the model loading), and each one after it in
well under a second, while the sentence before it plays. For a long reply the summary's audio is
made while the opening sentence is spoken. If Kokoro cannot speak, for any reason, the system voice
says the rest and a toast says why.

## A key to stop it (macOS)

Press **⌃⌥S** (control, option, S) in any app to stop Clausper mid-sentence, even when the
terminal is not in front. It stops every session that is speaking, listening or waiting for its
turn. Pick your own chord, and add more actions:

    /clausper keys                      shows the shortcuts and whether they are ready
    /clausper keys stop cmd+shift+s     a different chord for stop
    /clausper keys mute ctrl+alt+m      also: mute (toggles), again, listen
    /clausper keys again off            clears one
    /clausper keys off | on | reset     all off, back on, back to the default

A chord is modifiers (`cmd`, `shift`, `alt`/`opt`, `ctrl`) plus one key: a letter, a digit,
punctuation, `space`, an arrow, or `f1` to `f19` (a function key may stand alone). While Claude
Code runs, the chord belongs to Clausper in every app, so `cmd+shift+s` would take "Save As" away
from your editor; that is why the default is ⌃⌥S.

The shortcuts come from a small helper, `keys/clausper-keys.swift`, which Clausper builds once with
the Xcode command line tools (`xcode-select --install` if you have none) into
`~/.clausper/bin` and rebuilds when its source changes. It uses macOS's hotkey registration, so it
needs no Accessibility or Input Monitoring permission and never sees any other key. It exits with
its session. Linux has no such helper yet; `/clausper stop` and the pane's `s` still work there.

If the key does nothing: `claude plugin list` must show 0.5.0 or later (see Updating), and
`/clausper keys` must say `stop: ⌃⌥S` under Helper. Another app that already holds the same chord
shows there as "taken"; pick a different one.

## What it costs

Short replies are spoken as they are, with no model call. A long reply gets one Claude Haiku 5.5
call for its summary: one to four thousand tokens, well under a tenth of a cent at API prices. The pane
shows each summary's tokens and dollars and the session's total in its header, and
`/clausper cost` totals this session, today and all time, and says what share of the session's cost
that is. On a subscription nothing is billed per call; the tokens count toward your usage limits.
`/clausper private on` makes no calls at all.

## Several sessions at once

Each Claude Code session runs its own Clausper, and they take turns. When two sessions finish
together, one speaks while the other waits and then begins with its project's folder name ("In
weather app."), so you know whose summary you are hearing. In listen mode only the session whose
turn it is listens, so one spoken answer is never sent to two sessions. Stop in a waiting
session gives up its turn; its summary still shows in the pane.

## What Clausper does on your machine

Clausper is a hooks module. This is everything it runs, reads, sends and submits.

**Hooks.** `turn.complete`: reads the reply you just received and starts the summary and speech.
`turn.start`: resets the per-turn change list. `tool.call` on Edit, Write, NotebookEdit and Bash:
after the tool has run, records the file path or command for the pane; it never blocks, rewrites
or denies a call. `command.run` for `/clausper`. `ui.render` for its own pane and the band above
the prompt. It never touches permission modes, settings, other plugins or the model's system prompt.

**What it sends, and where.** One model call per long reply (none in private mode), through your own Claude Code session
to the same Anthropic API your session already uses, carrying the text of that reply and a fixed
instruction to summarize it (the `haiku` model). Short replies are not sent anywhere. The one
other network use is the Kokoro setup, which runs only when you choose Kokoro (`/clausper voice
kokoro`) or run `/clausper voice install`: the pinned files from GitHub releases, and the pinned
packages (and Python, if needed) through uv. Speaking never touches the network. No telemetry, no
third-party service, and your voice recordings never leave the machine.

**Programs it runs, and why.** All are run directly, without a shell, with fixed arguments except
where noted.

- `uname -s`, once per load, to tell macOS from Linux.
- macOS: the speech synthesizer, through Claude Code's own speech call, to speak summaries;
  `killall -u <your user> say`, when you press stop (this ends every `say` of yours, not only
  Clausper's); `say -v ?`, for `/clausper voices`.
- Linux: `espeak-ng --stdin` (or `espeak`, or `spd-say -w -e`) with each sentence on its
  standard input, so nothing in it is read as an option; `pw-play`, `paplay`, `aplay -q` or
  `play -q` on each Kokoro clip; sox's `play -n synth` for the listening cues; and
  `espeak-ng --voices` or `spd-say -L` for `/clausper voices`. All are looked up in `/usr/bin`,
  `/usr/local/bin` and `/home/linuxbrew/.linuxbrew/bin`. Stop ends only these programs.
- `mktemp -d`, when listening, to create a private folder (mode 0700, under your temporary
  directory) for the one recording.
- `rec` (sox), when listening, to record 16 kHz mono from the default microphone until a pause,
  into that folder. The recorder is looked up only in `/opt/homebrew/bin`, `/usr/local/bin` and
  `/usr/bin` (on Linux `/usr/bin`, `/usr/local/bin` and `/home/linuxbrew/.linuxbrew/bin`), or at
  the path in `CLAUSPER_RECORDER`; PATH is never searched. An override must be an absolute path
  outside the shared temporary folders (`/tmp`, `/var/tmp`, `/dev/shm`) and outside the session's
  project folder.
- `whisper-cli` (whisper.cpp), found the same way or at `CLAUSPER_WHISPER`, to transcribe that
  file with the model in `~/.clausper/models` or the file named by `CLAUSPER_WHISPER_MODEL`.
- `rm -rf` on that one private folder afterwards, success or failure.
- `uv run --offline --locked --no-config --script tts/kokoro.py`, when a Kokoro voice is chosen,
  in its own private `mktemp -d` folder, to turn each sentence into a WAV file there that Claude
  Code's own audio call plays; the folder is deleted afterwards. `--offline`: speaking never
  touches the network. `--locked`: only the packages pinned with hashes in `tts/kokoro.py.lock`
  run. `--no-config`: a `uv.toml` or `pyproject.toml` in your project cannot change where
  packages come from. uv is looked up only in those same folders and
  `~/.local/bin` (where uv's own installer puts it), or at `CLAUSPER_UV` under the same rules as
  the other overrides; the model files only in `~/.clausper/models`. `/clausper setup` runs the
  same command with `--list` to check that Kokoro can load. Stop ends the playback and the runner.
- For the Kokoro setup, only when you choose Kokoro or run `/clausper voice install`:
  `uname -m`, to pick uv's build; `curl -fsSL --proto =https` from `/usr/bin` to download each
  pinned file; `shasum -a 256` (Linux: `sha256sum`) to check it; `tar -xzf` to unpack uv;
  `mkdir -p`, `mv` and `rm` to put files in place in `~/.clausper` and remove `.part` files;
  `uv sync --script tts/kokoro.py --locked --no-config` to download the pinned packages into
  uv's cache.
- macOS, for the shortcuts (unless `/clausper keys off`): `shasum -a 256` on
  `keys/clausper-keys.swift` at each session start; when it changed, `xcode-select -p` (are the
  command line tools there?), `xcrun swiftc -O` to build it into `~/.clausper/bin`, and `mv` to put
  it in place, with its hash beside it. Then the built `clausper-keys` with your chords as
  arguments; it prints one line per press, writes its process id to `~/.clausper/run`, and exits
  when its session does. A stop press writes the time into `~/.clausper/run/stop`, which a session
  that is speaking, listening or waiting reads four times a second.
- `mkdir -m 700 ~/.clausper/floor`, before speaking or listening, to take this session's turn:
  only one session can create the folder. The holder writes a random id and the time into
  `floor/owner` every two seconds and removes the folder (`rm -rf`) when its turn ends or the
  session exits. A folder whose owner has been silent for ten seconds (a session that was killed)
  is moved aside with `mv` and removed. `mkdir -p ~/.clausper` makes the parent folder first.
- `git diff --no-ext-diff -- <file>` and `git status --porcelain -- <file>`, run in the file's
  folder with external diff tools and the file monitor disabled, when you press a file in the pane.
- `code --goto <file>` when VS Code's command is installed in `/opt/homebrew/bin` or
  `/usr/local/bin` (on Linux `/usr/bin`, `/usr/local/bin` or `/snap/bin`), else on macOS
  `open -t <file>` (your default text editor), when you press "open in editor". Never plain
  `open` or `xdg-open`, which would launch a script or app instead of showing it.

**Prompts it submits.** In listen mode, after you speak, Clausper submits the transcribed words as
your next message, as whisper transcribed them. The only edits are the removal of the wake word
and of whisper's own non-speech tags such as "[BLANK_AUDIO]". With the wake word on (the default)
a sentence is sent only when it starts with "Clausper" (or a spelling whisper produces for it) or
"Claude", lasts at least a second, and fewer than three voice turns have been sent in a row
without you typing; otherwise, and always in fill mode, the words are appended to the prompt box
and you press enter. Saying "cancel", "nothing" or "skip" submits nothing. The prompt is tagged as
coming from the plugin for Claude Code's hooks and transcript; the model reads it as your words.

**What it reads.** The environment variables `HOME`, `USER`, `CLAUSPER_WHISPER_MODEL`,
`CLAUSPER_RECORDER`, `CLAUSPER_WHISPER` and `CLAUSPER_UV`, the reply text,
the paths and commands of tool calls in your session, and files you choose to open from the pane.
It reads no credentials, keys or tokens, and stores only its own settings (voice, listen mode,
wake word, private mode, shortcuts) in the plugin store Claude Code provides.

Security: [SECURITY.md](SECURITY.md). Privacy: [PRIVACY.md](PRIVACY.md). Terms: [TERMS.md](TERMS.md).

## Commands

- `/clausper` opens the pane
- `/clausper mute` and `/clausper unmute` silence or restore speech
- `/clausper again` repeats the last summary
- `/clausper stop` cuts speech off; ⌃⌥S does it from any app (macOS)
- `/clausper keys` shows or changes the global shortcuts (see "A key to stop it" above)
- `/clausper captions off` and `/clausper captions on` hide or show the caption line
- `/clausper listen` listens once; `/clausper listen auto|fill|off` sets the mode; `/clausper setup` checks the tools
- `/clausper wake on|off` requires "Clausper, …" before a spoken prompt is sent (on by default)
- `/clausper private on|off` skips the model call entirely and speaks the reply's own opening sentences
- `/clausper cost` shows what the summaries have used: this session, today and all time
- `/clausper voice <name>` picks a system voice or a Kokoro voice (`af_heart`, `bm_george`, …),
  `/clausper voice kokoro` the default Kokoro voice, `/clausper voice default` the system default,
  `/clausper voice install` sets Kokoro up again if anything is missing; `/clausper voices` lists them all
- `/clausper test` speaks a test line

In the pane, `m` mutes, `a` says the last summary again, `s` stops, `l` listens, `b` goes back.

## Developing

The mod is a Claude Code hooks module: `hooks/register.tsx`, the shortcut helper in
`keys/clausper-keys.swift`, its state contract in
`types/index.d.ts`, tests in `tests/`. Run it from this folder with
`claude --plugin-dir .`, check it with `claude plugin validate .` and `claude plugin test .`.
The landing page is its own repository: https://github.com/kenawak/clausper-site.

## Requirements

macOS, or Linux with espeak-ng for the system voice and a player such as `pw-play` for
Kokoro (see Linux above). On other platforms the pane and captions work and nothing is spoken. The Kokoro voice needs uv and about 450 MB for the model and its packages.
