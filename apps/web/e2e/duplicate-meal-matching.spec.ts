import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import * as XLSX from "xlsx";

const profile = { dept: "FE1팀", name: "최기환" };

function makeStatementFile(filePath: string) {
  const rows = [
    {
      이용일자: "2026.05.12",
      카드번호: "****-3910-0209-3811",
      이용자명: "최*환",
      사원번호: "A10241104",
      부서명: "FE1팀",
      국내이용금액: 12000,
      국내청구금액: 12000,
      해외현지금액: 0,
      통화코드: "-",
      가맹점: "낮밤키친",
      가맹점사업자번호: "000-00-00001",
      승인번호: "A0001",
      할부개월수: 0,
      청구회차: 0,
    },
    {
      이용일자: "2026.05.12",
      카드번호: "****-3910-0209-3811",
      이용자명: "최*환",
      사원번호: "A10241104",
      부서명: "FE1팀",
      국내이용금액: 15000,
      국내청구금액: 15000,
      해외현지금액: 0,
      통화코드: "-",
      가맹점: "라밥",
      가맹점사업자번호: "000-00-00002",
      승인번호: "A0002",
      할부개월수: 0,
      청구회차: 0,
    },
  ];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "청구내역상세");
  XLSX.writeFile(workbook, filePath);
}

async function seedProfile(context: BrowserContext, clearJournal: boolean) {
  await context.addInitScript(
    ({ clearJournal: shouldClearJournal, profileValue }) => {
      window.localStorage.setItem("exem-profile", JSON.stringify(profileValue));
      window.localStorage.removeItem("exem-push-receipt");
      window.localStorage.removeItem("exem-merchant-preset-history");
      if (shouldClearJournal) window.localStorage.setItem("exem-journal", "[]");
      else window.localStorage.removeItem("exem-journal");
    },
    { clearJournal, profileValue: profile },
  );
}

async function addLateMeal(page: Page) {
  await page.getByRole("button", { name: "새 항목 추가" }).click();
  await page.getByRole("button", { name: /야근 식대 등록/ }).click();
  await page.getByRole("button", { name: "저장", exact: true }).click();
}

test("same-date duplicate late meals can be explicitly assigned to statement rows", async ({
  baseURL,
  browser,
}, testInfo) => {
  const statementPath = testInfo.outputPath("duplicate-late-meal-statement.xlsx");
  makeStatementFile(statementPath);

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await seedProfile(mobile, true);

  const desktop = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await seedProfile(desktop, false);

  try {
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(baseURL ?? "/");
    await expect(mobilePage.getByRole("heading", { name: "0건" })).toBeVisible();

    await addLateMeal(mobilePage);
    await addLateMeal(mobilePage);
    await expect(mobilePage.getByRole("heading", { name: "2건" })).toBeVisible();

    await mobilePage.getByRole("button", { name: "PC로 보내기" }).click();
    await expect(mobilePage.getByText("PC에 이 숫자를 입력하세요")).toBeVisible();
    const pin = (await mobilePage.locator(".pin span").allTextContents()).join("");
    expect(pin).toMatch(/^\d{4}$/);

    const page = await desktop.newPage();
    await page.goto(baseURL ?? "/");
    await expect(page.getByRole("heading", { name: "휴대폰에서 받아올게요" })).toBeVisible();
    await page.getByRole("textbox").last().fill(pin);
    await expect(page.getByRole("heading", { name: "카드 명세서를 올려주세요" })).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles(statementPath);
    await expect(page.getByRole("heading", { name: "결제 내역을 확인해주세요" })).toBeVisible();

    const summary = page.locator(".step-sub");
    await expect(summary).toContainText("총 2건");
    await expect(summary).toContainText("확인 필요 2건");

    const assignmentSelects = page.locator("select.assignment-select");
    await expect(assignmentSelects).toHaveCount(2);

    const firstSelect = assignmentSelects.first();
    const options = firstSelect.locator("option");
    await expect(options).toHaveCount(2);

    const optionLabels = await options.allTextContents();
    expect(new Set(optionLabels).size).toBe(2);
    expect(optionLabels[0]).toContain("모바일 후보 1");
    expect(optionLabels[1]).toContain("모바일 후보 2");

    const optionValues = await options.evaluateAll((elements) =>
      elements.map((element) => (element as HTMLOptionElement).value),
    );
    await firstSelect.selectOption(optionValues[1]);

    await expect(summary).toContainText("자동 1건");
    await expect(summary).toContainText("확인 필요 1건");

    await page.screenshot({
      path: testInfo.outputPath("duplicate-late-meal-match.png"),
      fullPage: false,
    });
  } finally {
    await mobile.close();
    await desktop.close();
  }
});
