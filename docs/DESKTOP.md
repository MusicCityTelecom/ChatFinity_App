# Desktop applications

One Electron client is packaged for Windows, macOS and Linux. It connects to `https://chat.innaware.net` by default and can use another compatible ChatFinity server. All server-side features use the same web application and permissions. It requires a network connection and a deployed server.

## Development

```bash
npm ci
npm run desktop
```

The first screen asks for the server URL. Connect to the HTTPS deployment. For a local developer-only server, set `CHATFINITY_ALLOW_LOCAL_HTTP=true` before launching and enter a localhost address. `CHATFINITY_SERVER_URL` can provide a managed default. Neither setting embeds credentials.

The menu has server switching, reload, zoom and fullscreen. Changing servers clears the current origin's local session data. Permission prompts control microphone/camera, notifications and display capture. macOS additionally requires the OS camera/microphone/screen-recording permissions; Linux screen sharing depends on the session's PipeWire/portal integration. Validate these on actual desktops.

## Build installers

From GitHub, run **Actions → Desktop installers → Run workflow**, or push an approved `v*` tag. Each platform builds on its own runner and uploads an artifact:

| Platform | Installer |
| --- | --- |
| Windows x64 | NSIS `.exe` |
| macOS Apple Silicon and Intel | `.dmg` and `.zip` |
| Linux x64 | `.AppImage` and `.deb` |

For local packaging on the matching operating system:

```bash
npm run pack -w @chatfinity/desktop
# Or full installer generation:
npm run release -w @chatfinity/desktop -- --win --x64
npm run release -w @chatfinity/desktop -- --mac --arm64 --x64
npm run release -w @chatfinity/desktop -- --linux --x64
```

Output is under `apps/desktop/release/`. Builders may need platform-specific system dependencies. macOS installers should be built and tested on macOS; Windows installers should be tested on Windows. A workflow artifact is not automatically a public release.

## Signing and notarization

The workflow accepts signing secrets through GitHub Actions secrets, never source files:

- `CSC_LINK`, `CSC_KEY_PASSWORD`: Apple Developer ID certificate/password for macOS.
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`: Apple notarization credentials.
- `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`: Windows signing certificate/password.

Without these credentials, builds may be unsigned or ad-hoc signed, and operating systems can warn or refuse them according to local policy. Before public distribution, sign/notarize and test launch/install/uninstall on supported clean systems. Do not promise a signed installer until the certificate-backed build has succeeded. Automatic updater channels are intentionally not configured in this initial release; distribute reviewed installer versions manually.

## Smoke tests before release

Test server enrollment, login/logout, multi-organization switching, message delivery, notification permissions and badges, native attachment downloads, microphone/camera, screen/window selection, joining/leaving a meeting, ending a meeting, resizing a short window and changing server. Confirm that arbitrary external pages cannot replace the trusted window and setup IPC is inaccessible to remote content.
