import { useEffect, useState } from "react";
import { AlertTriangle, Download, ImageOff, Loader2, Maximize2, Minus, Plus, RotateCcw, RotateCw, X } from "lucide-react";
import type { CaseRecord } from "../lib/types";
import { Badge, Button } from "./ui";
import { cn } from "../lib/utils";
import { downloadImage } from "../lib/excel";
import { getCachedImage, getImage } from "../lib/imageCache";
import { useAppStore } from "../lib/store";

export const SOURCE_LABEL: Record<string, string> = {
  "pre-approval": "Pre-Approval",
  claim: "Claim",
};

/**
 * بيجيب صورة الاستمارة من الكاش أو من IndexedDB.
 * الصورة مش متخزنة في حالة React — عشان البرنامج يفضل سريع مع مئات الروشتات.
 */
export function useRxSrc(c: CaseRecord) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    const inline = c.rx.dataUrl || getCachedImage(c.id);
    if (inline) {
      setSrc(inline);
      setLoading(false);
      return;
    }
    if (c.rx.status !== "ready") {
      setSrc(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void getImage(c.id).then((value) => {
      if (!alive) return;
      setSrc(value);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [c.id, c.rx.status, c.rx.dataUrl]);

  return { src, loading };
}

export function RxImage({ c, className, onRetry }: { c: CaseRecord; className?: string; onRetry?: () => void }) {
  const { src, loading } = useRxSrc(c);
  const [drawn, setDrawn] = useState(false);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setDrawn(false);
    setBroken(false);
  }, [src]);

  if (c.rx.status === "loading" || c.rx.status === "pending") {
    return (
      <Frame className={className}>
        <div className="flex flex-col items-center gap-2 text-white/60">
          <Loader2 className="h-7 w-7 animate-spin text-teal-400" />
          <span className="text-sm">جارٍ فتح نافذة الروشتة والتقاط الصورة…</span>
          {c.rx.attempts > 0 ? <span className="text-xs text-amber-300">محاولة {c.rx.attempts} من 3</span> : null}
          {c.rx.reason ? <span className="max-w-xs text-center text-xs text-white/40">{c.rx.reason}</span> : null}
        </div>
      </Frame>
    );
  }

  if (loading) {
    return (
      <Frame className={className}>
        <div className="flex flex-col items-center gap-2 text-white/50">
          <Loader2 className="h-6 w-6 animate-spin text-teal-400" />
          <span className="text-xs">بيحمّل الصورة من التخزين…</span>
        </div>
      </Frame>
    );
  }

  if (c.rx.status === "failed") {
    return (
      <Frame className={className} tone="bad">
        <div className="flex flex-col items-center gap-2 px-4 text-center">
          <ImageOff className="h-7 w-7 text-rose-400" />
          <span className="text-sm font-semibold text-rose-200">صورة الروشتة لم تُلتقط</span>
          <span className="max-w-xs text-xs leading-relaxed text-white/50">{c.rx.reason || "لم تُرجع نافذة نايس دير صورة"}</span>
          {onRetry ? (
            <Button size="sm" variant="ghost" onClick={onRetry} className="mt-1">
              <RotateCcw className="h-3.5 w-3.5" /> إعادة الجلب
            </Button>
          ) : null}
        </div>
      </Frame>
    );
  }

  if (!src) {
    return (
      <Frame className={className} tone="bad">
        <div className="flex flex-col items-center gap-2 px-4 text-center">
          <AlertTriangle className="h-7 w-7 text-amber-400" />
          <span className="text-sm font-semibold text-amber-200">الصورة مش في التخزين المحلي</span>
          <span className="max-w-xs text-xs text-white/50">ممكن تكون اتمسحت. اضغط إعادة الجلب لالتقاطها من نايس دير.</span>
          {onRetry ? (
            <Button size="sm" variant="ghost" onClick={onRetry}>
              <RotateCcw className="h-3.5 w-3.5" /> إعادة الجلب
            </Button>
          ) : null}
        </div>
      </Frame>
    );
  }

  if (broken) {
    return (
      <Frame className={className} tone="bad">
        <div className="flex flex-col items-center gap-2 px-4 text-center">
          <AlertTriangle className="h-7 w-7 text-amber-400" />
          <span className="text-sm font-semibold text-amber-200">الصورة وصلت لكن تعذر رسمها</span>
          {onRetry ? (
            <Button size="sm" variant="ghost" onClick={onRetry}>
              <RotateCcw className="h-3.5 w-3.5" /> إعادة الجلب
            </Button>
          ) : null}
        </div>
      </Frame>
    );
  }

  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-white/10 bg-black/40", className)}>
      {!drawn ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-teal-400" />
        </div>
      ) : null}
      <img
        src={src}
        alt={`روشتة ${c.sab} — ${c.reference}`}
        onLoad={() => setDrawn(true)}
        onError={() => setBroken(true)}
        style={{ transform: `rotate(${c.rotation ?? 0}deg)` }}
        className={cn("h-full w-full object-contain transition-opacity duration-200", drawn ? "opacity-100" : "opacity-0")}
        draggable={false}
      />
    </div>
  );
}

function Frame({ children, className, tone }: { children: React.ReactNode; className?: string; tone?: "bad" }) {
  return (
    <div
      className={cn(
        "flex aspect-[3/4] items-center justify-center rounded-xl border border-dashed",
        tone === "bad" ? "border-rose-500/30 bg-rose-500/5" : "border-white/15 bg-black/30",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function RxLightbox({ c, onClose, onRetry }: { c: CaseRecord; onClose: () => void; onRetry?: () => void }) {
  const { src, loading } = useRxSrc(c);
  const [zoom, setZoom] = useState(1);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const setRotation = useAppStore((s) => s.setRotation);
  // ١٠٨) الصورة بتترسم على canvas وقت الالتقاط وChromium بيطبّق EXIF Orientation
  // تلقائيًا؛ لو الصورة طلعت مايلة (مسح ضوئي قديم) الزرارين دول بيلفّوها وبتتحفظ.
  const rotation = ((c.rotation ?? 0) % 360 + 360) % 360;
  const rotate = (delta: number) => setRotation(c.id, rotation + delta);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(4, z + 0.25));
      if (e.key === "-") setZoom((z) => Math.max(0.5, z - 0.25));
      if (e.key.toLowerCase() === "r") rotate(e.shiftKey ? -90 : 90);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, rotation]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#04090b]/95 backdrop-blur" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-white">{c.patientName}</div>
          <div className="truncate text-xs text-white/50">
            ساب {c.sab} • مرجع {c.reference} • {SOURCE_LABEL[c.source] ?? c.source} • {c.formDate}
            {c.monthly ? " • شهري" : ""}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {c.rx.method ? <Badge tone="info">{c.rx.method}</Badge> : null}
          {natural ? <Badge tone="neutral">{natural.w}×{natural.h}</Badge> : null}
          <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="تصغير">
            <Minus className="h-4 w-4" />
          </Button>
          <span className="w-14 text-center text-xs tabular-nums text-white/70">{Math.round(zoom * 100)}%</span>
          <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} aria-label="تكبير">
            <Plus className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setZoom(1)} aria-label="الحجم الطبيعي">
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => rotate(90)} aria-label="تدوير يمين">
            <RotateCw className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => rotate(-90)} aria-label="تدوير شمال">
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" disabled={!src} onClick={() => src && downloadImage(src, `${c.sab}-${c.reference}`)}>
            <Download className="h-4 w-4" /> تنزيل
          </Button>
          <Button size="sm" variant="danger" onClick={onClose} aria-label="إغلاق">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="mx-auto flex min-h-full items-start justify-center">
          {loading ? (
            <div className="flex flex-col items-center gap-2 py-20 text-white/50">
              <Loader2 className="h-7 w-7 animate-spin text-teal-400" />
              <span className="text-xs">بيحمّل الصورة…</span>
            </div>
          ) : src ? (
            <img
              src={src}
              alt={`${c.sab}`}
              onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              style={{
                width: `${Math.round(zoom * 100)}%`,
                maxWidth: zoom <= 1 ? "820px" : "none",
                // ١٠٨) التدوير محفوظ مع الاستمارة (بيتطبّق على الصورة الأصلية)
                transform: `rotate(${rotation}deg)`,
                transition: "transform 120ms ease-out",
              }}
              className="rounded-lg bg-white shadow-2xl"
              draggable={false}
            />
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/5 px-8 py-14 text-center">
              <ImageOff className="h-9 w-9 text-rose-400" />
              <div className="text-sm font-bold text-rose-200">لا توجد صورة محمّلة لهذه الاستمارة</div>
              <p className="max-w-sm text-xs leading-relaxed text-white/50">{c.rx.reason || "أعد الجلب من شاشة القرار."}</p>
              {onRetry ? (
                <Button size="sm" onClick={onRetry}>
                  <RotateCcw className="h-4 w-4" /> إعادة الجلب
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-white/10 px-4 py-2 text-center text-[11px] text-white/35">
        Esc للإغلاق • + / - للتكبير • R للتدوير (Shift+R عكس الاتجاه)
      </div>
    </div>
  );
}
