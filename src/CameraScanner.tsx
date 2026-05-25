import { useEffect, useRef, useState } from "react";
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
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.CODABAR,
];

export function CameraScanner({ onScanSuccess, onClose }: CameraScannerProps) {
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [soundEnabled, setSoundEnabled] = useState(true);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const detectedRef = useRef(false);
  const scannerDivId = useRef(`scanner-${Math.random().toString(36).slice(2, 10)}`).current;

  const playScanBeep = () => {
    if (!soundEnabled) return;
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
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch {}
      try { scannerRef.current.clear(); } catch {}
      scannerRef.current = null;
    }
    setScanning(false);
  };

  const startScanner = async (mode: "environment" | "user") => {
    setError(null);
    detectedRef.current = false;
    await stopScanner();

    const scanner = new Html5Qrcode(scannerDivId, {
      verbose: false,
      formatsToSupport: SCAN_FORMATS,
    });
    scannerRef.current = scanner;

    // Try facingMode first (works on most devices)
    try {
      await scanner.start(
        { facingMode: mode },
        {
          fps: 10,
          qrbox: { width: 280, height: 100 },
          aspectRatio: 1.333,
        },
        (decodedText: string) => {
          if (detectedRef.current) return;
          detectedRef.current = true;
          playScanBeep();
          onScanSuccess(decodedText);
        },
        () => {}
      );
      setScanning(true);
      return;
    } catch (err: any) {
      // If facingMode fails, try enumerating cameras by deviceId
      const msg = err?.message || err?.toString() || "";
      if (msg.includes("NotAllowed") || msg.includes("Permission")) {
        setError("摄像头权限被拒绝，请在浏览器设置中允许摄像头访问后刷新。");
        return;
      }
    }

    // Fallback: enumerate cameras and pick by deviceId
    try {
      const devices = await Html5Qrcode.getCameras();
      if (!devices || devices.length === 0) {
        setError("未找到可用摄像头设备。");
        return;
      }

      let deviceId: string;
      if (mode === "environment") {
        const back = devices.find(
          (d) =>
            d.label.toLowerCase().includes("back") ||
            d.label.toLowerCase().includes("rear") ||
            d.label.toLowerCase().includes("环境") ||
            d.label.toLowerCase().includes("后")
        );
        deviceId = back ? back.id : devices[0].id;
      } else {
        const front = devices.find(
          (d) =>
            d.label.toLowerCase().includes("front") ||
            d.label.toLowerCase().includes("user") ||
            d.label.toLowerCase().includes("前")
        );
        deviceId = front ? front.id : devices[devices.length - 1].id;
      }

      await scanner.start(
        deviceId,
        {
          fps: 10,
          qrbox: { width: 280, height: 100 },
          aspectRatio: 1.333,
        },
        (decodedText: string) => {
          if (detectedRef.current) return;
          detectedRef.current = true;
          playScanBeep();
          onScanSuccess(decodedText);
        },
        () => {}
      );
      setScanning(true);
    } catch (err: any) {
      const msg = err?.message || err?.toString() || "";
      if (msg.includes("NotAllowed") || msg.includes("Permission")) {
        setError("摄像头权限被拒绝，请在浏览器设置中允许摄像头访问后刷新。");
      } else if (msg.includes("NotFound") || msg.includes("No available")) {
        setError("未找到可用摄像头设备。");
      } else {
        setError(`摄像头启动失败: ${msg}`);
      }
    }
  };

  const switchCamera = () => {
    const newMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newMode);
    detectedRef.current = false;
    stopScanner().then(() => {
      setTimeout(() => startScanner(newMode), 200);
    });
  };

  useEffect(() => {
    startScanner(facingMode);
    return () => { stopScanner(); };
  }, []);

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
            <p className="font-mono text-[10px] text-zinc-400">
              1D 条形码 · ZXing 纯JS
            </p>
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
          <button onClick={() => { stopScanner(); onClose(); }} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700">
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
        ) : (
          <>
            <div className="relative w-full max-w-md aspect-[4/3] overflow-hidden">
              <div id={scannerDivId} className="absolute inset-0 w-full h-full" />

              {scanning && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <div className="relative border-2 border-dashed border-emerald-500/70 bg-transparent w-[85%] h-[25%]">
                    <div className="absolute left-0 w-full h-[2.5px] bg-emerald-400 shadow-[0_0_10px_#34d399]" style={{ animation: "scan-line 1.8s ease-in-out infinite" }} />
                    <div className="absolute -top-[3px] -left-[3px] h-4 w-4 border-t-3 border-l-3 border-emerald-400 rounded-tl" />
                    <div className="absolute -top-[3px] -right-[3px] h-4 w-4 border-t-3 border-r-3 border-emerald-400 rounded-tr" />
                    <div className="absolute -bottom-[3px] -left-[3px] h-4 w-4 border-b-3 border-l-3 border-emerald-400 rounded-bl" />
                    <div className="absolute -bottom-[3px] -right-[3px] h-4 w-4 border-b-3 border-r-3 border-emerald-400 rounded-br" />
                  </div>
                  <p className="mt-5 bg-zinc-950/80 px-4 py-1.5 rounded-full text-[11px] font-medium text-zinc-300">
                    将条形码对准扫描区域
                  </p>
                </div>
              )}
            </div>

            <div className="mt-3 text-center text-xs text-zinc-500">
              Code128 / Code39 / EAN / UPC / ITF / Codabar
            </div>
          </>
        )}
      </div>

      {/* Status bar */}
      <div className="border-t border-zinc-800 bg-zinc-900 p-4">
        <div className="mx-auto flex max-w-sm items-center justify-between rounded-lg bg-zinc-800 px-3 py-2">
          <span className="text-[11px] text-zinc-400">引擎</span>
          <span className="text-xs font-semibold text-emerald-400">ZXing (纯JS)</span>
        </div>
      </div>

      <style>{`
        @keyframes scan-line {
          0%, 100% { top: 0%; }
          50% { top: 97%; }
        }
      `}</style>
    </div>
  );
}
