module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: 'android',
        cxxModuleCMakeListsPath: '../cpp/CMakeLists.txt',
        cxxModuleCMakeListsModuleName: 'worklet_fs',
        cxxModuleHeaderName: 'WorkletFsModule',
      },
    },
  },
};
