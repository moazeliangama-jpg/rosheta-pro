import type { Payer } from "./types";

/** البايرات الفعلية في قائمة #payerId على نايس دير (القيم من الـ option value) */
export const PAYERS: Payer[] = [
  { id: "1", name: "الاهلى للخدمات الطبية" },
  { id: "2", name: "EGYCare" },
  { id: "5", name: "Prime Health Egypt" },
  { id: "8", name: "Misr Healthcare" },
  { id: "16", name: "INAYA EGYPT" },
  { id: "17", name: "MedSure" },
  { id: "22", name: "Limitless Care" },
  { id: "23", name: "Estsharion" },
  { id: "24", name: "Banque Misr" },
  { id: "29", name: "El Araby" },
  { id: "30", name: "San Misr" },
  { id: "31", name: "WE - المصرية للاتصالات" },
  { id: "33", name: "Oriental Weavers - النساجون الشرقيون" },
];

export function payerName(id: string) {
  return PAYERS.find((p) => p.id === id)?.name ?? "";
}
