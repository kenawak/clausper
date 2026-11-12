# Privacy policy

Last updated 12 November 2026. Questions: open an issue at https://github.com/kenawak/clausper/issues.

## The short version

Clausper runs on your computer. Your voice, your recordings and the files it shows you never leave it. The one thing that does leave is the text of a Claude Code reply, sent to Anthropic through your own Claude Code session so that a model can summarize it, exactly as your session already sends your conversation. Clausper has no servers, collects no analytics, and keeps no account.

## What the mod processes

- **Reply text.** After each turn, Clausper reads the reply Claude Code just produced. Short replies are spoken as they are. Long replies are sent, with a fixed summarizing instruction, through your Claude Code session to the Anthropic API your session is already using. That call is subject to Anthropic's own privacy terms for your account. Clausper adds no other recipient.
- **Speech.** Summaries are spoken by the macOS system voice on your machine. Nothing is sent to a speech service.
- **Microphone.** In listen mode, after you turn it on, Clausper records from your default microphone until you pause, writes the audio to a temporary file under `/tmp`, transcribes it with whisper.cpp running locally, submits the words as your next prompt, and deletes the file. Recording only happens after you enable listen mode or press listen. macOS asks for microphone permission the first time.
- **Files and commands.** The pane lists the paths of files Claude edited and the commands it ran in your session, and shows a file's git diff or contents when you ask. This stays on your machine.
- **Settings.** Your chosen voice and listen mode are stored in the plugin store Claude Code provides on your machine.

## What the mod does not do

- No telemetry, crash reporting, or usage analytics.
- No accounts, cookies, or identifiers.
- No reading of credentials, keys or tokens. It reads two environment variables, `HOME` and `CLAUSPER_WHISPER_MODEL`, to find the model file.
- No network calls of its own. The only outbound request is the summary call made through Claude Code.

## The website

clausper.kenawak.dev is a static site with no analytics and no cookies. It stores one preference, your light or dark theme choice, in your browser's local storage. Fonts are loaded from Google Fonts, which receives your IP address when the page loads, under Google's privacy policy. The site is hosted on infrastructure controlled by the author and served through Cloudflare, which processes requests under its own privacy policy.

## Children

Clausper is a developer tool and is not directed at people under 18.

## Changes

Changes to this policy are recorded in CHANGELOG.md and in the "last updated" date above.
