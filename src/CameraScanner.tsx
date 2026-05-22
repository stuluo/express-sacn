import { useEffect, useRef, useState } from "react";
import { Camera, AlertTriangle } from "lucide-react";

interface CameraScannerProps {
  onScanSuccess: (barcode: string) => void;
  onClose: () => void;
}

// BarcodeDetector API 原生硬件加速，比任何 JS 库都快
const BARCODE_FORMATS = ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "itf", "codabar"] as const;

export function CameraScanner({ onScanSuccess, onClose }: CameraScannerProps) {
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetector | null>(null);
  const rafRef = useRef<number>(0);
  const detectedRef = useRef(false);
  const lastScanRef = useRef(0);

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  };

  const start = async () => {
    setError(null);
    detectedRef.current = false;

    // 检查 BarcodeDetector API
    if (!("BarcodeDetector" in window)) {
      setError("当前浏览器不支持原生扫码，请使用扫描枪或手动输入。");
      return;
    }

    try {
      detectorRef.current = new (window as any).BarcodeDetector({ formats: BARCODE_FORMATS });
    } catch {
      setError("条形码识别器初始化失败，请使用扫描枪或手动输入。");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      scanLoop();
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

  const scanLoop = () => {
    if (detectedRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const detector = detectorRef.current;
    if (!video || !canvas || !detector) return;

    // 每隔 150ms 检测一次，减少 CPU 占用
    const now = Date.now();
    if (now - lastScanRef.current < 150) {
      rafRef.current = requestAnimationFrame(scanLoop);
      return;
    }
    lastScanRef.current = now;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 只截取画面中间横向区域（条形码通常在这里）
    const vw = video.videoWidth;
    const vh = video.videoHeight;
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
          // 优先取 Code128（快递单号常用）
          const best = results.find((r: any) => r.format === "code_128") || results[0];
          onScanSuccess(best.rawValue);
        } else {
          rafRef.current = requestAnimationFrame(scanLoop);
        }
      })
      .catch(() => {
        rafRef.current = requestAnimationFrame(scanLoop);
      });
  };

  useEffect(() => {
    start();
    return () => stop();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950 text-white">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4 py-3">
        <div className="flex items-center space-x-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600">
            <Camera className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-sans text-sm font-semibold text-zinc-100">扫码器</h3>
            <p className="font-mono text-[10px] text-zinc-400">1D 条形码 · 原生引擎</p>
          </div>
        </div>
        <button
          onClick={() => { stop(); onClose(); }}
          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700"
        >
          返回
        </button>
      </div>

      <div className="relative flex flex-1 flex-col items-center justify-center bg-zinc-950">
        {error ? (
          <div className="mx-6 max-w-md rounded-xl border border-rose-900/40 bg-rose-950/20 p-5 text-center text-rose-200">
            <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-rose-500" />
            <h4 className="font-sans text-sm font-bold">扫码不可用</h4>
            <p className="mt-1 font-sans text-xs text-rose-300/80 leading-relaxed">{error}</p>
            <button
              onClick={onClose}
              className="mt-4 rounded-lg bg-zinc-700 px-4 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-600"
            >
              返回手动输入
            </button>
          </div>
        ) : (
          <>
            <div className="relative w-full max-w-md aspect-[4/3] overflow-hidden">
              <video
                ref={videoRef}
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover"
              />
              <canvas ref={canvasRef} className="hidden" />

              {scanning && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  {/* 扫描线框 - 横向宽矩形特别适配 1D 条形码 */}
                  <div className="relative border-2 border-dashed border-emerald-500/70 bg-transparent w-[85%] h-[25%]">
                    <div
                      className="absolute left-0 w-full h-[2.5px] bg-emerald-400 shadow-[0_0_10px_#34d399]"
                      style={{ animation: "scan-line 1.8s ease-in-out infinite" }}
                    />
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

      <div className="border-t border-zinc-800 bg-zinc-900 p-4">
        <div className="mx-auto flex max-w-sm items-center justify-between rounded-lg bg-zinc-800 px-3 py-2">
          <span className="text-[11px] text-zinc-400">引擎</span>
          <span className="text-xs font-semibold text-emerald-400">BarcodeDetector API</span>
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
