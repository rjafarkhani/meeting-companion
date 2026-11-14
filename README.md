# Meeting Companion

A Windows-first personal meeting copilot. The desktop app has a polished live workspace, microphone/system-audio capture, streaming speaker-aware Deepgram transcription (or OpenAI-only transcription), categorized contextual assistance, meeting preparation, source checks, and reviewable recap/export artifacts.

## Run the built app

Double-click **Start Companion.cmd** in this folder. It prefers the updated build under `release/speaker-update/win-unpacked/`, leaving an already-open older build untouched. The updated ZIP is `release/speaker-update/Meeting-Companion-0.2.0-x64.zip`. If you downloaded the ZIP, extract the entire ZIP and launch **Meeting Companion.exe** from the extracted folder. The ZIP build is unsigned; it is a personal development preview.

The app starts idle in **Demo** mode. Click **Run demo** for a fictional technical architecture review. It never opens an audio device or calls a provider. **Next moment** advances the scenario; pause/resume, category filters, pin/dismiss, transcript context, and recap all work. The recap includes only demo moments already played. The fixed architecture sketch is labeled as an illustrative reference, not a generated meeting diagram.

## Use live assistance

1. Open **Settings**, add your OpenAI API key for insights/recaps and your Deepgram API key for speaker recognition, and save. Each provider bills its own usage. Deepgram is the default transcription service. OpenAI-only transcription remains available without speaker separation.
2. Choose **Microphone**, **System audio**, or **Both sources**. Save. Microphone covers an in-room meeting or an external speakerphone. System audio captures all playback on the Windows default output, including Zoom/Teams when routed there. Both includes your microphone and remote participants; use headphones to reduce doubled speech.
3. On a new session, choose **Live**. Add context under **Meeting prep**, then return to the workspace.
4. Click **Start listening**. Inform participants and obtain the consent/permissions required for capture and cloud processing. Confirm the in-app acknowledgment. The app does not notify participants or independently verify their consent.
5. Pause or end to release capture devices and close transcription. Resume requires a fresh acknowledgment. An unfinished speech segment is discarded when stopping; finalized transcript and existing insights stay in memory.
6. Use **Check sources** on an evidence card to send its claim to OpenAI web search. Retrieved links are labeled as sources, not a guarantee of truth. The demo only includes an illustrative reference.
7. Under **Meeting recap**, generate a reviewable draft from the current finalized transcript. New finalized speech invalidates a live draft, preventing stale decisions from being presented as current. Export Markdown to a location you select.

If a model is unavailable to your account, the app reports the provider error. Deepgram transcription uses Nova-3. The editable OpenAI defaults are `gpt-live-transcribe` for OpenAI-only transcription and `gpt-4.1-mini` for insights. No credentials are bundled. Live mode does not silently fall back to simulated content.

## Speakers and focused insights

The app now separates voices from one microphone into **Speaker 1**, **Speaker 2**, and subsequent labels. Click a speaker to hold and review their related insights, paged two at a time. **Load N new** refreshes results on demand; **Follow latest speaker** restores automatic selection. **Edit speaker** lets you rename a voice, mark **This is me**, or match a duplicate/resumed label to an existing person. Names and matches last for this session. See [setup, behavior, limitations, and provider details](docs/SPEAKERS.md).

## What is implemented

- Sandboxed Electron renderer, context isolation, restricted preload/IPC, and local-only UI assets.
- Explicit consent gate, idle audio denial, capture-state indicators, pause/stop cleanup, disconnect handling, and bounded outgoing audio buffering.
- Microphone input and Windows system loopback, individually or mixed. Screen video requested by Electron's display-capture mechanism is discarded locally; no video is analyzed, saved, or transmitted.
- AudioWorklet: mono PCM16 at 24 kHz, 100 ms packets. Deepgram receives a continuous stream with provider speech detection and word-level speaker labels/timestamps. OpenAI-only mode retains RMS segmentation with 300 ms preroll, 700 ms silence boundary, and a five-second maximum turn.
- Streaming partial/final transcript, linked context, search, auto-follow, and clear provisional text. Live diarization uses Deepgram; OpenAI-only speech remains labeled **Meeting audio**. Speaker IDs are separate from editable names. Provisional labels do not create permanent speakers.
- Six insight categories, quiet mode, pin/dismiss, expandable reasoning, paced rolling-context requests, and resumed-session text context.
- Source checks using provider web search and actual returned URL annotations. AI cards without retrieval are explicitly **AI inference**.
- Volatile prep context, recap drafts, decisions/actions/open questions, a fixed demo architecture diagram, and explicit Markdown exports.
- Session-only API keys by default; optional Windows-backed encrypted storage for both providers. Ordinary preferences persist separately.

## Privacy and limitations

The app does not write raw audio or automatically save transcripts/insights/meeting prep. Closing it or starting a fresh session clears that app's in-memory meeting data. Explicit exports are files you must manage yourself. Windows may manage process memory, diagnostic data, and paging separately; this is not a secure-erasure guarantee.

Live audio is streamed to Deepgram when speaker recognition is selected, or to OpenAI for OpenAI-only transcription. Deepgram receives silence too, which affects usage costs. OpenAI receives names/self marker with transcript context. The insight pipeline sends recent finalized transcript and prep. Recap sends the current finalized transcript and prep. Source checks send the selected claim for provider web search. Responses requests use `store: false`; this does not promise zero provider retention. Provider account terms and data controls still apply.

Settings and optionally encrypted API keys are stored in Electron's per-user app-data directory. Keys are never returned to the renderer after saving. No third-party analytics are installed. The renderer uses an in-memory Chromium partition; main-process Chromium runtime caches may still exist in the app-data directory.

Latency targets are design goals, not measured guarantees: roughly 1–2 seconds for partial captions and 2–5 seconds for initial insights when the network/provider permit. Final text depends on provider speech detection or client turn boundaries, and cited research can take longer. Quiet speakers, overlapping speech, device routing, network conditions, provider limits, and RMS thresholds affect results. There is no reconnect loop that secretly resumes capture after a disconnect.

This preview has no team authentication, billing, update service, code signing, managed retention, enterprise policy enforcement, or mobile capture. See [architecture and release path](docs/ARCHITECTURE.md).

## Develop

Requires Node.js 24 LTS and npm. A verified portable Node runtime is also available under `.tools/node-v24.22.3-win-x64` in this workspace; that folder is ignored by Git and not included in the release.

```powershell
npm install
npm run build
npm start
npm test
npm run test:app
npm run package
```

If npm's install-script policy skips Electron's runtime download, run `node node_modules/electron/install.js` after reviewing the dependency. The start script clears an inherited `ELECTRON_RUN_AS_NODE` setting so IDE environments do not accidentally launch Electron as a CLI.

`npm run package` creates a Windows x64 ZIP and an unpacked build under `release/`. Keep the full extracted folder together. No installer or global runtime installation is required for that build.

## Validation

`npm test` covers settings/URL validation, grounding to known transcript IDs, citation provenance, demo recap boundaries, export exclusion of unfinished speech, speech-turn buffering, WebSocket protocol behavior, cancellation, and provider startup errors. Tests use a local fake transcription server and never send meeting data to a provider.

`npm run test:app` launches the real Electron app and checks renderer isolation, silent synthetic audio through the real PCM AudioWorklet, demo playback, pause/resume, filters, pins, transcript links, recap boundaries, diagram/settings surfaces, the consent dialog, credential isolation, compact layout, and unsafe-URL rejection. Screenshots are written to `test-results/`. To test the packaged executable, set `COMPANION_EXE` to its absolute path before running this command.

Cloud transcription, real-room diarization accuracy, real Windows audio-device capture, provider web search, and measured latency require a configured key and a consented hardware test. These are implemented but are not certified by the local demo/protocol tests. Native desktop automation did not expose the separately launched window in this environment; visual QA used screenshots from the launched Electron test window.
