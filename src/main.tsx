import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installErrorReporting } from "./lib/bugReport";
import "./index.css";

// التقاط الأخطاء غير المتوقعة (once) — أي خطأ بيتحوّل لبلاغ منقّح على GitHub
installErrorReporting();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
