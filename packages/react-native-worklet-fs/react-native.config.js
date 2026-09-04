module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: 'android',
        cxxModuleCMakeListsModuleName: 'worklet_fs',
        cxxModuleCMakeListsPath: '../cpp/CMakeLists.txt',
        cxxModuleHeaderName: 'WorkletFsModule',
      },
    },
  },
};
