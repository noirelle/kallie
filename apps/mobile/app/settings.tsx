import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  BrainIcon,
  CheckIcon,
  KeyIcon,
  MonitorIcon,
  PinIcon,
  RefreshIcon,
  SearchIcon,
  ShieldIcon,
  SparkIcon,
  TrashIcon,
} from '../src/components/MonoIcons';
import {
  FadeSlideView,
  MonoDisclosure,
  MonoDivider,
  MonoHeader,
  MonoPressable,
  MonoSectionCard,
  MonoSegmentedDock,
  MonoStatusDot,
  MonoSwitch,
  SegmentedDockItem,
} from '../src/components/MonoUi';
import {
  checkClipboardForApiKey,
  DetectedClipboardKey,
  openFreeGeminiKeyPage,
  saveDetectedClipboardKey,
} from '../src/features/ai/lib/clipboardKeyDetector';
import { startOpenRouterOAuth } from '../src/features/ai/lib/openRouterAuth';
import {
  discoverProviderModels,
  testProviderConfig,
} from '../src/features/ai/lib/providerRegistry';
import {
  getActiveAiProviderSync,
  getProviderApiKey,
  listAiProvidersSync,
  saveAiProviderConfig,
} from '../src/features/ai/lib/providerStore';
import {
  AiModelDescriptor,
  PROVIDER_PRESETS,
} from '../src/features/ai/lib/providerTypes';
import {
  exportLocalBackupJson,
  importLocalBackupJson,
  wipeAllCompanionData,
} from '../src/features/backup/lib/backupManager';
import { DesktopBridgePanel } from '../src/features/bridge/components/DesktopBridgePanel';
import { MicIcon, SpeakerIcon } from '../src/features/calling/components/CallIcons';
import {
  AVAILABLE_VOICES,
  getVoiceSettingsSync,
  updateVoiceSettingsSync,
} from '../src/features/calling/lib/voiceSettingsStore';
import {
  isAutoLearnEnabledSync,
  localMemoryEngine,
  setAutoLearnEnabledSync,
  subscribeLocalMemories,
} from '../src/features/memory/lib/memoryRepository';
import { usePermissions } from '../src/features/permissions/hooks/usePermissions';
import { maskSecretForDisplay } from '../src/lib/storage/secureVault';
import { MONO, RADIUS, TYPE } from '../src/theme/monoTheme';
import { AiProviderType, MemoryRecord } from '../src/types/database';

type SettingsTab = 'provider' | 'desktop' | 'voice' | 'access' | 'memory';

const PROVIDER_SHORT_LABEL: Record<AiProviderType, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Claude',
  openai_compatible: 'Custom',
};

const PROVIDER_ORDER: AiProviderType[] = [
  'gemini',
  'openai',
  'anthropic',
  'openai_compatible',
];

const TAB_TITLES: Record<SettingsTab, string> = {
  provider: 'AI',
  desktop: 'PC',
  voice: 'Voice',
  access: 'Access',
  memory: 'Memory',
};

export default function SettingsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string | string[] }>();
  const requestedTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const initialTab: SettingsTab =
    requestedTab === 'desktop' ||
    requestedTab === 'voice' ||
    requestedTab === 'access' ||
    requestedTab === 'memory'
      ? requestedTab
      : 'provider';

  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [launchingOAuth, setLaunchingOAuth] = useState(false);
  const [clipboardKey, setClipboardKey] = useState<DetectedClipboardKey | null>(null);
  const [savingClipboardKey, setSavingClipboardKey] = useState(false);

  // Provider state
  const initialActive = getActiveAiProviderSync();
  const [providerType, setProviderType] = useState<AiProviderType>(
    initialActive?.providerType || 'gemini',
  );
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [storedKeyMask, setStoredKeyMask] = useState('');
  const [modelId, setModelId] = useState(
    initialActive?.defaultModel || PROVIDER_PRESETS.gemini.defaultModel,
  );
  const [baseUrl, setBaseUrl] = useState(initialActive?.baseUrl || '');
  const [extraHeadersText, setExtraHeadersText] = useState(
    initialActive?.extraHeaders && Object.keys(initialActive.extraHeaders).length > 0
      ? JSON.stringify(initialActive.extraHeaders)
      : '',
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [models, setModels] = useState<AiModelDescriptor[]>(
    PROVIDER_PRESETS[initialActive?.providerType || 'gemini'].suggestedModels,
  );
  const [testingProvider, setTestingProvider] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);
  const [providerStatus, setProviderStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  // Voice state
  const [voiceSettings, setVoiceSettings] = useState(() => getVoiceSettingsSync());

  // Permissions state (inline, reactive)
  const permissions = usePermissions({ syncOnResume: true });

  // Memory & Data state
  const [autoLearn, setAutoLearn] = useState(() => isAutoLearnEnabledSync());
  const [memories, setMemories] = useState<MemoryRecord[]>(() =>
    localMemoryEngine.listAll(100),
  );
  const [memorySearch, setMemorySearch] = useState('');
  const [reindexing, setReindexing] = useState(false);
  const [showDataDrawer, setShowDataDrawer] = useState(false);
  const [showRestoreInput, setShowRestoreInput] = useState(false);
  const [importDraft, setImportDraft] = useState('');

  const dockItems = useMemo<Array<SegmentedDockItem<SettingsTab>>>(
    () => [
      {
        id: 'provider',
        label: 'AI',
        renderIcon: (active) => (
          <SparkIcon color={active ? MONO.black : MONO.textSecondary} size={17} />
        ),
      },
      {
        id: 'desktop',
        label: 'PC',
        renderIcon: (active) => (
          <MonitorIcon color={active ? MONO.black : MONO.textSecondary} size={17} />
        ),
      },
      {
        id: 'voice',
        label: 'Voice',
        renderIcon: (active) => (
          <MicIcon color={active ? MONO.black : MONO.textSecondary} size={17} />
        ),
      },
      {
        id: 'access',
        label: 'Access',
        renderIcon: (active) => (
          <ShieldIcon color={active ? MONO.black : MONO.textSecondary} size={17} />
        ),
      },
      {
        id: 'memory',
        label: 'Memory',
        renderIcon: (active) => (
          <BrainIcon color={active ? MONO.black : MONO.textSecondary} size={17} />
        ),
      },
    ],
    [],
  );

  const loadProviderDraft = useCallback(async (type: AiProviderType) => {
    setProviderType(type);
    setProviderStatus(null);
    const existing = listAiProvidersSync().find((p) => p.providerType === type) ?? null;
    const preset = PROVIDER_PRESETS[type];
    setModelId(existing?.defaultModel || preset.defaultModel);
    setBaseUrl(
      existing?.baseUrl || (type === 'openai_compatible' ? preset.defaultBaseUrl : ''),
    );
    setExtraHeadersText(
      existing?.extraHeaders && Object.keys(existing.extraHeaders).length > 0
        ? JSON.stringify(existing.extraHeaders)
        : '',
    );
    setModels(preset.suggestedModels);
    setApiKeyInput('');
    const existingKey = existing ? await getProviderApiKey(existing) : null;
    setStoredKeyMask(maskSecretForDisplay(existingKey));
  }, []);

  useEffect(() => {
    void loadProviderDraft(initialActive?.providerType || 'gemini');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshClipboardKey = useCallback(async () => {
    const found = await checkClipboardForApiKey();
    setClipboardKey(found);
  }, []);

  useEffect(() => {
    void refreshClipboardKey();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshClipboardKey();
      }
    });
    return () => sub.remove();
  }, [refreshClipboardKey]);

  const handleConnectClipboardKey = useCallback(async () => {
    if (!clipboardKey || savingClipboardKey) return;
    setSavingClipboardKey(true);
    try {
      const saved = await saveDetectedClipboardKey(clipboardKey, { setActive: true });
      setClipboardKey(null);
      await loadProviderDraft(saved.providerType);
      setProviderStatus({
        ok: true,
        message: `${clipboardKey.label} · ${saved.defaultModel}`,
      });
    } catch (err) {
      setProviderStatus({
        ok: false,
        message: err instanceof Error ? err.message : 'Unable to save key',
      });
    } finally {
      setSavingClipboardKey(false);
    }
  }, [clipboardKey, loadProviderDraft, savingClipboardKey]);

  useEffect(() => {
    return subscribeLocalMemories(() => {
      setMemories(localMemoryEngine.listAll(100));
    });
  }, []);

  const parseExtraHeaders = (): Record<string, string> => {
    const trimmed = extraHeadersText.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (k.toLowerCase() === 'host') continue;
          clean[k] = String(v);
        }
        return clean;
      }
    } catch {
      // Ignore malformed JSON until corrected
    }
    return {};
  };

  const resolveEffectiveKey = async (): Promise<string | null> => {
    if (apiKeyInput.trim()) return apiKeyInput.trim();
    const existing = listAiProvidersSync().find((p) => p.providerType === providerType) ?? null;
    return existing ? getProviderApiKey(existing) : null;
  };

  const handleTestProvider = async () => {
    setTestingProvider(true);
    setProviderStatus(null);
    try {
      const key = await resolveEffectiveKey();
      const preset = PROVIDER_PRESETS[providerType];
      const tempConfig = {
        id: `provider-${providerType}`,
        providerType,
        displayName: preset.displayName,
        baseUrl: baseUrl.trim() || null,
        defaultModel: modelId.trim() || preset.defaultModel,
        embeddingModel: preset.embeddingModel,
        extraHeaders: parseExtraHeaders(),
        capabilities: preset.capabilities,
        isActive: true,
        secretKeyRef: null,
        createdAt: '',
        updatedAt: '',
      };
      const result = await testProviderConfig(tempConfig, key);
      setProviderStatus({
        ok: result.ok,
        message: result.ok ? `Connected · ${result.latencyMs}ms` : result.message,
      });
      if (result.ok) {
        const discovered = await discoverProviderModels(tempConfig, key);
        if (discovered.length > 0) {
          setModels(discovered);
          if (!modelId.trim()) setModelId(discovered[0].id);
        }
      }
    } finally {
      setTestingProvider(false);
    }
  };

  const handleSaveProvider = async () => {
    setSavingProvider(true);
    try {
      const saved = await saveAiProviderConfig({
        providerType,
        defaultModel: modelId.trim() || PROVIDER_PRESETS[providerType].defaultModel,
        baseUrl: baseUrl.trim() || null,
        extraHeaders: parseExtraHeaders(),
        apiKey: apiKeyInput.trim() ? apiKeyInput.trim() : undefined,
        setActive: true,
      });
      const storedKey = await getProviderApiKey(saved);
      setStoredKeyMask(maskSecretForDisplay(storedKey));
      setApiKeyInput('');
      setProviderStatus({ ok: true, message: `Saved · ${saved.defaultModel}` });
    } catch (err) {
      setProviderStatus({
        ok: false,
        message: err instanceof Error ? err.message : 'Save failed',
      });
    } finally {
      setSavingProvider(false);
    }
  };

  const handleExportBackup = async () => {
    try {
      const json = exportLocalBackupJson();
      await Share.share({ title: 'Kallie Backup', message: json });
    } catch (err) {
      Alert.alert('Export failed', err instanceof Error ? err.message : 'Error');
    }
  };

  const handleImportBackup = () => {
    try {
      const stats = importLocalBackupJson(importDraft);
      setImportDraft('');
      setShowRestoreInput(false);
      Alert.alert(
        'Restored',
        `${stats.memoriesRestored} memories · ${stats.conversationsRestored} chats`,
      );
    } catch (err) {
      Alert.alert('Restore failed', err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  const handleWipeAll = () => {
    Alert.alert('Erase all local data?', 'Conversations, memories, and settings will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Erase',
        style: 'destructive',
        onPress: () => {
          wipeAllCompanionData();
          setMemories([]);
        },
      },
    ]);
  };

  const filteredMemories = useMemo(
    () =>
      memorySearch.trim()
        ? memories.filter((m) =>
            m.content.toLowerCase().includes(memorySearch.trim().toLowerCase()),
          )
        : memories,
    [memories, memorySearch],
  );

  const currentPreset = PROVIDER_PRESETS[providerType];
  const allPermissionItems = useMemo(
    () => [...permissions.requiredDescriptors, ...permissions.optionalDescriptors],
    [permissions.optionalDescriptors, permissions.requiredDescriptors],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <MonoHeader
        title={TAB_TITLES[activeTab]}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />

      <MonoSegmentedDock
        items={dockItems}
        activeId={activeTab}
        onSelect={setActiveTab}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'provider' ? (
          <FadeSlideView key="provider" style={styles.section}>
            {/* Auto-Detected Clipboard Key Banner */}
            {clipboardKey ? (
              <MonoPressable
                style={styles.clipboardBanner}
                onPress={() => void handleConnectClipboardKey()}
                disabled={savingClipboardKey}
              >
                <View style={styles.clipboardBannerLeft}>
                  <KeyIcon color={MONO.black} size={16} />
                  <View style={styles.clipboardBannerTextWrap}>
                    <Text style={styles.clipboardBannerTitle}>
                      Use {clipboardKey.label} Key
                    </Text>
                    <Text style={styles.clipboardBannerSub}>{clipboardKey.masked}</Text>
                  </View>
                </View>
                {savingClipboardKey ? (
                  <ActivityIndicator size="small" color={MONO.black} />
                ) : (
                  <CheckIcon color={MONO.black} size={15} />
                )}
              </MonoPressable>
            ) : null}

            {/* Quick Connect Actions */}
            <View style={styles.quickStack}>
              <MonoPressable
                style={styles.primaryBtn}
                disabled={launchingOAuth}
                onPress={async () => {
                  setLaunchingOAuth(true);
                  try {
                    await startOpenRouterOAuth();
                  } catch (err) {
                    setProviderStatus({
                      ok: false,
                      message: err instanceof Error ? err.message : 'Unable to open browser',
                    });
                  } finally {
                    setLaunchingOAuth(false);
                  }
                }}
              >
                {launchingOAuth ? (
                  <ActivityIndicator size="small" color={MONO.black} />
                ) : (
                  <>
                    <SparkIcon color={MONO.black} size={15} />
                    <Text style={styles.primaryBtnText}>Quick Connect</Text>
                  </>
                )}
              </MonoPressable>

              <MonoPressable
                style={styles.ghostPillBtn}
                onPress={() => void openFreeGeminiKeyPage()}
              >
                <KeyIcon color={MONO.textSecondary} size={14} />
                <Text style={styles.ghostPillText}>Free Gemini Key</Text>
              </MonoPressable>
            </View>

            {/* Grouped Provider Configuration Card */}
            <MonoSectionCard eyebrow="Provider">
              <View style={styles.cardBlock}>
                <View style={styles.segmentedTrack}>
                  {PROVIDER_ORDER.map((type) => {
                    const selected = type === providerType;
                    return (
                      <Pressable
                        key={type}
                        style={[
                          styles.segmentedItem,
                          selected && styles.segmentedItemActive,
                        ]}
                        onPress={() => void loadProviderDraft(type)}
                      >
                        <Text
                          style={[
                            styles.segmentedText,
                            selected && styles.segmentedTextActive,
                          ]}
                        >
                          {PROVIDER_SHORT_LABEL[type]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <MonoDivider inset={16} />

              <View style={styles.inlineInputRow}>
                <KeyIcon color={MONO.textMuted} size={15} />
                <TextInput
                  style={[
                    styles.inlineInput,
                    storedKeyMask && !apiKeyInput && styles.monoText,
                  ]}
                  value={apiKeyInput}
                  onChangeText={setApiKeyInput}
                  placeholder={storedKeyMask || 'API Key'}
                  placeholderTextColor={storedKeyMask ? MONO.textSecondary : MONO.textMuted}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {storedKeyMask && !apiKeyInput ? (
                  <CheckIcon color={MONO.white} size={14} />
                ) : null}
              </View>

              <MonoDivider inset={16} />

              <View style={styles.modelBlock}>
                <Text style={styles.inlineEyebrow}>Model</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipStrip}
                >
                  {models.slice(0, 8).map((m) => {
                    const active = modelId === m.id;
                    return (
                      <Pressable
                        key={m.id}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => setModelId(m.id)}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>
                          {m.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            </MonoSectionCard>

            {/* Animated Advanced Disclosure */}
            <MonoDisclosure
              label="Advanced"
              open={showAdvanced || providerType === 'openai_compatible'}
              onToggle={() => setShowAdvanced((v) => !v)}
            />

            {showAdvanced || providerType === 'openai_compatible' ? (
              <FadeSlideView offsetY={6}>
                <MonoSectionCard>
                  <View style={styles.inlineInputRow}>
                    <TextInput
                      style={[styles.inlineInput, styles.monoText]}
                      value={modelId}
                      onChangeText={setModelId}
                      placeholder={currentPreset.defaultModel}
                      placeholderTextColor={MONO.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                  <MonoDivider inset={16} />
                  <View style={styles.inlineInputRow}>
                    <TextInput
                      style={[styles.inlineInput, styles.monoText]}
                      value={baseUrl}
                      onChangeText={setBaseUrl}
                      placeholder={currentPreset.defaultBaseUrl}
                      placeholderTextColor={MONO.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                  <MonoDivider inset={16} />
                  <View style={styles.inlineInputRow}>
                    <TextInput
                      style={[styles.inlineInput, styles.monoText]}
                      value={extraHeadersText}
                      onChangeText={setExtraHeadersText}
                      placeholder="Headers JSON"
                      placeholderTextColor={MONO.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                </MonoSectionCard>
              </FadeSlideView>
            ) : null}

            {providerStatus ? (
              <FadeSlideView offsetY={4}>
                <View style={styles.statusRow}>
                  <MonoStatusDot active={providerStatus.ok} />
                  <Text style={styles.statusText} numberOfLines={2}>
                    {providerStatus.message}
                  </Text>
                </View>
              </FadeSlideView>
            ) : null}

            <View style={styles.actionRow}>
              <MonoPressable
                style={styles.secondaryBtn}
                onPress={() => void handleTestProvider()}
                disabled={testingProvider}
              >
                {testingProvider ? (
                  <ActivityIndicator size="small" color={MONO.white} />
                ) : (
                  <Text style={styles.secondaryBtnText}>Test</Text>
                )}
              </MonoPressable>

              <MonoPressable
                style={styles.primaryBtn}
                onPress={() => void handleSaveProvider()}
                disabled={savingProvider}
              >
                {savingProvider ? (
                  <ActivityIndicator size="small" color={MONO.black} />
                ) : (
                  <Text style={styles.primaryBtnText}>Save</Text>
                )}
              </MonoPressable>
            </View>
          </FadeSlideView>
        ) : null}

        {activeTab === 'desktop' ? (
          <FadeSlideView key="desktop">
            <DesktopBridgePanel />
          </FadeSlideView>
        ) : null}

        {activeTab === 'voice' ? (
          <FadeSlideView key="voice" style={styles.section}>
            <MonoSectionCard eyebrow="Audio">
              <View style={styles.groupedRow}>
                <View style={styles.rowLeft}>
                  <MicIcon color={MONO.white} size={18} />
                  <Text style={styles.rowTitle}>Direct Voice</Text>
                </View>
                <MonoSwitch
                  value={voiceSettings.liveVoiceEnabled}
                  onValueChange={(v) =>
                    setVoiceSettings(updateVoiceSettingsSync({ liveVoiceEnabled: v }))
                  }
                />
              </View>

              <MonoDivider inset={16} />

              <View style={styles.groupedRow}>
                <View style={styles.rowLeft}>
                  <SpeakerIcon
                    color={MONO.white}
                    size={18}
                    active={voiceSettings.preferredAudioOutput !== 'earpiece'}
                  />
                  <Text style={styles.rowTitle}>Speaker</Text>
                </View>
                <MonoSwitch
                  value={voiceSettings.preferredAudioOutput !== 'earpiece'}
                  onValueChange={(v) =>
                    setVoiceSettings(
                      updateVoiceSettingsSync({
                        preferredAudioOutput: v ? 'speaker' : 'earpiece',
                      }),
                    )
                  }
                />
              </View>
            </MonoSectionCard>

            <View style={styles.voiceBlock}>
              <Text style={styles.sectionEyebrow}>Voice</Text>
              <View style={styles.voiceGrid}>
                {AVAILABLE_VOICES.map((voice) => {
                  const selected = voiceSettings.voiceName === voice;
                  return (
                    <MonoPressable
                      key={voice}
                      scaleTo={0.96}
                      style={[styles.voiceTile, selected && styles.voiceTileActive]}
                      onPress={() =>
                        setVoiceSettings(updateVoiceSettingsSync({ voiceName: voice }))
                      }
                    >
                      <Text
                        style={[
                          styles.voiceTileText,
                          selected && styles.voiceTileTextActive,
                        ]}
                      >
                        {voice}
                      </Text>
                    </MonoPressable>
                  );
                })}
              </View>
            </View>
          </FadeSlideView>
        ) : null}

        {activeTab === 'access' ? (
          <FadeSlideView key="access" style={styles.section}>
            <MonoSectionCard eyebrow="Permissions">
              {allPermissionItems.map((item, idx) => {
                const granted = permissions.statuses[item.id] === 'granted';
                const busy = permissions.busyKey === item.id;
                return (
                  <React.Fragment key={item.id}>
                    {idx > 0 ? <MonoDivider inset={16} /> : null}
                    <View style={styles.groupedRow}>
                      <View style={styles.rowLeft}>
                        <MonoStatusDot active={granted} />
                        <Text style={styles.rowTitle}>{item.title}</Text>
                      </View>
                      <MonoSwitch
                        value={granted}
                        disabled={busy}
                        onValueChange={() => void permissions.togglePermission(item.id)}
                      />
                    </View>
                  </React.Fragment>
                );
              })}
            </MonoSectionCard>

            <MonoPressable
              style={styles.secondaryBtn}
              onPress={() => void permissions.openSettings()}
            >
              <Text style={styles.secondaryBtnText}>System Settings</Text>
            </MonoPressable>
          </FadeSlideView>
        ) : null}

        {activeTab === 'memory' ? (
          <FadeSlideView key="memory" style={styles.section}>
            <MonoSectionCard>
              <View style={styles.groupedRow}>
                <View style={styles.rowLeft}>
                  <BrainIcon color={MONO.white} size={17} />
                  <Text style={styles.rowTitle}>Auto-learn</Text>
                </View>
                <MonoSwitch
                  value={autoLearn}
                  onValueChange={(v) => {
                    setAutoLearn(v);
                    setAutoLearnEnabledSync(v);
                  }}
                />
              </View>
            </MonoSectionCard>

            <View style={styles.searchRow}>
              <View style={styles.searchWrap}>
                <SearchIcon color={MONO.textMuted} size={15} />
                <TextInput
                  style={styles.searchInput}
                  value={memorySearch}
                  onChangeText={setMemorySearch}
                  placeholder="Search"
                  placeholderTextColor={MONO.textMuted}
                />
              </View>
              <MonoPressable
                style={styles.iconActionBtn}
                scaleTo={0.92}
                disabled={reindexing}
                onPress={async () => {
                  setReindexing(true);
                  try {
                    await localMemoryEngine.reindexEmbeddings();
                  } finally {
                    setReindexing(false);
                  }
                }}
                accessibilityLabel="Re-index memory"
              >
                {reindexing ? (
                  <ActivityIndicator size="small" color={MONO.white} />
                ) : (
                  <RefreshIcon color={MONO.white} size={16} />
                )}
              </MonoPressable>
            </View>

            {filteredMemories.length === 0 ? (
              <Text style={styles.emptyText}>No memories</Text>
            ) : (
              <MonoSectionCard eyebrow="Saved">
                {filteredMemories.map((mem, idx) => (
                  <React.Fragment key={mem.id}>
                    {idx > 0 ? <MonoDivider inset={16} /> : null}
                    <View style={styles.memoryRow}>
                      <Text style={styles.memoryContent}>{mem.content}</Text>
                      <View style={styles.memoryActions}>
                        <Pressable
                          hitSlop={10}
                          onPress={() =>
                            localMemoryEngine.updateMemory(mem.id, { pinned: !mem.pinned })
                          }
                          accessibilityLabel={mem.pinned ? 'Unpin' : 'Pin'}
                        >
                          <PinIcon
                            color={mem.pinned ? MONO.white : MONO.textMuted}
                            filled={mem.pinned}
                            size={15}
                          />
                        </Pressable>
                        <Pressable
                          hitSlop={10}
                          onPress={() => localMemoryEngine.deleteMemory(mem.id)}
                          accessibilityLabel="Delete memory"
                        >
                          <TrashIcon color={MONO.textMuted} size={15} />
                        </Pressable>
                      </View>
                    </View>
                  </React.Fragment>
                ))}
              </MonoSectionCard>
            )}

            <MonoDisclosure
              label="Backup & Reset"
              open={showDataDrawer}
              onToggle={() => setShowDataDrawer((v) => !v)}
            />

            {showDataDrawer ? (
              <FadeSlideView offsetY={6} style={styles.drawerStack}>
                <View style={styles.actionRow}>
                  <MonoPressable
                    style={styles.secondaryBtn}
                    onPress={() => void handleExportBackup()}
                  >
                    <Text style={styles.secondaryBtnText}>Export</Text>
                  </MonoPressable>
                  <MonoPressable
                    style={styles.secondaryBtn}
                    onPress={() => setShowRestoreInput((v) => !v)}
                  >
                    <Text style={styles.secondaryBtnText}>Restore</Text>
                  </MonoPressable>
                </View>

                {showRestoreInput ? (
                  <FadeSlideView offsetY={4} style={styles.drawerStack}>
                    <TextInput
                      style={[styles.standaloneInput, styles.multilineInput]}
                      value={importDraft}
                      onChangeText={setImportDraft}
                      placeholder="Paste backup JSON"
                      placeholderTextColor={MONO.textMuted}
                      multiline
                    />
                    <MonoPressable
                      style={styles.primaryBtn}
                      onPress={handleImportBackup}
                    >
                      <Text style={styles.primaryBtnText}>Apply Backup</Text>
                    </MonoPressable>
                  </FadeSlideView>
                ) : null}

                <MonoPressable style={styles.resetBtn} onPress={handleWipeAll}>
                  <TrashIcon color={MONO.textSecondary} size={14} />
                  <Text style={styles.resetBtnText}>Erase All</Text>
                </MonoPressable>
              </FadeSlideView>
            ) : null}
          </FadeSlideView>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: MONO.bg },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 44,
  },
  section: { gap: 16 },
  quickStack: {
    gap: 10,
  },
  clipboardBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: MONO.white,
    borderRadius: RADIUS.lg,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  clipboardBannerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  clipboardBannerTextWrap: {
    flex: 1,
    gap: 2,
  },
  clipboardBannerTitle: {
    ...TYPE.button,
    color: MONO.black,
  },
  clipboardBannerSub: {
    ...TYPE.mono,
    color: '#3F3F46',
  },
  ghostPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 42,
    borderRadius: RADIUS.pill,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.border,
  },
  ghostPillText: {
    ...TYPE.label,
    color: MONO.textSecondary,
  },
  cardBlock: {
    padding: 12,
  },
  segmentedTrack: {
    flexDirection: 'row',
    backgroundColor: MONO.surfaceElevated,
    borderRadius: RADIUS.pill,
    padding: 3,
    gap: 2,
  },
  segmentedItem: {
    flex: 1,
    height: 34,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentedItemActive: {
    backgroundColor: MONO.white,
  },
  segmentedText: {
    ...TYPE.label,
    fontSize: 12.5,
    color: MONO.textSecondary,
  },
  segmentedTextActive: {
    color: MONO.black,
  },
  inlineInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    height: 52,
  },
  inlineInput: {
    ...TYPE.body,
    flex: 1,
    color: MONO.textPrimary,
    paddingVertical: 0,
  },
  monoText: {
    ...TYPE.mono,
    fontSize: 13,
  },
  modelBlock: {
    paddingTop: 12,
    paddingBottom: 14,
    paddingHorizontal: 16,
    gap: 10,
  },
  inlineEyebrow: {
    ...TYPE.eyebrow,
    color: MONO.textMuted,
  },
  chipStrip: { gap: 8 },
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
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    backgroundColor: MONO.white,
    borderRadius: RADIUS.pill,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    ...TYPE.button,
    color: MONO.black,
  },
  secondaryBtn: {
    flex: 1,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.border,
    borderRadius: RADIUS.pill,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    ...TYPE.label,
    fontSize: 14,
    color: MONO.textPrimary,
  },
  groupedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 58,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowTitle: {
    ...TYPE.bodyMedium,
    color: MONO.textPrimary,
  },
  voiceBlock: {
    gap: 10,
  },
  sectionEyebrow: {
    ...TYPE.eyebrow,
    color: MONO.textMuted,
    paddingHorizontal: 4,
  },
  voiceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  voiceTile: {
    minWidth: '30%',
    flexGrow: 1,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: RADIUS.md,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceTileActive: {
    backgroundColor: MONO.white,
    borderColor: MONO.white,
  },
  voiceTileText: {
    ...TYPE.label,
    color: MONO.textSecondary,
  },
  voiceTileTextActive: {
    color: MONO.black,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 46,
    paddingHorizontal: 14,
    borderRadius: RADIUS.pill,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.border,
  },
  searchInput: {
    ...TYPE.body,
    flex: 1,
    color: MONO.textPrimary,
    paddingVertical: 0,
  },
  iconActionBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  memoryContent: {
    ...TYPE.body,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: MONO.textPrimary,
  },
  memoryActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  emptyText: {
    ...TYPE.caption,
    color: MONO.textMuted,
    textAlign: 'center',
    paddingVertical: 32,
  },
  drawerStack: {
    gap: 10,
  },
  standaloneInput: {
    ...TYPE.mono,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: 14,
    color: MONO.textPrimary,
  },
  multilineInput: {
    height: 96,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: RADIUS.pill,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.border,
  },
  resetBtnText: {
    ...TYPE.label,
    color: MONO.textSecondary,
  },
});
