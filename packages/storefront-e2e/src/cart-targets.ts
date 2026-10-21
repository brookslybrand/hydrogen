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
export const CART_STATUS_TEST_ID = "cart-status";

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

const CART_STATES = ["idle", "updating", "updated", "error"] as const;

/** A `data-cart-state` value on a cart status region. */
export type CartStatusState = (typeof CART_STATES)[number];

/** A cart state the suite can wait for. `idle` is never a wait target. */
export type WaitableCartStatusState = Exclude<CartStatusState, "idle">;

/**
 * Waits until the accessible cart status regions reach `state`. A region counts
 * only when it has the test ID and is exposed as `role="status"` to assistive
 * technology. The ID can repeat: the cart page, the drawer, or the whole page
 * can each render a status region.
 *
 * This is a readiness wait, not a verdict on the cart change. `updating` needs
 * one region that is updating. `updated` needs one updated region and no
 * region that is updating or has an error. `error` needs one region with an
 * error and no region that is updating. A region without a valid
 * `data-cart-state` is a contract failure.
 */
export async function waitForCartState(
  page: Page,
  state: WaitableCartStatusState,
  routePath: string,
  { timeout }: CartTargetOptions = {},
): Promise<void> {
  const statuses = page.getByTestId(CART_STATUS_TEST_ID).and(page.getByRole("status"));
  let states: CartStatusState[] = [];
  let stateError: unknown = null;

  // An invalid state ends the wait with its own error.
  const isReached = await expect
    .poll(
      async () => {
        try {
          states = await readCartStates(statuses, routePath);
        } catch (error) {
          stateError = error;
          return true;
        }
        return isCartStateReached(states, state);
      },
      { timeout },
    )
    .toBe(true)
    .then(
      () => true,
      () => false,
    );
  if (stateError !== null) throw stateError;
  if (isReached) return;

  const attribute = `data-testid="${CART_STATUS_TEST_ID}"`;
  const found = states.length === 0 ? "none" : states.map((value) => `"${value}"`).join(", ");
  throw createContractError({
    capability: "cart-status",
    routePath,
    expectation: `The elements with ${attribute} and role="status", exposed to assistive technology, reach data-cart-state="${state}"${cartStateCondition(state)}. Found ${found}.`,
    likelyFix:
      states.length === 0
        ? `Add ${attribute} to the existing role="status" cart totals region. Do not hide it with aria-hidden.`
        : `Set data-cart-state on each cart status region from the same pending and network error state as its message: updating while the cart change or reload is pending, error after a network failure, updated after a pending cycle, and idle before one.`,
    docsAnchor: "#cart-test-ids",
  });
}

function isCartStateReached(
  states: readonly CartStatusState[],
  target: WaitableCartStatusState,
): boolean {
  if (!states.includes(target)) return false;
  if (target === "updating") return true;
  if (states.includes("updating")) return false;
  return target === "error" || !states.includes("error");
}

function cartStateCondition(state: WaitableCartStatusState): string {
  if (state === "updated") return ', with no region "updating" or "error"';
  if (state === "error") return ', with no region "updating"';
  return "";
}

/** Reads `data-cart-state` from each accessible cart status region. */
async function readCartStates(statuses: Locator, routePath: string): Promise<CartStatusState[]> {
  const values = await statuses.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-cart-state")),
  );
  const states: CartStatusState[] = [];
  for (const value of values) {
    if (isCartStatusState(value)) {
      states.push(value);
      continue;
    }

    throw createContractError({
      capability: "cart-status",
      routePath,
      expectation: `Each element with data-testid="${CART_STATUS_TEST_ID}" and role="status" has data-cart-state set to ${CART_STATES.map((name) => `"${name}"`).join(", ")}. Found ${value === null ? "no data-cart-state" : `"${value}"`}.`,
      likelyFix:
        "Render data-cart-state on every cart status region, including the first render, with one of the four values.",
      docsAnchor: "#cart-test-ids",
    });
  }

  return states;
}

function isCartStatusState(value: string | null): value is CartStatusState {
  return CART_STATES.some((state) => state === value);
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
