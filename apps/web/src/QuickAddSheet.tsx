import { Car, ChevronRight, Pencil, Sparkles, UtensilsCrossed, X } from "lucide-react";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "./Drawer";
import { QUICK_ADD_OPTIONS, type QuickAddOption, type QuickAddPreset } from "./quickAdd";

function presetIcon(preset: QuickAddPreset) {
  switch (preset) {
    case "late_meal":
      return <UtensilsCrossed size={20} aria-hidden="true" />;
    case "holiday_meal":
      return <Sparkles size={20} aria-hidden="true" />;
    case "taxi":
      return <Car size={20} aria-hidden="true" />;
    case "manual":
      return <Pencil size={20} aria-hidden="true" />;
  }
}

export function QuickAddSheet({
  onPick,
  onClose,
}: {
  onPick: (preset: QuickAddPreset) => void;
  onClose: () => void;
}) {
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent className="sheet quick-add-sheet">
        <div className="sheet-header">
          <DrawerTitle>어떤 항목을 적을까요?</DrawerTitle>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={18} aria-hidden="true" />
            <span className="sr-only">닫기</span>
          </button>
        </div>
        <DrawerDescription className="quick-add-sub">
          자주 쓰는 항목은 한 번에 채워 드려요
        </DrawerDescription>
        <DrawerBody>
          <ul className="quick-add-list">
            {QUICK_ADD_OPTIONS.map((option: QuickAddOption) => (
              <li key={option.preset}>
                <button
                  type="button"
                  className="quick-add-option"
                  onClick={() => onPick(option.preset)}
                >
                  <span className="quick-add-icon" aria-hidden="true">
                    {presetIcon(option.preset)}
                  </span>
                  <span className="quick-add-text">
                    <strong>{option.title}</strong>
                    <span className="quick-add-hint">{option.hint}</span>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
