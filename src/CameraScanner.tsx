import { useEffect, useRef, useState, useCallback } from "react";
import { Camera, RefreshCw, AlertTriangle, Volume2, VolumeX } from "lucide-react";
import Quagga from "@ericblade/quagga2";

interface CameraScannerProps {
  onScanSuccess: (barcode: string) => void;
  onClose: () => void;
}

export function CameraScanner({ onScanSuccess, onClose }: CameraScannerProps) {
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [engine, setEngine] = useState<string>("");

  const soundRef = useRef(true);
  const quaggaReadyRef = useRef(false);
  const facingModeRef = useRef(facingMode);
  const onDetectRef = useRef(onScanSuccess);
  const initIdRef = useRef(0);

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

  const cleanup = useCallback(() => {
    quaggaReadyRef.current = false;
    try { Quagga.stop(); } catch {}
    setScanning(false);
  }, []);

  const startScanner = useCallback((mode: "environment" | "user") => {
    setError(null);
    cleanup();

    const currentInitId = ++initIdRef.current;

    Quagga.init({
      inputStream: {
        name: "Live",
        type: "LiveStream",
        constraints: {
          width: { min: 640, ideal: 1920, max: 1920 },
          height: { min: 480, ideal: 1080, max: 1080 },
          facingMode: mode,
        },
      },
      locator: {
        halfSample: false,
        patchSize: "large",
      },
      decoder: {
        readers: [
          "code_128_reader",
          "ean_reader",
          "ean_8_reader",
          "code_39_reader",
          "upc_reader",
        ],
      },
      locate: true,
      numOfWorkers: 1,
      frequency: 3,
    }, (err: any) => {
      if (currentInitId !== initIdRef.current) return; // stale init

      if (err) {
        const msg = err?.message || err?.toString() || "";
        if (msg.toLowerCase().includes("notallowed") || msg.toLowerCase().includes("permission")) {
          setError("摄像头权限被拒绝，请在浏览器设置中允许访问。");
        } else if (msg.toLowerCase().includes("notfound") || msg.toLowerCase().includes("no cameras")) {
          setError("未找到可用摄像头设备。");
        } else {
          setError(`Quagga2 启动失败: ${msg}`);
        }
        console.error("[Quagga2] init error:", err);
        return;
      }

      console.log("[Quagga2] init OK, starting...");
      quaggaReadyRef.current = true;
      setEngine("Quagga2");
      setScanning(true);

      Quagga.start();
    });

    // Listen for detected barcodes
    const handler = (result: any) => {
      if (currentInitId !== initIdRef.current) return; // stale
      if (!quaggaReadyRef.current) return;

      const code = result?.codeResult?.code;
      if (!code) return;

      const err = result?.codeResult?.error;
      console.log("[Quagga2] candidate:", code, "error:", err);

      // Accept result if error is undefined (no validation error)
      if (err === undefined || err === null) {
        quaggaReadyRef.current = false;
        playScanBeep();
        cleanup();
        onDetectRef.current(code);
      }
    };

    Quagga.onDetected(handler);
  }, [cleanup, playScanBeep]);

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
            <div id="interactive" className="viewport mx-auto" />
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

      <style>{`
        #interactive.viewport {
          position: relative;
          width: 100%;
          max-width: 640px;
        }
        #interactive viewport > canvas,
        #interactive.viewport > video {
          width: 100%;
          height: auto;
          border-radius: 8px;
        }
        #interactive.viewport canvas.drawingBuffer {
          position: absolute;
          top: 0;
          left: 0;
        }
      `}</style>
    </div>
  );
}
