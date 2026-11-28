import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  LinkIcon,
  MonitorIcon,
  QrIcon,
  RefreshIcon,
  TrashIcon,
} from '../../../components/MonoIcons';
import {
  FadeSlideView,
  MonoDisclosure,
  MonoDivider,
  MonoPressable,
  MonoSectionCard,
  MonoStatusDot,
} from '../../../components/MonoUi';
import { MONO, RADIUS, TYPE } from '../../../theme/monoTheme';
import {
  getActiveAiProviderSync,
  subscribeAiProviders,
} from '../../ai/lib/providerStore';
import {
  DESKTOP_BRIDGE_PROVIDER_ID,
  DesktopBridgeMeta,
  getDesktopBridgeMetaSync,
  pairDesktopBridge,
  parsePairingUri,
  refreshDesktopBridgeEngines,
  selectDesktopEngineModel,
  unpairDesktopBridge,
} from '../lib/desktopBridgeClient';
import { QrScannerModal } from './QrScannerModal';

export function DesktopBridgePanel() {
  const [meta, setMeta] = useState<DesktopBridgeMeta | null>(() =>
    getDesktopBridgeMetaSync(),
  );
  const [activeProvider, setActiveProvider] = useState(() => getActiveAiProviderSync());
  const [pairingInput, setPairingInput] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [switchingModel, setSwitchingModel] = useState<string | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    return subscribeAiProviders(() => {
      setActiveProvider(getActiveAiProviderSync());
      setMeta(getDesktopBridgeMetaSync());
    });
  }, []);

  const isBridgeActive = activeProvider?.id === DESKTOP_BRIDGE_PROVIDER_ID;
  const activeModelId = isBridgeActive ? activeProvider?.defaultModel || '' : '';

  const pairFromRawUri = useCallback(async (rawUri: string) => {
    const parsed = parsePairingUri(rawUri);
    if (!parsed) {
      setStatus({ ok: false, message: 'Invalid pairing QR' });
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const res = await pairDesktopBridge(parsed);
      setMeta(res.meta);
      setActiveProvider(getActiveAiProviderSync());
      setPairingInput('');
      setShowManual(false);
      setStatus({ ok: true, message: `Paired · ${res.meta.deviceName}` });
    } catch (err) {
      setStatus({
        ok: false,
        message: err instanceof Error ? err.message : 'Unreachable',
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      const updated = await refreshDesktopBridgeEngines();
      setMeta(updated);
      const count = updated.engines.filter((e) => e.installed).length;
      setStatus({ ok: true, message: `${count} engine${count === 1 ? '' : 's'} ready` });
    } catch (err) {
      setStatus({
        ok: false,
        message: err instanceof Error ? err.message : 'Sync failed',
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const handleSelectModel = useCallback(async (modelId: string, label: string) => {
    setSwitchingModel(modelId);
    setStatus(null);
    try {
      await selectDesktopEngineModel(modelId);
      setActiveProvider(getActiveAiProviderSync());
      setStatus({ ok: true, message: label });
    } catch (err) {
      setStatus({
        ok: false,
        message: err instanceof Error ? err.message : 'Switch failed',
      });
    } finally {
      setSwitchingModel(null);
    }
  }, []);

  const handleUnpair = useCallback(() => {
    Alert.alert('Unpair PC?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unpair',
        style: 'destructive',
        onPress: () => {
          void unpairDesktopBridge().then(() => {
            setMeta(null);
            setActiveProvider(getActiveAiProviderSync());
            setStatus(null);
          });
        },
      },
    ]);
  }, []);

  const installedModels =
    meta?.engines.flatMap((engine) =>
      engine.installed
        ? engine.models.map((m) => ({
            ...m,
            engineName: engine.name,
          }))
        : [],
    ) ?? [];

  return (
    <View style={styles.section}>
      {/* Primary Scan QR CTA */}
      <MonoPressable
        style={styles.scanBtn}
        onPress={() => setScannerOpen(true)}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator size="small" color={MONO.black} />
        ) : (
          <>
            <QrIcon color={MONO.black} size={17} />
            <Text style={styles.scanBtnText}>Scan PC QR</Text>
          </>
        )}
      </MonoPressable>

      {/* Paired PC Card */}
      {meta ? (
        <MonoSectionCard eyebrow="Paired Device">
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleWrap}>
              <MonitorIcon color={MONO.white} size={17} />
              <Text style={styles.deviceName} numberOfLines={1}>
                {meta.deviceName}
              </Text>
              <MonoStatusDot active={isBridgeActive} />
            </View>

            <View style={styles.iconGroup}>
              <MonoPressable
                style={styles.miniIconBtn}
                scaleTo={0.9}
                onPress={() => void handleRefresh()}
                disabled={busy}
                accessibilityLabel="Refresh PC engines"
              >
                <RefreshIcon color={MONO.white} size={14} />
              </MonoPressable>
              <MonoPressable
                style={styles.miniIconBtn}
                scaleTo={0.9}
                onPress={handleUnpair}
                disabled={busy}
                accessibilityLabel="Unpair PC"
              >
                <TrashIcon color={MONO.textSecondary} size={14} />
              </MonoPressable>
            </View>
          </View>

          <MonoDivider inset={16} />

          <View style={styles.modelsArea}>
            {installedModels.length > 0 ? (
              <View style={styles.chipWrap}>
                {installedModels.map((item) => {
                  const selected = activeModelId === item.id;
                  return (
                    <Pressable
                      key={item.id}
                      style={[styles.chip, selected && styles.chipActive]}
                      onPress={() => void handleSelectModel(item.id, item.label)}
                      disabled={switchingModel === item.id}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.mutedText}>No CLI detected</Text>
            )}
          </View>
        </MonoSectionCard>
      ) : (
        <View style={styles.cmdBadge}>
          <Text style={styles.cmdHint}>npm run dev:bridge</Text>
        </View>
      )}

      {status ? (
        <FadeSlideView offsetY={4}>
          <View style={styles.statusRow}>
            <MonoStatusDot active={status.ok} />
            <Text style={styles.statusText} numberOfLines={2}>
              {status.message}
            </Text>
          </View>
        </FadeSlideView>
      ) : null}

      <MonoDisclosure
        label="Manual link"
        open={showManual}
        onToggle={() => setShowManual((v) => !v)}
        leftIcon={<LinkIcon color={MONO.textMuted} size={14} />}
      />

      {showManual ? (
        <FadeSlideView offsetY={6} style={styles.manualRow}>
          <TextInput
            style={styles.input}
            value={pairingInput}
            onChangeText={setPairingInput}
            placeholder="kallie://pair?..."
            placeholderTextColor={MONO.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <MonoPressable
            style={styles.connectBtn}
            onPress={() => void pairFromRawUri(pairingInput)}
            disabled={busy || !pairingInput.trim()}
          >
            <Text style={styles.connectBtnText}>Pair</Text>
          </MonoPressable>
        </FadeSlideView>
      ) : null}

      <QrScannerModal
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanned={(uri) => {
          setScannerOpen(false);
          void pairFromRawUri(uri);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 16 },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 48,
    borderRadius: RADIUS.pill,
    backgroundColor: MONO.white,
  },
  scanBtnText: {
    ...TYPE.button,
    color: MONO.black,
  },
  cmdBadge: {
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.borderSubtle,
  },
  cmdHint: {
    ...TYPE.mono,
    color: MONO.textSecondary,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 16,
    height: 58,
  },
  cardTitleWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  deviceName: {
    ...TYPE.bodyMedium,
    color: MONO.textPrimary,
    flexShrink: 1,
  },
  iconGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  miniIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: MONO.surfaceElevated,
    borderWidth: 1,
    borderColor: MONO.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelsArea: {
    padding: 16,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 13,
    height: 32,
    borderRadius: RADIUS.pill,
    backgroundColor: MONO.surfaceElevated,
    borderWidth: 1,
    borderColor: MONO.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: MONO.white,
    borderColor: MONO.white,
  },
  chipText: {
    ...TYPE.caption,
    color: MONO.textSecondary,
  },
  chipTextActive: {
    ...TYPE.label,
    fontSize: 12,
    color: MONO.black,
  },
  mutedText: {
    ...TYPE.caption,
    color: MONO.textMuted,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: RADIUS.md,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.border,
  },
  statusText: {
    ...TYPE.caption,
    flex: 1,
    color: MONO.textPrimary,
  },
  manualRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    ...TYPE.mono,
    flex: 1,
    height: 46,
    borderRadius: RADIUS.md,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.border,
    paddingHorizontal: 14,
    color: MONO.textPrimary,
  },
  connectBtn: {
    paddingHorizontal: 20,
    height: 46,
    borderRadius: RADIUS.md,
    backgroundColor: MONO.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectBtnText: {
    ...TYPE.button,
    fontSize: 13,
    color: MONO.black,
  },
});
