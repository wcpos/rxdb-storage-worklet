import { TurboModuleRegistry, type TurboModule } from 'react-native';
import type { WorkletRuntime } from 'react-native-worklets';

interface Spec extends TurboModule { install(runtime?: object): void }
const native = TurboModuleRegistry.getEnforcing<Spec>('WorkletFs');

export function installWorkletFs(runtime?: WorkletRuntime) {
  native.install(runtime);
}
