import { useEffect, useRef, useState } from "react";
import Quagga from "@ericblade/quagga2";
import { Camera, RefreshCw, AlertTriangle, Volume2, VolumeX } from "lucide-react";

interface CameraScannerProps {
  onScanSuccess: (barcode: string) => void;
  onClose: () => void;
}

const BARCODE_FORMATS = ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "itf", "codabar"] as const;
const QUAGGA_READERS = ["code_128_reader", "code_39_reader", "ean_reader", "ean_8_reader", "upc_reader", "upc_e_reader", "codabar_reader"];

export function CameraScanner({ onScanSuccess, onClose }: CameraScannerProps) {
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [engine, setEngine] = useState<"native" | "quagga" | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const quaggaRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetector | null>(null);
  const rafRef = useRef<number>(0);
  const detectedRef = useRef(false);
  const lastScanRef = useRef(0);

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

  const stopNative = () => {
    cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const stopQuagga = () => {
    try { Quagga.stop(); } catch {}
  };

  const fullStop = () => {
    if (engine === "native") stopNative();
    if (engine === "quagga") stopQuagga();
    setScanning(false);
  };

  // ── Quagga2 pure-JS fallback (works without Google Play Services) ──
  const startQuagga = (mode: "environment" | "user") => {
    if (!quaggaRef.current) return;
    setEngine("quagga");

    Quagga.init(
      {
        inputStream: {
          name: "Live",
          type: "LiveStream",
          target: quaggaRef.current,
          constraints: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
        },
        decoder: { readers: QUAGGA_READERS },
        locate: true,
        locator: { patchSize: "medium", halfSample: true },
        numOfWorkers: navigator.hardwareConcurrency ? Math.min(navigator.hardwareConcurrency, 4) : 2,
        frequency: 10,
      },
      (err: any) => {
        if (err) {
          setError(`备用扫码引擎启动失败: ${err.message || err}`);
          return;
        }
        Quagga.onDetected((result: any) => {
          if (detectedRef.current) return;
          detectedRef.current = true;
          playScanBeep();
          const code = result.codeResult.code;
          if (code) onScanSuccess(code);
        });
        Quagga.start();
        setScanning(true);
      }
    );
  };

  // ── Native BarcodeDetector API ──
  const startNative = async (mode: "environment" | "user") => {
    setEngine("native");

    try {
      detectorRef.current = new (window as any).BarcodeDetector({ formats: BARCODE_FORMATS });
    } catch {
      // native init failed, fall back to Quagga
      stopNative();
      startQuagga(mode);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      nativeScanLoop();
    } catch (err: any) {
      const msg = err.message || "";
      if (msg.includes("NotAllowed") || msg.includes("Permission")) {
        setError("摄像头权限被拒绝，请在浏览器设置中允许摄像头访问后刷新。");
      } else if (msg.includes("NotFound")) {
        setError("未找到可用摄像头设备。");
      } else {
        setError(`摄像头启动失败: ${msg}`);
      }
    }
  };

  const nativeScanLoop = () => {
    if (detectedRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const detector = detectorRef.current;
    if (!video || !canvas || !detector) return;

    const now = Date.now();
    if (now - lastScanRef.current < 150) {
      rafRef.current = requestAnimationFrame(nativeScanLoop);
      return;
    }
    lastScanRef.current = now;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) {
      rafRef.current = requestAnimationFrame(nativeScanLoop);
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cropH = vh * 0.35;
    const cropY = (vh - cropH) / 2;
    canvas.width = vw;
    canvas.height = cropH;
    ctx.drawImage(video, 0, cropY, vw, cropH, 0, 0, vw, cropH);

    detector
      .detect(canvas)
      .then((results: any[]) => {
        if (results.length > 0 && !detectedRef.current) {
          detectedRef.current = true;
          playScanBeep();
          const best = results.find((r: any) => r.format === "code_128") || results[0];
          onScanSuccess(best.rawValue);
        } else {
          rafRef.current = requestAnimationFrame(nativeScanLoop);
        }
      })
      .catch(() => {
        rafRef.current = requestAnimationFrame(nativeScanLoop);
      });
  };

  // ── Entry point ──
  const start = (mode: "environment" | "user" = facingMode) => {
    setError(null);
    detectedRef.current = false;
    fullStop();

    if ("BarcodeDetector" in window) {
      startNative(mode);
    } else {
      startQuagga(mode);
    }
  };

  const switchCamera = () => {
    const newMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newMode);
    fullStop();
    setTimeout(() => start(newMode), 200);
  };

  useEffect(() => {
    start();
    return () => fullStop();
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
              1D 条形码 · {engine === "native" ? "原生引擎" : engine === "quagga" ? "备用引擎" : "初始化中"}
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
          <button onClick={() => { fullStop(); onClose(); }} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700">
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
              {engine === "native" ? (
                <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <div ref={quaggaRef} className="absolute inset-0 w-full h-full">
                  {/* Quagga renders its own canvas + video here */}
                </div>
              )}
              <canvas ref={canvasRef} className="hidden" />

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
          <span className="text-xs font-semibold text-emerald-400">
            {engine === "native" ? "BarcodeDetector API" : engine === "quagga" ? "Quagga2 (纯JS)" : "--"}
          </span>
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
