---
name: hydrogen-storefront-testing
description: >
  Repository skill for maintaining the portable storefront e2e suite and its
  reference storefronts.
  Test ID contract for Hydrogen product pages. Use when adding, reviewing, or
  testing the data-testid attribute on the product title, or when writing
  Playwright tests for product pages. Framework agnostic.
---

# Storefront Test IDs

This is a repository skill for agents who maintain the portable storefront suite in `packages/storefront-e2e/` and the reference storefronts in `templates/react-router/`, `examples/nextjs/`, and `examples/nuxt/`. The canonical contract is `packages/storefront-e2e/docs/storefront-contract.md`. When this skill and the contract differ, the contract is correct. Also read `skills/playwright-tests/SKILL.md` for the Playwright rules of this repository.

Portable storefront tests run against any storefront URL, so they cannot depend on your markup or class names. The product page exposes a standard `data-testid` attribute on the product title, and tests find it with Playwright `getByTestId`.

Only this ID is standard. Portable tests still find other storefront UI (product cards, filters, search, variant options, add to cart, cart lines, cart controls, cart status, checkout) by role, label, and text. Your storefront can have other test IDs for its own tests. Portable tests do not read them.

## The contract

| Test ID | Put it on | Count on the product page | Tests read |
| --- | --- | --- | --- |
| `product-title` | The product heading, a native `<h1>` | Exactly one | A visible level-one heading exposed to assistive technology, whose text contains the product title |

Exactly one means the whole page. If recommendations, a sticky bar, or a quick-add form render another product title, do not give it the same test ID.

Rules:

- Put the ID on the element the buyer reads, not on a wrapper.
- A test ID only says what kind of element this is. Do not put product names or other data in the ID. Do not add new test-only attributes. Existing `data-*` attributes that your app uses, for example for styling, can stay.
- The title text is the product title from the Storefront API.
- Test IDs do not replace accessibility. Keep the `<h1>`.

## Rendered markup

Add the ID to the heading the page already renders:

```html
<h1 data-testid="product-title">Classic Tee</h1>
```

Test IDs do not add a server-rendering, no-JavaScript, or hydration requirement, and they do not change those behaviors. Where the page is server-rendered, the ID is in the server HTML with its element.

## Writing Playwright tests

```ts
import { expect, test } from "@playwright/test";

test("shows the product title", async ({ page }) => {
  await page.goto("/products/classic-tee");
  await expect(page.getByTestId("product-title")).toHaveText("Classic Tee");
});
```

- Wait for visible results. Do not wait for timeouts, network idle, or responses.
- Create state through the UI, as a buyer does. Do not set cart cookies or storage.

## Checklist

- [ ] Exactly one `<h1>` on the page has `data-testid="product-title"`; it is visible, exposed to assistive technology, and contains the product title
- [ ] No new test-only attributes are on this element
