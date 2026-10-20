import { expect, type Locator, type Page } from "@playwright/test";

import {
  requireCartDrawer,
  requireCartLine,
  requireCartPage,
  type CartTargetOptions,
} from "../../src/cart-targets";
import { createContractError, StorefrontContractError } from "../../src/contract";
import { requireProductAddToCart } from "../../src/product-targets";
import { test, type CheckoutTestProduct } from "./config";

const CART_SETTLE_TIMEOUT_MS = 15_000;
const CART_TARGET_OPTIONS: CartTargetOptions = { timeout: CART_SETTLE_TIMEOUT_MS };
// The cart page checkout link from docs/storefront-contract.md#checkout-handoff.
const CART_CHECKOUT_TEST_ID = "cart-checkout";

type CartExpectation = {
  readonly cartPath: string;
  readonly productTitle: string;
  readonly variantLabel: string;
};

type CartLineOptions = CartTargetOptions & {
  /** How long to wait for the variant text. Defaults to the expect timeout. */
  readonly variantTimeout?: number;
};

test("checkout handoff starts from populated cart", async ({ data, page }) => {
  const expectation = await addProductToCart(page, data.products, data.paths.cart);

  await startCheckoutFromPopulatedCart(page, expectation);
});

test.describe("checkout cart setup helpers", () => {
  const productPath = "/products/shirt";
  const expectation: CartExpectation = {
    cartPath: "/cart",
    productTitle: "Shirt",
    variantLabel: "Small",
  };
  const options: CartLineOptions = { timeout: 200, variantTimeout: 200 };

  test("scopes the cart page and drawer lines by test ID and allows the same product in both", async ({
    page,
  }) => {
    // Decoy landmarks and list items come first, so an unscoped first() match would find them.
    await page.setContent(`
      <main><ul><li>Shirt Small decoy main</li></ul></main>
      <dialog open><ul><li>Shirt Small decoy dialog</li></ul></dialog>
      <dialog open data-testid="cart-drawer"><ul>
        <li>Shirt recommendation</li>
        ${cartLineHtml("Shirt Small drawer line")}
      </ul></dialog>
      <div data-testid="cart-page"><ul>
        <li>Shirt recommendation</li>
        ${cartLineHtml("Shirt Small page line")}
      </ul></div>`);

    await expect(await expectCartLine(page, expectation, options)).toHaveText(
      "Shirt Small page line",
    );
    await expect(await cartOverlayLineFor(page, "Shirt", productPath, options)).toHaveText(
      "Shirt Small drawer line",
    );
  });

  test("fails clearly for a missing or duplicate cart page or cart page line", async ({ page }) => {
    const cases: [string, RegExp][] = [
      [
        `<main><ul>${cartLineHtml("Shirt Small")}</ul></main>`,
        /exactly one element with data-testid="cart-page".*Found 0\./,
      ],
      [
        `<div data-testid="cart-page"></div><div data-testid="cart-page"><ul>${cartLineHtml("Shirt Small")}</ul></div>`,
        /exactly one element with data-testid="cart-page".*Found 2\./,
      ],
      [
        `<div data-testid="cart-page"><ul><li>Shirt Small</li></ul></div>`,
        /cart page renders exactly one element with data-testid="cart-line" that contains "Shirt"\. Found 0\./,
      ],
      [
        `<div data-testid="cart-page"><ul>${cartLineHtml("Shirt Small")}${cartLineHtml("T-Shirt Small")}</ul></div>`,
        /cart page renders exactly one element with data-testid="cart-line" that contains "Shirt"\. Found 2\./,
      ],
    ];

    for (const [html, message] of cases) {
      await test.step(html, async () => {
        await page.setContent(html);
        await expectContractError(expectCartLine(page, expectation, options), message);
      });
    }
  });

  test("fails clearly for a missing drawer or drawer line", async ({ page }) => {
    await page.setContent(`<dialog open><ul>${cartLineHtml("Shirt Small")}</ul></dialog>`);
    await expectContractError(
      cartOverlayLineFor(page, "Shirt", productPath, options),
      /exactly one element with data-testid="cart-drawer".*Found 0\./,
    );

    await page.setContent(
      `<dialog open data-testid="cart-drawer"><ul><li>Shirt Small</li></ul></dialog>`,
    );
    await expectContractError(
      cartOverlayLineFor(page, "Shirt", productPath, options),
      /cart drawer renders exactly one element with data-testid="cart-line" that contains "Shirt"\. Found 0\./,
    );
  });

  test("still fails when the cart page line does not show the variant", async ({ page }) => {
    await page.setContent(
      `<div data-testid="cart-page"><ul>${cartLineHtml("Shirt Large")}</ul></div>`,
    );

    const error = await rejection(expectCartLine(page, expectation, options));

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(StorefrontContractError);
    expect(String(error)).toContain("Small");
  });
});

test.describe("checkout link helpers", () => {
  const expectation: CartExpectation = {
    cartPath: "/cart",
    productTitle: "Shirt",
    variantLabel: "Small",
  };
  const options: CartLineOptions = { timeout: 200, variantTimeout: 200 };
  const cartLine = `<ul><li data-testid="cart-line">Shirt Small</li></ul>`;
  const checkoutHref = "https://shop.example/checkouts/cn/abc";

  test("clicks only the cart page checkout link and ignores the drawer link and decoys", async ({
    page,
  }) => {
    // The decoys and the closed drawer come first. The real link has a localized name.
    await openCartFixture(
      page,
      `<a href="https://decoy.example/checkout">Checkout</a>
      <dialog data-testid="cart-drawer">
        ${cartLine}
        <a data-testid="cart-checkout" href="https://decoy.example/checkouts/drawer">Checkout</a>
      </dialog>
      <main data-testid="cart-page">
        ${cartLine}
        <a href="https://decoy.example/checkouts/english">Checkout</a>
        <a data-testid="cart-checkout" href="${checkoutHref}">Zur Kasse</a>
      </main>`,
    );

    await startCheckoutFromPopulatedCart(page, expectation, options);

    await expect(page).toHaveURL(checkoutHref);
  });

  test("hands off to a relative checkout URL on the storefront", async ({ page }) => {
    await openCartFixture(
      page,
      `<main data-testid="cart-page">
        ${cartLine}
        <a data-testid="cart-checkout" href="/cart/c/abc?key=1">Checkout</a>
      </main>`,
    );

    await startCheckoutFromPopulatedCart(page, expectation, options);

    await expect(page).toHaveURL(`${STOREFRONT_ORIGIN}/cart/c/abc?key=1`);
  });

  test("fails clearly for a missing, duplicate, or non-anchor checkout target", async ({
    page,
  }) => {
    const checkout = `<a data-testid="cart-checkout" href="${checkoutHref}">Checkout</a>`;
    const cases: [string, RegExp][] = [
      [
        `<a href="${checkoutHref}">Checkout</a>`,
        /cart page renders exactly one element with data-testid="cart-checkout" \(the checkout link\)\. Found 0\./,
      ],
      [`${checkout}${checkout}`, /data-testid="cart-checkout".*Found 2\./],
      [
        `<div data-testid="cart-checkout"><a href="${checkoutHref}">Checkout</a></div>`,
        /native <a> checkout link\. Found <div>\./,
      ],
      [
        `<button type="button" data-testid="cart-checkout">Checkout</button>`,
        /native <a> checkout link\. Found <button>\./,
      ],
    ];

    for (const [html, message] of cases) {
      await test.step(html, async () => {
        // The drawer has a real checkout link. It must not count for the cart page.
        await openCartFixture(
          page,
          `<dialog data-testid="cart-drawer">${checkout}</dialog>
          <main data-testid="cart-page">${cartLine}${html}</main>`,
        );
        await expectContractError(
          startCheckoutFromPopulatedCart(page, expectation, options),
          message,
        );
        await expect(page).toHaveURL(`${STOREFRONT_ORIGIN}/cart`);
      });
    }
  });

  test("fails clearly when the checkout link is hidden, has another role, or has no name", async ({
    page,
  }) => {
    // role="presentation" is not a case: ARIA ignores it on a focusable <a href>,
    // so the element is still a link, as it was for the previous role lookup.
    const sized = `style="display:inline-block;width:80px;height:24px"`;
    const links = [
      `<a data-testid="cart-checkout" href="${checkoutHref}" aria-hidden="true">Checkout</a>`,
      `<a data-testid="cart-checkout" href="${checkoutHref}" role="button">Checkout</a>`,
      `<a data-testid="cart-checkout" href="${checkoutHref}" hidden>Checkout</a>`,
      `<a data-testid="cart-checkout" href="${checkoutHref}" ${sized}></a>`,
    ];

    for (const link of links) {
      await test.step(link, async () => {
        await openCartFixture(page, `<main data-testid="cart-page">${cartLine}${link}</main>`);
        await expectContractError(
          startCheckoutFromPopulatedCart(page, expectation, options),
          /data-testid="cart-checkout" is a visible link exposed to assistive technology with a non-empty accessible name\./,
        );
        await expect(page).toHaveURL(`${STOREFRONT_ORIGIN}/cart`);
      });
    }
  });

  test("fails clearly for a missing, empty, or invalid checkout href", async ({ page }) => {
    const links = [
      `<a data-testid="cart-checkout">Checkout</a>`,
      `<a data-testid="cart-checkout" href="">Checkout</a>`,
      `<a data-testid="cart-checkout" href="http://[">Checkout</a>`,
      `<a data-testid="cart-checkout" href="/collections/all">Checkout</a>`,
    ];

    for (const link of links) {
      await test.step(link, async () => {
        await openCartFixture(page, `<main data-testid="cart-page">${cartLine}${link}</main>`);
        await expectContractError(
          startCheckoutFromPopulatedCart(page, expectation, options),
          /The visible checkout link targets a checkout URL\./,
        );
        await expect(page).toHaveURL(`${STOREFRONT_ORIGIN}/cart`);
      });
    }
  });
});

async function addProductToCart(
  page: Page,
  products: readonly CheckoutTestProduct[],
  cartPath: string,
): Promise<CartExpectation> {
  for (const product of products) {
    const expectation = await tryAddProductToCart(page, product, cartPath);
    if (expectation !== null) return expectation;
  }

  throw createContractError({
    capability: "product-cart",
    routePath: cartPath,
    expectation: "At least one cart enabled product page exposes an enabled Add to cart button.",
    likelyFix:
      "Ensure the test store has an in-stock product variant with an enabled Add to cart button.",
    docsAnchor: "#cart-line-items",
  });
}

async function tryAddProductToCart(
  page: Page,
  product: CheckoutTestProduct,
  cartPath: string,
): Promise<CartExpectation | null> {
  await page.goto(product.path);

  const expectation = {
    cartPath,
    productTitle: product.productTitle,
    variantLabel: product.variantLabel,
  };
  const addToCart = await requireProductAddToCart(page, product.path, {
    timeout: CART_SETTLE_TIMEOUT_MS,
  });
  const isCartEnabled =
    (await addToCart.isVisible().catch(() => false)) &&
    (await addToCart.isEnabled().catch(() => false));
  if (!isCartEnabled) return null;

  await addToCart.click();
  await expect(await cartOverlayLineFor(page, expectation.productTitle, product.path)).toBeVisible({
    timeout: CART_SETTLE_TIMEOUT_MS,
  });
  await page.goto(cartPath);
  await expectCartLine(page, expectation);

  return expectation;
}

async function startCheckoutFromPopulatedCart(
  page: Page,
  expectation: CartExpectation,
  options: CartLineOptions = CART_TARGET_OPTIONS,
): Promise<void> {
  await expectCartLine(page, expectation, options);

  const checkout = await requireCartPageCheckout(page, expectation.cartPath, options);
  const checkoutUrl = await requireCheckoutUrl(page, checkout, expectation.cartPath);
  await requireAccessibleCheckoutLink(page, checkout, expectation.cartPath, options);
  const isCheckoutNavigation = (url: URL) => url.href === checkoutUrl.href;

  await page.route(isCheckoutNavigation, async (route) => {
    await route.fulfill({
      body: "<!doctype html><title>Checkout</title>",
      contentType: "text/html",
      status: 200,
    });
  });

  try {
    await checkout.click();
    await expect(page).toHaveURL(checkoutUrl.href);
  } finally {
    await page.unroute(isCheckoutNavigation);
  }
}

async function expectCartLine(
  page: Page,
  expectation: CartExpectation,
  options: CartLineOptions = CART_TARGET_OPTIONS,
): Promise<Locator> {
  const cartPage = await requireCartPage(page, expectation.cartPath, options);
  const line = await requireCartLine(
    cartPage,
    "cart page",
    expectation.productTitle,
    expectation.cartPath,
    options,
  );
  await expect(line).toBeVisible({ timeout: options.timeout });

  if (shouldAssertVariant(expectation.variantLabel)) {
    await expect(line.getByText(expectation.variantLabel, { exact: false })).toBeVisible({
      timeout: options.variantTimeout,
    });
  }

  return line;
}

/**
 * Returns the single native <a> checkout link inside the cart page. The drawer
 * can render its own checkout link with the same test ID; it does not count.
 */
async function requireCartPageCheckout(
  page: Page,
  cartPath: string,
  options: CartTargetOptions = CART_TARGET_OPTIONS,
): Promise<Locator> {
  const cartPage = await requireCartPage(page, cartPath, options);
  const checkout = cartPage.getByTestId(CART_CHECKOUT_TEST_ID);
  const attribute = `data-testid="${CART_CHECKOUT_TEST_ID}"`;

  try {
    await expect(checkout).toHaveCount(1, { timeout: options.timeout });
  } catch {
    const count = await checkout.count();
    throw createContractError({
      capability: "checkout-handoff",
      routePath: cartPath,
      expectation: `The cart page renders exactly one element with ${attribute} (the checkout link). Found ${count}.`,
      likelyFix:
        count === 0
          ? `Add ${attribute} to the checkout link on the cart page.`
          : `Keep ${attribute} only on the cart page checkout link. Remove it from other elements in the cart page.`,
      docsAnchor: "#checkout-handoff",
    });
  }

  const element = await checkout.evaluate((node) => node.localName);
  if (element !== "a") {
    throw createContractError({
      capability: "checkout-handoff",
      routePath: cartPath,
      expectation: `The element with ${attribute} is the native <a> checkout link. Found <${element}>.`,
      likelyFix: `Put ${attribute} on the native <a href> checkout link itself, not on a wrapper or a <button>.`,
      docsAnchor: "#checkout-handoff",
    });
  }

  return checkout;
}

/**
 * Expects the checkout target to be a visible link for assistive technology,
 * with an accessible name in any language. Runs after the href check.
 */
async function requireAccessibleCheckoutLink(
  page: Page,
  checkout: Locator,
  cartPath: string,
  { timeout }: CartTargetOptions = CART_TARGET_OPTIONS,
): Promise<void> {
  const link = checkout.and(page.getByRole("link"));
  const isAccessibleLink = await expect(link)
    .toBeVisible({ timeout })
    .then(() => expect(link).toHaveAccessibleName(/\S/, { timeout }))
    .then(
      () => true,
      () => false,
    );
  if (!isAccessibleLink) {
    throw createContractError({
      capability: "checkout-handoff",
      routePath: cartPath,
      expectation: `The element with data-testid="${CART_CHECKOUT_TEST_ID}" is a visible link exposed to assistive technology with a non-empty accessible name.`,
      likelyFix:
        "Keep the checkout link visible with its native link role. Do not hide it with hidden or aria-hidden, do not override its role, and give it an accessible name in any language.",
      docsAnchor: "#checkout-handoff",
    });
  }
}

async function cartOverlayLineFor(
  page: Page,
  productTitle: string,
  routePath: string,
  options: CartTargetOptions = CART_TARGET_OPTIONS,
): Promise<Locator> {
  const drawer = await requireCartDrawer(page, routePath, options);
  return requireCartLine(drawer, "cart drawer", productTitle, routePath, options);
}

function shouldAssertVariant(variantLabel: string): boolean {
  return variantLabel !== "" && variantLabel.toLowerCase() !== "default title";
}

async function requireCheckoutUrl(page: Page, checkout: Locator, cartPath: string): Promise<URL> {
  const href = await checkout.getAttribute("href");
  if (href === null || href === "") {
    throw checkoutHandoffError(cartPath);
  }

  let url: URL;
  try {
    url = new URL(href, page.url());
  } catch {
    throw checkoutHandoffError(cartPath);
  }

  if (isCheckoutUrl(url, cartPath)) return url;

  throw checkoutHandoffError(cartPath);
}

function checkoutHandoffError(cartPath: string): Error {
  return createContractError({
    capability: "checkout-handoff",
    routePath: cartPath,
    expectation: "The visible checkout link targets a checkout URL.",
    likelyFix: "Set the checkout link href to the cart checkout URL.",
    docsAnchor: "#checkout-handoff",
  });
}

function isCheckoutUrl(url: URL, cartPath: string): boolean {
  return /checkout|checkouts/i.test(url.href) || url.pathname.startsWith(`${cartPath}/c/`);
}

/** A real cart line for helper fixtures. Decoy list items have no test ID. */
function cartLineHtml(text: string): string {
  return `<li data-testid="cart-line">${text}</li>`;
}

async function expectContractError(promise: Promise<unknown>, message: RegExp): Promise<void> {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(StorefrontContractError);
  expect(String(error)).toMatch(message);
}

/** Returns the rejection reason, or null when the promise resolves. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

/** Fake storefront origin for checkout link fixtures. No request leaves the browser. */
const STOREFRONT_ORIGIN = "https://storefront.test";

/**
 * Serves `body` as the storefront cart page, so relative checkout links have an
 * HTTP base. Every other request is aborted, except routes the test adds later.
 */
async function openCartFixture(page: Page, body: string): Promise<void> {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/*", (route) => route.abort());
  await page.route(`${STOREFRONT_ORIGIN}/cart`, (route) =>
    route.fulfill({ body: `<!doctype html>${body}`, contentType: "text/html", status: 200 }),
  );
  await page.goto(`${STOREFRONT_ORIGIN}/cart`);
}
