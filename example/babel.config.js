module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'react-native-worklets/plugin',
        {
          bundleMode: true,
          strictGlobal: true,
          importForwarding: {
            moduleNames: [
              'rxdb',
              'rxjs',
              'rxdb/plugins/core',
              'rxdb/plugins/storage-memory',
              'rxdb/plugins/storage-remote',
              'rxdb-premium/plugins/storage-abstract-filesystem',
              'rxdb-storage-worklet',
              'worklet-opfs',
              'react-native-worklet-fs',
            ],
            relativePaths: ['src'],
          },
        },
      ],
    ],
  };
};
