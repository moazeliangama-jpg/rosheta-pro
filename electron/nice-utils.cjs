// أدوات قراءة بيانات نايس دير — منفصلة عشان تتاختبر على HTML حقيقي
function parseDateToISO(raw) {
  if (!raw) return "";
  const s = String(raw).trim();

  // 21/Oct/2026  أو  21-October-2026
  const monthNames = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    january: 1, february: 2, march: 3, april: 4, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  const named = s.match(/^(\d{1,2})[/\-.]([A-Za-z]+)[/\-.](\d{4})/);
  if (named) {
    const m = monthNames[named[2].toLowerCase()];
    if (m) return `${named[3]}-${String(m).padStart(2, "0")}-${String(named[1]).padStart(2, "0")}`;
  }

  // 10/21/2026 (أمريكي) أو 31/05/2026 (يوم/شهر)
  const num = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (num) {
    let a = Number(num[1]);
    let b = Number(num[2]);
    const year = num[3];
    let day;
    let month;
    if (a > 12) {
      day = a;
      month = b;
    } else if (b > 12) {
      month = a;
      day = b;
    } else {
      // لو الاتنين صالحين كشهر ويوم: نستخدم اليوم/الشهر لأنه الشائع هنا
      day = a;
      month = b;
    }
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return "";
}

const isMonthlyText = (t) => /month|شهر|monthly/i.test(String(t || ""));

module.exports = { parseDateToISO, isMonthlyText };
