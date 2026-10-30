# Android and iPhone roadmap

Android and iPhone apps are planned after the web and desktop alpha is stable. Both will use the existing ChatFinity server, accounts, organizations, permissions, chat history and meeting service at chat.innaware.net. No separate mobile accounts or fork of the server are needed.

A shared React Native application is the proposed approach, with LiveKit's native mobile SDK for meetings. Before implementation, validate the current SDK versions and platform capabilities against official documentation.

Planned mobile capabilities:

- Organization switching, direct/group chat, announcements, replies, reactions, attachments and presence.
- Push notifications through FCM (Android) and APNs (iOS), per-device notification settings, secure device registration and token revocation. Notifications should conceal message content by default.
- Native microphone/camera permissions, meeting audio routes and Bluetooth support; background call behavior designed for each operating system.
- Secure session storage, explicit sign-out, cached drafts and resilient reconnection; offline send retries must retain message IDs to avoid duplicate delivery.
- Accessible layouts, large text, dark mode, notification badges and universal/deep links for invitations, verification and meetings.

Delivery stages: mobile navigation and authenticated API session support; Android development build; iOS development build; device testing for push, meetings and background behavior; signed test distribution; store review.

Android distribution requires signing credentials and a Google Play developer account for store release. iOS builds require macOS/Xcode, signing and an Apple Developer account; TestFlight/App Store distribution also needs Apple's review. Those accounts and credentials have not been configured. Native mobile applications have not been built or published yet. The responsive web application is available on mobile browsers now.
