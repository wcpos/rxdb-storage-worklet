const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');
const { getBundleModeMetroConfig } = require('react-native-worklets/bundleMode');

const config = getBundleModeMetroConfig(getDefaultConfig(__dirname));

module.exports = withUniwindConfig(config, { cssEntryFile: './global.css' });
