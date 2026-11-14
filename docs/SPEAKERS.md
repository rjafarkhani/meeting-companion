# Speakers and focused insights

In **Settings**, keep **Deepgram** selected under Transcription service. Add a Deepgram API key for audio and your OpenAI API key for insights/recaps, then save. Each service bills its own usage. Select **Microphone** for a shared room. No extra microphones or voice enrollment are needed.

Final speech creates **Speaker 1**, **Speaker 2**, and subsequent labels from one source. These represent voices, not verified identities. Click a speaker chip or their transcript name to review the insights prompted by their discussion. The cards remain AI suggestions, not statements made by that person.

**Following latest speaker** automatically selects the latest finalized voice. Clicking a speaker holds the current results: incoming speech does not switch people or insert cards into your reading. **Load N new** refreshes that person's results when you are ready. Results are paged two at a time. Categories, search, quiet mode, and pins apply within that speaker. **All speakers** gives a meeting-wide review. **Follow latest speaker** restores automatic selection. Opening card details, checking sources, following context links, or paging also holds the review.

Under **Edit speaker**, save an optional name or check **This is me**. Names follow the voice throughout the transcript and into live recap requests and exports. Marking yourself identifies your voice for this session; it does not save a voiceprint or recognize you across meetings. Existing AI prose is not rewritten when a label changes. Speaker names and matches are held in memory until a new session or app close.

Pausing closes transcription. Resuming starts a fresh acoustic session, so newly detected voices get new numbers. The app never assumes the new connection's first speaker is the previous connection's first speaker. Use **Same person as** to combine a new label with an existing person. This also handles a voice split into multiple labels: old and future turns and their insights are grouped together. Matching cannot be undone individually in this preview; start a new session to reset labels. Duplicate display names alone do not combine people.

Diarization is approximate. Short replies, noise, similar voices, and overlapping speech can cause errors. Unlabeled speech remains **Unidentified speaker**. Provisional labels never create permanent people or change the selected voice. A quiet person may need to speak for a while before a useful label is established. This implementation has protocol/UI coverage, not a measured room-audio accuracy guarantee.

## Processing and credentials

- Deepgram Nova-3 receives continuous mono PCM16 audio at 24 kHz, including silence, and returns word-level timestamps and speaker IDs. Streaming diarization uses `diarize_model=latest` and provider endpointing. This continuous path may cost more than the former speech-only path.
- OpenAI receives recent finalized transcript, names/self marker, and meeting prep for insights; the full finalized transcript for recap; and claims you explicitly choose to check for source research.
- OpenAI-only transcription is still available and labels all speech **Meeting audio**. It uses the existing client speech segmentation. It provides no acoustic speaker separation.
- Both keys remain in Electron's main process. Session-only storage is the default. **Remember API keys** encrypts each key separately with Windows-backed storage. Renderer settings responses contain only presence flags.
- Neither raw audio nor voice references are saved by app code. Provider retention follows the respective provider/account terms. Consent details show the selected destinations before capture starts.

## Implementation

`electron/transcription.ts` owns the WebSocket transports and session-scoped acoustic identities. Deepgram words are split into consecutive same-speaker turns. Final batches replace provisional text atomically; repeated finals are ignored. Missing labels never produce guessed identities. Resumed connections have unique transcript/speaker namespaces and continue numbering from history.

`src/speakers.ts` resolves editable display names and explicit person matches using immutable IDs. Insights are associated through their validated transcript trigger IDs, so renaming people does not orphan cards. Live naming changes invalidate stale recap drafts. `src/App.tsx` provides the roster, held result snapshots, pending-result count, pagination, and speaker editor. Names and matches also go to the active insight pipeline through restricted IPC.

Tests use local fake WebSocket servers and the real Electron demo, without recording hardware audio or sending data to either provider. A consented room test with valid keys is still needed to assess speaker accuracy, latency, overlapping speech, and costs for your microphone/environment.

## Provider references

- [Deepgram streaming diarization](https://developers.deepgram.com/docs/diarization)
- [Deepgram live audio protocol](https://developers.deepgram.com/reference/speech-to-text/listen-streaming)
- [Deepgram endpointing and interim results](https://developers.deepgram.com/docs/understand-endpointing-interim-results)
- [Deepgram keep-alive](https://developers.deepgram.com/docs/audio-keep-alive)
- [OpenAI realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)

## Response priority (v0.3)

Within each speaker or meeting-wide view, suggested answers rank first, followed by possible solutions, then other insights. The response shows the asked question and a brief summary; clicking it expands relevant supporting details while holding the review. Answer and solution filters, question-text search, quiet-mode visibility, and a shortcut to responses from other speakers support quick reading. New answers never interrupt a held snapshot; use Load new, which indicates pending response counts. Voices and transcription providers are unchanged by this refinement.
