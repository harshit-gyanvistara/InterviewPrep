import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

// A single-screen shell: the web app itself owns navigation and chrome, so there is nothing
// here beyond a status bar and a headerless stack around the one screen in ./index.tsx.
// "auto" (not a hardcoded "light") so the status bar icons track the system appearance instead of
// going invisible against the web app's light-theme (white) header. SafeAreaProvider is required
// for WebAppView's SafeAreaView (the native error overlay) to read real inset values.
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </SafeAreaProvider>
  );
}
