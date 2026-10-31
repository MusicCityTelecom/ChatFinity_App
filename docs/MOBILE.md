# Android and iPhone native clients

The native React Native/Expo application is in `apps/mobile`. It connects to **https://chat.innaware.net** and uses the existing ChatFinity users, passwords, organization memberships, chat history, permissions and LiveKit meeting service. It does not create a separate database or duplicate accounts. This is a first mobile preview, not a store release.

## Implemented in the preview

- Native sign-in, email signup with optional Organization ID, password-reset email request, email verification refresh, temporary-password replacement, self-service password changes and sign-out.
- Organization switching, Organization ID join requests, organization creation when permitted, and sharing an Organization ID.
- Public-channel discovery/joining, private groups, direct messages, scoped people/presence, conversation search, unread badges and live WebSocket updates with reconnect/foreground refresh.
- Messaging with retained in-memory drafts, retries retaining the same message ID, replies, emoji reactions, saved messages, edit/remove controls, earlier history and read acknowledgements.
- Native document picker uploads and authorized attachment downloads into private app cache, with a system share sheet. Downloads are cleared on sign-out. Shared copies in other apps remain under those apps' control. File limits remain the server's 20 MB/file and five attachments/message.
- Multi-organization broadcasts, profile/presence controls, Do Not Disturb, sound/vibration settings and native light/dark layouts with safe-area/keyboard handling.
- Native LiveKit meeting prejoin, microphone/camera toggles, participant video/audio, receiving shared screens, leaving a call and host/admin end-for-everyone. Android also has a screen-sharing control and foreground projection service. iPhone screen broadcast publishing requires a future ReplayKit extension; viewing shared screens works through the SDK.

## Session security

`POST /api/auth/mobile-login` returns a random 30-day mobile session token, CSRF token and public user profile over HTTPS. Session tokens are stored in Expo SecureStore (iOS Keychain/Android encrypted storage), never in URLs, AsyncStorage, logs or source. Only their hashes are stored server-side. Native requests and WebSocket connections pass Authorization headers. All existing Origin, CSRF, verification, account-disable and organization/channel checks remain enforced. Web cookies and mobile bearer sessions are distinct and cannot be substituted for one another.

Password resets and disabling an account revoke its sessions. Self-service password changes preserve the current session and revoke the user's others. Sign-out clears local credentials and downloads, and requests server revocation; offline sign-out cannot revoke a server session until the server is reachable. No password is retained on the phone.

## Local development

The mobile project has its own dependency lockfile and is deliberately isolated from the web/desktop npm workspace so React Native's React version cannot alter those clients.

```sh
cd apps/mobile
npm ci --workspaces=false
npm run typecheck
npx expo prebuild
npm run android
# On a Mac with Xcode:
npm run ios
```

LiveKit requires native code; Expo Go cannot run this app. Use the generated native development build or the standalone preview artifacts. Native source directories are generated from the checked-in Expo configuration and are ignored by Git. Build-tool security overrides are pinned and validated by prebuild/export/native CI; review them when upgrading Expo.

## Automated builds

The **Mobile preview builds** GitHub Actions workflow checks dependencies/types, creates Android and iOS JavaScript bundles, compiles a standalone Android APK on Linux and an iPhone simulator application on macOS. Artifacts contain SHA-256 checksums. The preview uses the separate `net.innaware.chatfinity.preview` identifier so it can coexist with a future store application.

The Android preview APK embeds its JavaScript and uses a development signing key; it needs neither Metro nor a Google Play account to install for internal testing. It is not a production signing identity. Only install preview builds obtained from this repository's trusted Actions run. The iOS simulator ZIP is for Xcode's simulator on a Mac, not an installable iPhone IPA. It is signed ad hoc with a simulator-only application/keychain identity so secure storage remains enabled; physical-device/store builds use the owner's Apple signing identity and provisioning.

`eas.json` includes development, preview and production profiles for later signed builds. EAS is optional; the initial GitHub builds do not require an Expo account. Production builds use `CHATFINITY_BUILD_CHANNEL=production` for the canonical `net.innaware.chatfinity` app identifier. Keep all signing keys and credentials outside Git.

## Built preview downloads

- [Android APK archive](https://github.com/MusicCityTelecom/ChatFinity_App/actions/runs/41165453230/artifacts/13029238122) — unzip and install `ChatFinity-android-preview.apk` on an Android phone, allowing this specific installer when Android prompts. This is an internal development-signed preview.
- [iPhone simulator archive](https://github.com/MusicCityTelecom/ChatFinity_App/actions/runs/41165811782/artifacts/13029049208) — an ad hoc signed Xcode simulator application for a Mac. This cannot install on an actual iPhone.

GitHub artifact downloads require a GitHub login and expire after the workflow's retention period; rerun **Mobile preview builds** to generate replacements. Native phone installation and calls remain physical-device checks. The separate **Mobile device UI checks** workflow exercises sign-in, optional Organization ID signup and recovery navigation without creating accounts or sending emails. [Native UI checks](https://github.com/MusicCityTelecom/ChatFinity_App/actions/runs/41167244043) passed on a 320×640 Android emulator and an iPhone 17 Pro simulator running iOS 26.4, with the built-in LiveKit module loaded. These are navigation/rendering checks, not physical-device or signed-in native call tests.

## Store enrollment

Enroll the legal business that will own ChatFinity as an **Organization**:

1. [Create a Google Play developer account](https://play.google.com/console/signup). Registration costs $25 once. Organization verification requires a D-U-N-S number and business/contact details; follow the console's current identity-verification steps.
2. [Enroll in the Apple Developer Program](https://developer.apple.com/programs/enroll/). Membership costs $99/year. Use an Apple Account with two-factor authentication, your legal business details and D-U-N-S number. Apple also verifies authority to bind the organization and its public website/work contact details.

[Look up or request a free D-U-N-S number](https://developer.apple.com/help/account/membership/D-U-N-S/) for the legal entity if it does not already have one. Account enrollment, identity verification and payments must be completed by the business owner. Do not put account passwords, payment details or signing keys in GitHub issues/source. Once the accounts are ready, configure signing privately, build the production identifiers and use internal Play testing/TestFlight before store submission. Store approval is separate from compiling the apps.

## Remaining setup and testing

- Google Play/Apple Developer organization accounts and private production signing/provisioning are not configured. Google Play registration is $25 once; Apple Developer Program membership is $99/year as checked on 2026-10-31. Both require organization verification; check the current official requirements before enrolling.
- Background push delivery is not enabled in this preview. Foreground live alerts work while connected. FCM/APNs credentials, device registration/revocation and delivery processing must be added before this can replace a full mobile messenger. The app says this explicitly in settings. iOS/Android background call behavior and call-system integration also need physical-device testing.
- Email verification, invitations and email reset links currently open the existing web flow in the browser. Return to the native app to sign in/refresh access. Universal links/native handling can follow after verified app-domain associations and signing identities are available.
- There is no persistent offline send queue; unsent drafts survive conversation switches while the app is running. They are not promised to survive process termination. Chat history is fetched from the server rather than retained as a local offline database.
- Validate real cameras/microphones, Bluetooth, screen sharing, keyboard/font scaling, device rotation, network changes and battery behavior on actual phones before public rollout. Two browser participants have exchanged simulated media and shared-screen frames through the live public site. Physical phones on separate networks, background calls and restrictive-network TURN/TLS behavior still require device testing.
- The complete system administrator and organization invitation/review consoles remain available through the web application; mobile exposes everyday account/chat/organization features.

Official references: [Expo builds](https://docs.expo.dev/build/setup/), [LiveKit Expo integration](https://docs.livekit.io/transport/sdk-platforms/expo/), [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), [Google Play signup](https://support.google.com/googleplay/android-developer/answer/6112435?hl=en), [Apple enrollment](https://developer.apple.com/programs/enroll/).
