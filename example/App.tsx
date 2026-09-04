import { StatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import './global.css';
import {
  medianResult,
  MODE_LABELS,
  runBenchmarkSample,
  type BenchmarkResult,
  type BenchmarkMedian,
  type Mode,
} from './src/benchmark';
import { runConformanceSmoke, type ConformanceResult } from './src/conformance-smoke';

const cryptoGlobal = globalThis as any;
cryptoGlobal.crypto ??= {};
cryptoGlobal.crypto.subtle ??= { digest: Crypto.digest };

const MODES = Object.keys(MODE_LABELS) as Mode[];

const metrics: [string, (result: BenchmarkMedian) => number, string][] = [
  ['Insert 500', ({ steps }) => steps.bulkInsert500Ms, 'ms'],
  ['10 sorted queries', ({ steps }) => steps.tenQueriesMs, 'ms'],
  ['Find 200 IDs', ({ steps }) => steps.findByIds200Ms, 'ms'],
  ['Reactive insert 200', ({ steps }) => steps.reactiveInsert200Ms, 'ms'],
  ['RN send', ({ rnSendMs }) => rnSendMs, 'ms'],
  ['Total blocked', ({ lag }) => lag.totalBlockedMs, 'ms'],
  ['Max lag', ({ lag }) => lag.maxLagMs, 'ms'],
  ['Ticks > 50 ms', ({ lag }) => lag.ticksOver50Ms, ''],
];

function ResultCard({ result }: { result: BenchmarkMedian }) {
  return (
    <View style={styles.resultCard} testID={`results-${result.mode}`}>
      <View style={styles.resultHeader}>
        <Text style={styles.resultTitle}>{MODE_LABELS[result.mode]}</Text>
        <Text
          style={result.persistence.pass ? styles.pass : styles.fail}
          testID={`persistence-${result.mode}`}
        >
          {result.persistence.pass
            ? `PERSISTED ${result.persistence.actual}/50`
            : `PERSISTENCE FAILED ${result.persistence.actual}/50`}
        </Text>
      </View>
      {metrics.map(([label, value, unit]) => (
        <View style={styles.metricRow} key={label}>
          <Text style={styles.metricLabel}>{label}</Text>
          <Text style={styles.metricValue}>
            {value(result).toFixed(1)}{unit ? ` ${unit}` : ''}
          </Text>
        </View>
      ))}
      <Text style={styles.seriesNote}>
        Median sample {result.medianSample} · {result.lag.series.length} lag ticks retained
      </Text>
    </View>
  );
}

function ConformanceScreen({ close }: { close: () => void }) {
  const [results, setResults] = useState<ConformanceResult[]>([]);
  const [complete, setComplete] = useState(false);
  useEffect(() => {
    void runConformanceSmoke((result) => setResults((current) => [...current, result]))
      .finally(() => setComplete(true));
  }, []);
  const failures = results.filter((result) => !result.pass).length;
  return <SafeAreaView style={styles.safeArea}><ScrollView contentContainerStyle={styles.container}>
    <View style={styles.header}><Text style={styles.eyebrow}>RXDB · DEVICE SUITE</Text><Text style={styles.title}>Conformance smoke</Text></View>
    <Text style={failures ? styles.fail : styles.pass} testID="conformance-summary">
      {complete ? `${results.length} scenarios · ${failures ? `FAILED ${failures}` : 'ALL PASS'}` : `${results.length} scenarios · RUNNING`}
    </Text>
    {results.map((result, index) => <View key={`${result.name}-${index}`} style={styles.metricRow}><Text style={styles.metricLabel}>{result.name}</Text><Text style={result.pass ? styles.pass : styles.fail}>{result.pass ? 'PASS' : 'FAIL'} · {result.detail}</Text></View>)}
    <Pressable accessibilityRole="button" onPress={close} style={styles.button}><Text style={styles.buttonLabel}>Back to benchmarks</Text></Pressable>
  </ScrollView></SafeAreaView>;
}

export default function App() {
  const [screen, setScreen] = useState<'benchmark' | 'conformance'>('benchmark');
  const [running, setRunning] = useState<Mode | null>(null);
  const [lastCompleted, setLastCompleted] = useState<Mode | null>(null);
  const [sample, setSample] = useState(0);
  const [results, setResults] = useState<Partial<Record<Mode, BenchmarkMedian>>>({});
  const [error, setError] = useState('');

  const run = async (mode: Mode) => {
    setRunning(mode);
    setError('');
    try {
      const samples: BenchmarkResult[] = [];
      for (let index = 1; index <= 3; index += 1) {
        setSample(index);
        samples.push(await runBenchmarkSample(mode, index));
      }
      setResults((current) => ({ ...current, [mode]: medianResult(samples) }));
      setLastCompleted(mode);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      console.error(`BENCH_ERROR ${mode} ${message}`);
      setError(`${MODE_LABELS[mode]}: ${message}`);
    } finally {
      setRunning(null);
      setSample(0);
    }
  };

  if (screen === 'conformance') return <ConformanceScreen close={() => setScreen('benchmark')} />;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.container} stickyHeaderIndices={[1]}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>RXDB · WORKLET LAB</Text>
          <Text style={styles.title}>Storage benchmark</Text>
          <Text style={styles.subtitle}>
            Three samples per mode. Every sample includes 700 writes and a 50-document
            close/reopen check.
          </Text>
        </View>

        <View style={styles.statusPanel}>
          <View style={[styles.statusDot, running ? styles.statusDotRunning : null]} />
          <View style={styles.statusCopy}>
            <Text style={styles.statusLabel}>RUN STATE</Text>
            <Text style={styles.statusValue} testID="benchmark-status">
              {running
                ? `${MODE_LABELS[running]} · sample ${sample}/3`
                : lastCompleted
                  ? `Complete · ${MODE_LABELS[lastCompleted]}`
                  : 'Idle'}
            </Text>
          </View>
        </View>

        <View style={styles.controls}>
          <Pressable accessibilityRole="button" disabled={running !== null} onPress={() => setScreen('conformance')} style={styles.button} testID="conformance-open">
            <Text style={styles.buttonRoute}>DEVICE TEST SUITE</Text>
            <Text style={styles.buttonLabel}>Conformance smoke</Text>
          </Pressable>
          {MODES.map((mode) => (
            <Pressable
              accessibilityRole="button"
              disabled={running !== null}
              key={mode}
              onPress={() => void run(mode)}
              style={({ pressed }) => [
                styles.button,
                pressed && running === null ? styles.buttonPressed : null,
                running !== null ? styles.buttonDisabled : null,
              ]}
              testID={`benchmark-${mode}`}
            >
              <Text style={styles.buttonRoute}>
                {mode.startsWith('worklet') ? 'WORKER RUNTIME' : 'RN RUNTIME'}
              </Text>
              <Text style={styles.buttonLabel}>{MODE_LABELS[mode]}</Text>
            </Pressable>
          ))}
        </View>

        {error ? (
          <Text style={styles.error} testID="benchmark-error">
            {error}
          </Text>
        ) : null}

        <View style={styles.results} testID="benchmark-results">
          <Text style={styles.sectionLabel}>MEDIANS</Text>
          {MODES.map((mode) =>
            results[mode] ? <ResultCard key={mode} result={results[mode]} /> : null,
          )}
          {!Object.keys(results).length ? (
            <Text style={styles.empty}>Run a mode to populate the comparison.</Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const colors = {
  canvas: '#07111F',
  panel: '#0D1B2B',
  panelRaised: '#12243A',
  border: '#24405F',
  ink: '#F3F7FC',
  muted: '#8EA7C1',
  signal: '#4AA8FF',
  signalPressed: '#2383D8',
  success: '#53D3A0',
  danger: '#FF7C8A',
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  container: { paddingHorizontal: 18, paddingBottom: 48, gap: 18 },
  header: { paddingTop: 28, gap: 8 },
  eyebrow: {
    color: colors.signal,
    fontFamily: 'Menlo',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
  },
  title: { color: colors.ink, fontSize: 36, fontWeight: '800', letterSpacing: -1.2 },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 22, maxWidth: 520 },
  statusPanel: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    padding: 14,
  },
  statusDot: { backgroundColor: colors.muted, borderRadius: 6, height: 12, width: 12 },
  statusDotRunning: { backgroundColor: colors.signal },
  statusCopy: { flex: 1, marginLeft: 12 },
  statusLabel: { color: colors.muted, fontFamily: 'Menlo', fontSize: 10, letterSpacing: 1.5 },
  statusValue: { color: colors.ink, fontSize: 14, fontWeight: '600', marginTop: 3 },
  controls: { gap: 10 },
  button: {
    backgroundColor: colors.panelRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  buttonPressed: { backgroundColor: colors.signalPressed, borderColor: colors.signal },
  buttonDisabled: { opacity: 0.45 },
  buttonRoute: {
    color: colors.signal,
    fontFamily: 'Menlo',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  buttonLabel: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  error: {
    backgroundColor: '#341A27',
    borderColor: colors.danger,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.danger,
    padding: 12,
  },
  results: { gap: 12 },
  sectionLabel: {
    color: colors.muted,
    fontFamily: 'Menlo',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
  },
  empty: { color: colors.muted, fontSize: 14, paddingVertical: 12 },
  resultCard: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  resultHeader: { gap: 7, padding: 14 },
  resultTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  pass: { color: colors.success, fontFamily: 'Menlo', fontSize: 10, fontWeight: '700' },
  fail: { color: colors.danger, fontFamily: 'Menlo', fontSize: 10, fontWeight: '700' },
  metricRow: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  metricLabel: { color: colors.muted, fontSize: 13 },
  metricValue: { color: colors.ink, fontFamily: 'Menlo', fontSize: 13 },
  seriesNote: { color: colors.muted, fontSize: 11, padding: 14 },
});
