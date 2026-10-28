import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Copy, RefreshCw, Send } from "lucide-react";
import { Button, Card } from "./ui";
import { reportError } from "../lib/bugReport";
import { copyText, toast } from "../lib/toast";
import { hasDesktopBridge } from "../lib/provider";

interface State {
  error: Error | null;
  reported: boolean;
  busy: boolean;
}

/**
 * حاجز أخطاء الواجهة: بدل شاشة بيضاء، المستخدم بياخد شاشة مفهومة
 * وفيها زرار «أبلغ عن المشكلة» (البلاغ بيتبعت تلقائيًا كمان أول ما الخطأ يحصل).
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, reported: false, busy: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // بلاغ تلقائي واحد لكل خطأ — التفاصيل بتتنقّح في العملية الرئيسية
    void reportError({
      error,
      source: "react:error-boundary",
      notes: info?.componentStack ? `componentStack: ${info.componentStack.slice(0, 1200)}` : undefined,
    }).then((res) => {
      if (res?.data?.status === "sent" || res?.data?.status === "existing") {
        this.setState({ reported: true });
      }
    });
  }

  private reset = () => {
    this.setState({ error: null, reported: false, busy: false });
  };

  private resend = async () => {
    const err = this.state.error;
    if (!err) return;
    this.setState({ busy: true });
    const res = await reportError({
      error: err,
      source: "react:error-boundary:manual",
      notes: "بلاغ يدوي من المستخدم بعد ظهور شاشة الخطأ",
    });
    this.setState({ busy: false });
    const status = res?.data?.status;
    if (status === "sent") toast.ok("البلاغ اتبعت على GitHub — شكرًا.");
    else if (status === "existing") toast.info("الخطأ ده متبلّغ عنه بالفعل — اتفتح البلاغ الموجود.");
    else if (status === "queued") toast.warn("البلاغ اتحفظ على الجهاز وهيتحاول يتبعت بعدين.");
    else if (status === "duplicate") toast.info("الخطأ ده اتبعت في آخر ٢٤ ساعة — مش هنكرره.");
    else if (status === "disabled") toast.info("الإبلاغ التلقائي مقفول من الإعدادات.");
    else toast.warn("البلاغ اتحفظ محليًا — الإرسال بيحتاج توكن GitHub على الجهاز.");
  };

  render() {
    const { error, reported, busy } = this.state;
    if (!error) return this.props.children;

    const details = `${error.name}: ${error.message}\n\n${error.stack || ""}`;

    return (
      <div className="min-h-screen bg-[#05090a] p-4 text-white" dir="rtl">
        <div className="mx-auto max-w-2xl py-10">
          <Card className="border-rose-500/30 bg-rose-950/20">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
              <div className="min-w-0 flex-1">
                <h1 className="text-base font-bold text-rose-200">حصل خطأ غير متوقع في الواجهة</h1>
                <p className="mt-1 text-xs leading-relaxed text-rose-100/70">
                  شغلك محفوظ — القرارات والصور والسجلات كلها على الجهاز. جرّب «إعادة تحميل الواجهة»، ولو المشكلة
                  رجعت ابعت البلاغ وهنصلّحها.
                </p>
                <pre
                  className="mt-3 max-h-40 overflow-auto rounded-lg bg-black/50 p-3 text-[11px] leading-relaxed text-rose-100/80"
                  dir="ltr"
                >
{details.slice(0, 2000)}
                </pre>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={this.reset}>
                    <RefreshCw className="h-3.5 w-3.5" /> إعادة تحميل الواجهة
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void this.resend()} disabled={busy}>
                    <Send className="h-3.5 w-3.5" /> {busy ? "بيتبعت…" : "أبلغ عن المشكلة"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void copyText(details, "تفاصيل الخطأ")}>
                    <Copy className="h-3.5 w-3.5" /> انسخ التفاصيل
                  </Button>
                  {reported ? <span className="text-[11px] text-emerald-300">البلاغ اتبعت تلقائيًا ✓</span> : null}
                </div>
                {!hasDesktopBridge() ? (
                  <p className="mt-2 text-[11px] text-white/40">
                    الإرسال التلقائي على GitHub بيشتغل من نسخة سطح المكتب (الـ EXE).
                  </p>
                ) : null}
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  }
}
