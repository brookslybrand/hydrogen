import type { Locator, Page } from "@playwright/test";

import { createContractError, StorefrontContractError } from "../../src/contract";
import {
  findProductCardLink,
  PRODUCT_CARD_TEST_ID,
  PRODUCT_RESULTS_TEST_ID,
  requireProductResults,
  type ExpectedProduct,
  type ProductResultsOptions,
} from "../../src/product-results";
import { expect, test } from "./config";

const MAX_SEARCH_PRODUCT_PROBES = 8;
// Search test IDs from docs/storefront-contract.md#search.
const SEARCH_INPUT_TEST_ID = "search-input";
const SEARCH_SUBMIT_TEST_ID = "search-submit";
/** Fake storefront origin for helper fixtures. No request leaves the browser. */
const STOREFRONT_ORIGIN = "https://storefront.test";

type SearchPaths = {
  readonly product: string;
  readonly search: string;
};

test("search returns matching products", async ({ data, page }) => {
  const match = await findSearchMatch(page, data.paths, data.products);
  if (match === null) {
    throw new Error("No discovered product title returned matching search results");
  }
});

/**
 * Searches for up to eight discovered products by title, and returns the first
 * one whose own product card shows in the results. A search with no or other
 * results tries the next product. A missing results root or an invalid card is
 * a contract failure, not a miss.
 */
async function findSearchMatch(
  page: Page,
  paths: SearchPaths,
  products: readonly ExpectedProduct[],
  options: ProductResultsOptions = {},
): Promise<ExpectedProduct | null> {
  for (const product of products.slice(0, MAX_SEARCH_PRODUCT_PROBES)) {
    if (await searchForMatchingProduct(page, paths, product, options)) return product;
  }

  return null;
}

async function searchForMatchingProduct(
  page: Page,
  paths: SearchPaths,
  product: ExpectedProduct,
  options: ProductResultsOptions,
): Promise<boolean> {
  await page.goto(paths.search);
  const searchInput = await requireSearchInput(page, paths.search, options);
  await requireNoProductCardsBeforeQuery(page, paths.search);
  await searchInput.fill(product.title);
  await submitSearch(page, searchInput, paths.search, options);

  // After a query, the results root renders for both matching and empty results.
  const results = await requireProductResults(page, paths.search, options);
  const card = await findProductCardLink(results, paths.product, product, paths.search, options);
  return card !== null;
}

/**
 * Before a query, the search page must not show visible product cards inside
 * `product-results`, so an already-visible card cannot serve as search evidence. An
 * empty results root is fine. Featured or popular products are not search
 * results and must stay outside `product-results`.
 */
async function requireNoProductCardsBeforeQuery(page: Page, searchPath: string): Promise<void> {
  const cards = page
    .getByTestId(PRODUCT_RESULTS_TEST_ID)
    .getByTestId(PRODUCT_CARD_TEST_ID)
    .filter({ visible: true });
  const count = await cards.count();
  if (count === 0) return;

  throw searchContractError(
    searchPath,
    `Before a query, the search page shows no visible element with data-testid="${PRODUCT_CARD_TEST_ID}" inside data-testid="${PRODUCT_RESULTS_TEST_ID}". Found ${count}.`,
    `Render visible search result cards only after a query; data-testid="${PRODUCT_RESULTS_TEST_ID}" may already exist empty. Keep featured, popular, and recent product cards outside that container.`,
  );
}

/**
 * Returns the single search page query input: a visible, editable native
 * <input> exposed to assistive technology as a searchbox.
 */
async function requireSearchInput(
  page: Page,
  searchPath: string,
  { timeout }: ProductResultsOptions,
): Promise<Locator> {
  const input = page.getByTestId(SEARCH_INPUT_TEST_ID);
  const attribute = `data-testid="${SEARCH_INPUT_TEST_ID}"`;

  try {
    await expect(input).toHaveCount(1, { timeout });
  } catch {
    const count = await input.count();
    throw searchContractError(
      searchPath,
      `The search page renders exactly one element with ${attribute} (the search query input). Found ${count}.`,
      count === 0
        ? `Add ${attribute} to the query input of the search page form.`
        : `Keep ${attribute} only on the search page query input. Do not put it on the header or predictive search input.`,
    );
  }

  const element = await input.evaluate((node) => node.localName);
  if (element !== "input") {
    throw searchContractError(
      searchPath,
      `The element with ${attribute} is the native <input> search query input. Found <${element}>.`,
      `Put ${attribute} on the native <input> itself, not on a wrapper.`,
    );
  }

  const searchbox = input.and(page.getByRole("searchbox"));
  const isUsable = await expect(searchbox)
    .toBeVisible({ timeout })
    .then(() => expect(searchbox).toBeEditable({ timeout }))
    .then(
      () => true,
      () => false,
    );
  if (!isUsable) {
    throw searchContractError(
      searchPath,
      `The <input> with ${attribute} is visible, editable, and exposed to assistive technology as a searchbox.`,
      'Use a visible, enabled <input type="search">. Do not hide it with hidden or aria-hidden, make it read-only, or override its role.',
    );
  }

  return input;
}

/**
 * Submits the search. Without a search submit button, the suite presses Enter
 * in the input. With one, it must be the single visible native <button> of the
 * input's form, with an accessible name in any language.
 */
async function submitSearch(
  page: Page,
  searchInput: Locator,
  searchPath: string,
  { timeout }: ProductResultsOptions,
): Promise<void> {
  const button = page.getByTestId(SEARCH_SUBMIT_TEST_ID);
  const attribute = `data-testid="${SEARCH_SUBMIT_TEST_ID}"`;
  const count = await button.count();
  if (count === 0) {
    await searchInput.press("Enter");
    return;
  }

  if (count !== 1) {
    throw searchContractError(
      searchPath,
      `The search page renders at most one element with ${attribute} (the search submit button). Found ${count}.`,
      `Keep ${attribute} only on the submit button of the search page form.`,
    );
  }

  const element = await button.evaluate((node) => node.localName);
  if (element !== "button") {
    throw searchContractError(
      searchPath,
      `The element with ${attribute} is the native <button> search submit button. Found <${element}>.`,
      `Put ${attribute} on the native <button> itself, not on a wrapper.`,
    );
  }

  const buttonHandle = await button.elementHandle();
  const isSameForm = await searchInput.evaluate(
    (input, submit) =>
      input instanceof HTMLInputElement &&
      submit instanceof HTMLButtonElement &&
      input.form !== null &&
      input.form === submit.form,
    buttonHandle,
  );
  await buttonHandle?.dispose();
  if (!isSameForm) {
    throw searchContractError(
      searchPath,
      `The <button> with ${attribute} belongs to the same form as the input with data-testid="${SEARCH_INPUT_TEST_ID}".`,
      `Put ${attribute} on the submit button of the search query input's form.`,
    );
  }

  const accessibleButton = button.and(page.getByRole("button"));
  const isAccessible = await expect(accessibleButton)
    .toBeVisible({ timeout })
    .then(() => expect(accessibleButton).toHaveAccessibleName(/\S/, { timeout }))
    .then(
      () => true,
      () => false,
    );
  if (!isAccessible) {
    throw searchContractError(
      searchPath,
      `The <button> with ${attribute} is visible and exposed to assistive technology as a button with a non-empty accessible name.`,
      "Keep the search button visible with its native button role, and give it an accessible name in any language.",
    );
  }

  await button.click();
}

function searchContractError(searchPath: string, expectation: string, likelyFix: string): Error {
  return createContractError({
    capability: "search-route",
    routePath: searchPath,
    expectation,
    likelyFix,
    docsAnchor: "#search",
  });
}

test.describe("search result helpers", () => {
  const paths: SearchPaths = { product: "/products/", search: `${STOREFRONT_ORIGIN}/search` };
  const options: ProductResultsOptions = { timeout: 200 };
  const shirt: ExpectedProduct = { handle: "shirt", title: "Shirt" };

  test("matches the product handle inside the results, not a similar title or a recommendation", async ({
    page,
  }) => {
    const { queries: searches } = await openSearchFixture(page, (query) =>
      query === "Shirt"
        ? `<aside><h2>Recommended</h2>${productCardHtml("/products/shirt", "Shirt")}</aside>
          <div data-testid="product-results">
            <a href="/products/shirt">Shirt</a>
            ${productCardHtml("/products/t-shirt", "T-Shirt")}
            ${productCardHtml("/products/shirt-2", "Shirt")}
          </div>`
        : `<div data-testid="product-results">${productCardHtml("/products/shirt", "Shirt")}</div>`,
    );

    await expect(findSearchMatch(page, paths, [shirt], options)).resolves.toBeNull();
    expect(searches).toEqual(["Shirt"]);

    // The real card matches by handle, and its name contains the title in any case.
    const upperCaseShirt: ExpectedProduct = { handle: "shirt", title: "SHIRT" };
    await expect(findSearchMatch(page, paths, [upperCaseShirt], options)).resolves.toBe(
      upperCaseShirt,
    );
  });

  test("tries the next product after empty or other results, up to eight products", async ({
    page,
  }) => {
    const products = Array.from({ length: 9 }, (_, index) => ({
      handle: `product-${index}`,
      title: `Product ${index}`,
    }));
    const hits = new Set(["Product 2"]);
    const { queries: searches } = await openSearchFixture(page, (query) =>
      hits.has(query)
        ? `<div data-testid="product-results">${productCardHtml(`/products/product-2`, "Product 2")}</div>`
        : query === "Product 0"
          ? `<div data-testid="product-results"><p>No results</p></div>`
          : `<div data-testid="product-results">${productCardHtml("/products/other", "Other")}</div>`,
    );

    await expect(findSearchMatch(page, paths, products, options)).resolves.toBe(products[2]);
    expect(searches).toEqual(["Product 0", "Product 1", "Product 2"]);

    // Only the ninth product matches, so the bounded search finds nothing.
    hits.clear();
    hits.add("Product 8");
    searches.length = 0;
    await expect(findSearchMatch(page, paths, products, options)).resolves.toBeNull();
    expect(searches).toHaveLength(8);
  });

  test("fails clearly instead of trying the next product for a broken results contract", async ({
    page,
  }) => {
    const cases: [string, RegExp][] = [
      [`<p>No results</p>`, /exactly one element with data-testid="product-results".*Found 0\./],
      [
        `<div data-testid="product-results"></div><div data-testid="product-results"></div>`,
        /exactly one element with data-testid="product-results".*Found 2\./,
      ],
      [
        `<div data-testid="product-results"><article data-testid="product-card"><a href="/products/shirt">Shirt</a></article></div>`,
        /native <a> product link of a result\. Found <article>\./,
      ],
      [
        `<div data-testid="product-results"><a data-testid="product-card" href="/products/shirt" aria-label="View">Shirt</a></div>`,
        /links to \/products\/shirt is a visible link exposed to assistive technology, with an accessible name that contains "Shirt"\./,
      ],
    ];

    for (const [results, message] of cases) {
      await test.step(results, async () => {
        const { queries: searches } = await openSearchFixture(page, () => results);
        await expectContractError(findSearchMatch(page, paths, [shirt, shirt], options), message);
        expect(searches).toHaveLength(1);
      });
    }
  });
});

test.describe("search input and submit helpers", () => {
  const paths: SearchPaths = { product: "/products/", search: `${STOREFRONT_ORIGIN}/search` };
  const options: ProductResultsOptions = { timeout: 200 };
  const shirt: ExpectedProduct = { handle: "shirt", title: "Shirt" };
  const shirtResults = () =>
    `<div data-testid="product-results">${productCardHtml("/products/shirt", "Shirt")}</div>`;

  test("clicks the marked localized button, not the default unmarked button", async ({ page }) => {
    // Enter would use the first submit button, which sends via=enter.
    const fixture = await openSearchFixture(
      page,
      shirtResults,
      `<form action="/search" method="get">
        <input data-testid="search-input" type="search" name="q" aria-label="Suche">
        <button type="submit" name="via" value="enter">Search</button>
        <button data-testid="search-submit" type="submit" name="via" value="button">Suchen</button>
      </form>`,
    );

    await expect(findSearchMatch(page, paths, [shirt], options)).resolves.toBe(shirt);
    expect(fixture.queries).toEqual(["Shirt"]);
    expect(fixture.submitters).toEqual(["button"]);
  });

  test("presses Enter in the marked input when there is no marked button", async ({ page }) => {
    // An unmarked English button outside the form would search for "decoy".
    const fixture = await openSearchFixture(
      page,
      shirtResults,
      `<button type="button" onclick="location.href = '/search?q=decoy'">Search</button>
      <form action="/search" method="get">
        <input data-testid="search-input" type="search" name="q" aria-label="Suche">
      </form>`,
    );

    await expect(findSearchMatch(page, paths, [shirt], options)).resolves.toBe(shirt);
    expect(fixture.queries).toEqual(["Shirt"]);
    expect(fixture.submitters).toEqual([null]);
  });

  test("fails before the query when the page already shows marked product cards", async ({
    page,
  }) => {
    // The page already shows the expected card, and Enter does nothing.
    const fixture = await openSearchFixture(
      page,
      shirtResults,
      `<form action="/search" method="get" onsubmit="event.preventDefault()">
        <input data-testid="search-input" type="search" name="q" aria-label="Suche">
      </form>`,
      shirtResults(),
    );

    await expectContractError(
      findSearchMatch(page, paths, [shirt], options),
      /Before a query, the search page shows no visible element with data-testid="product-card" inside data-testid="product-results"\. Found 1\./,
    );
    expect(fixture.queries).toEqual([]);
  });

  test("allows an empty results root before the query", async ({ page }) => {
    // Hidden cards and cards outside the root do not count before the query.
    const fixture = await openSearchFixture(
      page,
      shirtResults,
      SEARCH_FORM,
      `<aside>${productCardHtml("/products/shirt", "Shirt")}</aside>
      <div data-testid="product-results"><a data-testid="product-card" href="/products/shirt" hidden>Shirt</a></div>`,
    );

    await expect(findSearchMatch(page, paths, [shirt], options)).resolves.toBe(shirt);
    expect(fixture.queries).toEqual(["Shirt"]);
  });

  test("fails clearly for a missing, duplicate, misplaced, or unusable search input", async ({
    page,
  }) => {
    const input = `<input data-testid="search-input" type="search" name="q" aria-label="Suche">`;
    const cases: [string, RegExp][] = [
      [
        `<form action="/search"><input type="search" name="q" aria-label="Search"></form>`,
        /exactly one element with data-testid="search-input" \(the search query input\)\. Found 0\./,
      ],
      [`<form action="/search">${input}${input}</form>`, /data-testid="search-input".*Found 2\./],
      [
        `<form action="/search"><div data-testid="search-input"><input type="search" name="q"></div></form>`,
        /native <input> search query input\. Found <div>\./,
      ],
    ];
    const unusable = [
      `<input data-testid="search-input" type="search" name="q" aria-label="Suche" hidden>`,
      `<input data-testid="search-input" type="search" name="q" aria-label="Suche" aria-hidden="true">`,
      `<input data-testid="search-input" type="search" name="q" aria-label="Suche" readonly>`,
      `<input data-testid="search-input" type="search" name="q" aria-label="Suche" disabled>`,
      `<input data-testid="search-input" type="text" name="q" aria-label="Suche">`,
      `<input data-testid="search-input" type="search" name="q" aria-label="Suche" role="combobox">`,
    ];
    for (const html of unusable) {
      cases.push([
        `<form action="/search">${html}</form>`,
        /data-testid="search-input" is visible, editable, and exposed to assistive technology as a searchbox\./,
      ]);
    }

    for (const [form, message] of cases) {
      await test.step(form, async () => {
        const fixture = await openSearchFixture(page, shirtResults, form);
        await expectContractError(findSearchMatch(page, paths, [shirt], options), message);
        expect(fixture.queries).toEqual([]);
      });
    }
  });

  test("fails clearly for a duplicate, misplaced, hidden, or unnamed search button", async ({
    page,
  }) => {
    const input = `<input data-testid="search-input" type="search" name="q" aria-label="Suche">`;
    const button = `<button data-testid="search-submit" type="submit">Suchen</button>`;
    const sized = `style="display:inline-block;width:80px;height:24px"`;
    const cases: [string, RegExp][] = [
      [
        `<form action="/search">${input}${button}${button}</form>`,
        /at most one element with data-testid="search-submit".*Found 2\./,
      ],
      [
        `<form action="/search">${input}<span data-testid="search-submit"><button type="submit">Suchen</button></span></form>`,
        /native <button> search submit button\. Found <span>\./,
      ],
      [
        `<form action="/search">${input}</form><form action="/search">${button}</form>`,
        /data-testid="search-submit" belongs to the same form as the input with data-testid="search-input"\./,
      ],
      [`${input}${button}`, /belongs to the same form as the input/],
      [
        `<form action="/search">${input}<button data-testid="search-submit" type="submit" hidden>Suchen</button></form>`,
        /visible and exposed to assistive technology as a button with a non-empty accessible name\./,
      ],
      [
        `<form action="/search">${input}<button data-testid="search-submit" type="submit" aria-hidden="true">Suchen</button></form>`,
        /visible and exposed to assistive technology as a button with a non-empty accessible name\./,
      ],
      [
        `<form action="/search">${input}<button data-testid="search-submit" type="submit" ${sized}></button></form>`,
        /visible and exposed to assistive technology as a button with a non-empty accessible name\./,
      ],
    ];

    for (const [form, message] of cases) {
      await test.step(form, async () => {
        const fixture = await openSearchFixture(page, shirtResults, form);
        await expectContractError(findSearchMatch(page, paths, [shirt], options), message);
        expect(fixture.queries).toEqual([]);
      });
    }
  });
});

async function expectContractError(promise: Promise<unknown>, message: RegExp): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(StorefrontContractError);
  expect(String(error)).toMatch(message);
}

/** An unmarked header search form. Clicking or using it fails the fixture journey. */
const HEADER_SEARCH_DECOY = `<header><form action="/decoy" method="get" role="search">
  <input type="search" name="q" aria-label="Search"><button type="submit">Search</button>
</form></header>`;

/** The search page form: a marked query input and a marked localized submit button. */
const SEARCH_FORM = `<form action="/search" method="get" role="search">
  <input data-testid="search-input" type="search" name="q" aria-label="Suche">
  <button data-testid="search-submit" type="submit" name="via" value="button">Suchen</button>
</form>`;

type SearchFixture = {
  /** The `q` value of each search request, in order. */
  readonly queries: string[];
  /** The `via` value of each search request: the name of the submitter, if any. */
  readonly submitters: (string | null)[];
};

/**
 * Serves a search page with `searchForm` after a header search decoy. Before a
 * query, the page renders `beforeQuery`. After a query, `results` renders the
 * results for it.
 */
async function openSearchFixture(
  page: Page,
  results: (query: string) => string,
  searchForm = SEARCH_FORM,
  beforeQuery = "",
): Promise<SearchFixture> {
  const fixture: SearchFixture = { queries: [], submitters: [] };
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/*", (route) => route.abort());
  await page.route(
    (url) => url.origin === STOREFRONT_ORIGIN && url.pathname === "/search",
    (route) => {
      const params = new URL(route.request().url()).searchParams;
      const query = params.get("q");
      if (query !== null) {
        fixture.queries.push(query);
        fixture.submitters.push(params.get("via"));
      }
      const body = `<!doctype html>${HEADER_SEARCH_DECOY}${searchForm}
        ${query === null ? beforeQuery : results(query)}`;
      return route.fulfill({ body, contentType: "text/html", status: 200 });
    },
  );
  await page.goto(`${STOREFRONT_ORIGIN}/search`);
  return fixture;
}

/** A real product card link for helper fixtures. Decoy links have no test ID. */
function productCardHtml(href: string, name: string): string {
  return `<a data-testid="product-card" href="${href}">${name}</a>`;
}
