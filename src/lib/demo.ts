import type { FormRow, PatientRow } from "./types";
import { dateKey, pick, rand } from "./utils";

const NAMES = [
  "أحمد سيد عبد الحميد",
  "محمود إبراهيم الششتاوي",
  "هالة فؤاد عبد الرحمن",
  "سيد محمد الشافعي",
  "نهى سمير عبد الله",
  "كريم محسن السيد",
  "إيمان صلاح الدين",
  "عصام الدين محمد",
  "منى عبد العظيم",
  "طارق حسين عثمان",
  "شيرين مصطفى كامل",
  "وليد فتحي عبد الغني",
  "سعاد إبراهيم حسن",
  "رضا عبد الفتاح",
  "أميرة حمدي السقا",
  "حسام الدين فوزي",
  "نجلاء عبد السلام",
  "مصطفى عادل الشربيني",
  "ياسمين محمد الجندي",
  "علاء الدين طلعت",
  "بسمة أشرف زكي",
  "عمرو نبيل الديب",
  "فاطمة الزهراء علي",
  "إسلام رجب محمود",
  "هند أنور عبد الحميد",
  "شريف حسن عوض",
  "دعاء سامي راشد",
  "أيمن عبد الله قرني",
];

const WORKPLACES = ["مستشفى القوات المسلحة بالمعادي", "هيئة النقل العام", "شركة الأهرام للمقاولات", "مستشفى الشرطة بالعجوزة"];
const BUYERS = ["ساب شهري", "ساب صيدلية", "ساب مخزن", "ساب عيادة"];
const DRUGS = [
  "أموكسيسيلين 500 مجم — كبسولة كل 8 ساعات",
  "ميتفورمين 850 مجم — قرص مرتين يوميًا",
  "أتورفاستاتين 20 مجم — قرص مساءً",
  "أوميبرازول 20 مجم — كبسولة قبل الفطار",
  "باراسيتامول 500 مجم — قرص عند اللزوم",
  "سالبيوتامول بخاخ — بخة كل 6 ساعات",
  "فيتامين د 50000 وحدة — كبسولة أسبوعيًا",
  "كلاريثروميسين 500 مجم — قرص كل 12 ساعة",
];

export function demoPatients(count = 22): { patients: PatientRow[]; forms: FormRow[] } {
  const patients: PatientRow[] = [];
  const forms: FormRow[] = [];
  const today = new Date();

  for (let i = 0; i < count; i++) {
    const sab = String(100200 + i * 7 + rand(0, 4));
    const name = NAMES[i % NAMES.length];
    const phone = `01${pick(["0", "1", "2", "5"])}${String(rand(10000000, 99999999))}`;
    const workplace = pick(WORKPLACES);
    patients.push({ sab, name, phone, workplace, buyer: pick(BUYERS) });

    const formsCount = rand(1, 3);
    for (let f = 0; f < formsCount; f++) {
      const dayOffset = f === 0 ? rand(1, 4) : rand(6, 26);
      const d = new Date(today);
      d.setDate(d.getDate() - dayOffset);
      const isMonthly = f === 0 && Math.random() > 0.35;
      forms.push({
        formId: `${sab}-${f + 1}`,
        sab,
        formType: isMonthly ? "شهري" : pick(["أدوية", "أدوية مزمنة", "روشتة خارجية"]),
        formLabel: `استمارة ${f + 1}`,
        date: dateKey(d),
        isMonthly,
      });
    }
  }
  return { patients, forms };
}

/** صورة روشتة تجريبية (SVG → dataURL) عشان شاشة القرار تشتغل فعليًا بدون سيستم خارجي */
export function demoPrescriptionImage(input: {
  name: string;
  sab: string;
  formLabel: string;
  date: string;
  workplace: string;
}): string {
  const drugs = Array.from({ length: rand(2, 5) }, () => pick(DRUGS));
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const lines = drugs
    .map((d, i) => `<text x="640" y="${330 + i * 46}" font-size="24" fill="#1b2a2f" text-anchor="end">${i + 1}. ${esc(d)}</text>`)
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="980" viewBox="0 0 760 980" font-family="Tahoma, Arial, sans-serif">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fdfcf7"/><stop offset="100%" stop-color="#f2f6f4"/>
    </linearGradient>
  </defs>
  <rect width="760" height="980" fill="url(#bg)"/>
  <rect x="18" y="18" width="724" height="944" fill="none" stroke="#0e7c6b" stroke-width="3" rx="14"/>
  <rect x="18" y="18" width="724" height="92" fill="#0e7c6b" rx="14"/>
  <text x="700" y="62" font-size="27" fill="#ffffff" text-anchor="end" font-weight="bold">نظام نايس دير — استمارة صرف</text>
  <text x="700" y="94" font-size="17" fill="#cdeee7" text-anchor="end">Nice Deer • Form Preview</text>

  <text x="700" y="168" font-size="22" fill="#0b3b34" text-anchor="end" font-weight="bold">${esc(input.name)}</text>
  <text x="700" y="202" font-size="18" fill="#4a5c58" text-anchor="end">الساب: ${esc(input.sab)} — ${esc(input.formLabel)}</text>
  <text x="700" y="234" font-size="18" fill="#4a5c58" text-anchor="end">مكان العمل: ${esc(input.workplace)}</text>
  <text x="700" y="266" font-size="18" fill="#4a5c58" text-anchor="end">تاريخ الاستمارة: ${esc(input.date)}</text>
  <line x1="60" y1="292" x2="700" y2="292" stroke="#bcd8d1" stroke-width="2"/>

  <text x="700" y="318" font-size="20" fill="#0e7c6b" text-anchor="end" font-weight="bold">الأدوية الموصوفة</text>
  ${lines}

  <rect x="60" y="700" width="280" height="110" fill="#ffffff" stroke="#bcd8d1" rx="8"/>
  <text x="320" y="730" font-size="16" fill="#6b7f7a" text-anchor="end">توقيع الطبيب</text>
  <rect x="420" y="700" width="280" height="110" fill="#ffffff" stroke="#bcd8d1" rx="8"/>
  <text x="680" y="730" font-size="16" fill="#6b7f7a" text-anchor="end">ختم الصيدلية</text>

  <g opacity="0.9">
    <circle cx="120" cy="880" r="46" fill="none" stroke="#0e7c6b" stroke-width="3" stroke-dasharray="6 5"/>
    <text x="120" y="876" font-size="15" fill="#0e7c6b" text-anchor="middle" font-weight="bold">معتمد</text>
    <text x="120" y="896" font-size="11" fill="#0e7c6b" text-anchor="middle">ROS HETTA</text>
  </g>
  <text x="700" y="890" font-size="13" fill="#8fa5a0" text-anchor="end">صورة تجريبية — تُستبدل بفحص النافذة المخفية في نسخة سطح المكتب</text>
  <text x="700" y="916" font-size="13" fill="#8fa5a0" text-anchor="end">${new Date().toLocaleString("ar-EG")}</text>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
