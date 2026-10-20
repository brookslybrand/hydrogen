import { expect, type Locator, type Page } from "@playwright/test";

import { createContractError, type ContractCapability } from "./contract";

// Cart test IDs from docs/storefront-contract.md#cart-test-ids.
export const CART_PAGE_TEST_ID = "cart-page";
export const CART_DRAWER_TEST_ID = "cart-drawer";
export const CART_TRIGGER_TEST_ID = "cart-trigger";

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

/** Returns the single cart page content root. */
export async function requireCartPage(
  page: Page,
  routePath: string,
  options: CartTargetOptions = {},
): Promise<Locator> {
  return requireSingleCartTarget(page, CART_PAGE_TARGET, routePath, options);
}

/** Returns the single native cart drawer <dialog>. */
export async function requireCartDrawer(
  page: Page,
  routePath: string,
  options: CartTargetOptions = {},
): Promise<Locator> {
  return requireSingleCartTarget(page, CART_DRAWER_TARGET, routePath, options);
}

/** Returns the single native <button> or <a> that opens the cart drawer. */
export async function requireCartTrigger(
  page: Page,
  routePath: string,
  options: CartTargetOptions = {},
): Promise<Locator> {
  return requireSingleCartTarget(page, CART_TRIGGER_TARGET, routePath, options);
}

async function requireSingleCartTarget(
  page: Page,
  target: SingleCartTarget,
  routePath: string,
  { timeout }: CartTargetOptions,
): Promise<Locator> {
  const locator = page.getByTestId(target.testId);
  const attribute = `data-testid="${target.testId}"`;

  try {
    await expect(locator).toHaveCount(1, { timeout });
  } catch {
    const count = await locator.count();
    throw createContractError({
      capability: target.capability,
      routePath,
      expectation: `The page renders exactly one element with ${attribute} (the ${target.description}). Found ${count}.`,
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
