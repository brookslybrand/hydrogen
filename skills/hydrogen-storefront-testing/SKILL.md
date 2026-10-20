---
name: hydrogen-storefront-testing
description: >
  Repository skill for maintaining the portable storefront e2e suite and its
  reference storefronts.
  Test ID contract for Hydrogen product pages. Use when adding, reviewing, or
  testing data-testid attributes on the product title or variant option values,
  or when writing Playwright tests for product pages and variant selection.
  Framework agnostic.
---

# Storefront Test IDs

This is a repository skill for agents who maintain the portable storefront suite in `packages/storefront-e2e/` and the reference storefronts in `templates/react-router/`, `examples/nextjs/`, and `examples/nuxt/`. The canonical contract is `packages/storefront-e2e/docs/storefront-contract.md`. When this skill and the contract differ, the contract is correct. Also read `skills/playwright-tests/SKILL.md` for the Playwright rules of this repository.

Portable storefront tests run against any storefront URL, so they cannot depend on your markup or class names. The product page exposes two standard `data-testid` attributes, and tests find these elements with Playwright `getByTestId`.

Only these two IDs are standard. Portable tests still find other storefront UI (product cards, filters, search, add to cart, cart lines, cart controls, cart status, checkout) by role, label, and text. Your storefront can have other test IDs for its own tests. Portable tests do not read them.

## The contract

| Test ID | Put it on | Count on the product page | Tests read |
| --- | --- | --- | --- |
| `product-title` | The product heading, a native `<h1>` | Exactly one | A visible level-one heading exposed to assistive technology, whose text contains the product title |
| `product-option-value` | Each option value, the native `<a>` or `<button>` itself | One per rendered value, so the ID repeats | Accessible name, `href`, `aria-current`, `aria-pressed`, disabled state |

Exactly one means the whole page. If recommendations, a sticky bar, or a quick-add form render another product title, do not give it the same test ID.

Rules:

- Put the ID on the element the buyer reads or activates, not on a wrapper, label, or list item.
- A test ID only says what kind of element this is. Do not put option names, values, variant IDs, or state in the ID. Do not add new test-only attributes. Existing `data-*` attributes that your app uses, for example for styling, can stay.
- State comes from native attributes, ARIA, and real content:
  - The selected option link has `aria-current="true"`.
  - An option button has `aria-pressed`, and the selected one has `aria-pressed="true"`.
  - An option value for a combination that does not exist is a `<button>` with the native `disabled` attribute.
  - The title text is the product title from the Storefront API.
- Test IDs do not replace accessibility. Keep the `<h1>`, the accessible name on each control, and the state attributes above.

## Rendered markup

Add the IDs to the elements the page already renders:

```html
<h1 data-testid="product-title">Classic Tee</h1>

<!-- Size options. The ID repeats on every value. -->
<a data-testid="product-option-value" href="/products/classic-tee?Size=Small&amp;Color=Blue" aria-current="true">Small</a>
<a data-testid="product-option-value" href="/products/classic-tee?Size=Medium&amp;Color=Blue">Medium</a>
<button data-testid="product-option-value" type="button" aria-pressed="false" disabled>Large</button>
```

Test IDs do not add a server-rendering, no-JavaScript, or hydration requirement, and they do not change those behaviors. Where the page is server-rendered, the IDs are in the server HTML with their elements. Follow `packages/hydrogen/skills/hydrogen-variant-form/SKILL.md` for the URL and no-JavaScript rules for variant options.

## Writing Playwright tests

```ts
import { expect, test } from "@playwright/test";

test("selects a variant", async ({ page }) => {
  await page.goto("/products/classic-tee");
  await expect(page.getByTestId("product-title")).toHaveText("Classic Tee");

  // product-option-value repeats. Narrow it by accessible name.
  const medium = page
    .getByTestId("product-option-value")
    .and(page.getByRole("link", { name: "Medium", exact: true }));
  await medium.click();
  await expect(medium).toHaveAttribute("aria-current", "true");
});
```

- Narrow `product-option-value` by accessible name, role, or `href`. Do not use `.nth()`, because option order is store data.
- Read selection from `aria-current` or `aria-pressed`. Do not read class names or styles.
- Wait for visible results. Do not wait for timeouts, network idle, or responses.
- Create state through the UI, as a buyer does. Do not set cart cookies or storage.

## Checklist

- [ ] Exactly one `<h1>` on the page has `data-testid="product-title"`; it is visible, exposed to assistive technology, and contains the product title
- [ ] Each option value link or button has `data-testid="product-option-value"`
- [ ] The selected option has `aria-current="true"` (link) or `aria-pressed="true"` (button)
- [ ] Option values for combinations that do not exist are buttons with native `disabled`
- [ ] No new test-only attributes are on these elements
