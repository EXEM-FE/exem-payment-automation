import type { Category, ExpensePreset } from "@exem/shared";
import { TEAM_MEMBERS } from "./data";

export type QuickAddPreset = ExpensePreset;

export type QuickAddOption = {
  preset: QuickAddPreset;
  title: string;
  hint: string;
};

export const QUICK_ADD_OPTIONS: QuickAddOption[] = [
  { preset: "late_meal", title: "야근 식대 등록", hint: "사무실 야근 후 식사" },
  { preset: "holiday_meal", title: "휴일 식대 등록", hint: "주말·공휴일 출근 식사" },
  { preset: "taxi", title: "택시비 등록", hint: "야근 후 귀가 택시비" },
  { preset: "manual", title: "직접 입력", hint: "위에 해당하지 않는 경비" },
];

export type QuickAddPrefill = {
  category?: Category;
  description?: string;
  participants: string[];
  hideFoodIntent: boolean;
  preset: QuickAddPreset;
};

export function quickAddPrefill(
  preset: QuickAddPreset,
  profileName: string,
): QuickAddPrefill {
  const me = TEAM_MEMBERS.includes(profileName) ? [profileName] : [];

  switch (preset) {
    case "late_meal":
      return {
        preset,
        category: "복리후생비",
        description: "야근 식대",
        participants: me,
        hideFoodIntent: false,
      };
    case "holiday_meal":
      return {
        preset,
        category: "복리후생비",
        description: "휴일 식대",
        participants: me,
        hideFoodIntent: false,
      };
    case "taxi":
      return {
        preset,
        category: "여비교통비",
        description: "야근 택시비",
        participants: me,
        hideFoodIntent: true,
      };
    case "manual":
      return {
        preset,
        participants: me,
        hideFoodIntent: false,
      };
  }
}
