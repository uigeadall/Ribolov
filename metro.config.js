const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Native-only packages that explode the web bundler if let through. We
// don't run these on web — the web build exists only as a fast OAuth test
// harness — so swap them for an empty stub when platform === 'web'.
const WEB_STUB = path.resolve(__dirname, 'web-stubs/empty.js');
const WEB_STUBBED_MODULES = new Set([
  'react-native-maps',
  'expo-apple-authentication',
]);

const baseResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_STUBBED_MODULES.has(moduleName)) {
    return { type: 'sourceFile', filePath: WEB_STUB };
  }
  if (baseResolveRequest) {
    return baseResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
