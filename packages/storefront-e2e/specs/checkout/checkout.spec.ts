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
const CHECKOUT_CONTROL_NAME = /check\s*out|checkout|continue to checkout/i;

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
): Promise<void> {
  await expectCartLine(page, expectation);

  const checkout = page.getByRole("link", { name: CHECKOUT_CONTROL_NAME }).first();
  await expect(checkout).toBeVisible();
  const checkoutUrl = await requireCheckoutUrl(page, checkout, expectation.cartPath);
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
