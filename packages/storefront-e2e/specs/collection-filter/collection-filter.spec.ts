import type { Locator, Page } from "@playwright/test";

import { StorefrontContractError } from "../../src/contract";
import {
  requireVisibleProductCardPaths,
  type ProductResultsOptions,
} from "../../src/product-results";
import { expect, test } from "./config";

const MAX_FILTER_CONTROL_PROBES = 20;
// Short wait for the results root on each poll, so the poll keeps its rhythm.
const RESULTS_POLL_TIMEOUT_MS = 1_000;

type FilterCandidate = {
  readonly control: Locator;
  readonly expectedResultCount: number | null;
  readonly label: string;
};

test("collection filter narrows products", async ({ data, page }) => {
  const firstCollection = data.collections[0];
  if (firstCollection === undefined) throw new Error("No filterable collection found");

  const collectionPath = data.paths.collection(firstCollection.handle);
  await page.goto(collectionPath);

  const initialResultCount = await uniqueProductCardCount(page, collectionPath, data.paths.product);
  const filter = await findUsableFilter(page, initialResultCount);
  test.skip(filter === null, "No visible collection filter narrows the initial product results");

  if (filter === null) throw new Error("No usable collection filter found");

  const beforeUrl = page.url();
  await selectFilter(filter);
  await expect(filter.control).toBeChecked();

  await applyFiltersIfNeeded(page);
  await expect(page).not.toHaveURL(beforeUrl);
  // The results can be briefly missing or empty while they update. A broken
  // results contract still fails below with its own error.
  await expect
    .poll(async () => {
      const resultCount = await uniqueProductCardCount(page, collectionPath, data.paths.product, {
        timeout: RESULTS_POLL_TIMEOUT_MS,
      }).catch(() => 0);
      return resultCount > 0 && resultCount < initialResultCount;
    })
    .toBe(true)
    .catch(() => undefined);

  const resultCount = await uniqueProductCardCount(page, collectionPath, data.paths.product);
  expect(resultCount).toBeLessThan(initialResultCount);
  if (filter.expectedResultCount !== null) {
    expect(resultCount).toBeLessThanOrEqual(filter.expectedResultCount);
  }

  await page.goBack();
  await expect(page).toHaveURL(beforeUrl);
  // Confirm the positional locator still points at the same filter before checking its state.
  await expect
    .poll(async () => normalizeLabel(await controlText(filter.control)))
    .toBe(filter.label);
  await expect(filter.control).not.toBeChecked();
});

test.describe("product result count helpers", () => {
  const collectionPath = "/collections/all";
  const options: ProductResultsOptions = { timeout: 200 };

  test("counts unique visible product card URLs inside the results only", async ({ page }) => {
    // Unmarked product links, recommendation cards outside the results, hidden
    // cards (including invalid hidden copies), and repeated URLs do not add to
    // the count.
    await openFixture(
      page,
      `<nav><a href="/products/nav">Nav</a></nav>
      <aside>${productCardHtml("/products/recommended")}</aside>
      <div data-testid="product-results"><ul>
        <li>${productCardHtml("/products/shirt")}<a href="/products/shirt-image">Image</a></li>
        <li>${productCardHtml("/products/shirt?variant=1")}</li>
        <li>${productCardHtml("/products/hat")}</li>
        <li>${productCardHtml("https://storefront.test/products/hat")}</li>
        <li>${productCardHtml("/products/hidden", "hidden")}</li>
        <li>${productCardHtml("/products/invisible", 'style="visibility:hidden"')}</li>
        <li style="display:none">${productCardHtml("/products/collapsed")}</li>
        <li style="visibility:hidden">${productCardHtml("/products/responsive-copy")}</li>
        <li><div data-testid="product-card" hidden><a href="/products/wrapper">Wrapper</a></div></li>
        <li>${productCardHtml("/pages/hidden", 'style="visibility:hidden"')}</li>
      </ul></div>`,
    );

    await expect(uniqueProductCardCount(page, collectionPath, "/products/", options)).resolves.toBe(
      2,
    );
  });

  test("fails clearly for a missing or duplicate results root or no visible cards", async ({
    page,
  }) => {
    const cases: [string, RegExp][] = [
      [
        `<ul>${productCardHtml("/products/shirt")}</ul>`,
        /exactly one element with data-testid="product-results".*Found 0\./,
      ],
      [
        `<div data-testid="product-results">${productCardHtml("/products/shirt")}</div><section data-testid="product-results"></section>`,
        /exactly one element with data-testid="product-results".*Found 2\./,
      ],
      [
        `<div data-testid="product-results"><a href="/products/shirt">Shirt</a></div>`,
        /contains at least one visible element with data-testid="product-card"\. Found 0\./,
      ],
      [
        `<div data-testid="product-results">${productCardHtml("/products/shirt", "hidden")}</div>`,
        /contains at least one visible element with data-testid="product-card"\. Found 0\./,
      ],
      [
        `<div data-testid="product-results">${productCardHtml("/products/shirt", 'style="visibility:hidden"')}</div>`,
        /contains at least one visible element with data-testid="product-card"\. Found 0\./,
      ],
    ];

    for (const [html, message] of cases) {
      await test.step(html, async () => {
        await openFixture(page, html);
        await expectContractError(
          uniqueProductCardCount(page, collectionPath, "/products/", options),
          message,
        );
      });
    }
  });

  test("fails clearly for a wrapper card or a card that links to another page", async ({
    page,
  }) => {
    const cases: [string, RegExp][] = [
      [
        `<div data-testid="product-card"><a href="/products/shirt">Shirt</a></div>`,
        /native <a> product link of a result\. Found <div>\./,
      ],
      [productCardHtml("/collections/shirts"), /product URL that contains \/products\/\./],
      [`<a data-testid="product-card">Shirt</a>`, /product URL that contains \/products\/\./],
    ];

    for (const [html, message] of cases) {
      await test.step(html, async () => {
        // A valid visible card comes first, so the invalid card must not be skipped.
        await openFixture(
          page,
          `<div data-testid="product-results">${productCardHtml("/products/hat")}${html}</div>`,
        );
        await expectContractError(
          uniqueProductCardCount(page, collectionPath, "/products/", options),
          message,
        );
      });
    }
  });
});

/**
 * Counts the unique product URL paths of the visible product card links in the
 * single results root. Zero visible cards is a contract failure.
 */
async function uniqueProductCardCount(
  page: Page,
  collectionPath: string,
  productPathSegment: string,
  options: ProductResultsOptions = {},
): Promise<number> {
  const paths = await requireVisibleProductCardPaths(
    page,
    collectionPath,
    productPathSegment,
    options,
  );
  return paths.size;
}

async function applyFiltersIfNeeded(page: Page): Promise<void> {
  const applyFilters = page.getByRole("button", { name: /apply filters|show results/i }).first();
  if (await applyFilters.isVisible().catch(() => false)) await applyFilters.click();
}

async function selectFilter(filter: FilterCandidate): Promise<void> {
  const wrappingLabel = filter.control.locator("xpath=ancestor::label[1]");
  if (await wrappingLabel.isVisible().catch(() => false)) {
    await wrappingLabel.click();
    return;
  }

  await filter.control.check();
}

async function findUsableFilter(
  page: Page,
  initialResultCount: number,
): Promise<FilterCandidate | null> {
  const controls = page.getByRole("checkbox");
  const count = Math.min(await controls.count(), MAX_FILTER_CONTROL_PROBES);

  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    const usable = (await control.isVisible()) && (await control.isEnabled());
    if (!usable) continue;

    const label = normalizeLabel(await controlText(control));
    const candidate = { control, expectedResultCount: parseFilterCount(label), label };

    if (candidate.expectedResultCount === null) continue;
    if (candidate.expectedResultCount > 0 && candidate.expectedResultCount < initialResultCount) {
      return candidate;
    }
  }

  return null;
}

async function controlText(control: Locator): Promise<string> {
  const ariaLabel = await control.getAttribute("aria-label");
  if (ariaLabel !== null && ariaLabel.trim() !== "") return ariaLabel;

  return control.evaluate((element) => {
    if (element instanceof HTMLInputElement)
      return element.labels?.[0]?.textContent ?? element.value;

    return element.textContent ?? "";
  });
}

function normalizeLabel(value: string | null): string {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/ - Sold out$/i, "")
    .trim();
}

function parseFilterCount(label: string): number | null {
  const match = label.match(/\((\d+)\)/);
  if (match === null) return null;

  const count = Number.parseInt(match[1], 10);
  return Number.isFinite(count) ? count : null;
}

async function expectContractError(promise: Promise<unknown>, message: RegExp): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(StorefrontContractError);
  expect(String(error)).toMatch(message);
}

/** Fake storefront origin for helper fixtures. No request leaves the browser. */
const STOREFRONT_ORIGIN = "https://storefront.test";

/** Serves `body` as a collection page so relative product links have an HTTP base. */
async function openFixture(page: Page, body: string): Promise<void> {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/*", (route) => route.abort());
  await page.route(`${STOREFRONT_ORIGIN}/collections/all`, (route) =>
    route.fulfill({ body: `<!doctype html>${body}`, contentType: "text/html", status: 200 }),
  );
  await page.goto(`${STOREFRONT_ORIGIN}/collections/all`);
}

/** A real product card link for helper fixtures. Decoy links have no test ID. */
function productCardHtml(href: string, attributes = ""): string {
  return `<a data-testid="product-card" href="${href}" ${attributes}>Product</a>`;
}
