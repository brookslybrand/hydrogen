---
name: hydrogen-storefront-testing
description: >
  Repository skill for maintaining the portable storefront e2e suite and its
  reference storefronts.
  Test ID contract for Hydrogen product pages, collection and search product
  results, and cart surfaces. Use when adding, reviewing, or testing
  data-testid attributes on the product title, variant option values, add to
  cart button, product results and product card links, collection filter
  checkboxes and labels, search page input and submit button, cart page,
  cart drawer,
  cart trigger, cart lines, cart line quantity and remove controls, cart
  status, or checkout link, or when writing Playwright tests for product pages,
  collection results and filters, search, add to cart, the cart, and the checkout handoff.
  Framework agnostic.
---

# Storefront Test IDs

This is a repository skill for agents who maintain the portable storefront suite in `packages/storefront-e2e/` and the reference storefronts in `templates/react-router/`, `examples/nextjs/`, and `examples/nuxt/`. The canonical contract is `packages/storefront-e2e/docs/storefront-contract.md`. When this skill and the contract differ, the contract is correct. Also read `skills/playwright-tests/SKILL.md` for the Playwright rules of this repository.

Portable storefront tests run against any storefront URL, so they cannot depend on your markup or class names. The product page exposes three standard `data-testid` attributes, collection and search results expose two, collection and search filters expose two, the search page form exposes two, and the cart exposes ten more, so there are 19 in total. Tests find these elements with Playwright `getByTestId`.

Only these 19 IDs are standard. Portable tests still find other storefront UI (an optional Apply filters button) by role, label, and text. Your storefront can have other test IDs for its own tests. Portable tests do not read them.

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

## The product results contract

| Test ID | Put it on | Count | Tests read |
| --- | --- | --- | --- |
| `product-results` | The existing element that holds the collection or search product results, for example the grid list or its wrapper | Exactly one on the whole page | Product cards inside it |
| `product-card` | The primary product link of each result: a visible native `<a>` with a real `href` to the product page, exposed as a link whose accessible name contains the product title | One per rendered result, so the ID repeats | The `href`, the link role, and the accessible name |

Rules:

- Put `product-results` on the main results only. Do not put it on recommendations or predictive search results. Product cards outside `product-results` do not count.
- On the search page, after a query, render `product-results` for matching results and for empty results. Put it on the existing empty-state element when there are no results; only one of the two renders at a time. Before a query, the page does not need it. An empty `product-results` before the query is fine, but it must not contain visible `product-card` links. Keep featured, popular, and recent product lists outside `product-results`; their cards can still use `product-card`. Tests reject visible marked cards inside `product-results` before the query.
- Tests find the searched product by its handle in the card `href`, then check that the accessible name contains its title. A card for a similar title, such as `T-Shirt` for `Shirt`, does not match.
- Put `product-card` on the primary `<a href>` product link, not on the card wrapper, such as an `<article>` or list item. If a card has an image link and a title link to the same product, mark only one.
- Keep the link visible with its native link role (no `aria-hidden`, `hidden`, or `role="button"`), and keep the product title in its accessible name. Tests do not match other text, so any language works. Tests read only visible cards, so hidden responsive copies do not count.
- Use existing elements. Do not add a wrapper or change the layout for tests. An element has only one `data-testid`, so if the grid already has another test ID, put `product-results` on an existing parent.

## The collection filter contract

| Test ID | Put it on | Count | Tests read |
| --- | --- | --- | --- |
| `collection-filter-value` | Each filter value checkbox, the native `<input type="checkbox">` itself | One per rendered value, so the ID repeats, also in hidden copies such as a mobile drawer | The native checked state, enabled state, and checkbox role |
| `collection-filter-label` | The visible native `<label>` that contains that checkbox | One for each `collection-filter-value` | Its text content, where the first whole number in parentheses is the count, such as `(4)` in `Red (4)`, and the click |

Rules:

- Keep the checkbox inside its `<label>`, so the native label association pairs them. Do not point the label's `for` attribute at another element.
- Put the IDs on list and boolean checkbox values only, in every copy of the filters. Price inputs and the sort control do not get them.
- Keep the checkbox in the accessibility tree. A visually hidden checkbox is fine; `display: none`, `visibility: hidden`, or `aria-hidden` is not.
- Keep the count in the label text as a whole number in parentheses, such as `Red (4)`. Tests read the first number in parentheses from the label text for now. They do not read counts from `title`, `aria-label`, or text such as `4 products`, so a label without a parenthesized number is not chosen. A value name that contains a number in parentheses, such as `Pack (2)`, can give the wrong count. Do not add custom attributes for counts.
- Tests read only visible labels, so hidden copies, such as a closed drawer, do not count. Tests check up to the first 20 visible marked labels before they choose one, and any invalid one fails. They cannot detect a value with neither ID and do not read it. They click the label and read the native `checked` state. Do not add test-only attributes for filter names, values, or state.
- Filters can apply on change. There is no test ID for an Apply button. If your filters need one, give it an accessible name that contains Apply filters or Show results.

## The search contract

| Test ID | Put it on | Count on the search page | Tests read |
| --- | --- | --- | --- |
| `search-input` | The query input of the search page form, a native `<input type="search">` | Exactly one on the whole page | Visible, editable, the searchbox role, and the typed query |
| `search-submit` | Optional. The submit button of the same form, a native `<button>` | None, or exactly one on the whole page | Visible, the button role, a non-empty accessible name in any language, and the click |

Rules:

- Put `search-input` only on the search page input, not on a header or predictive search input. Keep it visible, enabled, and editable, and keep its searchbox role.
- `search-submit` is optional. Without it, tests press Enter in the input. With it, tests click it, so it must be visible, in the same form as the input, and have an accessible name in any language. If your form has no search button, tests cover only Enter.
- The IDs only find the controls. A search test passes only when the searched product's card link shows in `product-results`.

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
| `cart-line-remove` | The remove control of each line, a native `<button>` | Exactly one in each line | The click |
| `cart-status` | The existing cart totals live region with `role="status"` | At least one. It can repeat, for example in the page and the drawer, or once for the whole page | Its text |
| `cart-checkout` | The checkout link of each populated cart view: a visible native `<a>` with a real `href` to the checkout URL, exposed as a link with a non-empty accessible name in any language | One per populated cart view, so it can repeat in the page and the drawer. Exactly one inside the cart page | The `href`, the link role and name, and the click on the cart page link |

Rules:

- Keep the drawer outside the `cart-page` element. The drawer can stay in the page on `/cart`, and the IDs keep the two cart views apart.
- Ordinary add-to-cart setup requires the drawer to open automatically and show the added line. Only the stock-limit rollback test clicks `cart-trigger` when the drawer is closed while its mutation request is held. Keep the closed `<dialog>` rendered before that click; its lines can render when it opens.
- Put `cart-trigger` only on a control that opens the drawer. A link that only goes to `/cart`, for example a fallback link before hydration or on the cart page, is not a trigger. Do not give it the ID.
- Keep the trigger's accessible name and ARIA, for example `aria-controls`, `aria-haspopup`, and `aria-expanded`. Do not add new test-only attributes.
- Put `cart-line` on one element per line that holds the whole line, including its quantity input and line controls. Any element works. Do not nest it, and do not put it on other list items, such as recommendations.
- The cart page and the drawer each render their own `cart-line` elements. In each view, one line contains a given product title.
- Portable checkout tests use `cart-drawer`, `cart-page`, and `cart-line` to find the added line, then click the single `cart-checkout` link inside `cart-page`. A checkout link in the drawer does not count.
- Put `cart-checkout` on the native `<a href>` checkout link only. Do not put it on a disabled placeholder, such as an `aria-disabled` span, or on payment buttons such as Shop Pay. Keep it visible, keep its native link role (no `aria-hidden`, `hidden`, or `role="button"`), and give it a non-empty accessible name. Tests do not match the name text, so any language works.
- Put the quantity and remove IDs on the native input and buttons inside the line, not on wrappers. Keep their accessible names and native `disabled` state. Tests do not match the button names, so a localized name such as `Entfernen` works.
- The native input value is the quantity. Do not add test-only attributes for the quantity or pending state.
- Put `cart-status` on the existing `role="status"` region that announces cart totals updates. Do not move or duplicate it for tests. Keep it exposed to assistive technology; a visually hidden region is fine, an `aria-hidden` one does not count.
- Portable tests wait for at least one `cart-status` region with `role="status"` that contains the message. They currently match the English text `Updating cart totals` and `Cart totals updated`. A language-independent status signal is deferred.

## Rendered markup

Add the IDs to the elements the page already renders:

```html
<h1 data-testid="product-title">Classic Tee</h1>

<!-- Size options. The ID repeats on every value. -->
<a data-testid="product-option-value" href="/products/classic-tee?Size=Small&amp;Color=Blue" aria-current="true">Small</a>
<a data-testid="product-option-value" href="/products/classic-tee?Size=Medium&amp;Color=Blue">Medium</a>
<button data-testid="product-option-value" type="button" aria-pressed="false" disabled>Large</button>

<button data-testid="product-add-to-cart" type="submit">Add to cart</button>

<!-- Collection or search results. Recommendations elsewhere on the page do not get product-results. -->
<div data-testid="product-results">
  <ul>
    <li>
      <article aria-label="Classic Tee">
        <img src="/classic-tee.jpg" alt="Classic Tee" />
        <h3><a data-testid="product-card" href="/products/classic-tee">Classic Tee</a></h3>
      </article>
    </li>
  </ul>
</div>

<!-- Collection or search filters. Hidden copies, such as a mobile drawer, repeat the IDs. -->
<label data-testid="collection-filter-label">
  <input data-testid="collection-filter-value" type="checkbox" name="filter.v.option.color" value="Red" />
  Red (4)
</label>

<!-- Search page form. The button is optional; without it, tests press Enter. -->
<form action="/search" method="get" role="search">
  <label for="search-q">Search</label>
  <input data-testid="search-input" id="search-q" type="search" name="q" />
  <button data-testid="search-submit" type="submit">Search</button>
</form>

<!-- Header. -->
<button data-testid="cart-trigger" type="button" aria-label="Cart, 1 item" aria-controls="cart-drawer" aria-haspopup="dialog">…</button>

<!-- Root layout. -->
<!-- Keep this empty initially. Use the real cart state for updating/updated messages. -->
<span data-testid="cart-status" role="status" class="sr-only"></span>
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
      <button data-testid="cart-line-remove" type="submit" aria-label="Remove Classic Tee">Remove</button>
    </li>
  </ul>
  <a data-testid="cart-checkout" href="https://shop.example/checkouts/cn/abc">Checkout</a>
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

  // Ordinary add-to-cart setup requires the drawer to open automatically.
  // Then find the line by text.
  await expect(
    page.getByTestId("cart-drawer").getByTestId("cart-line").filter({ hasText: "Classic Tee" }),
  ).toBeVisible();

  // Let the add settle before navigating away from its optimistic UI.
  const status = page
    .getByTestId("cart-status")
    .and(page.getByRole("status"))
    .filter({ hasText: "Cart totals updated" });
  await expect(status).not.toHaveCount(0);

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

  // cart-status can repeat. Wait for any status region with the message.
  await expect(status).not.toHaveCount(0);

  await line.getByTestId("cart-line-remove").click();
  await expect(line).toHaveCount(0);
});

test("shows a product in the collection results", async ({ page }) => {
  await page.goto("/collections/tees");

  // Find cards only inside the results. Narrow by href, then check the link role and name.
  const card = page
    .getByTestId("product-results")
    .getByTestId("product-card")
    .filter({ visible: true })
    .and(page.locator('[href$="/products/classic-tee"]'));
  await expect(card.and(page.getByRole("link", { name: /Classic Tee/i }))).toBeVisible();
});
```

- Find the search input with `getByTestId("search-input")`. Click `search-submit` when the page has one; otherwise press Enter in the input.
- Find filter labels with `getByTestId("collection-filter-label").filter({ visible: true })`, then the checkbox inside the label. Click the label and expect the checkbox to be checked.
- Scope `product-card` to `product-results`, because recommendations can render product cards on the same page. Count results by unique product `href`, not by card elements.

- Scope `cart-checkout` to `cart-page`, because the drawer can render its own checkout link.
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
- [ ] On each collection page that shows results, and on each search page after a query (with or without results), exactly one existing element has `data-testid="product-results"`, and recommendations, featured products, and predictive search do not. Before a query, the search page shows no visible `product-card` inside `product-results`
- [ ] The primary product link of each result is a visible native `<a href>` to the product page with `data-testid="product-card"`, and its accessible name contains the product title
- [ ] Each list or boolean filter value is a native `<input type="checkbox">` with `data-testid="collection-filter-value"`, inside a visible native `<label>` with `data-testid="collection-filter-label"` whose text has the count as a whole number in parentheses, such as `Red (4)`, in every copy of the filters
- [ ] Exactly one visible, editable `<input type="search">` on the search page has `data-testid="search-input"`, and header or predictive search inputs do not
- [ ] If the search form has a submit button, it is the only element with `data-testid="search-submit"`, a visible native `<button>` in the same form, with an accessible name
- [ ] Exactly one element on `/cart` has `data-testid="cart-page"`, and the drawer is not inside it
- [ ] Exactly one native `<dialog>` has `data-testid="cart-drawer"`
- [ ] Each populated cart view has one visible native `<a href>` checkout link with a non-empty accessible name and `data-testid="cart-checkout"`, and the cart page has exactly one
- [ ] The existing cart totals `role="status"` region has `data-testid="cart-status"` and is not `aria-hidden`
- [ ] At most one `<button>` or `<a>` that opens the drawer has `data-testid="cart-trigger"`, and plain `/cart` links do not
- [ ] Each rendered cart line, in the page and in the drawer, has one `data-testid="cart-line"` element that holds its title and controls
- [ ] Each cart line has exactly one native `<input>` with `data-testid="cart-line-quantity"` and one native `<button>` each with `data-testid="cart-line-increase"` and `data-testid="cart-line-decrease"`
- [ ] Each cart line has exactly one native `<button>` with `data-testid="cart-line-remove"`, with an accessible name
- [ ] No new test-only attributes are on these elements
