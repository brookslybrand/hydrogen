---
name: hydrogen-storefront-testing
description: >
  Repository skill for maintaining the portable storefront e2e suite and its
  reference storefronts.
  Test ID contract for Hydrogen product pages and cart surfaces. Use when
  adding, reviewing, or testing data-testid attributes on the product title,
  variant option values, add to cart button, cart page, cart drawer, cart
  trigger, cart lines, or cart line quantity controls, or when writing
  Playwright tests for product pages, add to cart, and the cart. Framework
  agnostic.
---

# Storefront Test IDs

This is a repository skill for agents who maintain the portable storefront suite in `packages/storefront-e2e/` and the reference storefronts in `templates/react-router/`, `examples/nextjs/`, and `examples/nuxt/`. The canonical contract is `packages/storefront-e2e/docs/storefront-contract.md`. When this skill and the contract differ, the contract is correct. Also read `skills/playwright-tests/SKILL.md` for the Playwright rules of this repository.

Portable storefront tests run against any storefront URL, so they cannot depend on your markup or class names. The product page exposes three standard `data-testid` attributes, and the cart exposes seven more. Tests find these elements with Playwright `getByTestId`.

Only these ten IDs are standard. Portable tests still find other storefront UI (product cards, filters, search, the cart line remove control, cart status, checkout) by role, label, and text. Your storefront can have other test IDs for its own tests. Portable tests do not read them.

## The product contract

| Test ID | Put it on | Count on the product page | Tests read |
| --- | --- | --- | --- |
| `product-title` | The product heading, a native `<h1>` | Exactly one | A visible level-one heading exposed to assistive technology, whose text contains the product title |
| `product-option-value` | Each option value, the native `<a>` or `<button>` itself | One per rendered value, so the ID repeats | Accessible name, `href`, `aria-current`, `aria-pressed`, disabled state |
| `product-add-to-cart` | The add to cart control, a native `<button>` | Exactly one on the whole page | Enabled or disabled state, and the click |

Exactly one means the whole page. If recommendations, a sticky bar, or a quick-add form render another title or add to cart button, do not give it the same test ID.

Rules:

- Put the ID on the element the buyer reads or activates, not on a wrapper, label, or list item.
- A test ID only says what kind of element this is. Do not put option names, values, variant IDs, or state in the ID. Do not add new test-only attributes. Existing `data-*` attributes that your app uses, for example for styling, can stay.
- State comes from native attributes, ARIA, and real content:
  - The selected option link has `aria-current="true"`.
  - An option button has `aria-pressed`, and the selected one has `aria-pressed="true"`.
  - An option value for a combination that does not exist is a `<button>` with the native `disabled` attribute.
  - The add to cart button has native `disabled` or `aria-disabled="true"` when the selection cannot be added, for example no variant is selected or the variant is sold out. Keep your existing interaction behavior. For example, an `aria-disabled` button can still move focus to the first option on click.
  - The title text is the product title from the Storefront API.
- Test IDs do not replace accessibility. Keep the `<h1>`, the accessible name on each control, and the state attributes above.

## The cart contract

| Test ID | Put it on | Count | Tests read |
| --- | --- | --- | --- |
| `cart-page` | The content root of the `/cart` page, for example its `<main>` | Exactly one on the cart page | Cart lines inside it |
| `cart-drawer` | The cart drawer, a native `<dialog>` | Exactly one on the whole page | Cart lines inside it |
| `cart-trigger` | The control that opens the cart drawer, a native `<button>` or a native `<a>` that opens the drawer when clicked | At most one on the whole page. Tests that click it need exactly one | The click |
| `cart-line` | Each rendered cart line, the element that holds its title, variant text, and line controls | One per rendered line, so the ID repeats | The product title, the variant text, and the controls inside it |
| `cart-line-quantity` | The editable quantity input of each line, a native `<input>` such as `type="text"` or `type="number"` | Exactly one in each line | The native input value |
| `cart-line-increase` | The increase quantity control of each line, a native `<button>` | Exactly one in each line | The click |
| `cart-line-decrease` | The decrease quantity control of each line, a native `<button>` | Exactly one in each line | The click |

Rules:

- Keep the drawer outside the `cart-page` element. The drawer can stay in the page on `/cart`, and the IDs keep the two cart views apart.
- Put `cart-trigger` only on a control that opens the drawer. A link that only goes to `/cart`, for example a fallback link before hydration or on the cart page, is not a trigger. Do not give it the ID.
- Keep the trigger's accessible name and ARIA, for example `aria-controls`, `aria-haspopup`, and `aria-expanded`. Do not add new test-only attributes.
- Put `cart-line` on one element per line that holds the whole line, including its quantity input and line controls. Any element works. Do not nest it, and do not put it on other list items, such as recommendations.
- The cart page and the drawer each render their own `cart-line` elements. In each view, one line contains a given product title.
- Put the quantity IDs on the native input and buttons inside the line, not on wrappers. Keep their accessible names and native `disabled` state. Tests do not match the button names.
- The native input value is the quantity. Do not add test-only attributes for the quantity or pending state.
- The remove control and the cart status still use role, label, and text. They do not have standard test IDs.

## Rendered markup

Add the IDs to the elements the page already renders:

```html
<h1 data-testid="product-title">Classic Tee</h1>

<!-- Size options. The ID repeats on every value. -->
<a data-testid="product-option-value" href="/products/classic-tee?Size=Small&amp;Color=Blue" aria-current="true">Small</a>
<a data-testid="product-option-value" href="/products/classic-tee?Size=Medium&amp;Color=Blue">Medium</a>
<button data-testid="product-option-value" type="button" aria-pressed="false" disabled>Large</button>

<button data-testid="product-add-to-cart" type="submit">Add to cart</button>

<!-- Header. -->
<button data-testid="cart-trigger" type="button" aria-label="Cart, 1 item" aria-controls="cart-drawer" aria-haspopup="dialog">…</button>

<!-- Root layout. -->
<dialog data-testid="cart-drawer" id="cart-drawer" aria-labelledby="cart-drawer-title">…</dialog>

<!-- /cart route. The drawer renders its own lines the same way. -->
<main data-testid="cart-page" id="main-content">
  <ul>
    <li data-testid="cart-line">
      <a href="/products/classic-tee">Classic Tee</a>
      <p>Medium / Blue</p>
      <button data-testid="cart-line-decrease" type="submit" aria-label="Decrease quantity">−</button>
      <input data-testid="cart-line-quantity" type="number" aria-label="Quantity" value="1" />
      <button data-testid="cart-line-increase" type="submit" aria-label="Increase quantity">+</button>
      <button aria-label="Remove Classic Tee">Remove</button>
    </li>
  </ul>
</main>
```

Test IDs do not add a server-rendering, no-JavaScript, or hydration requirement, and they do not change those behaviors. Where the page is server-rendered, the IDs are in the server HTML with their elements. Follow `packages/hydrogen/skills/hydrogen-variant-form/SKILL.md` for the URL and no-JavaScript rules for variant options.

## Writing Playwright tests

```ts
import { expect, test } from "@playwright/test";

test("selects a variant and adds it to the cart", async ({ page }) => {
  await page.goto("/products/classic-tee");
  await expect(page.getByTestId("product-title")).toHaveText("Classic Tee");

  // product-option-value repeats. Narrow it by accessible name.
  const medium = page
    .getByTestId("product-option-value")
    .and(page.getByRole("link", { name: "Medium", exact: true }));
  await medium.click();
  await expect(medium).toHaveAttribute("aria-current", "true");

  const addToCart = page.getByTestId("product-add-to-cart");
  // toBeEnabled() treats both native disabled and aria-disabled="true" as disabled.
  await expect(addToCart).toBeEnabled();
  await addToCart.click();

  // This store opens the cart drawer after add to cart. If yours does not,
  // click page.getByTestId("cart-trigger") first. Then find the line by text.
  await expect(
    page.getByTestId("cart-drawer").getByTestId("cart-line").filter({ hasText: "Classic Tee" }),
  ).toBeVisible();

  await page.goto("/cart");
  const line = page
    .getByTestId("cart-page")
    .getByTestId("cart-line")
    .filter({ hasText: "Classic Tee" });
  await expect(line).toBeVisible();

  // Quantity controls are scoped to the line. The native input value is the quantity.
  const quantity = line.getByTestId("cart-line-quantity");
  await expect(quantity).toHaveValue("1");
  await line.getByTestId("cart-line-increase").click();
  await expect(quantity).toHaveValue("2");

  await expect(line.getByRole("button", { name: /remove/i })).toBeVisible();
});
```

- Scope `cart-line` to `cart-page` or `cart-drawer`. Do not use `getByRole("main")` or `getByRole("dialog")`, because the page can render both cart views at the same time. Narrow lines by product title, not by `.nth()`, and do not use `.first()` to hide more than one match.
- Narrow `product-option-value` by accessible name, role, or `href`. Do not use `.nth()`, because option order is store data.
- Read selection from `aria-current` or `aria-pressed`. Do not read class names or styles.
- Wait for visible results. Do not wait for timeouts, network idle, or responses.
- Create state through the UI, as a buyer does. Do not set cart cookies or storage.

## Checklist

- [ ] Exactly one `<h1>` on the page has `data-testid="product-title"`; it is visible, exposed to assistive technology, and contains the product title
- [ ] Each option value link or button has `data-testid="product-option-value"`
- [ ] The selected option has `aria-current="true"` (link) or `aria-pressed="true"` (button)
- [ ] Option values for combinations that do not exist are buttons with native `disabled`
- [ ] Exactly one `<button>` on the page has `data-testid="product-add-to-cart"`, with native `disabled` or `aria-disabled="true"` when the selection cannot be added
- [ ] Exactly one element on `/cart` has `data-testid="cart-page"`, and the drawer is not inside it
- [ ] Exactly one native `<dialog>` has `data-testid="cart-drawer"`
- [ ] At most one `<button>` or `<a>` that opens the drawer has `data-testid="cart-trigger"`, and plain `/cart` links do not
- [ ] Each rendered cart line, in the page and in the drawer, has one `data-testid="cart-line"` element that holds its title and controls
- [ ] Each cart line has exactly one native `<input>` with `data-testid="cart-line-quantity"` and one native `<button>` each with `data-testid="cart-line-increase"` and `data-testid="cart-line-decrease"`
- [ ] No new test-only attributes are on these elements
