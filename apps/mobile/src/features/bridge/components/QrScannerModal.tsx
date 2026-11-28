import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CloseIcon, FlashIcon } from '../../../components/MonoIcons';
import { MONO, RADIUS, TYPE } from '../../../theme/monoTheme';
import { parsePairingUri } from '../lib/desktopBridgeClient';

interface QrScannerModalProps {
  visible: boolean;
  onClose: () => void;
  onScanned: (rawPairingUri: string) => void;
}

export function QrScannerModal({ visible, onClose, onScanned }: QrScannerModalProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [torchOn, setTorchOn] = useState(false);
  const [invalidCode, setInvalidCode] = useState(false);
  const scanLockedRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      scanLockedRef.current = false;
      setTorchOn(false);
      setInvalidCode(false);
      return;
    }

    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission, visible]);

  const handleBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (scanLockedRef.current) return;
      const raw = (result.data || '').trim();
      if (!raw) return;

      const parsed = parsePairingUri(raw);
      if (!parsed) {
        setInvalidCode(true);
        return;
      }

      scanLockedRef.current = true;
      setInvalidCode(false);
      onScanned(raw);
    },
    [onScanned],
  );

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        {!permission ? (
          <SafeAreaView style={styles.centered}>
            <ActivityIndicator size="small" color={MONO.white} />
          </SafeAreaView>
        ) : !permission.granted ? (
          <SafeAreaView style={styles.centered}>
            <Text style={styles.permTitle}>Camera</Text>
            <Pressable
              style={styles.primaryBtn}
              onPress={() => {
                if (permission.canAskAgain) {
                  void requestPermission();
                } else {
                  void Linking.openSettings();
                }
              }}
            >
              <Text style={styles.primaryBtnText}>
                {permission.canAskAgain ? 'Allow' : 'Settings'}
              </Text>
            </Pressable>
            <Pressable style={styles.secondaryBtn} onPress={onClose}>
              <Text style={styles.secondaryBtnText}>Close</Text>
            </Pressable>
          </SafeAreaView>
        ) : (
          <View style={styles.cameraContainer}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              enableTorch={torchOn}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={handleBarcodeScanned}
            />

            <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>
              <View style={styles.topBar}>
                <Pressable
                  style={styles.circleBtn}
                  onPress={onClose}
                  accessibilityLabel="Close scanner"
                >
                  <CloseIcon color={MONO.white} size={18} />
                </Pressable>
                <Pressable
                  style={[styles.circleBtn, torchOn && styles.circleBtnActive]}
                  onPress={() => setTorchOn((v) => !v)}
                  accessibilityLabel="Toggle flashlight"
                >
                  <FlashIcon color={torchOn ? MONO.black : MONO.white} size={18} />
                </Pressable>
              </View>

              <View style={styles.frameWrap}>
                <View style={styles.frame}>
                  <View style={[styles.corner, styles.cornerTL]} />
                  <View style={[styles.corner, styles.cornerTR]} />
                  <View style={[styles.corner, styles.cornerBL]} />
                  <View style={[styles.corner, styles.cornerBR]} />
                </View>
                <Text style={styles.caption}>
                  {invalidCode ? 'Scan Kallie QR' : 'Scan PC QR'}
                </Text>
              </View>

              <View style={styles.bottomSpacer} />
            </SafeAreaView>
          </View>
        )}
      </View>
    </Modal>
  );
}

const CORNER_SIZE = 28;
const CORNER_WIDTH = 3;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MONO.bg },
  cameraContainer: { flex: 1, backgroundColor: MONO.bg },
  centered: {
    flex: 1,
    backgroundColor: MONO.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
    gap: 14,
  },
  permTitle: { ...TYPE.title, color: MONO.white },
  primaryBtn: {
    width: '100%',
    maxWidth: 240,
    backgroundColor: MONO.white,
    borderRadius: RADIUS.pill,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { ...TYPE.button, color: MONO.black },
  secondaryBtn: {
    width: '100%',
    maxWidth: 240,
    backgroundColor: MONO.surface,
    borderWidth: 1,
    borderColor: MONO.border,
    borderRadius: RADIUS.pill,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { ...TYPE.label, fontSize: 14, color: MONO.white },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  circleBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    borderWidth: 1,
    borderColor: MONO.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleBtnActive: {
    backgroundColor: MONO.white,
    borderColor: MONO.white,
  },
  frameWrap: { alignItems: 'center', gap: 18 },
  frame: { width: 240, height: 240 },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: MONO.white,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderTopLeftRadius: 14,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderTopRightRadius: 14,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderBottomLeftRadius: 14,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderBottomRightRadius: 14,
  },
  caption: {
    ...TYPE.eyebrow,
    color: MONO.white,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
  },
  bottomSpacer: { height: 24 },
});
