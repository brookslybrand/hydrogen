import { expect, type Locator, type Page } from "@playwright/test";

import { createContractError } from "./contract";

// Product results test IDs from docs/storefront-contract.md#product-results.
export const PRODUCT_RESULTS_TEST_ID = "product-results";
export const PRODUCT_CARD_TEST_ID = "product-card";

const RESULTS_ATTRIBUTE = `data-testid="${PRODUCT_RESULTS_TEST_ID}"`;
const CARD_ATTRIBUTE = `data-testid="${PRODUCT_CARD_TEST_ID}"`;
const DOCS_ANCHOR = "#product-results";

export type ProductResultsOptions = {
  /** How long to wait for the results root and cards. Defaults to the expect timeout. */
  readonly timeout?: number;
};

type ProductCardSnapshot = {
  readonly element: string;
  readonly href: string | null;
};

type ProductCardLink = {
  /** The index in `visibleProductCards(results)`. */
  readonly index: number;
  readonly url: URL;
};

/**
 * Returns the single product results root on the page. Recommendations and
 * predictive search results must not have the ID, so they do not count.
 */
export async function requireProductResults(
  page: Page,
  routePath: string,
  { timeout }: ProductResultsOptions = {},
): Promise<Locator> {
  const results = page.getByTestId(PRODUCT_RESULTS_TEST_ID);

  try {
    await expect(results).toHaveCount(1, { timeout });
  } catch {
    const count = await results.count();
    throw createContractError({
      capability: "product-results",
      routePath,
      expectation: `The page renders exactly one element with ${RESULTS_ATTRIBUTE} (the product results container). Found ${count}.`,
      likelyFix:
        count === 0
          ? `Add ${RESULTS_ATTRIBUTE} to the existing element that holds the collection or search product results.`
          : `Keep ${RESULTS_ATTRIBUTE} only on the main product results container. Remove it from recommendations, predictive search, and other elements.`,
      docsAnchor: DOCS_ANCHOR,
    });
  }

  return results;
}

/**
 * Returns the unique product URL paths of the visible product card links in
 * the single results root. Each visible product card must be a native <a>
 * with a product URL. Hidden cards, such as responsive copies, do not count.
 * No visible product card is a contract failure.
 */
export async function requireVisibleProductCardPaths(
  page: Page,
  routePath: string,
  productPathSegment: string,
  options: ProductResultsOptions = {},
): Promise<Set<string>> {
  const results = await requireProductResults(page, routePath, options);
  const cards = await readProductCardLinks(results, routePath, productPathSegment);
  const paths = new Set(cards.map((card) => card.url.pathname));
  if (paths.size > 0) return paths;

  throw createContractError({
    capability: "product-results",
    routePath,
    expectation: `The element with ${RESULTS_ATTRIBUTE} contains at least one visible element with ${CARD_ATTRIBUTE}. Found 0.`,
    likelyFix: `Add ${CARD_ATTRIBUTE} to the primary <a href> product link of each visible result.`,
    docsAnchor: DOCS_ANCHOR,
  });
}

export type ExpectedProduct = {
  readonly handle: string;
  readonly title: string;
};

/**
 * Returns the visible product card link to the product detail page of
 * `product` inside `results`. The link must be exposed to assistive
 * technology as a link whose accessible name contains the product title
 * (case does not matter).
 */
export async function requireProductCardLink(
  results: Locator,
  productPathSegment: string,
  product: ExpectedProduct,
  routePath: string,
  { timeout }: ProductResultsOptions = {},
): Promise<Locator> {
  const productPath = `${productPathSegment}${product.handle}`;
  // Allow a path prefix, such as a locale: /en-ca/products/:handle.
  const isProductCard = (card: ProductCardLink) => card.url.pathname.endsWith(productPath);
  let cards: ProductCardLink[] = [];
  let cardError: unknown = null;

  // Wait for the expected card. An invalid card ends the wait with its own error.
  await expect
    .poll(
      async () => {
        try {
          cards = await readProductCardLinks(results, routePath, productPathSegment);
        } catch (error) {
          cardError = error;
          return true;
        }
        return cards.some(isProductCard);
      },
      { timeout },
    )
    .toBe(true)
    .catch(() => undefined);
  if (cardError !== null) throw cardError;

  const match = cards.find(isProductCard);
  if (match === undefined) {
    throw createContractError({
      capability: "product-results",
      routePath,
      expectation: `The element with ${RESULTS_ATTRIBUTE} contains a visible element with ${CARD_ATTRIBUTE} that links to ${productPath}. Found ${cards.length} visible product card links.`,
      likelyFix: `Add ${CARD_ATTRIBUTE} to the primary <a href> product link of each result inside the ${RESULTS_ATTRIBUTE} container.`,
      docsAnchor: DOCS_ANCHOR,
    });
  }

  const card = visibleProductCards(results).nth(match.index);
  // The results can render again after the read. Check that the card at the
  // read index still links to the matched product before the title check.
  const isSameProduct = await expect(card)
    .toHaveJSProperty("pathname", match.url.pathname, { timeout })
    .then(
      () => true,
      () => false,
    );
  if (!isSameProduct) {
    throw createContractError({
      capability: "product-results",
      routePath,
      expectation: `The visible element with ${CARD_ATTRIBUTE} that links to ${productPath} keeps that link while the suite checks it.`,
      likelyFix: `Keep the product results stable after they render, and keep ${CARD_ATTRIBUTE} on the product link of the same result.`,
      docsAnchor: DOCS_ANCHOR,
    });
  }

  const link = card.and(results.page().getByRole("link"));
  const title = new RegExp(escapeRegExp(product.title), "i");
  const isAccessibleLink = await expect(link)
    .toBeVisible({ timeout })
    .then(() => expect(link).toHaveAccessibleName(title, { timeout }))
    .then(
      () => true,
      () => false,
    );
  if (!isAccessibleLink) {
    throw createContractError({
      capability: "product-results",
      routePath,
      expectation: `The element with ${CARD_ATTRIBUTE} that links to ${productPath} is a visible link exposed to assistive technology, with an accessible name that contains "${product.title}".`,
      likelyFix:
        "Keep the product link visible with its native link role. Do not hide it with hidden or aria-hidden, do not override its role, and keep the product title in its accessible name.",
      docsAnchor: DOCS_ANCHOR,
    });
  }

  return card;
}

/** Visible product cards inside `results`. Hidden cards are not read or checked. */
function visibleProductCards(results: Locator): Locator {
  return results.getByTestId(PRODUCT_CARD_TEST_ID).filter({ visible: true });
}

/**
 * Reads the visible product cards inside `results` and checks that each one
 * is a native <a> whose href is a product URL.
 */
async function readProductCardLinks(
  results: Locator,
  routePath: string,
  productPathSegment: string,
): Promise<ProductCardLink[]> {
  const snapshots = await visibleProductCards(results).evaluateAll(
    (elements): ProductCardSnapshot[] =>
      elements.map((element) => ({
        element: element.localName,
        href: element.getAttribute("href"),
      })),
  );
  const baseUrl = results.page().url();

  return snapshots.map((snapshot, index) => {
    if (snapshot.element !== "a") {
      throw createContractError({
        capability: "product-results",
        routePath,
        expectation: `Each visible element with ${CARD_ATTRIBUTE} is the native <a> product link of a result. Found <${snapshot.element}>.`,
        likelyFix: `Put ${CARD_ATTRIBUTE} on the primary native <a href> product link of each result, not on the card wrapper or an element with an ARIA role.`,
        docsAnchor: DOCS_ANCHOR,
      });
    }

    const url = parseHttpUrl(snapshot.href, baseUrl);
    if (url === null || !url.pathname.includes(productPathSegment)) {
      throw createContractError({
        capability: "product-results",
        routePath,
        expectation: `Each visible element with ${CARD_ATTRIBUTE} has an href to a product URL that contains ${productPathSegment}. Found ${JSON.stringify(snapshot.href)}.`,
        likelyFix: `Set the href of each product card link to its product detail page, and keep ${CARD_ATTRIBUTE} off links to other pages.`,
        docsAnchor: DOCS_ANCHOR,
      });
    }

    return { index, url };
  });
}

function parseHttpUrl(href: string | null, baseUrl: string): URL | null {
  if (href === null || href.trim() === "") return null;

  try {
    const url = new URL(href, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
