; ============================================================================
; روشتة برو — إعدادات المثبّت (NSIS)
;
; المبدأ: المثبّت بيفترض إن الجهاز فاضي ومش مجهّز بأي حاجة، فهو اللي بيجهّز
; كل حاجة بنفسه: مجلد التثبيت، الاختصارات، ومجلد بيانات البرنامج.
; مفيش أي متطلب سابق (مفيش Node.js ولا .NET ولا Chromium — كله جوه الملف).
;
; ملاحظة: الملف ده بيتضمّن جوه قالب electron-builder، فبنستخدم الماكروهات
; الرسمية بس (customInit / customInstall / customUnInstall) بدون أي تعديل
; على تدفّق التثبيت نفسه.
; ============================================================================

!macro customInit
  ; نبدأ على نظافة: أي مسار قديم للبرنامج بيتشال قبل التثبيت
  SetShellVarContext all
!macroend

!macro customInstall
  ; ١) مجلد بيانات البرنامج (القرارات + الصور + اللوج) — بيتعمل هنا مرة واحدة
  ;    والبرنامج بيكمّله بنفسه بعد كده.
  CreateDirectory "$APPDATA\Roshetta Pro"
  CreateDirectory "$APPDATA\Roshetta Pro\logs"
  CreateDirectory "$APPDATA\Roshetta Pro\diagnostics"

  ; ٢) ملف تعريف بالتثبيت — بيساعد الدعم يعرف النسخة والمكان
  FileOpen $0 "$APPDATA\Roshetta Pro\install-info.txt" w
  FileWrite $0 "Roshetta Pro$\r$\n"
  FileWrite $0 "installedAt=$INSTDIR$\r$\n"
  FileWrite $0 "version=${VERSION}$\r$\n"
  FileWrite $0 "note=بيانات المستخدم محفوظة هنا ولا تُحذف مع إلغاء التثبيت.$\r$\n"
  FileClose $0

  ; ٣) السماح للبرنامج بالاتصال بالشبكة من جدار الحماية (بدون أي حاجة يدوية)
  ExecWait 'netsh advfirewall firewall add rule name="Roshetta Pro" dir=out action=allow program="$INSTDIR\Roshetta Pro.exe" enable=yes profile=any' $1
!macroend

!macro customUnInstall
  ; بيانات المستخدم (القرارات + الصور + اللوج) بتفضل موجودة بعد إلغاء التثبيت
  ; عشان لو أعاد التثبيت ما يخسرش شغل يوم كامل. الحذف يدوي لو المستخدم عايز.
!macroend
