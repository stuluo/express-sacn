import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats, type CameraDevice } from "html5-qrcode";
import { Camera, RefreshCw, AlertTriangle, Volume2, VolumeX } from "lucide-react";

interface CameraScannerProps {
  onScanSuccess: (barcode: string) => void;
  onClose: () => void;
}

// All supported formats for maximum compatibility
const ALL_FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.AZTEC,
  Html5QrcodeSupportedFormats.PDF_417,
];

// Camera label keywords that indicate a rear/back camera, ordered by priority
const BACK_CAMERA_KEYWORDS = [
  "back",
  "rear",
  "environment",
  "后置",
  "后面",
  "背面",
  "facing back",
  "camera2 1",
  "camera 1",
];

function pickBestCamera(devices: CameraDevice[]): string {
  for (const keyword of BACK_CAMERA_KEYWORDS) {
    const match = devices.find((d) =>
      d.label.toLowerCase().includes(keyword)
    );
    if (match) return match.id;
  }
  // Fallback: pick the last camera (usually the back one on mobile)
  return devices[devices.length - 1]?.id || devices[0]?.id || "";
}

export function CameraScanner({ onScanSuccess, onClose }: CameraScannerProps) {
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [activeCameraId, setActiveCameraId] = useState<string>("");
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");

  const qrCodeInstanceRef = useRef<Html5Qrcode | null>(null);
  const containerId = "pda-camera-scanner-container";

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
    } catch {
      // Audio context not available
    }
  };

  useEffect(() => {
    Html5Qrcode.getCameras()
      .then((devices) => {
        if (devices && devices.length > 0) {
          setCameras(devices);
          const bestId = pickBestCamera(devices);
          setActiveCameraId(bestId);
        } else {
          setScannerError("未检测到摄像头，请检查设备权限或尝试刷新页面。");
        }
      })
      .catch((err) => {
        console.error("Camera detection error:", err);
        const msg = err.message || "";
        if (msg.includes("NotAllowed") || msg.includes("Permission")) {
          setScannerError("摄像头权限被拒绝，请在浏览器设置中允许摄像头访问后刷新页面。");
        } else if (msg.includes("NotFound")) {
          setScannerError("未找到可用摄像头设备。");
        } else {
          setScannerError("获取摄像头失败，请检查浏览器权限设置。");
        }
      });

    return () => {
      if (qrCodeInstanceRef.current?.isScanning) {
        qrCodeInstanceRef.current.stop().catch(() => {});
      }
    };
  }, []);

  const startScanner = async (cameraId: string) => {
    if (!cameraId) return;

    try {
      setScannerError(null);

      if (qrCodeInstanceRef.current) {
        if (qrCodeInstanceRef.current.isScanning) {
          await qrCodeInstanceRef.current.stop();
        }
      } else {
        qrCodeInstanceRef.current = new Html5Qrcode(containerId, {
          verbose: false,
          formatsToSupport: ALL_FORMATS,
          useBarCodeDetectorIfSupported: true,
        });
      }

      setIsScanning(true);

      // Unified viewfinder that works for both 1D and 2D codes
      const scanConfig = {
        fps: 30,
        qrbox: (width: number, height: number) => {
          const minDim = Math.min(width, height);
          const boxSize = Math.min(Math.floor(minDim * 0.78), 280);
          return { width: boxSize, height: boxSize };
        },
        aspectRatio: 1.333333,
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true,
        },
      };

      await qrCodeInstanceRef.current.start(
        cameraId,
        scanConfig,
        (decodedText) => {
          playScanBeep();
          onScanSuccess(decodedText);
          if (qrCodeInstanceRef.current?.isScanning) {
            qrCodeInstanceRef.current
              .stop()
              .then(() => setIsScanning(false))
              .catch(() => {});
          }
        },
        () => {
          // Silent ignore for intermediate scan attempts
        }
      );
    } catch (err: any) {
      console.error("Scanner startup error:", err);
      const msg = err.message || "";
      if (msg.includes("NotReadable") || msg.includes("in use")) {
        setScannerError("摄像头被其他应用占用，请关闭其他使用摄像头的应用后重试。");
      } else {
        setScannerError(`启动失败: ${msg}. 请尝试切换摄像头或刷新页面。`);
      }
      setIsScanning(false);
    }
  };

  const stopScanner = async () => {
    if (qrCodeInstanceRef.current?.isScanning) {
      try {
        await qrCodeInstanceRef.current.stop();
        setIsScanning(false);
      } catch {
        // Ignore stop errors
      }
    }
  };

  useEffect(() => {
    if (activeCameraId && !scannerError) {
      startScanner(activeCameraId);
    }
  }, [activeCameraId, facingMode]);

  const switchCamera = async () => {
    await stopScanner();
    const newMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newMode);

    // Try to find a matching camera for the new facing mode
    const targetKeyword = newMode === "environment" ? "back" : "front";
    const match = cameras.find((d) =>
      d.label.toLowerCase().includes(targetKeyword)
    );
    if (match) {
      setActiveCameraId(match.id);
    } else if (cameras.length > 1) {
      // Fallback: toggle to the other camera
      const currentIdx = cameras.findIndex((d) => d.id === activeCameraId);
      const nextIdx = (currentIdx + 1) % cameras.length;
      setActiveCameraId(cameras[nextIdx].id);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950 text-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4 py-3">
        <div className="flex items-center space-x-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600">
            <Camera className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-sans text-sm font-semibold text-zinc-100">
              扫码器
            </h3>
            <p className="font-mono text-[10px] text-zinc-400">
              条形码 / 二维码
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {cameras.length > 1 && (
            <button
              onClick={switchCamera}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition"
              title="切换摄像头"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
              soundEnabled
                ? "bg-zinc-800 text-emerald-400"
                : "bg-zinc-800/40 text-zinc-500"
            }`}
            title={soundEnabled ? "静音" : "开启声音"}
          >
            {soundEnabled ? (
              <Volume2 className="h-4 w-4" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={() => {
              stopScanner().finally(() => onClose());
            }}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700"
          >
            返回
          </button>
        </div>
      </div>

      {/* Scanner View */}
      <div className="relative flex flex-1 flex-col items-center justify-center bg-zinc-950 pb-8 pt-4">
        {scannerError ? (
          <div className="mx-6 max-w-md rounded-xl border border-rose-900/40 bg-rose-950/20 p-5 text-center text-rose-200">
            <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-rose-500" />
            <h4 className="font-sans text-sm font-bold">相机启动失败</h4>
            <p className="mt-1 font-sans text-xs text-rose-300/80 leading-relaxed">
              {scannerError}
            </p>
            <div className="mt-4 flex justify-center space-x-3">
              <button
                onClick={() => activeCameraId && startScanner(activeCameraId)}
                className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-500"
              >
                重试
              </button>
              <button
                onClick={onClose}
                className="rounded-lg bg-zinc-700 px-4 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-600"
              >
                返回
              </button>
            </div>
          </div>
        ) : (
          <div className="relative w-full max-w-md px-4 flex flex-col items-center">
            {/* Viewfinder */}
            <div className="relative overflow-hidden rounded-xl border-2 border-zinc-800 bg-black/40 w-full">
              <div
                id={containerId}
                className="w-full h-72 sm:h-80 mx-auto"
              />

              {isScanning && (
                <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center">
                  <div className="relative border-2 border-dashed border-emerald-500/80 rounded w-[250px] h-[250px] bg-transparent">
                    {/* Scan line animation */}
                    <div
                      className="absolute left-0 w-full h-[2px] bg-emerald-400 shadow-[0_0_8px_#34d399]"
                      style={{
                        animation: "scanner-line 2s ease-in-out infinite",
                      }}
                    />
                    {/* Corner accents */}
                    <div className="absolute -top-[3px] -left-[3px] h-5 w-5 border-t-4 border-l-4 border-emerald-500 rounded-tl" />
                    <div className="absolute -top-[3px] -right-[3px] h-5 w-5 border-t-4 border-r-4 border-emerald-500 rounded-tr" />
                    <div className="absolute -bottom-[3px] -left-[3px] h-5 w-5 border-b-4 border-l-4 border-emerald-500 rounded-bl" />
                    <div className="absolute -bottom-[3px] -right-[3px] h-5 w-5 border-b-4 border-r-4 border-emerald-500 rounded-br" />
                  </div>
                  <p className="mt-4 bg-zinc-950/80 px-3 py-1 rounded-full text-[11px] font-medium text-zinc-300">
                    将条形码或二维码对准框内
                  </p>
                </div>
              )}
            </div>

            <div className="mt-4 text-center text-xs text-zinc-500">
              支持 EAN/UPC/Code128/QR/DataMatrix 等常见码制
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-zinc-800 bg-zinc-900 p-4">
        <div className="mx-auto flex max-w-sm flex-col gap-3">
          {cameras.length > 1 && (
            <div>
              <label className="block text-[10px] font-medium text-zinc-400 uppercase mb-1">
                选择摄像头
              </label>
              <select
                value={activeCameraId}
                onChange={(e) => {
                  setActiveCameraId(e.target.value);
                }}
                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 appearance-none cursor-pointer"
              >
                {cameras.map((camera, i) => (
                  <option
                    key={camera.id}
                    value={camera.id}
                    className="bg-zinc-900 text-zinc-200"
                  >
                    {camera.label || `相机 ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg bg-zinc-800 px-3 py-2">
            <span className="text-[11px] text-zinc-400">状态</span>
            <span className="flex items-center space-x-1.5 text-xs font-semibold">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  isScanning ? "bg-emerald-500 animate-pulse" : "bg-zinc-600"
                }`}
              />
              <span
                className={
                  isScanning ? "text-emerald-400" : "text-zinc-500"
                }
              >
                {isScanning ? "扫描中" : "已停止"}
              </span>
            </span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes scanner-line {
          0%, 100% { top: 0%; }
          50% { top: 98%; }
        }
      `}</style>
    </div>
  );
}
