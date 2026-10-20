import { expect, type Locator, type Page } from "@playwright/test";

import {
  requireCartDrawer,
  requireCartLine,
  requireCartLineControl,
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
  const drawerHtml = `<dialog id="drawer" data-testid="cart-drawer"><ul>${cartLineHtml("Shirt")}</ul></dialog>`;
  const decoyCartButtonHtml = `<button type="button" onclick="window.decoyClicked = true">Cart</button>`;
  const triggerHtml = `<button type="button" data-testid="cart-trigger" onclick="window.triggerClicked = true; document.getElementById('drawer').showModal()">Cart</button>`;

  test("scopes cart page and drawer lines by test ID, not by landmark or dialog role", async ({
    page,
  }) => {
    // Decoys come first, so an unscoped first() match would find them.
    await page.setContent(`
      <main><ul>${cartLineHtml("Shirt decoy main")}</ul></main>
      <dialog open><ul>${cartLineHtml("Shirt decoy dialog")}</ul></dialog>
      <dialog open data-testid="cart-drawer"><ul>${cartLineHtml("Shirt drawer line")}</ul></dialog>
      <div data-testid="cart-page"><ul>${cartLineHtml("Shirt page line")}</ul></div>`);

    await expect(await cartLineFor(page, "Shirt", cartPath, options)).toHaveText("Shirt page line");
    await expect(await cartOverlayLineFor(page, "Shirt", productPath, options)).toHaveText(
      "Shirt drawer line",
    );
  });

  test("ignores list items without the cart line test ID", async ({ page }) => {
    await page.setContent(`
      <dialog open data-testid="cart-drawer"><ul>
        <li>Shirt recommendation</li>
        ${cartLineHtml("Shirt drawer line")}
      </ul></dialog>
      <div data-testid="cart-page"><ul>
        <li>Shirt recommendation</li>
        ${cartLineHtml("Shirt page line")}
      </ul></div>`);

    await expect(await cartLineFor(page, "Shirt", cartPath, options)).toHaveText("Shirt page line");
    await expect(await cartOverlayLineFor(page, "Shirt", productPath, options)).toHaveText(
      "Shirt drawer line",
    );
  });

  test("allows the same product line in both the cart page and the drawer", async ({ page }) => {
    await page.setContent(`
      <div data-testid="cart-page"><ul>${cartLineHtml("Shirt page line")}</ul></div>
      <dialog open data-testid="cart-drawer"><ul>${cartLineHtml("Shirt drawer line")}</ul></dialog>`);

    await expect(await cartLineFor(page, "Shirt", cartPath, options)).toHaveText("Shirt page line");
    await expect(await openCartOverlayFor(page, "Shirt", productPath, options)).toHaveText(
      "Shirt drawer line",
    );
  });

  test("fails clearly for a missing or ambiguous line in the cart page", async ({ page }) => {
    await page.setContent(
      `<div data-testid="cart-page"><ul><li>Shirt</li>${cartLineHtml("Hat")}</ul></div>`,
    );
    await expectContractError(
      cartLineFor(page, "Shirt", cartPath, options),
      /cart page renders exactly one element with data-testid="cart-line" that contains "Shirt"\. Found 0\./,
    );

    await page.setContent(
      `<div data-testid="cart-page"><ul>${cartLineHtml("Shirt")}${cartLineHtml("T-Shirt")}</ul></div>`,
    );
    await expectContractError(
      cartLineFor(page, "Shirt", cartPath, options),
      /cart page renders exactly one element with data-testid="cart-line" that contains "Shirt"\. Found 2\./,
    );
  });

  test("fails clearly for a missing or ambiguous line in an open drawer without the trigger", async ({
    page,
  }) => {
    await page.setContent(`
      ${triggerHtml}
      <dialog open id="drawer" data-testid="cart-drawer"><ul><li>Shirt</li>${cartLineHtml("Hat")}</ul></dialog>`);
    await expectContractError(
      openCartOverlayFor(page, "Shirt", productPath, options),
      /cart drawer renders exactly one element with data-testid="cart-line" that contains "Shirt"\. Found 0\./,
    );
    expect(await wasTriggerClicked(page)).toBe(false);

    await page.setContent(`
      ${triggerHtml}
      <dialog open id="drawer" data-testid="cart-drawer"><ul>${cartLineHtml("Shirt")}${cartLineHtml("Shirt")}</ul></dialog>`);
    await expectContractError(
      openCartOverlayFor(page, "Shirt", productPath, options),
      /cart drawer renders exactly one element with data-testid="cart-line" that contains "Shirt"\. Found 2\./,
    );
    expect(await wasTriggerClicked(page)).toBe(false);
  });

  test("fails clearly for a missing or duplicate cart page", async ({ page }) => {
    await page.setContent(`<main><ul>${cartLineHtml("Shirt")}</ul></main>`);
    await expectContractError(
      cartLineFor(page, "Shirt", cartPath, options),
      /exactly one element with data-testid="cart-page".*Found 0\./,
    );

    await page.setContent(`
      <main data-testid="cart-page"><ul>${cartLineHtml("Shirt")}</ul></main>
      <div data-testid="cart-page"><ul>${cartLineHtml("Shirt")}</ul></div>`);
    await expectContractError(
      cartLineFor(page, "Shirt", cartPath, options),
      /exactly one element with data-testid="cart-page".*Found 2\./,
    );
  });

  test("fails clearly for a missing, duplicate, or non-dialog cart drawer", async ({ page }) => {
    await page.setContent(`<dialog open><ul>${cartLineHtml("Shirt")}</ul></dialog>`);
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
      `<div data-testid="cart-drawer" role="dialog"><ul>${cartLineHtml("Shirt")}</ul></div>`,
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
      ${triggerHtml}
      <dialog open id="drawer" data-testid="cart-drawer"><ul>${cartLineHtml("Shirt")}</ul></dialog>`);

    const cartLine = await openCartOverlayFor(page, "Shirt", productPath, options);

    await expect(cartLine).toBeVisible();
    expect(await wasTriggerClicked(page)).toBe(false);
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

        const cartLine = await openCartOverlayFor(page, "Shirt", productPath, options);

        await expect(cartLine).toBeVisible();
        expect(await page.evaluate(() => "decoyClicked" in window)).toBe(false);
      });
    }
  });

  test("opens a closed drawer that renders its lines only after the trigger", async ({ page }) => {
    // The drawer is empty until the trigger opens it, then adds the line later.
    await page.setContent(`
      <button type="button" data-testid="cart-trigger" onclick="
        const drawer = document.getElementById('drawer');
        drawer.showModal();
        setTimeout(() => {
          drawer.innerHTML = '<ul><li data-testid=&quot;cart-line&quot;>Shirt</li></ul>';
        }, 50);
      ">Cart</button>
      <dialog id="drawer" data-testid="cart-drawer"></dialog>`);

    const cartLine = await openCartOverlayFor(page, "Shirt", productPath, options);

    await expect(cartLine).toBeVisible();
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

  test("changes quantity with the line's test ID controls and ignores decoy inputs and buttons", async ({
    page,
  }) => {
    for (const inputType of ["text", "number"] as const) {
      await test.step(`${inputType} input`, async () => {
        // The other line comes first, so a page-level match would find its controls.
        await page.setContent(`<div data-testid="cart-page"><ul>
          ${quantityLineHtml("Hat", inputType, 5)}
          ${quantityLineHtml("Shirt", inputType, 1)}
        </ul></div>`);
        const line = await cartLineFor(page, "Shirt", cartPath, options);
        const quantityInput = await quantityInputFor(line, cartPath, options);

        await quantityInput.fill("3");
        expect(await numericInputValue(quantityInput)).toBe(3);
        await stepCartLineQuantity(line, "increase", cartPath, options);
        expect(await numericInputValue(quantityInput)).toBe(4);
        await stepCartLineQuantity(line, "decrease", cartPath, options);
        expect(await numericInputValue(quantityInput)).toBe(3);

        const otherLine = await cartLineFor(page, "Hat", cartPath, options);
        expect(await numericInputValue(await quantityInputFor(otherLine, cartPath, options))).toBe(
          5,
        );
        expect(await page.evaluate(() => "decoyClicked" in window)).toBe(false);
      });
    }
  });

  test("fails clearly for a missing, duplicate, non-native, or hidden quantity input", async ({
    page,
  }) => {
    const quantity = `<input type="number" data-testid="cart-line-quantity" value="1">`;
    const cases: [string, RegExp][] = [
      [
        `<input type="text" aria-label="Quantity" value="1"><input type="number" aria-label="Quantity" value="1">`,
        /cart line renders exactly one element with data-testid="cart-line-quantity" \(the quantity input\)\. Found 0\./,
      ],
      [`${quantity}${quantity}`, /data-testid="cart-line-quantity".*Found 2\./],
      [
        `<div data-testid="cart-line-quantity" role="spinbutton" aria-valuenow="1">1</div>`,
        /native <input> quantity input\. Found <div>\./,
      ],
      [
        `<input type="number" data-testid="cart-line-quantity" value="1" hidden>`,
        /quantity input with data-testid="cart-line-quantity" is visible in the cart line\./,
      ],
    ];

    for (const [controls, message] of cases) {
      await test.step(controls, async () => {
        // The other line has a real quantity input. It must not count for Shirt.
        await page.setContent(`<div data-testid="cart-page"><ul>
          <li data-testid="cart-line">Hat ${quantity}</li>
          <li data-testid="cart-line">Shirt ${controls}</li>
        </ul></div>`);
        const line = await cartLineFor(page, "Shirt", cartPath, options);
        await expectContractError(quantityInputFor(line, cartPath, options), message);
      });
    }
  });

  test("fails clearly for a missing, duplicate, or non-button increase or decrease control", async ({
    page,
  }) => {
    const quantity = `<input type="number" data-testid="cart-line-quantity" value="2">`;
    const decrease = `<button type="button" data-testid="cart-line-decrease">-</button>`;
    const cases: ["increase" | "decrease", string, RegExp][] = [
      [
        "increase",
        `<button type="button" aria-label="Increase quantity">+</button>`,
        /cart line renders exactly one element with data-testid="cart-line-increase" \(the increase quantity button\)\. Found 0\./,
      ],
      ["decrease", `${decrease}${decrease}`, /data-testid="cart-line-decrease".*Found 2\./],
      [
        "increase",
        `<a href="#" data-testid="cart-line-increase">+</a>`,
        /native <button> increase quantity button\. Found <a>\./,
      ],
    ];

    for (const [control, controls, message] of cases) {
      await test.step(controls, async () => {
        await page.setContent(`<div data-testid="cart-page"><ul>
          <li data-testid="cart-line">Shirt ${quantity}${controls}</li>
        </ul></div>`);
        const line = await cartLineFor(page, "Shirt", cartPath, options);
        await expectContractError(stepCartLineQuantity(line, control, cartPath, options), message);
      });
    }
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
  await stepCartLineQuantity(line, "increase", expectation.cartPath);
}

async function decreaseCartLineQuantity(page: Page, expectation: CartExpectation): Promise<void> {
  const line = await expectCartLine(page, expectation);
  await stepCartLineQuantity(line, "decrease", expectation.cartPath);
}

/** Clicks the line's increase or decrease button and waits for the native input value. */
async function stepCartLineQuantity(
  line: Locator,
  control: "increase" | "decrease",
  cartPath: string,
  options: CartTargetOptions = CART_TARGET_OPTIONS,
): Promise<void> {
  const quantityInput = await quantityInputFor(line, cartPath, options);
  const initialQuantity = await numericInputValue(quantityInput);
  const button = await requireCartLineControl(line, control, cartPath, options);
  const expectedQuantity = control === "increase" ? initialQuantity + 1 : initialQuantity - 1;
  const message =
    control === "increase"
      ? `Expected cart line quantity to increase from ${initialQuantity} to ${expectedQuantity}.`
      : `Expected cart line quantity to decrease from ${initialQuantity} to ${expectedQuantity} after quantity increase succeeded.`;

  await button.click();
  await expect.poll(() => numericInputValue(quantityInput), { message }).toBe(expectedQuantity);
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
  return requireCartLine(drawer, "cart drawer", productTitle, routePath, options);
}

/**
 * Returns the drawer line. Uses the cart trigger only when the drawer did not
 * open by itself after Add to cart. The check reads the native dialog state, not
 * the line, so a drawer that renders its lines only when it opens still works.
 */
async function openCartOverlayFor(
  page: Page,
  productTitle: string,
  routePath: string,
  options: CartTargetOptions = CART_TARGET_OPTIONS,
): Promise<Locator> {
  const drawer = await requireCartDrawer(page, routePath, options);
  const isOpen = await drawer.evaluate((node) => node instanceof HTMLDialogElement && node.open);
  if (!isOpen) {
    const trigger = await requireCartTrigger(page, routePath, options);
    await trigger.click();
  }

  return requireCartLine(drawer, "cart drawer", productTitle, routePath, options);
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
  return requireCartLine(cartPage, "cart page", productTitle, cartPath, options);
}

async function quantityInputFor(
  line: Locator,
  cartPath: string,
  options: CartTargetOptions = CART_TARGET_OPTIONS,
): Promise<Locator> {
  return requireCartLineControl(line, "quantity", cartPath, options);
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

/** A real cart line for helper fixtures. Decoy list items have no test ID. */
function cartLineHtml(text: string): string {
  return `<li data-testid="cart-line">${text}</li>`;
}

/**
 * A helper fixture line with working quantity controls. English-named decoy
 * inputs and buttons come first; the real controls have test IDs and German names.
 */
function quantityLineHtml(title: string, inputType: "text" | "number", quantity: number): string {
  return `<li data-testid="cart-line">
    <span>${title}</span>
    <input type="text" aria-label="Quantity" value="9">
    <input type="number" aria-label="Quantity" value="9">
    <button type="button" aria-label="Increase quantity" onclick="window.decoyClicked = true">+</button>
    <button type="button" aria-label="Decrease quantity" onclick="window.decoyClicked = true">-</button>
    <input type="${inputType}" data-testid="cart-line-quantity" aria-label="Menge" value="${quantity}">
    <button type="button" data-testid="cart-line-increase" aria-label="Mehr" onclick="${quantityStepScript(1)}">↑</button>
    <button type="button" data-testid="cart-line-decrease" aria-label="Weniger" onclick="${quantityStepScript(-1)}">↓</button>
  </li>`;
}

/** Inline click handler that changes the line's quantity input by `delta`. */
function quantityStepScript(delta: number): string {
  return `const input = this.closest('[data-testid=cart-line]').querySelector('[data-testid=cart-line-quantity]'); input.value = String(Number(input.value) + ${delta});`;
}

async function wasTriggerClicked(page: Page): Promise<boolean> {
  return page.evaluate(() => "triggerClicked" in window);
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
