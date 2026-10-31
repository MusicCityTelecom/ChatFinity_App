import { useColorScheme, StyleSheet } from "react-native";
export function useTheme() {
  const dark = useColorScheme() === "dark";
  const c = dark
    ? {
        bg: "#102328",
        card: "#18343A",
        ink: "#EDF5F0",
        muted: "#A1B8B8",
        line: "#2E4B50",
        accent: "#70D6AF",
        onAccent: "#103A32",
        soft: "#204F45",
        danger: "#FF989B",
        field: "#1C383E",
      }
    : {
        bg: "#F3F7F4",
        card: "#FFFFFF",
        ink: "#193D43",
        muted: "#6D8386",
        line: "#DFE8E1",
        accent: "#166E5B",
        onAccent: "#FFFFFF",
        soft: "#E0EFE5",
        danger: "#B63C48",
        field: "#F8FAF8",
      };
  return {
    c,
    dark,
    s: StyleSheet.create({
      screen: { flex: 1, backgroundColor: c.bg },
      content: { padding: 22, gap: 17 },
      title: {
        fontSize: 28,
        fontWeight: "800",
        color: c.ink,
        letterSpacing: -0.8,
      },
      subtitle: { fontSize: 14, lineHeight: 22, color: c.muted },
      text: { fontSize: 15, color: c.ink, lineHeight: 22 },
      small: { fontSize: 12, color: c.muted },
      label: {
        fontSize: 12,
        color: c.muted,
        fontWeight: "700",
        marginBottom: 6,
      },
      input: {
        borderWidth: 1,
        borderColor: c.line,
        borderRadius: 13,
        paddingHorizontal: 15,
        paddingVertical: 13,
        minHeight: 48,
        color: c.ink,
        backgroundColor: c.field,
        fontSize: 16,
      },
      button: {
        minHeight: 48,
        padding: 13,
        paddingHorizontal: 18,
        borderRadius: 13,
        backgroundColor: c.accent,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 9,
      },
      buttonText: { fontSize: 15, fontWeight: "700", color: c.onAccent },
      secondary: {
        minHeight: 46,
        padding: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c.line,
        backgroundColor: c.card,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 9,
      },
      card: {
        padding: 18,
        backgroundColor: c.card,
        borderWidth: 1,
        borderColor: c.line,
        borderRadius: 18,
        gap: 12,
      },
      row: { flexDirection: "row", alignItems: "center", gap: 12 },
      header: {
        minHeight: 65,
        paddingHorizontal: 18,
        paddingVertical: 10,
        backgroundColor: c.card,
        borderBottomWidth: 1,
        borderColor: c.line,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      },
      icon: {
        width: 44,
        height: 44,
        borderRadius: 13,
        alignItems: "center",
        justifyContent: "center",
      },
      error: {
        padding: 13,
        backgroundColor: dark ? "#472D32" : "#FCEDEF",
        borderRadius: 12,
        color: c.danger,
        fontSize: 13,
        lineHeight: 20,
      },
      avatar: {
        width: 42,
        height: 42,
        borderRadius: 15,
        backgroundColor: c.soft,
        alignItems: "center",
        justifyContent: "center",
      },
      pill: {
        borderRadius: 9,
        backgroundColor: c.soft,
        paddingHorizontal: 9,
        paddingVertical: 4,
      },
      divider: { height: 1, backgroundColor: c.line, marginVertical: 8 },
    }),
  };
}
export const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((v) => v[0])
    .join("")
    .toUpperCase();
