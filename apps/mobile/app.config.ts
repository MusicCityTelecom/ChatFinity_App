import base from "./app.json";
const preview = process.env.CHATFINITY_BUILD_CHANNEL !== "production";
export default {
  ...base.expo,
  name: preview ? "ChatFinity Preview" : "ChatFinity",
  scheme: preview ? "chatfinity-preview" : "chatfinity",
  ios: {
    ...base.expo.ios,
    bundleIdentifier: "net.innaware.chatfinity" + (preview ? ".preview" : ""),
  },
  android: {
    ...base.expo.android,
    package: "net.innaware.chatfinity" + (preview ? ".preview" : ""),
  },
  extra: {
    ...base.expo.extra,
    buildChannel: preview ? "preview" : "production",
  },
};
