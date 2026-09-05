*Historical snapshot as of 2026-09-05; later commits changed this state—see [t6a-fixes.md](t6a-fixes.md) and [t6b-honest-benchmarks.md](t6b-honest-benchmarks.md).*

**Observed** denotes read-only probes; **Inferred** denotes source tracing. Native builds and hosted CI were not rerun.

1. **[blocker] Short writes are acknowledged as complete.**  
   `packages/worklet-opfs/src/index.ts:343–344`; `packages/react-native-worklet-fs/cpp/WorkletFsModule.cpp:194–200`.  
   `pwrite()` can return a positive short count, especially when space runs out. The adapter discards that count, letting the engine advance document/index offsets past unwritten bytes. **Observed:** a four-byte write returning two bytes resolved successfully.  
   **Smallest fix:** loop in the adapter until all bytes are written; reject zero progress. Likewise, continue short reads until the requested range or EOF—not merely the first `pread()` result.

2. **[should-fix] Malformed native calls can escape JavaScript error handling.**  
   `packages/react-native-worklet-fs/cpp/WorkletFsModule.cpp:158–160,177–187,278–281`.  
   Host functions ignore argument count and index `args` directly; `__workletFs.readAt()` can read outside the argument array. NaN/infinite/out-of-range numbers also reach unchecked C++ integer conversions. **Inferred:** process crashes/undefined behavior rather than predictable JS exceptions.  
   **Smallest fix:** check arity before accessing arguments and validate numeric ranges before casting.

3. **[should-fix] NUL-containing names bypass path identity and open-file protection.**  
   `packages/worklet-opfs/src/index.ts:10–11,190–197`; `packages/react-native-worklet-fs/cpp/WorkletFsModule.cpp:114–119`.  
   `"data\0suffix"` passes validation but POSIX sees `"data"`. Removing that name can unlink an open `"data"` file because `openPaths` compares the untruncated string.  
   **Smallest fix:** reject embedded NUL in names and native path arguments.

4. **[blocker] Native autolinking configuration is CommonJS inside an ESM package.**  
   `packages/react-native-worklet-fs/react-native.config.js:1`; `packages/react-native-worklet-fs/package.json:5`.  
   **Observed:** importing the config without a global CommonJS `module` throws. Expo’s custom evaluator masks this; Community CLI consumers use a different [configuration loader](https://raw.githubusercontent.com/react-native-community/cli/main/packages/cli-config/src/readConfigFromDisk.ts), potentially losing the C++ module registration.  
   **Smallest fix:** use `export default` in the existing file. An in-memory probe confirmed Expo’s evaluator accepts that form.

5. **[should-fix] Orderly reopen tests do not establish power-loss durability.**  
   `packages/worklet-opfs/src/index.ts:343–356`; installed premium `storage-abstract-filesystem/bulk-write.js:1`.  
   **Observed:** a 50-document write followed by storage close performed three filesystem writes and **zero flushes**. The engine also starts changelog persistence and recovery-log truncation together. **Inferred:** power loss can preserve the truncation/index state without the corresponding document/log bytes.  
   **Smallest fix:** explicitly document this inherited durability limitation before publication. A durability guarantee requires ordered sync points coordinated with the premium engine; adding `fsync` only to `close()` is insufficient.

6. **[blocker] The public worker attachment decoder requires unavailable networking.**  
   `packages/rxdb-storage-worklet/src/index.ts:74,160`; `example/src/storage-runtime.ts:38–44`.  
   RxDB’s `createBlobFromBase64()` uses `fetch(data:...)`; the default Worker Runtime does not enable fetch. **Observed:** removing fetch produced worker-side errors. Those errors terminate the worker Subject without answering the RN request, leaving it pending. The example avoids this defect with a different decoder.  
   **Smallest fix:** use `new Blob([base64ToArrayBuffer(data)], …)` in the public decoder, and return decoding failures to the requester.

7. **[blocker] Creating another storage object steals the first object’s responses.**  
   `packages/rxdb-storage-worklet/src/index.ts:93–103,124–137`.  
   Every factory invocation overwrites RN’s `__rxdbReceiveString`, even before its storage is used. Two runtimes—or two independently created storage objects—therefore route responses into the latest Subject; earlier requests hang. Different `identifier` values do not isolate this binding.  
   **Smallest fix:** expose `receiveGlobalName` through `getRxStorageWorklet()` and require matching, distinct names for independently exposed endpoints.

8. **[blocker] A storage object cannot be reused after its last database closes.**  
   `packages/rxdb-storage-worklet/src/index.ts:113–121`.  
   The channel creator always returns the same completed channel. **Observed:** creating an instance, closing it, then reopening through the same `RxStorage` failed with `EmptyError: no elements in sequence`. The example hides this by constructing storage/exposure again.  
   **Smallest fix:** create a fresh RN channel when the creator is invoked again; do not permanently destroy the runtime’s exposure when merely closing its last current connection.

9. **[should-fix] Channel shutdown overtakes queued sends and does not perform the claimed remote cleanup.**  
   `packages/rxdb-storage-worklet/src/index.ts:108–118,158–165`; `packages/rxdb-storage-worklet/test/index.test.ts:156–181`.  
   **Observed:** `send(); close()` scheduled `disposeGlobal` **before** `deliverToGlobal`. Pending writes can be dropped. Separately, `exposeRxStorageRemote()` returns `instanceByFullName`, not the invented `close`/`unsubscribe` methods; completing the Subject does not close active storage instances. The test checks binding removal, not resource disposal.  
   **Smallest fix:** order shutdown after queued sends, define cancellation/draining of outstanding requests, and close actual exposed instances when disposing an exposure.

10. **[should-fix] The Blob polyfill exposes mutable backing storage.**  
    `packages/worklet-opfs/src/index.ts:224–240`.  
    **Observed:** changing bytes returned by `blob.arrayBuffer()` changed subsequent `blob.text()` from `"abc"` to `"xbc"`. RxDB explicitly treats Blobs as immutable when cloning, so attachment content can change without its digest changing. Blob-valued constructor parts also become empty rather than being copied.  
    **Smallest fix:** return a fresh buffer and support existing Blob parts; normalize MIME types while correcting this implementation.

11. **[should-fix] TextDecoder silently ignores fatal/BOM semantics.**  
    `packages/worklet-opfs/src/index.ts:269–275`.  
    **Observed with the supplied filesystem seam:** `{fatal:true}` decoded invalid bytes into replacement characters, and the default decoder retained a UTF-8 BOM. Premium’s default development decoder requests fatal decoding, so corrupted text can instead become apparently valid, altered document content.  
    **Smallest fix:** implement UTF-8 fatal handling and default BOM removal; reject unsupported options rather than silently ignoring them.

12. **[should-fix] Installing SHA-256 deletes other existing crypto capabilities.**  
    `packages/worklet-opfs/src/index.ts:281–290`.  
    **Observed:** an existing `crypto.getRandomValues` disappeared when `subtle.digest` was absent. This breaks partially implemented or future runtime crypto APIs.  
    **Smallest fix:** add only the missing `subtle.digest`, preserving existing `crypto` and `subtle` members.

13. **[should-fix] “56/56” does not exercise this library’s transport.**  
    `conformance/storage-entry.ts:37–55,68–72`; `example/src/storage-runtime.ts:89–96`.  
    The conformance harness passes objects directly between Subjects, preserving Blobs and bypassing JSON, scheduling, and public channel lifecycle. Native smoke uses another worker implementation. Consequently, item 6 can coexist with every reported conformance pass.  
    **Smallest fix:** route the Node suite through the actual channel using the existing fake schedulers, and use the public exposure in native smoke; include arbitrary binary attachment bytes.

14. **[should-fix] Native smoke can display “0 scenarios · ALL PASS.”**  
    `example/App.tsx:83–91`; `example/src/conformance-smoke.ts:78`; `example/.maestro/conformance-smoke.yaml:10–13`.  
    If initial storage opening rejects, no scenario result is recorded, but `finally` marks completion and zero failures becomes `ALL PASS`; Maestro accepts that text.  
    **Smallest fix:** record initialization failure and require exactly eight successful scenarios.

15. **[should-fix] Premium-dependent CI is not consistently provisioned or gated.**  
    `.github/workflows/ci.yml:19–20,34–37`; `pnpm-workspace.yaml:7`; `conformance/run.mjs:37–41`.  
    Unit CI typechecks the example without installing premium plugin contents, while their install script is disabled. Fork PRs also run conformance without the required secret and fail explicitly.  
    **Smallest fix:** keep the secret-free job limited to public-package checks; install premium and gate premium-dependent checks consistently.

16. **[should-fix] Both native CI jobs contain clean-runner setup failures.**  
    `.github/workflows/ci.yml:64,71,81,127–130`.  
    iOS disables installation during both prebuild and run, with no `pod install`; an empty cache cannot supply Pods. Android omits `arch`, requesting API 35’s unavailable `default;x86` image; the locally cached SDK catalogue lists `x86_64` and ARM64 instead. The action’s [documented default is x86](https://github.com/ReactiveCircus/android-emulator-runner#configurations).  
    **Smallest fix:** explicitly install Pods and set Android `arch: x86_64`.

17. **[should-fix] Packing depends on ignored build leftovers and omits license notices.**  
    `packages/react-native-worklet-fs/package.json:31–44`; `packages/worklet-opfs/package.json:18–22`; `packages/rxdb-storage-worklet/package.json:18–22`; `.gitignore:8`.  
    A clean checkout has no `lib`, and none of these packages builds during packing, leaving default/type exports absent. **Observed packlists:** none contains the repository’s MIT license text.  
    **Smallest fix:** add a build-before-pack hook and include the existing license in each package.

18. **[should-fix] RxDB is a private pinned dependency rather than a consumer compatibility constraint.**  
    `packages/rxdb-storage-worklet/package.json:24–29`.  
    Consumers using another RxDB version can install a nested copy silently; the remote storage then advertises that copy’s version while the application/premium engine uses another. RxDB’s exact-version checks reject this combination.  
    **Smallest fix:** move RxDB to a peer dependency with the tested compatibility constraint, retaining it as a development dependency.

19. **[should-fix] The benchmark does not execute the advertised find-by-ID operations.**  
    `example/src/benchmark.ts:271–273,330–338`.  
    **Observed:** `await collection.findByIds(ids)` returns an `RxQueryBase`, performs zero storage reads, and has no `then`. Ten identical `.find().exec()` calls also produced only one storage query because of caching; sustained queries can use event reduction.  
    **Smallest fix:** add `.exec()` to find-by-ID calls. Either label the test as an application/cache workload or deliberately force storage reads, then regenerate results.

20. **[should-fix] Performance attribution is under-instrumented; percentage shares cannot honestly be recovered.**  
    `packages/rxdb-storage-worklet/src/index.ts:53–65,108–110`; `example/src/storage-runtime.ts:49–64,84,96`; installed RxDB `src/plugins/storage-remote/rx-storage-remote.ts:163–173`.  
    The recorded iterations imply approximately **16.74 versus 7.31 ms/iteration on iOS**, and **32.79 versus 7.16 ms on Android**, but for the incomplete workload in item 19.

    **Low-confidence ranking of additional cost, not measured percentages:**
    - **Likely largest combined share: cloning, JSON and mandatory change-stream echo.** Fifty example documents already total about **272 KB** before protocol metadata. RN clones/stringifies requests; the worker parses them and returns both write events and replies. With `inWorker:true`, premium can return pre-serialized JSON; wrapping it with `JSON.stringify(message)` escapes it again, followed by outer parsing and RxDB’s inner parsing. Cheapest fixes: avoid cloning attachment-free messages and frame already-serialized returns without re-encoding them. Do not suppress change events.
    - **Likely substantial: cross-runtime dispatch and RN queue waits.** These may outrank serialization on Android. `rnSendMs` measures only the scheduling call—not serialization, execution, or round-trip latency. Cheapest fix: coalesce event/reply deliveries and measure dispatch-to-receive timestamps.
    - **Unquantified residual: engine batching/cleanup, counter rendering and emulator scheduling.** Premium’s task queue has a 10 ms idle wait; remote gaps can change batching behavior. The sustained-only counter also gives the responsive worklet run extra React work that the starved baseline scarcely executes. Cheapest investigation: controlled counter-off runs and matched batching, then physical-device release measurements.
    - **Approximately zero from `animationQueuePollingRate` on this path.** It controls [requestAnimationFrame callbacks](https://docs.swmansion.com/react-native-worklets/docs/threading/createWorkletRuntime/), not message dispatch. The installed async queue wakes through a condition variable. Lowering that setting is not the proposed throughput fix.

21. **[should-fix] The 81.4 ms figure is not attributable to either proposed sampler/counter change.**  
    `example/src/benchmark.ts:203–217,256,311,389`; `example/App.tsx:107–110`; `benchmarks/ios.json:68–78`; `example/scripts/collect-results.mjs:68–86`.  
    Missed-tick materialization is enabled **only for sustained runs**, and the counter likewise runs **only for sustained modes**. Neither mechanically inflates the short benchmark. Its sampler includes document construction, database setup, operations, closing and persistence checks—not just storage calls.

    The JSON contains **81.3986 ms as the median of three per-run maxima**, while its separately selected timeline peaks at **66.1019 ms**. Raw samples and phase timestamps were discarded, so neither an 81 ms storage stall nor a measurement artifact can be established. RN JSON processing and RxDB core are candidates, not demonstrated causes.

    **Honest publication:** “**81.4 ms median per-run maximum RN timer lateness, whole short benchmark, iOS simulator**”; identify 66.1 ms as the retained sample’s maximum. Do not substitute the older 16.8 ms or label either number isolated storage blocking. Preserve all samples and phase timestamps on the corrected rerun.

### Verdict

**Not merge-ready.** Address items **1–18**; item 5 may be resolved by explicitly documenting the inherited durability limitation rather than expanding this library. Correct item **19** and the claims in **20–21** before publishing benchmarks. Throughput optimization itself is not a merge gate.

### Behavior changes / regressions

No files modified. Native regression and performance comparisons were not rerun.