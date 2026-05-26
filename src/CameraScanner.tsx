import { useEffect, useRef, useState, useCallback } from "react";
import { Camera, RefreshCw, AlertTriangle, Volume2, VolumeX } from "lucide-react";
import Quagga from "@ericblade/quagga2";

interface CameraScannerProps {
  onScanSuccess: (barcode: string) => void;
  onClose: () => void;
}

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
  const [showOverlay, setShowOverlay] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const detectedRef = useRef(false);
  const detectorRef = useRef<BarcodeDetector | null>(null);
  const modeRef = useRef<"environment" | "user">("environment");
  const soundRef = useRef(true);
  const lastBeepTimeRef = useRef(0);
  const quaggaInitRef = useRef(false);

  useEffect(() => { soundRef.current = soundEnabled; }, [soundEnabled]);
  useEffect(() => { modeRef.current = facingMode; }, [facingMode]);

  const playScanBeep = useCallback(() => {
    if (!soundRef.current) return;
    const now = Date.now();
    if (now - lastBeepTimeRef.current < 300) return; // debounce
    lastBeepTimeRef.current = now;
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

  const stopQuagga = useCallback(() => {
    if (quaggaInitRef.current) {
      try { Quagga.stop(); } catch {}
      quaggaInitRef.current = false;
    }
  }, []);

  const stopAll = useCallback(() => {
    detectedRef.current = false;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (detectorRef.current) { detectorRef.current = null; }
    stopQuagga();
    setScanning(false);
  }, [stopQuagga]);

  const onDetect = useCallback((code: string) => {
    if (detectedRef.current) return;
    const clean = code.trim();
    if (!clean) return;
    detectedRef.current = true;
    playScanBeep();
    stopAll();
    onScanSuccess(clean);
  }, [onScanSuccess, playScanBeep, stopAll]);

  // --- BarcodeDetector scan loop ---
  const lastDetectTimeRef = useRef(0);
  const frameCountRef = useRef(0);

  const bdScanLoop = useCallback(() => {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector) {
      rafRef.current = requestAnimationFrame(bdScanLoop);
      return;
    }
    if (video.readyState < 2) {
      rafRef.current = requestAnimationFrame(bdScanLoop);
      return;
    }

    const now = Date.now();
    if (now - lastDetectTimeRef.current < 200) { // 降低到 5fps，给自动对焦更多时间
      rafRef.current = requestAnimationFrame(bdScanLoop);
      return;
    }
    lastDetectTimeRef.current = now;
    frameCountRef.current++;

    detector.detect(video).then((barcodes) => {
      if (frameCountRef.current <= 10 || frameCountRef.current % 30 === 0) {
        console.log(`[BarcodeDetector] frame #${frameCountRef.current}, barcodes found: ${barcodes.length}`);
      }
      if (barcodes.length > 0 && !detectedRef.current) {
        console.log("[BarcodeDetector] detected:", barcodes[0].rawValue);
        onDetect(barcodes[0].rawValue);
      }
    }).catch((err) => {
      console.error("[BarcodeDetector] detect error:", err);
    }).finally(() => {
      if (!detectedRef.current) {
        rafRef.current = requestAnimationFrame(bdScanLoop);
      }
    });
  }, [onDetect]);

  // --- Try BarcodeDetector first ---
  const startBdScanner = useCallback(async (mode: "environment" | "user"): Promise<boolean> => {
    if (!("BarcodeDetector" in window)) return false;

    try {
      const formats = await BarcodeDetector.getSupportedFormats();
      if (formats.length === 0) return false;

      const ourFormats = BD_FORMATS.filter(f => formats.includes(f));
      if (ourFormats.length === 0) return false;

      const detector = new BarcodeDetector({ formats: ourFormats });
      detectorRef.current = detector;

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
      setShowOverlay(true);
      detectedRef.current = false;
      lastDetectTimeRef.current = 0;
      rafRef.current = requestAnimationFrame(bdScanLoop);
      return true;
    } catch {
      return false;
    }
  }, [bdScanLoop]);

  // --- Quagga2 scanner ---
  const startQuagga = useCallback((mode: "environment" | "user") => {
    setError(null);
    detectedRef.current = false;
    stopAll();

    // Small delay to ensure previous camera is fully released
    setTimeout(() => {
      try {
        Quagga.init({
          inputStream: {
            name: "Live",
            type: "LiveStream",
            constraints: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: mode,
            },
            area: {
              top: "10%",
              right: "10%",
              left: "10%",
              bottom: "10%",
            },
          },
          decoder: {
            readers: [
              { format: "code_128_reader", config: {} },
              { format: "code_39_reader", config: {} },
              { format: "ean_reader", config: {} },
              { format: "ean_8_reader", config: {} },
              { format: "upc_reader", config: {} },
              { format: "upc_e_reader", config: {} },
              { format: "i2of5_reader", config: {} },
              { format: "codabar_reader", config: {} },
            ],
            multiple: false,
          },
          locator: {
            halfSample: true,
            patchSize: "medium",
          },
          numOfWorkers: 2,
          frequency: 10,
          locate: true,
          debug: {
            showCanvas: false,
            showPatches: false,
            showFoundPatches: false,
            showSkeleton: false,
            showLabels: false,
            showPatchLabels: false,
            showCurrentPatchLabels: false,
          },
        }, (err: any) => {
          if (err) {
            const msg = err?.message || err?.toString() || "";
            if (msg.includes("NotAllowed") || msg.includes("Permission")) {
              setError("摄像头权限被拒绝，请在浏览器设置中允许摄像头访问。");
            } else if (msg.includes("NotFound") || msg.includes("No cameras")) {
              setError("未找到可用摄像头设备。");
            } else {
              setError(`Quagga2 启动失败: ${msg}`);
            }
            console.error("[Quagga2] init error:", err);
            return;
          }

          quaggaInitRef.current = true;
          setEngine("Quagga2 (一维码)");
          setScanning(true);
          setShowOverlay(false); // Quagga2 draws its own overlay on canvas

          Quagga.start();
        });

        Quagga.onDetected((result: any) => {
          if (result?.codeResult?.code) {
            const code = result.codeResult.code;
            console.log("[Quagga2] detected:", code, result.codeResult);
            onDetect(code);
          }
        });
      } catch (err: any) {
        setError(`Quagga2 启动异常: ${err?.message || "未知错误"}`);
      }
    }, 300);
  }, [onDetect, stopAll]);

  const startScanner = useCallback(async (mode: "environment" | "user") => {
    setError(null);
    await stopAll();

    // Use Quagga2 directly — it has dedicated 1D barcode detection with image preprocessing.
    // BarcodeDetector is too unreliable for shipping label barcodes despite claiming support.
    startQuagga(mode);
  }, [startQuagga, stopAll]);

  const switchCamera = useCallback(() => {
    const newMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newMode);
    startScanner(newMode);
  }, [facingMode, startScanner]);

  useEffect(() => {
    startScanner(facingMode);
    return () => { stopAll(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
              className={`absolute inset-0 w-full max-w-md h-auto object-cover ${engine.startsWith("Quagga") ? "hidden" : ""}`}
            />

            {/* Quagga2 renders into #interactive.viewport (created by Quagga internally) */}
            <div
              id="interactive"
              className={`interactive-viewport relative w-full max-w-md aspect-[4/3] overflow-hidden ${engine.startsWith("BarcodeDetector") ? "hidden" : ""}`}
            />

            {/* Overlay for BarcodeDetector mode */}
            {scanning && showOverlay && engine.startsWith("BarcodeDetector") && (
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

            {/* Hint for Quagga2 mode */}
            {scanning && engine.startsWith("Quagga") && (
              <div className="pointer-events-none absolute bottom-8 left-0 right-0 flex justify-center">
                <p className="bg-zinc-950/80 px-4 py-1.5 rounded-full text-[11px] font-medium text-zinc-300">
                  将条形码对准摄像头
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
        /* Quagga2 viewport styling */
        #interactive.viewport {
          position: relative;
          width: 100%;
          max-width: 28rem;
          aspect-ratio: 4/3;
          overflow: hidden;
          margin: 0 auto;
        }
        #interactive.viewport > canvas,
        #interactive.viewport > video {
          max-width: 100%;
          width: 100%;
          height: auto;
          object-fit: cover;
        }
        #interactive.viewport canvas.drawingBuffer {
          position: absolute;
          left: 0;
          top: 0;
        }
      `}</style>
    </div>
  );
}
