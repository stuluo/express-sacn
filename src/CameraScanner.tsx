import { useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, AlertTriangle, Volume2, VolumeX } from "lucide-react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

interface CameraScannerProps {
  onScanSuccess: (barcode: string) => void;
  onClose: () => void;
}

const ZXING_FORMATS = [
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.CODABAR,
];

const BD_FORMATS: BarcodeFormat[] = [
  "code_128", "code_39", "ean_13", "ean_8",
  "upc_a", "upc_e", "itf", "codabar", "qr_code",
];

export function CameraScanner({ onScanSuccess, onClose }: CameraScannerProps) {
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [engine, setEngine] = useState<string>("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const canvasRef = useRef<OffscreenCanvas | HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const detectedRef = useRef(false);
  const detectorRef = useRef<BarcodeDetector | null>(null);
  const zxingRef = useRef<Html5Qrcode | null>(null);
  const scannerDivId = useRef(`scanner-${Math.random().toString(36).slice(2, 10)}`).current;
  const modeRef = useRef<"environment" | "user">("environment");
  const soundRef = useRef(true);

  useEffect(() => { soundRef.current = soundEnabled; }, [soundEnabled]);

  const playScanBeep = () => {
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
  };

  const stopAll = async () => {
    detectedRef.current = false;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (zxingRef.current) { try { await zxingRef.current.stop(); } catch {} try { zxingRef.current.clear(); } catch {} zxingRef.current = null; }
    setScanning(false);
  };

  const onDetect = (code: string) => {
    if (detectedRef.current) return;
    detectedRef.current = true;
    playScanBeep();
    stopAll();
    onScanSuccess(code);
  };

  // --- BarcodeDetector scan loop ---
  const bdScanLoop = () => {
    const video = videoRef.current;
    const detector = detectorRef.current;
    const canvas = canvasRef.current;
    if (!video || !detector || !canvas) {
      rafRef.current = requestAnimationFrame(bdScanLoop);
      return;
    }
    if (video.readyState < 2) {
      rafRef.current = requestAnimationFrame(bdScanLoop);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    if (ctxRef.current) {
      ctxRef.current.drawImage(video, 0, 0, canvas.width, canvas.height);
    }

    detector.detect(canvas as HTMLCanvasElement).then((barcodes) => {
      if (barcodes.length > 0) {
        onDetect(barcodes[0].rawValue);
        return;
      }
    }).catch(() => {}).finally(() => {
      if (!detectedRef.current) {
        rafRef.current = requestAnimationFrame(bdScanLoop);
      }
    });
  };

  // --- Try BarcodeDetector first ---
  const startBdScanner = async (mode: "environment" | "user") => {
    if (!("BarcodeDetector" in window)) return false;

    try {
      const formats = await BarcodeDetector.getSupportedFormats();
      if (formats.length === 0) return false;

      // Filter to only use formats we care about
      const ourFormats = BD_FORMATS.filter(f => formats.includes(f));
      if (ourFormats.length === 0) return false;

      const detector = new BarcodeDetector({ formats: ourFormats });
      detectorRef.current = detector;

      // Create canvas for frame capture
      const canvas = document.createElement("canvas");
      canvasRef.current = canvas;
      ctxRef.current = canvas.getContext("2d", { willReadFrequently: true });

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setEngine(`BarcodeDetector (原生 ${ourFormats.length}种)`);
      setScanning(true);
      detectedRef.current = false;
      rafRef.current = requestAnimationFrame(bdScanLoop);
      return true;
    } catch {
      return false;
    }
  };

  // --- Fallback to ZXing via html5-qrcode ---
  const startZxingScanner = async (mode: "environment" | "user") => {
    setError(null);
    modeRef.current = mode;
    detectedRef.current = false;
    await stopAll();

    await new Promise(r => setTimeout(r, 200));

    const scanner = new Html5Qrcode(scannerDivId, {
      verbose: false,
      formatsToSupport: ZXING_FORMATS,
    });
    zxingRef.current = scanner;

    try {
      // Try facingMode first
      await scanner.start(
        { facingMode: mode },
        { fps: 10, qrbox: { width: 280, height: 100 }, aspectRatio: 1.333 },
        (decodedText: string) => onDetect(decodedText),
        () => {}
      );
      setEngine("ZXing (JS)");
      setScanning(true);
      return;
    } catch {}

    // Fallback: deviceId enumeration
    try {
      const devices = await Html5Qrcode.getCameras();
      if (!devices || devices.length === 0) {
        setError("未找到可用摄像头设备。");
        return;
      }

      let deviceId: string;
      if (mode === "environment") {
        const back = devices.find(d =>
          d.label.toLowerCase().includes("back") ||
          d.label.toLowerCase().includes("rear") ||
          d.label.toLowerCase().includes("环境") ||
          d.label.toLowerCase().includes("后")
        );
        deviceId = back ? back.id : devices[0].id;
      } else {
        const front = devices.find(d =>
          d.label.toLowerCase().includes("front") ||
          d.label.toLowerCase().includes("user") ||
          d.label.toLowerCase().includes("前")
        );
        deviceId = front ? front.id : devices[devices.length - 1].id;
      }

      await scanner.start(
        deviceId,
        { fps: 10, qrbox: { width: 280, height: 100 }, aspectRatio: 1.333 },
        (decodedText: string) => onDetect(decodedText),
        () => {}
      );
      setEngine("ZXing (JS)");
      setScanning(true);
    } catch (err: any) {
      const msg = err?.message || err?.toString() || "";
      if (msg.includes("NotAllowed") || msg.includes("Permission")) {
        setError("摄像头权限被拒绝，请在浏览器设置中允许摄像头访问。");
      } else if (msg.includes("NotFound") || msg.includes("No available")) {
        setError("未找到可用摄像头设备。");
      } else {
        setError(`摄像头启动失败: ${msg}`);
      }
    }
  };

  const startScanner = async (mode: "environment" | "user") => {
    setError(null);
    modeRef.current = mode;
    await stopAll();

    // Try BarcodeDetector first, fall back to ZXing
    const bdOk = await startBdScanner(mode);
    if (bdOk) return;
    await startZxingScanner(mode);
  };

  const switchCamera = () => {
    const newMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newMode);
    startScanner(newMode);
  };

  useEffect(() => {
    startScanner(facingMode);
    return () => { stopAll(); };
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
          <button onClick={() => { stopAll(); onClose(); }} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700">
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
            {/* Video element for BarcodeDetector mode */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`absolute inset-0 w-full max-w-md h-auto object-cover ${engine.startsWith("ZXing") ? "hidden" : ""}`}
            />

            {/* html5-qrcode container */}
            <div className={`relative w-full max-w-md aspect-[4/3] overflow-hidden ${engine.startsWith("BarcodeDetector") ? "hidden" : ""}`}>
              <div id={scannerDivId} className="absolute inset-0 w-full h-full" />

              {scanning && engine.startsWith("ZXing") && (
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

            {/* Scan overlay for BarcodeDetector mode */}
            {scanning && engine.startsWith("BarcodeDetector") && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center max-w-md mx-auto">
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
          </>
        )}
      </div>

      {/* Status bar */}
      <div className="border-t border-zinc-800 bg-zinc-900 p-4">
        <div className="mx-auto flex max-w-sm items-center justify-between rounded-lg bg-zinc-800 px-3 py-2">
          <span className="text-[11px] text-zinc-400">引擎</span>
          <span className="text-xs font-semibold text-emerald-400">{engine || "加载中"}</span>
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
