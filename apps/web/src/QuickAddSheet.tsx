import { Car, ChevronRight, Pencil, Sparkles, UtensilsCrossed, X } from "lucide-react";
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
    <div className="overlay" role="dialog" aria-modal="true" aria-label="등록 종류 선택" onClick={onClose}>
      <div
        className="sheet quick-add-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="grabber" />
        <div className="sheet-header">
          <h2>어떤 항목을 적을까요?</h2>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={18} aria-hidden="true" />
            <span className="sr-only">닫기</span>
          </button>
        </div>
        <p className="quick-add-sub">자주 쓰는 항목은 한 번에 채워 드려요</p>
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
      </div>
    </div>
  );
}
