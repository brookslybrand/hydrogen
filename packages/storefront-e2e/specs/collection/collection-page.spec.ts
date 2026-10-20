import type { Page } from "@playwright/test";

import { StorefrontContractError } from "../../src/contract";
import {
  requireProductCardLink,
  requireProductResults,
  type ExpectedProduct,
  type ProductResultsOptions,
} from "../../src/product-results";
import { expect, test } from "./config";

const PRODUCT_PATH_SEGMENT = "/products/";

test("collection page shows products", async ({ data, page }) => {
  const firstCollection = data.collections[0];
  if (firstCollection === undefined) throw new Error("No collection with products found");

  const firstProduct = firstCollection.products.nodes[0];
  if (firstProduct === undefined) throw new Error("No collection product found");

  const collectionPath = data.paths.collection(firstCollection.handle);
  await page.goto(collectionPath);

  await expectProductInResults(page, firstProduct, collectionPath);
});

test.describe("product results helpers", () => {
  const product: ExpectedProduct = { handle: "shirt", title: "Shirt" };
  const options: ProductResultsOptions = { timeout: 200 };

  test("finds the product card link inside the results and ignores decoys", async ({ page }) => {
    // Decoys come first: an unmarked link, a recommendation card outside the
    // results, and a card for another product whose title contains "Shirt".
    // The real link has a localized prefix.
    await openFixture(
      page,
      `<a href="/products/shirt">Shirt</a>
      <aside>${productCardHtml("/products/shirt", "Shirt recommendation")}</aside>
      <div data-testid="product-results"><ul>
        <li><article aria-label="Shirt">${productCardHtml("/products/t-shirt", "T-Shirt")}</article></li>
        <li><article aria-label="Shirt"><a href="/products/shirt">Shirt image</a>${productCardHtml("/fr/products/shirt", "SHIRT (sale)")}</article></li>
      </ul></div>`,
    );

    const link = await expectProductInResults(page, product, "/collections/all", options);

    await expect(link).toHaveText("SHIRT (sale)");
  });

  test("skips hidden cards, including a hidden match before the visible match", async ({
    page,
  }) => {
    // Hidden cards, such as responsive copies, are not read or checked, even
    // when they are invalid.
    await openFixture(
      page,
      `<div data-testid="product-results"><ul>
        <li><a data-testid="product-card" href="/products/shirt" style="visibility:hidden">Shirt hidden by CSS</a></li>
        <li><a data-testid="product-card" href="/products/shirt" hidden>Shirt hidden</a></li>
        <li style="display:none">${productCardHtml("/products/shirt", "Shirt collapsed")}</li>
        <li><div data-testid="product-card" hidden><a href="/products/shirt">Shirt wrapper</a></div></li>
        <li><a data-testid="product-card" href="/pages/shirt" style="visibility:hidden">Shirt page</a></li>
        <li>${productCardHtml("/products/shirt", "Shirt visible")}</li>
      </ul></div>`,
    );

    const link = await expectProductInResults(page, product, "/collections/all", options);

    await expect(link).toHaveText("Shirt visible");
  });

  test("fails clearly when the read card renders again with another product", async ({ page }) => {
    // After the suite reads the hrefs, the results render again in a new order.
    // The card at the read index then links to "T-Shirt", whose accessible
    // name still contains "Shirt".
    await openFixture(
      page,
      `<div data-testid="product-results"><ul>
        <li>${productCardHtml("/products/shirt", "Shirt")}</li>
        <li>${productCardHtml("/products/t-shirt", "T-Shirt")}</li>
      </ul></div>
      <script>
        const getAttribute = Element.prototype.getAttribute;
        let reordered = false;
        Element.prototype.getAttribute = function (name) {
          const value = getAttribute.call(this, name);
          if (!reordered && name === "href" && value === "/products/shirt") {
            reordered = true;
            setTimeout(() => {
              const list = document.querySelector("ul");
              list.prepend(list.lastElementChild);
            });
          }
          return value;
        };
      </script>`,
    );

    await expectContractError(
      expectProductInResults(page, product, "/collections/all", options),
      /visible element with data-testid="product-card" that links to \/products\/shirt keeps that link while the suite checks it\./,
    );
  });

  test("fails clearly for a missing or duplicate results root", async ({ page }) => {
    const cases: [string, RegExp][] = [
      [
        `<ul>${productCardHtml("/products/shirt")}</ul>`,
        /exactly one element with data-testid="product-results".*Found 0\./,
      ],
      [
        `<div data-testid="product-results">${productCardHtml("/products/shirt")}</div><div data-testid="product-results"></div>`,
        /exactly one element with data-testid="product-results".*Found 2\./,
      ],
    ];

    for (const [html, message] of cases) {
      await test.step(html, async () => {
        await openFixture(page, html);
        await expectContractError(
          expectProductInResults(page, product, "/collections/all", options),
          message,
        );
      });
    }
  });

  test("fails clearly when no visible product card is a valid link to the product", async ({
    page,
  }) => {
    const cases: [string, RegExp][] = [
      [
        `<article data-testid="product-card"><a href="/products/shirt">Shirt</a></article>`,
        /data-testid="product-card" is the native <a> product link of a result\. Found <article>\./,
      ],
      [
        `<a data-testid="product-card">Shirt</a>`,
        /data-testid="product-card" has an href to a product URL that contains \/products\/\. Found null\./,
      ],
      [
        `<a data-testid="product-card" href="">Shirt</a>`,
        /product URL that contains \/products\/\. Found ""\./,
      ],
      [
        `<a data-testid="product-card" href="/pages/shirt">Shirt</a>`,
        /product URL that contains \/products\/\. Found "\/pages\/shirt"\./,
      ],
      [
        `<a data-testid="product-card" href="mailto:shirt@example.com">Shirt</a>`,
        /product URL that contains \/products\/\./,
      ],
      [
        productCardHtml("/products/hat", "Hat"),
        /visible element with data-testid="product-card" that links to \/products\/shirt\. Found 1 visible product card links\./,
      ],
      // A title that contains the requested title does not match another handle.
      [
        productCardHtml("/products/t-shirt", "T-Shirt"),
        /that links to \/products\/shirt\. Found 1 visible product card links\./,
      ],
      [
        productCardHtml("/products/shirt-2", "Shirt"),
        /that links to \/products\/shirt\. Found 1 visible product card links\./,
      ],
      // A hidden matching card does not count.
      [
        `<a data-testid="product-card" href="/products/shirt" hidden>Shirt</a>`,
        /that links to \/products\/shirt\. Found 0 visible product card links\./,
      ],
      [
        `<a data-testid="product-card" href="/products/shirt" style="visibility:hidden">Shirt</a>`,
        /that links to \/products\/shirt\. Found 0 visible product card links\./,
      ],
    ];

    for (const [html, message] of cases) {
      await test.step(html, async () => {
        await openFixture(page, `<div data-testid="product-results">${html}</div>`);
        await expectContractError(
          expectProductInResults(page, product, "/collections/all", options),
          message,
        );
      });
    }
  });

  test("fails clearly when the product card link is aria-hidden, has another role, or lacks the title", async ({
    page,
  }) => {
    const links = [
      `<a data-testid="product-card" href="/products/shirt" aria-hidden="true">Shirt</a>`,
      `<a data-testid="product-card" href="/products/shirt" role="button">Shirt</a>`,
      `<a data-testid="product-card" href="/products/shirt" aria-label="View product">Shirt</a>`,
    ];

    for (const link of links) {
      await test.step(link, async () => {
        await openFixture(page, `<div data-testid="product-results">${link}</div>`);
        await expectContractError(
          expectProductInResults(page, product, "/collections/all", options),
          /links to \/products\/shirt is a visible link exposed to assistive technology, with an accessible name that contains "Shirt"\./,
        );
      });
    }
  });
});

async function expectProductInResults(
  page: Page,
  product: ExpectedProduct,
  collectionPath: string,
  options: ProductResultsOptions = {},
) {
  const results = await requireProductResults(page, collectionPath, options);
  return requireProductCardLink(results, PRODUCT_PATH_SEGMENT, product, collectionPath, options);
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
function productCardHtml(href: string, name = "Shirt"): string {
  return `<a data-testid="product-card" href="${href}">${name}</a>`;
}
