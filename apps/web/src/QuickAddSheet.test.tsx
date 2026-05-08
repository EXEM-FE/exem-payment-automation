import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuickAddSheet } from "./QuickAddSheet";

function renderSheet() {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(<QuickAddSheet onPick={onPick} onClose={onClose} />);
  return { onPick, onClose };
}

describe("QuickAddSheet", () => {
  it("4개 등록 옵션을 사용자 친화적 라벨로 노출한다", () => {
    renderSheet();
    expect(screen.getByText("어떤 항목을 적을까요?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /야근 식대 등록/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /휴일 식대 등록/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /택시비 등록/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /직접 입력/ })).toBeInTheDocument();
  });

  it("계정과목 등 회계 용어를 화면에 노출하지 않는다", () => {
    renderSheet();
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).not.toMatch(
      /복리후생비|여비교통비|회식비|회의비|접대비|사무용품비/,
    );
  });

  it("야근 식대 클릭 → onPick('late_meal') 1회만 호출", async () => {
    const user = userEvent.setup();
    const { onPick, onClose } = renderSheet();
    await user.click(screen.getByRole("button", { name: /야근 식대 등록/ }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("late_meal");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("휴일 식대 클릭 → onPick('holiday_meal')", async () => {
    const user = userEvent.setup();
    const { onPick } = renderSheet();
    await user.click(screen.getByRole("button", { name: /휴일 식대 등록/ }));
    expect(onPick).toHaveBeenCalledWith("holiday_meal");
  });

  it("택시비 클릭 → onPick('taxi')", async () => {
    const user = userEvent.setup();
    const { onPick } = renderSheet();
    await user.click(screen.getByRole("button", { name: /택시비 등록/ }));
    expect(onPick).toHaveBeenCalledWith("taxi");
  });

  it("직접 입력 클릭 → onPick('manual')", async () => {
    const user = userEvent.setup();
    const { onPick } = renderSheet();
    await user.click(screen.getByRole("button", { name: /직접 입력/ }));
    expect(onPick).toHaveBeenCalledWith("manual");
  });

  it("닫기 버튼 클릭 → onClose 호출", async () => {
    const user = userEvent.setup();
    const { onClose, onPick } = renderSheet();
    await user.click(screen.getByRole("button", { name: /닫기/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("오버레이 바깥 클릭 → onClose 호출 (모달 dismiss)", async () => {
    const user = userEvent.setup();
    const { onClose } = renderSheet();
    await user.click(screen.getByTestId("drawer-overlay"));
    expect(onClose).toHaveBeenCalled();
  });

  it("시트 내부(제목) 클릭은 onClose를 트리거하지 않는다 (실수 dismiss 방지)", async () => {
    const user = userEvent.setup();
    const { onClose } = renderSheet();
    await user.click(screen.getByText("어떤 항목을 적을까요?"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
