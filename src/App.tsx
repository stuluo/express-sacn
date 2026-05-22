import { useState, useEffect, useRef } from "react";
import { Camera, Barcode, Wifi, WifiOff, Send, CheckCircle2, XCircle, Scale, Trash2, Clock } from "lucide-react";
import { CameraScanner } from "./CameraScanner";

interface ScanRecord {
  id: string;
  kddh: string;
  kdzl: number;
  time: string;
  synced: boolean;
}

export default function App() {
  const [trackingNo, setTrackingNo] = useState("");
  const [weight, setWeight] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [records, setRecords] = useState<ScanRecord[]>([]);

  const weightRef = useRef<HTMLInputElement>(null);
  const lastKeyTimeRef = useRef(0);
  const barcodeBufferRef = useRef("");

  // Health check
  useEffect(() => {
    fetch("/api/health")
      .then((r) => setApiOk(r.ok))
      .catch(() => setApiOk(false));
  }, []);

  // Load history
  useEffect(() => {
    try {
      const saved = localStorage.getItem("express_scan_records");
      if (saved) setRecords(JSON.parse(saved));
    } catch {}
  }, []);

  // Save history
  useEffect(() => {
    localStorage.setItem("express_scan_records", JSON.stringify(records.slice(0, 100)));
  }, [records]);

  // PDA hardware scanner listener
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      const now = Date.now();
      if (now - lastKeyTimeRef.current > 60) barcodeBufferRef.current = "";
      lastKeyTimeRef.current = now;

      if (e.key === "Enter") {
        if (barcodeBufferRef.current.length > 2) {
          const code = barcodeBufferRef.current;
          barcodeBufferRef.current = "";
          handleScan(code);
        }
      } else if (e.key.length === 1) {
        barcodeBufferRef.current += e.key;
      }
    };
    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, []);

  const handleScan = (code: string) => {
    const clean = code.trim();
    // Check duplicate
    if (records.some((r) => r.kddh === clean)) {
      setFeedback({ type: "error", text: `单号 ${clean} 已存在，不能重复扫码` });
      return;
    }
    setTrackingNo(clean);
    setWeight("");
    setFeedback(null);
    setTimeout(() => weightRef.current?.focus(), 150);
  };

  // Add to local cache only, no API call
  const handleAdd = () => {
    const kddh = trackingNo.trim();
    const kdzl = parseFloat(weight);
    if (!kddh) { setFeedback({ type: "error", text: "请先扫描快递单号" }); return; }
    if (isNaN(kdzl) || kdzl <= 0) { setFeedback({ type: "error", text: "请输入有效的快递重量" }); return; }
    if (records.some((r) => r.kddh === kddh)) {
      setFeedback({ type: "error", text: `单号 ${kddh} 已存在，不能重复添加` });
      return;
    }

    const record: ScanRecord = {
      id: Date.now().toString(),
      kddh,
      kdzl: Math.round(kdzl * 100) / 100,
      time: new Date().toLocaleString("zh-CN"),
      synced: false,
    };
    setRecords((prev) => [record, ...prev]);
    setFeedback({ type: "success", text: `已缓存：${kddh}，${record.kdzl.toFixed(2)}kg` });
    setTrackingNo("");
    setWeight("");
    setTimeout(() => {
      const input = document.getElementById("barcode-input") as HTMLInputElement;
      input?.focus();
    }, 100);
  };

  const handleDeleteRecord = (id: string) => {
    setRecords((prev) => prev.filter((r) => r.id !== id));
  };

  const handleClearAll = () => {
    if (confirm("确认清空所有缓存和上传记录吗？")) {
      setRecords([]);
      localStorage.removeItem("express_scan_records");
    }
  };

  // Batch submit all unsynced records
  const handleBatchSubmit = async () => {
    const pending = records.filter((r) => !r.synced);
    if (pending.length === 0) { setFeedback({ type: "error", text: "没有待提交的缓存记录" }); return; }

    setBusy(true);
    setFeedback(null);

    let ok = 0;
    let fail = 0;

    for (const r of pending) {
      try {
        const res = await fetch("/api/nocobase/kdcz:create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kddh: r.kddh, kdzl: r.kdzl }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setRecords((prev) => prev.map((p) => p.id === r.id ? { ...p, synced: true } : p));
        ok++;
      } catch {
        fail++;
      }
    }

    if (fail === 0) {
      setFeedback({ type: "success", text: `全部提交成功，共 ${ok} 条` });
    } else {
      setFeedback({ type: "error", text: `提交完成：${ok} 成功，${fail} 失败` });
    }
    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900 pb-16 font-sans">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-zinc-200 px-4 py-3">
        <div className="mx-auto max-w-lg flex items-center justify-between">
          <h1 className="text-sm font-bold text-zinc-800">快递称重扫描</h1>
          {apiOk ? (
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-150">
              <Wifi className="mr-1 h-3 w-3 text-emerald-500" />已连接
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 border border-rose-150 animate-pulse">
              <WifiOff className="mr-1 h-3 w-3 text-rose-500" />未连接
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-4 space-y-4">
        {/* Scanner Section */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="text-xs font-bold tracking-wider text-zinc-400 uppercase mb-3">扫描快递单号</h2>
          <form
            onSubmit={(e) => { e.preventDefault(); handleScan(trackingNo); }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Barcode className="absolute left-3 top-3 h-4 w-4 text-zinc-400" />
              <input
                id="barcode-input"
                type="text"
                placeholder="扫描或手动输入快递单号"
                value={trackingNo}
                onChange={(e) => setTrackingNo(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-10 pr-3 py-2.5 font-mono text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg bg-zinc-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-zinc-800 cursor-pointer"
            >
              读取
            </button>
          </form>
          <button
            onClick={() => setCameraOpen(true)}
            className="mt-2 w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 active:scale-95 transition cursor-pointer"
          >
            <Camera className="h-4 w-4" />
            启用摄像头扫码
          </button>
        </div>

        {/* Batch submit bar */}
        {(() => {
          const pendingCount = records.filter((r) => !r.synced).length;
          if (pendingCount === 0 && records.length === 0) return null;
          return (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-xs">
                  <span className="text-zinc-400">缓存：</span>
                  <span className="font-bold text-indigo-600">{pendingCount} 条待提交</span>
                  {records.length > pendingCount && (
                    <span className="text-zinc-400 ml-2">/ {records.length - pendingCount} 条已提交</span>
                  )}
                </div>
                <button
                  onClick={handleBatchSubmit}
                  disabled={busy || pendingCount === 0}
                  className="flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-bold text-xs px-4 py-2.5 transition cursor-pointer active:scale-95"
                >
                  <Send className="h-3.5 w-3.5" />
                  {busy ? "提交中..." : `全部提交 (${pendingCount})`}
                </button>
              </div>
            </div>
          );
        })()}

        {/* Weight Input + Add to cache */}
        {trackingNo && (
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <h2 className="text-xs font-bold tracking-wider text-zinc-400 uppercase mb-3">录入重量</h2>
            <div className="text-xs font-mono text-zinc-500 mb-3">
              快递单号：<span className="font-bold text-zinc-800">{trackingNo}</span>
            </div>
            <div className="flex flex-col gap-2">
              <div className="relative">
                <Scale className="absolute left-3 top-3 h-5 w-5 text-zinc-400" />
                <input
                  ref={weightRef}
                  type="number"
                  step="0.01"
                  min="0.01"
                  inputMode="decimal"
                  placeholder="输入重量 (kg)"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
                  className="w-full rounded-lg border border-zinc-200 bg-white pl-10 pr-4 py-3 font-mono text-xl font-black text-zinc-800 text-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  autoFocus
                />
              </div>
              <button
                onClick={handleAdd}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm py-3 transition cursor-pointer active:scale-95"
              >
                添加到缓存
              </button>
            </div>
          </div>
        )}

        {/* Feedback */}
        {feedback && (
          <div className={`rounded-xl border p-4 text-xs flex items-start gap-2 ${
            feedback.type === "success" ? "bg-emerald-50 border-emerald-150 text-emerald-800" : "bg-rose-50 border-rose-150 text-rose-800"
          }`}>
            {feedback.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : <XCircle className="h-4 w-4 shrink-0 mt-0.5" />}
            {feedback.text}
          </div>
        )}

        {/* Records History */}
        {records.length > 0 && (
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-bold tracking-wider text-zinc-400 uppercase">
                缓存记录 ({records.length})
              </h2>
              <button
                onClick={handleClearAll}
                className="text-xs font-semibold text-rose-500 hover:text-rose-600 cursor-pointer"
              >
                清空全部
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1.5">
              {records.map((r) => (
                <div key={r.id} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
                  r.synced ? "bg-emerald-50/50 border-emerald-150" : "bg-amber-50/50 border-amber-150"
                }`}>
                  <div className="flex-1 min-w-0">
                    <span className="font-mono font-bold text-zinc-800">{r.kddh}</span>
                    <span className="text-zinc-500 ml-2 font-mono">{r.kdzl.toFixed(2)}kg</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-zinc-400 text-[10px] flex items-center gap-0.5">
                      <Clock className="h-3 w-3" />{r.time}
                    </span>
                    {r.synced ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">待提交</span>
                    )}
                    <button
                      onClick={() => handleDeleteRecord(r.id)}
                      className="text-zinc-300 hover:text-rose-500 p-0.5 cursor-pointer transition"
                      title="删除"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {cameraOpen && (
        <CameraScanner
          onScanSuccess={(code) => { setCameraOpen(false); handleScan(code); }}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  );
}
