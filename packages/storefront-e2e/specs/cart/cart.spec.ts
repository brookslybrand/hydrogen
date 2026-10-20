import { expect, type Locator, type Page } from "@playwright/test";

import {
  requireCartDrawer,
  requireCartPage,
  requireCartTrigger,
  type CartTargetOptions,
} from "../../src/cart-targets";
import { createContractError, StorefrontContractError } from "../../src/contract";
import { requireProductAddToCart } from "../../src/product-targets";
import { test, type CartTestProduct } from "./config";

const CART_SETTLE_TIMEOUT_MS = 15_000;
const CART_TARGET_OPTIONS: CartTargetOptions = { timeout: CART_SETTLE_TIMEOUT_MS };
const REMOVE_CONTROL_NAME = /remove/i;
const INCREASE_CONTROL_NAME = /increase|^\+$/i;
const DECREASE_CONTROL_NAME = /decrease|^[-−]$/i;
const CART_ENDPOINT_PATTERN = "**/api/cart";
const CART_TOTALS_UPDATING_TEXT = "Updating cart totals";
const CART_TOTALS_UPDATED_TEXT = "Cart totals updated";

type CartExpectation = {
  readonly cartPath: string;
  readonly productTitle: string;
  readonly variantLabel: string;
};

test("cart accepts selected variant", async ({ data, page }) => {
  await addProductToCart(page, data.products, data.paths.cart);
});

test("cart page shows added product", async ({ data, page }) => {
  const expectation = await addProductToCart(page, data.products, data.paths.cart);

  await expectCartLine(page, expectation);
});

test("cart quantity increases and decreases", async ({ data, page }) => {
  const expectation = await addProductToCart(page, data.products, data.paths.cart);

  await increaseCartLineQuantity(page, expectation);
  await decreaseCartLineQuantity(page, expectation);
});

test("cart removes product", async ({ data, page }) => {
  const expectation = await addProductToCart(page, data.products, data.paths.cart);

  await removeCartLine(page, expectation);
});

test("cart rolls back an optimistic add beyond available stock", async ({ data, page }) => {
  const product = data.stockLimitProduct;
  if (!product) {
    test.skip(true, "No finite-stock product could be seeded to its maximum quantity");
    return;
  }

  const expectation = await tryAddProductToCart(page, product, data.paths.cart);
  if (!expectation) {
    throw createContractError({
      capability: "product-cart",
      routePath: product.path,
      expectation: "The discovered stock-limit product exposes an enabled Add to cart button.",
      likelyFix: "Keep the discovered in-stock variant available on its product page.",
      docsAnchor: "#cart-line-items",
    });
  }
  await setCartLineQuantity(page, expectation, product.maxQuantity);
  await page.goto(product.path);
  const addToCart = await requireProductAddToCart(page, product.path, {
    timeout: CART_SETTLE_TIMEOUT_MS,
  });

  const requestGate = createRequestGate();
  await page.route(CART_ENDPOINT_PATTERN, async (route) => {
    await requestGate.wait;
    await route.continue();
  });

  try {
    await addToCart.click();
    const line = await openCartOverlayFor(page, product.productTitle, product.path);
    await expect(line).toBeVisible({ timeout: CART_SETTLE_TIMEOUT_MS });
    const quantityInput = await quantityInputFor(line, product.path);
    await expect
      .poll(() => numericInputValue(quantityInput), {
        message: `Expected cart line quantity to optimistically increase from ${product.maxQuantity} to ${product.maxQuantity + 1}.`,
      })
      .toBe(product.maxQuantity + 1);
    await expectCartTotalsStatus(page, CART_TOTALS_UPDATING_TEXT, data.paths.cart);

    requestGate.release();
    await expect
      .poll(() => numericInputValue(quantityInput), {
        message: `Expected cart line quantity to roll back to the stock limit of ${product.maxQuantity}.`,
      })
      .toBe(product.maxQuantity);
    await expectCartTotalsStatus(page, CART_TOTALS_UPDATED_TEXT, data.paths.cart);
  } finally {
    requestGate.release();
    await page.unroute(CART_ENDPOINT_PATTERN);
  }
});

test.describe("cart target helpers", () => {
  const productPath = "/products/shirt";
  const cartPath = "/cart";
  const options: CartTargetOptions = { timeout: 200 };
  const drawerHtml = `<dialog id="drawer" data-testid="cart-drawer"><ul><li>Shirt</li></ul></dialog>`;
  const decoyCartButtonHtml = `<button type="button" onclick="window.decoyClicked = true">Cart</button>`;

  test("scopes cart page and drawer lines by test ID, not by landmark or dialog role", async ({
    page,
  }) => {
    // Decoys come first, so an unscoped first() match would find them.
    await page.setContent(`
      <main><ul><li>Shirt decoy main</li></ul></main>
      <dialog open><ul><li>Shirt decoy dialog</li></ul></dialog>
      <dialog open data-testid="cart-drawer"><ul><li>Shirt drawer line</li></ul></dialog>
      <div data-testid="cart-page"><ul><li>Shirt page line</li></ul></div>`);

    await expect(await cartLineFor(page, "Shirt", cartPath, options)).toHaveText("Shirt page line");
    await expect(await cartOverlayLineFor(page, "Shirt", productPath, options)).toHaveText(
      "Shirt drawer line",
    );
  });

  test("fails clearly for a missing or duplicate cart page", async ({ page }) => {
    await page.setContent(`<main><ul><li>Shirt</li></ul></main>`);
    await expectContractError(
      cartLineFor(page, "Shirt", cartPath, options),
      /exactly one element with data-testid="cart-page".*Found 0\./,
    );

    await page.setContent(`
      <main data-testid="cart-page"><ul><li>Shirt</li></ul></main>
      <div data-testid="cart-page"><ul><li>Shirt</li></ul></div>`);
    await expectContractError(
      cartLineFor(page, "Shirt", cartPath, options),
      /exactly one element with data-testid="cart-page".*Found 2\./,
    );
  });

  test("fails clearly for a missing, duplicate, or non-dialog cart drawer", async ({ page }) => {
    await page.setContent(`<dialog open><ul><li>Shirt</li></ul></dialog>`);
    await expectContractError(
      cartOverlayLineFor(page, "Shirt", productPath, options),
      /exactly one element with data-testid="cart-drawer".*Found 0\./,
    );

    await page.setContent(`${drawerHtml}${drawerHtml}`);
    await expectContractError(
      cartOverlayLineFor(page, "Shirt", productPath, options),
      /exactly one element with data-testid="cart-drawer".*Found 2\./,
    );

    await page.setContent(
      `<div data-testid="cart-drawer" role="dialog"><ul><li>Shirt</li></ul></div>`,
    );
    await expectContractError(
      cartOverlayLineFor(page, "Shirt", productPath, options),
      /native <dialog> cart drawer\. Found <div>\./,
    );
  });

  test("uses a drawer that opened by itself without clicking the cart trigger", async ({
    page,
  }) => {
    await page.setContent(`
      <button type="button" data-testid="cart-trigger" onclick="window.triggerClicked = true">
        Cart
      </button>
      <dialog open data-testid="cart-drawer"><ul><li>Shirt</li></ul></dialog>`);

    const line = await openCartOverlayFor(page, "Shirt", productPath, options);

    await expect(line).toBeVisible();
    expect(await page.evaluate(() => "triggerClicked" in window)).toBe(false);
  });

  test("opens a closed drawer with the cart trigger and ignores decoy buttons", async ({
    page,
  }) => {
    const triggers = [
      `<button type="button" data-testid="cart-trigger" aria-label="Bag" onclick="document.getElementById('drawer').showModal()"></button>`,
      `<a href="/cart" data-testid="cart-trigger" onclick="event.preventDefault(); document.getElementById('drawer').showModal()">Bag</a>`,
    ];

    for (const trigger of triggers) {
      await test.step(trigger, async () => {
        await page.setContent(`${decoyCartButtonHtml}${trigger}${drawerHtml}`);

        const line = await openCartOverlayFor(page, "Shirt", productPath, options);

        await expect(line).toBeVisible();
        expect(await page.evaluate(() => "decoyClicked" in window)).toBe(false);
      });
    }
  });

  test("fails clearly for a missing, duplicate, or non-control cart trigger", async ({ page }) => {
    await page.setContent(`${decoyCartButtonHtml}${drawerHtml}`);
    await expectContractError(
      openCartOverlayFor(page, "Shirt", productPath, options),
      /exactly one element with data-testid="cart-trigger".*Found 0\./,
    );

    const trigger = `<button type="button" data-testid="cart-trigger">Cart</button>`;
    await page.setContent(`${trigger}${trigger}${drawerHtml}`);
    await expectContractError(
      openCartOverlayFor(page, "Shirt", productPath, options),
      /exactly one element with data-testid="cart-trigger".*Found 2\./,
    );

    await page.setContent(
      `<div data-testid="cart-trigger" role="button" tabindex="0">Cart</div>${drawerHtml}`,
    );
    await expectContractError(
      openCartOverlayFor(page, "Shirt", productPath, options),
      /native <button> or <a> control that opens the cart drawer\. Found <div>\./,
    );
  });
});

function createRequestGate(): { wait: Promise<void>; release: () => void } {
  let release: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release: () => release?.() };
}

async function addProductToCart(
  page: Page,
  products: readonly CartTestProduct[],
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
  product: CartTestProduct,
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
  const isCartVisible = await addToCart
    .waitFor({ state: "visible", timeout: CART_SETTLE_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
  const isCartEnabled = isCartVisible && (await addToCart.isEnabled().catch(() => false));
  if (!isCartEnabled) return null;

  await addToCart.click();
  const line = await cartOverlayLineFor(page, expectation.productTitle, product.path);
  await expect(line).toBeVisible({
    timeout: CART_SETTLE_TIMEOUT_MS,
  });
  await expectCartTotalsStatus(page, CART_TOTALS_UPDATED_TEXT, cartPath);
  await page.goto(cartPath);
  await expectCartLine(page, expectation);

  return expectation;
}

async function setCartLineQuantity(
  page: Page,
  expectation: CartExpectation,
  quantity: number,
): Promise<void> {
  const line = await expectCartLine(page, expectation);
  const quantityInput = await quantityInputFor(line, expectation.cartPath);
  const requestGate = createRequestGate();
  await page.route(CART_ENDPOINT_PATTERN, async (route) => {
    await requestGate.wait;
    await route.continue();
  });

  try {
    await quantityInput.fill(String(quantity));
    await quantityInput.press("Tab");
    await expectCartTotalsStatus(page, CART_TOTALS_UPDATING_TEXT, expectation.cartPath);
    requestGate.release();
    await expect
      .poll(() => numericInputValue(quantityInput), {
        message: `Expected cart line quantity to settle at the discovered stock limit of ${quantity}.`,
      })
      .toBe(quantity);
    await expectCartTotalsStatus(page, CART_TOTALS_UPDATED_TEXT, expectation.cartPath);
  } finally {
    requestGate.release();
    await page.unroute(CART_ENDPOINT_PATTERN);
  }
}

async function expectCartLine(page: Page, expectation: CartExpectation): Promise<Locator> {
  const line = await cartLineFor(page, expectation.productTitle, expectation.cartPath);
  await expect(line).toBeVisible({ timeout: CART_SETTLE_TIMEOUT_MS });

  if (shouldAssertVariant(expectation.variantLabel)) {
    await expect(line.getByText(expectation.variantLabel, { exact: false })).toBeVisible();
  }

  return line;
}

async function increaseCartLineQuantity(page: Page, expectation: CartExpectation): Promise<void> {
  const line = await expectCartLine(page, expectation);
  const quantityInput = await quantityInputFor(line, expectation.cartPath);
  const initialQuantity = await numericInputValue(quantityInput);
  const increase = await lineButton(
    line,
    INCREASE_CONTROL_NAME,
    "increase quantity",
    expectation.cartPath,
  );

  await increase.click();
  await expect
    .poll(() => numericInputValue(quantityInput), {
      message: `Expected cart line quantity to increase from ${initialQuantity} to ${initialQuantity + 1}.`,
    })
    .toBe(initialQuantity + 1);
}

async function decreaseCartLineQuantity(page: Page, expectation: CartExpectation): Promise<void> {
  const line = await expectCartLine(page, expectation);
  const quantityInput = await quantityInputFor(line, expectation.cartPath);
  const initialQuantity = await numericInputValue(quantityInput);
  const decrease = await lineButton(
    line,
    DECREASE_CONTROL_NAME,
    "decrease quantity",
    expectation.cartPath,
  );

  await decrease.click();
  await expect
    .poll(() => numericInputValue(quantityInput), {
      message: `Expected cart line quantity to decrease from ${initialQuantity} to ${initialQuantity - 1} after quantity increase succeeded.`,
    })
    .toBe(initialQuantity - 1);
}

async function removeCartLine(page: Page, expectation: CartExpectation): Promise<void> {
  const line = await expectCartLine(page, expectation);
  const remove = await lineButton(
    line,
    REMOVE_CONTROL_NAME,
    "remove line item",
    expectation.cartPath,
  );

  await remove.click();
  await expect(line).not.toBeVisible({ timeout: CART_SETTLE_TIMEOUT_MS });
}

async function cartOverlayLineFor(
  page: Page,
  productTitle: string,
  routePath: string,
  options: CartTargetOptions = CART_TARGET_OPTIONS,
): Promise<Locator> {
  const drawer = await requireCartDrawer(page, routePath, options);
  return drawer.getByRole("listitem").filter({ hasText: productTitle }).first();
}

/**
 * Returns the drawer line. Uses the cart trigger only when the drawer did not
 * open by itself after Add to cart.
 */
async function openCartOverlayFor(
  page: Page,
  productTitle: string,
  routePath: string,
  options: CartTargetOptions = CART_TARGET_OPTIONS,
): Promise<Locator> {
  const line = await cartOverlayLineFor(page, productTitle, routePath, options);
  if (await line.isVisible().catch(() => false)) return line;

  const trigger = await requireCartTrigger(page, routePath, options);
  await trigger.click();
  return line;
}

async function expectCartTotalsStatus(
  page: Page,
  message: string,
  cartPath: string,
): Promise<void> {
  try {
    await expect(page.getByRole("status").filter({ hasText: message }).first()).toBeAttached({
      timeout: CART_SETTLE_TIMEOUT_MS,
    });
  } catch {
    throw createContractError({
      capability: "cart-status",
      routePath: cartPath,
      expectation: `Cart exposes a status region containing "${message}" while totals settle.`,
      likelyFix:
        'Render a role="status" region that changes from updating to updated around cart mutations.',
      docsAnchor: "#cart-line-items",
    });
  }
}

async function cartLineFor(
  page: Page,
  productTitle: string,
  cartPath: string,
  options: CartTargetOptions = CART_TARGET_OPTIONS,
): Promise<Locator> {
  const cartPage = await requireCartPage(page, cartPath, options);
  return cartPage.getByRole("listitem").filter({ hasText: productTitle }).first();
}

async function quantityInputFor(line: Locator, cartPath: string): Promise<Locator> {
  const textbox = line.getByRole("textbox").first();
  if (await textbox.isVisible().catch(() => false)) return textbox;

  const spinbutton = line.getByRole("spinbutton").first();
  if (await spinbutton.isVisible().catch(() => false)) return spinbutton;

  throw createContractError({
    capability: "cart-line",
    routePath: cartPath,
    expectation: "Cart line item exposes a visible quantity input.",
    likelyFix: "Label the cart line quantity control and keep it inside the line item.",
    docsAnchor: "#cart-line-items",
  });
}

async function numericInputValue(input: Locator): Promise<number> {
  const value = await input.inputValue();
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shouldAssertVariant(variantLabel: string): boolean {
  return variantLabel !== "" && variantLabel.toLowerCase() !== "default title";
}

async function lineButton(
  line: Locator,
  name: RegExp,
  purpose: string,
  cartPath: string,
): Promise<Locator> {
  const button = line.getByRole("button", { name }).first();
  if (await button.isVisible().catch(() => false)) return button;

  throw createContractError({
    capability: "cart-line",
    routePath: cartPath,
    expectation: "Cart line item exposes a visible button for " + purpose + ".",
    likelyFix: "Add accessible names to cart line quantity and remove controls.",
    docsAnchor: "#cart-line-items",
  });
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
