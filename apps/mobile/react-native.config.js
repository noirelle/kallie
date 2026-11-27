/**
 * Disable Android autolinking for iOS-only native libraries so they never
 * allocate native modules, JNI bindings, or Telecom services during Android cold boot.
 * Android incoming calls and foreground audio are handled natively by KallieIncomingCallModule.
 */
module.exports = {
  dependencies: {
    'react-native-callkeep': {
      platforms: {
        android: null,
      },
    },
  },
};
