import { expect, type Locator, type Page } from "@playwright/test";

import { createContractError, type ContractCapability } from "./contract";

// Cart test IDs from docs/storefront-contract.md#cart-test-ids.
export const CART_PAGE_TEST_ID = "cart-page";
export const CART_DRAWER_TEST_ID = "cart-drawer";
export const CART_TRIGGER_TEST_ID = "cart-trigger";
export const CART_LINE_TEST_ID = "cart-line";
export const CART_LINE_QUANTITY_TEST_ID = "cart-line-quantity";
export const CART_LINE_INCREASE_TEST_ID = "cart-line-increase";
export const CART_LINE_DECREASE_TEST_ID = "cart-line-decrease";
export const CART_LINE_REMOVE_TEST_ID = "cart-line-remove";

type SingleCartTarget = {
  readonly capability: ContractCapability;
  readonly description: string;
  /** The native elements the test ID can be on. An empty list allows any element. */
  readonly elements: readonly string[];
  readonly testId: string;
};

export type CartTargetOptions = {
  /** How long to wait for exactly one target. Defaults to the expect timeout. */
  readonly timeout?: number;
};

const CART_PAGE_TARGET: SingleCartTarget = {
  capability: "cart-route",
  description: "cart page content root",
  elements: [],
  testId: CART_PAGE_TEST_ID,
};

const CART_DRAWER_TARGET: SingleCartTarget = {
  capability: "cart-line",
  description: "cart drawer",
  elements: ["dialog"],
  testId: CART_DRAWER_TEST_ID,
};

const CART_TRIGGER_TARGET: SingleCartTarget = {
  capability: "cart-line",
  description: "control that opens the cart drawer",
  elements: ["button", "a"],
  testId: CART_TRIGGER_TEST_ID,
};

const CART_LINE_CONTROL_TARGETS = {
  quantity: {
    capability: "cart-line",
    description: "quantity input",
    elements: ["input"],
    testId: CART_LINE_QUANTITY_TEST_ID,
  },
  increase: {
    capability: "cart-line",
    description: "increase quantity button",
    elements: ["button"],
    testId: CART_LINE_INCREASE_TEST_ID,
  },
  decrease: {
    capability: "cart-line",
    description: "decrease quantity button",
    elements: ["button"],
    testId: CART_LINE_DECREASE_TEST_ID,
  },
  remove: {
    capability: "cart-line",
    description: "remove button",
    elements: ["button"],
    testId: CART_LINE_REMOVE_TEST_ID,
  },
} as const satisfies Record<string, SingleCartTarget>;

export type CartLineControl = keyof typeof CART_LINE_CONTROL_TARGETS;

/** Returns the single cart page content root. */
export async function requireCartPage(
  page: Page,
  routePath: string,
  options: CartTargetOptions = {},
): Promise<Locator> {
  return requireSingleCartTarget(page, "page", CART_PAGE_TARGET, routePath, options);
}

/** Returns the single native cart drawer <dialog>. */
export async function requireCartDrawer(
  page: Page,
  routePath: string,
  options: CartTargetOptions = {},
): Promise<Locator> {
  return requireSingleCartTarget(page, "page", CART_DRAWER_TARGET, routePath, options);
}

/** Returns the single native <button> or <a> that opens the cart drawer. */
export async function requireCartTrigger(
  page: Page,
  routePath: string,
  options: CartTargetOptions = {},
): Promise<Locator> {
  return requireSingleCartTarget(page, "page", CART_TRIGGER_TARGET, routePath, options);
}

/**
 * Returns the single cart line in `surface` (the cart page or the cart drawer)
 * that contains `productTitle`. Lines in other surfaces do not count. A missing
 * or ambiguous match is a contract failure.
 */
export async function requireCartLine(
  surface: Locator,
  surfaceDescription: string,
  productTitle: string,
  routePath: string,
  { timeout }: CartTargetOptions = {},
): Promise<Locator> {
  const line = surface.getByTestId(CART_LINE_TEST_ID).filter({ hasText: productTitle });
  const attribute = `data-testid="${CART_LINE_TEST_ID}"`;

  try {
    await expect(line).toHaveCount(1, { timeout });
  } catch {
    const count = await line.count();
    throw createContractError({
      capability: "cart-line",
      routePath,
      expectation: `The ${surfaceDescription} renders exactly one element with ${attribute} that contains "${productTitle}". Found ${count}.`,
      likelyFix:
        count === 0
          ? `Add ${attribute} to the element that holds each cart line and its controls.`
          : `Keep ${attribute} only on the element that holds each cart line. Do not nest it or put it on other elements.`,
      docsAnchor: "#cart-test-ids",
    });
  }

  return line;
}

/**
 * Returns the single visible quantity <input>, or increase, decrease, or remove
 * <button>, inside `line`. The native input value stays the quantity.
 */
export async function requireCartLineControl(
  line: Locator,
  control: CartLineControl,
  routePath: string,
  options: CartTargetOptions = {},
): Promise<Locator> {
  const target = CART_LINE_CONTROL_TARGETS[control];
  const locator = await requireSingleCartTarget(line, "cart line", target, routePath, options);
  const isVisible = await expect(locator)
    .toBeVisible({ timeout: options.timeout })
    .then(
      () => true,
      () => false,
    );
  if (!isVisible) {
    throw createContractError({
      capability: target.capability,
      routePath,
      expectation: `The ${target.description} with data-testid="${target.testId}" is visible in the cart line.`,
      likelyFix: `Keep the cart line ${target.description} visible.`,
      docsAnchor: "#cart-test-ids",
    });
  }

  return locator;
}

async function requireSingleCartTarget(
  scope: Page | Locator,
  scopeDescription: string,
  target: SingleCartTarget,
  routePath: string,
  { timeout }: CartTargetOptions,
): Promise<Locator> {
  const locator = scope.getByTestId(target.testId);
  const attribute = `data-testid="${target.testId}"`;

  try {
    await expect(locator).toHaveCount(1, { timeout });
  } catch {
    const count = await locator.count();
    throw createContractError({
      capability: target.capability,
      routePath,
      expectation: `The ${scopeDescription} renders exactly one element with ${attribute} (the ${target.description}). Found ${count}.`,
      likelyFix:
        count === 0
          ? `Add ${attribute} to the ${target.description}.`
          : `Keep ${attribute} only on the ${target.description}. Remove it from other elements.`,
      docsAnchor: "#cart-test-ids",
    });
  }

  if (target.elements.length === 0) return locator;

  const element = await locator.evaluate((node) => node.localName);
  if (!target.elements.includes(element)) {
    const allowed = target.elements.map((name) => `<${name}>`).join(" or ");
    throw createContractError({
      capability: target.capability,
      routePath,
      expectation: `The element with ${attribute} is the native ${allowed} ${target.description}. Found <${element}>.`,
      likelyFix: `Put ${attribute} on the native ${allowed} element, not on a wrapper or an element with an ARIA role.`,
      docsAnchor: "#cart-test-ids",
    });
  }

  return locator;
}
