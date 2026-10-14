import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Linking, Platform, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import WebView, { type WebViewNavigation, type WebViewProps } from "react-native-webview";

import { WEB_APP_ORIGIN, WEB_APP_URL } from "@/lib/config";

// Keep the shell itself minimal: no chrome, no extra screens. Everything a user sees lives in the
// web app at WEB_APP_URL, which already handles its own safe-area padding, bottom nav, and theming
// (see app/globals.css / components/Shell.tsx in the web project) — this view just has to stay out
// of its way and feel like a native container around it.
export function WebAppView() {
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (canGoBack) {
          webViewRef.current?.goBack();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [canGoBack])
  );

  const onNavigationStateChange = useCallback((nav: WebViewNavigation) => {
    setCanGoBack(nav.canGoBack);
  }, []);

  // Links to the web app itself load in the WebView; anything else (e.g. a link to an external
  // site) opens in the system browser instead of trapping the user inside the container.
  const onShouldStartLoadWithRequest = useCallback((request: { url: string }) => {
    const isOwnOrigin = request.url.startsWith(WEB_APP_ORIGIN);
    const isAboutBlank = request.url === "about:blank";
    if (isOwnOrigin || isAboutBlank) return true;
    Linking.openURL(request.url).catch(() => {});
    return false;
  }, []);

  const retry = useCallback(() => {
    setFailed(false);
    setLoading(true);
    webViewRef.current?.reload();
  }, []);

  return (
    <View style={styles.container}>
      <WebView<WebViewProps>
        ref={webViewRef}
        source={{ uri: WEB_APP_URL }}
        style={styles.webview}
        onNavigationStateChange={onNavigationStateChange}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        onLoadEnd={() => setLoading(false)}
        onError={() => {
          setFailed(true);
          setLoading(false);
        }}
        onHttpError={({ nativeEvent }) => {
          if (nativeEvent.statusCode >= 500) {
            setFailed(true);
            setLoading(false);
          }
        }}
        // The interview flow needs the mic/camera and the device's speech recognition; these let
        // getUserMedia work without the page bouncing the user out to a separate permission screen.
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grantIfSameHostElseDeny"
        allowsBackForwardNavigationGestures={Platform.OS === "ios"}
        decelerationRate="normal"
        bounces={false}
        overScrollMode="never"
        sharedCookiesEnabled
        startInLoadingState={false}
      />
      {loading && !failed && (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#6b6fd1" />
        </View>
      )}
      {failed && (
        <View style={styles.overlay}>
          <Text style={styles.errorTitle}>Couldn&apos;t load Offerly</Text>
          <Text style={styles.errorBody}>Check your connection and try again.</Text>
          <Text style={styles.retry} onPress={retry}>
            Retry
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1b1c2e",
  },
  webview: {
    flex: 1,
    backgroundColor: "#1b1c2e",
  },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1b1c2e",
    gap: 10,
    paddingHorizontal: 32,
  },
  errorTitle: {
    color: "#f1f1f6",
    fontSize: 18,
    fontWeight: "600",
  },
  errorBody: {
    color: "#a0a4b8",
    fontSize: 14,
    textAlign: "center",
  },
  retry: {
    marginTop: 8,
    color: "#ffffff",
    backgroundColor: "#6b6fd1",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    fontSize: 14,
    fontWeight: "600",
    overflow: "hidden",
  },
});
