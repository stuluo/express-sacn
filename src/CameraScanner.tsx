import { useEffect, useRef, useState, useCallback } from "react";
import { Camera, RefreshCw, AlertTriangle, Volume2, VolumeX } from "lucide-react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

interface CameraScannerProps {
  onScanSuccess: (barcode: string) => void;
  onClose: () => void;
}

const SCAN_FORMATS = [
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.CODABAR,
];

export function CameraScanner({ onScanSuccess, onClose }: CameraScannerProps) {
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [engine, setEngine] = useState<string>("");

  const soundRef = useRef(true);
  const html5QrRef = useRef<Html5Qrcode | null>(null);
  const scannerDivId = useRef(`scanner-${Date.now()}`).current;
  const facingModeRef = useRef(facingMode);
  const onDetectRef = useRef(onScanSuccess);

  useEffect(() => { soundRef.current = soundEnabled; }, [soundEnabled]);
  useEffect(() => { facingModeRef.current = facingMode; }, [facingMode]);
  useEffect(() => { onDetectRef.current = onScanSuccess; }, [onScanSuccess]);

  const playScanBeep = useCallback(() => {
    if (!soundRef.current) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(1600, audioCtx.currentTime);
      gainNode.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.15);
    } catch {}
  }, []);

  const cleanup = useCallback(async () => {
    setScanning(false);
    if (html5QrRef.current) {
      try { await html5QrRef.current.stop(); } catch {}
      try { html5QrRef.current.clear(); } catch {}
      html5QrRef.current = null;
    }
  }, []);

  const startScanner = useCallback((mode: "environment" | "user") => {
    setError(null);
    cleanup().then(() => {
      const el = document.getElementById(scannerDivId);
      if (!el) {
        setError("扫码容器不存在，请刷新页面。");
        return;
      }
      // Clear any leftover content
      el.innerHTML = "";

      const scanner = new Html5Qrcode(scannerDivId, {
        verbose: false,
        formatsToSupport: SCAN_FORMATS,
      });
      html5QrRef.current = scanner;

      scanner.start(
        { facingMode: mode },
        {
          fps: 15,
          qrbox: { width: 300, height: 120 },
          aspectRatio: 1.5,
          disableFlipbookCallback: true,
        },
        (decodedText: string) => {
          const clean = decodedText.trim();
          if (!clean) return;
          playScanBeep();
          cleanup();
          onDetectRef.current(clean);
        },
        (errorMessage: string) => {
          // Frame-by-frame no-detection logs — ignore silently
          // Only log occasionally for debugging
        }
      ).then(() => {
        setEngine(`html5-qrcode (ZXing ${SCAN_FORMATS.length}种)`);
        setScanning(true);
      }).catch((err: any) => {
        const msg = err?.message || err?.toString() || "";
        if (msg.toLowerCase().includes("notallowed") || msg.toLowerCase().includes("permission")) {
          setError("摄像头权限被拒绝，请在浏览器设置中允许访问。");
        } else if (msg.toLowerCase().includes("notfound") || msg.toLowerCase().includes("no cameras")) {
          setError("未找到可用摄像头设备。");
        } else {
          setError(`扫码启动失败: ${msg}`);
        }
        console.error("[html5-qrcode] start error:", err);
      });
    });
  }, [cleanup, playScanBeep, scannerDivId]);

  // Initial mount
  useEffect(() => {
    startScanner(facingMode);
    return () => { cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchCamera = useCallback(() => {
    const newMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newMode);
    startScanner(newMode);
  }, [facingMode, startScanner]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950 text-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4 py-3">
        <div className="flex items-center space-x-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600">
            <Camera className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-sans text-sm font-semibold text-zinc-100">扫码器</h3>
            <p className="font-mono text-[10px] text-zinc-400">{engine || "初始化中..."}</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button onClick={switchCamera} className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition" title="切换摄像头">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${soundEnabled ? "bg-zinc-800 text-emerald-400" : "bg-zinc-800/40 text-zinc-500"}`}
            title={soundEnabled ? "静音" : "开启声音"}
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
          <button onClick={() => { cleanup(); onClose(); }} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700">
            返回
          </button>
        </div>
      </div>

      {/* Scanner area */}
      <div className="relative flex flex-1 flex-col items-center justify-center bg-zinc-950">
        {error ? (
          <div className="mx-6 max-w-md rounded-xl border border-rose-900/40 bg-rose-950/20 p-5 text-center text-rose-200">
            <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-rose-500" />
            <h4 className="font-sans text-sm font-bold">扫码不可用</h4>
            <p className="mt-1 font-sans text-xs text-rose-300/80 leading-relaxed">{error}</p>
            <button onClick={onClose} className="mt-4 rounded-lg bg-zinc-700 px-4 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-600">
              返回手动输入
            </button>
          </div>
        ) : scanning ? (
          <div className="w-full max-w-md mx-auto px-4 text-center">
            <div id={scannerDivId} className="rounded-lg overflow-hidden mx-auto" />
            <p className="mt-4 text-[11px] text-zinc-400">
              将条形码水平对准摄像头，距离 15-25cm
            </p>
          </div>
        ) : (
          <div className="text-zinc-400 text-sm">启动中...</div>
        )}
      </div>

      {/* Status bar */}
      <div className="border-t border-zinc-800 bg-zinc-900 p-4">
        <div className="mx-auto flex max-w-sm items-center justify-between rounded-lg bg-zinc-800 px-3 py-2">
          <span className="text-[11px] text-zinc-400">引擎</span>
          <span className="text-xs font-semibold text-emerald-400">{engine || "加载中"}</span>
        </div>
      </div>
    </div>
  );
}
