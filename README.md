# Handy (fork)

Fork of [cjpais/Handy](https://github.com/cjpais/Handy), a cross-platform desktop
speech-to-text app. Upstream is fully offline; this fork additionally supports
proprietary cloud transcription models next to the local ones.

## Cloud transcription

The model list in Settings → Models includes OpenAI's hosted transcription models
(`gpt-transcribe`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`). Select one and
paste your OpenAI API key in the "Cloud transcription" section of the same page,
or simply export `OPENAI_API_KEY` in the environment Handy is launched from (a key
entered in Settings wins over the variable). The settings key is stored locally in
Handy's settings store and is shared with the OpenAI post-processing provider; no
key is ever committed to this repository.

When a cloud model is selected, the recorded audio is encoded as WAV and sent to
the OpenAI `/v1/audio/transcriptions` endpoint. Everything else (shortcuts, VAD,
history, paste) works as upstream. Note that this trades upstream's offline
privacy guarantee for API quality: audio leaves your machine while a cloud model
is active. Local models remain available and unchanged.

Anthropic currently has no speech-to-text API, so OpenAI is the only cloud
provider. Adding another provider means one more `EngineType`/`ModelSource::Cloud`
entry in `src-tauri/src/managers/model.rs` and a client in
`src-tauri/src/cloud_transcription.rs`.

## Building

Same as upstream: `bun install`, then `bun run tauri dev` or `bun run tauri build`
(see [BUILD.md](BUILD.md) for platform setup, including the required Silero VAD
model download). For everything else, see the
[upstream README](https://github.com/cjpais/Handy#readme).
