# API keys and protected storage (v0.4)

When you start a live session without the necessary keys, Companion opens **Add required API keys**. OpenAI is required for answers, insights and recaps. Deepgram is also required when speaker separation is selected. Only missing providers are requested. OpenAI-only transcription does not request a Deepgram key. Live recap and source-check actions also request an OpenAI key if missing.

**Save securely and continue** stores the keys using the operating system's protection and continues the requested action. Starting a session still opens the separate capture-consent dialog; entering keys never starts recording. Cancel and Escape discard the key-entry form. Password inputs are cleared after saving or dismissal; saved keys are never returned to the renderer. A key's format is checked locally; successful storage does not prove the provider has authorized it. No provider requests are made to validate a newly saved key.

## Protection

- **Windows:** Electron's asynchronous safeStorage uses Windows account protection (DPAPI). The cryptographic key is managed by Windows, not embedded in the application or repository.
- **macOS:** Electron's asynchronous safeStorage uses Keychain. A consistently signed macOS build is needed for stable Keychain access across upgrades; this release supplies a Windows package.
- **Linux:** The selected system keyring must be explicitly recognized as GNOME libsecret or KWallet. The pinned Electron 45 implementation uses the synchronous keyring API on Linux because it exposes the selected backend; Windows/macOS use the asynchronous API. `basic_text`, `unknown`, and unverified fallback storage are refused. Electron must not be upgraded past 45 without revisiting the Linux backend adapter.

The default is encrypted persistence. If protected storage is unavailable or cannot be verified, the application offers **Use for this launch only** and Cancel; it never falls back to plaintext or a hardcoded encryption password. Session-only use removes existing saved copies of both keys. Settings also provides a persistence toggle and explicit removal controls. Removing a saved key prevents its recovery on the next launch.

## Location and writes

The ciphertext is saved to `app.getPath('userData')/secrets/credentials.v1.enc`, in the OS's per-user application data directory by default, rather than next to source files or the executable. Windows normally places application data under `%APPDATA%`; macOS under Application Support; Linux under the per-user configuration directory. The exact app directory follows Electron's application identity.

The application resolves parent links and refuses persistence when this location is inside a Git, Mercurial, or Subversion checkout, including an overridden `--user-data-dir` that points into one. Credential filenames are additionally ignored by Git as defense in depth. This cannot prevent a user from deliberately copying ciphertext elsewhere or putting an existing private app-data folder under source control later.

Only an encrypted envelope containing the provider keys is written. Atomic writes use an exclusively created ciphertext temporary file and rename; plaintext is never used as an intermediate file. Directories/files request owner-only permissions on Unix; Windows files inherit the private app-data directory's access controls. The settings JSON contains preferences only. There are no bundled credentials, environment-file writes, custom encryption passwords, or secret-bearing exports/logs added by this feature.

At startup the main process unlocks the envelope and reuses available keys. Key rotation reported by the async backend refreshes the envelope. Existing `credential.bin` and `deepgram-credential.bin` files from earlier opted-in encrypted storage migrate to the new envelope and are removed after a successful save. An unlock/corruption failure results in a visible warning and missing-key prompt, not guessed credentials.

## Security limits and validation

This protects secrets at rest against casual file inspection and other users without the required OS credentials. On Windows it does not prevent malicious software already running as your account, an administrator with sufficient access, or a compromised running process from using keys. Keys necessarily exist briefly in the entry form and in main-process memory while used; JavaScript cannot promise secure memory erasure. Revoke a key at its provider if the account or machine is compromised.

Unit tests cover encrypted-only writes, restart restoration, failed encryption/unlock, unavailable storage, deletion, migration, and checkout rejection using synthetic keys and a test cipher. The Electron smoke test uses the real Windows protection to save both synthetic keys, close and relaunch, verify recovery without exposing values, remove saved keys, and confirm that session-only keys disappear on restart. Its temporary profile is outside the repository and isolated from real application data. macOS/Linux behavior is guarded in code but has not been hardware-tested in this Windows environment.

The development-runtime smoke test passed. The v0.4 Windows package was built, but this environment's organization Device Guard policy blocked launching its unsigned executable; packaged-runtime verification is pending an approved signing or allow-listing path. The prior-release launcher is preserved rather than redirected to a blocked executable. No Device Guard policy was changed or bypassed.

Reference: [Electron safeStorage and platform security semantics](https://www.electronjs.org/docs/latest/api/safe-storage).
