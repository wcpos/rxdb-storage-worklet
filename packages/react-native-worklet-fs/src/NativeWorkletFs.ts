import { TurboModuleRegistry, type TurboModule } from 'react-native';
import type { UnsafeObject } from 'react-native/Libraries/Types/CodegenTypes';

export interface Spec extends TurboModule {
  install(runtime?: UnsafeObject): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('WorkletFs');
