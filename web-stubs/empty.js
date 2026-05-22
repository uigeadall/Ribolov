// Web-only stub. Returned by metro.config.js resolver for native-only
// modules (react-native-maps, expo-apple-authentication, etc.) when
// bundling for the web platform. We don't ship the web build to users —
// it's only used as a fast local OAuth test harness — so a noop component
// + noop methods are good enough.

const React = require('react');

function Noop() {
  return null;
}

const handler = {
  get(target, prop) {
    if (prop === '__esModule') return true;
    if (prop === 'default') return Noop;
    // Async API methods (e.g. AppleAuthentication.signInAsync) should
    // reject so callers' try/catch handles it gracefully rather than
    // exploding on undefined.
    if (typeof prop === 'string' && prop.endsWith('Async')) {
      return () => Promise.reject(new Error('Not available on web'));
    }
    return Noop;
  },
};

module.exports = new Proxy({ default: Noop }, handler);
