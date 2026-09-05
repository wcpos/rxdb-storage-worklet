const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { getBundleModeMetroConfig } = require('react-native-worklets/bundleMode');
const { withUniwindConfig } = require('uniwind/metro');

const workspaceRoot = path.resolve(__dirname, '..');
const config = getDefaultConfig(__dirname);
const rxdbRoot = path.dirname(require.resolve('rxdb/package.json'));
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
// The test-utils barrel includes Node-only performance helpers; the device suite only needs its schemas.
config.resolver.resolveRequest = (context, moduleName, platform) => moduleName === 'rxdb/plugins/test-utils'
  ? { type: 'sourceFile', filePath: path.join(rxdbRoot, 'dist/esm/plugins/test-utils/schemas.js') }
  : context.resolveRequest(context, moduleName, platform);

module.exports = withUniwindConfig(getBundleModeMetroConfig(config), {
  cssEntryFile: './global.css',
});
