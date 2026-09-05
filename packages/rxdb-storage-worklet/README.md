# rxdb-storage-worklet

JSON-only RxDB remote-storage messaging across a React Native Worker Runtime.

## Receive bindings and lifetime

Pair `getRxStorageWorklet` and `exposeWorkletRxStorage` with the same
`receiveGlobalName`, or the same `identifier` to derive the binding name.
Independent endpoints must use distinct names. Both default to the
`rxdb-storage-worklet` identifier.

Closing a channel drains its accepted requests and releases its RN binding;
requests made after closing begins throw. The worker exposure stays available
for reopening. Its owner can await the disposer returned by
`exposeWorkletRxStorage` to drain requests already received and close the actual
storage instances before destroying the runtime. Before exposure disposal, stop new requests and await outstanding operations
and channel close so requests still queued on RN have reached the worker and
settled. Do not dispose an exposure while a sender is still draining.

## Bundle-mode replies and benchmark timing

In Worklets bundle mode, import `receiveWorkletMessage` on RN and pass that
function reference as an argument to your worker initializer. Inside the worker,
pass it as `receiveOnRN` to `exposeWorkletRxStorage` (see the example initializer).
Do not re-import it inside the worker: `scheduleOnRN` requires an RN-defined
function reference; a worker-local function cannot deliver the reply.

RN must also provide a binary-capable Blob implementation for attachment replies
when its fetch implementation cannot decode data URLs. The example uses the
existing `installWorkletRuntimePolyfills` on RN and the worker.

The optional `onTiming` callback on `getRxStorageWorklet` reports matched RN
requests: stringify duration (excluding clone/attachment conversion), scheduling
call duration, and send-to-reply-entry elapsed time. The send timestamp precedes
serialization but follows the channel send queue. These are not CPU-cost shares;
round trips also include worker work and queue waits. Instrumentation is opt-in.

## Durability

The filesystem backend inherits the premium abstract-filesystem engine's
power-loss durability limitation. A successful write or orderly close/reopen
is **not** a guarantee that acknowledged writes survive a crash or power loss.
The engine does not currently coordinate ordered filesystem flushes for document,
index, changelog, and recovery-log updates. Recovery-log truncation can therefore
persist before the corresponding data, risking lost writes or inconsistent state.

A durability guarantee requires ordered synchronization points coordinated with
the premium engine. Adding `fsync` only when closing a file does not establish
that guarantee. This package does not add such a guarantee.
