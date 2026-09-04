const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { getBundleModeMetroConfig } = require('react-native-worklets/bundleMode');
const { withUniwindConfig } = require('uniwind/metro');

const workspaceRoot = path.resolve(__dirname, '..');
const config = getDefaultConfig(__dirname);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = [
  'source',
  ...(config.resolver.unstable_conditionNames ?? []),
];

module.exports = withUniwindConfig(getBundleModeMetroConfig(config), {
  cssEntryFile: './global.css',
});
