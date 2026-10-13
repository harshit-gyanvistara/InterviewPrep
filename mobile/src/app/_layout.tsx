import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

// A single-screen shell: the web app itself owns navigation and chrome, so there is nothing
// here beyond a status bar and a headerless stack around the one screen in ./index.tsx.
export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
