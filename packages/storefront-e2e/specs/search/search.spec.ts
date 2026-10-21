import type { Locator, Page } from "@playwright/test";

import { StorefrontContractError } from "../../src/contract";
import {
  findProductCardLink,
  requireProductResults,
  type ExpectedProduct,
  type ProductResultsOptions,
} from "../../src/product-results";
import { expect, test } from "./config";

const MAX_SEARCH_PRODUCT_PROBES = 8;
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
  const searchbox = page.getByRole("searchbox").first();
  await searchbox.fill(product.title);
  await submitSearch(searchbox);

  // After a query, the results root renders for both matching and empty results.
  const results = await requireProductResults(page, paths.search, options);
  const card = await findProductCardLink(results, paths.product, product, paths.search, options);
  return card !== null;
}

async function submitSearch(searchbox: Locator): Promise<void> {
  const form = searchbox.locator("xpath=ancestor::form[1]");
  const searchButton = form.getByRole("button", { name: /search/i }).first();
  if (await searchButton.isVisible().catch(() => false)) {
    await searchButton.click();
    return;
  }

  await searchbox.press("Enter");
}

test.describe("search result helpers", () => {
  const paths: SearchPaths = { product: "/products/", search: `${STOREFRONT_ORIGIN}/search` };
  const options: ProductResultsOptions = { timeout: 200 };
  const shirt: ExpectedProduct = { handle: "shirt", title: "Shirt" };

  test("matches the product handle inside the results, not a similar title or a recommendation", async ({
    page,
  }) => {
    const searches = await openSearchFixture(page, (query) =>
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
    const searches = await openSearchFixture(page, (query) =>
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
        const searches = await openSearchFixture(page, () => results);
        await expectContractError(findSearchMatch(page, paths, [shirt, shirt], options), message);
        expect(searches).toHaveLength(1);
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

/**
 * Serves a search page with a GET search form. After a query, `results`
 * renders the results for it. Returns the queries in request order.
 */
async function openSearchFixture(
  page: Page,
  results: (query: string) => string,
): Promise<string[]> {
  const searches: string[] = [];
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/*", (route) => route.abort());
  await page.route(
    (url) => url.origin === STOREFRONT_ORIGIN && url.pathname === "/search",
    (route) => {
      const query = new URL(route.request().url()).searchParams.get("q");
      if (query !== null) searches.push(query);
      const body = `<!doctype html>
        <form action="/search" method="get" role="search">
          <input type="search" name="q" aria-label="Search">
          <button type="submit">Search</button>
        </form>
        ${query === null ? "" : results(query)}`;
      return route.fulfill({ body, contentType: "text/html", status: 200 });
    },
  );
  await page.goto(`${STOREFRONT_ORIGIN}/search`);
  return searches;
}

/** A real product card link for helper fixtures. Decoy links have no test ID. */
function productCardHtml(href: string, name: string): string {
  return `<a data-testid="product-card" href="${href}">${name}</a>`;
}
