import type { Locator, Page } from "@playwright/test";

import { createContractError, StorefrontContractError } from "../../src/contract";
import {
  requireVisibleProductCardPaths,
  type ProductResultsOptions,
} from "../../src/product-results";
import { expect, test } from "./config";

// Collection filter test IDs from docs/storefront-contract.md#collection-filters.
const COLLECTION_FILTER_LABEL_TEST_ID = "collection-filter-label";
const COLLECTION_FILTER_VALUE_TEST_ID = "collection-filter-value";
const MAX_FILTER_CONTROL_PROBES = 20;
// Short wait for the results root on each poll, so the poll keeps its rhythm.
const RESULTS_POLL_TIMEOUT_MS = 1_000;

type FilterCandidate = {
  /** The native checkbox inside `labelElement`. */
  readonly control: Locator;
  readonly expectedResultCount: number | null;
  readonly label: string;
  /** The visible native label. The suite clicks it to select the filter. */
  readonly labelElement: Locator;
};

type FilterOptions = {
  /** How long to wait for each step. Defaults to the expect timeout. */
  readonly timeout?: number;
};

test("collection filter narrows products", async ({ data, page }) => {
  const firstCollection = data.collections[0];
  if (firstCollection === undefined) throw new Error("No filterable collection found");

  const collectionPath = data.paths.collection(firstCollection.handle);
  await page.goto(collectionPath);

  const filter = await expectFilterNarrowsProducts(page, collectionPath, data.paths.product);
  test.skip(filter === null, "No visible collection filter narrows the initial product results");
});

/**
 * Selects a counted filter by its label, checks that the results narrow, then
 * goes back and checks that the same filter is unchecked. Returns null when
 * valid filter controls exist but none has a count that narrows the results.
 */
async function expectFilterNarrowsProducts(
  page: Page,
  collectionPath: string,
  productPathSegment: string,
  options: FilterOptions = {},
): Promise<FilterCandidate | null> {
  const { timeout } = options;
  const initialResultCount = await uniqueProductCardCount(
    page,
    collectionPath,
    productPathSegment,
    options,
  );
  const filter = await findUsableFilter(page, initialResultCount, collectionPath, options);
  if (filter === null) return null;

  const beforeUrl = page.url();
  await filter.labelElement.click({ timeout });
  await expect(filter.control).toBeChecked({ timeout });

  await applyFiltersIfNeeded(page);
  await expect(page).not.toHaveURL(beforeUrl, { timeout });
  // The results can be briefly missing or empty while they update. A broken
  // results contract still fails below with its own error.
  await expect
    .poll(
      async () => {
        const resultCount = await uniqueProductCardCount(page, collectionPath, productPathSegment, {
          timeout: RESULTS_POLL_TIMEOUT_MS,
        }).catch(() => 0);
        return resultCount > 0 && resultCount < initialResultCount;
      },
      { timeout },
    )
    .toBe(true)
    .catch(() => undefined);

  const resultCount = await uniqueProductCardCount(
    page,
    collectionPath,
    productPathSegment,
    options,
  );
  expect(resultCount).toBeLessThan(initialResultCount);
  if (filter.expectedResultCount !== null) {
    expect(resultCount).toBeLessThanOrEqual(filter.expectedResultCount);
  }

  await page.goBack();
  await expect(page).toHaveURL(beforeUrl, { timeout });
  // Confirm the positional locator still points at the same filter before checking its state.
  await expect
    .poll(async () => normalizeLabel(await filter.labelElement.textContent({ timeout })), {
      timeout,
    })
    .toBe(filter.label);
  await expect(filter.control).not.toBeChecked({ timeout });

  return filter;
}

test.describe("collection filter helpers", () => {
  const collectionPath = "/collections/all";
  // Generous for the async journey; no step waits for a fixed time.
  const options: FilterOptions = { timeout: 5_000 };

  test("clicks the visible counted label, checks its native checkbox, and recovers on Back", async ({
    page,
  }) => {
    await openFilterJourneyFixture(page);

    const filter = await expectFilterNarrowsProducts(page, collectionPath, "/products/", options);

    // The closed drawer copy comes first. Selecting it would fail the label click.
    expect(filter?.label).toBe("Red (2)");
  });

  test("selects visible counted labels and ignores decoys and hidden copies", async ({ page }) => {
    // Decoys come first: a closed drawer copy, unmarked checkboxes with counts,
    // a marked value without a count, and a disabled marked value.
    await openFixture(
      page,
      `<dialog>${filterLabelHtml("red", "Red (2)")}</dialog>
      <div style="display:none">${filterLabelHtml("red", "Red (2)")}</div>
      <label><input type="checkbox" name="newsletter"> Newsletter (1)</label>
      <input type="checkbox" aria-label="Red (2)">
      <label data-testid="collection-filter-label"><input data-testid="collection-filter-value" type="checkbox" name="filter.v.color" value="blue" aria-label="Blue"><span class="count">3 products</span></label>
      <label data-testid="collection-filter-label"><input data-testid="collection-filter-value" type="checkbox" name="filter.v.color" value="green" disabled> Green (1)</label>
      <label data-testid="collection-filter-label"><input data-testid="collection-filter-value" type="checkbox" name="filter.v.color" value="black"> Black (9)</label>
      ${filterLabelHtml("red", "Red (2) - Sold out")}`,
    );

    const filter = await findUsableFilter(page, 4, collectionPath, options);
    if (filter === null) throw new Error("Expected a usable filter");

    expect(filter.label).toBe("Red (2)");
    expect(filter.expectedResultCount).toBe(2);
    await filter.labelElement.click();
    await expect(filter.control).toBeChecked();
    await expect(
      page.locator("dialog").getByTestId(COLLECTION_FILTER_VALUE_TEST_ID),
    ).not.toBeChecked();
  });

  test("returns null only when valid filters exist but none has a usable count", async ({
    page,
  }) => {
    await openFixture(
      page,
      `${filterLabelHtml("red", "Red")}${filterLabelHtml("blue", "Blue (4)")}${filterLabelHtml("black", "Black (0)")}`,
    );

    await expect(findUsableFilter(page, 4, collectionPath, options)).resolves.toBeNull();
  });

  test("checks every probed label before it returns a usable filter", async ({ page }) => {
    // The first label is valid and usable. A later marked label is invalid.
    const cases: [string, RegExp][] = [
      [
        `<div data-testid="collection-filter-label"><input data-testid="collection-filter-value" type="checkbox"> Blue (1)</div>`,
        /is the native <label> of a filter value\. Found <div>\./,
      ],
      [
        `<label data-testid="collection-filter-label"><input data-testid="collection-filter-value" type="checkbox" aria-hidden="true"> Blue (1)</label>`,
        /exposed to assistive technology as a checkbox\./,
      ],
    ];

    for (const [html, message] of cases) {
      await test.step(html, async () => {
        await openFixture(page, `${filterLabelHtml("red", "Red (2)")}${html}`);
        await expectContractError(
          findUsableFilter(page, 4, collectionPath, { timeout: 200 }),
          message,
        );
      });
    }
  });

  test("fails clearly for missing, misplaced, or ambiguous filter test IDs", async ({ page }) => {
    const value = `<input data-testid="collection-filter-value" type="checkbox" name="filter.v.color" value="red">`;
    const cases: [string, RegExp][] = [
      // Filters with no marked labels at all fail; they are not a skip.
      [
        `<label><input type="checkbox" name="filter.v.color" value="red"> Red (2)</label>`,
        /at least one visible element with data-testid="collection-filter-label".*Found 0, none visible\./,
      ],
      [
        `<dialog>${filterLabelHtml("red", "Red (2)")}</dialog>`,
        /at least one visible element with data-testid="collection-filter-label".*Found 1, none visible\./,
      ],
      [
        `${filterLabelHtml("blue", "Blue (1)")}<label>${value} Red (2)</label>`,
        /one element with data-testid="collection-filter-label" for each element with data-testid="collection-filter-value"\. Found 1 labels and 2 checkboxes\./,
      ],
      [
        `<div data-testid="collection-filter-label">${value} Red (2)</div>`,
        /data-testid="collection-filter-label" is the native <label> of a filter value\. Found <div>\./,
      ],
      [
        `<label data-testid="collection-filter-label"><input type="checkbox"> Red (2)</label>${value}`,
        /contains exactly one element with data-testid="collection-filter-value"\. Found 0\./,
      ],
      [
        `<label data-testid="collection-filter-label">${value}${value} Red (2)</label><label data-testid="collection-filter-label">Blue</label>`,
        /contains exactly one element with data-testid="collection-filter-value"\. Found 2\./,
      ],
      [
        `<label data-testid="collection-filter-label"><span data-testid="collection-filter-value" role="checkbox" aria-checked="false"></span> Red (2)</label>`,
        /is a native <input type="checkbox">\. Found <span>\./,
      ],
      [
        `<label data-testid="collection-filter-label"><input data-testid="collection-filter-value" type="radio" name="color"> Red (2)</label>`,
        /is a native <input type="checkbox">\. Found <input type="radio">\./,
      ],
      [
        `<input id="other" type="checkbox"><label data-testid="collection-filter-label" for="other">${value} Red (2)</label>`,
        /is the native label of the checkbox with data-testid="collection-filter-value" inside it\./,
      ],
      [
        `<label data-testid="collection-filter-label"><input data-testid="collection-filter-value" type="checkbox" aria-hidden="true"> Red (2)</label>`,
        /exposed to assistive technology as a checkbox\./,
      ],
      [
        `<label data-testid="collection-filter-label"><input data-testid="collection-filter-value" type="checkbox" style="display:none"> Red (2)</label>`,
        /exposed to assistive technology as a checkbox\./,
      ],
    ];

    for (const [html, message] of cases) {
      await test.step(html, async () => {
        await openFixture(page, html);
        await expectContractError(
          findUsableFilter(page, 4, collectionPath, { timeout: 200 }),
          message,
        );
      });
    }
  });
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

/**
 * Remaining semantic branch: a storefront that does not apply filters on change
 * can show an Apply filters or Show results button. The reference storefronts
 * apply on change, so there is no test ID for it.
 */
async function applyFiltersIfNeeded(page: Page): Promise<void> {
  const applyFilters = page.getByRole("button", { name: /apply filters|show results/i }).first();
  if (await applyFilters.isVisible().catch(() => false)) await applyFilters.click();
}

/**
 * Checks the first visible filter labels (up to the probe limit), then returns
 * the first one whose label count is above zero and below the initial result
 * count. Hidden copies, such as a closed mobile drawer, are not read. A
 * misplaced or ambiguous test ID in an inspected label is a contract failure.
 */
async function findUsableFilter(
  page: Page,
  initialResultCount: number,
  routePath: string,
  options: FilterOptions = {},
): Promise<FilterCandidate | null> {
  const labels = await requireVisibleFilterLabels(page, routePath, options);
  const count = Math.min(await labels.count(), MAX_FILTER_CONTROL_PROBES);
  const pairs: { readonly control: Locator; readonly labelElement: Locator }[] = [];

  // Check every probed label before choosing one, so a later invalid label still fails.
  for (let index = 0; index < count; index += 1) {
    const labelElement = labels.nth(index);
    const control = await requireFilterCheckbox(page, labelElement, routePath);
    pairs.push({ control, labelElement });
  }

  for (const { control, labelElement } of pairs) {
    if (!(await control.isEnabled())) continue;

    // The count is read from the label text for now.
    const label = normalizeLabel(await labelElement.textContent());
    const expectedResultCount = parseFilterCount(label);

    if (expectedResultCount === null) continue;
    if (expectedResultCount > 0 && expectedResultCount < initialResultCount) {
      return { control, expectedResultCount, label, labelElement };
    }
  }

  return null;
}

/**
 * Returns the visible filter labels. Each filter value must have one label
 * and one checkbox test ID, including hidden copies.
 */
async function requireVisibleFilterLabels(
  page: Page,
  routePath: string,
  { timeout }: FilterOptions,
): Promise<Locator> {
  const labelAttribute = `data-testid="${COLLECTION_FILTER_LABEL_TEST_ID}"`;
  const valueAttribute = `data-testid="${COLLECTION_FILTER_VALUE_TEST_ID}"`;
  const labels = page.getByTestId(COLLECTION_FILTER_LABEL_TEST_ID).filter({ visible: true });

  try {
    await expect.poll(() => labels.count(), { timeout }).toBeGreaterThan(0);
  } catch {
    const total = await page.getByTestId(COLLECTION_FILTER_LABEL_TEST_ID).count();
    throw createContractError({
      capability: "collection-filter",
      routePath,
      expectation: `The collection page renders at least one visible element with ${labelAttribute} (the label of a filter value checkbox). Found ${total}, none visible.`,
      likelyFix: `Add ${labelAttribute} to the visible native <label> of each filter value checkbox, and ${valueAttribute} to the checkbox inside it.`,
      docsAnchor: "#collection-filters",
    });
  }

  const labelCount = await page.getByTestId(COLLECTION_FILTER_LABEL_TEST_ID).count();
  const valueCount = await page.getByTestId(COLLECTION_FILTER_VALUE_TEST_ID).count();
  if (labelCount !== valueCount) {
    throw createContractError({
      capability: "collection-filter",
      routePath,
      expectation: `The page renders one element with ${labelAttribute} for each element with ${valueAttribute}. Found ${labelCount} labels and ${valueCount} checkboxes.`,
      likelyFix: `Give each filter value checkbox ${valueAttribute} and its native <label> ${labelAttribute}, in every copy of the filters. Do not put them on other checkboxes or labels.`,
      docsAnchor: "#collection-filters",
    });
  }

  return labels;
}

/**
 * Returns the checkbox of a visible filter label. The label must be a native
 * <label> that contains exactly one checkbox test ID and is that checkbox's
 * label. The checkbox must be a native <input type="checkbox"> exposed to
 * assistive technology as a checkbox.
 */
async function requireFilterCheckbox(
  page: Page,
  label: Locator,
  routePath: string,
): Promise<Locator> {
  const labelAttribute = `data-testid="${COLLECTION_FILTER_LABEL_TEST_ID}"`;
  const valueAttribute = `data-testid="${COLLECTION_FILTER_VALUE_TEST_ID}"`;
  const fail = (expectation: string, likelyFix: string) =>
    createContractError({
      capability: "collection-filter",
      routePath,
      expectation,
      likelyFix,
      docsAnchor: "#collection-filters",
    });

  const labelElement = await label.evaluate((element) => element.localName);
  if (labelElement !== "label") {
    throw fail(
      `Each visible element with ${labelAttribute} is the native <label> of a filter value. Found <${labelElement}>.`,
      `Put ${labelAttribute} on the native <label> that wraps the filter value checkbox, not on a wrapper or list item.`,
    );
  }

  const control = label.getByTestId(COLLECTION_FILTER_VALUE_TEST_ID);
  const controlCount = await control.count();
  if (controlCount !== 1) {
    throw fail(
      `Each visible element with ${labelAttribute} contains exactly one element with ${valueAttribute}. Found ${controlCount}.`,
      `Put ${valueAttribute} on the one checkbox inside each filter value label.`,
    );
  }

  const controlFacts = await control.evaluate((element) => ({
    element: element.localName,
    type: element instanceof HTMLInputElement ? element.type : null,
  }));
  if (controlFacts.element !== "input" || controlFacts.type !== "checkbox") {
    const found =
      controlFacts.type === null
        ? `<${controlFacts.element}>`
        : `<${controlFacts.element} type="${controlFacts.type}">`;
    throw fail(
      `Each element with ${valueAttribute} is a native <input type="checkbox">. Found ${found}.`,
      `Put ${valueAttribute} on the native checkbox input itself, not on a custom control or an element with an ARIA role.`,
    );
  }

  const isAssociated = await label.evaluate(
    (element, valueTestId) =>
      element instanceof HTMLLabelElement &&
      element.control !== null &&
      element.contains(element.control) &&
      element.control.getAttribute("data-testid") === valueTestId,
    COLLECTION_FILTER_VALUE_TEST_ID,
  );
  if (!isAssociated) {
    throw fail(
      `Each element with ${labelAttribute} is the native label of the checkbox with ${valueAttribute} inside it.`,
      `Keep the checkbox inside its <label>, and do not point the label's for attribute at another element.`,
    );
  }

  if ((await control.and(page.getByRole("checkbox")).count()) !== 1) {
    throw fail(
      `Each checkbox with ${valueAttribute} in a visible label is exposed to assistive technology as a checkbox.`,
      "Keep the native checkbox in the accessibility tree. Do not hide it with aria-hidden, display: none, or visibility: hidden, and do not override its role.",
    );
  }

  return control;
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

/** A real filter value label for helper fixtures. Decoy checkboxes have no test ID. */
function filterLabelHtml(value: string, text: string, checked = false): string {
  return `<label data-testid="collection-filter-label"><input data-testid="collection-filter-value" type="checkbox" name="filter.v.color" value="${value}" autocomplete="off" onchange="this.form?.requestSubmit()" ${checked ? "checked" : ""}> ${text}</label>`;
}

/**
 * Serves a collection page whose GET filter form applies on change. Red narrows
 * the results from four products to two. A closed drawer has a copy of the filters.
 */
async function openFilterJourneyFixture(page: Page): Promise<void> {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/*", (route) => route.abort());
  await page.route(
    (url) => url.origin === STOREFRONT_ORIGIN && url.pathname === "/collections/all",
    (route) => {
      const isRed = new URL(route.request().url()).searchParams.get("filter.v.color") === "red";
      const products = isRed ? ["shirt", "hat"] : ["shirt", "hat", "sock", "scarf"];
      const filters = `${filterLabelHtml("blue", "Blue (4) - Sold out")}${filterLabelHtml("red", "Red (2)", isRed)}`;
      const body = `<!doctype html>
        <dialog><form method="get" action="/collections/all">${filters}</form></dialog>
        <form method="get" action="/collections/all">${filters}</form>
        <div data-testid="product-results">${products.map((handle) => productCardHtml(`/products/${handle}`)).join("")}</div>`;
      return route.fulfill({ body, contentType: "text/html", status: 200 });
    },
  );
  await page.goto(`${STOREFRONT_ORIGIN}/collections/all`);
}
