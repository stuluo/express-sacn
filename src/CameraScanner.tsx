import { useEffect, useRef, useState, useCallback } from "react";
import { Camera, RefreshCw, AlertTriangle, Volume2, VolumeX } from "lucide-react";
import Quagga, { Result } from "@ericblade/quagga2";

interface CameraScannerProps {
  onScanSuccess: (barcode: string) => void;
  onClose: () => void;
}

const BARCODE_READERS = [
  "code_128_reader",
  "ean_reader",
  "ean_8_reader",
  "code_39_reader",
  "code_39_vin_reader",
  "upc_reader",
  "upc_e_reader",
  "codabar_reader",
  "i2of5_reader",
] as const;

export function CameraScanner({ onScanSuccess, onClose }: CameraScannerProps) {
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [soundEnabled, setSoundEnabled] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const detectedRef = useRef(false);
  const quaggaStarted = useRef(false);

  const playScanBeep = useCallback(() => {
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
  }, [soundEnabled]);

  const stopQuagga = useCallback(() => {
    quaggaStarted.current = false;
    detectedRef.current = false;
    Quagga.stop();
    setScanning(false);
  }, []);

  const startQuagga = useCallback(async (mode: "environment" | "user") => {
    setError(null);
    stopQuagga();

    if (!containerRef.current) return;

    // Clear previous canvas
    containerRef.current.innerHTML = "";

    // Small delay for DOM cleanup
    await new Promise((r) => setTimeout(r, 100));

    try {
      Quagga.init(
        {
          inputStream: {
            name: "Live",
            type: "LiveStream",
            target: containerRef.current,
            constraints: {
              facingMode: mode,
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          decoder: {
            readers: BARCODE_READERS as unknown as string[],
            debug: {
              showCanvas: false,
              showPatches: false,
              showFoundPatches: false,
              showSkeleton: false,
              showLabels: false,
              showPatchLabels: false,
              showRemainingPatchLabels: false,
              boxFromPatches: { showTransformedBox: false },
            },
          },
          locate: true,
          numOfWorkers: navigator.hardwareConcurrency || 2,
          frequency: 10,
        },
        (err: Error | null) => {
          if (err) {
            const msg = err.message || err.toString() || "";
            if (msg.includes("NotAllowed") || msg.includes("Permission")) {
              setError("摄像头权限被拒绝，请在浏览器设置中允许摄像头访问。");
            } else if (msg.includes("NotFound") || msg.includes("No available")) {
              setError("未找到可用摄像头设备。");
            } else {
              setError(`扫码器启动失败: ${msg}`);
            }
            return;
          }

          quaggaStarted.current = true;
          setScanning(true);

          // Also try barcodeDetector as a fast path if available
          Quagga.start();
        }
      );

      Quagga.onDetected((result: Result) => {
        const code = result.codeResult?.code;
        if (code && !detectedRef.current) {
          detectedRef.current = true;
          playScanBeep();
          stopQuagga();
          onScanSuccess(code);
        }
      });
    } catch (err: any) {
      const msg = err?.message || err?.toString() || "";
      setError(`扫码器启动失败: ${msg}`);
    }
  }, [onScanSuccess, playScanBeep, stopQuagga]);

  const switchCamera = useCallback(() => {
    const newMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newMode);
    detectedRef.current = false;
    startQuagga(newMode);
  }, [facingMode, startQuagga]);

  useEffect(() => {
    startQuagga(facingMode);
    return () => { stopQuagga(); };
  }, [facingMode, startQuagga, stopQuagga]);

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
            <p className="font-mono text-[10px] text-zinc-400">Quagga2 多引擎 · Worker 加速</p>
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
          <button onClick={() => { stopQuagga(); onClose(); }} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700">
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
            <div className="relative w-full max-w-md aspect-[4/3] overflow-hidden bg-zinc-800">
              <div ref={containerRef} className="absolute inset-0 w-full h-full" />

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
          <span className="text-xs font-semibold text-emerald-400">Quagga2</span>
        </div>
      </div>

      <style>{`
        @keyframes scan-line {
          0%, 100% { top: 0%; }
          50% { top: 97%; }
        }
        /* Quagga creates a video element */
        #interactive.viewport video, #interactive.viewport canvas {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
        }
      `}</style>
    </div>
  );
}
